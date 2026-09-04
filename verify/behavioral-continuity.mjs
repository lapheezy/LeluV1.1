/**
 * BEHAVIORAL CONTINUITY TEST
 *
 * Not a unit test and not a UI test. This drives the real app through
 * the exact conversations in the brief and inspects what the REAL
 * stores hold afterwards.
 *
 * A: project acquisition, reference resolution, modification, execution
 * B: new session — "continue the pendant collection"
 * C: correction — current authoritative value vs historical memory
 * D: pronoun chain
 * E: orientation with a live conversation AND live project context
 */
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:5173";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const log = (m) => console.error(`[behave] ${m}`);

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(15000);
log("booted");

const bootstrap = `
  const [{ default: AIService }, { default: ProjectStore }, { default: KvStore },
         { default: SelfStudyEngine }] = await Promise.all([
    import("/src/core/AIService.ts"),
    import("/src/core/projects/ProjectStore.ts"),
    import("/src/core/storage/KvStore.ts"),
    import("/src/core/cognition/SelfStudyEngine.ts"),
  ]);
`;

/* ---------------- A: acquisition → reference → modify → execute ------- */
const partA = await page.evaluate(async () => {
  const [{ default: AIService }, { default: ProjectStore }, { default: KvStore }, { default: SelfStudyEngine }] =
    await Promise.all([
      import("/src/core/AIService.ts"),
      import("/src/core/projects/ProjectStore.ts"),
      import("/src/core/storage/KvStore.ts"),
      import("/src/core/cognition/SelfStudyEngine.ts"),
    ]);
  const ai = AIService.getInstance();
  await ai.initialize();
  SelfStudyEngine.getInstance().stop();
  try { KvStore.getInstance().remove("lelu.conversation.v1"); } catch { /* ignore */ }

  const store = ProjectStore.getInstance();
  const before = store.list().map((p) => p.id);

  const out = { turns: [] };
  const say = async (text, label) => {
    const reply = await ai.chat(text);
    const fresh = store.list().filter((p) => !before.includes(p.id));
    out.turns.push({
      label,
      sent: text,
      provider: reply.provider,
      reply: (reply.text ?? "").slice(0, 400),
      newProjects: fresh.map((p) => ({
        id: p.id,
        name: p.name,
        objective: (p.objective ?? "").slice(0, 200),
        knownFacts: p.context ?? "",
        tasks: p.actionableTasks ?? [],
        status: p.status,
      })),
    });
    return reply;
  };

  await say("I have an idea for a pendant collection.", "A1 acquire");
  await say("Use platinum.", "A2 attribute");
  await say("Make the collection larger and add three designs.", "A3 modify");
  await say("Start working on it.", "A4 execute");

  const created = store.list().filter((p) => !before.includes(p.id));
  out.finalProjects = created.map((p) => ({
    id: p.id,
    name: p.name,
    objective: p.objective,
    knownFacts: p.context,
    tasks: p.actionableTasks ?? [],
    items: (p.items ?? []).length,
    status: p.status,
  }));
  out.projectIds = created.map((p) => p.id);
  return out;
});
log(`A done — ${partA.finalProjects.length} project(s)`);

/* ---------------- B: new session, continue ---------------------------- */
const partB = await page.evaluate(async () => {
  const [{ default: AIService }, { default: ProjectStore }, { default: KvStore }] = await Promise.all([
    import("/src/core/AIService.ts"),
    import("/src/core/projects/ProjectStore.ts"),
    import("/src/core/storage/KvStore.ts"),
  ]);
  // A NEW conversation: wipe the short-term window, keep durable state.
  // This is the "start a new session" case.
  KvStore.getInstance().remove("lelu.conversation.v1");
  const ai = AIService.getInstance();
  const reply = await ai.chat("Continue the pendant collection.");
  return {
    conversationWasCleared: true,
    reply: (reply.text ?? "").slice(0, 500),
    provider: reply.provider,
    projectsStillPresent: ProjectStore.getInstance().list().map((p) => ({ name: p.name, facts: p.context })),
  };
});
log("B done");

/* ---------------- C: correction vs history ---------------------------- */
const partC = await page.evaluate(async () => {
  const [{ default: AIService }, { default: KvStore }] = await Promise.all([
    import("/src/core/AIService.ts"),
    import("/src/core/storage/KvStore.ts"),
  ]);
  KvStore.getInstance().remove("lelu.conversation.v1");
  const ai = AIService.getInstance();
  const out = {};
  await ai.chat("Use rose gold.");
  await ai.chat("Actually, platinum supersedes rose gold.");
  out.current = (await ai.chat("What metal are we using?")).text?.slice(0, 400) ?? "";
  out.historical = (await ai.chat("What did I originally say?")).text?.slice(0, 400) ?? "";
  out.recall = (await ai.recall("metal rose gold platinum")).map((r) => r.response.slice(0, 200));
  return out;
});
log("C done");

/* ---------------- D: pronoun chain ------------------------------------ */
const partD = await page.evaluate(async () => {
  const [{ default: AIService }, { default: ProjectStore }, { default: KvStore }] = await Promise.all([
    import("/src/core/AIService.ts"),
    import("/src/core/projects/ProjectStore.ts"),
    import("/src/core/storage/KvStore.ts"),
  ]);
  KvStore.getInstance().remove("lelu.conversation.v1");
  const ai = AIService.getInstance();
  const store = ProjectStore.getInstance();
  const before = store.list().map((p) => p.id);
  const out = { turns: [] };
  for (const [text, label] of [
    ["I want a pendant collection.", "D1"],
    ["Make it larger.", "D2 pronoun 'it'"],
    ["Add three more designs.", "D3 implicit"],
    ["Use that metal.", "D4 unresolvable reference"],
    ["Start working on it.", "D5"],
  ]) {
    const reply = await ai.chat(text);
    out.turns.push({ label, sent: text, provider: reply.provider, reply: (reply.text ?? "").slice(0, 320) });
  }
  out.projects = store.list().filter((p) => !before.includes(p.id)).map((p) => ({
    name: p.name, facts: p.context, tasks: p.actionableTasks ?? [],
  }));
  return out;
});
log("D done");

/* ---------------- E: orientation with live state ---------------------- */
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("genesis-show-surface", { detail: { panel: "chat" } }));
});
await page.waitForTimeout(1200);

const VIEWPORTS = [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "phone portrait", width: 390, height: 844 },
  { name: "tablet landscape", width: 1180, height: 820 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone portrait", width: 390, height: 844 },
];
const rotations = [];
for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(800);
  rotations.push({
    viewport: `${vp.name} ${vp.width}x${vp.height}`,
    ...(await page.evaluate(async () => {
      const [{ default: ProjectStore }, { default: KvStore }, { default: AIService }] = await Promise.all([
        import("/src/core/projects/ProjectStore.ts"),
        import("/src/core/storage/KvStore.ts"),
        import("/src/core/AIService.ts"),
      ]);
      const stored = KvStore.getInstance().get("lelu.conversation.v1");
      const textarea = document.querySelector("textarea");
      return {
        conversationTurns: stored?.turns?.length ?? 0,
        projects: ProjectStore.getInstance().list().length,
        memoryRecords: (await AIService.getInstance().getMemories(200)).length,
        chatInputPresent: Boolean(textarea),
        chatInputValuePreserved: textarea ? textarea.value : null,
        navButtons: document.querySelectorAll("button").length,
      };
    })),
    errorsSoFar: pageErrors.length,
  });
}
log("E done");

console.log(JSON.stringify({ partA, partB, partC, partD, rotations, pageErrors }, null, 2));
await browser.close();
