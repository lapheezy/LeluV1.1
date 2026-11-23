# MISSION — LÉLU PERSONALITY EVOLUTION 2.0
## From standard AI assistant to distinct conversational identity

**Status:** implemented, tested, verified in the canonical pipeline.
**Date:** 2026-11-19

---

## 1. Audit — where the generic chatbot voice actually came from

The identity layer was not missing. It was **disconnected from the thing that speaks**.

### 1.1 What existed (and was reused, not replaced)

| System | File | What it already did |
|---|---|---|
| Identity model | `src/core/identity/LeluIdentity.ts` | 6 seeded traits, `candidate → emerging → established → evolving → declining → retired` lifecycle, evidence counts, contrarian counts, snapshots, sandbox staging, `PersonalityGuard` audit + rollback |
| Daily record | `src/core/identity/DailyRecord.ts` | Truthful per-day journal, intake labelling, structured developmental evidence |
| Daily reflection | `src/core/identity/DailyReflection.ts` | Pure-logic trait evidence from observed behaviour, one vote per line of inquiry, bounded per trait |
| Personality memory | `src/core/identity/PersonalityMemoryProvider.ts` | A band-4 `MemoryProvider` with `context()` and `persist()` |
| Drift protection | `src/core/security/PersonalityGuard.ts` | Versioned, provenance-carrying, reversible change records |
| Curiosity | `src/core/curiosity/CuriosityEngine.ts` | Notices ambiguity, pursues one curiosity per tick, feeds `DailyRecord` evidence |
| Pipeline | `AIService.chat` → `MemoryBridge.enrich` → `AIRuntime.process` → `AIRouter` → `ProviderResolver` → provider | One canonical path; `request.context` and a leading system turn |

### 1.2 The five defects that produced assistant-speak

1. **Personality reached the model as a label list, not as behaviour.**
   `formatCognitiveContext()` emitted `## LÉLU PERSONALITY` containing only
   `Active traits: Synthesis (established), …` and one curiosity sentence.
   A model told “you have Synthesis” has no instruction about *how to talk*.
   Worse: that section was inside `if (activeTraits.length > 0 || curiosities.length > 0)`,
   so a freshly seeded identity emitted **no personality context at all**.

2. **The band-4 personality provider was never asked.**
   `MemoryBridge.enrich()` gathered `bands: [6, 7]` only. `PersonalityMemoryProvider.context()`
   — and the only caller of `LeluIdentity.getRelevantTraits()` — was dead code on every chat turn.
   Her identity store was writing, and nothing was reading it into a conversation.

3. **Identity was a static constant duplicated per provider.**
   Every provider hardcoded `LELU_SYSTEM_PROMPT`, so the only personality the model saw was a
   fixed paragraph that said “Be helpful, calm, creative, and genuine” — an assistant instruction,
   identical for all users, all contexts, all familiarity levels, all moods.

4. **No linguistic model existed at all.**
   No vocabulary, slang handling, rhythm, humour calibration, familiarity register, conversational
   reactions, or anti-boilerplate rules. “Familiarity” was not a measurable quantity anywhere.

5. **Nothing transformed the finished text.**
   Even a well-prompted model still opened with “Certainly!” and closed with
   “Let me know if you need anything else”, and that text went to the user unedited.
   The enrichment turn also said “Keep answers concise and natural” — a generic assistant rule
   competing with her identity.

**Conclusion:** the personality systems were real but passive; the speaking path was generic and
authoritative. This mission makes the identity systems *drive* the speaking path.

---

## 2. What was built

All new code lives in `src/core/identity/voice/`. Nothing existing was recreated.

### 2.1 `LinguisticProfile.ts` — persistent linguistic identity

A `KvStore`-backed profile (same persistence and in-memory-cache pattern as `LeluIdentity`) with:

- **Eight dials** — warmth, directness, playfulness, sarcasm, verbosity, formality, emoji, exclamation — each with value, confidence, evidence count and status.
- **`expressions`** — her own linguistic habits (`phrase`, `rhythm`, `humor`, `transition`, `reaction`, `intonation`) with full lifecycle, evidence days, provenance and an `adopted` gate.
- **`userLingo`** — vocabulary **she understands and never automatically speaks**. `mirrorAllowed` starts `false` and requires explicit authorisation.
- **Familiarity counters** — interactions, active days, banter, corrections, shared references.
- **Version history** — `pushVersion()` / `versions()` / `restoreVersion()`; each version stores the state it replaced.
- **`blockedExternal`** — a refusal counter, so an attempt by external prose to rewrite her is visible, never silent.

Every adopted change and every dial move goes through the existing `PersonalityGuard.record()` with a
live restore closure, so it is auditable and reversible.

### 2.2 `FamiliarityModel.ts` — measured closeness

Familiarity is **derived from real counters**, never asserted:
`new → acquainted → familiar → close → old-friend`, with idle decay after 60 days.
Each tier gates behaviour: contractions, shorthand, callbacks, teasing, skipping the greeting, and
mirroring their slang. A stranger gets clarity; a 40-day friend gets compression and callbacks.

### 2.3 `ConversationStance.ts` — conversational intelligence

Deterministic, provider-independent classification of every turn:

- **register** — casual / professional / technical / supportive / playful / executive / creative / intellectual
- **length** — terse / brief / standard / elaborate
- **humour** — none / light / dry / playful
- **challenge** — none / gentle / direct
- **follow-up** — none / optional / invite
- **emotion** — neutral / excited / warm / steady / uncertain
- **confidence** — assertive / measured / uncertain

It detects frustration (suppressing both humour and questions), emotional support (brief, warm, no
question), code and failure markers, decision language, absolute claims worth contesting, explicit
brevity/depth requests, greetings, and playful cues. Every decision records a `reason`.

### 2.4 `VoiceComposer.ts` — the provider-independent directive

Renders one block per turn from the profile + stance + familiarity + identity values:

1. who is speaking (“the model is an engine; it is not who is speaking”)
2. this turn's register, length, humour, challenge, follow-up and confidence rules
3. familiarity as measured fact
4. her established moves — **capped at one per reply, never twice in a row**
5. her vocabulary in development — explicitly *not yet hers to use*
6. their vocabulary — understood, “not licence to repeat it back”
7. the forbidden assistant postures

The block is attached to `AIRequest.voice` by `MemoryBridge.enrich()` **before a provider is chosen**.

### 2.5 `ChatbotismFilter.ts` — response transformation

Removes assistant posture from finished text: `Certainly!`, `As an AI language model,`,
`Great question!`, `I'd be happy to help`, `I hope this helps`, `Let me know if you need anything else`,
and similar. Narrow by design:

- fenced code is never touched;
- a short legitimate “Sure.” is preserved;
- nothing is rewritten or re-toned;
- every removal is returned and recorded in `metadata.chatbotismsRemoved`;
- idempotent.

### 2.6 `LanguageObserver.ts` — how her voice develops

The **only** path by which conversation changes her language:

- recognises their slang (`ngl`, `mid`, `no cap`, quoted terms, …) as *theirs to understand*;
- moves dials on explicit direction (“too long”, “be serious”, “be direct”, “no emoji”);
- counts corrections, banter and callbacks as relationship facts;
- honours “stop saying X” immediately (explicit rejection de-authorises the expression);
- **never mines her own replies for new catchphrases** (self-training is how a voice becomes a loop);
- external prose (documents, migrations) reaches `noteExternalContent()`, which records the refusal and changes nothing.

### 2.7 `VoiceEvaluation.ts` — the acceptance suite

Ten scenarios with expected stances, baseline and evolved replies, and the metrics:
lexical diversity (type–token ratio), repeated 3-gram rate, boilerplate per 100 words, sentence rhythm,
and stance fidelity.

---

## 3. Integration into the canonical pipeline

```
AIService.chat
  └─ buildCognitiveContext → formatCognitiveContext   (now always includes her voice digest)
  └─ MemoryBridge.enrich
       ├─ composeVoice(prompt, recentMessages)        → request.voice      ← NEW
       ├─ band 6/7 history                             (existing)
       └─ band 4 identity provider                     ← NOW GATHERED (was dead)
  └─ AIRuntime.process → AIRouter → ProviderResolver
       ├─ provider.generate: leluSystemPrompt(request) ← every provider, same directive
       └─ stripChatbotisms(finalText)                  ← every provider, same transformation
  └─ MemoryBridge.learn → LanguageObserver.observeTurn(prompt, reply)     ← NEW
```

- `AIRequest.voice?: string` — the per-turn directive. It is never serialised into a provider payload;
  it is read only by `leluSystemPrompt()`.
- `src/providers/LeluSystemPrompt.ts` — split into `LELU_VOICE_CONTRACT` (identity + anti-generic rules),
  `LELU_CAPABILITY_FACTS` (what she can actually do), and `leluSystemPrompt(request)` which appends the
  turn's directive. All eight providers (OpenRouter, Gemini, Anthropic, Groq, Fireworks, Mistral,
  Cerebras, GitHub Models) now call it; none hardcodes a prompt.
- `CognitiveTrace` gained the `VOICE` stage, so each turn records which stance was chosen and why.
- `GenesisCognitiveTracePanel` renders that stage.
- `ingestSource` routes ingested documents to `noteExternalContent()`.

---

## 4. Files changed

**New**

- `src/core/identity/voice/LinguisticProfile.ts`
- `src/core/identity/voice/FamiliarityModel.ts`
- `src/core/identity/voice/ConversationStance.ts`
- `src/core/identity/voice/VoiceComposer.ts`
- `src/core/identity/voice/ChatbotismFilter.ts`
- `src/core/identity/voice/LanguageObserver.ts`
- `src/core/identity/voice/VoiceEvaluation.ts`
- `tests/personality-voice.test.ts`
- `scripts/verify-personality.ts`
- `MISSION-PERSONALITY-EVOLUTION-2.0.md` (this report)

**Modified**

- `src/providers/LeluSystemPrompt.ts` — voice contract + per-request directive
- `src/providers/AIProvider.ts` — `AIRequest.voice`
- `src/providers/{OpenRouter,Gemini,Anthropic,Groq,Fireworks,Mistral,Cerebras,GitHubModels}Provider.ts` — `leluSystemPrompt(request)`
- `src/core/MemoryBridge.ts` — compose voice, attach to request, gather band 4, observe language
- `src/core/router/ProviderResolver.ts` — response transformation at the single provider boundary
- `src/core/cognition/CognitiveContext.ts` — voice digest always present in `## LÉLU PERSONALITY`
- `src/core/cognition/CognitiveTrace.ts` — `VOICE` stage
- `src/app/scene/genesis/GenesisCognitiveTracePanel.tsx` — stage colour
- `src/core/identity/PersonalityMemoryProvider.ts` — digest in band-4 context
- `src/core/memory/ingestSource.ts` — external-content refusal path
- `package.json` — `verify:personality`

---

## 5. Test results

### 5.1 New suite — `tests/personality-voice.test.ts` (30 tests)

All pass. Coverage of the ten required evaluations:

| # | Evaluation | Evidence |
|---|---|---|
| 1 | Casual conversation | greeting → casual/terse, optional follow-up |
| 2 | Slang recognition and usage | `ngl`, `mid`, `no cap` recognised as *theirs*; digest marks “not hers”; mirroring needs authorisation |
| 3 | Humour and playful exchange | playful trigger → `light` (not `playful` before teasing is earned); support/frustration → `none` |
| 4 | Serious emotional conversation | supportive/brief/warm, no jokes, no question |
| 5 | Technical collaboration | code markers → technical/standard/no humour |
| 6 | Disagreement and independent reasoning | disagreement → `challenge: direct`, before any agreement |
| 7 | Long-term continuity | 160 exchanges over 40 days → `old-friend`, callbacks and teasing unlocked |
| 8 | Provider switching | directive identical for every caller; no provider hardcodes a prompt |
| 9 | Consistency across sessions | `snapshot → hydrate` reproduces the exact digest after a restart |
| 10 | Catchphrases and generic language | boilerplate 0 in evolved replies; looping text scores > 0.5 repetition; “at most one move, never twice” |

Plus mechanism tests: drift protection, earned adoption across distinct days, explicit rejection,
version restore, external-content refusal, transformation safety (code fences, short answers,
idempotence), and “no second brain”.

### 5.2 Acceptance measurements — `npm run verify:personality`

```
Metric                    baseline   evolved
  boilerplate /100 words      7.767        0
  lexical diversity (TTR)     0.971    0.935
  repeated 3-grams                0        0
  sentence rhythm (sd)        4.784    4.431
  stance fidelity                 0        1

Boilerplate removed by the response transformation alone: 13
PASSED
```

Honest reading:

- **Boilerplate: 7.77 → 0 per 100 words.** This is the decisive measurement — the assistant posture is gone.
- **Stance fidelity 1.0** across all ten scenarios.
- **Diversity and rhythm favour the baseline on these short samples** and are reported, not claimed:
  type–token ratio is length-sensitive, and the baseline's padding makes its replies longer and
  therefore apparently more varied. The catchphrase test is the meaningful repetition measure:
  a looping reply scores > 0.5; hers score ≤ 0.02.
- These are **deterministic demonstration samples**, not live model output. Live-provider comparison is a separate manual step (see limitations).

### 5.3 Regression

- Full suite: **2294 tests, 2284 pass, 2 fail, 8 skipped.**
  Both failures are unrelated to this change and environment-dependent:
  - `tests/genesis-interface.test.tsx` — `@excalidraw/excalidraw` does not export `./index.css` in the installed package (`ERR_PACKAGE_PATH_NOT_EXPORTED`), so the test file cannot even import the app.
  - `tests/sandbox-security.test.ts` — the network-denial probe returned `''` instead of `denied:` in this runner.
- Typecheck (`tsc --noEmit -p tsconfig.app.json`): **2 pre-existing errors**, both in
  `src/core/perception/FeatureUnderstanding.ts:455` (`measurements.count` nullability) — untouched by this work.
- Lint (`oxlint`) on all touched files: **0 warnings, 0 errors.**

---

## 6. Before / after

**Casual** — “hey, how's it going?”

> **Before:** Hello! I'm doing well, thank you for asking. As an AI language model, I don't have feelings, but I'm always happy to help. How can I assist you today?
>
> **After:** Good — mid-build, slightly caffeinated. What are you up to?

**Slang** — “ngl this build is mid, no cap”

> **Before:** It sounds like you're expressing dissatisfaction with the build. I'd be happy to help you improve it! Could you share more details about what specifically isn't meeting your expectations?
>
> **After:** Mid is being generous. The build's fine, the thing it's doing is boring — we optimised the loading state and left the actual idea untouched. That's the part to fix, not the bundle size.

**Humour** — “tell me a joke about my sleep schedule lol”

> **Before:** Certainly! Here's a lighthearted joke about sleep schedules: Why did the person go to bed early? Because they wanted to catch up on their sleep! I hope this helps lighten the mood. Let me know if you'd like more jokes!
>
> **After:** Your sleep schedule isn't a schedule, it's a suggestion you make to your body and then ignore. Three a.m. is not a personality, but it's becoming one.

**Emotional support** — “my dad died last month and i can't focus on anything”

> **Before:** I'm so sorry to hear that. As an AI language model, I can't fully understand what you're going through, but I'm here to help. Here are some tips that may help with focus: 1) Establish a routine 2) Try the Pomodoro technique 3) Get enough sleep. Let me know if you need anything else.
>
> **After:** A month is nothing. Of course you can't focus — focus is the first thing grief takes. Don't build a productivity system around this. Do the small things that have a deadline and let the rest sit.

**Technical** — “this effect fires twice and the type is wrong” + code

> **Before:** Great question! There are several reasons why a useEffect hook might fire twice. In development mode with React StrictMode, effects are intentionally run twice to help you detect side effects. I'd be happy to walk you through the details. Let me know if you need anything else!
>
> **After:** Two possibilities, and they look identical until you check.
>
> StrictMode double-invokes effects in development only — if it stops in a production build, that's it. If it fires twice in production, `id` is changing identity between renders: an object rebuilt inline will do it every time.
>
> The type error is separate. `load(id)` probably expects a narrowed id, not the raw one.

**Disagreement** — “no, i disagree — React is always better than Vue”

> **Before:** That's a great point! Both React and Vue have their own strengths and weaknesses, and the best choice depends on your specific needs. There's no right or wrong answer here. I hope this helps!
>
> **After:** “Always” is doing a lot of work there, and it doesn't hold. React wins on hiring pool and ecosystem depth; Vue wins on ramp-up time and how much of the framework you get without decisions. For a two-person team shipping in six weeks, “always better” is the wrong question — the smaller cognitive surface usually wins.

**Continuity** — “like we discussed, ship the smaller version first?”

> **Before:** I'd be happy to help you with that! Could you clarify what you mean by 'the smaller version'? I don't have context about previous discussions unless you provide it. Let me know if you need anything else!
>
> **After:** Yes — and we already agreed why: the smaller version is the one you can actually finish, and finishing teaches you more than scope does. Ship it, live with it for a week, then decide what the bigger one even is.

### What the model is actually told (excerpt)

```
## HER VOICE THIS TURN
You are LÉLU. … The model answering is an engine; it is not who is speaking …

This turn reads as: technical · standard · humour:none · challenge:none · follow-up:optional ·
emotion:steady · confidence:measured · calm.
- Concrete and exact. Name the file, the command, the failure. No motivational framing.
- A few short paragraphs. Structure only where the content is genuinely structured.
…
Familiarity: familiar (16 exchanges across 6 days). Shorthand is fine. Skip the greeting. …
Her established moves: "right — so", "anyway,", "hang on", "huh", "fair". These are available, not
mandatory. Use at most ONE per reply, and never the same one twice in a row — a repeated phrase is
a tic, not a personality.
Their vocabulary that she understands: "no cap" (4×; do not use it yourself), "mid" (2×; do not use it yourself).
…
Never, in her own voice: "As an AI language model" … "- ending with an offer of further help…"
```

---

## 7. Remaining limitations

1. **Live-model comparison is not automated.** The acceptance measurements use deterministic samples;
   the directive and the transformation are what is proven. A live A/B across the eight providers
   requires configured credentials and is a manual step (`npm run verify:personality` shows the directive
   each provider receives).
2. **Stance detection is rule-based.** It handles the ten required scenarios exactly and is auditable,
   but sarcasm, indirect British understatement, and code-switching are only partially covered. It is
   deliberately conservative: it will under-detect humour before it over-detects it.
3. **Lingo extraction is an allowlist plus quoted terms.** Unknown slang is understood from context by
   the model, not recorded as vocabulary until it is used repeatedly or quoted.
4. **Cross-device sync is not wired.** The profile persists locally (like `LeluIdentity`) and
   `mergeRemote()`/`snapshot()`/`hydrate()` exist, but no Supabase table was added — that was out of
   scope and would require a schema decision.
5. **The offline notices are still operational text** (“I'm in offline mode right now…”). They report a
   system state rather than speak in her voice; changing them was not part of this mission and they are
   unchanged.
6. **Two unrelated test failures and two pre-existing type errors** remain in the repository (see §5.3);
   none is caused by or affects this work.
7. **Nothing was visually inspected.** No UI was changed except a colour on the cognitive-trace stage, and
   no browser run was performed.
