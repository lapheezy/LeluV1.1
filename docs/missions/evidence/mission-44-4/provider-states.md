# Provider states — Mission 44.4 (WP03)

## The distinction the state machine now carries

| Fact | Field | Meaning |
|---|---|---|
| we hold a credential | `state !== "UNCONFIGURED"`, `providers[id]` | configuration only — never a capability claim |
| the provider **answered** | `reachable: true / false` (absent = never contacted) | a 404 is an answer; a refused socket is not |
| a **model completed** | `state === "COMPLETION_VERIFIED"` (+ `httpStatus`, `at`) | a real 2xx whose body is a JSON completion |

New state: **`MODEL_UNAVAILABLE`** — the provider was reachable and refused the *model*.
It is transient (expires to `CONFIGURED`) like `CAPACITY_LIMITED`, because a catalogue changes.

`reachable` is set on every observation: `true` for 401/403/404/429/5xx and for a completion,
`false` only when no HTTP response arrived at all (the `catch` path, which previously recorded
**nothing** and left an unreachable provider labelled `CONFIGURED`).

## Live evidence (real broker, real credentials, no key printed)

| Probe | HTTP | Recorded state |
|---|---|---|
| Groq, model `definitely/not-a-model` | **404** `{"error":{"message":"The model … does not exist…","type":"invalid_request_error","code":"model_not_found"}}` | `{"state":"MODEL_UNAVAILABLE","httpStatus":404,"note":"type=invalid_request_error \| code=model_not_found \| The model … does not exist…","reachable":true}` |
| Groq, `openai/gpt-oss-120b` | **200** | `{"state":"COMPLETION_VERIFIED","httpStatus":200,"reachable":true}` |
| OpenRouter, `nvidia/nemotron-3-ultra-550b-a55b:free` | **200** (a real completion) | `{"state":"COMPLETION_VERIFIED","httpStatus":200,"reachable":true}` |
| OpenRouter, unknown model `definitely/not-a-model` | **402** from the **spending policy**, before any upstream call | state untouched — no provider observation was invented from a local refusal |

Note on OpenRouter: 44.3 recorded `404 — this model is unavailable for free` for this free model.
On 2026-11-27 the same model **completed**. The state correctly moved to `COMPLETION_VERIFIED`;
the 44.3 transcript is a historical record, not a contradiction.

## Covered by unit tests (`tests/broker-contract.test.ts`, 11/11)

| Case | Assertion |
|---|---|
| model-level 404 | `MODEL_UNAVAILABLE`, `reachable: true`, `httpStatus 404`, provider stays in the chain, provider's own reason kept |
| transport failure (`ECONNREFUSED`) | `UNREACHABLE`, **`reachable: false`**, note carries the error |
| successful completion | `COMPLETION_VERIFIED`, `reachable: true` |
| exhausted quota (429) | `CAPACITY_LIMITED`, `reachable: true` |
| rejected credential (401) | existing: `COOLDOWN`, provider removed from the chain |
| never contacted | `CONFIGURED`, **no `reachable` field at all** |
| credential hygiene | no response body anywhere contains the secret |

## Remaining gaps (not papered over)

1. `providers[id]` stays `true` after `MODEL_UNAVAILABLE`: a refused model does not confiscate the
   credential, and the chain may legitimately ask for a different model. The state carries the truth;
   the boolean keeps meaning "worth trying".
2. `reachable` describes the **last** observation. A provider that completed and then refused a
   socket reads `UNREACHABLE / reachable:false` until the transient TTL expires (120 s), which is
   the intended "most recent fact wins" rule.
3. The 404 → `MODEL_UNAVAILABLE` mapping is only as specific as the status code. A provider that
   returns 404 for a **route** (not a model) would be labelled the same way; the broker only accepts
   known upstream paths, which bounds that risk.
