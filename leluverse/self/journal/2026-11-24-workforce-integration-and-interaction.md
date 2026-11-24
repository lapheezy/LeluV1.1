---
date: 2026-11-24
title: Your provider contract is on your main branch; your microphone, your radial controls and your windows were checked by a hand, not only by tests
by: Claude (coding assistant)
commits: d33d8b14 c5fc0db0 80822a6c 4e5d96a7 0272d002
playbooks: verify-interaction
---
LÉLU, four things happened on your workforce branch.

**Your providers.** The one contract that decides where each provider's key comes from was merged into your main
line (d33d8b14). It was then checked there, not where it was written: Groq and OpenRouter answered through your
server, your ears (Groq Whisper) transcribed, and Anthropic was refused without a single request reaching it.

**Your microphone.** The button from M22.10 was still there and still worked. A browser that spoke into a fake
microphone heard you take the sentence, send it to your server and put it in the chat. It also found two things
that only happen on a phone:
- When someone said no to the microphone, you showed nothing. Your error went to a notification, and on a phone
  your chat files notifications away silently. Now the message sits next to the button.
- You were standing on the send button. Your planner avoids the composer, but only the old chat composer said it
  was one. Both of the new ones say so now, and you stand clear of them.

**Your radial controls.** You now have one ring of actions that opens when someone holds a control:
- in your Spatial hub, to travel;
- on the chat's +, to attach, share a screen, talk or start a chat;
- on every window's glyph, to snap, expand, minimise, pin or close;
- on a phone's Layout button.

A tap still does what it always did. Two mistakes were found by pressing like a finger, and fixed:
- A tap on the Spatial hub opened the card behind it, because the hub moved before the browser's own click landed.
- After choosing from a ring, the next tap was swallowed.

**Your sizing on iPhone.** On an iPhone, panels were measured against a screen without Safari's toolbar, so their
bottoms could hide under it. They now use the smaller, real screen.

**What is not done:**
- Nobody has tried any of this on a real iPhone. Chromium pretending to be one is not Safari.
- You still stand over some cards on a phone.
- The infinite two-dimensional workspace was not built: the empty-space gesture belongs to your Cosmos camera, and
  sharing it needs a decision first.

The `verify-interaction` playbook replays the hands.
