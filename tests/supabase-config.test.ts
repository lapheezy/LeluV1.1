/**
 * ==========================================================
 * LÉLU — SUPABASE CONFIGURATION RESOLUTION
 *
 * CATEGORY: unit. Reads the real source tree.
 *
 * Why this exists: cloud identity never worked on a correctly
 * configured deployment. ENV_VARS.md asks for SUPABASE_URL
 * and SUPABASE_PUBLISHABLE_KEY, the server reads exactly
 * those, and runtimeKeyBridge publishes them to the browser
 * as __LELU_* globals — but SupabasePersistence.initialize()
 * read only `import.meta.env.VITE_*` through publicEnv().
 *
 * So the operator set the documented names, the server was
 * configured, and the browser reported "Supabase is not
 * configured". The Profile panel then showed an empty
 * identity above a Sign out button, which is what the user
 * saw.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/** Source with comments stripped, so prose about a bug is not read as the bug. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

import {
  SUPABASE_URL_NAMES,
  SUPABASE_KEY_NAMES,
  resolveSupabaseConfig,
} from "../src/core/config/supabaseEnv";

const persistence = code("src/core/persistence/SupabasePersistence.ts");

test("the unprefixed names the operator is told to set are resolved", () => {
  // The names moved out of this file into core/config/supabaseEnv, which is
  // where all three Supabase client paths now read them — they used to read
  // three different lists and disagree about whether a deployment was
  // configured. The property is unchanged: the documented unprefixed names
  // are the ones resolved, and they lead.
  assert.match(persistence, /resolveSupabaseConfig\(/);
  assert.equal(SUPABASE_URL_NAMES[0], "SUPABASE_URL");
  assert.equal(SUPABASE_KEY_NAMES[0], "SUPABASE_PUBLISHABLE_KEY");
});

test("resolution goes through the chain that can see the runtime bridge", () => {
  // The browser cannot read process.env, so an unprefixed value reaches it
  // only as a __LELU_* global — which only resolveEnv consults.
  assert.match(code("src/core/config/supabaseEnv.ts"), /import \{ resolveFirst \} from "\.\.\/resolveEnv"/);

  // Behavioural, not textual: a value published the way the bridge
  // publishes one is actually found.
  const runtime = globalThis as Record<string, unknown>;
  const savedUrl = runtime.__LELU_SUPABASE_URL__;
  const savedKey = runtime.__LELU_SUPABASE_PUBLISHABLE_KEY__;
  const savedEnvUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  runtime.__LELU_SUPABASE_URL__ = "https://bridged.supabase.co";
  runtime.__LELU_SUPABASE_PUBLISHABLE_KEY__ = "sb_publishable_bridged";
  try {
    assert.equal(resolveSupabaseConfig()?.url, "https://bridged.supabase.co");
  } finally {
    if (savedUrl === undefined) delete runtime.__LELU_SUPABASE_URL__;
    else runtime.__LELU_SUPABASE_URL__ = savedUrl;
    if (savedKey === undefined) delete runtime.__LELU_SUPABASE_PUBLISHABLE_KEY__;
    else runtime.__LELU_SUPABASE_PUBLISHABLE_KEY__ = savedKey;
    if (savedEnvUrl !== undefined) process.env.SUPABASE_URL = savedEnvUrl;
  }
});

test("the VITE_ names still work, so existing setups are not broken", () => {
  assert.match(persistence, /VITE_SUPABASE_URL/);
  assert.match(persistence, /VITE_SUPABASE_PUBLISHABLE_KEY/);
});

test("the bridge publishes both Supabase values to the browser", () => {
  const bridge = readFileSync("plugins/runtimeKeyBridge.ts", "utf8");
  assert.match(bridge, /__LELU_SUPABASE_URL__/);
  assert.match(bridge, /__LELU_SUPABASE_PUBLISHABLE_KEY__/);
  assert.match(bridge, /"SUPABASE_URL"/, "the unprefixed alias is what operators set");
});

test("the SERVICE ROLE key is still never bridged", () => {
  // The publishable key is public by design; the service role key is not,
  // and widening Supabase resolution must not have widened that.
  const bridge = readFileSync("plugins/runtimeKeyBridge.ts", "utf8");
  assert.ok(!bridge.includes("SERVICE_ROLE"), "a service role key must never reach the browser");
  assert.ok(!persistence.includes("SERVICE_ROLE"));
});

test("the sign-in gate waits for an answer before declaring it unconfigured", () => {
  const gate = code("src/app/scene/genesis/LeluSignInGate.tsx");
  // Nothing initialized Supabase until the first chat turn, so the gate used
  // to judge a status that had never been computed.
  assert.match(gate, /persistence\s*\n?\s*\.initialize\(\)/);
  assert.match(gate, /!probed/, "it must say nothing until persistence has answered");
});

test("the gate is asked before chat, not inside it", () => {
  const ui = code("src/app/scene/genesis/GenesisInterface.tsx");
  const gateAt = ui.indexOf("<LeluSignInGate />");
  const chatAt = ui.indexOf("<GenesisChat />");
  assert.ok(gateAt > 0, "the gate must be mounted");
  assert.ok(
    gateAt < chatAt,
    "mounted inside the chat branch it only appears after chat is already open",
  );
});

test("skipping is a remembered, first-class answer", () => {
  const gate = readFileSync("src/app/scene/genesis/LeluSignInGate.tsx", "utf8");
  assert.match(gate, /lelu\.auth\.skipped/, "the choice must persist, or it nags");
  assert.match(gate, /Continue without an account/);
});

test("the OG profile offers sign-in when signed out", () => {
  const panel = code("src/og/components/core/panels/SettingsPanel.tsx");
  // It previously rendered only "Sign out" with an empty identity, which
  // reads as "signed in, broken" rather than "not signed in".
  assert.match(panel, /session \?/, "it must branch on whether there is a session");
  assert.match(panel, /SignInForm/);
  assert.match(panel, /isSupabaseConfigured\(\)/, "and say so honestly when there is nothing to sign in to");
});
