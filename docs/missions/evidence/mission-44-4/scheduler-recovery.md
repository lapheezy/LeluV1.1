# Scheduler recovery — Mission 44.4 (WP02)

## 1. The unit file: what was wrong and what changed

`deploy/lelu-lab-scheduler.service` existed from Mission 44.3 but had never been validated, because
this VM has no systemd (`systemctl`, `supervisord`, `s6`, `runit`, `pm2`, `launchctl`, `docker` all
absent; PID 1 is `agent37-vm-guest`). Static inspection found two real configuration defects:

| Defect | Effect | Fix |
|---|---|---|
| `StartLimitIntervalSec` / `StartLimitBurst` were in `[Service]` | ignored since systemd 229 — the crash-loop limiter never applied | moved to `[Unit]` |
| no `Environment=PATH=…` | `ExecStart=/usr/bin/env npx tsx …` relies on a PATH that finds Node; systemd's default PATH need not include the Node prefix | `Environment=PATH=/usr/local/bin:/usr/bin:/bin` (`npx`, `node`, `git` all resolved there on this image) |
| `Restart=on-failure` | a daemon that exits 0 (clean shutdown) is not restarted, although the unit exists to keep discovery running | `Restart=always`, plus `RestartPreventExitStatus=3` so the deliberate "another instance holds the lock" refusal does not loop |

Environment loading was checked in the code rather than assumed: the scheduler and
`plugins/labEngine.ts` read `process.env` only to pass it to `git` (with `GIT_TERMINAL_PROMPT=0`)
and to its own subprocesses. It calls **no model provider** and needs **no credential**, so no
`EnvironmentFile=` for `.env.local` was added — handing this process the repository's provider
keys would widen exposure for no benefit.

## 2. What was actually tested (and what could not be)

**Not testable here:** unit installation, `systemctl start/stop/restart`, `journalctl`, and
**reboot recovery**. There is no init system to test them with. No claim of reboot recovery or
production supervision is made.

**Tested, on the real process** (`scripts/lab-scheduler.ts`, the same code the unit runs):

### a. Clean stop of the running pre-fix daemon (pid 29844)

Before: `running: true, cycles: 3, nextAt: 1795696849410`, and the daemon was **60,555 s (16.8 h)
past `nextAt`** with no cycle and no error — the drift defect 44.3 measured, still live because the
process was running pre-fix code.

```
kill -TERM 29844
pid 29844 gone
heartbeat: { "running": false, "pid": null, "nextAt": null, "cycles": 3 }
lock:      No such file or directory
log:       [lab-scheduler] SIGTERM — heartbeat closed
```

SIGTERM closed the heartbeat and released the lock. Nothing else was interrupted: the dev server,
the two experiment previews and the eight experiment worktrees were untouched.

### b. Overlap refusal

```
npx tsx scripts/lab-scheduler.ts --once
[lab-scheduler] refusing to start — already held by pid 16822
exit code 3
```

A second instance cannot execute a cycle alongside the first.

### c. Sliced wait advances cycles (the 44.3 fix, now actually running)

`--max-cycles 3 --interval-ms 10000`:

```
[lab-scheduler] discovery disc-mwyjowmk-449845 … 468ms
[lab-scheduler] discovery disc-mwyjp4no-449845 … 407ms
[lab-scheduler] discovery disc-mwyjpcoz-449845 … 413ms
[lab-scheduler] completed 3 cycle(s) — exiting as asked
heartbeat: { "running": false, "cycles": 6, "lastCycleAt": 1795757590404 }
lock: released
```

Three cycles, one per 10 s slice, each re-deriving "is a cycle due?" from the clock. A suspended VM
or clock jump can no longer swallow the wait.

### d. Crash recovery

```
daemon pid=17085 … kill -9 17085
heartbeat after crash: { running: true, pid: 17085, cycles: 7 }   ← a dead pid still claiming to run
lock after crash:      { "pid": 17085, … }                        ← stale lock left behind
restart: [lab-scheduler] recovered from pid 17085 that did not shut down cleanly
         discovery disc-mwyjpruo-449845 … 510ms
exit 0
```

The stale-lock takeover worked and the recovery was recorded in the laboratory journal as
`scheduler-recovered` (not hidden).

### e. Real daemon left running the fixed code

```
pid 17250, intervalMs 21600000, cycles 9, nextInMin 360, lock { "pid": 17250 }
```

## 3. What remains unverified — stated plainly

1. **Reboot recovery: NOT verified.** It needs a real reboot under systemd, which this VM cannot do.
2. **Unit installation: NOT verified.** The file is corrected and ready for a systemd host.
3. The scheduling fix is verified by cycle advancement and by the unit's own logic, not by surviving
   an actual suspend: the drift was observed (16.8 h overdue) and the recovery mechanism is the
   sliced wait, which the three-cycle run exercised.
