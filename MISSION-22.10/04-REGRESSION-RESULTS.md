# M22.10 WP04 — Regression results

Every result below was executed in this session. Raw TAP and logs are in `logs/`.

## Full suite, canonical vs integrated

| | Canonical `b74b378e` (before) | Integrated (final source) |
| --- | --- | --- |
| Tests | 2 325 | 2 401 (+76: the voice line's tests) |
| Pass | 2 317 | 2 394 → **2 395** after the test-only commit below |
| Fail | 2 | 1 → **0** |
| Skipped | 6 | 6 |
| File | `full-suite-canonical-b74b378e.tap` | `full-suite-integrated.tap` |

* **Canonical's 2 failures** (`sandbox: an installed module is reused…`,
  `curated proofs … in the sandbox`) were run in a scratch worktree with a
  symlinked `node_modules`. They also failed only in that setup in M22.9, and
  pass in the real checkout. Classified as **environmental**; they pass on the
  integrated tree.
* **Integrated run's 1 failure:** `old-chat-panel-removed` → "the Universe
  composer carries attachments, screen sharing and voice itself". This is a
  source-text test that looked for `VoiceEngine.getInstance().toggle()` inside
  `ChatUniverse.tsx`. The M22.10 refactor moved that call into `VoiceToggle.tsx`.
  The assertion now checks both that the composer renders `<VoiceToggle` and
  that `VoiceToggle` toggles the one engine — the same guarantee, not weakened.
  Commit "Follow the Universe composer's voice assertion…". File re-run: 4/4.
  No other source changed after the full run.
* **Excalidraw CSS failure** (`tests/genesis-interface.test.tsx`,
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, recorded in M22.9): **no longer present**.
  It passes 2/2 on canonical and on the integrated tree, with zero occurrences
  of the error in either log. Canonical's own changes resolved it (not this
  mission). Nothing was hidden.

## Category runs (integrated, after the final commit)

| Category | Files | Tests | Pass | Fail | Skipped |
| --- | --- | --- | --- | --- | --- |
| Voice (all `voice-*`, ASR provenance, mission-10-3) — includes the 20 persistent-session tests | 21 | 145 | 144 | 0 | 1 |
| Chat (chat, multichat, universe, conversation) | 14 | 109 | 109 | 0 | 0 |
| Genesis (every test referencing `src/app/scene/genesis`) | 58 | 748 | 748 | 0 | 0 |
| Runtime and cognition (runtime, cognition, brain, memory, learning, AIService, provider) | 24 | 180 | 180 | 0 | 0 |

## Static gates

| Gate | Canonical | Integrated |
| --- | --- | --- |
| `tsc -b --force` | 0 | **0** |
| `oxlint` | 0 errors · 181 warnings | **0 errors** · 184 warnings |
| `npm run build` | — | **0** |

The 3 extra warnings (`lint-diff-vs-canonical.txt`) are unused variables in
two files brought by the voice line (`tests/voice-speech-delivery.test.ts`,
`verify/learning-integrity-acceptance.mjs`). They were already present (and
counted) on M22.9. None is in integration code.

## Against the recorded M22.9 baseline

M22.9 final: 2 346 tests, 2 339 pass, 1 fail (Excalidraw), 6 skipped; voice
141/141; tsc 0; lint 0 errors. Integrated: every M22.9 test still passes
(voice 144 + 1 skipped, of 145 now). The Excalidraw failure is gone.
