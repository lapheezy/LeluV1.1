/**
 * LÉLU BUNDLE SECRET SCAN — REGRESSION GUARD
 *
 * The project rule is "no secrets in frontend bundles". It was being
 * broken: every chat-provider key was compiled verbatim into the client
 * bundle, because six modules read `import.meta.env` as an OBJECT and
 * Vite substitutes the whole env record at such a call site — so the
 * keys shipped whether or not any code referenced them. Measured before
 * the fix: two canary keys in 11 separate chunks of dist/assets/.
 *
 * A comment saying "don't do that" would not have held. This does: it
 * runs a REAL production build with canary values in the environment
 * and fails if any of them can be found in the output.
 *
 * It is deliberately a build-output test rather than a source grep — a
 * source grep cannot see what a bundler inlines, which is precisely how
 * the leak went unnoticed.
 *
 * Run: bun run scripts/verify-bundle-secrets.ts
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * The six chat-provider credentials. These MUST NOT reach the browser:
 * they are read server-side by plugins/aiProxyApi.ts and reach their
 * upstream through /api/ai/relay (see src/providers/aiRelay.ts).
 */
const FORBIDDEN: Record<string, string> = {
  VITE_GROQ_API_KEY: "gsk_CANARYaaa1_MUSTNOTSHIP",
  VITE_OPENROUTER_API_KEY: "sk-or-CANARYbbb2_MUSTNOTSHIP",
  VITE_CEREBRAS_API_KEY: "csk-CANARYccc3_MUSTNOTSHIP",
  VITE_MISTRAL_API_KEY: "CANARYddd4_MUSTNOTSHIP",
  VITE_FIREWORKS_API_KEY: "CANARYeee5_MUSTNOTSHIP",
  VITE_GITHUB_TOKEN: "CANARYfff6_MUSTNOTSHIP",
  // Knowledge providers, moved server-side for the same reason: NewsAPI
  // and the YouTube Data API relay through /api/knowledge/relay, and
  // GitHub repo search through the existing /api/github/proxy.
  VITE_NEWS_API_KEY: "CANARYggg7_MUSTNOTSHIP",
  VITE_YOUTUBE_API_KEY: "CANARYhhh8_MUSTNOTSHIP",
};

/**
 * Keys that ARE still browser-side, by current design.
 *
 * Listed rather than hidden: each belongs to a browser-only feature
 * (the Earth fire layer, avatar 3-D reconstruction, two secondary news
 * fallbacks) that has not been given the relay treatment yet. The scan
 * reports whether each actually shipped, so the remaining exposure is
 * measured on every run instead of being assumed or forgotten.
 */
const KNOWN_BROWSER_SIDE: Record<string, string> = {
  VITE_FIRMS_API_KEY: "CANARYbs1_BROWSERSIDE",
  VITE_MESHY_API_KEY: "CANARYbs2_BROWSERSIDE",
  VITE_GUARDIAN_API_KEY: "CANARYbs3_BROWSERSIDE",
  VITE_GNEWS_API_KEY: "CANARYbs4_BROWSERSIDE",
};

/**
 * Unprefixed, server-only names. Vite must never expose these at all —
 * if one appears, `envPrefix` has been widened or a plugin is leaking
 * the server environment into the client.
 */
const SERVER_ONLY: Record<string, string> = {
  GROQ_API_KEY: "CANARYsrv1_SERVERONLY",
  OPENROUTER_API_KEY: "CANARYsrv2_SERVERONLY",
  AISSTREAM_API_KEY: "CANARYsrv3_SERVERONLY",
  INSTAGRAM_ACCESS_TOKEN: "CANARYsrv4_SERVERONLY",
  LELU_ENGINEER_TOKEN: "CANARYsrv5_SERVERONLY",
};

const OUT_DIR = "dist-secret-scan";

function everyFile(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...everyFile(full));
    else out.push(full);
  }
  return out;
}

function main(): void {
  console.log("== Building with canary credentials in the environment ==");

  const result = spawnSync("bun", ["run", "vite", "build", "--outDir", OUT_DIR, "--emptyOutDir"], {
    env: { ...process.env, ...FORBIDDEN, ...SERVER_ONLY, ...KNOWN_BROWSER_SIDE },
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    console.error("\nBuild failed — cannot scan a bundle that was not produced.");
    process.exit(1);
  }
  console.log("  ✓ production build succeeded");

  const files = everyFile(OUT_DIR);
  assert(files.length > 0, `the build produced output to scan (${files.length} files)`);

  try {
    const hits: Record<string, string[]> = {};
    for (const file of files) {
      let contents: string;
      try {
        contents = readFileSync(file, "utf8");
      } catch {
        continue; // a binary asset (font, image) — nothing to match
      }
      for (const [name, canary] of Object.entries({ ...FORBIDDEN, ...SERVER_ONLY, ...KNOWN_BROWSER_SIDE })) {
        if (contents.includes(canary)) {
          (hits[name] ??= []).push(file);
        }
      }
    }

    console.log("\n== No chat-provider credential reaches the client bundle ==");
    for (const name of Object.keys(FORBIDDEN)) {
      assert(
        !hits[name],
        `${name} is absent from every built file`,
        hits[name] ? `FOUND IN: ${hits[name].join(", ")}` : undefined,
      );
    }

    console.log("\n== No server-only variable is exposed to the client at all ==");
    for (const name of Object.keys(SERVER_ONLY)) {
      assert(
        !hits[name],
        `${name} is absent from every built file`,
        hits[name] ? `FOUND IN: ${hits[name].join(", ")}` : undefined,
      );
    }

    console.log("\n== Known remaining browser-side keys (reported, not asserted) ==");
    // Not failures — these are documented as still client-side. Printing
    // the real measurement each run keeps the remaining exposure visible
    // instead of letting it drift out of memory.
    for (const name of Object.keys(KNOWN_BROWSER_SIDE)) {
      console.log(
        `  ${hits[name] ? "•" : "·"} ${name}: ${
          hits[name] ? `SHIPPED in ${hits[name].length} file(s) — still browser-side` : "not present in this build"
        }`,
      );
    }

    console.log("\n== The whole env record is not being inlined ==");
    // The original bug's signature was a module reading `import.meta.env`
    // as an OBJECT: the bundler then emitted a literal record mapping
    // every VITE_* NAME to its VALUE. A bare name is harmless and appears
    // legitimately in warnings and diagnostics ("set GROQ_API_KEY on the
    // server"), so what is checked here is a name BOUND TO A VALUE —
    // `VITE_X:"..."` or `"VITE_X":"..."` — which is what that record
    // looks like once minified, and cannot occur any other way.
    const bundleText = files
      .filter((file) => file.endsWith(".js"))
      .map((file) => {
        try {
          return readFileSync(file, "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    const boundPairs = [...bundleText.matchAll(/["'`]?(VITE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET))["'`]?\s*:\s*["'`]([^"'`]*)["'`]/g)]
      // An empty value is a name with nothing behind it — not a leak.
      .filter((match) => match[2].trim().length > 0)
      .map((match) => match[1])
      // The knowingly-browser-side keys are reported above, not asserted
      // here; this check is for a name that should NOT be shipping.
      .filter((name) => !(name in KNOWN_BROWSER_SIDE));
    assert(
      boundPairs.length === 0,
      "no VITE_*_KEY/TOKEN name is emitted bound to a value (the wholesale-inline signature)",
      boundPairs.length > 0 ? `FOUND: ${[...new Set(boundPairs)].join(", ")}` : undefined,
    );
  } finally {
    rmSync(OUT_DIR, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL BUNDLE SECRET CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
