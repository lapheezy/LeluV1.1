# M22.7 — REGRESSION RESULTS

**Baseline:** M22.6 candidate `afcfd8c7` (2286 tests · 2276 pass · 2 fail · 8 skip; voice 76/77; learning 73/73).

---

## 1. Totals

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -b --force` | **exit 0** |
| Lint | `npm run lint` | **0 errors, 174 warnings** (M22.6: 176 warnings) |
| Voice + M22.6 suites | `tests/voice-*.test.ts` + `asr-provenance` + `knowledge-supersession` + `execution-mission-scope` | **87 tests · 86 pass · 0 fail · 1 skip** (baseline 77/76/0/1; +10 from the extra M22.6 files) |
| Full suite | `npm test` | **2286 · 2276 pass · 2 fail · 8 skip**, 247 s |

Full-suite totals are **identical to M22.6**: +0 tests, +0 failures. The only product change is one server module (`plugins/voiceApi.ts`), which has no test of its own; it is covered by the live acceptance and by typecheck/lint.

## 2. The two failures (unchanged, pre-existing)

| Test | Classification |
|---|---|
| `tests/genesis-interface.test.tsx` | pre-existing, undiagnosed; fails identically at M22.5, M22.6 and M22.7 |
| `tests/sandbox-security.test.ts` network probe | environmental — host lacks network-namespace isolation, probe returns `''` |

Neither is related to voice, and neither assertion was touched. No test was removed, skipped or weakened.

## 3. New verification in M22.7

| Check | Result |
|---|---|
| Local TTS route | `POST /api/voice/tts` → 200 `audio/wav`, 2.51 s, `X-Lelu-Voice-Provider: local-piper:amy-low` |
| Status surface | `/api/voice/status` → `configured:true, provider:"local-piper", localVoice:true` |
| Browser boot | `StartupDiagnostic 15/15`, `BOOTSTRAP_DONE` |
| Live voice loop | 7 transcripts · 6 WAV replies · 6 playbacks |
| Audio intelligibility | round-trip Whisper transcription matches spoken text |
| Screenshots | 4 captured |

## 4. Reproduce

```bash
bash MISSION-22.7/scripts/prepare-voice-runtime.sh
bun install --frozen-lockfile && bun run build
npx tsc -b --force && npm run lint && npm test
PORT=4180 LELU_LOCAL_TTS_BIN=$PWD/.piper/piper/piper \
  LELU_LOCAL_TTS_MODEL=$PWD/.piper/voices/amy-low.onnx bun run server.ts &
node MISSION-22.7/scripts/voice-acceptance.mjs 45
```
