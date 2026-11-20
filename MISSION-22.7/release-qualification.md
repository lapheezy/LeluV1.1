# M22.7 — RELEASE QUALIFICATION

**Date:** 2026-11-20
**Branch:** `m22.7/live-voice-qualification` (from `afcfd8c7`)
**Canonical:** `543da7c8` — untouched
**Decision:** **CONDITIONALLY APPROVED** — technically sound, live loop proven with simulated input; hardware audition and her real voice are still missing.

---

## 1. Gate scorecard

| Gate | Requirement | Status | Evidence |
|---|---|---|---|
| **G1** | Build and typecheck pass | **VERIFIED** | `tsc -b` 0, `bun run build` 0, lint 0 errors |
| **G2** | Real microphone capture verified | **BLOCKED** (capture path PARTIALLY VERIFIED) | `getUserMedia` + `MediaRecorder` captured 9 VAD turns from Chromium's **simulated** device; no physical microphone |
| **G3** | Real speech recognition verified | **VERIFIED** | 7/7 live transcripts, HTTP 200, Groq Whisper |
| **G4** | Real speech synthesis verified | **VERIFIED** | 6 WAVs, Piper, 1.14–2.46 s, intelligible on round-trip |
| **G5** | Audible playback verified | **BLOCKED** | `play`/`pause`/`ended` observed, audio real — **no audio device**, nothing heard |
| **G6** | Five consecutive voice turns | **VERIFIED** | 7 turns, one session |
| **G7** | Real interruption | **PARTIALLY VERIFIED** | stop ends session + cancels playback; natural barge-in not possible in half-duplex fallback |
| **G8** | Session continuity | **VERIFIED** | topic + context carried across 7 turns; second session works |
| **G9** | Failure recovery | **PARTIALLY VERIFIED** | live ASR fallback (Web Speech → Whisper) and silence rejection; network/429 injection not run |
| **G10** | Voice identity readiness documented | **VERIFIED (documented), identity BLOCKED** | Piper is generic; VoxCPM2 unreachable |
| **G11** | Full regression, no new failures | **VERIFIED** | 2286/2276/2/8, identical to M22.6 |
| **G12** | Evidence independently inspectable | **VERIFIED** | `logs/`, `audio/`, `screenshots/`, `scripts/`, JSON timelines |

## 2. What changed

One file: `plugins/voiceApi.ts` — an opt-in local Piper speaker on the existing TTS route and a truthful `provider` field in status. No dependency, no client change, no new subsystem, no canonical change.

## 3. Why CONDITIONALLY APPROVED rather than APPROVED

| Missing | Consequence |
|---|---|
| Physical microphone | nobody has spoken into hardware; permission prompt, OS device selection and iOS/Safari behaviour untested |
| Speaker / audio device | no human has **heard** her; audibility unproven |
| True barge-in | natural interruption cannot happen while the fallback pauses the mic |
| VoxCPM2 | the voice is not LÉLU's |
| Network/429 fault injection | recovery beyond ASR fallback is unit-level only |

None of these is a code-quality failure; each is hardware or configuration.

## 4. Blocked-by-environment list

1. Physical microphone and speaker (or a loopback sink that can be recorded).
2. A host able to run VoxCPM2 (model + GPU or ≥16 GiB RAM), or an authorized ElevenLabs clone key.
3. `livekit-server` + Python agent for full-duplex claims.
4. Network fault injection on a non-loopback deployment.

## 5. Promotion procedure (when authorized)

1. Check out the candidate, `bun install --frozen-lockfile`, `bun run build`, `npm test`.
2. Run `MISSION-22.7/scripts/prepare-voice-runtime.sh` on a machine with audio hardware.
3. Run the harness with the fake-device flags removed and a person speaking; record audio and screen.
4. Sign G2, G5 and G7; then fast-forward canonical to the verified SHA or merge a PR.
5. Never force-push or rewrite canonical.

## 6. Known defects to carry forward

- Reply queue drift under continuous input (reply may answer an earlier transcript).
- Markdown symbols and emoji names are read aloud.
- Half-duplex fallback prevents barge-in.
- `tests/genesis-interface.test.tsx` still failing (pre-existing).

## 7. Decision

**CONDITIONALLY APPROVED.** The candidate is safe to keep and safe to promote **after** a hardware voice audition signs G2/G5/G7. It is not approved as "LÉLU has a working voice" today, and it does not claim to be.
