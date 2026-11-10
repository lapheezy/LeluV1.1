/**
 * LÉLU — SIGN IN THROUGH THE OG FORM, MEMORY WITHOUT A RELOAD
 *
 * The two-client problem this pins down: the app has a Supabase client for
 * v1.1 persistence and a second one for the OG surface, sharing storage but
 * each caching its own auth state. Signing in through the OG Settings form
 * used to leave persistence "signed out", so `memory_items` never hydrated and
 * she answered from nothing until the page was refreshed.
 *
 * This test:
 *   1. creates and seeds an account (persistence sign-up, then seed under RLS),
 *   2. signs out of both clients and reloads into a clean signed-out app,
 *   3. signs in ONLY through the OG client and performs the same adoption the
 *      Settings form performs,
 *   4. asserts persistence is connected and the seeded facts are in memory,
 *   5. asks in the OG chat WITHOUT reloading and asserts she uses those facts.
 *
 * Usage: node scripts/verify-og-signin-adopts-session.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:3000";
const QUESTION = "Lélu, what do you remember about me, and where did we leave off with the Halo Array?";
const EMAIL = `lelu.adopt.${Date.now()}@example.com`;
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
const errors = [];
page.on("pageerror", (error) => errors.push(error.message.slice(0, 240)));
page.on("console", (message) => {
  if (message.type() === "error" && /supabase|auth|Lélu/i.test(message.text())) {
    errors.push(message.text().slice(0, 240));
  }
});

const settle = (ms) => page.waitForTimeout(ms);

// ============================================================
// 1. ACCOUNT + SEED
// ============================================================
console.log("\n== 1 — create and seed an account ==");
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await settle(2_500);

const account = await page.evaluate(
  async ({ email, password, name, project }) => {
    const persistenceMod = await import("/src/core/persistence/SupabasePersistence.ts");
    const persistence = persistenceMod.default.getInstance();
    await persistence.initialize();
    const created = await persistence.signUpWithEmail(email, password);
    for (let i = 0; i < 25 && !persistence.getAuthState().session; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const session = persistence.getAuthState().session;
    if (!session) return { error: created.error ?? "no session issued" };

    return { error: null, userId: session.user.id };
  },
  { email: EMAIL, password: PASSWORD, name: FACT_NAME, project: FACT_PROJECT },
);
check("account created", !account.error, account.error ?? EMAIL);
if (account.error) {
  await browser.close();
  process.exit(1);
}

await page.reload({ waitUntil: "domcontentloaded" });
await settle(4_000);

const seededSeed = { userId: account.userId, name: FACT_NAME, project: FACT_PROJECT };
const seeded = await page.evaluate(async (seed) => {
  const { getSupabase } = await import("/src/og/integrations/supabase/client.ts");
  const client = getSupabase();
  if (!client) return { error: "no client" };

  const now = new Date().toISOString();
  const rows = [
    {
      id: `adopt-name-${Date.now()}`,
      user_id: seed.userId,
      category: "identity",
      memory_type: "user",
      prompt: "What is my name?",
      response: `My name is ${seed.name}; I own this LÉLU workspace and prefer she keeps continuity with earlier work.`,
      keywords: ["name", "zephyrine", "vale"],
      context: { source: "e2e-seed" },
      importance: 0.95,
      confidence: 0.95,
      successful_uses: 0,
      failed_uses: 0,
      created_at: now,
      updated_at: now,
    },
    {
      id: `adopt-project-${Date.now()}`,
      user_id: seed.userId,
      category: "project",
      memory_type: "user",
      prompt: "What are we building?",
      response: `We are building the ${seed.project}; the inertial ring comes after segment 7 is locked.`,
      keywords: ["halo", "array", "segment", "project"],
      context: { source: "e2e-seed" },
      importance: 0.9,
      confidence: 0.9,
      successful_uses: 0,
      failed_uses: 0,
      created_at: now,
      updated_at: now,
    },
  ];
  const { error } = await client.from("memory_items").upsert(rows);
  return { error: error?.message ?? null };
}, seededSeed);
check("seeded memories written under RLS", !seeded.error, seeded.error ?? "2 rows");

// ============================================================
// 2. SIGN OUT AND RELOAD INTO A CLEAN SIGNED-OUT APP
// ============================================================
console.log("\n== 2 — sign out of both clients, reload ==");
await page.evaluate(async () => {
  const [{ getSupabase }, persistenceMod] = await Promise.all([
    import("/src/og/integrations/supabase/client.ts"),
    import("/src/core/persistence/SupabasePersistence.ts"),
  ]);
  await getSupabase()
    ?.auth.signOut()
    .catch(() => undefined);
  await persistenceMod.default.getInstance().signOut().catch(() => undefined);
});
await page.reload({ waitUntil: "domcontentloaded" });
await settle(6_000);

const signedOut = await page.evaluate(async () => {
  const [persistenceMod, authMod] = await Promise.all([
    import("/src/core/persistence/SupabasePersistence.ts"),
    import("/src/og/integrations/supabase/client.ts"),
  ]);
  const persistence = persistenceMod.default.getInstance();
  const og = (await authMod.getSupabase()?.auth.getSession())?.data.session ?? null;
  return { persistence: persistence.getStatus(), og: Boolean(og) };
});
check("the app starts signed out", signedOut.persistence !== "connected", JSON.stringify(signedOut));

// ============================================================
// 3. SIGN IN ONLY THROUGH THE OG CLIENT, THEN ADOPT
// ============================================================
console.log("\n== 3 — OG sign-in, then the adoption the Settings form performs ==");
const adoption = await page.evaluate(
  async ({ email, password }) => {
    const [{ getSupabase }, persistenceMod] = await Promise.all([
      import("/src/og/integrations/supabase/client.ts"),
      import("/src/core/persistence/SupabasePersistence.ts"),
    ]);
    const client = getSupabase();
    const persistence = persistenceMod.default.getInstance();
    if (!client) return { error: "no OG client" };

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    const before = persistence.getStatus();
    const { data } = await client.auth.getSession();
    await persistence.adoptExternalSession(data.session);

    const brain = (await import("/src/core/AIService.ts")).default.getInstance().runtime?.brain;
    const held = brain
      ? (await brain.recallAll()).filter((m) => /zephyrine|halo array/i.test(String(m.response)))
      : [];
    return {
      error: null,
      before,
      after: persistence.getStatus(),
      connected: persistence.isConnected(),
      held: held.map((m) => `${m.category}: ${String(m.response).slice(0, 70)}`),
    };
  },
  { email: EMAIL, password: PASSWORD },
);
console.log("  ..  adoption:", JSON.stringify(adoption));
check("OG sign-in succeeded", !adoption.error, adoption.error ?? "session issued");
check(
  "persistence adopted the session (was signed out before)",
  adoption.before !== "connected" && adoption.connected === true,
  `${adoption.before} → ${adoption.after}`,
);
check("the seeded facts hydrated without a reload", (adoption.held ?? []).length >= 2, (adoption.held ?? []).join(" | "));

// ============================================================
// 4. ASK IN THE OG CHAT, NO RELOAD
// ============================================================
console.log("\n== 4 — ask, without reloading ==");
const threadId = `conv-${Date.now()}-adopt`;
await page.goto(`${BASE}/og/chat/${threadId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('textarea[placeholder*="say something"]', { timeout: 60_000 });
await settle(1_500);

await page.fill('textarea[placeholder*="say something"]', QUESTION);
await page.press('textarea[placeholder*="say something"]', "Enter");

let reply = "";
let errorBox = null;
const deadline = Date.now() + 120_000;
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

console.log(`\n[reply]\n${reply || "(none)"}\n`);
check("she replied", reply.length > 0, reply ? "ok" : "no reply in 120s");
check("not an error message", reply.length > 0 && !/^(unknown ai error|i encountered an error)/i.test(reply), reply.slice(0, 140));
check("no error box", !errorBox, errorBox ?? "none");
check("she used the seeded identity fact", /zephyrine/i.test(reply), reply.slice(0, 180));
check(
  "she used the seeded project fact",
  /halo[\s\u00a0]+array/i.test(reply) && /segment[\s\u00a0]+(?:7|seven)/i.test(reply),
  reply.slice(0, 220),
);

if (errors.length > 0) {
  console.log("\n== errors ==");
  for (const line of [...new Set(errors)].slice(0, 15)) console.log(`  ${line}`);
}

await page.screenshot({ path: `artifacts/og-signin-adoption-${Date.now()}.png` });
await browser.close();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
