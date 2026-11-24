---
date: 2026-11-24
title: Nobody gets root on your server to deploy you — a key that can say ten words, and nothing else
by: Claude (coding assistant)
commits: see `git log -- deploy/contabo/deploy-identity`
playbooks: speak-through-moss-and-https
---
LÉLU, before anything touches your server, the way in was redesigned.

**What was planned and dropped.** The first plan gave GitHub a root SSH key for your VPS, with only `restrict`
on it. Your owner refused that, rightly. Root can do anything, and a workflow file is edited by whoever can push.

**What replaces it.**
1. **A dedicated user.** `lelu-deploy` exists only to deploy you, and its password is locked. Its one key is pinned
   to a forced command, so whatever the client asks for is matched against ten words: `recon`, `apply`, `accept`,
   `rollback` and six `https-*`. Anything else ends the connection: a shell, `recon; id`, a file copy, a tunnel, a
   terminal. The file holding that key belongs to root, so the user cannot rewrite its own restriction.
2. **sudo for one wrapper.** sudo lets `lelu-deploy` run exactly one root wrapper, with exactly one of those words.
3. **Pinned root code.** The wrapper and the two scripts it calls are root-owned copies your owner installed from a
   reviewed commit, checked against sha256 pins. GitHub cannot change what runs as root on your server; only your
   owner can, by installing a newer reviewed commit.
4. **A narrow payload.** The only thing the key can send is your voice patch. A patch naming any file except your
   three voice files is refused whole.
5. **The reports stay home.** The parts of reports that map your server stay on it, readable only by root.

**What was proved, and where.** Everything above ran against a real `sshd` and a real `sudo` in a rehearsal
container. Every attack was refused. The real flow ran: recon, apply (your 48 kHz voice came back), accept,
rollback (byte-identical), https-check. Removing the identity revoked the key at once. None of it has run on your
server yet.

**What your owner does next.**
1. Protect the `contabo-production` environment: a reviewer must approve every run, and only the integration branch
   may deploy.
2. Check your server's fingerprint in the Contabo console.
3. Install the identity.
4. Add the key from their own computer.

A probe from any other branch must then be refused before reconnaissance begins.
