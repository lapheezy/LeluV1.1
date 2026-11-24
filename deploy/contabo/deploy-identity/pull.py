#!/usr/bin/env python3
# ==========================================================
# LÉLU deploy agent — VPS-side, PULL only (no inbound SSH, no key transfer).
#
# Runs as the unprivileged user lelu-deploy from a systemd timer. It asks
# GitHub whether the owner has APPROVED a deployment request, verifies that
# approval end to end, and only then asks the one root wrapper sudo allows
# (`/usr/local/lib/lelu-deploy/run <action>`) to perform ONE allow-listed
# action. It never executes anything it downloads: the request is data
# (validated JSON), and an artifact is data (a patch whose sha256 the
# approved request names, applied by the pinned root scripts).
#
# A request is accepted only when ALL of these hold — no single fact (a
# commit existing, a valid signature) is treated as approval:
#   1. the request file changed in a commit on the pinned branch of the
#      pinned repository (GitHub compare: commit is contained in the branch);
#   2. that commit is GitHub-signed (verification.verified, reason "valid")
#      AND committed by GitHub's web flow (a merge done in github.com);
#   3. it is the merge commit of a PR whose base is the pinned branch, whose
#      head is this repository (no forks), MERGED BY the owner account;
#   4. the PR carries the approval label, APPLIED BY the owner account
#      before the merge, and not removed again before the merge;
#   5. the request JSON matches the schema exactly (no extra keys), names
#      this repository and branch, an allow-listed action, a fresh id, and
#      a not_after in the future and within 72 h of the commit;
#   6. every artifact is on an allow-listed path, fetched at that exact
#      commit, at most 1 MiB, and its sha256 equals the one in the request.
#   7. the OWNER approved it on the VPS itself: `lelu-deploy-approve <code>`
#      typed as root in the Contabo console wrote a root-owned approval
#      file for exactly this commit + request + artifacts. GitHub alone can
#      never authorise a run: a merge and a label made with the owner's
#      GitHub access look identical whether a person or an agent made them
#      (verified on PR #15: actor pheruel, performed_via_github_app null).
# The commit and the request id are recorded BEFORE execution, so a
# request runs at most once (replay-proof, crash-safe).
# ==========================================================
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import stat as _stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"
RAW = "https://raw.githubusercontent.com"
REPO = "lapheezy/LeluV1.1"
BRANCH = "integration/lelu-four-workforce-consolidation"
OWNER_LOGIN = "pheruel"          # the owner's GitHub account (lapheezy is the repository namespace)
APPROVAL_LABEL = "deploy-approved"
REQUEST_PATH = "deploy/contabo/deploy-request.json"
STATE_DIR = "/var/lib/lelu-deploy/pull"
INCOMING = "/var/lib/lelu-deploy/incoming"
APPROVALS = "/etc/lelu-deploy/approvals"   # root-owned 0755; lelu-deploy can read, never write
APPROVER_UID = 0
RUNNER = ["sudo", "-n", "/usr/local/lib/lelu-deploy/run"]
ACTIONS = {
    "recon", "apply", "accept", "rollback",
    "https-check", "https-stage", "https-issue", "https-enable", "https-rollback", "https-rollback-all",
    "source-report", "source-export", "source-export-clean",
}
ARTIFACT_RULES = {"patch": (re.compile(r"^deploy/contabo/patches/[a-z0-9][a-z0-9-]{0,62}\.patch$"), "apply")}
MAX_ARTIFACT = 1024 * 1024
MAX_AGE = dt.timedelta(hours=72)
TIMEOUT = 20


class Reject(Exception):
    """A request that must not run. The message is logged (never executed)."""


class NetworkError(Exception):
    """GitHub could not be reached. Nothing is decided: the poll is retried."""


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse_time(value: str) -> dt.datetime:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        raise Reject(f"timestamp not in YYYY-MM-DDTHH:MM:SSZ form")
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def fetch(url: str, *, raw: bool = False, limit: int = 2 * 1024 * 1024) -> bytes:
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json" if not raw else "*/*",
        "User-Agent": "lelu-deploy-agent",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = response.read(limit + 1)
    except urllib.error.HTTPError as error:
        # GitHub being down or rate-limiting is not a verdict on the request:
        # retry on the next poll. Only a definite answer (404 …) rejects.
        if error.code >= 500 or error.code == 429 or (error.code == 403 and error.headers.get("x-ratelimit-remaining") == "0"):
            raise NetworkError(f"GitHub unavailable (HTTP {error.code}) for {url.split('?')[0]}") from None
        raise Reject(f"GitHub answered HTTP {error.code} for {url.split('?')[0]}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        # A network failure is a failed poll, logged and retried next time —
        # never a crash, and never a reason to act.
        raise NetworkError(f"network error reaching {url.split('?')[0]}: {getattr(error, 'reason', error)}") from None
    if len(body) > limit:
        raise Reject(f"response larger than {limit} bytes")
    return body


def api(path: str):
    return json.loads(fetch(API + path).decode("utf-8"))


def quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


# ------------------------------- state ------------------------------------
def load_state() -> dict:
    try:
        with open(os.path.join(STATE_DIR, "processed.json"), encoding="utf-8") as handle:
            state = json.load(handle)
    except FileNotFoundError:
        state = {}
    state.setdefault("commits", [])
    state.setdefault("requests", [])
    return state


def save_state(state: dict) -> None:
    path = os.path.join(STATE_DIR, "processed.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def audit(line: str) -> None:
    stamp = now().strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(os.path.join(STATE_DIR, "audit.log"), "a", encoding="utf-8") as handle:
        handle.write(f"{stamp} {line}\n")
    try:
        subprocess.run(["logger", "-t", "lelu-deploy-agent", line[:900]], check=False, timeout=5)
    except Exception:
        pass


# ---------------------------- verification --------------------------------
def latest_request_commit() -> str | None:
    rows = api(f"/repos/{REPO}/commits?sha={quote(BRANCH)}&path={quote(REQUEST_PATH)}&per_page=1")
    if not isinstance(rows, list) or not rows:
        return None
    sha = rows[0].get("sha", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
        raise Reject("malformed commit id from GitHub")
    return sha


def verify_provenance(sha: str) -> dict:
    commit = api(f"/repos/{REPO}/commits/{sha}")
    verification = (commit.get("commit") or {}).get("verification") or {}
    if verification.get("verified") is not True or verification.get("reason") != "valid":
        raise Reject(f"commit {sha[:12]} is not GitHub-verified (reason: {verification.get('reason')})")
    if (commit.get("committer") or {}).get("login") != "web-flow":
        raise Reject(f"commit {sha[:12]} was not made through github.com (committer is not web-flow)")

    contained = api(f"/repos/{REPO}/compare/{sha}...{quote(BRANCH)}")
    if contained.get("status") not in ("identical", "ahead") or contained.get("behind_by", 1) != 0:
        raise Reject(f"commit {sha[:12]} is not on {BRANCH}")

    pulls = api(f"/repos/{REPO}/commits/{sha}/pulls")
    candidates = [p for p in pulls if isinstance(p, dict) and p.get("merge_commit_sha") == sha]
    if len(candidates) != 1:
        raise Reject(f"commit {sha[:12]} is not the merge commit of exactly one pull request")
    number = candidates[0].get("number")
    if not isinstance(number, int):
        raise Reject("pull request number missing")
    pr = api(f"/repos/{REPO}/pulls/{number}")
    if not pr.get("merged") or pr.get("merge_commit_sha") != sha:
        raise Reject(f"PR #{number} is not merged as {sha[:12]}")
    if (pr.get("base") or {}).get("ref") != BRANCH or ((pr.get("base") or {}).get("repo") or {}).get("full_name") != REPO:
        raise Reject(f"PR #{number} does not target {REPO}:{BRANCH}")
    if ((pr.get("head") or {}).get("repo") or {}).get("full_name") != REPO:
        raise Reject(f"PR #{number} comes from a fork")
    if (pr.get("merged_by") or {}).get("login") != OWNER_LOGIN:
        raise Reject(f"PR #{number} was merged by {(pr.get('merged_by') or {}).get('login')!r}, not the owner")

    merged_at = parse_time(pr.get("merged_at", ""))
    events = api(f"/repos/{REPO}/issues/{number}/events?per_page=100")
    approved = False
    for event in sorted((e for e in events if isinstance(e, dict)), key=lambda e: e.get("created_at", "")):
        if (event.get("label") or {}).get("name") != APPROVAL_LABEL:
            continue
        at = parse_time(event.get("created_at", ""))
        if at > merged_at:
            continue
        if event.get("event") == "labeled":
            approved = (event.get("actor") or {}).get("login") == OWNER_LOGIN
        elif event.get("event") == "unlabeled":
            approved = False
    if not approved:
        raise Reject(f"PR #{number} has no '{APPROVAL_LABEL}' label applied by the owner before the merge")
    return {"pr": number, "commit_time": parse_time(((commit.get("commit") or {}).get("committer") or {}).get("date", ""))}


def load_request(sha: str, commit_time: dt.datetime, state: dict) -> dict:
    try:
        request = json.loads(fetch(f"{RAW}/{REPO}/{sha}/{REQUEST_PATH}", raw=True, limit=16 * 1024).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise Reject("request file is not valid JSON") from None
    if not isinstance(request, dict):
        raise Reject("request is not a JSON object")
    allowed = {"schema", "request_id", "action", "repository", "branch", "not_after", "artifacts", "note"}
    extra = set(request) - allowed
    if extra:
        raise Reject(f"request has unexpected keys: {sorted(extra)}")
    if request.get("schema") != 1:
        raise Reject("request schema must be 1")
    rid = request.get("request_id")
    if not isinstance(rid, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{7,63}", rid):
        raise Reject("request_id must be 8-64 lowercase letters, digits or dashes")
    if rid in state["requests"]:
        raise Reject(f"request_id {rid} was already used (replay)")
    action = request.get("action")
    if not isinstance(action, str) or action not in ACTIONS:
        raise Reject(f"action {str(action)[:40]!r} is not allow-listed")
    if request.get("repository") != REPO or request.get("branch") != BRANCH:
        raise Reject("request names a different repository or branch")
    not_after = parse_time(request.get("not_after", ""))
    if not_after <= now():
        raise Reject("request has expired (not_after is in the past)")
    if not_after - commit_time > MAX_AGE:
        raise Reject("not_after is more than 72 h after the approval commit")
    note = request.get("note", "")
    if not isinstance(note, str) or len(note) > 200:
        raise Reject("note must be a string of at most 200 characters")
    artifacts = request.get("artifacts", {})
    if not isinstance(artifacts, dict):
        raise Reject("artifacts must be an object")
    for kind, spec in artifacts.items():
        rule = ARTIFACT_RULES.get(kind)
        if not rule or rule[1] != action:
            raise Reject(f"artifact {kind!r} is not allowed for action {action}")
        if not isinstance(spec, dict) or set(spec) != {"path", "sha256"}:
            raise Reject(f"artifact {kind!r} must be exactly {{path, sha256}}")
        if not isinstance(spec["path"], str) or not rule[0].fullmatch(spec["path"]):
            raise Reject(f"artifact path {str(spec['path'])[:80]!r} is not allow-listed")
        if not isinstance(spec["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", spec["sha256"]):
            raise Reject("artifact sha256 must be 64 lowercase hex characters")
    if action == "apply" and "patch" not in artifacts:
        raise Reject("apply needs a patch artifact")
    return request


def fetch_artifacts(sha: str, request: dict) -> dict:
    out = {}
    for kind, spec in request.get("artifacts", {}).items():
        body = fetch(f"{RAW}/{REPO}/{sha}/{spec['path']}", raw=True, limit=MAX_ARTIFACT)
        digest = hashlib.sha256(body).hexdigest()
        if digest != spec["sha256"]:
            raise Reject(f"artifact {spec['path']} sha256 {digest[:12]} does not match the approved {spec['sha256'][:12]} (substitution)")
        out[kind] = body
    return out


# --------------------------- console approval ------------------------------
def approval_code(sha: str, request: dict) -> str:
    """8 hex characters binding the commit, the request id, the action and every artifact hash."""
    material = "|".join([sha, request["request_id"], request["action"]] +
                        [f"{k}={v['sha256']}" for k, v in sorted(request.get("artifacts", {}).items())])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:8]


def console_approved(code: str, sha: str, request: dict) -> bool:
    """True only for a root-written, non-writable-by-others file naming this exact commit and request."""
    path = os.path.join(APPROVALS, code)
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    if not _stat.S_ISREG(info.st_mode) or info.st_uid != APPROVER_UID or info.st_mode & 0o022:
        audit(f"IGNORED approval file {code}: not a regular, owner-written, non-group/world-writable file")
        return False
    with open(path, encoding="utf-8") as handle:
        body = handle.read(512)
    lines = set(body.splitlines())
    return f"commit={sha}" in lines and f"request={request['request_id']}" in lines


def write_pending(code: str, sha: str, pr: int, request: dict) -> None:
    pending = {"code": code, "commit": sha, "pr": pr, "request_id": request["request_id"], "action": request["action"],
               "not_after": request["not_after"], "note": request.get("note", ""),
               "artifacts": {k: v["sha256"] for k, v in request.get("artifacts", {}).items()}}
    tmp = os.path.join(STATE_DIR, "pending.json.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(pending, handle)
    os.chmod(tmp, 0o644)  # root's lelu-deploy-approve reads it to show what is being approved
    os.replace(tmp, os.path.join(STATE_DIR, "pending.json"))


# ------------------------------ execution ----------------------------------
def execute(request: dict, artifacts: dict, sha: str, pr: int) -> int:
    action = request["action"]
    if "patch" in artifacts:
        os.makedirs(INCOMING, mode=0o700, exist_ok=True)
        target = os.path.join(INCOMING, "voice-tts-moss.patch")
        tmp = target + ".tmp"
        with open(tmp, "wb") as handle:
            handle.write(artifacts["patch"])
        os.replace(tmp, target)
    report = os.path.join(STATE_DIR, "reports", f"{request['request_id']}.txt")
    os.makedirs(os.path.dirname(report), mode=0o700, exist_ok=True)
    with open(report, "w", encoding="utf-8") as handle:
        handle.write(f"request {request['request_id']} action {action} commit {sha} PR #{pr}\n")
        handle.flush()
        result = subprocess.run(RUNNER + [action], stdout=handle, stderr=subprocess.STDOUT, timeout=1800, check=False)
    return result.returncode


def main() -> int:
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    with open(os.path.join(STATE_DIR, "lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = load_state()
        try:
            sha = latest_request_commit()
        except (Reject, NetworkError) as reason:
            audit(f"POLL-FAILED {reason}")
            return 0
        if not sha or sha in state["commits"]:
            return 0  # nothing new
        try:
            provenance = verify_provenance(sha)
            request = load_request(sha, provenance["commit_time"], state)
            artifacts = fetch_artifacts(sha, request)
        except NetworkError as reason:
            # Not a verdict on the request: decide again on the next poll.
            audit(f"POLL-FAILED commit={sha[:12]} {reason}")
            return 0
        except Reject as reason:
            state["commits"].append(sha)
            save_state(state)
            audit(f"REJECTED commit={sha[:12]} reason={reason}")
            return 0
        code = approval_code(sha, request)
        if not console_approved(code, sha, request):
            first = state.get("pending") != sha
            state["pending"] = sha
            save_state(state)
            write_pending(code, sha, provenance["pr"], request)
            if first:
                audit(f"AWAITING-CONSOLE-APPROVAL commit={sha[:12]} pr=#{provenance['pr']} request={request['request_id']} "
                      f"action={request['action']} code={code} (owner types: lelu-deploy-approve {code})")
            return 0
        state.pop("pending", None)
        try:
            os.remove(os.path.join(STATE_DIR, "pending.json"))
        except FileNotFoundError:
            pass
        # At most once: record BEFORE executing.
        state["commits"].append(sha)
        state["requests"].append(request["request_id"])
        save_state(state)
        listed = ",".join(kind + ":" + spec["sha256"][:12] for kind, spec in request.get("artifacts", {}).items()) or "none"
        audit(f"ACCEPTED commit={sha[:12]} pr=#{provenance['pr']} request={request['request_id']} action={request['action']} artifacts={listed}")
        code = execute(request, artifacts, sha, provenance["pr"])
        audit(f"FINISHED request={request['request_id']} action={request['action']} exit={code} report=reports/{request['request_id']}.txt")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BlockingIOError:
        sys.exit(0)  # another poll is running
