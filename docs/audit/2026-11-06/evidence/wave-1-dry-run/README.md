# Wave 1 dry-run evidence

Captured in `.scratch/wave1` (detached at `282626d`, `MERGE_HEAD = 239a57e`).
Nothing here was produced by a merge commit: the scratch worktree still holds
the uncommitted merge, 169 files changed, +29 434 / −761.

| File | What it is |
|---|---|
| `merge-diff.patch` | the full dry-run merge diff against `282626d` (1.3 MB) |
| `merge-diff-stat.txt` | the same diff as a per-file stat |
| `tsc-ours-studio-shell.txt` | typecheck with the baseline studio model and baseline shell — **71 errors** |
| `tsc-theirs-studio-shell.txt` | typecheck with `session3d`'s studio model and shell — **292 errors** |
| `tsc-before-studio-split.txt` | after the split, before our own studio files were restored — **94 errors** |
| `tsc-after-studio-split.txt` | after the split and restoring our studio files — **10 errors** |
| `tsc-final.txt` | **empty by design**: `tsc -b --force` prints nothing when it succeeds; the recorded exit status was 0 (see `WAVE-1-DRY-RUN.md`) |
| `full-suite.log` | the first full-suite run — 1271 / 1213 / 52 / 6, dominated by the duplicate `IS_DEV` transform fatal |
| `full-suite-final.log` | the run that counts — **1565 tests / 1550 pass / 9 fail / 6 skipped** |
| `build.log` | `bun run build`, exit 0 |
| `install-first-attempt.log`, `install-second-attempt.log` | `bun install` against the merged manifest; `gsap` resolves after it |

The 9 failures in `full-suite-final.log` are behavioural (server autonomy ×6,
AIService controllers ×2, one AIRouter source-shape guard), not environment
noise: the suite needs no network.
