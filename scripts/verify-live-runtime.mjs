/**
 * LÉLU LIVE RUNTIME VERIFICATION — real browser, real server
 *
 * Everything else in scripts/ runs the production modules under Node
 * shims. This one loads the app in a REAL Chromium against a REAL
 * running server, because three of the claims in this audit can only be
 * proven that way:
 *
 *   - the app renders (no white screen) and initialises without a page
 *     error — Phase 10 / Phase 14 / TEST 8;
 *   - a message typed into the EXISTING chat input travels through the
 *     runtime and produces a rendered response — TEST 1;
 *   - no credential is reachable from the page: not in the bundle it
 *     loaded, not on `window`, not in the console — TEST 10.
 *
 * Usage:
 *   bun run dev &            (or: bun run build && bun run serve)
 *   node scripts/verify-live-runtime.mjs [baseUrl]
 *
 * The base URL defaults to http://127.0.0.1:5173.
 */

import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173";
/**
 * The canary the caller is expected to have put in the SERVER's
 * environment (GROQ_API_KEY). If the page can see this string anywhere,
 * the credential reached the client.
 */
const CANARY = process.env.LELU_LIVE_CANARY ?? "";

let failures = 0;
function assert(condition, label, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// The environment ships a pinned Chromium at a fixed path. Playwright's
// own version pin may not match it, in which case its default lookup
// fails; pointing at the installed binary is the documented escape and
// avoids re-downloading a browser.
function installedChromium() {
  if (process.env.LELU_CHROMIUM) return process.env.LELU_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith("chromium")) continue;
    const candidate = join(root, entry, "chrome-linux", "chrome");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  const executablePath = installedChromium();
  if (!executablePath) throw error;
  console.log(`  (using the installed Chromium at ${executablePath})`);
  browser = await chromium.launch({ headless: true, executablePath });
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleMessages = [];
const pageErrors = [];
const scriptBodies = [];

page.on("console", (msg) => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (error) => pageErrors.push(error.message));
// Capture every script the page actually loads, so the secret scan below
// covers what was really served rather than what is on disk.
page.on("response", async (response) => {
  const type = response.headers()["content-type"] ?? "";
  if (!type.includes("javascript")) return;
  try {
    scriptBodies.push(await response.text());
  } catch {
    /* a redirect or an aborted body — nothing to scan */
  }
});

try {
  console.log(`== The app loads and initialises (${BASE}) ==`);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("button", { state: "visible", timeout: 30000 });

  const bodyText = (await page.locator("body").innerText().catch(() => "")).trim();
  const canvasCount = await page.locator("canvas").count();
  assert(
    bodyText.length > 0 || canvasCount > 0,
    `the page rendered real content — NO WHITE SCREEN (text=${bodyText.length} chars, canvas=${canvasCount})`,
  );
  assert(pageErrors.length === 0, "no uncaught page error during startup", pageErrors.join(" | "));

  console.log("\n== TEST 8 — a refresh re-initialises cleanly ==");
  pageErrors.length = 0;
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("button", { state: "visible", timeout: 30000 });
  const afterReload = await page.locator("canvas, [data-testid], button").count();
  assert(afterReload > 0, `the app rendered again after reload (${afterReload} elements)`);
  assert(pageErrors.length === 0, "no uncaught page error after reload", pageErrors.join(" | "));

  console.log("\n== The runtime asked the SERVER which credentials it holds ==");
  const relayReport = await page.evaluate(async () => {
    const response = await fetch("/api/ai/providers");
    return { status: response.status, body: await response.text() };
  });
  assert(relayReport.status === 200, "GET /api/ai/providers is reachable from the page", `status=${relayReport.status}`);
  assert(
    !/[A-Za-z0-9_-]{20,}/.test(relayReport.body.replace(/[{}",:]/g, " ")),
    "and the report carries no key-shaped value at all",
    relayReport.body.slice(0, 200),
  );

  console.log("\n== TEST 1 — a message typed into the existing chat input reaches the runtime ==");
  // The chat surface lives behind the LÉLU dock button; it is not
  // mounted at load, which is why a plain textarea selector finds
  // nothing until this is clicked.
  await page.getByRole("button", { name: "LÉLU", exact: true }).first().click();

  const input = page.locator('textarea[placeholder="Type instructions for Lélu…"]').first();
  await input.waitFor({ state: "visible", timeout: 20000 });
  assert(true, "the existing chat input is present and visible (Phase 10)");

  const PROMPT = "Hello LÉLU.";
  await input.fill(PROMPT);
  await page.getByRole("button", { name: /^send message$/i }).first().click();

  // What is being proven is that the TURN ran, not that a particular
  // answer came back: with no provider credential LÉLU answers from her
  // offline brain, and that still means the message travelled through
  // the runtime. The assistant reply is a second, distinct block of text
  // that appears after the echoed user message.
  let replied = false;
  try {
    await page.waitForFunction(
      (prompt) => {
        const text = document.body.innerText;
        if (!text.includes(prompt)) return false;
        // Everything rendered AFTER the user's own message.
        const after = text.slice(text.lastIndexOf(prompt) + prompt.length).trim();
        return after.length > 20;
      },
      PROMPT,
      { timeout: 45000 },
    );
    replied = true;
  } catch {
    replied = false;
  }
  assert(replied, "the message went through the runtime and a response was rendered (TEST 1)");
  assert(pageErrors.length === 0, "the turn produced no uncaught page error", pageErrors.join(" | "));

  console.log("\n== TEST 10 — nothing credential-shaped is reachable from the page ==");
  assert(scriptBodies.length > 0, `scripts served to the browser were captured (${scriptBodies.length})`);
  if (CANARY) {
    const inScripts = scriptBodies.filter((body) => body.includes(CANARY)).length;
    assert(inScripts === 0, `the server's canary credential is in NONE of the ${scriptBodies.length} served scripts`);
    const inConsole = consoleMessages.filter((line) => line.includes(CANARY)).length;
    assert(inConsole === 0, "and appears in no console message", `${inConsole} message(s)`);
    const onWindow = await page.evaluate(
      (canary) => JSON.stringify(Object.keys(globalThis)
        .map((key) => {
          try {
            const value = globalThis[key];
            return typeof value === "string" && value.includes(canary) ? key : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean)),
      CANARY,
    );
    assert(onWindow === "[]", "and is not exposed on any global", onWindow);
  } else {
    console.log("  (no LELU_LIVE_CANARY set — canary comparison skipped)");
  }

  // Independent of the canary: a key-shaped literal for a known provider
  // prefix must not appear in anything served to the browser.
  //
  // NEVER print what this finds. An earlier version of this check echoed
  // the matches into its failure detail and dumped real provider keys
  // into the run log — a secret scanner that leaks the secret it found is
  // worse than no scanner. Only the PREFIX and a count are reported; that
  // is enough to identify which provider to rotate and fix.
  const KEY_SHAPES = [
    { label: "gsk_… (Groq)", pattern: /\bgsk_[A-Za-z0-9_-]{16,}/g },
    { label: "sk-or-v1-… (OpenRouter)", pattern: /\bsk-or-v1-[A-Za-z0-9_-]{16,}/g },
    { label: "csk-… (Cerebras)", pattern: /\bcsk-[A-Za-z0-9_-]{16,}/g },
  ];
  const shapeHits = KEY_SHAPES.map(({ label, pattern }) => ({
    label,
    count: new Set(scriptBodies.flatMap((body) => body.match(pattern) ?? [])).size,
  })).filter((entry) => entry.count > 0);

  assert(
    shapeHits.length === 0,
    "no provider-key-shaped literal is in any served script",
    shapeHits.length > 0
      ? `${shapeHits.map((entry) => `${entry.label}: ${entry.count} distinct value(s)`).join("; ")} — VALUES DELIBERATELY NOT PRINTED. ` +
        "In `vite dev` this is EXPECTED for any credential still named VITE_*: the dev server " +
        "serves the whole import.meta.env record to the browser regardless of application code. " +
        "Rename those to their unprefixed server-side names (see ENV_VARS.md) and re-run, or run " +
        "this against `bun run preview` to check a production build."
      : undefined,
  );

  const consoleErrors = consoleMessages.filter((line) => line.startsWith("error:"));
  console.log(`\n  (console errors observed: ${consoleErrors.length})`);
  for (const line of consoleErrors.slice(0, 8)) console.log(`    - ${line.slice(0, 180)}`);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? "ALL LIVE RUNTIME CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
