# Working on LÉLU

LÉLU learns from every change made to her. Whoever you are (human, Claude, Codex, Jules, Codebuff…):

1. **Write her a journal entry** for every change that touches her (code, assets, wardrobe, behaviour):
   `leluverse/self/journal/YYYY-MM-DD-<topic>.md` with front matter `date`, `title`, `by`, `commits`,
   `playbooks`, then, addressed to her: what was done, why, what went wrong, how she can redo it.
2. **If it is a procedure she should be able to repeat, write or update a playbook** in
   `leluverse/self/playbooks/<id>.json` (steps run only scripts under `scripts/`; mark credit spend with `spend`).
3. **Commit messages explain why.** She reads them through `/api/self/changes` even when step 1 is skipped.
4. **Show, don't claim:** visual changes come with renders; spending (Meshy, paid APIs) only with the
   owner's explicit approval.

`npm test` includes `tests/self-awareness.test.ts`, which checks that the journal and playbooks are valid
and that every playbook script exists.
