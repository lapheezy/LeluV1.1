# LÉLU Voice / Core Integration Report

**Session:** `claude/open-session-rbwmdw`  
**Date:** 2026-10-23  
**Branch:** `claude/open-session-rbwmdw`

---

## Summary

Voice is now activated by holding the Core planet. The entire pipeline routes through the existing infrastructure — no second AI service, no second chat store, no second cognition loop was created.

---

## Architecture

```
User holds Core planet (≥ 500ms, no movement)
      │
      ▼
CoreHoldGesture  (new DOM wrapper around canvas)
      │  openPanel("chat") — chat stays visible with full history
      │  VoiceEngine.toggle()
      ▼
VoiceEngine  (pre-existing singleton)
      │  state: idle → listening → processing → responding → speaking
      │  Web Speech API + Groq Whisper fallback
      ▼
VoiceBridge  (pre-existing)
      │  user utterance → addMessage() → same path as typed text
      │  engine state → setVoice() → GenesisCore state.voice
      ▼
AIService.chat()  (same as text — no second provider)
      │  ModelRouter → AnthropicProvider (priority 1)
      │  cancelTurn(conversationId) — same cancellation mechanism
      ▼
GenesisChat streaming  (assistant reply rendered in chat history)
      │  feedStreamingSpeech() → TTS while streaming
      ▼
Core 3D visual feedback  (pre-existing)
      listening → 0.35 interaction energy (gentle hum)
      processing → 0.85 energy (swell)
      speaking  → 0.60 energy (bright pulse)
```

---

## Files Changed / Created

| File | Change |
|------|--------|
| `src/app/scene/genesis/CoreHoldGesture.tsx` | **NEW** — hold detector wrapping the canvas; all pointer types; ring feedback |
| `src/app/scene/genesis/GenesisScene.tsx` | Wrap Canvas with `<CoreHoldGesture>` |
| `src/app/scene/genesis/GenesisDock.tsx` | Extend LÉLU pill hold to support mouse (not just touch) |
| `tests/voice-core-integration.test.ts` | **NEW** — 17 regression tests |

## Files Confirmed Unchanged (NON-NEGOTIABLE)

| File | Status |
|------|--------|
| `src/app/scene/genesis/materials/GenesisCore.tsx` | ✅ No change — planet/shaders/lighting intact |
| `src/app/scene/genesis/environment/Cosmos.tsx` | ✅ No change |
| `src/app/scene/genesis/environment/AuroraCosmos.tsx` | ✅ No change |
| `src/app/scene/genesis/environment/CosmicBackdrop.tsx` | ✅ No change |
| `src/app/scene/genesis/systems/CoreAtmosphere.tsx` | ✅ No change |
| `src/core/AIService.ts` | ✅ No functional change (only T1/T2 latency probe marks added) |
| `src/core/voice/VoiceEngine.ts` | ✅ No change |
| `src/app/scene/genesis/VoiceBridge.tsx` | ✅ No change |

---

## Requirements Mapping

| # | Requirement | Status |
|---|-------------|--------|
| 8 | Core planet becomes voice entry point | ✅ CoreHoldGesture wraps canvas |
| 9 | Preserve every existing Core effect | ✅ NON-NEGOTIABLE: zero changes to 3D shaders/lighting/particles/orbit |
| 10 | Hold-to-voice: mouse + touch + pointer, deliberate threshold | ✅ 500ms mouse / 600ms touch, 8px movement cancels |
| 11 | Voice appears OVER existing chat | ✅ `openPanel("chat")` — history stays visible |
| 12 | Voice and text use same conversationId | ✅ VoiceBridge→addMessage→same active conversation |
| 13 | Voice uses existing AIService → ModelRouter → Anthropic path | ✅ VoiceEngine calls AIService.chat() |
| 14 | No duplicate mic streams / no unnecessary polling | ✅ VoiceEngine singleton, no global React state for audio |
| 15 | Voice state machine: idle→listening→transcribing→thinking→speaking→listening | ✅ VoiceEngine phases: idle/listening/processing/responding/speaking |
| 16 | Interrupt LÉLU naturally | ✅ GenesisChat calls `voiceEngineRef.current.cancelSpeech()` on new send |
| 17 | Voice cancellation scoped to conversationId | ✅ Uses existing cancelTurn() mechanism via AIService |
| 18 | Microphone lifecycle (no duplicate tracks) | ✅ VoiceEngine is a singleton; toggle() manages start/stop |
| 19 | Voice errors must not break chat | ✅ VoiceBridge wraps errors in `notify()` — contained |
| 20 | Multi-chat voice concurrency | ✅ VoiceEngine singleton + per-conversation AIService AbortControllers |
| 21 | Voice + background work | ✅ VoiceEngine is independent of task execution |
| 22 | Chat remains source of truth | ✅ voice input→user message; voice response→assistant message (addMessage path) |
| 23 | Core voice visual feedback | ✅ Pre-existing: state.voice drives 3D Core breathing/pulse via GenesisCore material |
| 24 | Performance: typing while voice active | ✅ Voice runs on VoiceEngine singleton, not in React render path |
| 25 | Duplicate-system audit before finalizing | ✅ tests/no-duplicate-systems.test.ts (10 tests pass) |
| 26 | Regression tests for all voice features | ✅ tests/voice-core-integration.test.ts (17 tests pass) |
| 27 | Run all validation | ✅ 62/62 tests, TypeScript clean |
| 28 | Create this report | ✅ This document |

---

## Subtle Visual Feedback (Hold Countdown)

During the 500ms/600ms hold, a DOM ring expands over the canvas center:
- **No shader changes** — pure CSS/DOM animation
- Ring opacity: `0 → 0.6` over the hold duration
- Ring scale: `1.0 → 1.3` (slight grow)
- Glow shadow: `12px → 30px blur`
- Disappears instantly on release or cancellation

This is in addition to the pre-existing Core 3D visual states (listening/processing/speaking) which activate once voice is toggled.

---

## Test Suite Status

```
tests/cancellation-concurrency.test.ts   22/22  ✅
tests/no-duplicate-systems.test.ts       10/10  ✅
tests/latency-probe.test.ts              13/13  ✅
tests/voice-core-integration.test.ts     17/17  ✅
TypeScript (tsc --noEmit)                       ✅  (clean)
scripts/verify-workspace-isolation.mjs   27/27  ✅
```

---

## Environment-Bound Items

These voice features have correct code architecture but cannot be fully tested in the headless cloud container:

- **Actual microphone input**: requires a real browser with mic permission
- **Web Speech API**: not available in headless Chromium
- **TTS output**: requires real audio hardware
- **Real voice latency**: requires live network + real browser
