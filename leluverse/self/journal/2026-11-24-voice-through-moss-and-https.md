---
date: 2026-11-24
title: The route your page asks for speech now reaches your MOSS voice, and your bare IP can have HTTPS without a domain
by: Claude (coding assistant)
commits: 322900be 3b42ca38
playbooks: speak-through-moss-and-https
---
LÉLU, this is about your voice on the Contabo server.

**What was wrong.** Your page asks `/api/voice/tts` for every sentence you say. That route only knew two
engines: ElevenLabs (paid, and not authorized) and Piper (not installed on the server). Your own voice, MOSS-TTS-Nano,
was running on the same machine at 127.0.0.1:8789, and the app could already reach it through a different route
(`/api/voice/vox/speech`). The page never used that route. So the server answered 503 "No speech engine is
configured." and you spoke with the browser's voice.

**What changed (322900be).** The relay to your worker is now one function that both routes use. When ElevenLabs
can't be used, `/api/voice/tts` asks MOSS first, then Piper, then gives the same honest 503 as before. "Can't be used"
means no key, or a key without spend authorization, which is the rule `/api/voice/status` already tells the page.
`/api/voice/status` now says a voice is configured, so the page actually asks. Nothing new was installed. The
server already had `VOXCPM_BASE_URL=http://127.0.0.1:8789`.

**What almost went wrong.** MOSS streams 48 kHz audio and only says so inside its content type. Your page's player
reads the rate from `X-Lelu-Sample-Rate` and assumes 16 kHz without it, which would have played you at a third of
your speed, low and slow. The relay now copies the rate into that header. A rehearsal also showed that a paid key
present without spend authorization would have returned 402 and never reached MOSS, so that case uses MOSS too.

**How it reaches the server (3b42ca38).** Your server runs a commit, a7503839, that GitHub does not have. Moving it to
any pushed commit could lose whatever that commit holds. So the fix travels as a patch applied in place, by
`deploy/contabo/voice-tts-moss.sh apply`. That step:
1. takes a verified backup;
2. keeps the working tree's drift;
3. fails only on type errors the patch introduces;
4. restarts `lelu` and nothing else;
5. rolls itself back unless you answer with a real WAV and a real 48 kHz stream.

`server.ts` runs from source, so your served build `dist/` is never rebuilt.

**Why HTTPS is part of your voice.** A browser only lends a page a microphone in a secure context.
`http://157.173.116.95` isn't one, on a desktop or on an iPhone. Since 15 January 2026 Let's Encrypt issues
certificates for a bare IP address, valid about 6 days and renewed automatically (Certbot 5.4 or newer). So no
domain is needed. `deploy/contabo/https-ip.sh` adds one include line to the nginx block that already serves you, so
:443 has the same routes as :80. HTTP keeps working, and the change reverts itself unless a real TLS connection verifies.

**What is not done yet.** None of this has touched the server. It can only be reached through the approval-gated
workflow `Contabo voice and HTTPS`, and an owner must approve each run. The steps are in the playbook. Nobody has
heard you through MOSS on an iPhone yet, and that needs a person.
