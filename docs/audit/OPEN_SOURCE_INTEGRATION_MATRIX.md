# OPEN-SOURCE INTEGRATION MATRIX

Decision vocabulary: **INTEGRATE** (production dependency) · **EXTEND** (already present; improve in place) ·
**REFERENCE** (read for design, ship no code) · **REJECT** (duplicates existing capability or unacceptable
cost) · **DEFER** (valid later, blocked now by hardware/toolchain/scope).

Every row states the integration boundary — the exact seam where the dependency is allowed to touch LÉLU.

## 1. Real-time media and voice

| Repository | License | Version picked | Decision | Purpose & boundary |
|---|---|---|---|---|
| `livekit/livekit` (server) | Apache-2.0 | self-hosted `v1.13.x` (pinned image tag, not `latest`) | **INTEGRATE (Device Bridge only, Phase 4)** | Transport for cross-device media sessions (audio, optional video/screen). Runs as its own container, reached over `/v1/media` negotiation. **LÉLU core never imports it and never depends on it.** Absent/unreachable → every media capability reports `unsupported`/`temporarily-unavailable`; nothing else degrades. |
| `livekit/client-sdk-js` | Apache-2.0 | `2.23.x` | **INTEGRATE (Bridge web client)** | Browser-side join for pairing page and device page. Added to the **bridge's own** package.json, not LÉLU's. |
| `livekit/client-sdk-swift` | Apache-2.0 | — | **DEFER** | Native iOS companion media. Not buildable here (no macOS/Xcode). Documented as the intended path, no code. |
| `livekit/agents` | Apache-2.0 + LiveKit Model License for turn detection | — | **REJECT for LÉLU** | Would be a second agent/cognition framework competing with SHAMAN and `AIRouter`. The brief forbids replacing orchestration. Not installed. Model License also complicates redistribution. |
| `livekit/agents-js` | Apache-2.0 (same carve-out) | — | **REJECT for LÉLU** | Same reason. Reference for how streaming STT/TTS turns are segmented — and that pattern already exists in `VoiceEngine` (chunking, barge-in, echo guard). |

**Acceptance for INTEGRATE:** two browser clients join the same room, audio flows both directions, leaving
the room revokes publish rights, and a revoked session cannot re-publish. If the owner will not host a
LiveKit server, the media rows stay `unsupported` and are reported as such — the bridge remains fully
functional without media.

## 2. iOS screen capture research

| Repository | License | Decision | Reason |
|---|---|---|---|
| `Iotric/iOS-ReplayKit-FrameAccess` | **none** (no LICENSE file) | **REFERENCE only** | No grant to reuse. Reading it is fine; vendoring it is not. Useful only as an explanation of the Broadcast Upload Extension ↔ app socket handshake. |
| `zhangqibin/webrtc-replaykit` | BSD-3-Clause | **REFERENCE only** (no code) | Last commit 2020, pinned to `appr.tc`, committed `Pods/`. Obsolete toolchain. |

**Boundary:** neither is a dependency. The bridge ships **no** iOS capture code. What the bridge *does* ship
is the capability contract (`screen.share` with state `native-required` on iOS browsers) and documentation of
Apple's real constraints: ReplayKit broadcast requires a native app + Broadcast Upload Extension, is
user-initiated via the system broadcast picker, cannot run headless, and cannot be driven by a web page.
Any future companion app implements that contract.

## 3. Remote browser / desktop

| Repository | License | Decision | Purpose & boundary |
|---|---|---|---|
| `m1k1o/neko` | Apache-2.0 | **EXTEND existing integration** | LÉLU already has `plugins/nekoApi.ts`, `deploy/neko/docker-compose.yml`, and `GenesisBrowserPanel` mode `"neko"`. Work: (a) make the status contract report **session/media** state, not just HTTP reachability; (b) prove a real WebRTC session renders a live page; (c) only if Neko exposes a supported control surface, add navigation/screenshot verification. **One Neko, one compose file, one client.** |
| `browser-use/browser-use` | MIT (Python ≥3.11) | **REJECT as dependency**, REFERENCE for patterns | Duplicates `BrowserTool`/`BrowserResolver` with a second language runtime and its own LLM cost. Two automation systems would be an architectural fork. Patterns worth borrowing (documented in the upgrade architecture): explicit DOM summarisation before acting, observe→act→verify loops, recovery from navigation errors. |

**Neko constraint recorded:** Neko does not ship a Safari target (vendor/legal). Therefore "iPhone browser
inside Neko" is impossible; iOS uses the iPhone's own browser through the Device Bridge.

## 4. Browser automation and testing

| Repository | License | Decision | Purpose & boundary |
|---|---|---|---|
| `microsoft/playwright` | Apache-2.0 | **EXTEND** (already `1.62.0` devDependency) | The single test driver for: LÉLU UI regression, Cosmos rendering, mobile viewports, chat stability, tool execution, browser workflows, and the **Device Bridge** web acceptance run. Do not upgrade. Do not add Cypress/WebdriverIO/Puppeteer. |

**Environment note (measured):** headless Chromium in this VM fails to launch with
`libnspr4.so: cannot open shared object file`. Resolved by installing the system libraries
(`playwright install-deps`, needs root) — see roadmap gate G0. Until then browser-based evidence runs are
blocked and must be reported as blocked, never as passing.

## 5. Spatial rendering and 3D

| Repository | License | Decision | Purpose & boundary |
|---|---|---|---|
| `pmndrs/react-three-fiber` | MIT | **EXTEND** (installed `9.6.1`) | The renderer already used by 29 `.tsx` modules. No version bump (v10 is a WebGPU-first breaking line). |
| `pmndrs/drei` | MIT | **EXTEND** (installed `10.7.7`) | `Html`, controls, helpers already in use. No version bump (v11 alpha). |
| `pmndrs/xr` | MIT-like text, non-standard metadata | **DEFER (optional)** | Only after Tier 1-5 spatial work passes on flat screens, and only with WebXR hardware present. It would extend the existing engine (same three/R3F), not replace it. License metadata will trip scanners — record that consciously if adopted. |

**Explicitly rejected:** Babylon.js, Unity, Unreal, PlayCanvas. Nothing in the brief needs a second engine;
the existing R3F scene already renders the world, the avatar and procedural output.

## 6. New dependencies this project will add (each justified)

| Package | Where | Version pin | License | Why |
|---|---|---|---|---|
| `hono` + `@hono/node-server` | Device Bridge only | latest at Phase 3, pinned in bridge lockfile | MIT | Tiny, Workers-compatible HTTP router; lets the same handlers run on Node now and an edge runtime later. |
| `ws` | Device Bridge only | latest at Phase 3 | MIT | Battle-tested WebSocket server; Node has no built-in server-side WS. |
| `zod` | Device Bridge only | latest at Phase 3 | MIT | Runtime validation of every API body and capability manifest — the "never trust a device" rule needs schema enforcement. |
| `qrcode` | Device Bridge only | latest at Phase 3 | MIT | QR pairing payload rendering without a cloud service. |
| `@livekit/components-*` | Device Bridge web client | Phase 4 | Apache-2.0 | Only if the bridge's device page uses LiveKit UI; otherwise plain `client-sdk-js`. |
| *(none)* | **LÉLU V1.1** | — | — | The LÉLU-side upgrade is designed to need **no new runtime dependency**. Everything is built on the existing R3F/three/zustand/router/tool stack. If that changes, it is added here with a reason first. |

## 7. Rejected / deferred summary

| Item | Verdict | One-line reason |
|---|---|---|
| LiveKit Agents (py/js) | REJECT | Second cognition framework; SHAMAN is the authority. |
| browser-use | REJECT | Second automation system, Python runtime, paid inference. |
| Neko re-install | REJECT | Already integrated; extend it. |
| iOS ReplayKit repos | REFERENCE | One unlicensed, both abandoned; no macOS here. |
| pmndrs/xr | DEFER | No WebXR hardware; license metadata; flat-screen spatial work comes first. |
| R3F v10 / drei v11 / Playwright bump | DEFER | Breaking major lines; out of scope and destabilising. |
| Babylon/Unity/Unreal | REJECT | Competing engines; prohibited by the brief. |
| A second voice pipeline in LÉLU | REJECT | `VoiceEngine` is tested; transport belongs to the bridge. |
| Supabase dependency for the bridge | REJECT | Bridge must not depend on LÉLU's schema (brief §9F/§17). |
