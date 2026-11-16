# DEPENDENCY AND LICENSE AUDIT — LÉLU V1.1

Audit date: 2026-11-06. Two parts: (A) the dependency tree that is actually installed, measured; (B) the
upstream repositories proposed by the brief, audited as candidates. Candidate decisions live in
`OPEN_SOURCE_INTEGRATION_MATRIX.md`.

---

## Part A — installed tree (measured, not assumed)

Method: `bun install --frozen-lockfile` → 676 packages, then a script reading every `node_modules/*/package.json`
(608 package manifests resolved, including scoped packages).

### License distribution

| License | Packages |
|---|---|
| MIT | 471 |
| ISC | 56 |
| Apache-2.0 | 34 |
| BSD-2-Clause | 12 |
| BlueOak-1.0.0 | 11 |
| BSD-3-Clause | 7 |
| Unlicense | 4 |
| MPL-2.0 | 3 (+1 composite `(MPL-2.0`) |
| MIT composite (`(MIT`) | 1 |
| `SEE LICENSE` (no SPDX) | 2 |
| UNKNOWN (no license field) | 3 |

**No GPL, AGPL, SSPL or non-commercial license is present in the installed tree.** For a private,
self-hosted product that is the important result.

### Flagged packages (need a note, not a block)

| Package | Issue | Assessment |
|---|---|---|
| `@trapezedev/gradle-parse`, `@trapezedev/project` | `SEE LICENSE` (no SPDX in manifest) | Dev-only, transitive via `@capacitor/assets` (devDependency). Never ships in the browser bundle. Not redistributed. |
| `khroma`, `stack-trace`, `webgl-constants` | UNKNOWN (no license field) | Transitive, permissive in practice (webgl-constants is MIT upstream). Not redistributed as source; bundled minified into the app build. Low risk, documented. |

### Direct runtime dependencies (from `package.json`)

`@anthropic-ai/sdk`, `@capacitor/core`, 7 `@radix-ui/*` primitives, `@react-three/drei` 10.7.7,
`@react-three/fiber` 9.6.1, `@supabase/supabase-js`, `@tanstack/react-query`, `@vly-ai/integrations`,
`class-variance-authority`, `clsx`, `framer-motion`, `lucide-react`, `mermaid`, `openai`, `react` 19.2,
`react-dom`, `react-markdown`, `react-router-dom`, `remark-gfm`, `sonner`, `tailwind-merge`, `tailwindcss` 4.3,
`three` 0.185, `tw-animate-css`, `zustand`.

Dev: `@capacitor/{android,assets,cli}`, `@types/node|react|react-dom`, `@vitejs/plugin-react`, `glslify`,
`oxlint`, `playwright` 1.62, `tsx`, `typescript` ~6.0.2, `vite` 8.1, `vite-plugin-glsl`.

### Findings

1. **Three lockfiles are tracked**: `bun.lock`, `package-lock.json`, `deno.lock`. CI uses
   `bun install --frozen-lockfile`, so `bun.lock` is authoritative and the other two are drift risk.
   This project preserves all three and installs only from `bun.lock`.
2. **`@vly-ai/integrations` is a platform-provided package** whose calls are billed per use. The app's real
   chat path does not depend on it (providers are called directly / through the server broker), so it is not
   a mandatory paid dependency today. Documented, not removed.
3. **`mermaid`** is a large browser dependency used for diagram rendering; it is pre-existing and out of scope.
4. **`@anthropic-ai/sdk` and `openai` are used server-side** (`plugins/aiProxyApi.ts`, providers); keys stay
   in server env. No `VITE_` secret was found for them in `env.example` beyond the documented
   `VITE_ANTHROPIC_API_KEY` fallback, which `env.example` explains is resolved by the runtime key bridge.
5. **Playwright browsers are not vendored.** A fresh clone fails `bun run test` on `tests/self-view.test.ts`
   until `playwright install` is run. Confirmed twice in this audit (see `MASTER_REPOSITORY_AUDIT.md` §2 and
   the re-run in `§A1` below, root-caused in `MASTER_REPOSITORY_AUDIT.md` §8).

### A1 — re-run after installing Chromium headless shell

`bunx playwright install chromium` succeeded (114.7 MiB, `chromium_headless_shell-1234`).
`bunx tsx --test tests/self-view.test.ts` → **13 pass, 2 fail** — still failing, so the cause is **not**
only the missing browser. The remaining cause is recorded verbatim in
`.lelu-sandbox/audit/self-view.log` (audit artifact, gitignored) and carried into
`MASTER_REPOSITORY_AUDIT.md` §8. This is a pre-existing test defect in the repository and is **not**
introduced by this project; it is tracked as baseline debt (see roadmap gate G0).

---

## Part B — upstream candidates audited

Maintenance data as of early November 2026, from GitHub/package-index snapshots. Where a snapshot lagged a
newer tag, that is stated.

| # | Repository | License (SPDX) | Latest activity | Status | Language / host |
|---|---|---|---|---|---|
| 1 | livekit/livekit (server) | Apache-2.0 | v1.13.11, 25 Oct 2026 | Active | Go SFU (Pion), Docker/Helm |
| 2 | livekit/client-sdk-js | Apache-2.0 | v2.23.0, 16 Oct 2026; commits 5 Nov 2026 | Active | TypeScript, browser |
| 3 | livekit/client-sdk-swift | Apache-2.0 | 2.18.0 (16 Oct 2026); Swift Package Index reports 2.19.0 | Active | Swift, iOS/macOS/visionOS |
| 4 | livekit/agents (Python) | Apache-2.0 **except turn-detection models under the LiveKit Model License** | 1.8.10, 29 Oct 2026 | Active, fast-moving | Python |
| 5 | livekit/agents-js | Apache-2.0 (same model-license carve-out) | 1.9.5, 28 Oct 2026 | Active | TypeScript/Node |
| 6 | Iotric/iOS-ReplayKit-FrameAccess | **No license file → all rights reserved** | 5 commits, all 29 Jul 2022 | **Abandoned** | Swift/Obj-C demo |
| 7 | zhangqibin/webrtc-replaykit | BSD-3-Clause | last commit 2 Apr 2020 | **Abandoned** | Obj-C, GoogleWebRTC |
| 8 | m1k1o/neko | Apache-2.0 | v3.2.0, 15 Oct 2026 (React 19 client) | Active | Go + TS |
| 9 | browser-use/browser-use | MIT | 0.13.14, 26 Oct 2026 | Active | Python ≥3.11 |
| 10 | microsoft/playwright | Apache-2.0 | 1.64.1, 14 Oct 2026 | Active | TS/Node |
| 11 | pmndrs/react-three-fiber | MIT | 9.8.2, 15 Oct 2026 (v10 WebGPU alpha line) | Active | TS |
| 12 | pmndrs/drei | MIT | 10.7.9, 25 Sep 2026 | Active | TS |
| 13 | pmndrs/xr | MIT text in LICENSE, GitHub/badges report "Other"; npm says `SEE LICENSE IN LICENSE` | last push 3 Oct 2026; npm 6.6.32 early Nov 2026 | Maintained, one primary author, tags lag npm | TS/WebXR |

### Specific findings that constrain the plan

- **LiveKit server self-hosting is free.** Apache-2.0, official Docker images and Helm charts. What is *not*
  included self-hosted: managed agent hosting, LiveKit Inference, Agent Builder, managed observability and
  phone numbers. Self-hosted means bring-your-own model keys.
- **`livekit/agents` licensing is split.** The framework is Apache-2.0; the turn-detection models are under
  the separate LiveKit Model License. Any use of turn detection is a commercial-license question.
- **Both iOS ReplayKit references are unusable as production code.** One has no license at all (dangerous to
  vendor), the other is a 2020 demo pinned to `appr.tc` and a committed `Pods/`. They are *reading material*
  for how a Broadcast Upload Extension moves frames.
- **Neko explicitly does not ship Safari** for vendor/legal reasons (v3.2.0 docs); this matters because iOS
  browsers are all WebKit. Any Neko-based "iPhone browser" claim is false; iOS must use its own browser.
- **`browser-use` is Python and MIT**, but its value is inference + cloud browsers (paid), and it is a whole
  second automation stack next to LÉLU's TypeScript `BrowserTool`. It is a reference, not a dependency.
- **`pmndrs/xr` has non-standard license metadata** and a v6 API rewrite; anything using it will be flagged
  by license scanners. It also needs WebXR-capable hardware that this environment does not have.
- **Playwright downloads pinned browsers** and drops older distros; the CI already installs Chromium
  explicitly, which is the correct pattern and is reused for this project's evidence capture.

### Version-specific compatibility with this stack

| Candidate | Compatibility verdict |
|---|---|
| LiveKit server | Independent Go service, Docker — no coupling to LÉLU's stack. Compatible. |
| client-sdk-js 2.x | Browser ESM, works with Vite 8. Compatible. |
| client-sdk-swift | Needs Xcode/macOS to build and a native iOS app to host. **Not buildable in this environment.** |
| agents / agents-js | Node/Python service. Would duplicate SHAMAN/cognition if adopted → rejected for LÉLU. |
| Neko 3.2 | Already integrated via HTTP status + iframe embed. Compatible. |
| browser-use | Python service alongside a TS repo; extra runtime, extra LLM cost. Reference only. |
| Playwright | Already a devDependency at 1.62; the 1.64 listed upstream is newer — **do not upgrade**, pinning stays. |
| R3F 9.6.1 / drei 10.7.7 | Already installed. Upstream has v10/v11 WebGPU lines — **do not upgrade** during this project. |
| pmndrs/xr | Would need three/R3F version alignment and WebXR hardware. Deferred. |

### Security review summary of candidates

| Candidate | Surface added | Key risk | Mitigation in plan |
|---|---|---|---|
| LiveKit server | New long-lived service + UDP range + TURN | Exposed media ports, token minting | Tokens minted server-side only, short TTL, per-session grants, no anonymous rooms |
| client-sdk-js | Browser bundle | Media permission prompts | Explicit user gesture, capability state surfaced, never auto-capture |
| Neko | Already present; if driven remotely | Remote-control of a browser | Keep Neko password server-side; no recorded sessions; explicit session indicator |
| browser-use | Python process with LLM keys | Prompt-injected page content driving tools | Not adopted |
| ReplayKit refs | None (no code) | Unlicensed code | Reference reading only |
| Device Bridge (new) | New service with device control | Cross-user device access | Owner-vs-operator separation, action broker, audit log (see security model) |

### Verdict

Nothing in the candidate set requires a paid service to function. The only genuinely paid items in the
existing product are Meshy (image→3D, optional, server-relayed) and LiveKit Cloud (not required —
self-hosting is Apache-2.0). Every paid path has a self-hosted or free alternative documented.
