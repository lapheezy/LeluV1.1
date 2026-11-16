# SECURITY AND PERMISSION MODEL

Applies to both deliverables. The LÉLU-side sections describe how the upgrade is constrained inside the
existing app; the bridge-side sections define the service's own guarantees.

## 1. Actors, assets, boundaries

| Actor | Can do | Cannot do |
|---|---|---|
| **Device owner** | approve/deny every capability and high-risk action on their device; revoke trust; see active sessions; stop media | see LÉLU's memory, conversations, credentials or other devices |
| **LÉLU operator** (the account running LÉLU) | discover paired devices, read manifests, request actions, open sessions | act on a device without owner approval; read device files that were not explicitly selected; capture without a granted capability |
| **Device agent** (browser page / future companion) | report capabilities, execute only granted actions, stream only granted media | self-grant, elevate risk class, call operator endpoints, see other devices |
| **Anonymous visitor** | view the pairing page | claim a pairing attempt without owner approval; enumerate devices |

Assets: device media, device files, owner identity, operator API keys, session tokens, audit trail, and LÉLU's
own memory/credentials (never exposed to the bridge).

Trust boundaries: (1) browser page ↔ bridge over TLS; (2) bridge ↔ operator over TLS + bearer tokens;
(3) bridge ↔ LiveKit via short-TTL scoped tokens; (4) LÉLU adapter ↔ bridge, env-gated and off by default.

## 2. Owner ≠ operator (the core rule)

- Sessions carry **two** approvals: owner (on the device) and operator (in LÉLU or the operator console).
  Neither alone opens a session.
- Guest devices get an **isolated guest session**: they receive only their own grants and media room. They
  never receive the operator's LÉLU credentials, memory, conversations, saved auth sessions, or any other
  device's data. There is no shared cookie jar, no shared storage and no token reuse across devices.
- A guest device's data is scoped by `device_id` + `session_id` in every query; no endpoint accepts a
  client-supplied owner identity.
- Revocation is unilateral and immediate: the owner can end the session from the device page, the operator
  can end it from LÉLU, and either action invalidates tokens on the next request (and pushes a WS `revoked`
  frame so an idle device drops its capture immediately).

## 3. Threat model (abridged STRIDE)

| # | Threat | Mitigation | Verified by |
|---|---|---|---|
| T1 | Attacker guesses a short pairing code | 6-digit code, 120 s TTL, one-shot, rate-limited, plus owner approval on the device; QR path carries a 256-bit secret | integration test: N wrong attempts then lockout |
| T2 | Malicious site silently pairs a device | pairing requires an explicit owner gesture in the device page; capabilities shown before approval | e2e test asserting approval is required |
| T3 | Device self-reports capabilities it does not have | effective set = declared ∩ granted ∩ live-reported; every action result is audited with platform + UA | integration test with a lying stub device |
| T4 | Device self-lowers risk to skip approval | risk class comes from the server catalog keyed by capability id | unit test: manifest cannot override risk |
| T5 | Operator acts without owner consent | `awaiting_owner` state; execution frame only after owner decision | integration test |
| T6 | Stolen operator key drains devices | key hashed at rest, revocable, per-key audit; optional IP allowlist; sessions still need owner approval for high-risk | unit + manual runbook |
| T7 | Stolen device token used elsewhere | token bound to device key + session, short TTL, single session, revoked on session end | integration test |
| T8 | Cross-device data leak via events | EventHub channels keyed by participant; no broadcast topic spans devices | integration test: device A never receives B's frames |
| T9 | Replay of an approval or action | idempotency keys, single-use approvals, monotonic action state machine | integration test: duplicate request returns the first result |
| T10 | Media capture without consent | capture only in the device page, only after platform permission, persistent live indicator, stop control, no server-side capture | e2e (blocked here — see §8) |
| T11 | Revoked permission still works | grants checked on every action **and** every media token mint; revocation closes the room | integration test: revoke then act → `capability_denied` |
| T12 | Prompt injection from a web page commands LÉLU to control a device | bridge actions are typed and catalogued (no free-form shell); LÉLU's `ToolResolver` requires an explicit device intent; high-risk actions need owner approval; `PromptInjectionGuard` stays in the request path | unit test on adapter refusal |
| T13 | LÉLU adapter leaks secrets | adapter reads only `VITE_DEVICE_BRIDGE_URL` (public URL) + a server-side operator key; no key in the browser bundle | `verify-live-runtime` secret scan in CI |
| T14 | Malicious device floods the bridge | per-device rate limits, action timeouts, session caps, payload size limits | integration test |

## 4. Permission matrix

Risk is assigned by the **server catalog**, per capability, not by the device.

| Capability | Risk | Default | Owner approval | Operator scope | Notes |
|---|---|---|---|---|---|
| `device.info` | low | granted on pair | no | read | category, os, version only |
| `network.state` | low | granted on pair | no | read | online/type, no SSIDs |
| `lifecycle.state` | low | granted on pair | no | read | foreground/background |
| `notifications.show` | low | granted on pair | no | write | text only |
| `haptics.vibrate` | low | granted on pair | no | write | where supported |
| `audio.playback` | moderate | ask | first time | media | plays TTS on the device |
| `clipboard.write` | moderate | ask | per session | write | never reads existing clipboard |
| `clipboard.read` | high | denied | per action | read | requires gesture on most browsers |
| `files.pick` | moderate | ask | per action | read | owner picks the file; no directory access |
| `files.send` | moderate | ask | per action | write | explicit destination |
| `microphone.capture` | high | denied | per session + live indicator | media | platform permission also required |
| `camera.capture` | high | denied | per session | media | platform permission also required |
| `screen.share` | high | denied | per session + explicit picker | media | unsupported on iOS web |
| `location.current` | high | denied | per action | read | only when explicitly needed |
| `app.intents` | high | denied | per action | write | native companions only |
| Form submission, sending messages, purchases, destructive actions (LÉLU browser tool) | high | — | explicit approval each time | — | existing `AuthorizationQueue` classification |

Rules: high-risk capabilities are **denied by default** and require a fresh approval per session; guest
sessions may never receive `screen.share`, `camera.capture` or `files.send` without an explicit per-action
owner gesture; the operator cannot widen its own scope.

## 5. Session lifecycle

```
pairing attempt ──device claim──▶ pending_owner
        │                            │ owner approve
        │                            ▼
        │                       pending_operator ──operator approve──▶ active
        │                                                        │  │
        │                       suspend (network loss) ◀─────────┘  │
        │                            └── resume (same session, new token) ──▶ active
        │                                                        │
        └────────────── expiry / deny ──▶ failed                  ├─▶ ended  (normal close)
                                                                  └─▶ revoked (owner/operator/incident)
```

- TTLs: pairing 120 s, guest device record 24 h, session default 30 min (configurable, max 8 h), media token
  ≤ session TTL, device token ≤ session TTL.
- Heartbeats every 15 s; 3 missed → `suspend`; 2 min suspended → `ended`.
- Every transition writes an audit row and pushes an event to both participants.
- Ending a session: revokes grants, closes the media room, fails in-flight actions with `session_ended`,
  invalidates tokens, and leaves a durable audit trail.

## 6. Tokens

| Token | Holder | Lifetime | Storage | Revocation |
|---|---|---|---|---|
| Pairing code | display only | 120 s | hash in DB | consumed/locked after N failures |
| Operator API key | LÉLU server / operator console | until rotated | hash in bridge DB; value only in the operator's secret store | DELETE key; per-key audit |
| Device session token | device page | session TTL | memory only (never localStorage) | session end/revoke |
| Media token | bridge → LiveKit | ≤ session TTL | memory | room close |
| WS ticket | device/operator | 30 s, single-use | memory | n/a |

No secret is ever written into a URL query string, a log line, a screenshot, or a device manifest. LÉLU-side
`VITE_` variables may hold only the bridge's public URL.

## 7. Audit log and incident response

Audit rows: `at, actor, actor_kind, session_id, device_id, event, detail(JSON)`. Events: `pairing.created`,
`pairing.claimed`, `pairing.owner_approved`, `pairing.denied`, `session.opened`, `session.suspended`,
`session.ended`, `session.revoked`, `grant.granted`, `grant.revoked`, `action.requested`,
`action.approved`, `action.denied`, `action.executed`, `action.failed`, `action.cancelled`, `media.opened`,
`media.closed`, `device.revoked`.

Retention: 90 days default (configurable); no media content is ever stored, only metadata.

Revocation runbook:
1. Owner taps **Disconnect** (or operator ends session) → tokens dead, room closed, in-flight actions fail.
2. If a device is compromised: `DELETE /v1/devices/:id` → trust revoked, all sessions ended, key recorded as
   revoked so a re-pair is a fresh, owner-approved event.
3. If an operator key leaks: rotate in the operator secret store, delete the old key row, review audit rows
   for that key between suspected leak and rotation.
4. If a bridge secret leaks (`LIVEKIT_API_SECRET`): rotate, restart, re-mint tokens; old tokens become
   invalid on expiry.
5. Post-incident: export the audit slice, list affected sessions/devices, and record the cause in the repo's
   `SECURITY.md` changelog.

## 8. Environment limits that affect security claims (measured in this workspace)

- **No root**: `sudo` is disabled by the container's `no_new_privileges` flag, so Playwright's Chromium cannot
  load `libnspr4.so`. Browser-executed security tests (T2, T10) **cannot run in this VM** and will be reported
  as blocked, with the exact error, unless run in CI (which installs browsers with `--with-deps`).
- **No physical second device**: device-side claims are validated in two independent browser contexts and
  labelled *simulated*; real iPhone/Android acceptance requires the owner's hardware.
- **No LiveKit host**: media tests are limited to token-minting and refusal paths until a server exists.

## 9. What this project will not build

- Hidden or covert capture of any kind; no recording without a visible indicator and a stop control.
- Remote control of a device's other applications.
- `AccessibilityService` automation on Android.
- Bypassing platform permission prompts, CAPTCHAs, authentication or DRM.
- A path where LÉLU's operator privileges imply authority over a device owner's content.
