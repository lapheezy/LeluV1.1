# Mission 3.6 — pull deploy agent, private source recovery, mobile taps, research providers

Branch `claude/lelu-voice-https-production-lvv519`. Nothing in this mission has touched production.

## WP01 — VPS-side GitHub polling deploy agent

`deploy/contabo/deploy-identity/pull.py` runs every 5 minutes as the password-locked user `lelu-deploy` (systemd
timer). It reads `deploy/contabo/deploy-request.json` from the newest commit on
`integration/lelu-four-workforce-consolidation`. It runs one of 13 allow-listed actions through the pinned root
wrapper only if **all** of the following hold:

| Check | Defends against |
| --- | --- |
| commit is GitHub-verified (`web-flow`) and is the merge of a non-fork PR into the integration branch | unauthorised commits, pushes that skip review |
| PR merged by `pheruel`, label `deploy-approved` added by `pheruel` **before** the merge, and still present | a PR approved by someone else; a label added after the fact |
| strict schema (exact key set, `request_id` format, `not_after` ≤ 72 h, the action's artifact rules) | malformed or over-broad requests |
| `request_id` never seen before | replay |
| every artifact's sha256 equals the hash in the request | artifact substitution |
| **console approval**: a root-owned, non-writable-by-others file `/etc/lelu-deploy/approvals/<code>` naming this exact commit and request | anyone, or any agent, holding the owner's GitHub token |

**Why the console factor exists.** Checked against the real GitHub API: a merge or label made through an agent session
shows the actor `pheruel` with `performed_via_github_app: null`, which is identical to the owner acting in person. So
the GitHub side alone cannot prove a human chose the deployment. The agent writes `pending.json` and logs
`AWAITING-CONSOLE-APPROVAL … code=<8 hex>`. The owner types `lelu-deploy-approve <code>` as root in the Contabo
console. The command shows the commit, PR link, request, action, expiry and artifact hashes, and asks for `yes`. The
code is derived from the commit, request, action and artifact hashes. `lelu-deploy` cannot write the approvals
directory (setup self-test).

**Evidence**
- `tests/deploy-pull-agent.test.ts`: **32/32 pass.** It runs the real `pull.py` against a fake GitHub. Cases: a valid
  request waits for the console and then runs exactly once; 12 provenance attacks; 12 malformed requests; artifact
  substitution; replay; forged console approvals (wrong code, group-writable file, wrong commit); a rejected commit
  is not retried; an outage is retried, not rejected.
- Setup rehearsal in this container with real `sudo`/`visudo` (identity check removed only for the rehearsal):
  - every pin matched;
  - the 13 sudo words listed;
  - `sudo /bin/true` refused, argument injection refused;
  - scripts, agent and approvals not writable by `lelu-deploy`; `lelu.env` unreadable;
  - `lelu-deploy-approve`: wrong code refused, `no` refused, injected `request_id` refused, `yes` wrote
    `commit=/request=` root-owned 0644;
  - `--remove` cleaned up.
- Commit `631f2f03`. Pins: `pull.py` 7b77f07c…, `source-recovery.sh` af919c2f…, `setup.sh` itself 17f87f86….

## WP02 — private production source recovery (iPhone only)

`source-recovery.sh` (pinned, root):
- `source-report`: production `HEAD`, commits GitHub lacks, uncommitted drift, forbidden file names, and a
  credential scan that names the **kind only**, never a character of the value.
- `source-export`: a git bundle of only the production-only commits plus a snapshot of tracked drift. Untracked
  files are never included. It is refused if anything looks like a secret, a key, `.env`, a backup or a database.
  The bundle goes to `dist/ops-export/<random 32 hex>/…`, behind LÉLU's sign-in gate.
- `source-export-clean`: removes the export.

**Owner steps.** Each step needs only Safari and the Contabo web console.
1. GitHub in Safari → **New repository** → owner `lapheezy`, name e.g. `lelu-production-source`, **Private**, no
   README. Never upload the bundle to `LeluV1.1` (public).
2. Contabo console, as root:
   ```
   curl -fsSLo sr https://raw.githubusercontent.com/lapheezy/LeluV1.1/631f2f0362fa664f61e576edf4b2514e496dffaf/deploy/contabo/deploy-identity/source-recovery.sh
   sha256sum sr | cut -c1-16        # must print af919c2fd974bc73
   bash sr source-report
   ```
   Send me what it prints. It shows commit ids, file names and finding kinds, and no secret values.
3. If the report shows no FAIL line: `bash sr source-export`. It prints a download address and a sha256.
4. In Safari, signed in to LÉLU, open that address. The bundle saves to Files.
5. In the private repository: **Add file → Upload files**, then choose the `.bundle` and the `.sha256` file and
   commit. The GitHub web upload limit is 25 MB; the report shows the size.
6. Tell me the repository name. I attach it read-only. I check the sha256, run `git bundle verify` and import the
   commits as `production-recovered/<sha12>` **beside** integration (neither overwrites the other), then show the
   differences.
7. `bash sr source-export-clean`.

**Status: waiting on the owner (steps 1–5).** No production deployment until source parity is established.

## WP03 — mobile touch targets

**Cause.** The phone Home's hero spot, `[data-lelu-hero-host]`, measured **0 px wide**. The desktop rule
`.lch-hero-lelu { grid-column: 2 }` applied inside the phone Home's one-column `.lch-lelu` grid, and an absolutely
positioned child placed in a column that does not exist collapses to a 0-wide strip. With no hero spot the avatar
rested bottom-right, on the cards, and took their taps.

**Fix.**
- `homeComposition.css`: `grid-area: auto` on the hero spot inside `.lch-lelu`.
- Defence in depth in `presencePlacement.ts`: Home's buttons, links and `role=button` elements count as controls in
  her placement.

**Evidence.** `tests/e2e/mobile-touch-targets.e2e.mjs` at iPhone SE, iPhone 15 and iPhone 15 Pro Max:
- **33/33 pass** with the fix;
- **21/33** with the CSS fix reverted, which reproduces exactly the measured bugs;
- 107/107 avatar and presence unit tests pass.

Renders: `docs/missions/evidence/mission-3-6/*-before-after.jpg`.

The remaining overlaps are cards that start under the fixed bottom bar. The test proves each one takes its own tap
once scrolled. Chromium emulating an iPhone is not Safari, so the playbook `verify-interaction` keeps the real-device
step.

## WP04 — Engineering token, research providers, arXiv

- **arXiv now goes through the server.** The browser used to call export.arxiv.org directly; it sends no CORS header,
  so the call failed and fell back to the public third-party proxy api.allorigins.win. arXiv is now a keyless
  provider on the existing `/api/knowledge/relay`:
  - limited to `/api/query`;
  - signed-in users only;
  - paced at 1 request / 3 s;
  - Atom `Accept` header, no credential of any kind.

  `ArxivProvider` and the `arxiv.search` connector use it in the browser. Evidence: `tests/arxiv-server-relay.test.ts`
  5/5 pass; the existing relay and security suites pass (73/73).
- **Engineering 503 is by design.** `/api/engineer/*` answers 503 because `LELU_ENGINEER_TOKEN` is unset. Turning it
  on also requires building the token into the page (`VITE_LELU_ENGINEER_TOKEN`), so anyone past the sign-in gate
  could read it, and those routes run commands on the VPS. Recommendation: leave it off. No credential was invented.
- **Configured research providers.** Production answers `/api/knowledge/providers` only to a signed-in user (from
  here: 401). Signed in, the owner can open `http://157.173.116.95/api/knowledge/providers` in Safari. It returns
  yes/no per provider, with no key values. The keyed ones (news, youtube, guardian, gnews, newsdata, geoapify, firms,
  meshy) answer 503 when unset. NASA uses DEMO_KEY. Wikipedia, Wikidata, Crossref, OpenAlex and arXiv need no key.

## WP05 — readiness

Ready on the branch: WP01, WP03, WP04, and the Mission 3 cognition fixes. Blocked: integrating these on top of the
**recovered production source** (WP02 step 6) and the final regression run against it. Production `a7503839` stays
untouched. No deployment happens without the owner's explicit approval, given on GitHub and then by console code.
