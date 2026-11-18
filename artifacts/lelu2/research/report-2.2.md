# LÉLU 2.2 — continuous observation, research and knowledge

**Branch** `experiment/lelu-2-golden-geometry` · **base** `4512e946`
**Session** `S-2026-11-18` · **Acceptance** 11/11 (`artifacts/lelu2/research/acceptance.json`)

## The commit that was asked for

`8b694bf` does not exist in this repository. It is not in the object store, not
among the cyclic-reachable commits, and not among the **76** refs the remote
advertises (`git ls-remote origin`). Nothing could be merged from it, so nothing
was invented: the mission work continues from the newest work that does exist,
`4512e946` (this branch, verified clean and identical to the remote head).

If that hash is from a different repository or a session that was never pushed,
paste the branch name instead and it can be fetched directly.

## What was built

A research cognition layer that LÉLU's existing cognition can consume — not a
sidecar report generator.

| file | role |
| --- | --- |
| `src/core/cognition/research/types.ts` | the fourteen-field entry, evidence kinds, the measured-evidence rule |
| `.../journal.ts` | record / verify / refute / search / gaps / contradictions |
| `.../observations.ts` | typed development events, work-package association, session reconstruction |
| `.../agenda.ts` | self-directed questions ranked by a stated formula |
| `.../visual.ts` | PNG decode + silhouette, thirds, bounds, IoU between renders |
| `.../capabilities.ts` | verified discovery → capability, with a re-runnable test |
| `.../bridge.ts` | verified entry → `KnowledgeLibrary` (`status: "verified"`) |
| `scripts/lelu2/research-fs.ts` | the Node adapter (git, artefacts, results) |
| `scripts/lelu2/research.ts` | the CLI (`observe`, `search`, `gaps`, `agenda`, `visual`, …) |

Persistence is `research/**.json` + `.md`, one document per entry. The
acceptance run retrieves an entry through a **separately constructed store**,
which is what "survives a restart" means here.

## What was actually observed and measured

- **92** observation documents from real commits, artefacts and test results.
- **12** journal entries: 4 verified, 1 hypothesis, 3 rejected, 4 other.
- **25** measured evidence items; mean confidence 0.56.
- Work-package association is derived from the commit text and the artefact
  path, and the rule used is stored on the event.

The verified findings are the ones the previous mission measured:

- the 2.0 hair-uniformity claim is confounded (n=928 vs n=1350); the equal-n
  result is 0.3925 → 0.0968.
- no single sampler wins: Vogel 0.0382 on the disc, Fibonacci 0.0277 on the
  sphere, the area-even hybrid 0.0968/0.0885 on hair and garment.
- occupancy is invariant under the hair surface: **375,460 cells, digest 15999**
  in all four builds.

## What was rejected, and kept

- **voxel-plane face cut** — 574/1350 strands survived, the crown went bald.
- **oval taper** — cheek 150.1 mm is wider than the skull 146.6 mm.
- **hairline above the brow** — measured 49.7 mm *below* the eyes.
- **frame time** — never measured; no device or real-time claim is made.

The root diagnostics contradiction is on the record rather than resolved: the
tube builder reports `floatingRoots=0` while the vertex-clearance measure reports
**54** roots beyond 4 mm (max 49.2 mm) and **392** inside the mesh.

## Visual evidence

`visual.ts` measured the two committed front renders (same camera):

| | voxel | tubes-high |
| --- | --- | --- |
| silhouette coverage | 61.35 % | 59.34 % |
| upper-third coverage | — | **−7.0 points** |
| IoU | 0.893 | |

Two findings, both pointing at the measurement that can settle them. The
upper-third loss agrees with the sparse crown visible in the render and with the
54 out-of-tolerance roots — three independent observations of one defect.

Screenshots: `artifacts/lelu2/research/dashboard-top.png`,
`dashboard-visual.png`, `dashboard-knowledge.png`.

## Checks

- `npx tsc -b --force` — clean.
- `npm test` — **1738 passing, 3 failing**. The three failures are sandbox /
  network tests (`an installed module is reused`, `curated proofs for reusable
  installed modules`, `network: TCP, UDP, DNS and fetch all fail`); this VM has
  no outbound network for sandbox installs. They are untouched by this work and
  were not verified on the base commit.
- `npm run research:acceptance` — 11/11 criteria, exit 0.
- Two dedicated suites: `tests/research.test.ts` (15 tests) and
  `tests/lelu2-artifacts.test.ts` (8 tests).

## What is still open

1. Replace the floating-root counter with a surface-distance measure.
2. Raise or lengthen the front hairline band; re-measure the upper third.
3. A real device/browser benchmark for WP05 — p50/p95 frame times at 1080p.
