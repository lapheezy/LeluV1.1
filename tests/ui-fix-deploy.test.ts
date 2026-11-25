/**
 * ==========================================================
 * LÉLU — A FRONT-END FIX GOES INTO PRODUCTION IN PLACE, AND COMES BACK OUT
 *
 * CATEGORY: integration, offline. The real deploy/contabo/ui-fix.sh runs as
 * root against a fake production checkout owned by `lelu`, whose files are
 * the integration head's (cb9aecdb) versions of the patched files. vite and
 * tsc are stubs; a tiny server serves dist/ from disk per request, as
 * server.ts does. Skipped where root, `lelu`, git, python3 or curl is missing.
 *
 * Proves: the shipped patch applies to integration-head files; only the
 * allow-listed front-end files can be patched; a patch that does not apply,
 * a failing typecheck or a build carrying a credential pattern changes
 * nothing that stays; apply swaps dist/ without a restart and keeps the old
 * one; rollback restores dist/ and the working tree exactly; no value from
 * the env file is printed.
 * ==========================================================
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = "deploy/contabo/ui-fix.sh";
const PATCH = "deploy/contabo/patches/ui-touch-and-controls.patch";
const BASE = "cb9aecdb";
const SECRET = "sk-or-v1-" + "feedface".repeat(8);
const has = (c: string, a: string[]) => spawnSync(c, a, { stdio: "ignore" }).status === 0;
const canRun = process.getuid?.() === 0 && has("id", ["lelu"]) && has("python3", ["--version"]) && has("curl", ["--version"]) && has("git", ["cat-file", "-e", `${BASE}^{commit}`]);

function sh(cmd: string, args: string[], allowFail = false) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!allowFail && r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} → ${r.status}\n${out}`);
  return { status: r.status ?? 1, out };
}
const touched = () => sh("git", ["apply", "--numstat", PATCH]).out.trim().split("\n").map((l) => l.split("\t")[2]);

interface Rig { root: string; app: string; bk: string; run: (...a: string[]) => { status: number; out: string }; close: () => void; lelu: (...a: string[]) => string }

async function rig(opts: { tscFails?: boolean; leakyBuild?: boolean; drift?: boolean } = {}): Promise<Rig> {
  const root = mkdtempSync(join(tmpdir(), "lelu-uifix-"));
  chmodSync(root, 0o755);
  const app = join(root, "app"), bk = join(root, "backups"), env = join(root, "lelu.env");
  mkdirSync(app);
  for (const f of touched()) {
    mkdirSync(dirname(join(app, f)), { recursive: true });
    writeFileSync(join(app, f), sh("git", ["show", `${BASE}:${f}`]).out);
  }
  writeFileSync(join(app, "tsconfig.app.json"), "{}\n");
  writeFileSync(join(app, ".gitignore"), "dist/\ndist.next/\nnode_modules/\n"); // as in the real repository
  const bin = join(app, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "tsc"), `#!/bin/sh\n${opts.tscFails ? 'echo "error TS2345"; exit 2' : "exit 0"}\n`, { mode: 0o755 });
  // stub vite: `vite build --outDir X --emptyOutDir` writes a hashed bundle; the hash follows the sources
  writeFileSync(join(bin, "vite"), `#!/bin/sh
out=dist; while [ $# -gt 0 ]; do [ "$1" = --outDir ] && out=$2; shift; done
rm -rf "$out"; mkdir -p "$out/assets"
h=$(cat src/app/scene/genesis/GenesisInterface.tsx | sha256sum | cut -c1-8)
echo "console.log('lelu $h'${opts.leakyBuild ? `,'${SECRET}'` : ""})" > "$out/assets/index-$h.js"
echo "<html><script type=module src=\\"/assets/index-$h.js\\"></script></html>" > "$out/index.html"
`, { mode: 0o755 });
  writeFileSync(join(bin, "npx"), `#!/bin/sh\ntool=$1; shift; exec "$(dirname "$0")/$tool" "$@"\n`, { mode: 0o755 });
  writeFileSync(env, `VITE_SUPABASE_URL=https://example.supabase.co\nOPENROUTER_API_KEY=${SECRET}\n`, { mode: 0o600 });
  const git = (...a: string[]) => sh("git", ["-C", app, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "production a7503839 stand-in");
  if (opts.drift) writeFileSync(join(app, "README.md"), "uncommitted production note\n");
  sh("bash", ["-c", `cd ${app} && PATH=${bin}:$PATH npx vite build --outDir dist >/dev/null`]); // the current production build
  sh("chown", ["-R", "lelu:lelu", app]);

  // server.ts stand-in: /healthz reports dist; files are read from disk per request
  const port = 41000 + Math.floor(Math.random() * 2000);
  const server: ChildProcess = spawn("python3", ["-I", "-c", `
import http.server, os, json, sys
APP = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        d = os.path.join(APP, "dist")
        if self.path == "/healthz":
            body = json.dumps({"ok": True, "dist": os.path.exists(os.path.join(d, "index.html"))}).encode(); ctype = "application/json"
        else:
            p = os.path.join(d, "index.html" if self.path == "/" else self.path.lstrip("/"))
            if not os.path.isfile(p): self.send_response(404); self.end_headers(); return
            body = open(p, "rb").read(); ctype = "text/html"
        self.send_response(200); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(body)
http.server.HTTPServer(("127.0.0.1", int(sys.argv[2])), H).serve_forever()
`, app, String(port)], { stdio: "ignore" });
  for (let i = 0; i < 50 && sh("curl", ["-fsS", "-m", "1", `http://127.0.0.1:${port}/healthz`], true).status !== 0; i++) await new Promise((r) => setTimeout(r, 100));

  const source = readFileSync(SCRIPT, "utf8");
  const mutant = source
    .replace("APP=/opt/lelu/app", `APP=${app}`)
    .replace("BK=/var/backups/lelu-ui", `BK=${bk}`)
    .replace("H=http://127.0.0.1:4173", `H=http://127.0.0.1:${port}`)
    .replace("ENV_FILE=/etc/lelu/lelu.env", `ENV_FILE=${env}`)
    .replace(/ip -4 -o addr show[^\n]*\n/, `ok "identity check skipped in the rehearsal"\n`)
    .replace('as_lelu() { runuser -u lelu -- bash -c "cd \'$APP\' && $1"; }', `as_lelu() { runuser -u lelu -- env PATH="${bin}:$PATH" bash -c "cd '$APP' && $1"; }`);
  assert.ok(mutant.includes(`APP=${app}`) && mutant.includes(`H=http://127.0.0.1:${port}`) && mutant.includes(`${bin}:$PATH`) && !mutant.includes("ip -4 -o addr"), "substitutions applied");
  const script = join(root, "ui-fix.sh");
  writeFileSync(script, mutant);
  return {
    root, app, bk,
    run: (...a) => sh("bash", [script, ...a], true),
    lelu: (...a) => sh("runuser", ["-u", "lelu", "--", "git", "-C", app, ...a]).out,
    close: () => { server.kill(); rmSync(root, { recursive: true, force: true }); },
  };
}

const served = (r: Rig) => readFileSync(join(r.app, "dist", "index.html"), "utf8");
const patchCopy = (r: Rig, name: string, body: string) => { const p = join(r.root, name); writeFileSync(p, body); chmodSync(p, 0o644); return p; };

test("the shipped patch applies to integration-head files, swaps dist/ live, and rolls back exactly", { skip: !canRun }, async () => {
  const r = await rig({ drift: true });
  try {
    const before = served(r);
    const driftBefore = r.lelu("status", "--porcelain");
    const patch = patchCopy(r, "ui.patch", readFileSync(PATCH, "utf8"));

    const recon = r.run("recon", patch);
    assert.equal(recon.status, 0, recon.out);
    assert.match(recon.out, /patch touches only allowed front-end files \(7\)/);
    assert.match(recon.out, /the patch applies cleanly/);

    const apply = r.run("apply", patch);
    assert.equal(apply.status, 0, apply.out);
    assert.match(apply.out, /dist\/ swapped/);
    assert.match(apply.out, /the app serves the new build/);
    assert.doesNotMatch(apply.out + recon.out, /feedface/, "no env value printed");
    const after = served(r);
    assert.notEqual(after, before, "a new build is live");
    assert.match(readFileSync(join(r.app, "src/app/scene/genesis/GenesisInterface.tsx"), "utf8"), /GenesisCommandPalette trigger=\{false\}/);
    assert.equal(r.lelu("log", "--oneline").trim().split("\n").length, 1, "HEAD unchanged (no commit)");
    const stamp = readdirSync(r.bk)[0];
    assert.equal(readFileSync(join(r.bk, stamp, "dist", "index.html"), "utf8"), before, "the previous build is kept whole");

    const back = r.run("rollback");
    assert.equal(back.status, 0, back.out);
    assert.equal(served(r), before, "previous build served again");
    assert.equal(r.lelu("status", "--porcelain"), driftBefore, "working tree exactly as before (including unrelated drift)");
    assert.match(back.out, /working tree identical to before apply/);
  } finally {
    r.close();
  }
});

test("refused without changing anything: a file outside the allow-list, or a patch that does not apply", { skip: !canRun }, async () => {
  const r = await rig();
  try {
    const before = served(r);
    const outside = patchCopy(r, "evil.patch", readFileSync(PATCH, "utf8") + `diff --git a/server.ts b/server.ts\nnew file mode 100644\n--- /dev/null\n+++ b/server.ts\n@@ -0,0 +1 @@\n+process.exit(1)\n`);
    const o = r.run("apply", outside);
    assert.notEqual(o.status, 0);
    assert.match(o.out, /outside the allow-list: server\.ts/);
    const stale = patchCopy(r, "stale.patch", readFileSync(PATCH, "utf8").replace(/^-(.*)$/m, "-$1 // not what production has"));
    const s = r.run("apply", stale);
    assert.notEqual(s.status, 0);
    assert.match(s.out, /does NOT apply to production's files/);
    assert.equal(served(r), before);
    assert.equal(r.lelu("status", "--porcelain"), "", "nothing changed");
    assert.ok(!existsSync(r.bk), "no backup made for a refused apply");
  } finally {
    r.close();
  }
});

for (const [name, opts, expect] of [
  ["a failing typecheck", { tscFails: true }, /typecheck failed/],
  ["a build containing a credential pattern", { leakyBuild: true }, /credential pattern appears in the new build — not swapped/],
] as const) {
  test(`automatic rollback after ${name}`, { skip: !canRun }, async () => {
    const r = await rig(opts);
    try {
      const before = served(r);
      const a = r.run("apply", patchCopy(r, "ui.patch", readFileSync(PATCH, "utf8")));
      assert.notEqual(a.status, 0);
      assert.match(a.out, expect);
      assert.match(a.out, /patch reversed/);
      assert.equal(served(r), before, "the live build never changed");
      assert.equal(r.lelu("status", "--porcelain"), "", "source back as it was");
      assert.ok(!existsSync(join(r.app, "dist.next")), "no half build left");
    } finally {
      r.close();
    }
  });
}
