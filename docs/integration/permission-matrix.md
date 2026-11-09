# Permission matrix

Two questions, two components, both required:

- **Relationship (OpenFGA shape)** — is this subject related to this resource, and
  for how long? `src/core/security/authz/RelationshipStore.ts`
- **Policy (OPA)** — given that, may *this action* happen? `policies/lelu/authorization.rego`
  and its browser mirror `src/core/security/policy.ts`.

## Actions by subject kind

`✓` allowed by policy · `A` allowed only with a live human approval · `✗` refused

| Action | Min autonomy | Risk | user (owner) | user (non-owner) | agent | service | device |
|---|---|---|---|---|---|---|---|
| `READ` | 0 Observe | low | ✓ | ✓ | ✓ | ✓ | ✓ |
| `WRITE` | 2 Sandbox | medium | ✓ | ✗ (cross-user) | ✓ | ✓ | ✗ |
| `EXECUTE` | 3 Execute | high | ✓ | ✓ | ✓ | ✓ | ✗ |
| `ACCESS_EXTERNAL_DEVICE` | 3 | high | ✓ + relationship | ✗ | ✓ + relationship | ✓ + relationship | ✓ + relationship |
| `INSTALL` | 4 Project | critical | A | A | A | A | ✗ |
| `DELETE` | 4 Project | critical | A | ✗ (cross-user) | A | A | ✗ |
| `DEPLOY` | 5 Production | critical | A | ✗ | ✗ | A | ✗ |
| `ADMINISTER` | 5 Production | critical | A | ✗ | ✗ | A | ✗ |

Extra rules that override the table:

1. **Self-elevation is refused first.** `agent_self_elevation = true` ⇒ deny,
   whatever else is true. An agent cannot grant itself anything.
2. **Production requires autonomy 5** regardless of the action.
3. **`ACCESS_EXTERNAL_DEVICE` requires a live relationship**; an autonomy level is
   not a permission to touch a device.
4. **The eight actions are the whole vocabulary.** An unknown action is a
   validation failure, not an implicit allow.

## Where each decision is enforced

| Surface | Enforced by | Reachable by an agent? |
|---|---|---|
| Adapter calls | `AdapterRegistry.execute` | yes — and refused there |
| Real project write | `EngineeringAuthorization.authorize` (human action only) | **no** |
| Tool execution | `ToolDispatcher.toolPermitted` + `ApprovalGate` | yes, gated |
| Sandbox command | existing engineering runtime whitelist | yes, whitelisted only |
| Security scan target | `scopedTarget` (workspace-bounded) | via API only |
| Device/session grant | `RelationshipStore.grantDeviceSession` | **no** — no tool exposes it |

## Time and revocation

- A device session grant carries an expiry and is pruned on read
  (`expiresAt`, `prune`).
- `revokeSession(sessionId)` removes every tuple the session held; the next call
  fails immediately (tested).
- A policy approval is consumed once (`ApprovalGate.consume`), tied to the exact
  tool and argument hash the human saw.

## Verified

- `tests/policy-authorization.test.ts` — 12 cases naming the rule that fires.
- `tests/authz-relationships.test.ts` — 7 cases including expiry and revocation.
- `tests/security-integrations.test.ts` — the same 15-input matrix through **real
  OPA** and the reference; 10/10 agreement on the evidence set, engine labelled.

## Honest gaps

- In-process tuples are not shared between server instances; an OpenFGA server
  would be needed for that (adapter present, `not_configured`).
- No UI exists yet to mint or revoke a device session — the API and store do, the
  Security Centre screen does not. See `known-limitations.md`.
