# Rollback guide

This work is **additive**. Reverting it does not touch LÉLU's existing
subsystems, data, Supabase project or environment.

## Fast rollback (one commit)

```bash
git revert --no-edit <integration-commit>
```

Because every change is either a new file or a two-line mount in
`vite.config.ts` / `server.ts`, the revert is clean and leaves the app exactly as
it was at `1031053`.

## Full rollback (branch level)

```bash
git checkout claude/master-integration   # the upstream Claude branch
git branch -D freebuff/1fb0099bf53a9ab2f6fe75bd
```

Do **not** hard-reset a shared branch: 13 worktrees share this repository, and
`claude/avatar-3d-world` is checked out elsewhere.

## Unmount only the new API

Remove the import and the `lelu-integration-api` plugin block from
`vite.config.ts`, and the `middlewares.use("/api/integration", …)` block plus its
import from `server.ts`. Nothing else references them.

## Disable policy enforcement (without deleting it)

Policy is only enforced on calls that go through `AdapterRegistry`. Today that is
the evidence script and the API — not the chat path. So removing the API mount
disables the new surface entirely, with no effect on chat, agents or tools.

## Scanner binaries

`.tools/` is gitignored and contains `opa`, `gitleaks`, `trivy` (~260 MB). Delete
the directory to remove them; nothing depends on it, and every adapter reports
"not installed" instead.

## Environment

No environment variable was added, renamed or removed, and `.env.local` was not
modified. There is nothing to restore.

## Data

- No Supabase migration was run.
- No row was written to any table.
- Relationship tuples and audit entries are in-memory only.
- Evidence files live under `docs/acceptance/intelligence-integration/` and are
  safe to delete.

## What a rollback loses

1. Per-call policy enforcement and the audit trail.
2. Real scanner access from the app.
3. Correlated traces and the evidence generator.
4. The engineering orchestrator's refusal, locking and verification rules.

Nothing that existed before this work is lost by rolling back.

## Rollback check

After reverting, the release criteria are the baseline measurements:

```bash
npx tsc -b --force     # exit 0
bun run test           # 1274 tests, 1272 pass, 0 fail, 2 skipped
```
