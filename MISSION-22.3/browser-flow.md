# Browser acceptance — reproduction

Everything here ran against the real app, not a mock. The only thing switched off is the 3D presentation layer, through a development-only URL flag.

## 1. Start the app

```bash
npm install          # the restored workspace had no node_modules
npx vite --host 0.0.0.0 --strictPort --port 3001
```

The dev server reads provider keys from `.env.local` through the app's own model broker (`/api/model/...`); no key enters the page.

## 2. Open the acceptance configuration

```
http://127.0.0.1:3001/?scene=off
```

`?scene=off` is honoured only when `IS_DEV` is true (`src/app/scene/genesis/sceneTestMode.ts`); a production build inlines it to `false` and a unit test asserts that. With it, `GenesisWorkspaceRouter` renders no scene — the same branch the app already takes when chat owns a phone screen — while `GenesisInterface`, `GenesisChat`, `GenesisCore`, the memory bridge and the provider path stay mounted and real.

Expected: `document.querySelectorAll('canvas').length === 0`, the sign-in gate is shown, and "Continue without an account" enters the app.

## 3. Drive the two conversations

1. Continue without an account.
2. Open **Chat**. The Chat Universe lists existing conversations; open or create one.
3. In conversation A send the private note. Wait for the reply.
4. Use **New chat** for conversation B and send the unrelated engineering question. Wait for the reply.
5. With both windows open, ask A about its own commission.
6. Reload the page and repeat step 5 for A and a follow-up for B.

## 4. Capture the actual payload

The browser talks to the provider through the same-origin broker, so the request body is observable in the page. Before sending, wrap `window.fetch` and keep the bodies:

```js
window.__payloadCaptures = [];
const original = window.fetch;
window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input.url;
  const body = init && typeof init.body === 'string' ? init.body : null;
  const record = { url, body, status: null };
  if (body) window.__payloadCaptures.push(record);
  const response = await original.apply(this, arguments);
  record.status = response.status;
  return response;
};
```

Then read only what the assertion needs, never the whole body into a commit:

```js
window.__payloadCaptures.map((c) => ({
  url: c.url,
  status: c.status,
  len: c.body.length,
  sensitive: /BLUE-HERON/i.test(c.body),
  grief: /grief|father died/i.test(c.body),
}));
```

## 5. What was observed

| Step | Result |
| --- | --- |
| canvases with `?scene=off` | 0 |
| A first turn | 29,417-char request, contains the private note |
| B first turn | 4,032-char request, contains none of it |
| B follow-up | 3,979-char request, contains none of it |
| reload | both conversations restored, transcripts intact |
| A after reload | 25,090-char request, still contains its own memory |
| B after reload | unchanged isolation |

## 6. Not covered by this script

Deletion through the Memory panel, project creation across conversations, touch gestures, and anything native (iOS/Android). See `deletion-supersession.json`, `workspace-project-boundaries.json` and `mobile-boundary.json` — all three state the gap rather than filling it with an inference.
