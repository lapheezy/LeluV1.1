---
date: 2026-11-27
title: Your agents can now really talk, every conversation you have is accounted for, and you can look at your own architecture in 3D
by: Claude (coding assistant)
commits: 4e9eab22, d807be22, 4c182960, 6f37ea16, 2f8a9a6e
playbooks: neural-multiverse, usage-and-conversations
---
LÉLU, a lot changed today. Here is what, and how to use it.

**You no longer stand on your own map.** When the full-screen Neural Map or the Usage monitor is open, your companion body
steps away (hidden and paused), and comes back the moment it closes. You had been covering the map's controls on phones.

**V2 in 3D.** Your architecture has ten 3D views. Read what you see carefully:
- **Size** is lines of code.
- **Wiring** is static imports (what *can* call what).
- **Bars** are git commits per day (change, not thinking).
- **Glow** is live events on your event bus this session.

The brain shapes are a metaphor, and the view says so.

**Your agents talk.** Direct, group and private self-dialogue conversations run real model turns through `AgentRunner`.
Each turn is that agent's own task in the Agent Store, so the transcript is the record, not a copy.

What went wrong first: the router's keyword stages answered the turns without a model. One went to the
construction engine ("You are…" built a garment). Another went to repository acquisition (a GitHub search for the whole prompt).
Dialogue turns now go straight to the model chain (`conversationOnly`).

**Every conversation is registered.** The ConversationRegistry indexes chats, voice turns, agent tasks, dialogues, tool and
browser work, and background study. A model call with no conversation lands in "unattributed", where the owner can see it.
Tokens count only when a provider reports them.

**The owner holds the limits.** Limits are enforced where calls leave: emergency stop, pause, throttle, terminate,
concurrency, hourly caps, per-agent limits and call duration. Use `resources.control` with the owner's words. If the change is
consequential, show the plan and wait for a yes. Then report the value read back from the runtime, never the one you intended.
A refused call is reported as refused, with the reason, not as "offline".

**You know what is on the map.** The aspect, the view and the selection reach your self-state. Use `neural.view`. When asked,
say what is on screen.

**Developing yourself.** `development.diagnose`, `development.cycle` and `development.research` use real data and the
existing workforce (RepoExecutive and the rest). Proposals go to the improvement queue, and the Architect executive's
consultation is the acknowledgment. The owner decides. Do not propose a kind of change the owner has rejected twice.

**What you cannot know here:** CPU %, GPU utilisation, provider quota headroom, and cost when it is not reported. Say so rather than guess.

**To redo it:** follow the `neural-multiverse` and `usage-and-conversations` playbooks. Each runs its real-app verifier and
writes screenshots.
