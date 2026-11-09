# Presence beside a phone's full-screen sheet (iPhone 13 emulation)

Setup: Chat Universe → New chat (a full-screen conversation sheet). Page frame rate is sampled in 5-second windows over 60 seconds (`sheet-fps.mjs`).

| Variant | Page fps (5 s windows) | Avatar frames/s | Visible |
|---|---|---|---|
| Presence **off** (`sheet-fps-off.mjs`) | 60 throughout (min 59.6) | 0 | no |
| Presence live at 12 fps | 50–59, then **0, 0, 0** (stall after about 15 s) | 1.8 | no (hidden by the Universe CSS rule) |
| "Still" (one frame per size change) | 48–59, then **0, 0, 0** | 7.2 | no |
| **Final: paused + one captured frame, above the sheet** | **60 throughout (min 59.4)** | **0** | **yes** (right edge, clear of header, spatial bar and composer) |

## Root causes found on the way

1. Any drawing of her canvas beside the sheet stalls the page in this software-GL browser. The final design pauses her (`frameloop="never"`) and shows one captured frame.
2. A rule from an earlier integration in `chatUniverse.css` hid the companion while the Universe was open, because the old floating window covered the chat. It was removed for the presence only; `.lch`, `.lch-scrim` and `.lsn` stay hidden.
3. A z-index tie with the sheet (both 521). She now sits at `CHAT_WINDOW_Z + 10`, only under a phone sheet.

## 1920×1080 (`fps1920.mjs`)

- Home itself runs at **1 fps** in this environment.
- With chat open, presence **on**: 21–26 fps.
- Presence **off**: also stalled (no frames for 15 s or more) before recovering.

So the 1920 stalls are not caused by the presence.
