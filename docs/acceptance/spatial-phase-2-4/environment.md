# Reproducible browser environment (no sudo)

The Cloud preview panel is fixed at 328×528 and `preview_playwright` fails on every call
with `The property 'options.mode' must be one of: 'strip'. Received 'transform'`, so
browser acceptance runs a locally launched Chromium. That Chromium needs shared
libraries the image does not ship, and `sudo` is blocked by the `no new privileges` flag.

## What the script does

`scripts/setup-browser-env.sh`:

1. writes a sandboxed apt configuration under `/tmp/aptroot` (own `sourcelist`, `state`,
   `cache`, `Debug::NoLocking=1`) — it never touches the system package database;
2. downloads the dependency closure with `apt-get -d install` into
   `/tmp/aptroot/cache/archives` (needs `archives/partial` to exist);
3. unpacks every `.deb` with `dpkg-deb -x` into `/tmp/sysroot`;
4. reports the number of missing shared libraries for the Chromium binary (expected 0).

Nothing is installed system-wide, no `sudo`, and **no extracted operating-system library
is committed to this repository** (`/tmp/sysroot` is outside the tree and disposable).

## Run it

```bash
bash scripts/setup-browser-env.sh
export CHROME="$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
export LD_LIBRARY_PATH="/tmp/sysroot/usr/lib/x86_64-linux-gnu:/tmp/sysroot/lib/x86_64-linux-gnu"
"$CHROME" --headless=new --no-sandbox --disable-gpu --dump-dom about:blank >/dev/null && echo "chromium ok"
```

## Two faults this avoids

* The extracted tree contains recursive `X11 → ../..` symlinks. Left inside the project,
  Vite's watcher dies with `ELOOP … /X11/X11/…/pdb3` and the dev server exits mid-run.
  Keep the sysroot outside the repository (the script uses `/tmp`).
* A dev server spawned by one shell command is reaped when that command ends. Every
  capture therefore runs inside a single Node process that spawns Vite, polls it until
  HTTP 200, drives Chromium, and terminates the process group.

## Chromium stability

At 1440×900 the browser crashes after roughly three spatial commands (likely software
WebGL memory pressure). The acceptance scripts therefore create one browser per scenario
and reuse a single page for the setup + target messages, because a new page resets the
in-memory scene graph.

## Text entry in this build

Per-character synthetic keystrokes insert only the first character: after the first
`input`, Chromium emits no further `beforeinput` for that focused textarea (keydown and
keypress still arrive; nothing calls `preventDefault`; the node is not replaced). A
single whole-string text commit — the path used by IMEs and paste — works and persists.
The scripts use `CDP Input.insertText` with the complete message, then the real Enter /
Send path.
