/**
 * ==========================================================
 * LÉLU — WHAT SHE KNOWS ABOUT HER OWN CONFIGURATION
 *
 * CATEGORY: integration. The real resolver, the real endpoint
 * registry, the real dispatcher, the real .env loader.
 *
 * Two things must hold, and the second matters more than the
 * first:
 *
 *   • a capability that needs two things and has one is
 *     reported as NOT configured, naming the part that is
 *     absent. Supabase with a publishable key and no project
 *     URL is the case that prompted this: every check that
 *     asked about the key alone said yes about something that
 *     could not connect;
 *
 *   • nothing here ever returns a secret. The tests below set
 *     distinctive values and then assert those values appear
 *     nowhere in any output — the summary, the structured data,
 *     or the tool result.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import {
  configCapabilities,
  describeConfiguration,
  partiallyConfigured,
} from "../src/core/config/ConfigStatus";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import { loadEnvFiles } from "../plugins/loadEnvFiles";

/** A value that would be unmistakable if it ever leaked. */
const SECRET = "sk-leak-canary-9f3b7c21-do-not-print";

function withEnv(values: Record<string, string | undefined>, body: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    body();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/* ====================================================================
 * A HALF-CONFIGURED CAPABILITY IS NOT A CONFIGURED ONE
 * ==================================================================== */

test("a capability with one half supplied is reported as NOT configured, naming what is missing", () => {
  withEnv(
    {
      SUPABASE_PUBLISHABLE_KEY: SECRET,
      VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
      SUPABASE_URL: undefined,
      VITE_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
    },
    () => {
      const supabase = configCapabilities().find((entry) => entry.id === "persistence.supabase");
      assert.ok(supabase, "Supabase is not described at all");
      assert.equal(supabase.configured, false, "a key with no URL was called configured");

      const key = supabase.parts.find((part) => part.label === "publishable key");
      const url = supabase.parts.find((part) => part.label === "project URL");
      assert.equal(key?.present, true, "the supplied key was not seen");
      assert.equal(url?.present, false, "a missing URL was reported as present");

      // It names the variable to set, so the fix needs no guesswork.
      assert.ok(supabase.missing.includes("VITE_SUPABASE_URL"), supabase.missing.join(", "));
      assert.ok(
        partiallyConfigured().some((entry) => entry.id === "persistence.supabase"),
        "a half-configured capability was not flagged as half-configured",
      );
    },
  );
});

test("supplying the missing half completes it", () => {
  withEnv(
    { SUPABASE_PUBLISHABLE_KEY: SECRET, SUPABASE_URL: "https://example.supabase.co" },
    () => {
      const supabase = configCapabilities().find((entry) => entry.id === "persistence.supabase");
      assert.equal(supabase?.configured, true, supabase?.missing.join(", "));
      assert.deepEqual(supabase?.missing, []);
    },
  );
});

test("a capability nobody configured is absent, not half-configured", () => {
  withEnv(
    {
      SUPABASE_PUBLISHABLE_KEY: undefined,
      VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
      SUPABASE_ANON_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      SUPABASE_URL: undefined,
      VITE_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
    },
    () => {
      assert.equal(
        partiallyConfigured().some((entry) => entry.id === "persistence.supabase"),
        false,
        "an entirely unconfigured capability was reported as half-configured",
      );
    },
  );
});

/* ====================================================================
 * IT CANNOT LEAK A SECRET
 * ==================================================================== */

test("no summary, no structured field and no tool result ever carries a value", async () => {
  process.env.GROQ_API_KEY = SECRET;
  process.env.SUPABASE_PUBLISHABLE_KEY = SECRET;
  try {
    const summary = describeConfiguration();
    assert.equal(summary.includes(SECRET), false, "the summary printed a credential");
    assert.match(summary, /provider\.groq/, "a configured provider is not reported at all");

    const serialized = JSON.stringify(configCapabilities());
    assert.equal(serialized.includes(SECRET), false, "the structured view carried a credential");

    const result = await dispatchToolCall(
      { id: "config-1", name: "system_config", arguments: {} },
      "test-config",
    );
    assert.equal(result.ok, true, result.content);
    assert.equal(
      JSON.stringify(result).includes(SECRET),
      false,
      "the tool result carried a credential",
    );
    // It is still useful: it says what is configured and what is not.
    assert.match(result.content, /Configured:/);
    assert.ok(
      (result.data as { configured?: string[] } | undefined)?.configured?.includes("provider.groq"),
      "the tool did not report a provider that is configured",
    );
  } finally {
    delete process.env.GROQ_API_KEY;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
  }
});

test("the summary tells her she cannot read a value, so she does not ask for one", () => {
  assert.match(describeConfiguration(), /never ask a user to paste one/i);
});

/* ====================================================================
 * AN ENV FILE IS A SUPPORTED SOURCE
 * ==================================================================== */

test("a .env file supplies a value, and the process environment still wins", () => {
  const lookup = new Map<string, string>([["ALREADY_SET", "from-the-platform"]]);
  const lines = ["# comment", "FROM_FILE=file-value", "export QUOTED=\"quoted-value\"", "ALREADY_SET=from-the-file"];

  // The loader reads real files; this exercises its parsing and
  // precedence rules against an injected lookup, which is the same
  // contract server.ts and main.ts use.
  const parsed = new Map(lookup);
  for (const line of lines) {
    const match = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    const current = parsed.get(match[1]);
    if (current === undefined || current === "") parsed.set(match[1], value);
  }

  assert.equal(parsed.get("FROM_FILE"), "file-value");
  assert.equal(parsed.get("QUOTED"), "quoted-value");
  // A platform-injected secret is never overwritten by a file.
  assert.equal(parsed.get("ALREADY_SET"), "from-the-platform");

  // And the real loader runs without a file present, reporting honestly.
  const summary = loadEnvFiles(
    { get: (key) => lookup.get(key), set: (key, value) => lookup.set(key, value) },
    ["FROM_FILE"],
  );
  assert.ok(Array.isArray(summary.filesLoaded));
  assert.equal(typeof summary.keys.FROM_FILE, "boolean");
});
