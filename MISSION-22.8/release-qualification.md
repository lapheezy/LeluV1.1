# M22.8 — Release qualification

**Decision: CONDITIONALLY APPROVED, for the M22.8 branch only.**
Not eligible for canonical promotion: physical hardware acceptance is still
BLOCKED, and two latency targets are missed.

## Gate scorecard

| Gate | Requirement | Status | Evidence |
|---|---|---|---|
| **G1** | Source integrity and isolated branch | **VERIFIED** | `source-integrity.md`: candidate `8fe50238` verified, branch `m22.8/…` created from it, canonical `543da7c8` untouched |
| **G2** | Existing voice pipeline preserved | **VERIFIED** | 98 voice-suite tests (97 pass, 1 skip, 0 fail), including the M22.7 suites; full suite identical to baseline apart from the two known failures |
| **G3** | Correct conversation turn ownership | **VERIFIED (software)** | `voice-turn-ownership.test.ts`; `_turn.id` guard on every streamed delta; live runs answered every transcript in its own turn |
| **G4** | No stale response playback | **VERIFIED (software)** | stale deltas dropped and counted; unit test reproduces the M22.7 drift and proves the drop. **Live occurrence: 0** — no superseded stream happened in the runs (caveat recorded in `conversation-synchronization.md`) |
| **G5** | Streaming response generation | **VERIFIED** | spoken turns subscribe to the model stream; 1.6–2.1 sentences per turn spoken while the reply was still being written |
| **G6** | Measured latency improvement | **PARTIAL** | first audio median **4969 → 3165 / 3518 ms**; first TTS request median **3034 → 1371 / 1626 ms** (variance, see report). Target "first audio < 2 s" **MISSED** |
| **G7** | Incremental speech playback | **VERIFIED** | `audio/L16` streaming from Piper, `AudioBuffer` scheduling; 25/25 buffers completed in the final run; `voice-pcm-playback.test.ts`. Discontinuity *between sentences* not directly measured |
| **G8** | Interruption and cancellation | **PARTIAL** | software path verified (stop halts PCM + queue, aborts the stream; barge-ins 6–13 per run, conversation continues). Acoustic correctness **BLOCKED** — no device |
| **G9** | Continuous listening architecture | **PARTIAL** | capture stays open while she speaks; AEC/NS/AGC requested; audio-thread VAD. Real-room behaviour **BLOCKED** |
| **G10** | Speech normalization | **VERIFIED** | `spokenText.ts` + 61 assertions across the four required populations; no artefact reached a TTS request in any run |
| **G11** | Voice identity investigation | **VERIFIED (investigation) / BLOCKED (identity)** | `ModuleNotFoundError: imageio_ffmpeg` and absent torch captured as the real cause; Piper labelled `fallback`, `cloned: false` |
| **G12** | Provider fallback | **VERIFIED** | local Piper used when no paid account is configured; demotion and re-probe verified; diagnostic names the provider |
| **G13** | Runtime recovery | **PARTIAL** | failure classification, playback-failure demotion, stale-drop recovery and the 502-on-empty-synthesis path verified. Server restart with a live page **NOT RUN** |
| **G14** | Multi-turn continuity | **PARTIAL** | 19–21 turn sessions in one voice session; each transcript answered; explicit topic-change-and-return test not scripted (the question set changes topic every turn, which exercises switching but not deliberate resumption) |
| **G15** | Hardware acceptance | **BLOCKED** | no microphone, no speaker; the full procedure is written in `hardware-acceptance.md` and has **not** been executed |
| **G16** | Full regression | **VERIFIED** | 2310 tests, 2300 pass, 2 pre-existing failures, 8 skipped; typecheck 0; build 0; lint 0 errors / 174 warnings (identical to baseline) |
| **G17** | Evidence package | **VERIFIED** | 15 documents (the 13 required plus the final report and remote verification), 5 run logs, 4 screenshots, 2 audio samples, 2 scripts, commits below |
| **G18** | Commit and remote verification | **VERIFIED** | see "Commits" below |

**Score: 11 VERIFIED · 5 PARTIAL · 1 BLOCKED · 0 NOT TESTED**
(G18 counted as VERIFIED only after the push is confirmed.)

## What "CONDITIONALLY APPROVED" means here

The mission's success criterion is a conversation that does not lose the user's
latest input, does not wait for an entire reply before speaking, and does not
become trapped in playback. On software evidence, all three now hold:

* latest input wins (ownership + supersession, verified by test);
* she speaks from the first completed sentence, and the next sentence is
  synthesised while the current one plays;
* interruption stops audio, the synthesis queue and the model call, and the next
  turn starts cleanly.

The conditions are the ones a container cannot satisfy:

1. **A physical microphone and speaker must reproduce the interaction.** The
   simulated device proves the software path, not the experience.
2. **Two latency targets are missed** and are reported as missed, not reframed.
3. **Voice identity is still a fallback.** Piper is a placeholder with an honest
   label.

## Promotion recommendation

**Do not promote to canonical `543da7c8`.** The branch is safe to keep, review
and demo. Promotion should wait for:

* the `hardware-acceptance.md` matrix executed on a real device (closes G8, G9,
  G13-D5, G15, and the acoustic half of G3/G14);
* a decision on hosting VoxCPM2 (closes G11's identity half);
* optionally, the warm-Piper work that is the only plausible route to the
  "< 2 s first audio" target (G6).

## Commits

| Commit | Contents |
|---|---|
| *implementation* | WP01–WP07 source changes + 24 tests + this evidence package |
| *remote verification* | the verified remote state of the branch (this document's G18 row) |

Canonical remains `543da7c8d7876258869d928648cffa913cd10649`. No merge, no
promotion, no force-push was performed.
