# LÉLU DEVICE BRIDGE — ARCHITECTURE

Deliverable B. A standalone, independently deployable service. It shares **no code, database or frontend**
with LÉLU V1.1. Integration happens only through the versioned API in §8 plus a LÉLU-owned adapter.

Repository: `LÉLU-Device-Bridge` (local path `/workspace/lelu-device-bridge`, own `git init`, own lockfile).
Creating the GitHub remote is an owner action.

## 1. Purpose and honest scope

The bridge lets an **authorized device** (phone, tablet, desktop browser, future native companion) expose a
**declared, permissioned** set of capabilities to an **operator** (LÉLU, running elsewhere), with the device
owner holding final authority.

It does not grant unrestricted device control. Specifically:

| Platform | What the bridge can honestly offer | What it cannot |
|---|---|---|
| Desktop browser (Chrome/Edge/Firefox) | mic, camera, tab screen share (`getDisplayMedia`), clipboard (permission), file pick (explicit), notifications, network info, full-duplex media | OS-level control, other apps' screens |
| iPhone/iPad Safari or installed PWA | mic, camera, clipboard (user gesture), share sheet, files via picker, notifications (installed PWA + push backend), background limited | screen capture, background execution, App Intents, cross-app control |
| Android Chrome | mic, camera, `getDisplayMedia` (Android 10+), clipboard, files, notifications | AccessibilityService is **not** used; no silent control |
| Native iOS companion (future) | ReplayKit broadcast (user-initiated, extension-based), mic/camera, App Intents | headless capture, driving other apps |
| Native Android companion (future) | foreground-service capture, media, intents | silent background capture |

Any row that is not available on a device is reported with the contract's status
(`unsupported` / `native-required` / `permission-required`), never as a success.

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 22+ (LTS), TypeScript, ESM | same runtime family as LÉLU's server, no second language |
| HTTP | `hono` + `@hono/node-server` | tiny, typed, portable to edge later |
| Realtime | `ws` (server), native `WebSocket` (client) | no framework lock-in; events are small JSON frames |
| Storage | `node:sqlite` (built-in) behind a repository layer | zero native build, zero external DB; Postgres adapter later if needed |
| Validation | `zod` | every body, every capability manifest |
| QR | `qrcode` | local rendering, no third-party service |
| Media | LiveKit server (self-hosted, optional) + `livekit-client` in the web app | Apache-2.0; absent ⇒ media capabilities `unsupported` |
| Tests | `node:test` (unit/integration) + Playwright (two-context e2e) | one driver, already familiar |

No ORM, no auth SaaS, no cloud dependency required to run.

## 3. Components

```
┌──────────────────────────── bridge service ────────────────────────────┐
│ HTTP /v1  (hono)                                                       │
│  ├── /pairing      PairingService      codes, QR payloads, TTL         │
│  ├── /devices      DeviceRegistry      identity, platform, trust       │
│  ├── /sessions     SessionManager      lifecycle, scopes, presence     │
│  ├── /capabilities CapabilityRegistry  manifests + negotiation         │
│  ├── /actions      ActionBroker        risk, approval, execute, audit  │
│  ├── /media        MediaGateway        LiveKit token minting (opt-in)  │
│  ├── /events       EventHub (WS)       device + operator streams       │
│  └── /audit        AuditLog            append-only, queryable          │
│ Web app (static)   device page · operator console · pairing page       │
└────────────────────────────────────────────────────────────────────────┘
        ▲ device token (device→bridge)      ▲ operator token (LÉLU→bridge)
```

| Component | Contract |
|---|---|
| `PairingService` | Creates a pairing attempt (`id`, `code` 6 digits, `qrPayload`, `expiresAt` 120 s, `mode: guest|trusted`). A device claims it with its public key + manifest. The **owner** approves on the device page; the **operator** sees a pending request and must also approve before a session opens. Attempts are single-use. |
| `DeviceRegistry` | Persists device identity (Ed25519 public key), category, os, platform version, app kind, trust level (`guest|trusted`), labels, last seen, revoked flag. Guest records expire. |
| `SessionManager` | Opens/closes sessions: `pending → active → suspended → ended|revoked`. Holds scopes, granted capabilities, TTL, heartbeat, and the current media room. Ending a session revokes its tokens immediately. |
| `CapabilityRegistry` | Stores the manifest a device declared, validates it against the schema, reconciles with what the device reports live, and computes the effective set (declared ∩ granted ∩ currently available). |
| `ActionBroker` | The only path to any device action. Validates operator, session, capability, scope, risk; requests approval when required; enforces idempotency keys; applies timeouts; records request/decision/result; supports cancel and revocation mid-flight. |
| `MediaGateway` | Mints short-TTL LiveKit tokens scoped to one room per session, with publish/subscribe grants derived from the granted capabilities. Never enables capture by itself. |
| `EventHub` | One WS stream per participant. Device events (state, permission changes, action results) and operator events (action requests, approvals, revocations) are separate channels; a device never receives another device's events. |
| `AuditLog` | Append-only rows for pairing, session, permission, action, approval, revocation, media. Reading is scoped to the owning device/operator. |

## 4. Data model (SQLite, migration `001_init.sql`)

```sql
devices(id TEXT PK, public_key TEXT NOT NULL, category TEXT, os TEXT, platform_version TEXT,
        app_kind TEXT, trust TEXT, label TEXT, created_at INT, last_seen_at INT,
        revoked_at INT NULL, expires_at INT NULL)

pairing_attempts(id TEXT PK, code TEXT UNIQUE, mode TEXT, created_by TEXT,
                 operator_id TEXT, expires_at INT, claimed_at INT NULL,
                 device_id TEXT NULL, owner_approved_at INT NULL, operator_approved_at INT NULL,
                 consumed_at INT NULL)

sessions(id TEXT PK, device_id TEXT, operator_id TEXT, state TEXT, scopes TEXT,
         created_at INT, expires_at INT, ended_at INT NULL, end_reason TEXT,
         media_room TEXT NULL)

grants(session_id TEXT, capability_id TEXT, state TEXT, granted_at INT, revoked_at INT NULL,
       PRIMARY KEY(session_id, capability_id))

actions(id TEXT PK, session_id TEXT, capability_id TEXT, risk TEXT, params TEXT,
        state TEXT, idempotency_key TEXT UNIQUE, requested_at INT, decided_at INT NULL,
        executed_at INT NULL, result TEXT NULL, error_code TEXT NULL)

audit(id INTEGER PK AUTOINCREMENT, at INT, actor TEXT, actor_kind TEXT, session_id TEXT NULL,
      device_id TEXT NULL, event TEXT, detail TEXT)
```

Rules enforced in code as well as schema: a session is only usable while `state='active'` and
`now < expires_at`; a grant is only usable while `revoked_at IS NULL`; guest devices have `expires_at` and
cannot be promoted to trusted without a fresh owner-approved pairing.

## 5. Capability contract

```jsonc
{
  "schemaVersion": 1,
  "device": { "id": "dev_…", "category": "phone|tablet|desktop|tv|unknown",
              "os": "ios|android|windows|macos|linux|other", "platformVersion": "26.5",
              "app": { "kind": "browser|pwa|native", "name": "Safari", "version": "26" } },
  "capabilities": [
    { "id": "microphone.capture", "transport": "webrtc|local",
      "state": "available|permission-required|denied|unsupported|temporarily-unavailable|native-required|user-interaction-required",
      "reason": "user has not granted this yet",
      "constraints": { "requiresGesture": true, "maxDurationSec": 600 },
      "risk": "high" }
  ],
  "media": { "audio": ["opus"], "video": ["vp8","h264"], "screen": false },
  "limits": { "background": "none|limited|foreground-service", "batterySaver": true }
}
```

Capability ids (`v1`): `device.info`, `network.state`, `microphone.capture`, `camera.capture`,
`screen.share`, `audio.playback`, `clipboard.read`, `clipboard.write`, `files.pick`, `files.send`,
`notifications.show`, `haptics.vibrate`, `location.current`, `app.intents`, `lifecycle.state`.
Each has a fixed risk class in `capabilities/catalog.ts` — a device cannot lower its own risk class.

## 6. Action protocol

```
operator → POST /v1/actions { sessionId, capabilityId, params, risk? , idempotencyKey }
bridge   → risk check (catalog, not the caller's claim)
         → if approval required: state=awaiting_owner, push approval to device page + operator console
device   → POST /v1/actions/:id/decision { approve: true }  (owner gesture)
bridge   → validate grant, dispatch to device over WS: { type:"action.execute", id, capabilityId, params }
device   → executes with the platform API it owns → POST /v1/actions/:id/result { ok, data|error }
bridge   → audit + return to operator
```

- Cancellation: `POST /v1/actions/:id/cancel` → `cancelled` if not yet executed; the device also honours a
  `cancel` frame mid-flight for long operations (e.g. screen share).
- Revocation mid-action: ending the session fails in-flight actions with `session_ended` and closes media.
- Errors are enumerated codes (`capability_denied`, `permission_missing`, `unsupported_on_platform`,
  `approval_required`, `approval_denied`, `session_ended`, `device_offline`, `timeout`, `invalid_params`),
  never a bare 500.

## 7. Media

Optional, and off unless configured:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (server-side only).
- Token per session: `room = session.id`, identity = device or operator, TTL ≤ session TTL,
  `canPublish`/`canSubscribe` derived from granted capabilities (e.g. `microphone.capture` grants publish
  audio; `audio.playback` grants subscribe).
- The gateway never starts capture. The device page asks for the platform permission at the moment of use,
  and the UI shows a persistent "live" indicator with a stop control.
- Self-hosted LiveKit needs UDP reachability + TURN for real networks; the bridge documents this and reports
  media `unsupported` when the server is unreachable. LiveKit Cloud is optional and paid — not required.

## 8. API v1 (versioned, documented in the repo's `API.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/pairing/attempts` | operator | start pairing (mode, ttl) → `{ code, qrPayload, expiresAt }` |
| POST | `/v1/pairing/attempts/:id/claim` | device (public key) | device claims with key + manifest |
| POST | `/v1/pairing/attempts/:id/owner-approve` | device owner | owner approves requested capabilities |
| POST | `/v1/pairing/attempts/:id/operator-approve` | operator | operator accepts the device |
| GET | `/v1/devices` | operator | list devices with trust + last seen |
| GET | `/v1/devices/:id` | operator | detail + manifest |
| DELETE | `/v1/devices/:id` | owner or operator | revoke trust |
| POST | `/v1/sessions` | operator | open session `{ deviceId, capabilities[] }` |
| GET | `/v1/sessions/:id` | both | state, grants, media room |
| DELETE | `/v1/sessions/:id` | both | end/revoke |
| GET | `/v1/capabilities/:deviceId` | operator | effective capability manifest |
| POST | `/v1/actions` | operator | request an action |
| POST | `/v1/actions/:id/decision` | owner | approve/deny |
| GET | `/v1/actions/:id` | both | state + result |
| POST | `/v1/actions/:id/cancel` | both | cancel |
| POST | `/v1/media/session` | operator | mint scoped LiveKit token |
| GET | `/v1/events` (WS) | both | realtime channel |
| GET | `/v1/audit` | both (scoped) | audit rows |
| GET | `/healthz`, `/readyz` | none | liveness/readiness + configured features |

Auth: `Authorization: Bearer <token>`; operator tokens are long-lived API keys (hashed at rest, revocable),
device tokens are session-scoped and short-lived. Guest devices never receive operator-scoped tokens.

## 9. Web app

Three pages, all static, served by the bridge:

1. `/pair` — pairing page: shows the code, or opens from a QR link, requests the declared capabilities,
   shows exactly what will be shared, and requires an explicit owner gesture per high-risk capability.
2. `/device` — active device console: live session banner, capability toggles, approval prompts,
   "stop sharing" always visible, one-tap disconnect.
3. `/operator` — thin console for debugging and demo (device list, sessions, action log). LÉLU's own UI is
   **not** this page.

## 10. Independent operability (acceptance-critical)

The bridge must start, pair, discover capabilities, execute a low-risk action, revoke, and pass its tests with
LÉLU **not installed and not running**. Its test suite imports nothing from LÉLU; its `.env.example` has no
LÉLU variables. LÉLU integration is a separate, optional adapter in the other repository.

## 11. Deployment

```yaml
# docker-compose.yml (bridge repo)
services:
  bridge:      # node:22-alpine, ./Dockerfile, 8080/tcp, ./data volume
  livekit:     # optional profile "media", livekit/livekit-server pinned tag,
               # 7880/tcp + 7881/tcp + 50000-50100/udp
  turn:        # optional profile "media", coturn with static-auth-secret
```

Env (`.env.example`, placeholders only): `PORT`, `PUBLIC_URL`, `DATABASE_PATH`, `OPERATOR_API_KEY_HASH`,
`SESSION_TTL_SECONDS`, `PAIRING_TTL_SECONDS`, `ALLOW_GUEST=true`, `LIVEKIT_URL` (optional),
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LOG_LEVEL`, `TRUST_PROXY`.

Startup validates configuration and exits with a clear message naming the missing variable. Cost: bridge is
free to self-host (one small VM/container); LiveKit+turn free to self-host, requires a public IP and UDP
range; managed alternatives are optional and documented with prices, not assumed.

## 12. Testing

- **Unit:** pairing TTL/one-shot, capability manifest validation (rejects unknown ids, unlowerable risk),
  risk classification, scope checks, grant expiry, audit writes.
- **Integration:** full pairing with two token holders, session open/close, action approval + execution
  against a stub device, revocation invalidating the next action, guest isolation (guest token cannot read
  operator endpoints or other devices), idempotency, timeout and cancel.
- **E2E (Playwright, two browser contexts):** one context is the operator, one is the device; QR/code pairing,
  owner approval, capability discovery, one low-risk action, disconnect, post-revocation rejection.
  If the environment cannot launch a browser (this VM currently cannot — no root for system libs), the run is
  reported as **blocked**, with the exact error, not as passing.
- **Platform honesty:** each capability result records the platform and browser user agent that produced it,
  so a "works" claim is traceable to a real environment.

## 13. Known limits (stated up front)

1. iOS web pages cannot capture the screen; ReplayKit requires a native app and user-initiated broadcast.
2. Background execution is not possible from a browser; a session ends when the page is closed/suspended.
3. Clipboard and camera require a user gesture on most browsers; the bridge cannot pre-authorize them.
4. LiveKit needs network reachability; without it, media is `unsupported`.
5. Native companions are architecture only in this project — no Xcode/macOS, no signed builds.
6. No `AccessibilityService`, no hidden capture, no remote control of other apps.
