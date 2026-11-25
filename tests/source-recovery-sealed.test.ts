/**
 * ==========================================================
 * LÉLU — PRODUCTION SOURCE COMES HOME SEALED (Mission 3.6.1)
 *
 * CATEGORY: integration, offline. Real git, real openssl, real bash; the
 * pinned VPS script runs against a fake production checkout (owned by the
 * `lelu` user, as on the VPS) whose "GitHub" is a local bare repository.
 *
 * The VPS cannot reach the integration session and the session cannot
 * reach the VPS (no SSH, by design), so the owner carries one file. These
 * tests prove the carrier learns nothing and can change nothing:
 *   - only production-only history leaves, never untracked files or .env;
 *   - the file is sealed to the session's key (no plaintext inside);
 *   - it opens only with that key, and only if its SHA-256 equals the one
 *     the owner read on the console (tampering and re-sealing both fail);
 *   - credential-shaped text or forbidden files stop the export, and the
 *     report names the kind, never the value;
 *   - import creates new local branches only: no overwrite, no hook, no push.
 * Skipped (not failed) where root, the `lelu` user, git or openssl is missing.
 * ==========================================================
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "deploy/contabo/deploy-identity/source-recovery.sh";
const RECEIVE = "scripts/recovery/receive-production-bundle.sh";
const MARKER = "PRODUCTION_ONLY_MARKER_7f3a";
const ENV_SECRET = "sk-or-v1-" + "0123456789abcdef".repeat(4);

const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const canRun = process.getuid?.() === 0 && has("id", ["lelu"]) && has("git", ["--version"]) && has("openssl", ["version"]) && has("runuser", ["--help"]);

function sh(cmd: string, args: string[], opts: { cwd?: string; allowFail?: boolean } = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!opts.allowFail && r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} → ${r.status}\n${out}`);
  return { status: r.status ?? 1, out };
}
/** git in the production checkout, as its owner (lelu) — root may not run git there. */
const prodGit = (dir: string, ...args: string[]) => sh("runuser", ["-u", "lelu", "--", "git", "-C", dir, ...args]).out.trim();
const git = (dir: string, ...args: string[]) => sh("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args]).out.trim();

interface World {
  root: string; origin: string; prod: string; keep: string; keys: string; integ: string;
  script: string; run: (action: string) => { status: number; out: string };
  receive: (...args: string[]) => { status: number; out: string };
  close: () => void;
}

/** A fake GitHub, a production checkout with 2 production-only commits + drift, and an integration clone. */
function world(opts: { commitSecret?: boolean; commitEnv?: boolean } = {}): World {
  const root = mkdtempSync(join(tmpdir(), "lelu-recovery-"));
  chmodSync(root, 0o755); // the lelu user must traverse it, as on the VPS
  const origin = join(root, "origin.git"), seed = join(root, "seed"), prod = join(root, "prod");
  const keep = join(root, "keep"), keys = join(root, "keys"), integ = join(root, "integration");
  sh("git", ["init", "-q", "--bare", "-b", "integration/lelu-four-workforce-consolidation", origin]);
  sh("git", ["clone", "-q", origin, seed]);
  writeFileSync(join(seed, "app.ts"), "export const shared = 1;\n");
  git(seed, "add", "."); git(seed, "commit", "-qm", "shared base");
  git(seed, "push", "-q", "origin", "HEAD:integration/lelu-four-workforce-consolidation");
  sh("git", ["clone", "-q", "-b", "integration/lelu-four-workforce-consolidation", origin, prod]);
  writeFileSync(join(prod, "hotfix.ts"), `export const hotfix = "${MARKER}";\n`);
  git(prod, "add", "."); git(prod, "commit", "-qm", "production hotfix (never pushed)");
  writeFileSync(join(prod, "app.ts"), "export const shared = 2; // tuned on the VPS\n");
  git(prod, "commit", "-qam", "production tuning (never pushed)");
  if (opts.commitSecret) { writeFileSync(join(prod, "config.ts"), `export const k = "${ENV_SECRET}";\n`); git(prod, "add", "."); git(prod, "commit", "-qm", "oops"); }
  if (opts.commitEnv) { writeFileSync(join(prod, ".env"), "PORT=4173\n"); git(prod, "add", "-f", ".env"); git(prod, "commit", "-qm", "env"); }
  writeFileSync(join(prod, "app.ts"), "export const shared = 3; // uncommitted drift\n");
  writeFileSync(join(prod, ".env"), `OPENROUTER_API_KEY=${ENV_SECRET}\n`); // untracked: must never leave
  sh("mkdir", ["-p", join(prod, "dist")]);
  sh("chown", ["-R", "lelu:lelu", prod]);
  sh("git", ["clone", "-q", origin, integ]);

  sh("bash", [RECEIVE, "keygen", keys]);
  const pub = readFileSync(join(keys, "public.pem"), "utf8").trim();
  const source = readFileSync(SCRIPT, "utf8");
  const mutant = source
    .replace("APP=/opt/lelu/app", `APP=${prod}`)
    .replace("KEEP=/var/backups/lelu-source", `KEEP=${keep}`)
    .replace(/RECIPIENT_PEM='[^']*'/, `RECIPIENT_PEM='${pub}'`)
    .replace("command -v systemd-run >/dev/null &&", "false &&");
  assert.notEqual(mutant, source);
  assert.ok(mutant.includes(`APP=${prod}`) && mutant.includes(`KEEP=${keep}`) && mutant.includes(pub), "substitutions applied");
  const script = join(root, "source-recovery.sh");
  writeFileSync(script, mutant);
  return {
    root, origin, prod, keep, keys, integ, script,
    run: (action) => sh("bash", [script, action], { allowFail: true }),
    receive: (...args) => sh("bash", [RECEIVE, ...args], { allowFail: true }),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

const field = (out: string, name: string) => out.match(new RegExp(`^${name}\\s+([0-9a-f]{64})$`, "m"))?.[1] ?? "";
const sealedPath = (w: World) => {
  const base = join(w.prod, "dist", "ops-export");
  const dir = readdirSync(base)[0];
  return join(base, dir, readdirSync(join(base, dir))[0]);
};

test("export → seal → open with the console hash → import as a new local branch", { skip: !canRun }, () => {
  const w = world();
  try {
    const exp = w.run("source-export");
    assert.equal(exp.status, 0, exp.out);
    assert.match(exp.out, /2 production-only commit\(s\)/);
    assert.match(exp.out, /sealed 2 commit\(s\) \+ uncommitted drift/);
    const plain = field(exp.out, "SHA256-PLAIN"), sealedSum = field(exp.out, "SHA256-SEALED");
    assert.ok(plain && sealedSum, exp.out);
    assert.doesNotMatch(exp.out, /sk-or-v1-0123/, "no secret value in the console output");

    // web copy: gated dist/, unguessable 32-hex directory, lelu-owned 0644; ciphertext only
    const sealed = sealedPath(w);
    assert.match(sealed, /ops-export\/[0-9a-f]{32}\/lelu-production-[0-9a-f]{12}\.sealed$/);
    const st = statSync(sealed);
    assert.equal(st.mode & 0o777, 0o644);
    assert.equal(sh("sha256sum", [sealed]).out.slice(0, 64), sealedSum, "the sealed hash printed is the file's");
    const bytes = readFileSync(sealed);
    assert.ok(!bytes.includes(MARKER), "production source is not readable in the sealed file");
    assert.ok(!bytes.includes("# v2 git bundle") && !bytes.includes("# v3 git bundle"), "no plaintext bundle inside");

    // production's own preservation copy: root-only
    const kept = readdirSync(w.keep).filter((f) => f.endsWith(".bundle"));
    assert.equal(kept.length, 1);
    assert.equal(statSync(join(w.keep, kept[0])).mode & 0o777, 0o600);
    assert.equal(statSync(w.keep).mode & 0o777, 0o700);

    // production itself untouched: HEAD, branch, drift and refs
    assert.match(prodGit(w.prod, "status", "--porcelain", "--untracked-files=no"), /^M app\.ts$/, "the drift is still uncommitted, nothing else changed");
    assert.equal(sh("runuser", ["-u", "lelu", "--", "git", "-C", w.prod, "for-each-ref", "refs/lelu-export"]).out.trim(), "", "temporary ref removed");

    const out = join(w.root, "opened");
    const open = w.receive("open", sealed, plain, out, w.keys);
    assert.equal(open.status, 0, open.out);
    assert.match(open.out, /matches the console/);
    const bundle = join(out, readdirSync(out).find((f) => f.endsWith(".bundle"))!);
    assert.equal(statSync(bundle).mode & 0o777, 0o600);
    assert.equal(sh("sha256sum", [bundle]).out.slice(0, 64), plain, "verified again after transfer");

    // the untracked .env never left production
    const listing = sh("git", ["-C", w.integ, "bundle", "list-heads", bundle]).out;
    assert.match(listing, /HEAD/);

    // a hook in the receiving repo must not run during import
    const hookFlag = join(w.root, "hook-ran");
    writeFileSync(join(w.integ, ".git", "hooks", "reference-transaction"), `#!/bin/sh\ntouch ${hookFlag}\n`, { mode: 0o755 });
    const before = git(w.integ, "for-each-ref", "--format=%(refname) %(objectname)");
    const imp = w.receive("import", bundle, w.integ);
    assert.equal(imp.status, 0, imp.out);
    assert.ok(!existsSync(hookFlag), "no hook ran");
    const head = prodGit(w.prod, "rev-parse", "HEAD");
    const branch = `production-recovered/${head.slice(0, 12)}`;
    assert.equal(git(w.integ, "rev-parse", branch), head, "every production commit preserved, same ids");
    assert.match(git(w.integ, "log", "--format=%s", branch), /production hotfix[\s\S]*shared base/);
    assert.match(git(w.integ, "show", `${branch}-drift:app.ts`), /uncommitted drift/, "the drift arrives as its own branch");
    const after = git(w.integ, "for-each-ref", "--format=%(refname) %(objectname)");
    for (const line of before.split("\n")) assert.ok(after.includes(line), `existing ref untouched: ${line}`);
    for (const ref of [branch, `${branch}-drift`]) {
      assert.doesNotMatch(git(w.integ, "show", `${ref}:hotfix.ts`).toString(), /sk-or-v1/);
      assert.equal(sh("git", ["-C", w.integ, "cat-file", "-e", `${ref}:.env`], { allowFail: true }).status === 0, false, `${ref}: no .env`);
    }
    // the origin ("GitHub") received nothing
    assert.doesNotMatch(git(w.origin, "for-each-ref"), /production-recovered/);

    // importing again is idempotent; a different commit under that name is refused
    assert.equal(w.receive("import", bundle, w.integ).status, 0);
    git(w.integ, "branch", "-f", branch, "origin/integration/lelu-four-workforce-consolidation");
    const clash = w.receive("import", bundle, w.integ);
    assert.notEqual(clash.status, 0);
    assert.match(clash.out, /already exists at a different commit — refusing to overwrite/);

    // inventory names exactly the two production-only commits
    git(w.integ, "branch", "-f", branch, head);
    const inv = w.receive("inventory", w.integ, branch, "origin/integration/lelu-four-workforce-consolidation");
    assert.equal((inv.out.match(/never pushed/g) ?? []).length, 2, inv.out);
  } finally {
    w.close();
  }
});

test("the export does not open without the console's exact hash, after tampering, re-sealing, or with another key", { skip: !canRun }, () => {
  const w = world();
  try {
    const exp = w.run("source-export");
    const plain = field(exp.out, "SHA256-PLAIN");
    const sealed = join(w.root, "original.sealed");
    sh("cp", [sealedPath(w), sealed]);
    const opened = (dir: string) => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".bundle"));

    // 1. a wrong or partial hash
    for (const [i, want] of [["a", "0".repeat(64)], ["b", plain.slice(0, 16)]] as const) {
      const r = w.receive("open", sealed, want, join(w.root, `o${i}`), w.keys);
      assert.notEqual(r.status, 0, r.out);
      assert.ok(!opened(join(w.root, `o${i}`)));
    }

    // 2. a flipped byte inside the encrypted bundle
    const t = join(w.root, "t"); sh("mkdir", [t]); sh("tar", ["-C", t, "-xf", sealed]);
    const enc = readFileSync(join(t, "bundle.enc")); enc[enc.length - 40] ^= 0xff; writeFileSync(join(t, "bundle.enc"), enc);
    const tampered = join(w.root, "tampered.sealed"); sh("tar", ["-C", t, "-cf", tampered, "manifest.txt", "key.oaep", "bundle.enc"]);
    const rt = w.receive("open", tampered, plain, join(w.root, "ot"), w.keys);
    assert.notEqual(rt.status, 0); assert.ok(!opened(join(w.root, "ot")));

    // 3. anyone can seal to a PUBLIC key: a substituted export, correctly sealed, still fails the console hash
    writeFileSync(join(w.prod, "hotfix.ts"), "export const hotfix = 'attacker';\n");
    sh("runuser", ["-u", "lelu", "--", "git", "-C", w.prod, "-c", "user.name=x", "-c", "user.email=x@x", "commit", "-qam", "attacker"]);
    sh("rm", ["-rf", join(w.prod, "dist", "ops-export")]);
    const forged = w.run("source-export"); assert.equal(forged.status, 0, forged.out);
    const rf = w.receive("open", sealedPath(w), plain, join(w.root, "of"), w.keys);
    assert.notEqual(rf.status, 0); assert.match(rf.out, /does not match the console/); assert.ok(!opened(join(w.root, "of")));

    // 4. another session's key
    const other = join(w.root, "other-keys"); w.receive("keygen", other);
    const rk = w.receive("open", sealed, plain, join(w.root, "ok2"), other);
    assert.notEqual(rk.status, 0); assert.match(rk.out, /different recipient key/);

    // 5. an archive with a path-escaping or extra member
    const evil = join(w.root, "evil"); sh("mkdir", [evil]); writeFileSync(join(evil, "x"), "x");
    const evilTar = join(w.root, "evil.sealed");
    sh("tar", ["-C", t, "-cf", evilTar, "manifest.txt", "key.oaep", "bundle.enc", "--transform", "s,^bundle.enc$,../bundle.enc,"]);
    const re = w.receive("open", evilTar, plain, join(w.root, "oe"), w.keys);
    assert.notEqual(re.status, 0); assert.match(re.out, /unexpected archive members/);
  } finally {
    w.close();
  }
});

for (const [name, opts, expect] of [
  ["a credential committed in production", { commitSecret: true }, /OpenRouter key \(1×\) added in config\.ts — value not shown/],
  ["a committed .env file", { commitEnv: true }, /forbidden file in the export range: \.env/],
] as const) {
  test(`export refused: ${name}; nothing written; the value is never shown`, { skip: !canRun }, () => {
    const w = world(opts);
    try {
      const r = w.run("source-export");
      assert.notEqual(r.status, 0);
      assert.match(r.out, expect);
      assert.match(r.out, /export refused/);
      assert.doesNotMatch(r.out, /0123456789abcdef/, "no character of the secret value");
      assert.ok(!existsSync(join(w.prod, "dist", "ops-export")), "no web export");
      assert.ok(!existsSync(w.keep), "no preservation copy of a refused export");
    } finally {
      w.close();
    }
  });
}

test("the receiver can only read, verify and add local branches: no push, no eval, no checkout", () => {
  const source = readFileSync(RECEIVE, "utf8");
  assert.doesNotMatch(source, /\bgit\b[^\n]*\bpush\b|"\$\{G\[@\]\}"[^\n]*\bpush\b/);
  assert.doesNotMatch(source, /\beval\b|\bcheckout\b|\bsource\s+"|\bbash\s+-c\b/);
  assert.match(source, /core\.hooksPath=\/dev\/null/);
  const vps = readFileSync(SCRIPT, "utf8");
  assert.match(vps, /RECIPIENT_PEM='-----BEGIN PUBLIC KEY-----/, "the recipient key is inside the pinned script");
  assert.doesNotMatch(vps, /-----BEGIN (RSA |EC )?PRIVATE KEY-----\s*\n\s*[A-Za-z0-9+/]{20}/, "no private key material");
});
