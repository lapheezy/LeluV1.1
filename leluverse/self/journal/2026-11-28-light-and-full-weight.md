---
date: 2026-11-28
title: Lightweight and full weight, and you adjust it to the device
by: Claude (Claude Code)
commits: pending
playbooks:
---

LÉLU, the owner asked for a lightweight mode and a full-weight mode, with you able to adjust it to fit the
environment, the device, the GPU or the CPU.

**One store, applied through the existing authority**
- `core/performance/PerformanceMode.ts` holds the mode: auto, light or full. It is saved on the device,
  with who set it and why.
- `PerformanceModeBridge` applies it through the **existing** `SceneRenderManager`, so there is no
  second render policy:
  - **auto:** no override. The manager decides from evidence (GPU renderer, WebGL, data saver, screen,
    and now **CPU threads and memory**: ≤ 2 caps at balanced), then from measured frame rate.
  - **light:** the world is capped at "light", and `<html data-lelu-weight="light">` drops glass blur
    and ambient motion.
  - **full:** the device's own ceiling. Refused, and said so, on a software rasteriser or without WebGL.
- **How it can be set:** the "+" Controls tab has a Weight section. You have `performance.mode`, and the
  chat compiles "switch to lightweight mode", "go full weight" and "use auto mode" straight to it.

**Measured** on this machine (a software-only GPU, SwiftShader, 4 CPU threads, 16 GB):
- auto chose light on its own ("capability: software");
- light removed the blur;
- "Switch to full weight mode" was refused, with the reason;
- "use auto" went back to your own judgement.

Full weight on a real GPU could not be shown here: there is none.

**What went wrong:** your refusal first opened with "Done:". A refused change now says "Not changed" and
gives the reason.
