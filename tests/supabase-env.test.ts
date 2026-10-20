/**
 * ==========================================================
 * LÉLU — SUPABASE ENVIRONMENT RESOLUTION
 *
 * CATEGORY: unit. No network, no Supabase client — what is
 * under test is which NAMES each initialisation path reads and
 * what it concludes from them.
 *
 * The property being pinned: there is one answer to "is
 * Supabase configured, and for which project". There used to be
 * three. SupabasePersistence read SUPABASE_URL,
 * VITE_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL; the OG client
 * read SUPABASE_URL and would take SUPABASE_ANON_KEY as a key;
 * the server middleware read process.env.SUPABASE_URL and
 * nothing else. So an operator setting one documented alias
 * configured one path and left the others reporting "not
 * configured" — and the symptom reaching the user was the same
 * either way: sign-in simply did not work.
 *
 * Also pinned: a URL and key from DIFFERENT projects is
 * detected and named. That was a real deployment state, and the
 * only symptom was "Invalid API key" at sign-in, which reads as
 * the user's own bad password.
 *
 * No real credential appears in this file. The JWTs below are
 * built here, unsigned, purely so their `ref` claim can be
 * read — they authenticate nothing.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPABASE_URL_NAMES,
  SUPABASE_KEY_NAMES,
  resolveSupabaseConfig,
  supabaseConfigGap,
  projectRefFromUrl,
  projectRefFromKey,
  checkSupabaseProject,
} from "../src/core/config/supabaseEnv";

/** An unsigned JWT whose payload claims a project ref. Not a credential. */
function anonKeyForProject(ref: string): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ iss: "supabase", ref, role: "anon" })}.unsigned`;
}

/** Run `body` with exactly these env names set, and nothing Supabase-ish else. */
function withEnv(values: Record<string, string>, body: () => void): void {
  const touched = new Set([...SUPABASE_URL_NAMES, ...SUPABASE_KEY_NAMES, ...Object.keys(values)]);
  const saved = new Map<string, string | undefined>();
  for (const name of touched) {
    saved.set(name, process.env[name]);
    delete process.env[name];
    // resolveEnv also consults VITE_<NAME> and the __LELU_<NAME>__ globals.
    const bare = name.replace(/^VITE_/, "");
    for (const alias of [`VITE_${bare}`, bare]) {
      if (!saved.has(alias)) {
        saved.set(alias, process.env[alias]);
        delete process.env[alias];
      }
    }
  }
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
  try {
    body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/* ------------------------------------------------------------------ *
 * One answer to "configured", whichever documented name was used
 * ------------------------------------------------------------------ */

for (const urlName of SUPABASE_URL_NAMES) {
  for (const keyName of SUPABASE_KEY_NAMES) {
    test(`${urlName} + ${keyName} resolves to a configured project`, () => {
      withEnv(
        { [urlName]: "https://exampleproj.supabase.co", [keyName]: "sb_publishable_example" },
        () => {
          const config = resolveSupabaseConfig();
          assert.ok(config, `${urlName}/${keyName} was set but resolved as unconfigured`);
          assert.equal(config.url, "https://exampleproj.supabase.co");
          assert.equal(config.publishableKey, "sb_publishable_example");
          assert.equal(supabaseConfigGap(), null);
        },
      );
    });
  }
}

test("the unprefixed name wins over the prefixed aliases", () => {
  withEnv(
    {
      SUPABASE_URL: "https://chosen.supabase.co",
      NEXT_PUBLIC_SUPABASE_URL: "https://ignored.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_chosen",
    },
    () => {
      assert.equal(resolveSupabaseConfig()?.url, "https://chosen.supabase.co");
    },
  );
});

/* ------------------------------------------------------------------ *
 * A half-configured deployment says WHICH half, by name
 * ------------------------------------------------------------------ */

test("a URL with no key is reported as missing the key, not as configured", () => {
  withEnv({ SUPABASE_URL: "https://exampleproj.supabase.co" }, () => {
    assert.equal(resolveSupabaseConfig(), null);
    const gap = supabaseConfigGap();
    assert.deepEqual(gap?.missing, ["key"]);
    // The message has to be actionable: it must name what to set.
    assert.ok(gap?.looked.includes("SUPABASE_PUBLISHABLE_KEY"));
    assert.ok(!gap?.looked.includes("SUPABASE_URL"), "it should not ask for a value that is already set");
  });
});

test("a key with no URL is reported as missing the URL", () => {
  // This is the state of the environment this repair pass ran in:
  // SUPABASE_PUBLISHABLE_KEY set, SUPABASE_URL absent.
  withEnv({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example" }, () => {
    assert.equal(resolveSupabaseConfig(), null);
    const gap = supabaseConfigGap();
    assert.deepEqual(gap?.missing, ["url"]);
    assert.ok(gap?.looked.includes("SUPABASE_URL"));
  });
});

test("nothing set is unconfigured rather than a guess at a default", () => {
  withEnv({}, () => {
    assert.equal(resolveSupabaseConfig(), null);
    assert.deepEqual(supabaseConfigGap()?.missing, ["url", "key"]);
  });
});

test("a caller's own extra values are consulted after the shared names, never instead", () => {
  withEnv({ SUPABASE_URL: "https://shared.supabase.co" }, () => {
    const config = resolveSupabaseConfig({
      url: ["https://callers-own.supabase.co"],
      key: ["sb_publishable_fromcaller"],
    });
    assert.equal(config?.url, "https://shared.supabase.co", "the shared name must win");
    assert.equal(config?.publishableKey, "sb_publishable_fromcaller", "the caller's value must fill a gap");
  });
});

/* ------------------------------------------------------------------ *
 * URL and key from different projects is NAMED, not left to sign-in
 * ------------------------------------------------------------------ */

test("a project ref is read from a hosted URL and not invented for other hosts", () => {
  assert.equal(projectRefFromUrl("https://abcdefghijkl.supabase.co"), "abcdefghijkl");
  assert.equal(projectRefFromUrl("https://abcdefghijkl.supabase.co/rest/v1"), "abcdefghijkl");
  assert.equal(projectRefFromUrl("http://localhost:54321"), null);
  assert.equal(projectRefFromUrl("not a url"), null);
});

test("a legacy anon key's own project claim is readable", () => {
  assert.equal(projectRefFromKey(anonKeyForProject("abcdefghijkl")), "abcdefghijkl");
});

test("a modern publishable key carries no project claim, and that reads as unknown", () => {
  // Not "fine" — unknown. Claiming a match that cannot be seen would be
  // worse than admitting it cannot be seen.
  assert.equal(projectRefFromKey("sb_publishable_hb0000000000000000000000"), null);
  const check = checkSupabaseProject({
    url: "https://abcdefghijkl.supabase.co",
    publishableKey: "sb_publishable_hb0000000000000000000000",
  });
  assert.equal(check.verdict, "unverifiable");
});

test("a key issued for another project is caught before any request is made", () => {
  const check = checkSupabaseProject({
    url: "https://intendedproj.supabase.co",
    publishableKey: anonKeyForProject("someotherproj"),
  });
  assert.equal(check.verdict, "mismatch");
  assert.ok(check.verdict === "mismatch" && check.urlRef === "intendedproj");
  assert.ok(check.verdict === "mismatch" && check.keyRef === "someotherproj");
  // The message must blame the configuration, not the person signing in.
  assert.match(check.message, /same project/i);
  assert.doesNotMatch(check.message, /password/i);
});

test("a matching pair is reported as a match, with the project named", () => {
  const check = checkSupabaseProject({
    url: "https://intendedproj.supabase.co",
    publishableKey: anonKeyForProject("intendedproj"),
  });
  assert.equal(check.verdict, "match");
  assert.ok(check.verdict === "match" && check.ref === "intendedproj");
});

test("no message ever contains the key itself", () => {
  const key = anonKeyForProject("someotherproj");
  const check = checkSupabaseProject({ url: "https://intendedproj.supabase.co", publishableKey: key });
  assert.ok(check.verdict === "mismatch");
  assert.ok(!check.message.includes(key), "an operator message must not echo the credential");
});

/* ------------------------------------------------------------------ *
 * No path may go back to reading the environment on its own
 * ------------------------------------------------------------------ */

test("every Supabase client path reads the shared resolver, not process.env", async () => {
  const { readFile } = await import("node:fs/promises");
  const paths = [
    "src/core/persistence/SupabasePersistence.ts",
    "src/og/integrations/supabase/client.ts",
    "src/og/integrations/supabase/auth-middleware.ts",
  ];
  for (const path of paths) {
    const source = stripComments(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
    assert.match(
      source,
      /resolveSupabaseConfig\(/,
      `${path} initialises a Supabase client without the shared resolver`,
    );
    assert.doesNotMatch(
      source,
      /process\.env\.SUPABASE|process\.env\[.SUPABASE/,
      `${path} reads a Supabase name out of process.env directly, which is how the three ` +
        `paths came to disagree about what "configured" means`,
    );
  }
});

/** Comments discuss the old code on purpose; only real code should match. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
