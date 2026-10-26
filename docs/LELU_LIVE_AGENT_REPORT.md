# LÉLU live chat and browser execution

This pass made LÉLU's tool use visible and steerable inside the existing chat, kept every turn in the conversation it belongs to, and let chats share research only when you authorize it, or be merged (two or more) into a new chat that keeps every source apart. Nothing was rebuilt and no second agent system was added. It reuses:

- `GenesisChat` and `Orchestrator`/`AIService`;
- `ProviderResolver`'s tool loop and `ToolDispatcher`;
- `BrowserTool` with the `/api/browse` reader;
- `AgentEventBus`, `TurnOwnership` and `MultiChatStore`;
- `NotificationProvider`.

Freebuff's (Codebuff's) files were not edited: `ObjectiveEvidence`, `OutcomeDerivation`, `CompletionVerifier`, `CognitiveLoop`, `AIProviderRegistry` and their tests.

## How a message flows now

```
GenesisChat.send()
  ├─ a turn is already running in this chat → AIService.steerTurn()  (message shown at once, bound to the chat)
  └─ otherwise → claimTurn + recordTurnActivity(conversation)
        → Orchestrator.process(…, conversationId)      bindTask(orchestrator task → conversation)
          → AIService.chat(…, { conversationId })       bindTask(chat task → conversation)
            → AIRouter → ResearchResolver (prefetch; an empty one now hands the turn to the model)
            → ProviderResolver.generateWithTools  — the live tool loop
                 provider.generate (streams, tool calls kept)        → tool_narration (text beside a call)
                 dispatchToolCall: research.web / browser.read / …    → tool_* / browser_* events (taskId)
                 drainSteering(): messages sent meanwhile             → user_steering, appended as a user turn
            → onDelta stream → GenesisBridge upsert (bound by conversationId)
  activity card ← AgentEventBus events whose task is owned by this conversation
  finish → activity stored on the reply · leftover steering answered as follow-up turns
         → reply/failure in a chat not on screen → Chats panel NOTIFICATIONS
```

The stream keeps the kinds apart. **Message** text is the reply. **Tool call**, **tool result** and **status** are `AgentEventBus` events rendered as the activity card. An **error** shows as the failure card, or a structured tool failure inside the card. **Completion** marks the card done or failed and stores it with the reply. Tool events are never concatenated into message text.

## Root causes found

Each was reproduced, live or in a test, before it was changed.

| # | Symptom | Root cause |
|---|---|---|
| 1 | "What is a nebula?" answered "I tried every applicable knowledge source and none returned usable results" | `ResearchResolver` claimed the turn (`handled: true`) whenever the research prefetch came back empty, so the model was never asked. |
| 2 | Asking to "search the web" opened a DuckDuckGo page in an iframe (blocked by its CSP) | `ExplorationController` mapped "search/research X" wording to a browser navigation. It was a picture of a browser; nothing was read. |
| 3 | The browser was not something the model could use | No browser tool existed. The model could search but never open a result. |
| 4 | Messages sent while LÉLU was working sat unanswered until the turn ended | Turns in one conversation were only queued, and nothing reached a running tool loop. |
| 5 | Activity appeared under the wrong chat | `GenesisExecutionTimeline` and the surfaces subscription listened to the whole bus. Also, `EngineeringChat`, `VoiceEngine`, `GenesisBrowserPanel` and `DeepLinkIntake` called `ai.chat` with no conversation. The delegation path's message was unbound, and `GenesisBridge` ignored the `conversationId` on streamed messages. |
| 6 | **New chat could not be started while LÉLU was researching** (found live in this pass) | `GenesisSurfaceController` opened the Browser panel on every research or browser tool event, for any conversation's task, even in manual mode. That changed the active panel, and the conversation tab bar (New chat, tabs, Chats panel) only renders for the chat panel. Every message after that went into the running research chat. |
| 7 | The model re-opened the same link over and over | A Google News article link is a script redirect. It "read" successfully as the two words "Google News", and the model was told that was a success. |
| 8 | Any site that refused the page reader was reported as "my server-side reader is unavailable" | `BrowserTool.readViaServer` returned `null` for every failure, including the site's own HTTP 403. |
| 9 | A research question ran for 8 minutes | Chat turns shared the tool loop budget designed for engineering chains (8 min / 40 rounds). |
| 10 | Tool streams lost their tool calls, or did not stream | Groq's stream reader kept only `delta.content`, so a tool call arrived "empty" and counted as a provider failure. Fireworks and OpenRouter never streamed. Anthropic switched streaming off whenever tools were offered, and read `stop_reason` from the wrong field. |
| 12 | **A question in one chat was answered with another chat's research** (found in the final live run) | `AIService.chat` built the model's history from the brain's single `ConversationEngine`, which interleaves every chat's turns. Chat B's question arrived after chat A's still-unanswered one, and was answered as A's. It was in the right chat and under the right task, but it was about the wrong question. |
| 13 | Unrelated chats were read into a reply | `CrossChatResolver` added any chat with overlapping words as "related" context, whether or not the user had connected the two chats. |
| 14 | The Browser panel still covered the chat mid-reply | Work no conversation owns (a sub-agent's own research, background cognition) still opened it through `GenesisSurfaceController`. |
| 15 | "Use what we found in my "…" chat" got a permission question instead of an answer (live check K) | The cross-chat context listed a chat the user had just named as "not authorized", because it only counted links and projects, not the user's own words. |
| 16 | Other chats' tool results reached every turn | `buildCognitiveContext()` put the last 8 agent events from all conversations, with their result text, into every chat's context. `MemoryBridge` took the "current thread" topic from the shared window. |
| 17 | "Link the video research chat" would have linked a merged chat | `findChat` returned the first title containing the words, and a merge's title contains its sources'. A default "New chat" title counted as named by any message containing "chat". |
| 18 | **A fact told to one chat "for this chat" was answered in an unrelated chat, unattributed** (measured by capturing the provider request) | It reached the other chat through five unlabelled carriers, all part of her cognition: "About the user" (long-term memory), "Recent knowledge nodes", a project checkpoint, the executive state's "Last action", and a paraphrased knowledge memory the model wrote with its own `memory.store` tool (paraphrased, so wording could not tie it to its source). |
| 11 | Each failed page counted as two issues in the activity | `browser.read` reports a page with both `browser_result` and `tool_result`, and the second added another row. |

## What changed

**The live tool loop** (`ProviderResolver.generateWithTools`, `AIService`)
- `AIService.steerTurn(conversationId, text)` accepts a message only while a turn is running in that conversation. The loop calls `request.drainSteering()` after each round of tool results. It emits `user_steering` and adds the message as a user turn that tells the model to take it into account. `takeSteering()` returns anything the turn never saw, and `GenesisChat` answers each of those as its own turn, so nothing is lost.
- Text the model writes alongside a tool call is emitted as `tool_narration` (an activity line), not reply text.
- Research-only turns get 3 min / 16 rounds. Any other tool brings back the 8 min / 40 round engineering limits. Whichever limit ends the loop, the model is told why and answers without tools.

**Tools** (`ToolDispatcher`, `ToolRegistry`)
- New `browser.read` (risk 1, read-only) uses the existing `BrowserTool.visit` and `/api/browse` reader. It emits `tool_*` and `browser_opened/navigation/result`, and returns `Page / URL / text`, capped at 6000 characters.
- Failures come back structured: what happened, plus "try another source". A page with almost no text is a failure, and a Google News redirect says to search the headline instead. A page asked for twice in one turn is fetched once.
- `research.web` takes an optional `focus` (news, video, academic, encyclopedia, code, space, tech, weather, location) that chooses the providers.
- `describeToolCall` gives each step a plain label, e.g. "Searching the web for "…"".

**Research** (`ResearchResolver`): an empty prefetch now adds a "LIVE RETRIEVAL — came back empty" note and hands the turn to the model. The honest retrieval-failure reply remains only when no model is available. A model's own tool query no longer gets "news" appended unless the focus is news.

**Streaming** (`openaiTools.readOpenAIStream`, the Groq, Fireworks, OpenRouter and Anthropic providers)
- One OpenAI-compatible SSE reader assembles tool-call fragments by index. It throws the API's own message on HTTP errors.
- Anthropic streams with tools. It assembles `tool_use` blocks from `input_json_delta`, reads `message_delta.delta.stop_reason`, and treats an `error` event as an error.

**Ownership** (`TurnOwnership`)
- `bindTask(taskId, conversationId)` / `ownerForTask` are set by `Orchestrator` and `AIService` (including delegated agents) for every chat turn.
- Activity, approvals, artifacts and surfaces are filtered by owner. An unowned task is never shown in a chat.

**Callers:** every `ai.chat` caller passes its conversation: GenesisChat, EngineeringChat, VoiceEngine, GenesisBrowserPanel and DeepLinkIntake. `GenesisBridge` binds streamed messages by `conversationId`, and cross-chat context uses the turn's conversation.

**In the chat** (`GenesisChat`, `chat/ChatActivity`, `chat/activityRecorder`, `core/multichat/TurnActivity`)
- An activity card above each reply is built only from that turn's own events. Collapsed, it shows searches, sources found, pages read, tools used and issues, the step running now, and the page being read in a small browser view: address, status, title, extracted text, "Open in LÉLU's browser" and "Original". Expanded, it lists every step, every page and the sources.
- When the turn ends the card is stored on the reply (`ChatMessage.activity`), so returning to the conversation shows it again. While a turn is running, switching away and back restores it live.
- A message sent while a turn runs is shown at once, bound to its chat, and goes into the turn. A message queued behind another turn is also shown at once.
- `GenesisExecutionTimeline` now shows only approvals, and only for the open conversation (plus any approval no conversation owns).
- `GenesisSurfaceController` no longer opens panels for a chat turn's tool events.
- The DuckDuckGo "browser" for "search the web" wording was removed. An explicit "open the browser" still works.

**Notifications** (`NotificationProvider`, `NotificationRouting`, `MultiChatTabs`)
- The existing provider gains `type`, `taskId`, `questionId`, read state (`read: false` on new records; older history is not resurrected as unread), `silent` (inbox only, no toast), `subscribeHistory`, `markRead` / `markQuestionRead` / `markConversationRead` / `markAllRead`, and `open(id)` (deep link plus mark read).
- Routing:
  - a side question raised by ProactiveCore goes to the inbox once, and is marked read when answered or dismissed;
  - a reply or failure in a conversation not on screen goes to the inbox;
  - an approval owned by another conversation goes to the inbox.
- Opening a conversation marks its reply notifications read.
- A **Chats** button in the conversation bar shows the unread count. Its panel has CHATS (every conversation, with working and unread state, plus New chat) and NOTIFICATIONS (icon, title, text, time and read state). Clicking a notification goes to its conversation, and a question opens its card.
- The question card is shown in a chat only when the question belongs to that conversation, or was opened from its notification.

**Anthropic** (`AnthropicProvider`): `temperature` is no longer sent to models that reject sampling (Claude Opus 4.7 and later: Opus 4.7/4.8/5.x, Sonnet 5.x, Haiku 5.x, Fable, Mythos). Without this, setting `ANTHROPIC_MODEL` to a current model would 400 on every turn and silently drop Anthropic from the chain.

**Each conversation's own history** (`AIService.priorTurnsFor`): the model's prior turns come from that conversation's messages in `MultiChatStore`, up to the current message. That is the same history the user sees in that chat. Callers without a conversation keep the shared window.

**Cross-chat research only when authorized** (`CrossChatResolver.reference`)
- Another chat's content is used only when the user authorized it: they linked the chats ("Link — share research with this chat" in a tab's options) or put both in the same project.
- It arrives labelled "From the chat "…" (linked by the user)", as reference material separate from this chat's history. LÉLU is told to say which chat each point comes from, and never to attribute one chat's content to another.
- A chat that only shares words is **not read**. Its title is named so LÉLU can offer to use it, and the user decides whether to link or merge.
- The reply's activity shows "Used research from the chat "…"" and "Related, not used (not linked): "…"", from a real `cross_chat_reference` event.

**Merged chats, from two or more** (`MultiChatStore.merge(ids)`)
- **Where:** in the Chats panel, "Merge chats…" lets you pick two or more chats, then "Create merged chat from N chats". A tab's options menu keeps a quick "Merge into a new chat" for two.
- **What you get:** a **new** chat with every message from all of them in time order. Each message carries `origin` (the chat it first came from; a merged chat merged again keeps the first source), and the transcript shows "from "…"" on each.
- **The originals are left unchanged** and are linked to the merge.
- **What the model sees:** "[from the chat "…"]" on every earlier message, plus a note naming all the source chats, so it keeps them apart. Its source chats are not read in again as extra context.
- **Linked research:** up to five linked chats can contribute to one turn, each labelled.

**Asking for it in the conversation** (`chats.*` tools, `multichat/ChatConsent`)
- You can say it in the chat: "use what we found in my video research chat", "merge this with the pitch chat", "link the budget chat here".
- She has four tools in the existing tool loop:
  - `chats.list`: titles only;
  - `chats.read`: that chat's relevant messages, labelled by chat;
  - `chats.link`;
  - `chats.merge`: two or more chats; the merged chat is created *beside* the one you're in (you aren't moved), announced in Notifications, and she tells you where it is.
- **Your words are the permission**, checked in code, not left to the model:
  - reading needs a link or a shared project, or you naming the chat or "the other chat", or a yes to her asking;
  - linking and merging need you to ask, or a yes to her proposing it;
  - things you say while the turn is running count too.
  - Otherwise the tool answers "ask them first" and nothing is read.
- **Bringing a chat up brings it in.** A chat you name in your message, or agreed to, is included in that turn's context, labelled "the user brought it up", even before she uses a tool. "My other chat" brings in only the best match. A full title in your message wins over chats that only share some of its words. A default "New chat" title is never matched by the word "chat".
- **When points connect:** related chats you haven't allowed are named to her (titles only). She decides whether the connection is worth raising. If you agree, she reads, links or merges, then says which chat each point came from.

**This chat's context is this chat's** (`CognitiveContext`, `MemoryBridge`): the recent agent events in a turn's context are only this chat's, plus background work no chat owns. The "current thread" topic comes from this chat.

**Her cognition, labelled by chat** (`multichat/ContextProvenance`, `MemoryBridge`, `memory.store`)
- Her memory and awareness still reach every chat; nothing is withheld from her. What changes:
  - **Labels:** at the last step before any provider, every context line that quotes another chat is marked "[from the chat "…"]".
  - **A note at both ends:** it opens and closes the context, names those chats, and says a reply using such a line must say where it came from in the same sentence, or ask whether to bring that chat in.
- **"Remember this for this chat", "only in this chat", "don't remember this"** stay in that chat. Neither conversation memory nor her `memory.store` tool makes them long-term.
- **Source on stored memories:** whatever `memory.store` does save from a chat carries "(learned in the chat "…")". That covers paraphrased memories, which can't be matched by wording.
- **Measured, live, with the provider request captured:**
  - **Before:** a codename told to chat A "for this chat" was answered in chat C as "The product codename is ZORBLAX-PELICAN".
  - **After:** chat C's request carried no trace of it, and she answered: "I see that there's a related chat titled "Remember for this chat: our product…" that might contain it, but I don't have permission to read it yet. Would you like me to access that chat (or merge its contents with this one)?" An unrelated question in chat B no longer mentioned the codename or Reykjavik.
  - **An ordinary fact** (a CFO's name) asked about in 3 fresh chats was answered with its source each time: "From our "Our CFO's name is…" chat: our CFO is Marta Vilhjalmsdóttir." One earlier run, before the note moved to both ends, answered without the source.

**No agent event replaces the chat** (`GenesisSurfaceController`, `GenesisBrowserPanel`): while the chat panel is active, agent events only update module status. Buttons the user presses still open panels. The Browser panel no longer follows other conversations' pages.

**A live turn is drawn only in its own conversation** (`GenesisChat`): each live turn records its conversation, and the transcript does not draw another conversation's live turn during the frame after a switch.

**Secrets:** no change in where keys live. Model calls from the browser go to the same-origin broker (`/api/model/<provider>`), which attaches the key server-side. An out-of-date comment in `AnthropicProvider` claiming keys were in the bundle was corrected.

## Tests

**Automated**
- **Type check:** `npx tsc -b --force` exits 0.
- **Lint:** `oxlint` shows no new warnings in the changed files.
- **`npm test`:** **934/934** on the final code (was 895 before this pass). `tests/live-agent.test.ts` adds 39 tests, run against local fakes with no network:
  - activity built from real events only; finishing a turn settles running steps honestly; a page counts once;
  - task ownership, and a recorder that keeps only its own conversation's events;
  - steering accepted only during a turn; the tool loop hands the message to the model after the tool results it arrived during, and emits `user_steering` and `tool_narration`;
  - the research-only loop stops at 16 rounds and the model is told why;
  - OpenAI-shaped stream tool-call assembly, and the HTTP error message;
  - Anthropic streamed `tool_use` assembly with tools on, `stop_reason` read from `message_delta.delta`, and a stream `error` event treated as an error;
  - `browser.read` structured failures (blocked page, no URL, Google News redirect), repeat reads, and a 403 from the site reported as such;
  - the empty prefetch handing over to the model, and the honest failure when no model is available;
  - research focus choosing the providers;
  - the inbox: silent, unread, opened and read; a reply in another chat notifies, in the open chat it does not; a question notifies once;
  - no sampling parameters for Claude models that reject them;
  - the model gets only its own conversation's history, up to the current message (no other chat's turns, no later queued message);
  - other chats' research used only when linked, labelled by chat; unlinked chats offered, never read;
  - consent from the user's words: naming the chat, "the other chat", or yes to her asking (a bare yes is not consent); merge only on request; words said mid-turn count;
  - `chats_read` refuses an unmentioned chat without leaking it; `chats_merge` creates beside the current chat and notifies; `chats_link` links only on request;
  - naming a chat brings it into the turn's context; a vague "other chat" brings only the best match; finding a chat picks the closest title, not a merge containing it;
  - merging two, three or more chats: time order, every message labelled by its first source, originals unchanged, sources named to the model;
  - a live turn drawn only in its own conversation; no agent event opens a panel over the chat.
- **`npm run build`:** exit 0.
- **`scripts/verify-bundle-secrets.ts`:** passes. No chat-provider key or token is in the built files.
- **`npm run verify:layout`:** ALL LAYOUT CHECKS PASSED at phone, tablet, desktop and the constrained container. The new Chats button is in the bar, so the bar was re-measured.
- **`scripts/verify-workspace-isolation.mjs`** (real sends): ALL CHECKS PASSED. That includes:
  - a message sent while a reply was streaming is not dropped, keeps its order, and gets its own reply;
  - a reply that arrives after switching away is stored in its own conversation.

**Live, scenarios A–J** (`agent-qa.mjs`, headless Chromium against the dev server, real providers: Groq, Fireworks, OpenRouter and Cerebras keys are present; Anthropic's is not). Seven runs; each one that found something was followed by a fix:
- **Run 1:** discarded. I briefly hot-reloaded old code mid-run.
- **Run 2:** found bug 6 (the New chat takeover), bug 7 (Google News redirects) and bug 8 (the reader's false "unavailable").
- **Run 3:** after those fixes, A–G and I passed. H's script read the screen and store too early; a focused repro (`h-repro.mjs`) showed H working, and also found bug 9 (the 8-minute research turn).
- **Runs 4–6:** found bug 12 (contamination through the shared history) and bug 14 (the panel still opening from unowned work). Run 4 was cut short when the dev server hit its two-hour limit, and runs 5–6 were stopped to add the cross-chat work.
- **Run 7:** the final full pass, A–J (J added for cross-chat research and merging), on the code before the last render guard:

| | Scenario | Result (run 7) |
|---|---|---|
| A | Normal question | ✅ "A nebula is a massive, diffuse cloud of gas and dust…", 16 s |
| B | Web search actually happens | ✅ Real `research.web` and `browser.read` calls. **Slow:** 221 s, 10 searches; none of the 4 pages could be read (Google News redirects, sites refusing the reader), so it searched until the 3-minute research budget stopped it, then answered from what it found. |
| C | Multi-source research, several tool calls | ✅ Its own chat, with a live card showing searches, sources and the page being read |
| D | Message sent while research runs | ✅ Shown at once, stored in the research chat, composer cleared. `user_steering` fired, and the activity says "Took in your new instruction". |
| E | New chat while a task runs | ✅ The new chat shows nothing of the running research |
| F | Side question → Chats → Notifications | ✅ No card over the chat. The Chats button shows 1 unread, the panel lists CHATS (with "Merge chats…") and NOTIFICATIONS, and opening the notification shows the question card and marks it read. |
| G | Tool failure leaves the chat usable | ✅ "I wasn't able to fetch that page…", the failure recorded in the card, no "undefined". A follow-up question was answered in 20 s, taken into the still-running turn as steering. |
| H | Switching chats while streaming | ✅ The telescope chat got a telescope answer; run 4 had shown bug 12 here. The research reply stayed in its own chat with its activity stored (16 steps). One snapshot 0.8 s after switching showed the telescope reply drawn under the research chat for a moment. **Fixed afterwards**: live turns are now drawn only in their own conversation. A focused repro (`switch-repro.mjs`) of the same sequence showed no leak at any snapshot and exactly one reply in the research chat. |
| I | Returning shows the activity | ✅ The stored activity card, expandable, with every step |
| J | Other chats' research, and merging two or more chats | ✅ **Unlinked:** answered from its own search; the research chat was not used. **Linked:** "Mention Runway Gen-3, as recommended in the linked research chat "Research the latest AI video generation developments."", with "1 other chat used" in the card. **Merge of 3 chats** from the Chats panel: a new chat with all 9 messages, a "from "…"" label for each source, and all three originals unchanged. |

Run 7 logged no app console errors.

**Scenario K: asking for it in the conversation** (`k-repro.mjs`, after the `chats.*` tools)
- **First run:**
  - Naming the research chat got "May I access that conversation (or link/merge it)?", so she asked although the user had already named it. That is bug 15, fixed.
  - "Merge this chat with the "…" chat" made a real `chats_merge` call and created the merged chat beside the current one. The card said "no tools used"; it now says "merged into a new chat".
- **Second run, on the final code:**
  - "Use what we found in my "Compare Veo 3 and Runway Gen-4…" chat to improve the pitch line" → "Improved pitch (based on the findings from the "Compare Veo 3 and Runway Gen-4…" chat): …", with "Using other chats · 1 other chat used" in the card.
  - "Merge this chat with the "…" chat" → "The chats have been merged into a new conversation titled "Merged: Pitch + Veo vs Runway". You'll see it in your Chats panel…". You stayed in the chat you were in; the new chat has 7 messages labelled with both sources; a "Merged chat ready" notification appeared; the card says "1 other chat used · merged into a new chat".
  - The third chat's answer used AI-video details the research chat also had. That is what led to measuring her cognition's carriers (bug 18, below).

## What remains

- **Anthropic was not exercised live.** No `ANTHROPIC_API_KEY` is configured in this environment, so Anthropic (priority 1, first in the chain whenever a key is set) is disabled here. Every live turn above ran on Groq, Fireworks, OpenRouter or Cerebras. Its streaming, `tool_use` assembly and error handling are covered by unit tests against recorded event shapes, checked against the Claude API reference. Set the key server-side; the browser goes through the broker.
- **Decisions for you on Anthropic:**
  - **Default model.** The default is `claude-sonnet-4-5` (`ANTHROPIC_MODEL` overrides it). The current default in the Claude API reference is `claude-opus-5-5`. Moving to a 5.x model also needs the tool loop to pass back the assistant's `thinking` blocks between tool rounds (they are dropped today), plus a decision on effort. Not done here.
  - **API version.** The provider sends `anthropic-version: 2023-06-01`. The newer `2026-10-21` version removes `temperature`/`top_p`/`top_k` from Messages requests (migration guide: https://platform.claude.com/docs/en/api/migration-2026-10-21). Not switched here.
- **Not every provider streams with tools.** Cerebras, Mistral, GitHub Models and Gemini still don't stream while tools are offered. They answer in one piece, and their tool calls still work.
- **Google News links cannot be read.** Most news search results are Google News redirect links, so news research mostly works from search snippets. LÉLU now says so and searches the headline instead of claiming it read the page. Sites that refuse the reader (BBC returned HTTP 403 through this environment's network) are reported as refusing.
- **Four data-API keys still ship to the browser**, reported by the bundle scan: `VITE_FIRMS_API_KEY`, `VITE_MESHY_API_KEY`, `VITE_GUARDIAN_API_KEY` and `VITE_GNEWS_API_KEY`. They predate this pass and none is a model key. Moving them behind the broker is the remaining step for "no keys on the client".
- **Task ids are millisecond timestamps.** `AIService` chat task ids are `String(Date.now())`. Two turns in different conversations starting in the same millisecond would share one, and the later `bindTask` would win. Orchestrator tasks use UUIDs.
- **Research can be slow here, because pages often cannot be read.** B took 221 s and ended on the research budget. A turn that also used non-research tools (G) gets the longer engineering budget and ran over two minutes, though the chat stayed usable and steerable the whole time.
- **A multi-step request's background steps are not shown in the chat.** For requests like "search, open pages, compare", the Orchestrator also creates a TaskEngine task whose steps run `ai.chat` under the task's id, not the chat's. That work is real and owned, but it shows in no conversation's activity card, and it can keep running after the chat has replied.
- **The last render guard** (live turns drawn only in their own chat) is verified by a unit test and a focused repro, not by another full live run.
- **Attribution is an instruction to the model, not a guarantee.** The labels and the scoping are enforced in code. Whether a reply names its source chat depends on the model following the note: 3/3 in the final measurement, but one earlier run did not. Small samples, one provider mix (Groq/Fireworks/OpenRouter/Cerebras).
- **The offline path (no provider reachable) was seen answering from another chat's text** in a run where the dev server had died. It answers straight from long-term memory, which now carries chat labels for `memory.store` writes. The other carriers are labelled only on the provider path, and the offline path was not re-measured.
- **Background curiosity** analyses buffered messages from any chat in its own internal calls ("is there an ambiguity here?"). That is not part of a reply, and was left as is.
- **Live re-check limits:** scenario K (asking in the chat) and the codename/CFO measurements were run after these changes. The full A–J run was not repeated after them; the dev server stopped at its two-hour limit near the end.
- **Background work** that no conversation owns (cognition, curiosity research) still opens its surface panels, but no longer while you are in the chat.
- **Not tested on a physical phone**, and voice dictation was not exercised (headless Chromium has no speech recognition).
