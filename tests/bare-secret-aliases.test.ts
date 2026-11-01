/**
 * ==========================================================
 * LÉLU — BARE SECRET NAMES
 *
 * CATEGORY: unit. No network, no files: what is under test is
 * which NAMES a platform-named secret reaches.
 *
 * The property being pinned is the one that broke twice: seven
 * real credentials were present in `.env.local` under the
 * platform's own names (`Anthropic`, `Groq`, `Supabase`) while
 * nothing in the code read those names, so every provider
 * reported itself unconfigured and Supabase reported `disabled`.
 *
 * Also pinned, because it is the easy way to get this wrong:
 * this layer may only FILL A HOLE. It must never override a
 * documented name, and it must never invent a value that the
 * secret does not actually contain — the Supabase secret is a
 * publishable key, so no URL may be conjured from it.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  BARE_SECRET_ALIASES,
  bareSecretAliasReport,
  fillBareSecretAliases,
} from "../plugins/bareSecretAliases";

/** A tiny stand-in for process.env. */
function lookupOf(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (name: string) => map.get(name),
    set: (name: string, value: string) => void map.set(name, value),
    has: (name: string) => map.has(name),
    valueOf: (name: string) => map.get(name),
  };
}

test("a platform secret named after its provider reaches the name the broker reads", () => {
  const env = lookupOf({ Anthropic: "sk-ant-example", Groq: "gsk_example" });
  const filled = fillBareSecretAliases(env);
  assert.equal(env.valueOf("ANTHROPIC_API_KEY"), "sk-ant-example");
  assert.equal(env.valueOf("GROQ_API_KEY"), "gsk_example");
  assert.deepEqual(filled, ["ANTHROPIC_API_KEY", "GROQ_API_KEY"]);
  // Names only — the result is safe to log.
  assert.ok(!filled.some((name) => name.includes("sk-")), "the report must carry names, never values");
});

test("a documented name always wins, and the bare name never overrides it", () => {
  const env = lookupOf({ Groq: "gsk_from_bare", GROQ_API_KEY: "gsk_from_documented" });
  assert.deepEqual(fillBareSecretAliases(env), [], "nothing is filled when the documented name exists");
  assert.equal(env.valueOf("GROQ_API_KEY"), "gsk_from_documented", "the documented name must keep winning");
});

test("no model credential is ever published under a VITE_ prefix", () => {
  // Vite's dev server exposes every VITE_ variable to anyone who can reach
  // it, and the model keys are brokered precisely so they never reach the
  // page. tests/credential-exposure.test.ts and the broker's own warning
  // depend on this.
  const env = lookupOf({ Anthropic: "a", Groq: "b", Openrouter: "c", Github: "d", Meshy: "e" });
  fillBareSecretAliases(env);
  for (const name of [
    "VITE_ANTHROPIC_API_KEY",
    "VITE_GROQ_API_KEY",
    "VITE_OPENROUTER_API_KEY",
    "VITE_GITHUB_TOKEN",
    "VITE_MESHY_API_KEY",
  ]) {
    assert.equal(env.has(name), false, `${name} would publish a model credential to the browser`);
  }
  assert.equal(env.valueOf("GITHUB_MODELS_TOKEN"), "d", "the GitHub token goes under its models name");
  assert.equal(env.has("GITHUB_TOKEN"), false, "the ambient git token is never adopted");
});

test("an empty or whitespace-only bare secret fills nothing", () => {
  const env = lookupOf({ Groq: "   ", Supabase: "" });
  assert.deepEqual(fillBareSecretAliases(env), []);
  assert.equal(env.has("GROQ_API_KEY"), false);
  assert.equal(env.has("VITE_SUPABASE_PUBLISHABLE_KEY"), false);
});

test("the Supabase publishable key is supplied, and no URL is invented from it", () => {
  const env = lookupOf({ Supabase: "sb_publishable_example" });
  fillBareSecretAliases(env);
  assert.equal(env.valueOf("VITE_SUPABASE_PUBLISHABLE_KEY"), "sb_publishable_example");
  assert.equal(env.valueOf("SUPABASE_PUBLISHABLE_KEY"), "sb_publishable_example");
  // A key is not a URL. Claiming otherwise is exactly the fake
  // connectivity this project forbids.
  for (const name of ["SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    assert.equal(env.has(name), false, `${name} must stay missing until it is actually provided`);
  }
});

test("server-only secrets never become browser-visible VITE_ names", () => {
  const env = lookupOf({ Meshy: "msy_example" });
  fillBareSecretAliases(env);
  assert.equal(env.valueOf("MESHY_API_KEY"), "msy_example");
  for (const name of ["VITE_MESHY_API_KEY", "VITE_MESHY", "MESHY"]) {
    assert.equal(env.has(name), false, `${name} would publish a relayed secret to the page`);
  }
});

test("every entry names a documented target and explains itself", () => {
  for (const alias of BARE_SECRET_ALIASES) {
    assert.ok(alias.names.length > 0, `${alias.bare} supplies no name`);
    assert.ok(alias.why.length > 20, `${alias.bare} does not say why the mapping is correct`);
  }
  const bare = BARE_SECRET_ALIASES.map((a) => a.bare);
  assert.deepEqual(
    [...bare].sort(),
    ["Anthropic", "Elevenlabs", "Github", "Groq", "Meshy", "Openrouter", "Supabase"],
    "the list is the set of secrets this project actually provisions",
  );
});

test("the diagnostic report names the source and the targets, never the value", () => {
  const env = lookupOf({ Groq: "gsk_secret_value" });
  const report = bareSecretAliasReport(env);
  assert.deepEqual(report, [{ bare: "Groq", supplies: ["GROQ_API_KEY"] }]);
  assert.doesNotMatch(JSON.stringify(report), /gsk_secret_value/);
});
