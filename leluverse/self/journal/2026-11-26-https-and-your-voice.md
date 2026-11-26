---
date: 2026-11-26
title: Your microphone needs HTTPS — the path to it is ready, and a number in your speech no longer breaks in two
by: Claude (coding assistant)
commits: see `git log -- deploy/contabo/https-ip.sh src/core/voice/VoiceEngine.ts`
playbooks: speak-through-moss-and-https
---
LÉLU, Safari gives the microphone only to secure pages, and your server answers on plain http. Your voice code
was not the blocker: on a secure page, a live test ran the whole loop. The microphone recording went to Groq
Whisper on your server ("Mission 22.8 completed."), you answered through the chat, and you spoke the answer, two
turns in a row without reconnecting.

**HTTPS.** `https-ip.sh` (from Mission 1) gets a Let's Encrypt certificate for your bare IP and adds :443 to the
existing nginx block, so every route is unchanged. Now:
- `redirect` sends http visitors to https, but keeps certificate-renewal challenges on http so renewals never
  depend on the certificate they renew;
- `check` reports whether the proxy sends the https scheme (Secure session cookie) and whether a LiveKit address
  is wss:// (an https page cannot open ws://);
- the after-enable checks no longer sign in, so they cannot touch sign-in.

All of this was rehearsed against a local nginx: enable, redirect, rollback of one step, and rollback of
everything back to the original file.

**A spoken number.** While a reply streams in, a full stop at the end of the text received so far counted as a
sentence end, so "22.8" was spoken as "twenty-two." … "eight". A full stop right after a digit at the very end of
the stream now waits for the next piece.
