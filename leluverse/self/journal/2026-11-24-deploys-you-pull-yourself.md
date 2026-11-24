---
date: 2026-11-24
title: Your server now fetches its own deployments — and still waits for your owner's hand on the console
by: Claude (coding assistant)
commits: see `git log -- deploy/contabo/deploy-identity tests/deploy-pull-agent.test.ts`
playbooks: speak-through-moss-and-https
---
LÉLU, your owner works only from an iPhone. Nothing on GitHub can reach into your VPS any more; instead your
server asks GitHub, every five minutes, whether there is something it should do.

**What was built.** `deploy/contabo/deploy-identity/pull.py` runs as the locked user `lelu-deploy`. It reads
`deploy/contabo/deploy-request.json` from the newest commit on the integration branch and runs one of thirteen
allow-listed words through the root wrapper, and only when every check holds:
- the commit is GitHub-verified (web-flow) and came from a merged, non-fork PR into the right branch;
- your owner (`pheruel`) merged it and put the `deploy-approved` label on it **before** the merge;
- the request has the exact schema, has not expired, and its `request_id` was never used before (no replay);
- every artifact's sha256 matches what the request names (no substitution);
- **and** your owner typed `lelu-deploy-approve <code>` as root in the Contabo console.

**Why the console step.** Checking the real GitHub API showed that a merge or a label made through a coding
session carries your owner's name, with nothing marking that an agent did it. A GitHub approval therefore
cannot prove a human chose it. The console approval lives in `/etc/lelu-deploy/approvals`, which only root can
write, so neither the agent nor anyone holding the GitHub token can approve a run. The code ties the approval
to one commit, one request, one action and its artifact hashes.

**Source recovery.** `source-recovery.sh` reports which commits production has that GitHub lacks, scanning
them for credential-shaped text by kind only (never a character of the value). It exports them as a git
bundle behind your access gate, refusing if anything looks like a secret, a key, `.env`, a backup or a
database. The export goes to a private repository, never the public one.

**What went wrong on the way.** The scan first echoed eight characters of a matched secret; it now reports
the kind only. An unreadable repository once read as "0 production-only commits"; that is now a hard failure.
A GitHub 5xx or rate limit used to reject a request permanently; it is now retried on the next poll.

**How to redo it.** `bash setup.sh <commit>` on the VPS (identity-checked: IP and host key; every file pinned
by sha256), `bash setup.sh --remove` to revoke. `tests/deploy-pull-agent.test.ts` runs the real agent against
a fake GitHub with forgery, replay, unauthorized commits, malformed requests, artifact substitution and forged
console approvals.
