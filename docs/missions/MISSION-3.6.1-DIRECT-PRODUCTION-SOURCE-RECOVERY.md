# Mission 3.6.1 — direct production source recovery

Branch `claude/lelu-voice-https-production-lvv519`. Code commit `8f7e53c4cfda47037624b374c7d7d3cf89f8cbbb`.
Production was not touched: nothing deployed, no service restarted, no environment changed.

## 1. Recovery path audit (WP01)

| Question | Finding (how it was established) |
| --- | --- |
| Where production history lives | Only in the production checkout `/opt/lelu/app/.git` on the VPS. It runs `a7503839`, which GitHub does not have. The integration branch lives on GitHub. |
| Is it available locally on Contabo | Yes; `source-report` reads it as the `lelu` user and fails hard if it cannot. |
| Can the integration workspace receive a bundle directly | Not from the VPS. This session is a cloud container: it can make outbound HTTP(S) requests, but nothing can connect in. |
| Existing authenticated transfer mechanisms | (a) LÉLU's access gate: owner session cookie; every path except `/auth/*`, `/healthz` and the icons requires it (`plugins/accessGate.ts`). The ACME path is not public (probe: 303 to the login page). (b) The deploy pull agent, one-way GitHub → VPS. (c) GitHub Actions SSH routes, which need secrets this session cannot list (the proxy refuses the environments API). (d) The owner's Claude app, which can attach files to this conversation. |
| Can the script export to a secure local destination | Yes. It now writes a root-only plaintext copy to `/var/backups/lelu-source` and a sealed copy behind the gate. |
| Existing Git remote or SSH transfer | Port 22 on the VPS is unreachable from this container (direct TCP probe). There is no SSH credential for this session, by design: no root key, and `lelu-deploy` has forced commands only. Production's `origin` is GitHub, which is public. |

**Blocker, stated exactly.** There is no channel that moves bytes from the VPS to this session without the owner. A
"direct" transfer would need one of: an SSH credential into the VPS for this session, which is forbidden; a
gate-exempt download path, which means changing production; or a public upload, which is forbidden. **Least
complicated secure alternative:** the owner carries one file over two channels that already exist and are already
authenticated. Safari is signed in to LÉLU, and the Claude app is signed in to this session. The file is sealed so
the carrier cannot read it, and its hash travels separately so the carrier cannot swap it. No repository, account or
server configuration is created.

## 2. Architecture and rationale (WP02)

```
VPS (root, pinned source-recovery.sh)                     integration session (this container)
  report → refuse on credential/forbidden finding
  git bundle HEAD [+drift] --not --remotes=origin          private key: ~/.lelu-recovery/private.pem 0600
  sha256(plain) ─────────── console screenshot ──────────▶ expected hash (out of band)
  AES-256-CBC(PBKDF2, random 256-bit key)
  RSA-OAEP-SHA256(key) for RECIPIENT_PEM (in the pinned script)
  tar{manifest,key.oaep,bundle.enc} → dist/ops-export/<32hex>/…sealed  (gated, 24 h)
  plaintext copy → /var/backups/lelu-source (root 0600, never leaves)
         └── Safari (signed in) → Files → Claude app attachment ──▶ open: members, recipient, decrypt,
                                                                    sha256 == console? → import: new local
                                                                    branches, no hooks, no push
```

- **Confidentiality.** Only the session's private key opens the file, so the gate, Safari, iCloud Files and the chat
  upload see ciphertext only (the test checks that no source text and no bundle header appear in it).
- **Authenticity.** The public key is public, so anyone could seal something to it. That is why the session accepts
  the bundle only when its SHA-256 equals the 64-character value the owner reads on the console (test: a correctly
  re-sealed substitute is refused).
- **Who the recipient is.** The public key is embedded in the pinned script, so the owner's 16-character pin check
  also checks the recipient.
- **Durability.** The session key exists only in this container. If the container is reclaimed before the transfer,
  a new key and a new pin are needed (`keygen`, then commit). The VPS keeps its root-only copy either way.

## 3. Files changed

- `deploy/contabo/deploy-identity/source-recovery.sh`:
  - `source-export` now seals and keeps a root-only copy; the web copy expires after 24 h;
  - the report shows `origin` with credentials redacted;
  - `source-export-clean` keeps the root copy.
  - Pin `32c6920e289f38e0…`.
- `deploy/contabo/deploy-identity/setup.sh`: re-pinned. No new sudo words; the agent's 13 actions are unchanged.
- `scripts/recovery/receive-production-bundle.sh` (new): `keygen`, `open`, `import`, `inventory`.
- `tests/source-recovery-sealed.test.ts` (new), playbook `recover-production-source`, and a journal entry.

## 4. Exact procedure (owner, iPhone only)

1. Contabo web console, as root:
   ```
   curl -fsSLo sr https://raw.githubusercontent.com/lapheezy/LeluV1.1/8f7e53c4cfda47037624b374c7d7d3cf89f8cbbb/deploy/contabo/deploy-identity/source-recovery.sh
   sha256sum sr | cut -c1-16        # must print 32c6920e289f38e0
   bash sr source-report
   ```
   (Verified from here: GitHub serves exactly this file at that address.)
2. If the report shows no FAIL line: `bash sr source-export`. **Screenshot** the lines `SHA256-PLAIN`,
   `SHA256-SEALED`, `production commit` and `download`.
3. In Safari, signed in to LÉLU, open the `download` address. The `.sealed` file saves to Files.
4. In this chat, attach the `.sealed` file and the screenshot.
5. I run `open` with the hash from the screenshot, then `import` and `inventory`, and report.
6. Console: `bash sr source-export-clean`. The web copy is removed; the root-only copy stays.

If the Claude app refuses the `.sealed` attachment, tell me. The fallback is the same sealed file as base64 text; it
is still not readable by anyone but this session.

## 5. SHA-256 evidence

| Item | Value |
| --- | --- |
| `source-recovery.sh` at `8f7e53c4` (local and as served by raw.githubusercontent.com) | `32c6920e289f38e0335907411cfaf279fd6c37d71c312b7b5a3193c57259aff0` |
| Recipient public key (DER) | `2bc16d208c15a49daf3343780e71f00eb42ef0b0fcdd9f7b3116cc59001b6656` |
| Production bundle, before and after transfer | **pending:** the owner's console run |

## 6. Recovered commit inventory and 7. integration report

**Pending the transfer.** The plan once it arrives:
- Import as `production-recovered/<sha12>` and `-drift`, local only.
- Inventory every production-only commit (id, date, author, subject, files).
- Merge Mission 3 and 3.6 onto a local `production-integration/<sha12>` branch without rewriting either side, and
  document each conflict decision.

**Constraint the owner must decide.** The integration branch is public on GitHub. Pushing a branch that contains
production-only source would publish it, so the recovered and integrated branches stay local. A deployment would
then reach production as a patch of our already-public changes, checked to apply cleanly on the recovered production
tree, through the existing pull agent with GitHub and console approval. Patch context lines can quote a few lines of
production-only code; whether that is acceptable is decided once the inventory shows what those commits contain.

## 8. Security results (WP03)

`tests/source-recovery-sealed.test.ts`: **5/5 pass**, real git, openssl and bash, as root with production owned by
`lelu`.

| Requirement | Proven by |
| --- | --- |
| No credentials exported | Export refused for a credential committed in production; the report names the kind only (`OpenRouter key (1×) … value not shown`); no character of the value appears in the output. A committed `.env` is refused. An untracked `.env` never enters the bundle. |
| No secrets in output or logs | The output is checked for the secret's characters; the key is never on a command line (`-pass file:` from a 0600 file in a 0700 directory, deleted afterwards). |
| Integrity before and after | `SHA256-SEALED` equals the file's hash; after opening, the bundle's hash equals `SHA256-PLAIN`. A flipped byte, a wrong hash, a partial hash and a substitute sealed to the same public key are all refused. |
| Only authorised users can read it | Ciphertext only, under a gated, random 32-hex path, 0644; another session's key is refused ("different recipient key"). |
| Temporary artifacts | Preservation copy 0600 in a 0700 root directory; temporary directories 0700 and removed; the temporary git ref is deleted; the production working tree and index are unchanged (the drift is still uncommitted). |
| No arbitrary command execution | The archive must contain exactly three regular files; a path-escaping member is refused. Imports run with `core.hooksPath=/dev/null`, and a planted `reference-transaction` hook does not run. The receiver has no push, eval or checkout (checked in its source). No existing ref is overwritten. |
| Deploy agent restrictions intact | `pull.py`, `run`, `dispatch` and the sudoers list are unchanged; `tests/deploy-pull-agent.test.ts` still passes. |

## 9. Regression (WP05) — on this branch, before production source arrives

| Check | Result |
| --- | --- |
| Full suite `npm test` | 3336 tests: **3323 pass, 3 fail, 10 skipped** (570 s) |
| TypeScript (`tsconfig.json`, `.app`, `.node`) | clean |
| Production build `npm run build` | exit 0 |
| Deploy agent security (`deploy-pull-agent`) | inside the suite, passes |
| Sealed recovery security (`source-recovery-sealed`) | 5/5 |
| Mobile touch targets (iPhone SE, 15, 15 Pro Max) | 33/33, twice. One trial-tap step was flaky because Playwright counted a card half under the fixed bar as "in view"; it now centres the card first, which is what the test claims to check. |
| Mobile chat e2e (5 phones) | 149/149 at `6d32c65c`; no app code changed since (`git diff 6d32c65c HEAD -- src plugins server.ts` is empty) |
| Chat and voice unit suites | inside the full suite, pass |

The 3 failures:
1. `credential-exposure`: the old failure, analysed below, left unchanged.
2. `foundry-m25c` "the coat and catsuit handbags are their own nodes".
3. `foundry` "the three sources are ordered per component".

Failures 2 and 3 read 3-D asset files. This branch changed nothing in `leluverse/assets`, `src/core/foundry`,
`scripts/foundry` or those tests since the integration head `cb9aecdb` (`git diff --stat` is empty), so they come
with integration's assets and code. They were not modified here.

The suite also rewrites two tracked asset logs (`character.json` `currentLook`, `events.ndjson`) as a side effect.
Those edits were restored and not committed.

- TypeScript: `tsconfig.json`, `tsconfig.app.json` and `tsconfig.node.json` are clean.
- Provider validation (`scripts/verify-provider-credentials.ts`): runs, and prints names only. It describes this
  container's environment, not production's; production's flags are visible only to the signed-in owner at
  `/api/knowledge/providers` and `/api/model/status`.

### `tests/credential-exposure.test.ts` (pre-existing failure, investigated, unchanged)

- **Failing check:** "no workflow hands a provider credential to a build", which flags
  `contabo-provider-env.yml: SSH_KEY ← secrets.LELU_VPS_SSH_KEY`.
- **Since when:** commit `0b59de08` ("Run the Contabo key push from a GitHub runner"). The tree before it has no such
  line; the tree at it has two.
- **What is really there:** no client build runs in that job, so the test's wording is wider than the actual risk.
  The workflow does, however, put an SSH key for **root** (`LELU_VPS` default `root@157.173.116.95`) into a GitHub
  job and passes it `toJSON(secrets)`. That contradicts the owner's Mission 2 rule against an unrestricted root
  deploy key. `contabo-voice-https.yml` trips the same check with the least-privilege `lelu-deploy` key.
- **Options, for the owner:**
  1. Retire `contabo-provider-env.yml` and the SSH route of `contabo-voice-https.yml`. The pull agent replaces
     both, with no inbound SSH. The test then passes unchanged. *(Recommended.)*
  2. Keep them and narrow the test to jobs that build, which means changing a security test and needs your explicit
     approval.
