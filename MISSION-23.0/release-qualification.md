# M23.0 — Release Qualification: Gate Scorecard

Every gate is one of **VERIFIED**, **PARTIALLY VERIFIED**, **BLOCKED**,
**NOT TESTED**. "BLOCKED" means the environment cannot support the test;
"PARTIALLY VERIFIED" means a real measurement exists but does not cover the
gate as written.

| Gate | Requirement | Status | Evidence |
|---|---|---|---|
| **G1** | Source integrity | **VERIFIED** | `source-integrity.md` — M22.9 `b46b0aa3`, M22.8 `43db0a06`, M22.7 `8fe50238`, canonical `543da7c8` unchanged; isolated branch; no rewrite |
| **G2** | Hardware discovery | **VERIFIED** | `hardware-discovery.md` — authoritative inventory, devices absent, classification recorded |
| **G3** | Physical microphone | **BLOCKED** | no `/dev/snd`, no ALSA, no sound server; procedure in `physical-audio-acceptance.md` |
| **G4** | Physical speaker | **BLOCKED** | same; browser enumerated 3 outputs on a machine with none, which is not hardware |
| **G5** | Acoustic echo cancellation | **BLOCKED** | `acoustic-interruption-report.md` — needs mic + speaker coupling. Software echo guard measured separately (see G6) |
| **G6** | False barge-in qualification | **PARTIALLY VERIFIED** | software decision function measured: 0/228 false rejections, 48/48 echoes caught, defect found and fixed (`logs/echo-guard-before-after.json`). Acoustic false barge-in BLOCKED |
| **G7** | Silent-turn root cause | **VERIFIED** | `silent-turn-investigation.md` — provider 429 refusal spoken-as-silence + unrecorded supersede; both fixed |
| **G8** | 100-turn regression | **VERIFIED** | `logs/m23.0-100-turn.json` — 100 transcripts, 100 recorded, **0 unexplained**; 45 spoken, 55 refusals (35 spoken notices) |
| **G9** | Five-minute human conversation | **BLOCKED** | `five-minute-human-conversation.md` — protocol complete, no human/device; no simulated run substituted |
| **G10** | Voice identity investigation | **PARTIALLY VERIFIED** | `voice-identity-investigation.md` — root cause found and reproduced (phoneme-map format mismatch); identity itself **unresolved**, no listening evaluation possible |
| **G11** | Personality-driven delivery | **VERIFIED** | `personality-expression-acceptance.md` — 30/30 replies, 10 registers, deterministic profiles, words preserved, identity moves delivery on 12/30 |
| **G12** | Runtime resource qualification | **VERIFIED** | `voice-runtime-resource-report.md` — 30-minute soak, memory growth, worker count, queue depth |
| **G13** | Worker recovery | **VERIFIED** | killed worker during the soak; respawn and restart counter recorded in the same artifact |
| **G14** | Full regression | **VERIFIED** | `M23.0-verification-report.md` — typecheck, build, lint, full suite, voice suites |
| **G15** | Evidence package | **VERIFIED** | `MISSION-23.0/` — 16 documents, raw logs, JSON measurements, WAV samples, screenshots, 6 scripts |
| **G16** | Remote verification | **VERIFIED** | `remote-verification.md` — remote refs read before and after; branch pushed; hashes compared |

## Summary

| Status | Count | Gates |
|---|---|---|
| VERIFIED | 10 | G1, G2, G7, G8, G11, G12, G13, G14, G15, G16 |
| PARTIALLY VERIFIED | 2 | G6, G10 |
| BLOCKED | 4 | G3, G4, G5, G9 |
| NOT TESTED | 0 | — |

## What the scorecard means

**The mission's software objectives are met.** The four silent turns are
explained, fixed, and a 100-turn run leaves zero unexplained silences; the
echo guard no longer discards a person's "no"; delivery is personality-driven
and measured; the runtime survives 30 minutes of continuous synthesis and
recovers from a killed worker.

**The experience objectives are not met, and are not claimed.** Four gates need
a microphone and a speaker, which this container does not have. That is not a
code defect, and no simulated run is offered as a substitute. M23.0 is
therefore **not** qualified as a demonstrated human conversational experience.

## Promotion recommendation

**Do not promote.** The branch is qualified as an engineering advance over
M22.9 — strictly better on silent turns and interruption handling, with
regression evidence — but the mission's definition of success ("LÉLU can
participate in a real human conversation") requires gates G3–G5 and G9, all of
which are BLOCKED. Promoting now would convert four honest BLOCKED gates into
an implied success.

Recommended next step: execute `physical-audio-acceptance.md` and
`five-minute-human-conversation.md` on a machine with a headset, then re-score.
