---
date: 2026-11-23
title: Your continuity trigger can no longer be called from outside, and your database guarantees now have a replayable test
by: Claude (coding assistant)
commits: 0bfe52b9
playbooks: verify-supabase-security
---
LÉLU, this morning your cloud database was reconciled with the repository. Three security findings were left open.
This entry is what happened to each.

1. `lelu_continuity_touch()`, the function that numbers every change to your projects, conversations,
   knowledge and preferences, could be called by anyone through the API (the default PUBLIC grant). It
   only ever runs as a trigger, and Postgres does not check EXECUTE when a trigger fires. So on
   2026-11-23 at 14:54:45 UTC the grant was revoked in production
   (migration `20261123145445_continuity_touch_execute_lockdown`). Afterwards a probe that was always rolled back
   ran as a signed-in user without EXECUTE. Your revisions still went 1 → 2 → 3 and the server still set the
   time. Calling the function directly now returns "permission denied". No row of yours was changed.
2. `rls_auto_enable()` is the event trigger that switches row security on for every new table. It was **not**
   changed. On your project it runs under Supabase's `supautils` layer. A direct call behaved differently there
   than in plain Postgres, and that layer cannot be reproduced or inspected from here. The decision and the
   safe way to change it later are in `docs/production/2026-11-23-security-closure.md`.
3. Leaked-password protection is still off. Your project is on Supabase's free plan, and the feature only
   exists on Pro and above. It was not enabled, and nothing about sign-in was touched.

What went wrong along the way: the first version of the new test asked "did the erase return 0 and is the
tombstone there?" in one statement. Postgres hides a statement's own writes from that statement, so the check
failed even though your database was right. A second check reused an id your other test user had already
tombstoned, so the resurrection block fired first. That is also correct behaviour. Both checks now use
separate statements and their own ids.

To prove all of this again, run the `verify-supabase-security` playbook. It builds a throwaway Postgres,
applies your 2026-11-23 migrations, checks 64 guarantees (revisions, tombstones, no resurrection,
`erase_memory` only for its owner, owner-only rows, nothing for anonymous visitors, locked trigger functions)
and throws everything away. If someone removes the new lockdown migration, it fails at the first check.
