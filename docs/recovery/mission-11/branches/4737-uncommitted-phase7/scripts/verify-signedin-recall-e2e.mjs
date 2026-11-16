/**
 * LÉLU — SIGNED IN, SUPABASE MEMORY, REAL CHAT
 *
 * Reproduces the owner's exact state without needing their password or a
 * service-role key:
 *
 *   1. creates a genuine Supabase account through the app's own sign-up
 *      (email confirmation is off in this project, so a real JWT is issued),
 *   2. seeds that account's own rows through the browser client — the same
 *      RLS-scoped path the app writes with — including a durable fact and a
 *      prior conversation with a decision in it,
 *   3. reloads so BOTH Supabase clients boot from the stored session, just
 *      like a returning user,
 *   4. asks, in the real chat panel, what she remembers and where we left off,
 *   5. asserts the reply uses the seeded facts, that no error box appeared,
 *      and that a real provider served the turn.
 *
 * Usage: node scripts/verify-signedin-recall-e2e.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:3000";
const QUESTION =
  "Lélu, what do you remember about me, and where did we leave off with the Halo Array? Please be specific.";

const EMAIL = `lelu.e2e.${Date.now()}@example.com`;
const PASSWORD = `E2e-${Math.random().toString(36).slice(2)}-${Date.now()}`;

const FACT_NAME = "Zephyrine Vale";
const FACT_PROJECT = "Halo Array, segment 7";

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? `  — ${note}` : ""}`);
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleLines = [];
const failedRequests = [];
const modelCalls = [];
page.on("console", (message) => {
  const text = message.text();
  if (message.type() === "error" || /\[Lélu\]|\[og chat\]|Supabase|timed out|degraded|MemoryBridge/i.test(text)) {
    consoleLines.push(`${message.type()}: ${text.slice(0, 300)}`);
  }
});
page.on("pageerror", (error) => consoleLines.push(`pageerror: ${error.message.slice(0, 300)}`));
page.on("requestfailed", (request) =>
  failedRequests.push(`${request.method()} ${request.url().slice(0, 140)} :: ${request.failure()?.errorText}`),
);
page.on("response", (response) => {
  const url = response.url();
  if (/\/api\/model\//.test(url)) modelCalls.push({ url, status: response.status() });
  if (/supabase\.co\/(rest|auth)/.test(url) && response.status() >= 400) {
    failedRequests.push(`HTTP ${response.status()} ${url.slice(0, 160)}`);
  }
});

// ============================================================
// 1. A REAL ACCOUNT, THROUGH THE APP'S OWN SIGN-UP
// ============================================================
console.log("\n== 1 — a real signed-in account ==");
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2_500);

const authorised = await page.evaluate(
  async ({ email, password }) => {
    const mod = await import("/src/core/persistence/SupabasePersistence.ts");
    const persistence = mod.default.getInstance();
    await persistence.initialize();
    const result = await persistence.signUpWithEmail(email, password);
    // onAuthStateChange applies the new session asynchronously.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (persistence.getAuthState().session) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const state = persistence.getAuthState();
    return {
      error: result.error,
      requiresConfirmation: result.requiresConfirmation,
      status: persistence.getStatus(),
      userId: state.session?.user?.id ?? null,
      email: state.email,
    };
  },
  { email: EMAIL, password: PASSWORD },
);
console.log("  ..  sign-up:", JSON.stringify(authorised));
check("a real Supabase account was created", !authorised.error, authorised.error ?? EMAIL);
if (authorised.requiresConfirmation) {
  console.log("\nBLOCKED: this project now requires email confirmation, so no session can be minted headlessly.");
  await browser.close();
  process.exit(2);
}
check("the account holds a real session", Boolean(authorised.userId), authorised.userId ?? "none");

// The OG client is a SECOND GoTrueClient on the same storage, created at boot
// before this session existed. Reloading is what a returning user does, and it
// is what gives that client the token; seeding before that would be an
// unauthenticated write rejected by RLS, not a memory test.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4_000);

// ============================================================
// 2. SEED THIS ACCOUNT'S OWN ROWS THROUGH THE BROWSER CLIENT
// ============================================================
console.log("\n== 2 — seed the account's own Supabase rows (RLS path) ==");
const seeded = await page.evaluate(
  async ({ userId, name, project }) => {
    const { getSupabase } = await import("/src/og/integrations/supabase/client.ts");
    const client = getSupabase();
    if (!client) return { error: "Supabase is not configured in this build" };

    const now = new Date().toISOString();
    const memories = [
      {
        id: `e2e-name-${Date.now()}`,
        user_id: userId,
        category: "identity",
        memory_type: "user",
        prompt: "What is my name?",
        response: `My name is ${name}. I own this LÉLU workspace and I prefer she keeps the thread of what we already built.`,
        keywords: ["name", "zephyrine", "vale", "owner"],
        context: { source: "e2e-seed" },
        importance: 0.95,
        confidence: 0.95,
        successful_uses: 0,
        failed_uses: 0,
        created_at: now,
        updated_at: now,
      },
      {
        id: `e2e-project-${Date.now()}`,
        user_id: userId,
        category: "project",
        memory_type: "user",
        prompt: "What are we building?",
        response: `We are building the ${project}: the inertial ring and its control lattice come after segment 7 is locked.`,
        keywords: ["halo", "array", "segment", "project", "building"],
        context: { source: "e2e-seed" },
        importance: 0.9,
        confidence: 0.9,
        successful_uses: 0,
        failed_uses: 0,
        created_at: now,
        updated_at: now,
      },
    ];

    const conversationId = `e2e-prior-${Date.now()}`;
    const conversation = {
      id: conversationId,
      user_id: userId,
      title: "Halo Array — where we left off",
      project_id: null,
      metadata: {},
      created_at: now,
      updated_at: now,
    };
    const messages = [
      {
        id: `e2e-m1-${Date.now()}`,
        user_id: userId,
        conversation_id: conversationId,
        role: "user",
        text: "Let's lock segment 7 of the Halo Array before anything else.",
        created_at: now,
      },
      {
        id: `e2e-m2-${Date.now()}`,
        user_id: userId,
        conversation_id: conversationId,
        role: "assistant",
        text: "Agreed. Segment 7 of the Halo Array gets locked first; the inertial ring waits until it is stable.",
        created_at: now,
      },
    ];

    const write = async (table, rows) => {
      const { error } = await client.from(table).upsert(rows);
      return error?.message ?? null;
    };

    const errors = [
      await write("memory_items", memories),
      await write("conversations", [conversation]),
      await write("messages", messages),
    ].filter(Boolean);

    return { errors, conversationId };
  },
  { userId: authorised.userId, name: FACT_NAME, project: FACT_PROJECT },
);
check("the memory rows were written under RLS", (seeded.errors ?? []).length === 0, (seeded.errors ?? []).join(" | ") || "2 memories, 1 prior conversation");

// ============================================================
// 3. RELOAD — BOTH CLIENTS BOOT FROM THE STORED SESSION
// ============================================================
console.log("\n== 3 — reload, as a returning user does ==");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(12_000);

const boot = await page.evaluate(async () => {
  const [persistenceMod, aiMod] = await Promise.all([
    import("/src/core/persistence/SupabasePersistence.ts"),
    import("/src/core/AIService.ts"),
  ]);
  const persistence = persistenceMod.default.getInstance();
  await persistence.initialize();
  const ai = aiMod.default.getInstance();
  const brain = ai.runtime?.brain;
  const all = brain ? await brain.recallAll() : [];
  const conversations = (await import("/src/core/multichat/MultiChatStore.ts")).default
    .getInstance()
    .listAll();
  return {
    status: persistence.getStatus(),
    connected: persistence.isConnected(),
    email: persistence.getAuthState().email ?? null,
    configError: persistence.getAuthState().configError ?? null,
    memoryCount: all.length,
    heldSeeds: all
      .filter((m) => /zephyrine|halo array/i.test(String(m.response)))
      .map((m) => `${m.category}: ${String(m.response).slice(0, 80)}`),
    conversations: conversations.filter((c) => /halo array/i.test(c.title) || /halo array/i.test(JSON.stringify(c.messages))).length,
  };
});
console.log("  ..  boot:", JSON.stringify(boot));
check("v1.1 persistence connected after reload", boot.connected, `status=${boot.status}${boot.configError ? ` configError=${boot.configError}` : ""}`);
check("the seeded memories hydrated into the runtime", boot.heldSeeds.length >= 2, boot.heldSeeds.join(" | ") || `${boot.memoryCount} memories, none of them the seeds`);
check("the prior conversation hydrated", boot.conversations >= 1, `${boot.conversations} matching conversation(s)`);

// ============================================================
// 4. ASK THE REAL CHAT PANEL
// ============================================================
console.log("\n== 4 — the conversation the owner says does not happen ==");
const threadId = `conv-${Date.now()}-e2e`;
await page.goto(`${BASE}/og/chat/${threadId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('textarea[placeholder*="say something"]', { timeout: 60_000 });
await page.waitForTimeout(2_000);

const started = Date.now();
await page.fill('textarea[placeholder*="say something"]', QUESTION);
await page.press('textarea[placeholder*="say something"]', "Enter");

let reply = "";
let errorBox = null;
const deadline = Date.now() + 150_000;
while (Date.now() < deadline) {
  const snapshot = await page.evaluate(() => ({
    prose: [...document.querySelectorAll(".prose")]
      .map((node) => ((node.innerText || node.textContent) ?? "").trim())
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
  "the reply is an answer, not an error",
  reply.length > 0 &&
    !/^(unknown ai error|i encountered an error|⚠️)/i.test(reply) &&
    !/all ai providers are unreachable|offline mode right now|something went wrong/i.test(reply),
  reply.slice(0, 160),
);
check("no chat error box was shown", !errorBox, errorBox ?? "none");
check("she used the seeded identity fact", /zephyrine/i.test(reply), reply.slice(0, 200));
// NBSP: models often emit "segment\u00a07"; that is the same fact.
check(
  "she used the seeded project fact",
  /halo[\s\u00a0]+array/i.test(reply) && /segment[\s\u00a0]+(?:7|seven)/i.test(reply),
  reply.slice(0, 240),
);

// ============================================================
// 5. THE PROVIDER PATH AND THE WRITE-BACK
// ============================================================
console.log("\n== 5 — provider and persistence ==");
const served = modelCalls.filter((call) => /chat\/completions|messages$/.test(call.url) && call.status === 200);
check("a real provider served the turn", served.length > 0, served.map((c) => c.url.replace(BASE, "")).join(", ") || "no provider 200");

await page.waitForTimeout(3_000);
const written = await page.evaluate(async (conversationId) => {
  const { getSupabase } = await import("/src/og/integrations/supabase/client.ts");
  const client = getSupabase();
  if (!client) return { error: "no client" };
  const { data, error } = await client
    .from("messages")
    .select("id,role,text")
    .eq("conversation_id", conversationId);
  return { rows: data ?? [], error: error?.message ?? null };
}, threadId);
check(
  "both sides of the turn were written back to Supabase",
  Array.isArray(written.rows) && written.rows.length >= 2,
  written.error ?? `${written.rows?.length ?? 0} row(s)`,
);

console.log("\n== console lines ==");
for (const line of [...new Set(consoleLines)].slice(0, 25)) console.log(`  ${line}`);
console.log("== failed requests ==");
for (const line of [...new Set(failedRequests)].slice(0, 25)) console.log(`  ${line}`);

await page.screenshot({ path: `artifacts/signedin-recall-e2e-${Date.now()}.png`, fullPage: false });
await browser.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
