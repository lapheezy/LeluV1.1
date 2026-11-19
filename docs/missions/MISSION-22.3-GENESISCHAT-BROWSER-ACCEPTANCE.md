# M22.3 — GenesisChat browser acceptance

**Branch** `freebuff/m22-3-genesischat-browser-acceptance`
**Base** `15528aa` — the M22.2 hash record, remote-verified before branching (`git ls-remote` matched local HEAD), implementation `bb69e0d`, M22.1 base `2d09bba`
**Scope** Validate the M22/M22.1/M22.2 boundaries through the real user-facing application. Nothing was redesigned.

---

## 1. Why browser acceptance had failed, and what actually fixed it

`GenesisScene` mounts the cosmic world at `/` — three WebGL canvases, a render manager, a frame governor and a sky backdrop. In this VM the renderer is software; the world keeps painting, and the automation channel stalls. In the first attempt of this mission, `connectOverCDP` timed out twice and a click on the sign-in gate hung after scrolling into view: the automation could not reach the page it was inspecting.

The app already had a legitimate path that renders no scene: on a phone, when chat owns the screen, `GenesisWorkspaceRouter` returns `null` and the interface stays mounted (`surface/Surface.ts`). This mission adds the narrowest equivalent for a development build — `?scene=off`, implemented in `src/app/scene/genesis/sceneTestMode.ts` and applied at that same router branch.

- **Real:** `GenesisScene`, `GenesisInterface`, `GenesisChat` / Chat Universe, `GenesisCore`, MultiChatStore persistence, MemorySovereignty, WorkspaceManager, ContextAuthorization, `buildCognitiveContext`, the memory/cognition bridges, and the provider path through the same-origin `/api/model` broker.
- **Off:** only the visual workspace beneath the interface — canvas, 3D controller, sky backdrop, phase HUD.
- **Production:** `IS_DEV` is inlined `false`; `tests/scene-test-mode.test.ts` asserts the flag cannot be honoured in a production build.
- **Measured:** canvases `3 → 0`; CDP reached the page; every step below ran.

## 2. Two conversations, real provider, actual payload

Conversation A (private note about a commission and a loss) and conversation B (a WebSocket CPU question) were both driven through the real composer. Both were answered by **Groq** (`openai/gpt-oss-120b`, HTTP 200) through the broker. Payloads were read from the page's own `fetch` wrapper — the body the provider received, not a retrieval log.

| | A | B |
| --- | --- | --- |
| request chars | 29,417 | 4,032 |
| contains A's private token | **yes** | **no** |
| contains grief language | **yes** | **no** |
| cross-chat label | — | none |
| project / checkpoint content | own | none |
| execution events / last action | own | none |

B's follow-up ("Does that apply to browsers too?") stayed clean (3,979 chars, no token, no grief, no label). B's UI showed *"Using other chats — 1 other chat used"*, yet nothing from another conversation was in the request — a badge worth reviewing, not a leak.

## 3. Reload and persistence

A full reload restored **both** conversations with their transcripts, no sign-in gate, zero canvases, and the open-window count preserved. After reload, A asked "What do you remember about my commission?" and its request (25,090 chars) still carried its own material — the reply named BLUE‑HERON and the loss correctly. B's post-reload follow-up remained clean. Authorization survived persistence, not just navigation.

Reload-to-restored took **13.4 s** on the development server with a cold module graph; it is not a production number.

## 4. Workspace and project boundaries

The Home workspace overview lists **names and counts only** (`General 0 items`, `Engineering 0 items`, `Jewelry 1 item`, `Fashion 0 items`), and no observation text appears there. B's request contained no workspace text, project names, checkpoints or self-model project names. No project was created during the run, so the labelled-foreign-project path was not re-exercised in the browser; it is covered by the X-group tests and the live snapshot harness (5/5). The session was anonymous (continued without an account): ownership checks reject an owner mismatch rather than accepting a missing identity, and no owned content appeared.

## 5. Provider attribution

| Provider | Reached | Requests | Result |
| --- | --- | --- | --- |
| Groq (`openai/gpt-oss-120b`) | yes | 9 observed, all 200 | isolation PASS |
| OpenRouter | **no** | 0 | **NOT VERIFIED** — no request reached it, so no result claimed |
| Anthropic | no | 0 | not authorized |

Keys stay server-side in the broker; no key or header is in the page or in this evidence.

## 6. Deletion and supersession

**Not verified in the browser.** The Memory panel was not opened and no delete was performed, so no browser claim is made. The automated path passes: deleting a memory removes its workspace observation, deleting a conversation removes its observations, single-observation delete and supersession behave (`tests/context-sovereignty.test.ts`, W group 9/9). The outstanding browser step is written down in `deletion-supersession.json`.

## 7. Concurrency and identity

Two windows were open and answering simultaneously in the same session, each keeping its own transcript and context — real, but not a stress harness. The reusable harness remains `scripts/context-sovereignty-live.ts` (6/6). Not exercised: switching conversations mid-stream, two signed-in cloud identities (Supabase is not configured here; cloud sync reports off), and deletion during generation.

## 8. Mobile boundary

Desktop: **verified**. Mobile viewport 390×844: **verified at DOM level** (innerWidth 390, scrollWidth 390, both conversations intact, screenshot saved). Touch gestures: **not verified**. Native iOS and Android: **not verified** — no device, emulator, `android/` or `ios/` project, only `capacitor.config.ts`. The requirements to close that gap are listed rather than glossed.

## 9. Performance

Context work is unchanged from M22.2 and remains sub-millisecond (authorization 0.0055 ms, workspace reads 0.0073 ms, scoped snapshot 0.267 ms, enrich 0.78 ms mean / 1.04 p95 against a 1.20/1.54 baseline). Browser startup and reload are reported as development-server measurements. Conversation-switch latency was **not** measured — the attempt included a click timeout and is not reported as a number.

## 10. Regression

- Scene-flag tests: 3/3
- M22 + M22.1 + M22.2 + scene flag: **68/68**
- Typecheck: the same two pre-existing `src/core/perception/FeatureUnderstanding.ts:455` errors
- Full suite: **2,376 tests, 2,366 pass, 2 fail** — `tests/genesis-interface.test.tsx` (CSS export in this environment) and `tests/sandbox-security.test.ts` "network: TCP, UDP, DNS and fetch all fail", exactly the two documented before this mission. No new failure.

## 11. Acceptance

| # | Criterion | State |
| --- | --- | --- |
| 1 | GenesisChat runs in automation without the 3D scene | **PASS** (dev-only flag, 0 canvases) |
| 2 | Real chat and memory systems active | **PASS** |
| 3 | A and B isolated | **PASS** (both directions, payload-level) |
| 4 | Actual provider payloads demonstrate isolation | **PASS** |
| 5 | Reload preserves boundaries | **PASS** |
| 6 | Workspace observations scoped | **PASS** (B carries none; overview is names + counts) |
| 7 | Projects and checkpoints authorized | **PASS** automated; browser path not re-exercised |
| 8 | Anonymous identity cannot bypass ownership | **PASS** (automated; anonymous browser session showed no owned content) |
| 9 | Deletion and supersession | **PASS** automated; **browser NOT VERIFIED** |
| 10 | Concurrency | two live windows PASS; harness 6/6; no stress run |
| 11 | Provider results accurately attributed | **PASS** (Groq live, OpenRouter not reached, stated as such) |
| 12 | No unexplained regression | **PASS** (same two documented failures) |
| 13 | Mobile reported without overstatement | **PASS** (viewport only; native not claimed) |

## 12. Remaining defects and gaps

1. Conversation deletion, observation deletion and supersession are not demonstrated through the browser UI.
2. The "Using other chats" badge appeared with no foreign material in the payload — it should be checked against what was actually injected and withheld.
3. No native mobile acceptance; no touch-gesture run.
4. OpenRouter was not exercised this session; no claim is made in either direction.
5. A fresh browser profile (fresh IndexedDB) was not tested; reload within one profile was.

Evidence: `MISSION-22.3/` (JSON per area, screenshots, `browser-flow.md` for reproduction).
