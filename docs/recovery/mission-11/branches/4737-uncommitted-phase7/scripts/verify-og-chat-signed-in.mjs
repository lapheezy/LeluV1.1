/**
 * LÉLU — THE OG CHAT, SIGNED IN, WITH REAL SUPABASE MEMORY
 *
 * Every earlier browser check ran signed out — not the state the owner uses,
 * and not the state that fails. This signs in through the app's own gate,
 * reloads so both Supabase clients boot from a real session, and then asks a
 * question whose answer exists ONLY in Supabase (`memory_items` +
 * `conversations/messages`), so "she remembered" can be measured rather than
 * assumed.
 *
 * It reports, verbatim:
 *   • whether v1.1's persistence actually CONNECTED (the thing that failed)
 *   • the reply text, or that none arrived
 *   • the chat panel's own error box
 *   • every console error and failed request
 *   • which provider served the turn
 *
 * Credentials come from the environment and are never written to the repo:
 *   LELU_E2E_EMAIL / LELU_E2E_PASSWORD
 *
 * Usage:
 *   LD_LIBRARY_PATH=… FONTCONFIG_FILE=… LELU_E2E_EMAIL=… LELU_E2E_PASSWORD=… \
 *     node scripts/verify-og-chat-signed-in.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:3000";
const EMAIL = process.env.LELU_E2E_EMAIL ?? "";
const PASSWORD = process.env.LELU_E2E_PASSWORD ?? "";
const QUESTION =
  process.env.LELU_QUESTION ??
  "Lélu, what do you remember about me, and what were we building? Be specific about where we left off.";

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? `  — ${note}` : ""}`);
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const failedRequests = [];
const modelCalls = [];

page.on("console", (message) => {
  const text = message.text();
  if (message.type() === "error" || /\[og chat\]|\[Lélu\]|Supabase|timed out|degraded/i.test(text)) {
    consoleErrors.push(`${message.type()}: ${text.slice(0, 300)}`);
  }
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`));
page.on("requestfailed", (request) =>
  failedRequests.push(`${request.method()} ${request.url().slice(0, 140)} :: ${request.failure()?.errorText}`),
);
page.on("response", (response) => {
  const url = response.url();
  if (/\/api\/model\//.test(url)) modelCalls.push({ url, status: response.status() });
  if (/supabase\.co\/rest/.test(url) && response.status() >= 400) {
    failedRequests.push(`HTTP ${response.status()} ${url.slice(0, 160)}`);
  }
});

// ============================================================
// 1. SIGN IN THROUGH THE APP'S OWN GATE
// ============================================================
console.log("\n== 1 — signing in through the app's own gate ==");
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2_000);

const signIn = await page.evaluate(
  async ({ email, password }) => {
    const mod = await import("/src/core/persistence/SupabasePersistence.ts");
    const persistence = mod.default.getInstance();
    const result = await persistence.signInWithEmail(email, password);
    return { error: result.error };
  },
  { email: EMAIL, password: PASSWORD },
);
check("sign-in accepted", !signIn.error, signIn.error ?? "session issued");

// A reload is what the user actually experiences after signing in, and it is
// when both clients boot and contend for the session.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(9_000);

const state = await page.evaluate(async () => {
  const mod = await import("/src/core/persistence/SupabasePersistence.ts");
  const persistence = mod.default.getInstance();
  const auth = persistence.getAuthState();
  return {
    status: persistence.getStatus(),
    connected: persistence.isConnected(),
    email: auth.email,
    configError: auth.configError,
    historyHydrated: persistence.isHistoryHydrated(),
    historyProgress: persistence.getHistoryProgress(),
  };
});
console.log("  ..  persistence:", JSON.stringify(state));
check(
  "v1.1 persistence CONNECTED after sign-in",
  state.connected,
  `status=${state.status}${state.configError ? ` configError=${state.configError}` : ""}`,
);
check("the signed-in email is known to the runtime", Boolean(state.email), state.email ?? "none");

// ============================================================
// 2. ASK A QUESTION WHOSE ANSWER LIVES ONLY IN SUPABASE
// ============================================================
console.log("\n== 2 — the conversation the owner says does not happen ==");
const threadId = `conv-${Date.now()}-signedin`;
await page.goto(`${BASE}/og/chat/${threadId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('textarea[placeholder*="say something"]', { timeout: 60_000 });

const started = Date.now();
await page.fill('textarea[placeholder*="say something"]', QUESTION);
await page.press('textarea[placeholder*="say something"]', "Enter");

let reply = "";
let errorBox = null;
const deadline = Date.now() + 150_000;
while (Date.now() < deadline) {
  const snapshot = await page.evaluate(() => ({
    prose: [...document.querySelectorAll(".prose")]
      .map((n) => ((n.innerText || n.textContent) ?? "").trim())
      .filter(Boolean),
    errorBox: document.querySelector(".text-destructive")?.textContent?.trim() ?? null,
  }));
  if (snapshot.errorBox) errorBox = snapshot.errorBox;
  if (snapshot.prose.length > 0) {
    reply = snapshot.prose.at(-1);
    break;
  }
  await page.waitForTimeout(1_000);
}

console.log(`\n[reply after ${Date.now() - started}ms]\n${reply || "(none)"}\n`);
if (errorBox) console.log(`[chat error box] ${errorBox}\n`);

check("she replied at all", reply.length > 0, reply ? `${Date.now() - started}ms` : "no reply in 150s");
check(
  "the reply is not an error message",
  reply.length > 0 &&
    !/^(unknown ai error|i encountered an error|⚠️)/i.test(reply) &&
    !/all ai providers are unreachable|offline mode right now/i.test(reply),
  reply.slice(0, 140),
);

const lower = reply.toLowerCase();
check(
  "she recalled the Supabase memory (segment 7 / Halo Array)",
  /segment 7|halo array/.test(lower),
  reply.slice(0, 200),
);
check(
  "she recalled who the user is (Zephyrine)",
  /zephyrine/.test(lower),
  reply.slice(0, 200),
);
check(
  "no chat error box was shown",
  !errorBox,
  errorBox ?? "none",
);

// ============================================================
// 3. THE TURN REACHED A REAL PROVIDER
// ============================================================
console.log("\n== 3 — the provider path ==");
const served = modelCalls.filter((call) => /chat\/completions|messages$/.test(call.url) && call.status === 200);
check(
  "a real provider served the turn",
  served.length > 0,
  served.length > 0 ? served.map((c) => c.url.replace(BASE, "")).join(", ") : "no 200 from a provider",
);

// ============================================================
// 4. THE TRANSCRIPT WAS WRITTEN BACK
// ============================================================
console.log("\n== 4 — the turn was persisted to Supabase ==");
await page.waitForTimeout(3_000);
const written = await page.evaluate(async (conversationId) => {
  const mod = await import("/src/og/integrations/supabase/client.ts");
  const client = mod.getSupabase();
  if (!client) return { error: "no client" };
  const { data, error } = await client
    .from("messages")
    .select("id,role,text")
    .eq("conversation_id", conversationId);
  return { rows: data ?? [], error: error?.message ?? null };
}, threadId);
check(
  "both sides of the turn are in the messages table",
  Array.isArray(written.rows) && written.rows.length >= 2,
  written.error ?? `${written.rows?.length ?? 0} row(s)`,
);

console.log("\n== console errors ==");
for (const line of [...new Set(consoleErrors)].slice(0, 20)) console.log(`  ${line}`);
console.log("== failed requests ==");
for (const line of [...new Set(failedRequests)].slice(0, 20)) console.log(`  ${line}`);

await page.screenshot({ path: `artifacts/og-chat-signed-in-${Date.now()}.png` });
await browser.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
