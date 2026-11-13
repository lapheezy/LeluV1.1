# Performance harness (Mission: integration + performance)

Every number in `../REPORT.md` was produced by these scripts against the
production build (`npx vite build`) served by the real runtime (`bun run
server.ts`, port 4173), fronted by `gzproxy.mjs` (port 4180), which stands in
for Caddy's `encode zstd gzip` and passes already-encoded responses through.

```bash
PORT=4173 HOST=127.0.0.1 bun run server.ts &
node docs/acceptance/mission-performance/harness/gzproxy.mjs &
export CHROME=/path/to/chromium         # Playwright's bundled browser
PROFILE=desktop RUNS=3 node .../boot.mjs  # cold boot, median of RUNS
PROFILE=mobile  RUNS=3 node .../boot.mjs  # 4x CPU, 120 ms RTT, 9 Mbps
node .../chat.mjs                         # one real guest chat turn + routing trace
node .../cpuprof.mjs                      # main-thread CPU profile of a cold boot
WAIT=180000 node .../modelcalls.mjs       # every model request an idle tab makes
TABS=2 node .../tabs.mjs; HIDE=1 node .../tabs.mjs   # multi-tab / hidden-tab spend
node .../bootgraph.mjs dist 20            # boot chunk graph: count, depth, gzip bytes
```

`evidence/*.json` are the raw medians (A = before, C = after the boot-graph
change; `base-desktop` = before any change).
