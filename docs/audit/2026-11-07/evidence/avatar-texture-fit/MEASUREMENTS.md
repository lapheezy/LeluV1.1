# Avatar texture upload: measured on iPhone 13 emulation (Chromium)

Script: `avatar-uploads.mjs`. It counts WebGL contexts created and texture bytes passed to `texImage*`, attributed per canvas. The flow is Home → Chat Universe → conversation → Universe → Home, then a second round.

| Step | Before: contexts / MB (avatar MB) | After: contexts / MB (avatar MB) |
|---|---|---|
| 1. Home, her model ready | 10 / 252 (240) | 10 / 104 (96) |
| 5. Home again | 20 / 504 (480) | 20 / 212 (192) |
| 6. Home after a 2nd round | 29 / 996 (960) | 30 / 320 (288) |

- The avatar accounts for about 95% of the uploads; the Cosmos scene accounts for 8–12 MB per mount.
- **After the fix, each return to Home costs about 108 MB instead of about 250–500 MB.**
- Her detail is unchanged at the phone hero size (162×166 CSS px): see `hero-before-left-after-right.jpg`. The pose differs only by animation timing.

## Still open

Each return to Home still creates new WebGL contexts and re-uploads her textures. The face, hero and window presences each mount their own `LeluCharacter` canvas.

Removing that needs **one persistent avatar canvas**, positioned over whichever slot is active. That belongs to the avatar pipeline, which is marked "Owner to confirm: Session 3D" in `BRANCH-OWNERSHIP-MAP.md`, so it is left to that owner.
