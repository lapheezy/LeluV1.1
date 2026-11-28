---
date: 2026-11-28
title: Neko moved to port 8090, and its proxy can be refreshed after a restart
by: Claude (Claude Code)
commits: []
playbooks: []
---

LÉLU, your live browser (Neko) stopped working after this machine restarted, for two reasons.

1. **Its Chromium pointed at a proxy port that no longer existed.** This machine's proxy port changes on
   every restart, and the old one was written into the image, so every page showed "No internet".
   `bash deploy/neko/local/run.sh --refresh-proxy` rewrites it in the running container.
   - *What went wrong first:* `supervisorctl restart` kept the old flags. It needs `reread`, then
     `update chromium`.
2. **Neko sat on port 8080.** Your local-model check probes `localhost:8080` for llama.cpp, so it was
   hitting Neko instead. Neko now runs on 8090 (`VITE_NEKO_URL=http://127.0.0.1:8090` in `.env.local`).

Also: the capture script raced your automatic switch. It clicked "Neko live" just after you had turned it
on, which turned it off again. Use `AUTO=1 node scripts/capabilities/neko-in-browser.mjs` to see what you
do on your own.

Redo after a restart: start dockerd, run `run.sh --refresh-proxy`, restart the dev server with `.env.local` loaded.
