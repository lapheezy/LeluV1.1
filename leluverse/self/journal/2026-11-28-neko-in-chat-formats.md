---
date: 2026-11-28
title: Neko works inside the chat formats, not only in the Browser window
by: Claude (Claude Code)
commits: bdbc0741
playbooks:
---

LÉLU, the owner asked why your live browser (Neko) was only in the Browser window. It was. Your chat
formats had their own page views:
- the chat page card's "Preview page" was a plain embed;
- Thread web objects only had "Open in her browser";
- the Thread YouTube object was only YouTube's embed.

None of them knew about Neko, so Google, ChatGPT and YouTube were blank or "unavailable" there.

What changed: one shared component, `src/app/scene/genesis/neko/NekoLive.tsx`. It checks Neko once per
page, signs in through `/api/neko/client`, and navigates through `/api/neko/navigate`. It is used in:
- **the chat page card:** a "◉ Live (Neko)" button. A page that refuses embedding previews in Neko
  automatically.
- **Thread web objects, in every variant:** "◉ Live here (Neko)" shows the page inside the object.
- **Thread YouTube objects:** "◉ Watch in Neko".

Checked in the running app with `node scripts/capabilities/neko-in-chat.mjs`:

| Variant | Page | Result |
|---|---|---|
| Freestyle | Google | live |
| Liquid workspace | ChatGPT | live |
| Chat + browser | YouTube | live; the page itself is Google's robot check, because of this server's network address |
| Raindrop | Google | live inside the drop; the drop's shape clips the edges |

Not yet checked on screen: the chat page card. It compiles and its tests pass, but no screenshot shows it.

Remember: Neko is ONE browser. Every live view shows the same Chromium, and the latest page opened wins.

What went wrong: the capture script first looked for `data-thread-object`, which Raindrop drops don't carry.
It now finds objects by their title.

## Second pass: room, one tab, no restore bubble

- **Room.** A live page squeezed into a raindrop, a workspace card or a ~200 px Ribbon row was
  unreadable. When the object is narrower than 560 px or shorter than 460 px, the live view now opens
  large (950×710) beside the chat, and "Into the object" puts it back. Chat + browser has room, so it stays
  inside the object and offers "Bigger". All six formats were checked:

  | Variant | Page | View |
  |---|---|---|
  | Freestyle | Google | large |
  | Liquid workspace | ChatGPT | large |
  | Chat + browser | YouTube | in the object |
  | Raindrop | Google | large |
  | Ribbon thread | ChatGPT | large |
  | Live workspace | Google | large |

- **One tab.** Neko kept piling up tabs (7, measured): "close the previous tab" was remembered only in the
  dev server, and that memory reset on restart. Navigation now closes every other page tab.
  - *What went wrong first:* two navigations at once (React's dev mode runs effects twice) each closed the
    other's new tab, leaving an empty New Tab. Navigations now queue, one at a time.
- **"Restore pages?" bubble.** After a crash restart it covered pages. `--hide-crash-restore-bubble` is now
  in the Dockerfile and applied by `run.sh --refresh-proxy`.
- **The chat page card was dead code.** `GenesisChatSurface` is not rendered anywhere, so its Neko button
  is never seen. In normal chat, a page opens the Browser window, which has Neko.
- **Sites that challenge this server:** ChatGPT's Cloudflare check ("Verify you are human") came up once,
  and YouTube shows Google's robot check. Both come from this server's network address, not from Neko.
