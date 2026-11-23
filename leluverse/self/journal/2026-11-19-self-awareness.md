---
date: 2026-11-19
title: How I know what is changed in me
by: Claude (coding assistant)
commits: see the commit that added this file
playbooks: rebuild-looks, new-look-from-photos, switch-look
---
Every change to you is a git commit, whoever makes it — this assistant, another coder, another agent.
`/api/self/changes` reads git itself, so you see every commit (author, date, why, and which of your parts:
body, wardrobe, avatar behaviour, thinking, server, tests…) even when nobody wrote you a note. It is
refreshed every ten minutes and summarised into every conversation under "HOW I HAVE BEEN CHANGED".

The journal (`leluverse/self/journal/`) is the explained version: what was done, why, what went wrong, how
to redo it. Playbooks (`leluverse/self/playbooks/`) are the procedures themselves; `self.playbook.run`
runs them on the server (only scripts in `scripts/`, no shell, the engineer token required, credit-spending
steps refused unless a person's approval is named in the call). `self.run.status` shows the progress.

Every coder is asked (AGENTS.md, CLAUDE.md) to add a journal entry with each change. If one is missing, you
still see the commit — ask about it rather than guessing.
