/**
 * LÉLU — SIGNED IN, GENESIS SCENE, REAL MEMORY, REAL PROVIDER
 *
 * The owner talks through the Genesis dialogue surface ("/"), not only the OG
 * chat. This runs the whole path there, with a real Supabase account, real
 * `memory_items` rows written under RLS, and a real provider call:
 *
 *   1. ask a plain recall question ("what do you remember about me, where did
 *      we leave off") — the exact shape that used to be answered by the local
 *      composer instead of the API;
 *   2. assert the reply came from a provider (HTTP 200 on the model route),
 *      cites both seeded facts, and is not the spliced "Your name is My name
 *      is …" phrasing;
 *   3. assert the scene actually painted the reply, and that a follow-up turn
 *      keeps the thread.
 *
 * Usage: node scripts/verify-genesis-signedin-chat.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:3000";
const QUESTION = "Lélu, what do you remember about me? Where did we leave off?";
const FOLLOW_UP = "And what is the very next step for the Halo Array?";

const FACT_NAME = "Zephyrine Vale";
const FACT_PROJECT = "Halo Array, segment 7";

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? `  — ${note}` : ""}`);
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors = [];
const consoleErrors = [];
const modelCalls = [];
page.on("pageerror", (error) => pageErrors.push(`${error.name}: ${error.message}`.slice(0, 400)));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
});
page.on("response", (response) => {
  if (/\/api\/model\/|api\.groq\.com|openrouter\.ai|anthropic\.com/.test(response.url())) {
    modelCalls.push({ url: response.url(), status: response.status() });
  }
});

// ------------------------------------------------------------
// 1. A real account, seeded through its own RLS-scoped client
// ------------------------------------------------------------
console.log("\n== 1 — account + Supabase memory ==");
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
    return {
      error: result.error,
      requiresConfirmation: result.requiresConfirmation,
      userId: persistence.getAuthState().session?.user?.id ?? null,
    };
  },
  { email: `lelu.genesis.${Date.now()}@example.com`, password: `Gen-${Date.now()}-${Math.random().toString(36).slice(2)}` },
);
console.log("  ..  sign-up:", JSON.stringify(account));
check("a real account with a session", Boolean(account.userId), account.error ?? account.userId ?? "none");
if (!account.userId) {
  console.log("\nBLOCKED: no session could be minted.");
  await browser.close();
  process.exit(2);
}

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4_000);

const seeded = await page.evaluate(
  async ({ userId, name, project }) => {
    const { getSupabase } = await import("/src/og/integrations/supabase/client.ts");
    const client = getSupabase();
    if (!client) return { errors: ["no supabase client"] };
    const now = new Date().toISOString();
    const { error } = await client.from("memory_items").upsert([
      {
        id: `gen-name-${Date.now()}`,
        user_id: userId,
        category: "identity",
        memory_type: "user",
        prompt: "What is my name?",
        response: `My name is ${name}. I own this LÉLU workspace.`,
        keywords: ["name", "zephyrine", "vale"],
        context: { source: "e2e" },
        importance: 0.95,
        confidence: 0.95,
        successful_uses: 0,
        failed_uses: 0,
        created_at: now,
        updated_at: now,
      },
      {
        id: `gen-project-${Date.now()}`,
        user_id: userId,
        category: "project",
        memory_type: "user",
        prompt: "What are we building?",
        response: `We are building the ${project}; segment 7 is locked first, then the inertial ring.`,
        keywords: ["halo", "array", "segment"],
        context: { source: "e2e" },
        importance: 0.9,
        confidence: 0.9,
        successful_uses: 0,
        failed_uses: 0,
        created_at: now,
        updated_at: now,
      },
    ]);
    return { errors: error ? [error.message] : [] };
  },
  { userId: account.userId, name: FACT_NAME, project: FACT_PROJECT },
);
check("memory rows written under RLS", (seeded.errors ?? []).length === 0, (seeded.errors ?? []).join(" | ") || "2 rows");

// ------------------------------------------------------------
// 2. Reload as a returning user; hydration must happen with no help
// ------------------------------------------------------------
console.log("\n== 2 — returning user ==");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(12_000);

const boot = await page.evaluate(async () => {
  const [persistenceMod, aiMod] = await Promise.all([
    import("/src/core/persistence/SupabasePersistence.ts"),
    import("/src/core/AIService.ts"),
  ]);
  const persistence = persistenceMod.default.getInstance();
  await persistence.initialize();
  const brain = aiMod.default.getInstance().runtime?.brain;
  const all = brain ? await brain.recallAll() : [];
  return {
    connected: persistence.isConnected(),
    status: persistence.getStatus(),
    memoryCount: all.length,
    seeds: all.filter((m) => /zephyrine|halo array/i.test(String(m.response))).length,
  };
});
console.log("  ..  boot:", JSON.stringify(boot));
check("persistence connected after reload", boot.connected, `status=${boot.status}`);
check("Supabase memories hydrated", boot.seeds >= 2, `${boot.seeds} of ${boot.memoryCount}`);

// The dialogue surface is a dock panel, not an always-mounted window.
const textarea = page.locator('textarea[placeholder*="Type instructions"]').first();
if ((await textarea.count()) === 0) await page.locator('button[aria-label="LÉLU"]').first().click();
await textarea.waitFor({ state: "visible", timeout: 45_000 });

const readThread = () =>
  page.evaluate(async () => {
    const store = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const active = store.getActive();
    const messages = (active?.messages ?? []).map((m) => ({
      id: String(m.id ?? ""),
      role: m.role,
      text: String(m.text),
    }));
    const painted = (document.querySelector("[data-lelu-dialogue-scroll]")?.textContent ?? "").trim();
    return { messages, painted };
  });

/**
 * Send one turn and wait for a NEW assistant message, not "some reply exists".
 * Matching on a fresh message id is what distinguishes a second answer from
 * the first one still being on screen.
 */
const ask = async (question) => {
  const beforeIds = new Set((await readThread()).messages.map((m) => m.id));
  await textarea.fill(question);
  await textarea.press("Enter");
  const deadline = Date.now() + 150_000;
  let thread = await readThread();
  while (Date.now() < deadline) {
    await page.waitForTimeout(2_000);
    thread = await readThread();
    const fresh = thread.messages.filter(
      (m) => m.role === "assistant" && !beforeIds.has(m.id) && m.text.trim().length > 20,
    );
    if (fresh.length > 0) break;
  }
  const fresh = thread.messages.filter((m) => m.role === "assistant" && !beforeIds.has(m.id));
  const sent = thread.messages.some((m) => m.role === "user" && m.text.includes(question.slice(0, 24)));
  return { reply: fresh.at(-1)?.text.trim() ?? "", thread, sent };
};

// ------------------------------------------------------------
// 3. The recall question
// ------------------------------------------------------------
console.log("\n== 3 — the recall question ==");
const first = await ask(QUESTION);
console.log(`\n[reply]\n${first.reply || "(nothing)"}\n`);
check("she replied", first.reply.length > 20, first.reply ? `${first.reply.length} chars` : "no reply in 150s");
check(
  "the reply is not a raw engine error",
  !/is not an object|is not a function|undefined is not|cannot read propert|evaluating/i.test(first.reply),
  first.reply.slice(0, 160),
);
check(
  "the reply is not the spliced local phrasing",
  !/your name is my name is|you're working on we are/i.test(first.reply),
  first.reply.slice(0, 160),
);
check("she used the seeded identity fact", /zephyrine/i.test(first.reply), first.reply.slice(0, 200));
check(
  "she used the seeded project fact",
  /halo[\s\u00a0]+array/i.test(first.reply) && /segment[\s\u00a0]+(?:7|seven)/i.test(first.reply),
  first.reply.slice(0, 240),
);

const served = modelCalls.filter((call) => call.status === 200);
check(
  "a real provider served the turn",
  served.length > 0,
  served.map((c) => c.url.replace(BASE, "").slice(0, 80)).join(", ") || `no provider 200 (calls: ${modelCalls.length})`,
);

// The scene paints her line progressively; give the typing a moment, then
// require the answer to be visible — a stored reply that never renders reads
// to the user as "she did not respond".
let painted = "";
const paintDeadline = Date.now() + 25_000;
while (Date.now() < paintDeadline) {
  await page.waitForTimeout(1_500);
  painted = (await readThread()).painted;
  if (/zephyrine|halo/i.test(painted)) break;
}
check("the reply is visible in the scene", /zephyrine|halo/i.test(painted), painted.slice(0, 160) || "(empty)");

// ------------------------------------------------------------
// 4. A follow-up turn keeps the thread
// ------------------------------------------------------------
console.log("\n== 4 — follow-up turn ==");
const second = await ask(FOLLOW_UP);
console.log(`\n[follow-up reply]\n${second.reply || "(nothing)"}\n`);
check("the follow-up was actually sent", second.sent, second.sent ? "user turn stored" : "user turn missing");
check("a second turn also replies", second.reply.length > 20, second.reply ? `${second.reply.length} chars` : "no reply");
check("the follow-up is a new answer", second.reply.length > 20 && second.reply !== first.reply, second.reply === first.reply ? "identical to turn 1" : "fresh message");
check(
  "the follow-up is not a raw engine error",
  !/is not an object|is not a function|undefined is not|cannot read propert|evaluating/i.test(second.reply),
  second.reply.slice(0, 160),
);
check("the follow-up keeps the project thread", /halo|segment|ring/i.test(second.reply), second.reply.slice(0, 200));

console.log("\n== page errors ==");
for (const line of [...new Set(pageErrors)].slice(0, 10)) console.log(`  ${line}`);
console.log("== console errors ==");
for (const line of [...new Set(consoleErrors)].slice(0, 10)) console.log(`  ${line}`);
check("no uncaught page error", pageErrors.length === 0, pageErrors[0] ?? "none");

await page.screenshot({ path: `artifacts/genesis-signedin-${Date.now()}.png` });
await browser.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
