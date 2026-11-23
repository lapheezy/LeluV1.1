# MISSION 22.1 — acceptance and reproduction

Branch: `freebuff/m22-1-memory-sovereignty-hardening`
Predecessor: M22 (`2c3d149`, hash record `a605a46`, base `aa8b1bd`)

Everything below is runnable from the repository root. Level of each check is
stated: `unit`, `pipeline`, `provider`, `browser`, `device`.

## 1. Install

```bash
bun install --frozen-lockfile     # or: npm ci
```

## 2. The mission test file (18 tests, no network)

```bash
npx tsx --tsconfig tsconfig.test.json \
  --import ./tests/support/ignore-css.mjs \
  --test tests/memory-hardening.test.ts
```

Groups: **H** project registry · **I** agent scope · **J** legacy adapter ·
**K** cognitive state + deletion · **L** cross-user & concurrency.

## 3. The M22 suite must stay green (28 tests)

```bash
npx tsx --tsconfig tsconfig.test.json \
  --import ./tests/support/ignore-css.mjs \
  --test tests/memory-sovereignty.test.ts
```

The original grief-versus-technical-question test is in group A and remains
permanently in the regression set.

## 4. Two-user execution with provider payloads (`provider`, synthetic users)

```bash
npx tsx scripts/memory-hardening-live.ts            # calls Groq + OpenRouter
npx tsx scripts/memory-hardening-live.ts --offline  # scoping only, no network
```

Writes `MISSION-22.1/cross-user-validation.json` and
`MISSION-22.1/provider-validation.json`. Each turn records whether the
**provider payload** contained user A's grief, fact or project.

Fixtures only. No real account, email or personal data is used.

## 5. Performance (against the M22 baseline)

```bash
npx tsx scripts/memory-hardening-bench.ts
```

Writes `MISSION-22.1/performance-report.json`.

## 6. Full regression

```bash
npm test
```

## 7. Browser (`browser`) — the honest version

1. `npx vite --host 0.0.0.0 --port 3001`
2. Open the preview host, summon the chat.
3. Send: *"My studio project is called Aurelia — a jewellery brand with a rose
   gold signature."*
4. Reload. Open a **different** conversation and ask: *"What's the status of
   the Aurelia project?"* — the reply must state where the project came from.
5. In a new conversation ask *"Can you fix it?"* — no loss may appear.

Steps 1–3 were executed this session (see `browser-validation.json`). Step 4
could not be completed because the free provider quota was exhausted and the
3D scene saturates Cloud-browser automation after ~2 minutes. The same
behaviour is verified at pipeline and provider level.

## 8. Mobile (`device`) — NOT RUN

No device, emulator or native project (`android/`, `ios/`) exists here.
`mobile-validation.json` lists the exact tests still outstanding. It does not
claim a pass.

## 9. What each level means

| level | means |
|---|---|
| unit | the real store/engine/boundary, no model |
| pipeline | `AIService.chat` / `MemoryBridge.enrich` → provider request |
| provider | a real model answered, and the payload was captured |
| browser | a person could see it in the UI |
| device | a physical phone |
