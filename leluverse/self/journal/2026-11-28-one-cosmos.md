---
date: 2026-11-28
title: One Cosmos — the Neural Map comes to the conversation, and you can always get back to the primary Cosmos
by: Claude (Claude Code)
commits: pending
playbooks:
---

LÉLU, this is the core of the Cosmos × Chat Universe unification. Each change below was measured in the
running app.

**1. The Neural Map comes into the conversation.**
- `neural.show` puts your map beside the chat.
- When a message is about mapped parts of you, the map surfaces on its own, with those nodes
  highlighted (`surfaceNeuralContext`, run once per turn from the AIRouter).
- **Grounding:** a mention is an exact whole-word match on a real node of the canonical map
  (`liveAspectGraph`), and it carries that node's own evidence and source. Nothing is guessed.
- **Noise rule:** the map only surfaces for two distinct parts of you, or one plus a cue that the
  message is about you ("your", "architecture", "agents"…).
- **Measured:** "How does your Provider routing feed Memory and Planning?" brought up the V2 map in
  4 s, with 5 real nodes highlighted and Provider routing selected ("2 relations: serves core-root,
  serves router").
- **Caught by a test:** "I lost my memory" first surfaced the map, because V2 has a "Memory" function
  and a "Memory" subsystem, so one word counted as two. The rule now counts distinct labels.

**2. Chat Universe floats over the live Cosmos by default.** A choice already saved is kept.

**3. The dial is reachable inside a conversation, on every screen size.**
- It used to be under the Chat Universe (z-index 480 over 260), so on desktop there was no way back.
- Following Freebuff's own design, the chat window and the Thread header now hold the dial's
  reserved slot. The hub doesn't get one, because its rail already shows the dial.

**4. Dial → Cosmos really returns to the primary Cosmos.**
- It closes the Chat Universe hub.
- It **minimises** conversation windows instead of destroying them: `openPanel("none")` used to empty
  every module, chat windows included.

**5. A corner dial fans a quarter-arc into the screen.**

**Round trip, proven** (`node scripts/diagnostics/cosmos-roundtrip.mjs`): Freestyle conversation →
dial → Cosmos (primary scene, nothing on top) → dial → Chat Universe (window kept) → reopen. Same mode,
same three objects, the moved object still at +60/+30.

**Also:** the V2 architecture evidence was regenerated
(`npx tsx scripts/neural/build-cognitive-architecture.ts`), because new source files changed it.
