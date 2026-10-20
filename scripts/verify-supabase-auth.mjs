/**
 * LÉLU — SUPABASE AUTH, IN A REAL BROWSER, AGAINST THE REAL PROJECT
 *
 * The gap this closes: the configuration resolver and the project-pairing
 * check were proven by unit tests, and hydration proved a RESTORED session
 * works. Neither proves what the user actually meets — the sign-in form,
 * reaching the real auth endpoint, and saying something true about what
 * came back.
 *
 * Two runs, both against the project the dev server is configured for:
 *
 *   1. MATCHED  — the real URL and a key issued for that same project.
 *      Submitting a deliberately wrong password must come back with a
 *      CREDENTIALS error from the real endpoint, and the deployment-level
 *      configuration warning must NOT be shown. That is the distinction
 *      that was missing: "Invalid API key" was being read by users as
 *      their own wrong password.
 *
 *   2. MISMATCHED — the real URL and a key whose own `ref` claim names a
 *      different project. The warning must appear BEFORE anything is
 *      submitted, because the whole point is to stop a user retyping a
 *      password that could never have worked.
 *
 * No account is created and no email is sent: the only request made is one
 * failing password check. No password is read from anywhere — the wrong one
 * is a literal in this file, and it is wrong on purpose.
 *
 * Usage: SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... vite on some port,
 *        then node scripts/verify-supabase-auth.mjs [url]
 *
 * The mismatched run needs no second project: it overrides the browser's
 * own copy of the key with an unsigned JWT claiming another ref. That key
 * authenticates nothing, which is exactly the state under test.
 */

import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5320/";
/**
 * A SECOND dev server, started with a key whose `ref` claim names another
 * project. It has to be a second server rather than an override injected
 * into this page: plugins/runtimeKeyBridge publishes the real key as a
 * __LELU_* global when the page loads, which lands AFTER an init script
 * and replaces it. The first attempt at this check did exactly that and
 * silently tested the correct key twice.
 */
const MISMATCHED_BASE = process.argv[3] ?? process.env.LELU_MISMATCH_BASE ?? "";
const SC = process.env.LELU_E2E_DIR ?? ".";

/** A real address, so the endpoint reaches the password check rather than rejecting the form. */
const EMAIL = readFileSync(`${SC}/e2e-email.txt`, "utf8").trim();
/** Wrong on purpose. Nothing here is a credential. */
const WRONG_PASSWORD = "not-the-password-0000";

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

/**
 * Click with real browser input, at the element's own centre.
 *
 * `page.click()` cannot be used here, and the reason is worth recording:
 * it hangs on this page. Its own log reads "element is visible, enabled
 * and stable", then "performing click action", and then nothing. Measured
 * cause: the main thread stalls for the best part of a second at a time
 * (a bare `evaluate(() => 1 + 1)` round trip measured 916ms against a
 * 169ms requestAnimationFrame), and locator.click's internal re-checks
 * round-trip through that thread, so the action retries until it times
 * out. A raw mouse press at the same coordinates delivers pointerdown,
 * mousedown and click to the element every time.
 *
 * This is NOT a synthetic DOM `element.click()` — that would bypass hit
 * testing and prove nothing about reachability. It is a real CDP mouse
 * event at a point we have just hit-tested, so a control covered by
 * something else still fails here.
 */
async function realClick(page, selector) {
  const target = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: el === hit || el.contains(hit) };
  }, selector);
  if (!target) throw new Error(`no element for ${selector}`);
  check(`${selector} is not covered by anything`, target.reachable);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** An unsigned JWT whose payload claims a project ref. Authenticates nothing. */
function keyClaimingProject(ref) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ iss: "supabase", ref, role: "anon" })}.unsigned`;
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});

/** Open the app at `base` with the sign-in gate showing. */
async function openGate(base) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 160)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-lelu-signin-gate]", { timeout: 40000 }).catch(() => {});
  return { page, pageErrors };
}

const read = (page) =>
  page.evaluate(() => {
    const gate = document.querySelector("[data-lelu-signin-gate]");
    if (!gate) return { gate: false };
    return {
      gate: true,
      text: gate.innerText.slice(0, 1200),
      configError: gate.querySelector("[data-lelu-config-error]")?.textContent ?? null,
      alerts: [...gate.querySelectorAll('[role="alert"]')].map((el) => el.textContent ?? ""),
      hasPasswordField: Boolean(gate.querySelector('input[type="password"]')),
    };
  });

/* ---------------------------------------------------------------- *
 * 1. MATCHED PROJECT — a wrong password must read as a wrong password
 * ---------------------------------------------------------------- */

console.log("\n=== SUPABASE AUTH: the configured project ===");
{
  const { page, pageErrors } = await openGate(BASE);
  const before = await read(page);

  check("the sign-in gate is shown before chat", before.gate);
  check("it offers a password field rather than declaring itself unconfigured",
    before.hasPasswordField,
    before.hasPasswordField ? "" : before.text?.slice(0, 160) ?? "no gate");
  check("a correctly paired URL and key raise no configuration warning",
    before.configError === null,
    before.configError ?? "");

  if (before.hasPasswordField) {
    await page.fill('[data-lelu-signin-gate] input[type="email"]', EMAIL);
    await page.fill('[data-lelu-signin-gate] input[type="password"]', WRONG_PASSWORD);
    await realClick(page, '[data-lelu-signin-gate] button[type="submit"]');
    // Wait for the endpoint's own answer rather than a fixed sleep.
    await page
      .waitForFunction(
        () => {
          const gate = document.querySelector("[data-lelu-signin-gate]");
          return [...(gate?.querySelectorAll('[role="alert"]') ?? [])].some((el) => (el.textContent ?? "").trim());
        },
        { timeout: 30000 },
      )
      .catch(() => {});

    const after = await read(page);
    const alerts = (after.alerts ?? []).join(" | ");

    // The request really left the browser and the project really answered.
    check("the real auth endpoint answered a submitted password",
      /invalid login credentials|email not confirmed|invalid email or password/i.test(alerts),
      alerts || "nothing was reported back");

    // The distinction this whole repair was about.
    check("a wrong password is not reported as a broken deployment",
      !/not valid for the configured project|invalid api key/i.test(alerts),
      alerts);
    check("no configuration warning appeared on a correctly configured project",
      after.configError === null,
      after.configError ?? "");
  }

  check("no uncaught page error", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

/* ---------------------------------------------------------------- *
 * 2. MISMATCHED PROJECT — say so before a password is ever typed
 * ---------------------------------------------------------------- */

console.log("\n=== SUPABASE AUTH: a key issued for another project ===");
if (!MISMATCHED_BASE) {
  // Loudly, not quietly. A check that cannot run has not passed.
  console.log("  SKIP  no mismatched-project server given — pass its URL as the second argument");
  console.log(`        start one with SUPABASE_URL=<the real url> SUPABASE_PUBLISHABLE_KEY=${keyClaimingProject("someotherproject")}`);
  failures += 1;
} else {
  const { page, pageErrors } = await openGate(MISMATCHED_BASE);
  await page
    .waitForFunction(
      () => Boolean(document.querySelector("[data-lelu-config-error]")),
      { timeout: 30000 },
    )
    .catch(() => {});
  const state = await read(page);

  check("the mismatch is reported before anything is submitted",
    Boolean(state.configError),
    state.configError ?? "no warning was shown; the user would retype a password that cannot work");
  check("the warning names the configuration, not the user",
    /same project/i.test(state.configError ?? ""),
    state.configError ?? "");
  check("it does not blame a password",
    !/password/i.test(state.configError ?? ""),
    state.configError ?? "");
  check("no uncaught page error", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL SUPABASE AUTH CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
