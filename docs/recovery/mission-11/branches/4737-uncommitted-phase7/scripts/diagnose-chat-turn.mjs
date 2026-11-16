/**
 * LÉLU — ONE REAL TURN, FULLY INSTRUMENTED
 *
 * Not an assertion suite: a diagnostic. It signs in with a real account,
 * seeds two durable facts, opens the Genesis dialogue surface and sends one
 * recall question while recording every provider call, every console line and
 * every uncaught error. Used to find out what actually happens to a turn
 * instead of inferring it.
 *
 * Usage: node scripts/diagnose-chat-turn.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:3000";
const QUESTION = "Lélu, what do you remember about me? Where did we leave off?";

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const timeline = [];
const stamp = () => new Date().toISOString().slice(11, 23);
page.on("console", (m) => {
  const text = m.text();
  if (m.type() === "error" || /Lélu|Orchestrator|provider|memory|Supabase/i.test(text)) {
    timeline.push(`${stamp()} console.${m.type()} ${text.slice(0, 400)}`);
  }
});
page.on("pageerror", (e) => timeline.push(`${stamp()} PAGEERROR ${e.name}: ${e.message}`.slice(0, 600)));
page.on("requestfailed", (r) => {
  if (/localhost|arxiv/.test(r.url())) return;
  timeline.push(`${stamp()} REQFAILED ${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`);
});
page.on("response", async (r) => {
  const url = r.url();
  if (!/supabase\.co|\/api\/model\//.test(url)) return;
  if (r.status() < 400) return;
  let body = "";
  try {
    body = (await r.text()).slice(0, 300);
  } catch {
    body = "(unreadable)";
  }
  timeline.push(`${stamp()} HTTP ${r.status()} ${url.slice(0, 140)} :: ${body}`);
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3_000);

const account = await page.evaluate(
  async ({ email, password }) => {
    const mod = await import("/src/core/persistence/SupabasePersistence.ts");
    const persistence = mod.default.getInstance();
    await persistence.initialize();
    const result = await persistence.signUpWithEmail(email, password);
    for (let i = 0; i < 25; i += 1) {
      if (persistence.getAuthState().session) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return { error: result.error, userId: persistence.getAuthState().session?.user?.id ?? null };
  },
  { email: `diag.${Date.now()}@example.com`, password: `Diag-${Date.now()}` },
);
console.log("account:", JSON.stringify(account));
if (!account.userId) {
  await browser.close();
  process.exit(2);
}

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4_000);

await page.evaluate(
  async ({ userId }) => {
    const { getSupabase } = await import("/src/og/integrations/supabase/client.ts");
    const client = getSupabase();
    const now = new Date().toISOString();
    await client.from("memory_items").upsert([
      {
        id: `diag-name-${Date.now()}`,
        user_id: userId,
        category: "identity",
        memory_type: "user",
        prompt: "What is my name?",
        response: "My name is Zephyrine Vale. I own this LÉLU workspace.",
        keywords: ["name", "zephyrine"],
        context: {},
        importance: 0.95,
        confidence: 0.95,
        successful_uses: 0,
        failed_uses: 0,
        created_at: now,
        updated_at: now,
      },
      {
        id: `diag-project-${Date.now()}`,
        user_id: userId,
        category: "project",
        memory_type: "user",
        prompt: "What are we building?",
        response: "We are building the Halo Array, segment 7; the inertial ring comes after.",
        keywords: ["halo", "array"],
        context: {},
        importance: 0.9,
        confidence: 0.9,
        successful_uses: 0,
        failed_uses: 0,
        created_at: now,
        updated_at: now,
      },
    ]);
  },
  { userId: account.userId },
);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(10_000);

await page.locator('button[aria-label="LÉLU"]').first().click();
await page.waitForTimeout(2_000);

const input = page.locator('textarea[placeholder*="Type instructions"]').first();
await input.fill(QUESTION);
await input.press("Enter");

const readThread = () =>
  page.evaluate(async () => {
    const store = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const active = store.getActive();
    return {
      activeId: store.getActiveId(),
      messages: (active?.messages ?? []).map((m) => `${m.role}: ${String(m.text).slice(0, 400)}`),
      painted: (document.querySelector("[data-lelu-dialogue-scroll]")?.textContent ?? "").trim().slice(0, 600),
    };
  });

const deadline = Date.now() + 150_000;
let thread = await readThread();
while (Date.now() < deadline) {
  await page.waitForTimeout(2_000);
  thread = await readThread();
  const hasAssistant = thread.messages.some((m) => m.startsWith("assistant:") && m.length > 30);
  if (hasAssistant) break;
}

console.log("\n--- stored thread ---");
console.log(JSON.stringify(thread, null, 1));
console.log("\n--- painted dialogue ---");
console.log(thread.painted || "(nothing painted)");
console.log("\n--- timeline ---");
for (const line of timeline) console.log(line);
console.log("\n--- toasts ---");
const toasts = await page.evaluate(() =>
  [...document.querySelectorAll("[data-sonner-toast], .toaster, li")]
    .map((node) => (node.textContent ?? "").trim())
    .filter(Boolean)
    .slice(0, 10),
);
console.log(JSON.stringify(toasts));

await page.screenshot({ path: `artifacts/diagnose-turn-${Date.now()}.png` });
await browser.close();
