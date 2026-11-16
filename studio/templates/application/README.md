# Pulse Board

A task board whose every number comes from a real HTTP backend. Create a
task, move it through **todo → doing → done**, watch the completion figure
change, delete it. The backend stores tasks on disk.

## Run

```bash
node server.mjs           # http://127.0.0.1:5300 (PORT overrides)
node scripts/build.mjs    # checks the backend imports, writes dist/
node --test tests/        # 9 tests against the live HTTP server
```

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/tasks[?lane=]` | list / filter |
| POST | `/api/tasks` | create (`title`, `lane`) |
| PATCH | `/api/tasks/:id` | move or rename |
| DELETE | `/api/tasks/:id` | delete one |
| DELETE | `/api/tasks` | clear the board |
| GET | `/api/stats` | totals and completion |

## Structure

- `server.mjs` — Node HTTP server, JSON-file store, validation, static files, exported for tests.
- `src/app.js` — the UI; refreshes from the API after every mutation.
- `tests/api.test.mjs` — starts the real server on an ephemeral port.

## Limitations

- Single-user by design: no accounts and no per-user isolation.
- Persistence is a JSON file, not a database; it is correct for one process, not concurrent writers.
- No authentication. Adding it is an auth/security change and needs the owner's approval.
