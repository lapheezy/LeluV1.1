#!/usr/bin/env bash
# ==========================================================
# LÉLU — production source recovery (root, pinned; run via the deploy wrapper).
#
#   source-report        read-only: production commit identity, commits GitHub
#                        lacks, uncommitted drift, secret scan — names only
#   source-export        bundle of ONLY the production-only commits plus a
#                        snapshot of the uncommitted drift, refused if the scan
#                        finds a credential or a forbidden file; written under
#                        dist/ behind LÉLU's password gate, at an unguessable path
#   source-export-clean  remove every export
#
# Never exported: untracked files, .env*, keys, certificates, backups, database
# files, lelu.env (outside the repository anyway). Nothing here changes HEAD,
# the branch, the working tree or the index; the only repository writes are
# remote-tracking refs (git fetch) and one temporary ref, deleted again.
# ==========================================================
set -uo pipefail
APP=/opt/lelu/app
EXPORT_ROOT=$APP/dist/ops-export
TMP_REF=refs/lelu-export/drift
FAILED=0
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILED=1; }; info() { echo "INFO  $*"; }
g() { runuser -u lelu -- git -C "$APP" "$@"; }

FORBIDDEN_NAMES='(^|/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_(rsa|ed25519|ecdsa)(\.pub)?|.*\.sqlite3?|.*\.db|.*\.dump|.*\.tar(\.(gz|zst))?|lelu\.env.*|backups?/.*)$'
SECRET_RE='(sk-ant-[A-Za-z0-9_-]{10,}|gsk_[A-Za-z0-9]{20,}|sk-or-v1-[a-f0-9]{20,}|sk-[A-Za-z0-9]{32,}|sb_secret_[A-Za-z0-9_-]{10,}|sbp_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})'

refresh() { g fetch -q origin 2>/dev/null && ok "fetched GitHub's branches (read-only for production)" || info "could not fetch from GitHub; comparing with the refs already known"; }

# Production-only commits = reachable from HEAD, not from anything GitHub has.
range_list() { g rev-list HEAD --not --remotes=origin; }

scan() {  # $1 = label; stdin = text to scan → prints findings (kind + file), returns 1 if any
  python3 -I -c '
import re, sys
pat = re.compile(sys.argv[1]); label = sys.argv[2]; current = "?"; hits = {}
for line in sys.stdin:
    if line.startswith("+++ b/"): current = line[6:].strip(); continue
    if not line.startswith("+") or line.startswith("+++"): continue
    for m in pat.finditer(line):
        # The KIND only — never any character of the matched value.
        v = m.group(0)
        kind = next((name for prefix, name in (
            ("sk-ant-", "Anthropic key"), ("gsk_", "Groq key"), ("sk-or-v1-", "OpenRouter key"), ("sk-", "OpenAI-style key"),
            ("sb_secret_", "Supabase secret key"), ("sbp_", "Supabase access token"), ("ghp_", "GitHub token"),
            ("github_pat_", "GitHub token"), ("xox", "Slack token"), ("AKIA", "AWS access key"), ("AIza", "Google API key"),
            ("-----BEGIN", "private key block"), ("eyJ", "JWT")) if v.startswith(prefix)), "credential")
        hits.setdefault((current, kind), 0); hits[(current, kind)] += 1
for (f, k), n in sorted(hits.items()):
    print(f"FAIL  {label}: {k} ({n}×) added in {f} — value not shown")
sys.exit(1 if hits else 0)
' "$SECRET_RE" "$1"
}

report() {
  [ -d "$APP/.git" ] || { bad "$APP is not a git checkout"; return; }
  # Every later answer depends on reading the repository as lelu; an
  # unreadable repository must never read as "nothing production-only".
  g rev-parse --verify -q HEAD >/dev/null 2>&1 || { bad "cannot read $APP as the lelu user — nothing can be reported or exported"; return; }
  echo "== production identity"
  info "HEAD $(g rev-parse HEAD) on $(g rev-parse --abbrev-ref HEAD)"
  info "HEAD subject: $(g log -1 --format=%s | cut -c1-100)"
  refresh
  echo "== commits GitHub does not have"
  local list n
  list=$(range_list) || { bad "could not list production-only commits"; return; }
  n=$(printf '%s' "$list" | grep -c . || true)
  info "$n production-only commit(s)"
  g log --format='INFO    %h %ad %s' --date=short HEAD --not --remotes=origin | head -40 | cut -c1-140
  local base; base=$(g merge-base HEAD origin/integration/lelu-four-workforce-consolidation 2>/dev/null)
  [ -n "$base" ] && info "merge-base with integration: $(g log -1 --format='%h %ad %s' --date=short "$base" | cut -c1-110)" || info "no common ancestor with integration found"
  [ -n "$base" ] && info "integration is $(g rev-list --count "$base..origin/integration/lelu-four-workforce-consolidation") commit(s) ahead of that point"
  echo "== files production changed that GitHub does not have"
  if [ "$n" -gt 0 ]; then
    g diff --stat=120 "$(range_list | tail -1)^" HEAD 2>/dev/null | tail -25 | sed 's/^/INFO    /'
  fi
  echo "== uncommitted drift"
  info "modified tracked: $(g diff --name-only | wc -l), staged: $(g diff --cached --name-only | wc -l), untracked (never exported): $(g ls-files --others --exclude-standard | wc -l)"
  g diff --name-only | head -30 | sed 's/^/INFO    modified: /'
  g ls-files --others --exclude-standard | head -30 | sed 's/^/INFO    untracked: /'
  echo "== export safety"
  local names; names=$( { [ "$n" -gt 0 ] && g diff --name-only "$(range_list | tail -1)^" HEAD; g diff --name-only HEAD; } 2>/dev/null | sort -u)
  local bad_names; bad_names=$(printf '%s\n' "$names" | grep -E "$FORBIDDEN_NAMES" || true)
  [ -z "$bad_names" ] && ok "no forbidden file names (.env, keys, certificates, backups, databases)" || { printf '%s\n' "$bad_names" | sed 's/^/FAIL  forbidden file in the export range: /'; FAILED=1; }
  { [ "$n" -gt 0 ] && g log -p --format= HEAD --not --remotes=origin; g diff HEAD; } 2>/dev/null | scan "secret scan" && ok "no credential-shaped text in production-only changes" || FAILED=1
}

export_bundle() {
  report
  [ $FAILED = 0 ] || { bad "export refused: resolve the findings above first — nothing exported"; return; }
  echo "== export"
  local n; n=$(range_list | wc -l)
  local drift=""; drift=$(g stash create "lelu production drift $(date -u +%FT%TZ)" 2>/dev/null)   # a commit object; working tree untouched
  [ -n "$drift" ] && g update-ref "$TMP_REF" "$drift"
  if [ "$n" = 0 ] && [ -z "$drift" ]; then ok "production has nothing GitHub lacks — no export needed"; return; fi
  local dir; dir="$EXPORT_ROOT/$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  install -d -o lelu -g lelu -m 0755 "$EXPORT_ROOT" "$dir"
  local name; name="lelu-production-$(g rev-parse --short=12 HEAD).bundle"
  local refs=(HEAD); [ -n "$drift" ] && refs+=("$TMP_REF")
  if g bundle create "$dir/$name" "${refs[@]}" --not --remotes=origin >/dev/null 2>&1; then
    g update-ref -d "$TMP_REF" 2>/dev/null
    chown lelu:lelu "$dir/$name"; chmod 0644 "$dir/$name"
    g bundle verify "$dir/$name" >/dev/null 2>&1 && ok "bundle verifies against GitHub's history (prerequisites present)" || info "bundle needs commits this checkout does not know as GitHub's — it still verifies on import"
    local sum; sum=$(sha256sum "$dir/$name" | cut -c1-64)
    echo "$sum  $name" > "$dir/$name.sha256"
    ok "exported $n commit(s)$([ -n "$drift" ] && echo " + uncommitted drift") → $(du -h "$dir/$name" | cut -f1)"
    info "sha256 $sum"
    info "production commit $(g rev-parse HEAD)"
    info "download (signed in to LÉLU): http://157.173.116.95/ops-export/$(basename "$dir")/$name"
  else
    g update-ref -d "$TMP_REF" 2>/dev/null
    bad "git bundle failed — nothing exported"
  fi
}

clean() {
  if [ -d "$EXPORT_ROOT" ]; then rm -rf "$EXPORT_ROOT" && ok "removed every export under dist/ops-export"; else ok "no export present"; fi
}

case "${1:-}" in
  source-report) report;;
  source-export) export_bundle;;
  source-export-clean) clean;;
  *) echo "usage: $0 source-report | source-export | source-export-clean"; exit 2;;
esac
exit $FAILED
