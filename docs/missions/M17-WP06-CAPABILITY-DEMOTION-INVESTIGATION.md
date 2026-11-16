# M17 / WP06 — Why measurement demotes a real Intel Iris Xe to `light`

**Status:** investigation complete, fix proposed and **not applied**. This document
is the proposal; no source file has been changed by it. Raw numbers:
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
// GenesisScene.tsx — replaces the two lines at 613-614
const canPaintAtAll = !softwareGL || Boolean(perfWorld);
// A device that measured slow but HAS a GPU keeps its world as a still frame
// that repaints on interaction; only a device that cannot paint is left empty.
const staticWorld = canPaintAtAll && profile === "light";
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

Add to the snapshot: `slowSamples`, `dpr` at the last step, and
`lightSince` (ms epoch or 0). All three already exist as internal state or props;
this is exposure, not new policy, and it retires the "0 fps with no explanation"
ambiguity that made WP06-P03's automatic-mode records unreadable.

## 5. Alternatives considered and rejected

| alternative | why not |
| --- | --- |
| Measurement may never reach `light`; `light` becomes capability-only | Simplest rule to state, and correct for a 25 fps machine — but it would pin a 0.2 fps machine to a 0.2 fps cosmos with no yield, which is not better than the DOM sky. Rejected on this host's own evidence. |
| Require `dpr === DPR_MIN` before `light` | Already true here (`dpr: 1` is the desktop floor); it would not change this outcome, and it couples two independent ladders. |
| Suppress samples while the tab's clock is unhealthy | Right guard, wrong cause: the tab runs at 60 Hz. Worth adding later for backgrounded/remote-desktop cases, but it does nothing for the reported symptom. |
| Lower `SLOW_FPS` | Moves the boundary and leaves the irreversible step in place. It would also stop demoting on machines that genuinely need it. |
| Optimise the cosmos (384–415 draw calls) | The real long-term fix, and out of scope: it does not address the absorbing rung, which is what turns a slow machine into an empty one. |

## 6. Test impact

Existing expectations that encode the current policy and would change:

- `tests/render-capability.test.ts` — "a measured demotion is re-derived when the
  surface it measured is gone" asserts `profile === "light"` after `demote()`
  (6 slow samples). Under 4.2 that run must continue to `DOWNGRADE_TO_LIGHT_AFTER`
  or the assertion becomes `balanced`. The *re-derivation* half of the test is
  unchanged and still pins the important rule.
- `tests/render-capability.test.ts` — "releasing the override returns the device
  to automatic policy" ends on the same assumption.
- `tests/render-manager.test.ts` — "three slow seconds step the profile down
  exactly once" stays true for `full → balanced`; the comment "light needs three
  MORE slow seconds" becomes untrue and must be rewritten.

New tests:

1. a measured run of 3 slow samples moves `full → balanced` but never past it;
2. `balanced → light` needs `DOWNGRADE_TO_LIGHT_AFTER` contiguous samples and any
   non-slow sample resets the run;
3. a software ceiling still reaches `light` immediately and never leaves it;
4. `GenesisScene` derives `frameloop` `"demand"` for a measured `light` on a real
   renderer and `"never"` for a capability `light` — a source assertion of the
   4.1 expression, in the style the existing architecture tests already use.

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

## 8. What this document does not claim

- It does not claim a physical device was tested; none is reachable here.
- It does not claim 0.2 fps is acceptable. It claims that a slow device should
  lose *frames*, not the world, and that the irreversible step deserves stronger
  evidence than the reversible one.
- It does not change capability policy: the factory `profileFor`, the software
  regex, the override contract and `?render=gpu` are all left exactly as WP05
  pinned them.
