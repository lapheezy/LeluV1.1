#!/usr/bin/env python3
"""
==========================================================
LÉLU — VOXCPM2 WORKER MANAGER (single instance, owned, measured)
==========================================================
Starts, watches and stops exactly one VoxCPM2 sidecar (`server.py`) and
never touches a process it cannot prove it started.

Why this exists: an earlier session loaded the model inside an interactive
turn, on a shared machine, with no memory check, and found out about the
cost only when the platform killed the turn. Loading this model on CPU was
then measured (see WORKER-RESOURCE-RECOVERY-REPORT.md): ~10.9 GiB peak,
~6.3 GiB resident, ~18 s. This file turns those numbers into rules.

    python services/voxcpm/workerctl.py preflight
    python services/voxcpm/workerctl.py start [--wait] [--timeout 600]
    python services/voxcpm/workerctl.py status
    python services/voxcpm/workerctl.py speak --text "Hello." [--out f.wav]
    python services/voxcpm/workerctl.py stop
    python services/voxcpm/workerctl.py restart [--wait]

Stdlib only; it never imports torch, so it is cheap to run from any shell.

OWNERSHIP
---------
`start` launches a *supervisor* (`workerctl.py _supervise`) in a new
session (setsid), and the supervisor launches `server.py` as its child.
`.voxcpm/run/worker.pid` records both PIDs with their kernel start times
(/proc/<pid>/stat field 22) and a random launch id. A PID is only ever
signalled after all of these match:

  · the process exists,
  · its start time equals the recorded one (so a recycled PID never matches),
  · its command line carries this launch id (supervisor) or is `server.py`
    whose parent is the verified supervisor (worker).

There is no `pkill`, no pattern matching over other processes, and no
signal to anything else. A record that fails verification is *stale*: it is
reported and removed, and the process it named is left alone.

LIFECYCLE
---------
    STOPPED → STARTING → LOADING → INITIALIZING → READY
                  └──────────┴───────────┴──────→ FAILED

STARTING/LOADING/INITIALIZING/READY/FAILED are written by the worker itself
(`VOXCPM_STATE_FILE`). READY means a real generation produced non-silent
audio. The supervisor adds the terminal record: exit code, signal, and a
failure class, in `.voxcpm/run/worker.exit.json`.

FAILURE CLASSES
---------------
insufficient_memory · weights_missing · port_in_use · already_running ·
startup_timeout · load_error · selftest_failed · oom_killed ·
killed_externally · crashed · stopped (clean, on request)
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RUN = Path(os.environ.get("VOXCPM_RUN_DIR", str(ROOT / ".voxcpm" / "run")))
PID_FILE = RUN / "worker.pid"
STATE_FILE = RUN / "worker.state.json"
EXIT_FILE = RUN / "worker.exit.json"
LOCK_FILE = RUN / "worker.lock"
WORKER_LOG = RUN / "worker.log"
SUPERVISOR_LOG = RUN / "supervisor.log"
READY_MARKER = Path(os.environ.get("VOXCPM_READY_MARKER", str(ROOT / ".voxcpm" / "state" / "model-ready.json")))
VENV_PY = Path(os.environ.get("VOXCPM_PYTHON", str(ROOT / ".venv-voxcpm" / "bin" / "python")))
# The speech worker this manager supervises. Default VoxCPM2; the MOSS-TTS-Nano
# candidate speaks the same contract (services/mossnano/server.py).
SERVER = Path(os.environ.get("VOXCPM_SERVER", str(HERE / "server.py")))

HOST = os.environ.get("VOXCPM_HOST", "127.0.0.1")
PORT = int(os.environ.get("VOXCPM_PORT", "8788"))
# Measured on CPU: peak 10.85-11.15 GiB during load. 11.5 GiB was not enough
# margin: with 12.1 GiB available and other services running, a load was
# OOM-killed (2026-11-13). Require 12.5 GiB for VoxCPM2.
REQUIRED_GIB = float(os.environ.get("VOXCPM_REQUIRED_GIB", "12.5"))
STARTUP_TIMEOUT = float(os.environ.get("VOXCPM_STARTUP_TIMEOUT", "600"))
STOP_GRACE = float(os.environ.get("VOXCPM_STOP_GRACE", "30"))

TERMINAL = {"READY", "FAILED", "STOPPED"}


# ---------------------------------------------------------------- utils


def _now() -> float:
    return round(time.time(), 3)


def _read_json(path: Path) -> "dict | None":
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2))
    temporary.replace(path)


def _log(event: str, **fields) -> None:
    line = json.dumps({"at": _now(), "event": event, **fields})
    RUN.mkdir(parents=True, exist_ok=True)
    with SUPERVISOR_LOG.open("a") as handle:
        handle.write(line + "\n")


def _meminfo() -> dict:
    values = {}
    with open("/proc/meminfo", encoding="utf-8") as handle:
        for line in handle:
            key, rest = line.split(":", 1)
            values[key] = int(rest.split()[0]) / 1048576  # KiB → GiB
    return values


def _cgroup_headroom_gib() -> "float | None":
    """Memory left under a cgroup limit, if one is actually set."""
    for limit_path, usage_path in (
        ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
        ("/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"),
    ):
        try:
            raw = Path(limit_path).read_text().strip()
            usage = int(Path(usage_path).read_text().strip())
        except (OSError, ValueError):
            continue
        if raw == "max" or int(raw) >= 1 << 62:
            return None  # unlimited
        return (int(raw) - usage) / 2**30
    return None


def _oom_kills() -> "int | None":
    try:
        for line in Path("/proc/vmstat").read_text().splitlines():
            if line.startswith("oom_kill "):
                return int(line.split()[1])
    except OSError:
        pass
    return None


def _start_time(pid: int) -> "int | None":
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return None
    # comm may contain spaces/parens; fields resume after the LAST ')'.
    fields = raw[raw.rindex(")") + 2 :].split()
    return int(fields[19])  # field 22 overall; 3rd field is index 0 here


def _ppid(pid: int) -> "int | None":
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return None
    return int(raw[raw.rindex(")") + 2 :].split()[1])


def _cmdline(pid: int) -> "list[str]":
    try:
        return [part for part in Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace").split("\0") if part]
    except OSError:
        return []


def _is_zombie_or_gone(pid: int) -> bool:
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return True
    return raw[raw.rindex(")") + 2 :].split()[0] in ("Z", "X")


def _port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError:
            return False
    return True


def _http(method: str, path: str, body: "dict | None" = None, timeout: float = 5.0) -> "tuple[int, bytes, dict]":
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"http://{HOST}:{PORT}{path}", data=data, method=method)
    request.add_header("Content-Type", "application/json")
    token = os.environ.get("VOXCPM_TOKEN", "")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers or {})


class _Lock:
    """Serialises start/stop across shells so two starts cannot race."""

    def __enter__(self):
        RUN.mkdir(parents=True, exist_ok=True)
        self.handle = LOCK_FILE.open("w")
        fcntl.flock(self.handle, fcntl.LOCK_EX)
        return self

    def __exit__(self, *_exc):
        fcntl.flock(self.handle, fcntl.LOCK_UN)
        self.handle.close()


# ------------------------------------------------------------ ownership


def verify(record: "dict | None") -> dict:
    """Is the recorded worker the process we started? Never guesses."""
    if not record:
        return {"owned": False, "reason": "no pid file"}
    sup, wrk = record.get("supervisorPid"), record.get("workerPid")
    if not sup or _is_zombie_or_gone(sup):
        return {"owned": False, "reason": f"supervisor {sup} not running", "stale": True}
    if _start_time(sup) != record.get("supervisorStart"):
        return {"owned": False, "reason": f"pid {sup} was recycled (start time differs)", "stale": True}
    if record.get("launchId") not in _cmdline(sup):
        return {"owned": False, "reason": f"pid {sup} does not carry our launch id", "stale": True}
    out = {"owned": True, "supervisorPid": sup, "workerPid": None}
    if wrk and not _is_zombie_or_gone(wrk):
        same = _start_time(wrk) == record.get("workerStart")
        ours = _ppid(wrk) == sup and any(part.endswith("server.py") for part in _cmdline(wrk))
        if same and ours:
            out["workerPid"] = wrk
    return out


# ----------------------------------------------------------- preflight


def preflight(quiet: bool = False) -> dict:
    mem = _meminfo()
    available = round(mem.get("MemAvailable", 0.0), 2)
    cgroup = _cgroup_headroom_gib()
    effective = min(available, cgroup) if cgroup is not None else available
    checks = {
        "python": {"ok": VENV_PY.exists(), "path": str(VENV_PY)},
        "weights": {"ok": READY_MARKER.exists(), "marker": str(READY_MARKER)},
        "memory": {
            "ok": effective >= REQUIRED_GIB,
            "availableGiB": available,
            "cgroupHeadroomGiB": None if cgroup is None else round(cgroup, 2),
            "requiredGiB": REQUIRED_GIB,
            "totalGiB": round(mem.get("MemTotal", 0.0), 2),
            "swapGiB": round(mem.get("SwapTotal", 0.0), 2),
        },
        "port": {"ok": _port_free(HOST, PORT), "host": HOST, "port": PORT},
        "cpus": os.cpu_count(),
    }
    failure = None
    if not checks["python"]["ok"]:
        failure = "python_env_missing"
    elif not checks["weights"]["ok"]:
        failure = "weights_missing"
    elif not checks["memory"]["ok"]:
        failure = "insufficient_memory"
    elif not checks["port"]["ok"]:
        failure = "port_in_use"
    result = {"ok": failure is None, "failure": failure, "checks": checks}
    if not quiet:
        print(json.dumps(result, indent=2))
    return result


# ----------------------------------------------------------- supervisor


def supervise(launch_id: str) -> int:
    """Runs in its own session. Owns exactly one server.py child."""
    env = dict(os.environ)
    env["VOXCPM_STATE_FILE"] = str(STATE_FILE)
    env["VOXCPM_WARMUP"] = "1"
    env["VOXCPM_LAUNCH_ID"] = launch_id
    env.setdefault("HF_HUB_OFFLINE", "1")  # a worker never downloads
    oom_before = _oom_kills()
    started = time.time()
    with WORKER_LOG.open("a") as log:
        child = subprocess.Popen(
            [str(VENV_PY), str(SERVER), "--host", HOST, "--port", str(PORT), "--warmup"],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            env=env,
            cwd=str(ROOT),
        )
    # `start` writes the record after Popen returns; wait for OUR record.
    for _ in range(100):
        record = _read_json(PID_FILE) or {}
        if record.get("launchId") == launch_id:
            break
        time.sleep(0.1)
    else:
        _log("pid_record_missing", launchId=launch_id)
        child.send_signal(signal.SIGTERM)
        child.wait()
        return 1
    record.update({"workerPid": child.pid, "workerStart": _start_time(child.pid)})
    _write_json(PID_FILE, record)
    _log("worker_spawned", launchId=launch_id, workerPid=child.pid)

    requested = {"stop": False}
    timed_out = False

    def _on_term(signum, _frame) -> None:
        requested["stop"] = True
        _log("stop_requested", signal=signum)
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)

    signal.signal(signal.SIGTERM, _on_term)
    signal.signal(signal.SIGINT, _on_term)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)  # survive the launching shell

    term_sent_at = None
    reached_ready = False
    while child.poll() is None:
        state = (_read_json(STATE_FILE) or {}).get("state")
        reached_ready = reached_ready or state == "READY"
        # The watchdog guards STARTUP only: once READY was seen, or a stop was
        # asked for (the worker then reports STOPPED while it shuts down), a
        # long uptime is not a startup that never finished.
        if (
            not reached_ready
            and not requested["stop"]
            and state not in ("READY", "FAILED", "STOPPED")
            and not timed_out
            and time.time() - started > STARTUP_TIMEOUT
        ):
            timed_out = True
            _log("startup_timeout", seconds=STARTUP_TIMEOUT, lastState=state)
            child.send_signal(signal.SIGTERM)
            term_sent_at = time.time()
        if requested["stop"] and term_sent_at is None:
            term_sent_at = time.time()
        if term_sent_at and time.time() - term_sent_at > STOP_GRACE and child.poll() is None:
            _log("escalate_sigkill", workerPid=child.pid)
            child.kill()
        time.sleep(0.5)

    code = child.returncode
    last = _read_json(STATE_FILE) or {}
    oom_after = _oom_kills()
    killed = code is not None and code < 0
    sig = -code if killed else None
    if requested["stop"] and not timed_out:
        classification = "stopped"
    elif timed_out:
        classification = "startup_timeout"
    elif sig == signal.SIGKILL and oom_before is not None and oom_after is not None and oom_after > oom_before:
        classification = "oom_killed"
    elif sig is not None:
        classification = "killed_externally"
    elif code == 98:
        classification = "port_in_use"
    elif last.get("state") == "FAILED" and str(last.get("error", "")).startswith("selftest"):
        classification = "selftest_failed"
    elif last.get("state") == "FAILED":
        classification = "load_error"
    elif code == 0:
        classification = "stopped"
    else:
        classification = "crashed"
    final_state = "STOPPED" if classification == "stopped" else "FAILED"
    exit_record = {
        "at": _now(),
        "launchId": launch_id,
        "workerPid": child.pid,
        "returncode": code,
        "signal": sig,
        "classification": classification,
        "finalState": final_state,
        "lastWorkerState": last.get("state"),
        "lastWorkerError": last.get("error"),
        "lastMemory": last.get("memory"),
        "uptimeSeconds": round(time.time() - started, 1),
        "oomKillsDuringRun": None if oom_before is None or oom_after is None else oom_after - oom_before,
    }
    _write_json(EXIT_FILE, exit_record)
    if last.get("state") != final_state:
        last.update({"state": final_state, "error": last.get("error") if final_state == "FAILED" else None, "since": _now()})
        _write_json(STATE_FILE, last)
    _log("worker_exited", **exit_record)
    try:
        if (_read_json(PID_FILE) or {}).get("launchId") == launch_id:
            PID_FILE.unlink()
    except OSError:
        pass
    return 0


# ------------------------------------------------------------- commands


def status(quiet: bool = False) -> dict:
    record = _read_json(PID_FILE)
    ownership = verify(record)
    health = None
    try:
        code, body, _ = _http("GET", "/health", timeout=3)
        health = json.loads(body) if code == 200 else {"httpStatus": code}
    except (OSError, ValueError) as exc:
        health = {"reachable": False, "error": type(exc).__name__}
    state_record = _read_json(STATE_FILE) or {}
    state = state_record.get("state", "STOPPED") if ownership["owned"] else (
        "FAILED" if (_read_json(EXIT_FILE) or {}).get("finalState") == "FAILED" else "STOPPED"
    )
    if ownership["owned"] and isinstance(health, dict) and health.get("state"):
        state = health["state"]
    result = {
        "state": state,
        "ready": state == "READY" and bool(isinstance(health, dict) and health.get("ready")),
        "ownership": ownership,
        "pidFile": record,
        "worker": {k: state_record.get(k) for k in ("state", "error", "phases", "loadSeconds", "selftest", "memory")},
        "health": {k: health.get(k) for k in ("state", "ready", "memory", "loadSeconds", "sampleRate", "generated", "last", "reachable", "error", "httpStatus") if k in health} if isinstance(health, dict) else health,
        "lastExit": _read_json(EXIT_FILE),
    }
    if not quiet:
        print(json.dumps(result, indent=2))
    return result


def start(wait: bool, timeout: float) -> int:
    with _Lock():
        record = _read_json(PID_FILE)
        ownership = verify(record)
        if ownership["owned"]:
            print(json.dumps({"ok": False, "failure": "already_running", "ownership": ownership}))
            return 3
        if record is not None:
            _log("stale_pid_file", record=record, reason=ownership.get("reason"))
            PID_FILE.unlink(missing_ok=True)
        check = preflight(quiet=True)
        if not check["ok"]:
            _log("preflight_refused", **check)
            print(json.dumps(check, indent=2))
            return 2
        launch_id = secrets.token_hex(8)
        STATE_FILE.unlink(missing_ok=True)
        proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "_supervise", "--launch-id", launch_id],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=open(SUPERVISOR_LOG, "a"),
            start_new_session=True,  # setsid: own session + process group
            cwd=str(ROOT),
            close_fds=True,
        )
        record = {
            "launchId": launch_id,
            "supervisorPid": proc.pid,
            "supervisorStart": _start_time(proc.pid),
            "pgid": proc.pid,
            "host": HOST,
            "port": PORT,
            "startedAt": _now(),
            "preflight": check["checks"]["memory"],
        }
        _write_json(PID_FILE, record)
        _log("started", **record)
        print(json.dumps({"ok": True, "launchId": launch_id, "supervisorPid": proc.pid}))
    if not wait:
        return 0
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        current = (_read_json(STATE_FILE) or {}).get("state")
        if current != last:
            print(json.dumps({"at": _now(), "state": current}), flush=True)
            last = current
        if current in ("READY", "FAILED"):
            break
        if not verify(_read_json(PID_FILE))["owned"] and EXIT_FILE.exists():
            break
        time.sleep(1)
    result = status(quiet=True)
    print(json.dumps({"state": result["state"], "ready": result["ready"], "worker": result["worker"], "lastExit": result["lastExit"] if not result["ownership"]["owned"] else None}, indent=2))
    return 0 if result["ready"] else 1


def stop() -> int:
    with _Lock():
        record = _read_json(PID_FILE)
        ownership = verify(record)
        if not ownership["owned"]:
            if record is not None:
                _log("stale_pid_file", record=record, reason=ownership.get("reason"))
                PID_FILE.unlink(missing_ok=True)
            print(json.dumps({"ok": True, "note": "not running", "reason": ownership.get("reason")}))
            return 0
        sup = ownership["supervisorPid"]
        os.kill(sup, signal.SIGTERM)  # supervisor forwards SIGTERM to its child
        deadline = time.time() + STOP_GRACE + 10
        while time.time() < deadline and not _is_zombie_or_gone(sup):
            time.sleep(0.25)
        if not _is_zombie_or_gone(sup) and verify(record)["owned"]:
            _log("stop_escalate_killpg", pgid=record["pgid"])
            os.killpg(record["pgid"], signal.SIGKILL)  # only our verified group
        print(json.dumps({"ok": True, "lastExit": _read_json(EXIT_FILE)}, indent=2))
        return 0


def speak(text: str, out: "str | None") -> int:
    started = time.time()
    code, body, headers = _http("POST", "/v1/audio/speech", {"input": text, "response_format": "wav"}, timeout=600)
    if code != 200:
        print(json.dumps({"ok": False, "httpStatus": code, "body": body[:400].decode(errors="replace")}))
        return 1
    target = Path(out) if out else RUN / "last-speech.wav"
    target.write_bytes(body)
    meta = {k: v for k, v in headers.items() if k.lower().startswith("x-")}
    print(json.dumps({"ok": True, "bytes": len(body), "out": str(target), "wallMs": int((time.time() - started) * 1000), "headers": meta}, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[3])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("preflight")
    sub.add_parser("status")
    sub.add_parser("stop")
    for name in ("start", "restart"):
        p = sub.add_parser(name)
        p.add_argument("--wait", action="store_true")
        p.add_argument("--timeout", type=float, default=STARTUP_TIMEOUT)
    p = sub.add_parser("speak")
    p.add_argument("--text", required=True)
    p.add_argument("--out")
    p = sub.add_parser("_supervise")
    p.add_argument("--launch-id", required=True)
    args = parser.parse_args()

    if args.command == "preflight":
        return 0 if preflight()["ok"] else 2
    if args.command == "status":
        return 0 if status()["ready"] else 1
    if args.command == "start":
        return start(args.wait, args.timeout)
    if args.command == "restart":
        stop()
        return start(args.wait, args.timeout)
    if args.command == "stop":
        return stop()
    if args.command == "speak":
        return speak(args.text, args.out)
    if args.command == "_supervise":
        return supervise(args.launch_id)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
