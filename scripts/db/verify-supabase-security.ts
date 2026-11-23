/**
 * Security-closure validation against an ISOLATED, throwaway Postgres.
 *
 * Starts a private Postgres cluster in a temp directory (unix socket only, no
 * TCP), loads tests/sql/security-closure/00-fixture.sql, applies the canonical
 * 2026-11-23 migrations from supabase/migrations/ in version order, then runs
 * tests/sql/security-closure/10-assertions.sql inside a rolled-back
 * transaction. The cluster is deleted afterwards.
 *
 * It never connects to Supabase and takes no connection string: there is no
 * way to point it at production.
 *
 *   npx tsx scripts/db/verify-supabase-security.ts          # human output
 *   npx tsx scripts/db/verify-supabase-security.ts --json   # summary JSON
 *
 * Needs PostgreSQL server binaries (initdb, pg_ctl, psql). Set PG_BIN to their
 * directory, otherwise the newest /usr/lib/postgresql/<n>/bin is used. Exit
 * code 0 = every assertion passed, 1 = a check failed, 2 = Postgres missing.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const SQL_DIR = path.join(ROOT, "tests", "sql", "security-closure");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
/** The migrations this suite validates: everything reconciled or added on 2026-11-23. */
const MIGRATION_PREFIX = "20261123";
const DB = "lelu_security_closure";

export function findPgBin(): string | null {
  const fromEnv = process.env.PG_BIN;
  if (fromEnv && existsSync(path.join(fromEnv, "initdb"))) return fromEnv;
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return null;
  const versions = readdirSync(base)
    .filter((v) => existsSync(path.join(base, v, "bin", "initdb")))
    .sort((a, b) => Number(b) - Number(a));
  return versions.length ? path.join(base, versions[0], "bin") : null;
}

export function securityClosureMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.startsWith(MIGRATION_PREFIX) && f.endsWith(".sql"))
    .sort();
}

export interface ValidationResult {
  ok: boolean;
  postgres: string | null;
  migrations: string[];
  passed: string[];
  failure: string | null;
  isolated: true;
}

export function runIsolatedValidation(): ValidationResult {
  const bin = findPgBin();
  const migrations = securityClosureMigrations();
  if (!bin) return { ok: false, postgres: null, migrations, passed: [], failure: "postgres-not-installed", isolated: true };

  // initdb refuses to run as root; drop to `nobody` for the server side.
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const dir = mkdtempSync(path.join(tmpdir(), "lelu-security-closure-"));
  chmodSync(dir, 0o777);
  const data = path.join(dir, "data");
  const port = String(50000 + Math.floor(Math.random() * 10000));

  const run = (cmd: string, args: string[], input?: string) => {
    const [file, argv] = asRoot ? ["runuser", ["-u", "nobody", "--", path.join(bin, cmd), ...args]] : [path.join(bin, cmd), args];
    return spawnSync(file, argv, { input, encoding: "utf8", cwd: dir });
  };
  const psql = (sql: string) =>
    run("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", dir, "-p", port, "-U", "postgres", "-d", DB, "-f", "-"], sql);

  const version = spawnSync(path.join(bin, "postgres"), ["--version"], { encoding: "utf8" }).stdout.trim();
  const passed: string[] = [];
  let failure: string | null = null;
  try {
    const init = run("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "--no-sync"]);
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
    const start = run("pg_ctl", ["-D", data, "-w", "-l", path.join(dir, "log"),
      "-o", `-k ${dir} -p ${port} -c listen_addresses= -c fsync=off`, "start"]);
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stderr}`);
    const create = run("createdb", ["-h", dir, "-p", port, "-U", "postgres", DB]);
    if (create.status !== 0) throw new Error(`createdb failed: ${create.stderr}`);

    const steps: Array<[string, string]> = [
      ["fixture", readFileSync(path.join(SQL_DIR, "00-fixture.sql"), "utf8")],
      ...migrations.map((m): [string, string] => [m, readFileSync(path.join(MIGRATIONS_DIR, m), "utf8")]),
      ["assertions", readFileSync(path.join(SQL_DIR, "10-assertions.sql"), "utf8")],
    ];
    for (const [name, sql] of steps) {
      const r = psql(sql);
      for (const line of `${r.stdout}\n${r.stderr}`.split("\n")) {
        const m = line.match(/NOTICE:\s+(PASS .*)$/);
        if (m) passed.push(m[1]);
      }
      if (r.status !== 0) {
        const fail = `${r.stderr}`.split("\n").find((l) => /ERROR/.test(l)) ?? r.stderr.trim();
        throw new Error(`${name}: ${fail}`);
      }
      if (name === "assertions" && !/ALL SECURITY-CLOSURE ASSERTIONS PASSED/.test(r.stdout)) {
        throw new Error("assertions did not reach the end marker");
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    run("pg_ctl", ["-D", data, "-m", "immediate", "stop"]);
    rmSync(dir, { recursive: true, force: true });
  }
  return { ok: failure === null, postgres: version, migrations, passed, failure, isolated: true };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const result = runIsolatedValidation();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Isolated Postgres: ${result.postgres ?? "not installed"}`);
    console.log(`Migrations applied: ${result.migrations.join(", ")}`);
    for (const p of result.passed) console.log(`  ${p}`);
    console.log(result.ok ? `OK — ${result.passed.length} assertions passed` : `FAILED — ${result.failure}`);
  }
  process.exit(result.ok ? 0 : result.postgres ? 1 : 2);
}
