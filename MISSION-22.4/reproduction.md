# M22.4 — reproduction

Everything below ran against the real application. The only thing switched off is the 3D presentation layer, through the development-only `?scene=off` flag.

## 1. Install and start

```bash
npm install            # `npm ci` fails on this repo: package.json and package-lock.json disagree on livekit deps
git checkout -- package-lock.json   # install must not rewrite the lockfile
LELU_ALLOWED_HOSTS=<preview host> npx vite --host 0.0.0.0 --strictPort --port 3001
```

The dev server reads provider keys from `.env.local` inside the same-origin `/api/model` broker; no key reaches the page.

## 2. Open the acceptance configuration

```
https://<preview host>/?scene=off
```

`?scene=off` is honoured only when `IS_DEV` is true (`src/app/scene/genesis/sceneTestMode.ts`); a production build inlines it to `false`. `document.querySelectorAll('canvas').length === 0` confirms the scene is off. Choose **Continue without an account** at the gate.

## 3. Capture the real provider payload

Before sending, run this in the page:

```js
window.__payloadCaptures = [];
const original = window.fetch;
window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const body = init && typeof init.body === 'string' ? init.body : null;
  const record = { url, body, status: null };
  if (body) window.__payloadCaptures.push(record);
  const response = await original.apply(this, arguments);
  record.status = response.status;
  return response;
};
```

Then read only what an assertion needs, and classify **where** the phrase occurs:

```js
window.__payloadCaptures
  .filter((c) => c.url.includes('/api/model/'))
  .map((c) => {
    const parsed = JSON.parse(c.body);
    const context = parsed.context ?? '';
    const history = JSON.stringify(parsed.messages ?? []) + JSON.stringify(parsed.prompt ?? '');
    return {
      status: c.status,
      chars: c.body.length,
      inMemoryContext: /COPPER-LANTERN-77/.test(context),
      inHistory: /COPPER-LANTERN-77/.test(history),
    };
  });
```

The split matters: a phrase in the conversation's own history is the user's transcript; a phrase in the assembled context is memory-derived. Deleting a memory does not rewrite the transcript.

## 4. Create the memory

1. **Chat** → **New Chat**.
2. Send: `Please remember this: my workshop access phrase is COPPER-LANTERN-77.` (second run: `Please remember this: the spare key is under SILVER-KETTLE-42.`).
3. Wait for the reply. It is learned as a durable memory.

## 5. Open the Memory panel

The panel is a Genesis module. It opened reliably through the command palette: click **Command Palette** (or `⌘K` / `Ctrl+K`), type `memory`, choose **Open memory**. The App Library card and the Chat Universe sidebar entry did not raise the module in this build.

Type the distinctive token into **Search memories…** (e.g. `COPPER` / `SILVER`) to isolate the row. Screenshot `screenshots/01-…` and `03-…` were taken at this point.

## 6. Delete through the interface

1. Click **Delete** on that row.
2. The row asks **“Delete this memory?”** — click **Confirm delete**.
3. Expected: a green notice “Memory deleted. It is removed from the store and will not be recalled again.” and, with the search still applied, “No memories match this search.” (`screenshots/02-…`, `04-…`).

## 7. Prove the next request no longer carries it

Create another **New Chat** (fresh history) and ask `Where is the spare key?`. The captured request must contain zero occurrences of the phrase. In the first run (before the fix) it contained one, from a project checkpoint — see `browser-deletion.json`.

## 8. Reload

Reload the page, let it restore (the app restores the last windows), open a **New Chat**, and ask again. Expected: zero occurrences, the activity card reads “Checked memory — nothing related”, and the earlier conversation is offered (“Would you like me to pull in …?”) rather than used. `screenshots/05-post-reload-no-recall.png`.

## 9. Not covered

- Native iOS/Android: no device or emulator in this environment; only the web build was exercised.
- OpenRouter completion: the endpoint was reached and answered 429 (free daily limit); no successful OpenRouter turn is claimed.
- The pre-fix COPPER-LANTERN checkpoint written by the earlier build is still on disk until a deletion purges it; the fix stops new ones and purges on deletion.
