# Renderer measurements — Mission 44.3 (WP02)

Cloud browser: Chromium, software GL (`swiftshader`), no GPU. Page: the real app at
`https://pv-08af6cc9ef21-…freebuff.site/` (dev server `vite`, port 3001).
Viewport 1024×768. Instrumentation injected with `Runtime.evaluate` (preview tool):

- `PerformanceObserver({ entryTypes: ["longtask"] })` — main-thread tasks ≥ 50 ms;
- `requestAnimationFrame` deltas;
- `WebGLRenderingContext.prototype.clear` per canvas (which canvas paints, how often);
- `readPixels` / `toDataURL` / `drawElements` / `drawArrays` counters (readbacks and GL cost).

## 1. What was NOT the cause

| Hypothesis | Measured | Verdict |
|---|---|---|
| Synchronous GPU readback in the app | `readPixels` 0, `toDataURL` 0 over ~15 s idle | not the cause |
| `preserveDrawingBuffer` | only in `Procedural3DPipeline`, `VisualViewer` (studio, not mounted) | not the cause |
| The v1 world canvas painting | never cleared in any sample; `profile: "light"` forces `frameloop="never"` | correctly guarded |
| DOM static-noise `putImageData` | runs at the light cadence (80 ms), 130k px ≈ 3.6 ms, documented measurement | not the cause |
| React render storm | `__leluRenderLedger.chat` = 8,624 renders / 156 s ≈ 55/s across consumers at the designed 5 publishes/s | by design, not the hang |

## 2. The cause, isolated by measurement

Idle, after load, before any fix:

```
long tasks (ms):  1265, 114, 56, 1214, 80, 1203, 60, 1171, 1177
rAF deltas (ms):  1933, 1600, 1633, 1617
GL draw calls:    90 in 4.7 s with drawMs = 0  (cost is CPU-side three.js work)
```

Per-canvas paint count over 5.6 s (wrapping `clear`):

```
{ "325x474": 9 }        ← the avatar canvas
(no 1024x768 / 480x270 clears at all)
```

So: **the world was correctly not painting; the avatar was painting ~1.6 fps and
each frame cost ~1.1 s on the software rasteriser**, which is the whole main thread.
That matches the code's own warning in `LeluCharacter3D` (`FrameCap` comment) about
a skinned, morphing character re-uploading bone/morph textures every frame.

Context-loss isolation (losing the 1024×768 world context) left the 325×474 clears
in place, confirming the avatar as the painter; the profile was `light` throughout.

## 3. Why the profile did not stop it

`SceneRenderManager` documents `light` as "no continuous WebGL at all". Only
`GenesisScene` (v1 world) implemented that (`frameloop="never"`). The avatar's
`FrameCap` consulted the *budget* (paused / reduced) but never the *profile*, so on
a software rasteriser it kept asking for 24 frames a second. `GenesisV2Scene3D`
(206,700 triangles, 146 draw calls) had the same omission.

## 4. Fix and the same measurement after it

`paintsContinuousFrames(profile)` in `SceneRenderManager` (pure, unit-tested) is now
consulted by the avatar's `FrameCap` and by the v2 world's frameloop.

Same browser, same page, reloaded, steady state after the fix:

```
clears per canvas over 4 s:   {}            ← nothing painting continuously
long tasks over 4 s:          [53]          ← one 53 ms task
rAF deltas (ms):              367, 383, 367, 400, 417, 450, 767
```

Main thread is free: `preview_playwright` — which failed every time in Mission 44.2
with `connectOverCDP: Timeout 10000ms` — connected on the first attempt, and a real
chat turn completed end-to-end in 7.2 s (question → model → lab tools → answer).

## 5. What this does and does not prove

- **Proven:** the hang was the avatar's continuous WebGL on a CPU rasteriser; the
  fix removes continuous painting on a `light` profile and the main thread stays free
  under the same workload (chat turn, landscape resize, screenshots).
- **Not proven:** physical-device behaviour. This is browser emulation with a
  software rasteriser and no GPU; a real GPU never took this path (`light` is only
  chosen for software renderers, Save-Data, or a measured sub-30 fps).
- **Still slow, honestly:** rAF deltas of 367–767 ms after the fix are the software
  compositor, not the main thread. `Runtime.evaluate` returns immediately and the
  chat turn completes; the *frame rate* of this container remains low because there
  is no GPU.
