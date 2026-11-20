# WP05 — Telemetry, activity and profile persistence

Two pathways M22.6 listed as unaudited are audited here against the eight
questions the mission asks, with the decision that follows. Nothing was erased
silently; where a store is not memory-derived it stays exactly as it was.

## `cognitive_events` — activity/telemetry

| Question | Answer |
|---|---|
| Stores user-provided content? | **Yes, indirectly** — `payload` is the whole `AgentEvent`, which carries task text. |
| Memory-derived? | Yes: a task description can quote a memory. |
| Can reconstruct a deleted statement? | Yes, if the event payload carried it. |
| Necessary for functionality? | Yes — the activity stream feeds status and the trace. |
| Subject to user deletion? | It was not. |
| Retention policy? | Bounded: 500 rows per user, trimmed by the `trim_lelu_events` trigger. |
| Queryable by the authenticated user? | Yes (RLS owner policy). |
| Sent to an external service? | No. |

**Decision:** keep the events, remove the content. `persistCognitiveEvent` now
passes the payload through `DeletionGuard.scrubDeep` before the insert. Test `L`
asserts the quoted sentence is gone while an unrelated operational field
(`detail: "unrelated progress"`) is untouched.

## `user_preferences.profile` — the user's own profile

| Question | Answer |
|---|---|
| Stores user-provided content? | Yes — name, preferences, settings the user typed. |
| Memory-derived? | **No.** It is not produced from memory records. |
| Can reconstruct a deleted statement? | Not by construction; a user could type the same words here deliberately. |
| Necessary? | Yes. |
| Subject to deletion? | Not by a memory deletion — that would erase unrelated account data, which the mission forbids. |
| Retention? | Lives while the account does. |
| Queryable? | Yes, by its owner only. |
| External? | No. |

**Decision:** untouched, and documented as intentional. Erasing a profile field
because a memory happened to contain similar words is exactly the
"indiscriminate erasure" the brief rules out.

## The three development documents

`user_preferences` also holds `lelu_identity`, `lelu_daily` and
`lelu_curiosity` — the self-model, the journal and the curiosity ledger. These
**are** memory-derived (they are conclusions drawn from what was learned), which
is why M22.6 scrubbed the self-model on read. A read filter alone left them
carrying the sentence on the wire: every sync re-uploaded it.

**Decision:** scrubbed at the outbound seam (`persistDevelopmentRecord`), so the
local copy stays the user's own record and every upload is clean.

## Stores examined and deliberately unchanged

| Store | Why nothing is needed |
|---|---|
| `api_health` | provider, status, latency. No content. |
| `ui_state` | view state (panels, layout). No memory text. |
| `news_preferences` | topic strings the user chose. |
| `proactive_questions` | the question LÉLU asked and the user's answer — the user's own words, not a memory record. |
| `agents` | agent configuration and status. |
| `news`/`knowledge` | knowledge is derived → scrubbed (WP06). |

## What is still not covered

`legacy_memories` (no write path — WP04) and transcripts (policy in WP06). Both
are named in the final report rather than presented as covered.
