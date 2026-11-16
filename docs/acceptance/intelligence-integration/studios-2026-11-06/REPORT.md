# Live operational studios — evidence

Date: **2026-11-06** · Branch `freebuff/1fb0099bf53a9ab2f6fe75bd` at
`e648365` + working tree · Development server: `vite` on **port 3013**
(`--host 0.0.0.0`), served to the cloud browser at
`pv-1fb0099bf53a-20687709-e391-42a8-b6a9-96c58abc4a09.style.dev`.

Every screenshot below was taken from that running server with the app's own
window manager, after the panels fetched from `/api/integration/*`. Nothing on
these screens is a mock: where the environment cannot supply a value, the panel
says so (`NOT CONFIGURED`, `0/10`, `unknown`).

## What was photographed

| # | File | Screen | Data source (HTTP) | Captured (UTC) | Data |
|---|---|---|---|---|---|
| 00 | `00-desktop-home.png` | Sign-in gate over Cosmos | none | 07:16 | not signed in |
| 01 | `01-desktop-workspace.png` | Workspace, LÉLU + apps rail | none | 07:17 | static shell |
| 02 | `02-desktop-settings-links.png` | Settings, the four new links | none | 07:18 | static shell |
| 07 | `07-desktop-engineering-studio.png` | **Engineering Studio** | `GET /api/integration/engineering` | 07:20 | live |
| 08 | `08-desktop-voice-studio.png` | **Voice Studio** | `GET /api/integration/voice` + browser device APIs | 07:21 | live / unavailable |
| 09 | `09-desktop-infrastructure-monitor.png` | **Infrastructure Monitor** | `GET /api/integration/status` + `GET /api/integration/traces` | 07:22 | live |
| 10 | `10-desktop-security-center.png` | **Security Center** | `GET /api/integration/security` | 07:24 | live |
| 11 | `11-mobile-security-center-390x844.png` | **Security Center, 390×844** | same | 07:25 | live |

Superseded attempts kept for honesty: `03`/`04` (security centre behind the chat
window, small viewport) and `05`/`06` (engineering mid-load, Genesis dock). `07`
replaces `05`; `10` replaces `04`.

## What each studio actually shows

### Engineering Studio — live, mostly unavailable

`0` active tasks, `0` workspaces locked, `0` verified, **`0/3` engines usable**.
Execution runtime is the real server: `vite-dev`, available, workspace
`1fb0099b…b2f6fe75bd`, token required `no`, identity verification
`not configured — apply is refused`, `4` operations whitelisted. OpenHands and
OpenCode are `NOT CONFIGURED` because `OPENHANDS_BASE_URL` / `OPENCODE_BASE_URL`
are unset, with `Selectable: no — requesting it is refused`, which is the
no-substitution rule made visible.

### Voice Studio — live server facts, no audio hardware

Whisper.cpp, Kokoro and Pipecat are `NOT CONFIGURED` with the exact missing
variable named. VAD reports `silero-onnx (absent) — adaptive energy VAD in use`.
The device block is measured by the browser rather than the server: capture
devices `1`, output devices `1`, system voices `19`, mic permission `prompt`;
speech synthesis and secure-context capture are reported as unavailable in this
headless runtime. Nothing is labelled operational.

### Infrastructure Monitor — live, honest zero

**`0/10` services healthy, `10` not configured**, providers `unknown`, runtime
`vite-dev`. Each probe states its missing variable and `Network contacted: no`,
so "healthy" is never inferred from silence.

### Security Center — live, failing closed

`SECURITY GATE: FAIL` — *3/3 scanner(s) ran; 30 finding(s). Gate FAILED —
findings at or above the threshold.* Policy engine **OPA** (real binary, 1.22.2,
bundle `/…/policies/lelu`, fail mode closed), `3` decisions logged, `2` denied,
`3` audit entries, all three scanners installed, **last successful scan: none**.
Decisions are real OPA evaluations (deny `deny_agent_action` 467 ms, allow
`permitted` 184 ms, deny `deny_missing_approval` 80 ms). The relationship block
states that no tuple exists yet rather than inventing sessions.

## Scanner state behind the FAIL

`scan-three-scanners.json` (captured 07:16, target `src/`, gate threshold high):

| Scanner | Ran | Findings | Breakdown |
|---|---|---|---|
| gitleaks 8.30.1 | yes | 9 | 9 high |
| semgrep 1.184.0 | yes | 21 | 5 medium, 16 info |
| trivy 0.76.2 (DB downloaded) | yes | 0 | — |
| **gate** | 3/3 ran | **30** | **FAILED** |

Findings carry rule, file, line and severity only; the matched secret value is
never included. Semgrep was installed into `.tools/venv` and exposed as
`.tools/semgrep`; the Trivy DB was downloaded into `.tools/trivy-cache`. Both are
gitignored. Before this, the gate reported those scanners as not installed — and
that state is what the panel shows when a binary disappears, proven by
`tests/integration-studios.test.ts` and by the explicit-path case in
`tests/security-integrations.test.ts`.

## API evidence (captured while the server was serving)

`api-status.json`, `api-engineering.json`, `api-voice.json`, `api-security.json`,
`api-traces.json`, plus `policy-deny-deploy.json`, `policy-allow-read.json`,
`policy-cross-user.json` and `scan-three-scanners.json`. Traces contain the
ordered chain `user_request → core → tool → result → verification` with real
durations; no `model` stage exists because no provider credential is configured.

## Tests

| Check | Result |
|---|---|
| `bun run test` | **1344 pass, 0 fail, 2 skipped** (includes 14 studio tests) |
| `npx tsc -b --force` | **exit 0** |
| Studio tests | posture never PASS while a scanner is missing; findings redacted; verification requires changed files inside allowed paths and a real test run; panels import no adapter and only call `/api/integration/*`; registration and deep links wired |

## Limits of this evidence, stated

- No microphone, speaker, model credential, OpenHands/OpenCode/OpenFGA/Temporal/
  Infisical server exists here, so those rows read `not configured` — deliberately.
- The chat window and the floating assistant are dismissed in `07`–`11` by
  injecting `display:none` on their window roots **for the capture only**; no
  panel content, data or layout was altered. `03`/`04` show the same panel with
  those windows present.
- The layout was verified at 1440×900 and 390×844 viewports; no physical device
  was used.
- The dev server was stopped after the captures; the JSON and PNGs above are the
  record of what it served.

## Reproduce

```bash
# semgrep + trivy DB are local, gitignored
.tools/semgrep --version        # 1.184.0
.tools/trivy --version          # 0.76.2, cache in .tools/trivy-cache
npx vite --host 0.0.0.0 --strictPort --port 3013
curl -s localhost:3013/api/integration/status   | jq '.policy, .scanners'
curl -s localhost:3013/api/integration/security | jq '.gate, .scanners'
bun run test && npx tsc -b --force
```
