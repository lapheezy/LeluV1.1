# Studio unification and branch integration

Baseline `282626d` + `freebuff/session3d` (`239a57e`), merged in the scratch
worktree and then brought onto `claude/master-integration`.

## Which studio is primary, and why

**Creation Studio is primary.** It is the one a person can use today: it is
wired into the canonical Genesis shell, the Atelier, the chat tool set and the
router, and it carries the full artifact lifecycle — `ArtifactSpec` revisions,
nine real export formats with hash verification, readers that turn a file back
into a spec, imported originals retained byte-for-byte.

**Software Studio (Session 3C) is the preserved backup.** It is newer and
larger, and it is the stronger architecture for *building software* — twelve
pipeline phases, engine recommendation, real runtime builds/tests, approvals,
deployments, disk-authoritative persistence. It is not primary because its UI
(`GenesisStudioPanel`, grouped dock, auto-layout, spatial portals) is written
against a shell that is not the canonical renderer; promoting it would have
meant replacing the Genesis shell and dropping the baseline's interface work.
Testing that choice was measured, not assumed: baseline studio + session3d shell
gave **71** type errors; session3d studio + its shell gave **292**. Splitting
the two models gave **0**.

Its capabilities are not lost: every measured field is preserved in the
canonical model, and activation is one call.

## How the two models were reconciled

One filename held two incompatible type universes: `StudioTypes.ts` was the
creation artifact model (`DocumentSpec | DeckSpec | WorkbookSpec`) and, in
session3d, the software project model (`StudioProject`, phases, approvals,
deployments).

- `src/core/studio/StudioTypes.ts` — creation model, unchanged (baseline).
- `src/core/studio/StudioProjectTypes.ts` — software model, verbatim from
  `239a57e`; the nine software modules import it.
- `src/core/studio/StudioModel.ts` — **the canonical model**, new.

`CanonicalStudioProject` carries stable identity (`creation:art_…` /
`software:slug`), name/slug, kind across both vocabularies, monotonically
increasing `revision`, `createdAt`/`updatedAt`, optional `conversationId`,
`documents[]` (revisions, exports, imported original), optional `software`
(engine, stack, root, versions, builds, tests, assets, deployments,
documentation, preview, discovery flags) and extensible `meta`.

Adapters and migration, all in `StudioModel.ts`:

| Function | Purpose |
|---|---|
| `fromCreationArtifact` | creation artifact → canonical project (keeps every revision, export, original, chat association) |
| `fromSoftwareProject` | software project → canonical project (keeps every measured record) |
| `toSoftwareProject` | canonical → software record; round-trip is lossless, returns `null` instead of inventing one |
| `migrateLegacyStudio` | reads `lelu.studio.artifacts.v1` (array or `{artifacts}`) and `lelu.studio.library.v1` (array, `{projects}` array or map); unreadable entries are **counted as skipped**, never coerced |
| `StudioArchitectureRegistry` | exactly one architecture may be active; activating the second throws, `release()` then `activate(BACKUP_STUDIO)` restores the backup |

The primary store now exposes the canonical shape directly
(`StudioStore.canonicalProjects()`), so a caller that knows only
`CanonicalStudioProject` can read creation work without knowing that store —
and software projects arrive in the same shape when the backup is active.

## What was preserved from each side

- From the creation studio: revisions and their `basedOn` lineage, export
  records with SHA-256 and verification checks, imported originals, the
  conversation association, the chart/deck/workbook capability set.
- From the software studio: the disk-authoritative project list, versions with
  content hashes, build records with real exit codes, test records with real
  pass/fail counts, asset ledger entries with their real state
  (`present`/`awaiting_approval`/`missing`), approvals with expiry and scope,
  deployments with their status and approver, documentation and preview URL.

## The nine dry-run failures — fixed, not silenced

1. **Server autonomy (6 tests).** `plugins/engineerApi.ts` now has two
   authorities and no third: a configured `LELU_ENGINEER_TOKEN` is required on
   every route (constant-time); without one, a **verified identity** is the
   access credential and is checked before any route runs, with the project-
   changing routes re-checking it; with neither, the runtime answers 503. No
   loopback exemption, no anonymous path. The server-authoritative autonomy
   store is untouched — raising still needs the server-side password
   re-verification, lowering still does not, grants remain single-use,
   user-bound and ten-minute-lived.
2. **AIService controllers (2 tests).** Restored two controllers — one per
   conversation, one per turn — combined with `AbortSignal.any`, so a Stop
   aborts the fetch through either dimension. The "exactly two creations"
   invariant holds.
3. **AIRouter guard (1 test).** The studio guard was reordered so the
   engineering/workflow/`namesTool` stand-aside chain keeps its pinned shape;
   the guard itself stays, and no tool was removed.

4. **Lint (2 errors).** `scripts/verify-workspace-artifacts.mjs` destructured a
   `waitFor` it never used, and `GenesisChat.tsx` called `useChatExpanded()`
   *after* two early returns — a conditional hook React refuses, which also
   discarded the phone-expanded state whenever the chat was minimised and
   reopened. The hook now runs before the returns. The remaining 110 warnings
   are pre-existing style warnings (`no-unused-vars` on arguments and similar)
   and were left alone — they are not part of this integration.

No test was weakened, deleted or skipped.

## Validation

| Gate | Result |
|---|---|
| `npx tsc -b --force` | **PASS** — 0 errors |
| `bun run test` | **PASS** — 1572 tests, **1570 pass, 0 fail**, 2 skipped (final run on the pushed tree; the run before the hook fix was 1566 pass / 0 fail / 6 skipped) |
| Targeted suites (autonomy, cancellation, engineering chain, unified model) | **PASS** — 47/47 |
| `bun run build` | **PASS** — exit 0 (chunk-size warning only) |
| Lint (`bun run lint` → oxlint) | **PASS** — 0 errors after two fixes; 110 pre-existing warnings remain |
| UI / screenshots | **UNVERIFIED** — see "What is not verified" |

After the merge, the main worktree needed `bun install` before it could typecheck:
`gsap` is a dependency session3d's spatial runtime adds, and the worktree's
`node_modules` predated the merged lockfile. `bun install` installed
gsap@3.15.0 from the committed lockfile; no version was upgraded.

Evidence: `evidence/wave-2-unification/` — `full-suite.log` (first run),
`full-suite-final.log` (final tree), `build.log`, `install-main.log`,
`build-main.log`, `lint.log` — plus the wave-1 logs.

## What is not verified

The Studio UI was not captured in a running browser in this environment. The
app's boot path needs Supabase configuration and provider keys that are not in
this workspace, and no screenshot was taken — so the unified model is verified
by types and tests, **not** by a rendered Studio. Do not read this document as
visual proof.

The shell-level integration of session3d's grouped dock, module auto-layout and
spatial portals is the remaining port: those modules depend on
`layoutIndex`/`layoutWindowRects`/`manualPlacement`/`autoLayoutModules` in
`GenesisCore`, which the canonical shell does not have. They are preserved in
the source branch and not deleted.
