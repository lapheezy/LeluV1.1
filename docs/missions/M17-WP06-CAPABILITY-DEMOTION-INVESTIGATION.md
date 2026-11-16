# M17 / WP06 — Why measurement demotes a real Intel Iris Xe to `light`

**Status:** investigation complete, fix **applied** on this branch (see §9 for what
was actually changed). Raw numbers:
[`artifacts/perf/m17-wp06-p03/capability-investigation.json`](../../artifacts/perf/m17-wp06-p03/capability-investigation.json).

The operator-reported symptom: a machine with a real GPU — an Intel Iris Xe,
correctly read from `WEBGL_debug_renderer_info`, correctly *not* matched by the
software-renderer regular expression — ends up profiled `light` with the best
possible reason string, `measurement:slow`, and the cosmos stops painting. This
document says exactly how that happens, whether the measurement is wrong, and
what the smallest change that fixes the behaviour is.

---

## 1. The chain, with line references

| step | where | what it does |
| --- | --- | --- |
| capability | `GenesisScene.tsx:probeWebGL()` | reads `UNMASKED_RENDERER_WEBGL` once from a throwaway context; `webgl: true`, renderer `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics … D3D11)` |
| initial profile | `SceneRenderManager.ts:profileFor()` | regex does not match, no Save-Data, wide viewport ⇒ ceiling and profile `full`, reason `capability` |
| sampling | `AdaptiveQuality.tsx:81-82,115` | one sample per ≥1000 ms window from `useFrame`; `reportFrameRate(fps, mode === "full")` |
| ladder | `SceneRenderManager.ts:86-96,268` | `SLOW_FPS = 30`, `DOWNGRADE_AFTER = 3`, `UPGRADE_AFTER = 15`; `nextProfile` steps one rung per 3 consecutive slow samples |
| consequence | `GenesisScene.tsx:613-614` | `paintWorld = (!softwareGL \|\| perfWorld) && profile !== "light"`; `frameloop = paintWorld ? budgetedFrameloop : "never"` |

Two rungs, two 3-second windows, and the second one is irreversible:

```
full ──3 slow samples──▶ balanced ──3 slow samples──▶ light   (frameloop "never")
```

At `light` the canvas no longer runs a frame loop, and `AdaptiveQuality` lives
*inside* that loop. The only thing that could justify leaving `light` — the next
measured second — is produced by the loop that `light` turned off. In automatic
mode the verdict therefore holds for the life of the surface. Recovery requires a
surface change (`reassessCapability` with different `narrow`), an explicit
`?render=gpu`, or a reload.

## 2. Is the measurement wrong? No.

Measured on this host at 1024×768, `dpr` 1:

- **`about:blank` in the same tab: 60 rAF/s** (152 frames / 2514 ms). The tab's
  frame clock is healthy, so this is *not* a starved or throttled browser
  clock — the confound that would have made the sample invalid is absent.
- **Automatic mode, untouched page: `profile: "light"`, `reason:
  "measurement:slow"`, `ceiling: "full"`, `worldPainting: false`, `fps: 0`,
  `frames: 21`, `dpr: 1`, `calls: 223`, `triangles: 226 402`** twenty-five
  seconds after navigation. 21 painted frames in that window is ≈0.8 fps.
- **`?render=balanced` (the override holds the floor): still painting,
  `dpr: 1`, 384–415 draw calls, ~260 k triangles, 3 frames in 16.5 s = 0.18 fps**,
  and `demotionsHeld` rose 2 → 3, i.e. the automatic policy was still trying to
  step down and was being held.

So the frame rate the ladder sees is real. The canvas genuinely paints a fraction
of a frame per second on this adapter. The defect is not that the policy misreads
a capable GPU; it is that the policy has only three rungs and the bottom one is
"show no world", so *every* slow machine is pushed to it — and can then never
leave.

## 3. What is actually wrong, ranked

1. **The destructive step is taken on the same evidence as the cheap one.**
   `full → balanced` costs some animation; `balanced → light` removes the world.
   Both need 3 consecutive slow samples. A shader compile on first mount, a
   garbage collection, or a screenshot is enough to take a machine that would
   have settled at 45 fps to a permanently empty canvas. This is the
   real-hardware hazard, and this host shows the mechanism at full scale.
2. **`light` is absorbing.** No frames means no samples, so the automatic policy
   can never revisit its own verdict. The one state that most needs re-checking
   is the one that disables the evidence.
3. **There is no rung between "animate" and "nothing".** A device that paints
   slowly is treated as a device that cannot paint. For the class this mission
   cares about — real GPU, constrained session, remote desktop, thermal limit —
   the honest outcome is *the same world, fewer paints*, which is what
   `balanced` already means and what `frameloop: "demand"` can mean.
4. **Not a cause but the pressure behind it:** the cosmos view costs 384–415 draw
   calls / ~260 k triangles at 1024×768 (223 / 226 k on the home surface). No
   profile demotion makes that faster; it only hides it. Scene cost is a
   separate mission and is deliberately out of scope here.

## 4. Proposed fix — demote the cadence, not the world

Three small, independent pieces. Together: ~25 lines of source in two files, two
existing test expectations updated, four tests added.

### 4.1 A measured `light` keeps the canvas mounted, painting on demand

`light` arrived at by *measurement* (ceiling above `light`) is a statement about
speed, not about ability. So the canvas keeps its scene, camera and identity and
stops its continuous loop:

```ts
// GenesisScene.tsx — replaces the two lines that used to be at 613-614
const canPaintAtAll = !softwareGL || Boolean(perfWorld);
// A measured "light" is about speed; a capability "light" (software, no
// WebGL, Save-Data) is about ability — and only that one may leave nothing.
const measuredLight = profile === "light" && renderState.reason === "measurement:slow";
// `demand` only where the BUDGET would let it paint at all: a covered or hidden
// world is still "never", so this changes the cadence, never the right to draw.
const staticWorld = canPaintAtAll && measuredLight && budgetedFrameloop !== "never";
const paintWorld = canPaintAtAll && profile !== "light";
const frameloop: Frameloop = paintWorld
  ? budgetedFrameloop
  : staticWorld
    ? "demand"
    : "never";
```

r3f's `demand` loop paints on pointer/invalidate and then idles, so the cost of
the world becomes zero when nothing is happening and *non-zero when the user acts*
— which is exactly the compromise the override makes today, without requiring the
operator to know about `?render=gpu`. The DOM sky is untouched: it already runs at
its own 80 ms cadence at `light` (`skyPaintInterval`), so the scene does not look
dead.

Measured cost of this change on this host: the `?render=balanced` run above is the
same code path at the same resolution — 0.18 fps of continuous animation. Under
`demand` those frames are spent only when the camera or the selection changes.

### 4.2 The destructive rung has to be earned

```ts
// SceneRenderManager.ts
export const DOWNGRADE_TO_LIGHT_AFTER = 15;   // contiguous slow samples

export function nextProfile(state, sample, ceiling = "full") {
  …
  if (sample.fps < SLOW_FPS) {
    const slow = state.slow + 1;
    const last = state.profile === "balanced";        // already tried the cheap rung
    const need = last ? DOWNGRADE_TO_LIGHT_AFTER : DOWNGRADE_AFTER;
    if (slow < need) return { profile: state.profile, slow, fast: 0 };
    return { profile: … };
  }
}
```

`balanced → light` then needs 15 contiguous slow seconds instead of 3, and any
non-slow sample resets the count as it already does. A transient cannot remove the
world; a genuinely hopeless device still reaches the bottom rung, just deliberately.

### 4.3 Publish why, so the next acceptance run does not have to guess

`lightSince` (ms epoch, or 0) joins the snapshot; the run toward a demotion is
read on demand through `manager.slowSamples()`, next to the existing
`lastSample()`. It cannot ride the snapshot: the counter moves every measured
second, and rebuilding a snapshot for it would re-render every profile consumer
once a second — the reason the existing counters stay out of it. Both are also
published in `window.__leluRenderStats`. This retires the "0 fps with no
explanation" ambiguity that made WP06-P03's automatic-mode records unreadable.

## 5. Alternatives considered and rejected

| alternative | why not |
| --- | --- |
| Measurement may never reach `light`; `light` becomes capability-only | Simplest rule to state, and correct for a 25 fps machine — but it would pin a 0.2 fps machine to a 0.2 fps cosmos with no yield, which is not better than the DOM sky. Rejected on this host's own evidence. |
| Require `dpr === DPR_MIN` before `light` | Already true here (`dpr: 1` is the desktop floor); it would not change this outcome, and it couples two independent ladders. |
| Suppress samples while the tab's clock is unhealthy | Right guard, wrong cause: the tab runs at 60 Hz. Worth adding later for backgrounded/remote-desktop cases, but it does nothing for the reported symptom. |
| Lower `SLOW_FPS` | Moves the boundary and leaves the irreversible step in place. It would also stop demoting on machines that genuinely need it. |
| Optimise the cosmos (384–415 draw calls) | The real long-term fix, and out of scope: it does not address the absorbing rung, which is what turns a slow machine into an empty one. |

## 6. What the tests now pin

Updated, because they encoded the old 3-second rule for the destructive rung:

- `tests/render-capability.test.ts` — `demote()` now feeds
  `DOWNGRADE_AFTER + DOWNGRADE_TO_LIGHT_AFTER` slow seconds, so the
  re-derivation test and the override-release test still reach `light`, but only
  after the longer run.
- `tests/render-manager.test.ts` — the "does not cascade" comment now says the
  step out of `balanced` needs `DOWNGRADE_TO_LIGHT_AFTER`.
- both files' architecture assertions match the `canPaintAtAll` / `staticWorld`
  framing instead of the old one-line `paintWorld`.

Added:

1. **the step that removes the world needs a far longer run than the step that
   slows it** — 3 slow samples reach `balanced`, the next 14 do not, the 15th
   does; plus `DOWNGRADE_TO_LIGHT_AFTER >= DOWNGRADE_AFTER * 5`.
2. **one healthy second breaks the run toward light** — a transient cannot
   accumulate toward removing the world.
3. **the snapshot publishes why it is demoting, and how long the world has been
   gone** — `lightSince` is set at the step and does not move while the profile
   stays `light`; it is cleared when a new surface re-derives capability.
4. **a measured light keeps the world, painted on demand instead of not at all**
   — the `measuredLight` gate and the `demand` frameloop, asserted in source like
   the rest of the architecture tests.

## 7. Validation plan for whoever applies this

1. Unit: the four tests above, plus the two updated expectations; `npm test`.
2. Capture: at 1024×768 automatic mode, assert `profile` is `balanced` or `light`
   **with `worldPainting` true** and `frameloop` reporting `demand`, then confirm
   the identity capture still measures the same masks (P02/P03 baselines:
   obj_1 18 346 px, obj_2 19 462 px, obj_3 9 535 px at 1024×768 override).
3. Real hardware: a laptop with an integrated GPU and a phone-sized window, where
   the expected outcome is `full` (60 Hz tab, 60 fps canvas) and **no demotion at
   all** — the fix must be invisible there.
4. Software renderer (SwiftShader): unchanged — `light`, `frameloop "never"`,
   DOM sky only. This is the path the change must not touch.

## 9. What was applied

| file | change |
| --- | --- |
| `SceneRenderManager.ts` | `DOWNGRADE_TO_LIGHT_AFTER = 15`; `nextProfile` applies it only when the profile is already `balanced`; `lightSince` in the snapshot; `slowSamples()` read on demand; one `resetAdaptation()` helper so no reset path can forget `lightSince` |
| `GenesisScene.tsx` | `measuredLight` from the manager's reason; `canPaintAtAll` / `staticWorld` (gated on the budget, so a covered world still never draws); `frameloop` is `budgetedFrameloop` → `"demand"` → `"never"` |
| `AdaptiveQuality.tsx` | `slowSamples` and `lightSince` published in `window.__leluRenderStats` |
| `tests/render-manager.test.ts`, `tests/render-capability.test.ts` | §6 |

**Verification performed:** `npx tsc -b --force` clean; `npm run build` clean;
full suite **2301 tests, 2291 pass, 2 fail** — the same two environment failures as
the WP06-P02/P03 baseline (`sandbox-security` network probe, `genesis-interface`
`@excalidraw/excalidraw/index.css`), the extra 4 tests being the ones listed in §6;
the three touched render test files 56/56.

**Not verified:** the demand repaint was not observed in a browser. The preview
build was rebuilt and loaded at 1024×768, the profile correctly settled at
`balanced` with `painting: true`, and then the tab's frame loop froze — `frames`
stuck at 51 for 45 s with `mode: full` — so no interaction could produce a frame
to observe. That is this VM's rendering behaviour at this scene cost, not evidence
for or against the change; the `demand` repaint is pinned by the source assertion
and by r3f's documented `demand` semantics, which are not exercised in a browser
here.

Deliberately unchanged: `profileFor`, the software renderer regex,
`overrideVerdict`, `readRenderOverride`, `SLOW_FPS`, `FAST_FPS`,
`DOWNGRADE_AFTER`, `UPGRADE_AFTER`, the render budget, and the identity capture.
A software renderer still gets `light` and `frameloop "never"`, exactly as before.

## 8. What this document does not claim

- It does not claim a physical device was tested; none is reachable here.
- It does not claim 0.2 fps is acceptable. It claims that a slow device should
  lose *frames*, not the world, and that the irreversible step deserves stronger
  evidence than the reversible one.
- It does not change capability policy: the factory `profileFor`, the software
  regex, the override contract and `?render=gpu` are all left exactly as WP05
  pinned them.
