/**
 * LÉLU — REPRO: a partial stored profile kills the turn before the model
 *
 * The owner's report: chatting returns "undefined is not an object
 * (evaluating '…')" and never uses the facts in Supabase.
 *
 * Hydration copies `user_preferences.value` (jsonb) into the live profile
 * with no shape check. `UserManager.context()` then reads
 * `profile.preferences.favoriteColors.join(…)`, `profile.goals.join(…)`
 * and friends. A profile row written by an older build (or any partial
 * write) therefore throws inside `MemoryBridge.enrich` — BEFORE the
 * provider is called — so the turn dies with a raw engine message and no
 * memory answer. This script proves that ordering with a real account.
 *
 * Usage: node scripts/repro-malformed-profile.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:3000";
const QUESTION = "Lélu, what do you remember about me?";

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors = [];
const consoleErrors = [];
const modelCalls = [];
page.on("pageerror", (error) => pageErrors.push(`${error.name}: ${error.message}`.slice(0, 400)));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400));
});
page.on("response", (response) => {
  if (/\/api\/model\/|api\.groq\.com|openrouter\.ai|anthropic\.com/.test(response.url())) {
    modelCalls.push({ url: response.url(), status: response.status() });
  }
});

console.log("\n== account ==");
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
      userId: persistence.getAuthState().session?.user?.id ?? null,
    };
  },
  {
    email: `lelu.partial.${Date.now()}@example.com`,
    password: `Par-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  },
);
console.log("  ..  sign-up:", JSON.stringify(account));
if (!account.userId) {
  console.log("\nBLOCKED: no session could be minted.");
  await browser.close();
  process.exit(2);
}

console.log("\n== seed: one fact, and a PARTIAL profile (the real-world shape) ==");
const seeded = await page.evaluate(
  async ({ userId }) => {
    const { getSupabase } = await import("/src/og/integrations/supabase/client.ts");
    const client = getSupabase();
    if (!client) return { errors: ["no supabase client"] };
    const now = new Date().toISOString();
    const errors = [];

    const memory = await client.from("memory_items").upsert([
      {
        id: `partial-memory-${Date.now()}`,
        user_id: userId,
        category: "identity",
        memory_type: "user",
        prompt: "What is my name?",
        response: "My name is Aurelia Quill. I am building the Tidal Loom.",
        keywords: ["name", "aurelia", "quill", "tidal", "loom"],
        context: { source: "repro" },
        importance: 0.95,
        confidence: 0.95,
        successful_uses: 0,
        failed_uses: 0,
        created_at: now,
        updated_at: now,
      },
    ]);
    if (memory.error) errors.push(`memory_items: ${memory.error.message}`);

    // Deliberately the shape an older build wrote: a name and an empty
    // `preferences`, but none of the arrays this version dereferences.
    // `updatedAt` is in the future so hydration must accept it over the
    // fresh local profile — that is exactly what the code does today.
    const profile = await client.from("user_preferences").upsert([
      {
        user_id: userId,
        preference_key: "profile",
        value: {
          id: "primary-user",
          name: "Aurelia Quill",
          preferences: {},
          updatedAt: Date.now() + 3_600_000,
        },
        updated_at: now,
      },
    ]);
    if (profile.error) errors.push(`user_preferences: ${profile.error.message}`);

    return { errors };
  },
  { userId: account.userId },
);
console.log("  ..  write:", JSON.stringify(seeded));

console.log("\n== reload: hydration copies the partial profile in ==");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(10_000);

const profileState = await page.evaluate(async () => {
  const [persistenceMod, userMod] = await Promise.all([
    import("/src/core/persistence/SupabasePersistence.ts"),
    import("/src/core/user/UserManager.ts"),
  ]);
  const persistence = persistenceMod.default.getInstance();
  await persistence.initialize();
  const user = new userMod.default();
  await user.initialize();
  const profile = user.get();
  let context = null;
  let contextError = null;
  try {
    context = user.context();
  } catch (error) {
    contextError = `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`;
  }
  return {
    connected: persistence.isConnected(),
    profileShape: profile
      ? {
          name: profile.name,
          hasPreferences: Boolean(profile.preferences),
          favoriteColors: Array.isArray(profile.preferences?.favoriteColors),
          goals: Array.isArray(profile.goals),
          skills: Array.isArray(profile.skills),
          projects: Array.isArray(profile.projects),
        }
      : null,
    contextLength: context?.length ?? 0,
    contextError,
  };
});
console.log("  ..  profile:", JSON.stringify(profileState));

console.log("\n== the turn itself, through the live singleton the app uses ==");
const modelCallsBefore = modelCalls.length;
const turn = await page.evaluate(async (question) => {
  const ai = (await import("/src/core/AIService.ts")).default.getInstance();
  const liveUser = ai.user;
  let liveContextError = null;
  try {
    liveUser?.context();
  } catch (error) {
    liveContextError = `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`;
  }
  try {
    const result = await ai.chat(question);
    return {
      liveContextError,
      reply: typeof result?.text === "string" ? result.text : "",
      turnError: null,
    };
  } catch (error) {
    return {
      liveContextError,
      reply: "",
      turnError: `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
    };
  }
}, QUESTION);

console.log("  ..  live profile context:", JSON.stringify(turn.liveContextError));
console.log(`\n[reply]\n${turn.reply || "(nothing)"}\n`);
console.log("  ..  turn error:", JSON.stringify(turn.turnError));
console.log("  ..  model calls during the turn:", JSON.stringify(modelCalls.slice(modelCallsBefore)));
console.log("  ..  page errors:", JSON.stringify([...new Set(pageErrors)].slice(0, 6)));

const reply = turn.reply;
const rawError = /is not an object|is not a function|undefined is not|cannot read propert|evaluating|reading 'join'/i.test(
  `${reply} ${turn.turnError ?? ""}`,
);
const usedMemory = /aurelia|tidal loom/i.test(reply);
const served = modelCalls.slice(modelCallsBefore).some((call) => call.status === 200);
console.log(
  JSON.stringify(
    { profileContextThrows: Boolean(turn.liveContextError), turnFailed: Boolean(turn.turnError), replyIsRawEngineError: rawError, replyUsesSeededMemory: usedMemory, providerServedTurn: served },
    null,
    2,
  ),
);

// ------------------------------------------------------------
// The same account, typed into the visible dialogue surface
// ------------------------------------------------------------
console.log("\n== the visible surface ==");
let paintedReply = "";
try {
  const textarea = page.locator('textarea[placeholder*="Type instructions"]').first();
  if ((await textarea.count()) === 0) await page.locator('button[aria-label="LÉLU"]').first().click();
  await textarea.waitFor({ state: "visible", timeout: 45_000 });
  await textarea.fill(QUESTION);
  await textarea.press("Enter");

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2_000);
    const painted = await page.evaluate(
      () => (document.querySelector("[data-lelu-dialogue-scroll]")?.textContent ?? "").trim(),
    );
    if (/aurelia|tidal loom/i.test(painted)) {
      paintedReply = painted;
      break;
    }
    paintedReply = painted;
  }
} catch (error) {
  console.log("  ..  surface unavailable:", String(error?.message ?? error).slice(0, 160));
}
console.log(`\n[visible]\n${paintedReply.slice(-400) || "(nothing painted)"}\n`);
const paintedUsesMemory = /aurelia|tidal loom/i.test(paintedReply);
const paintedRawError = /is not an object|undefined is not|evaluating|reading 'join'/i.test(paintedReply);
console.log(
  JSON.stringify({ paintedUsesMemory, paintedRawError }, null, 2),
);

await page.screenshot({ path: `artifacts/repro-partial-profile-${Date.now()}.png` });
await browser.close();
process.exit(rawError && !served ? 1 : 0);
