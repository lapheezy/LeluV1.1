# M22.6 — BUILD AND TYPECHECK

**Date:** 2026-11-19
**Branch:** `freebuff/m22-6-voice-runtime-release-qualification`
**Base candidate:** `8aa24ce156531fa4500580a69b748ad0de473f1e` (M22.5)
**Verdict:** **VERIFIED — the build and typecheck now pass.**

---

## 1. Reproducing the blocker

At the M22.5 candidate, `npx tsc -b --force` failed with exactly two errors, both on the same line:

```
src/core/perception/FeatureUnderstanding.ts(455,20): error TS18047: 'landmarks.measurements.count' is possibly 'null'.
src/core/perception/FeatureUnderstanding.ts(455,20): error TS2365: Operator '<' cannot be applied to types 'string | number' and 'number'.
```

Reproduced at `8aa24ce1` before any M22.6 edit (`TSC_EXIT=2`). It is not a voice error and not caused by the M22.5 learning repairs.

## 2. Root cause

`FeatureObservation.measurements` is deliberately heterogeneous:

```ts
measurements: Record<string, number | string | null>;
```

It carries counts, ratios, and labels in one bag. Line 455 compared a member of it directly:

```ts
if (landmarks && landmarks.measurements.count < 468) …
```

That is a real contract violation, not a compiler nuisance. At runtime the comparison silently coerced:
`null < 468` is `true` (0 < 468), and a string count would be coerced numerically or become `NaN`. The code appeared to work only because `count` is normally written as a number at `loadObservation` (`measurements: { count: … ?? 0 }`).

## 3. Repair

One helper, next to the existing `number()` coercion:

```ts
function numericMeasurement(feature: FeatureObservation | undefined, key: string): number | null {
  return number(feature?.measurements[key]);
}
```

- Line 455 now asks for a number and treats an absent one as `0`, **preserving** the previous behaviour for a landmark feature with no count (it is still flagged as insufficient evidence).
- The adjacent strategy string used the same untyped field; it now uses the helper too, so the displayed count is never `[object Object]`/`NaN`.

No `any`, no `as`, no `@ts-ignore`, no compiler-setting change. Type safety is stronger after the edit: a non-numeric measurement can no longer flow into a numeric comparison.

## 4. Verification

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -b --force` | **exit 0** |
| Production build | `bun run build` (`tsc -b && vite build`) | **exit 0**, built in 22.22 s |
| Perception tests | `tests/perception-understanding.test.ts` | **11/11 pass** |
| Lint | `npm run lint` | **0 errors** (175 pre-existing warnings) |

The build emits only pre-existing Vite `INEFFECTIVE_DYNAMIC_IMPORT` notices from `ArchitectureMap.ts`; they are warnings, not failures.

## 5. The two full-suite failures from M22.5

M22.5 reported `2263 pass / 2 fail / 8 skip`. Both failures were re-checked independently at the start of M22.6 by reverting the six M22.5 source files and running the two files alone: **both still failed**, so neither was introduced by the learning repairs.

| Test | Behaviour | Classification |
|---|---|---|
| `tests/genesis-interface.test.tsx` | file-level `test failed` (~2.4 s) | **Pre-existing, undiagnosed.** Not caused by this mission; the M22.6 suite also reports it. |
| `tests/sandbox-security.test.ts` → "network: TCP, UDP, DNS and fetch all fail" | sandbox printed `''` instead of `denied:*` | **Environmental.** The test's own header says network-namespace isolation depends on the host (`unshare -rn`); in this container the attempt produced no output at all. |

Neither test is in the voice, memory, execution or build path. They are **not** removed, skipped, or weakened; they remain red and are counted as red in [regression-and-release-qualification.md](regression-and-release-qualification.md).

## 6. What the build result does and does not prove

- **Proves:** the TypeScript program is sound under the project's existing strict settings, and Vite can produce a production bundle at this commit.
- **Does not prove:** that the app's browser behaviour is correct. No browser could launch in this container (see [environment-and-provider-readiness.md](environment-and-provider-readiness.md)).
