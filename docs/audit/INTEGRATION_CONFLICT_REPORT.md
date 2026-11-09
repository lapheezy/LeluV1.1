# INTEGRATION CONFLICT REPORT

What collides with what, and what this project refuses to touch. Written before any implementation.

## 1. Repository-level conflicts

| Conflict | Evidence | Resolution |
|---|---|---|
| `claude/avatar-3d-world` (207 ahead, 1178 files) overlaps this project's spatial/avatar work | `git diff --shortstat origin/main...origin/claude/avatar-3d-world`; its tip is "Phase 1: ship the frame-based chat windows the gate verified" | Not merged, not rebased, not cherry-picked. Spatial/avatar work here is **additive in new files** plus small localized edits named in §4. Owner decision required to reconcile. |
| `claude/master-integration` (236 ahead, 1290 files) touches Cosmos, Creation Studio, chat | same method | Not merged. This project does not build a Creation Studio or a new chat surface. |
| `claude/cosmos-chat-experience-z6xja0` (210 ahead, 1156 files) owns chat/Cosmos experience | same | Not merged. This project adds a **panel** to the existing dock, not a redesign. |
| `claude/lelu-interface-control-d2sfdl` (23 ahead, 132 files) works on interface control | same | Not merged. Any device-control UI stays inside `GenesisDevicePanel.tsx` and a new Cosmos device view, not in shared chrome. |
| Other `freebuff/*` worktrees are live | `git branch -a` `+` markers | Never touched. This session works only on `freebuff/078e3ea38e31040bd9a2dce1`. |

## 2. Architectural conflicts the brief could have caused (and how they are avoided)

| Proposed integration | Would conflict with | Decision |
|---|---|---|
| LiveKit Agents replacing/duplicating orchestration | `src/core/agents/Shaman.ts`, `ExecutiveBoard`, `AIRouter` 22-stage chain | **Rejected.** LiveKit is transport only. LÉLU's cognition and SHAMAN remain the only orchestration authority. |
| browser-use as a second browser automation system | `src/core/browser/BrowserTool.ts`, `BrowserResolver`, `AuthGate` | **Rejected as a dependency.** Patterns only. Any execution backend plugs in behind `BrowserTool`, one system. |
| `@pmndrs/xr` as a new XR engine | Existing R3F 9.6.1 + three 0.185 scene | **Deferred.** Optional extension of the existing engine, not a parallel one. |
| A separate device dashboard | Existing Cosmos + Genesis dock | **Rejected.** Device Bridge UI lives in the existing panel/Cosmos surfaces. |
| Device Bridge code inside this repo | Repository boundary in the brief | **Rejected.** Separate repository on its own branch/stack. |
| Neko installed a second time | `plugins/nekoApi.ts` + `deploy/neko/docker-compose.yml` already exist | **Extend the existing integration.** No second compose file, no second client. |
| New voice pipeline | `src/core/voice/VoiceEngine.ts` (1539 lines, tested) | **Rejected for LÉLU.** Real-time transport is added only in the Device Bridge, and only behind a session that the existing voice path can opt into later. |

## 3. Factual conflicts between the brief and the code (owner decisions needed)

1. **"Preserve the existing Anthropic-first provider preference."**
   Measured order in `src/core/Environment.ts`: Groq 1 → OpenRouter 2 → Cerebras 3 → Mistral 4 →
   Fireworks 5 → GitHub Models 6 → **Anthropic 7** → Gemini 8; `VITE_DEFAULT_PROVIDER` defaults to `groq`.
   The repository is **Groq-first with Anthropic late**, and `AIRuntime`/`ProviderResolver` is the single
   fallback implementation.
   **This project does not re-order providers.** Re-ordering would change the behaviour of every chat turn
   and is exactly the kind of "destabilise existing systems" the brief forbids.
   *Owner decision (deferred, non-blocking):* either the brief's wording is aspirational → set
   `VITE_DEFAULT_PROVIDER=anthropic`; or the order should genuinely change → a separate, tested change.

2. **"LÉLU already has a Neko integration. … Verify actual browser connectivity."**
   What exists is a status probe (`plugins/nekoApi.ts` fetches the Neko web client and reports HTTP status;
   its own message says WebRTC depends on UDP/NAT configuration) plus an embedded live surface
   (`GenesisBrowserPanel` mode `"neko"`). No code in the repo observes a Neko session's media state, and no
   code can drive it. The brief's requirement is therefore *new capability*, not verification of an
   existing one. Documented honestly rather than claimed.

3. **"iPhone screen sharing / ReplayKit"**
   Neither reference repo is usable (one unlicensed, both abandoned), and this environment has no macOS,
   Xcode, or physical iPhone. Any ReplayKit work is design + documentation only, labelled as such.

4. **"Native companion applications"**
   `src/core/native/capabilities/nativebridge.ts` is the seam (WKWebView `messageHandlers`), and Capacitor
   Android exists. There is no iOS app and no Android plugin beyond defaults. Deliverable is the *contract*
   and the *architecture*, not a shipped binary.

## 4. File-level ownership this project claims

Additive (new files/dirs — zero overlap with any branch):

```
src/core/spatial/**            scene graph, object registry, tier guard, intent API
src/core/devicebridge/**       LÉLU-owned adapter to the external bridge (Phase 5, env-gated, default off)
src/app/scene/genesis/cosmos/DevicesView.tsx   (new)
docs/audit/**, docs/architecture/**, docs/acceptance/**
tests/spatial-*.test.ts, tests/devicebridge-*.test.ts
scripts/verify-spatial.ts, scripts/verify-device-bridge.ts   (new runnable checks)
```

Localized edits to existing files (each reviewed for overlap, each covered by existing tests):

| File | Edit | Why it is safe |
|---|---|---|
| `src/core/router/ToolResolver.ts` | register spatial + device tool intents through the existing stage | same pattern already used for `camera.capture` etc.; returns `handled:false` for everything else |
| `src/core/avatar/AvatarPresenceBridge.ts` | add spatial presence publication (position/attention) | additive methods; existing dialogue mapping untouched; `tests/avatar-presence*.test.ts` covers it |
| `src/core/browser/BrowserTool.ts` | add a pluggable execution backend interface | existing read path unchanged; backend absent → same behaviour as today |
| `plugins/nekoApi.ts` | report media-session state when a session id is supplied | additive JSON fields; existing `/api/neko/status` contract preserved |
| `src/app/scene/genesis/GenesisDevicePanel.tsx` | add remote-device section | panel already owns device UI; no shared chrome change |
| `src/core/native/NativeCapability.ts` | extend status union with `deferred`/`native-required` if needed | additive union, adapters updated in place |

**Do not touch** (conflict checkpoint if a change becomes necessary): `src/App.tsx`,
`src/app/scene/genesis/GenesisCore.tsx`, `GenesisWindowFrame.tsx`, `GenesisV2Scene3D.tsx`,
`src/core/AIService.ts`, `src/core/AIRuntime.ts`, `src/core/Environment.ts` (provider priorities).

## 5. Dependency conflicts

- No upgrade of `three`, `@react-three/fiber`, `@react-three/drei`, `react`, `vite`, `typescript` or
  `playwright` during this project (upstream has breaking major lines: R3F v10 WebGPU, drei v11, Playwright
  drops old distros). New dependencies are additive only.
- `bun.lock` remains the single install source. Adding a dependency means updating `bun.lock` only, and the
  change is recorded in the integration matrix with its license and purpose.
- The lockfile is never regenerated wholesale; `bun install --frozen-lockfile` must keep working.

## 6. Runtime conflicts

| Conflict | Detail | Handling |
|---|---|---|
| Browser sandbox cannot launch native browsers | `BrowserTool.nativeLaunchAvailable()` returns `false` by design | Real driving is done server-side/by Neko under its own permission model, never by pretending the browser can spawn Chrome |
| Neko requires public IP + UDP range | `deploy/neko/docker-compose.yml` requires `NEKO_WEBRTC_NAT1TO1` and exposes 52000-52100/udp | Local/self-hosted only; a cloud VM without that UDP path is reported as unreachable, not faked |
| Supabase optional/local-first | App works without keys; persistence degrades | Device Bridge must **not** depend on LÉLU's Supabase schema (brief §9F/§10) |
| Server-only secrets | `plugins/*` middleware is the credential boundary; `VITE_*` is public | Device Bridge tokens are server-side; no `VITE_` device secrets |

## 7. Unresolved owner approvals (do not proceed past without answer)

1. Reconcile `claude/avatar-3d-world` / `claude/master-integration` with main — **owner only**.
2. Create the `LÉLU-Device-Bridge` GitHub repository (this environment can push only to the connected
   repository). Until then the bridge lives as an independent git repo in the workspace root, outside the
   LÉLU worktree.
3. Provider-priority wording in the brief (§3.1).
4. Whether a LiveKit server (and TURN) will be hosted by the owner — needed before any real media test.
