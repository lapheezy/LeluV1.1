# WP04 — Mobile and desktop integration

Runtime: the real built app served by `bun server.ts` (local Piper voice,
Groq Whisper through the server relay, the app's normal model providers;
ElevenLabs and Anthropic keys were **removed from the server's environment**
for every run). Browser: Chromium (Playwright build 1243). **Microphone:
simulated** (`--use-file-for-fake-audio-capture`). **Speaker:** none — "audio"
below means the browser reported playback events, not that anyone heard it.

## Real interface found

The primary chat surface is **Chat Universe** (`ChatUniverse.tsx`), not the
older Genesis composer the earlier harnesses targeted. Its microphone button:

* **Before:** fixed label "Talk to LÉLU", no pressed state, no visual state —
  the UI could not tell the user whether the microphone was on. *Defect.*
* **After:** `aria-pressed`, label "Stop listening" / "Microphone paused — stop
  voice", highlighted while live (pink) or suspended (amber),
  `data-lelu-voice-capture="off|live|suspended"` from the engine's real state;
  voice is pointed at the conversation the composer targets (same rule as a
  typed send); 44 px touch target on coarse pointers (was 36 px).
* Genesis composer (`GenesisChat.tsx`): mic can always be turned **off**
  (was disabled during a typed reply); status "microphone paused" when
  capture is suspended.

## Desktop (1440×900) — `logs/e2e-desktop.json`, screenshots `desktop-*`

| Check | Result |
| --- | --- |
| Mic button starts the session | VERIFIED — 1 `getUserMedia`, phase `listening` at +0.5 s |
| Listening indicator follows real state | VERIFIED — `data-lelu-voice-capture` `off → live → off` |
| Speaking indicator follows playback | VERIFIED — phase `speaking` from first synthesis until playback drained or barge-in (`phases` timeline in the log) |
| Interrupt her | VERIFIED — 2/2 barge-ins over her speech (`bargeInFromPhase`) |
| Return to typed chat | VERIFIED — typed message in the same window/conversation (`desktop-05-typed-handoff.png`) |
| Same conversation | VERIFIED — all 10 messages in one MultiChatStore conversation |
| Chat responsive during voice | VERIFIED — typed send accepted while voice active |
| Mic not falsely shown active | VERIFIED — after end: `active:false`, button `off`, all tracks `ended` |
| Overlays | none over the mic (`elementFromPoint` hits the mic) |

## Mobile emulation (iPhone 13 profile on **Chromium**, 390×664 visual viewport, touch) — `logs/e2e-mobile.json`, screenshots `mobile-*`

| Check | Result |
| --- | --- |
| Tap the mic (touch) | VERIFIED — `tap()`; one stream |
| Control in viewport, unobstructed | VERIFIED — 44×44 px at (284,546); `elementFromPoint` → mic svg |
| Voice turn | VERIFIED — transcript → first audible 735 ms (final run) |
| End while she is speaking | VERIFIED — `speaking → idle`, track `ended` |
| Real provider outage on the phone layout (earlier run) | handled — "offline mode" notice shown, not spoken; next turn answered and spoken |

## iOS Safari / installed PWA — **NOT TESTED** (no Apple hardware)

What the code now does on those platforms, and what it cannot do:

* Backgrounding / screen lock: iOS ends or mutes capture. The engine keeps the
  session intent, shows "microphone paused", does **not** attempt to re-acquire
  from a hidden page, and re-acquires on `visibilitychange → visible`. Whether
  iOS grants `getUserMedia` again without a fresh gesture on return (it
  usually does within the same page session; installed PWAs have historically
  re-prompted) is **unverified**.
* Calls / Siri: `mute` → `micInterrupted`; `ended` → re-acquire with retry
  (0/1/3 s), then an honest `audio` error.
* Denial: one prompt only (the old code re-prompted Safari users after "Don't Allow").
* Continuous background listening on iOS: **not possible on the web** and not claimed.
* Emulation caveat: the "mobile" run is Blink with an iPhone user agent and
  viewport. It proves layout and touch wiring only, not WebKit audio behaviour.
