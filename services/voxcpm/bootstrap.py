#!/usr/bin/env python3
"""
==========================================================
LÉLU — VOXCPM2 WEIGHTS BOOTSTRAP (resumable by design)
==========================================================

A cloud runner can disappear in the middle of a 5 GB download. Hugging
Face stores partial files as `*.incomplete` in an ETag-keyed cache, so the
next run continues from the last complete chunk instead of starting over —
but only if nothing in between decides that a half-written tree is "done".

This file is what makes that decision correctly:

  1. DISK  — refuse to start a download that cannot fit, instead of
             filling the disk and leaving a corrupt cache behind.
  2. FETCH — `snapshot_download`, which resumes from the existing cache;
             retried with exponential backoff on transient network errors.
  3. CHECK — every manifest file must exist at its exact expected size.
             A file that is not the right size is not the model, and is
             removed so the next attempt re-fetches just that file.
  4. MARK  — `.voxcpm/state/model-ready.json` is written atomically
             (temp file + rename), so a crash leaves either the old marker
             or the new one, never half a marker claiming success.

`--check` answers "do we already have the weights?" without touching the
network — which is what the sidecar and the deployment kits ask first.

    python services/voxcpm/bootstrap.py --check
    python services/voxcpm/bootstrap.py
    python services/voxcpm/bootstrap.py --verify-only

Exit codes: 0 ready · 1 not ready · 2 refused (disk) · 3 fetch failed.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = ROOT / ".voxcpm" / "state"
MANIFEST_PATH = STATE_DIR / "model-manifest.json"
READY_PATH = STATE_DIR / "model-ready.json"
PROGRESS_PATH = STATE_DIR / "model-progress.json"

REPO_ID = os.environ.get("VOXCPM_MODEL_ID", "openbmb/VoxCPM2")
# VoxCPM2 weights + tokenizer + config; the repo is ~5 GB, so twice that is
# the honest floor before unpacking anything next to it.
MIN_FREE_BYTES = int(float(os.environ.get("VOXCPM_MIN_FREE_GB", "12")) * 1e9)
MAX_ATTEMPTS = int(os.environ.get("VOXCPM_DOWNLOAD_ATTEMPTS", "5"))


def _write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _read_json(path: Path) -> "dict | None":
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def free_bytes() -> int:
    return shutil.disk_usage(ROOT).free


def remote_manifest() -> dict:
    """The files this model is made of, with the sizes we should end up with."""
    from huggingface_hub import HfApi

    info = HfApi().model_info(REPO_ID, files_metadata=True)
    files = []
    for sibling in info.siblings or []:
        files.append(
            {
                "path": sibling.rfilename,
                "size": int(sibling.size or 0),
                "sha256": getattr(getattr(sibling, "lfs", None), "sha256", None),
            }
        )
    manifest = {
        "repoId": REPO_ID,
        "revision": getattr(info, "sha", None),
        "fetchedAt": int(time.time()),
        "totalBytes": sum(f["size"] for f in files),
        "files": files,
    }
    _write_atomic(MANIFEST_PATH, manifest)
    return manifest


def verify(snapshot_dir: Path, manifest: dict, repair: bool) -> dict:
    """Check every file against the manifest; a wrong size is not the model."""
    missing: list[str] = []
    wrong_size: list[str] = []
    for entry in manifest["files"]:
        target = snapshot_dir / entry["path"]
        expected = entry["size"]
        if not target.exists():
            missing.append(entry["path"])
            continue
        actual = target.stat().st_size
        # Hugging Face reports LFS sizes; a 0-byte expectation means "unknown"
        # and only existence is checked for it.
        if expected and actual != expected:
            wrong_size.append(f"{entry['path']} ({actual} != {expected})")
            if repair:
                target.unlink(missing_ok=True)
    return {
        "snapshotDir": str(snapshot_dir),
        "missing": missing,
        "wrongSize": wrong_size,
        "complete": not missing and not wrong_size,
        "totalBytes": manifest["totalBytes"],
    }


def ready_state() -> "dict | None":
    """The last atomic marker, re-validated cheaply against the filesystem."""
    marker = _read_json(READY_PATH)
    manifest = _read_json(MANIFEST_PATH)
    if not marker or not manifest:
        return None
    if marker.get("repoId") != REPO_ID:
        return None
    snapshot_dir = Path(marker.get("snapshotDir", ""))
    if not snapshot_dir.exists():
        return None
    report = verify(snapshot_dir, manifest, repair=False)
    if not report["complete"]:
        return None
    return {**marker, "verifiedAt": int(time.time()), "files": len(manifest["files"])}


def fetch() -> dict:
    from huggingface_hub import snapshot_download

    available = free_bytes()
    if available < MIN_FREE_BYTES:
        raise SystemExit(
            json.dumps(
                {
                    "ok": False,
                    "error": "not enough disk for the weights",
                    "freeGb": round(available / 1e9, 2),
                    "requiredGb": round(MIN_FREE_BYTES / 1e9, 2),
                }
            )
        )
    last_error = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            # `snapshot_download` reuses the cache: completed files are not
            # fetched again, `*.incomplete` files continue from their last
            # chunk, and a finished tree is a no-op.
            return {"snapshotDir": snapshot_download(repo_id=REPO_ID), "attempts": attempt}
        except Exception as exc:  # network hiccups, 5xx, rate limits
            last_error = f"{type(exc).__name__}: {exc}"
            wait = min(60, 2 ** attempt)
            sys.stderr.write(json.dumps({"event": "download_retry", "attempt": attempt, "waitSeconds": wait, "error": last_error}) + "\n")
            time.sleep(wait)
    raise SystemExit(json.dumps({"ok": False, "error": "download failed after retries", "detail": last_error}))


def main() -> int:
    parser = argparse.ArgumentParser(description="Acquire VoxCPM2 weights, resumably")
    parser.add_argument("--check", action="store_true", help="report state, never touch the network")
    parser.add_argument("--verify-only", action="store_true", help="verify existing snapshot, no download")
    parser.add_argument("--force", action="store_true", help="re-fetch the manifest even if a marker exists")
    args = parser.parse_args()

    if args.check:
        state = ready_state()
        print(json.dumps({"ok": state is not None, "ready": state, "stateDir": str(STATE_DIR)}, indent=2))
        return 0 if state else 1

    if not args.force:
        state = ready_state()
        if state is not None and not args.verify_only:
            print(json.dumps({"ok": True, "reused": True, **state}, indent=2))
            return 0

    manifest = _read_json(MANIFEST_PATH) or remote_manifest()
    if args.verify_only:
        marker = _read_json(READY_PATH)
        if not marker:
            print(json.dumps({"ok": False, "error": "nothing downloaded yet"}, indent=2))
            return 1
        report = verify(Path(marker["snapshotDir"]), manifest, repair=False)
        print(json.dumps({"ok": report["complete"], "report": report}, indent=2))
        return 0 if report["complete"] else 1

    sys.stderr.write(json.dumps({"event": "download_start", "repo": REPO_ID, "files": len(manifest["files"]), "totalGb": round(manifest["totalBytes"] / 1e9, 2), "freeGb": round(free_bytes() / 1e9, 2)}) + "\n")
    result = fetch()
    snapshot_dir = Path(result["snapshotDir"])
    report = verify(snapshot_dir, manifest, repair=True)
    _write_atomic(
        PROGRESS_PATH,
        {
            "repoId": REPO_ID,
            "snapshotDir": str(snapshot_dir),
            "complete": report["complete"],
            "missingCount": len(report["missing"]),
            "wrongSizeCount": len(report["wrongSize"]),
            "updatedAt": int(time.time()),
        },
    )
    if not report["complete"]:
        # A wrong size was deleted above; the next invocation re-fetches only
        # those files. This run refuses to bless the tree.
        print(json.dumps({"ok": False, "error": "snapshot incomplete after download", "report": report}, indent=2))
        return 3

    marker = {
        "ok": True,
        "repoId": REPO_ID,
        "revision": manifest.get("revision"),
        "snapshotDir": str(snapshot_dir),
        "files": len(manifest["files"]),
        "totalBytes": manifest["totalBytes"],
        "completedAt": int(time.time()),
        "attempts": result["attempts"],
    }
    _write_atomic(READY_PATH, marker)
    print(json.dumps(marker, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
