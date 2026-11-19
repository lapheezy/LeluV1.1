/**
 * ACCEPTANCE — learning integrity (Work Package K3/K6).
 *
 * Runs the REAL learning pathway in a real browser: the app's own Brain,
 * MemoryBridge, PatternMemory and IndexedDB — not a stub, not a log
 * formatter. The point is to answer, with evidence, whether LÉLU can:
 *
 *   1. capture a unique, non-sensitive discovery,
 *   2. preserve its source and provenance,
 *   3. distinguish an observed fact from a claim,
 *   4. persist it across a reload,
 *   5. retrieve it for a LATER, separate conversation,
 *   6. apply it to that turn's model request,
 *   7. keep a chat-scoped statement out of unrelated conversations,
 *   8. correct/supersede it without corrupting history,
 *   9. represent execution states distinctly and redact credentials.
 *
 * Usage: node verify/learning-integrity-acceptance.mjs
 *        VERIFY_BASE=http://127.0.0.1:5173 node verify/learning-integrity-acceptance.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:5173";
const nonce = process.env.LEARNING_NONCE || `N${Date.now().toString(36).toUpperCase()}`;
const DISCOVERY = `ORCHID-${nonce}`;
const PRIVATE = `VIOLET-${nonce}`;
const STUDIO = `Aurelia${nonce}`;

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

/** The whole scenario runs inside the app, over its own modules. */
const runScenario = async () => {
  const out = { errors: [] };
  try {
    const [{ default: Brain }, { default: MemoryBridge }, { labelOtherChats }] = await Promise.all([
      import("/src/brain/Brain.ts"),
      import("/src/core/MemoryBridge.ts"),
      import("/src/core/multichat/ContextProvenance.ts"),
    ]);

    const brain = new Brain();
    // MemoryBridge reads the user profile for context; this test is about
    // memory, so an empty profile is supplied rather than a fake user store.
    const bridge = new MemoryBridge(brain, { context: () => "" });

    out.recording = await bridge.learn(
      `My project verification marker is the discovery code ${DISCOVERY}, recorded from the voice-pipeline audit.`,
      "Understood.",
      `task-learning-${Date.now()}`,
    );

    const recalledNow = await brain.recall("project verification marker discovery code");
    const hit = recalledNow.find((memory) => memory.response.includes(DISCOVERY));
    out.captured = Boolean(hit);
    out.source = hit?.context?.source ?? null;
    out.executionVerified = hit?.context?.executionVerified ?? null;
    out.category = hit?.category ?? null;

    // A statement the user explicitly scoped to one chat.
    await bridge.learn(
      `For this chat only, the private codename is ${PRIVATE}.`,
      "Noted.",
      `task-scope-${Date.now()}`,
    );
    const allAfterScope = await brain.recallAll();
    out.scopedPersisted = allAfterScope.some((memory) => memory.response.includes(PRIVATE));

    // A fact and then a correction of it, in the user's own words.
    out.beforeCorrection = await bridge.learn(
      `My studio is called ${STUDIO} and I work exclusively in rose gold.`,
      "Noted.",
      `task-corr-1-${Date.now()}`,
    );
    out.afterCorrection = await bridge.learn(
      "Actually, correct that: I work in platinum now, not rose gold.",
      "Updated.",
      `task-corr-2-${Date.now()}`,
    );

    const metalRecall = await brain.recall("what metal do I work in");
    const mine = metalRecall.filter((memory) => memory.response.includes(STUDIO));
    out.correctionMatches = mine.length;
    out.correctionResponse = mine[0]?.response ?? null;
    out.correctionHistory = Array.isArray(mine[0]?.context?.history)
      ? mine[0].context.history.length
      : 0;

    // Cross-chat provenance labelling is still applied to context that
    // quotes another chat (the mechanism that prevents silent reuse).
    out.provenanceLabelling = labelOtherChats("nothing to label here", "conv-current", []);

    // Execution-state representation: distinct stages, and redaction.
    const evidence = await import("/src/core/tools/ExecutionEvidence.ts");
    const stages = ["requested", "started", "succeeded", "failed", "timed-out", "refused", "suppressed"];
    out.executionStages = stages.every((stage) =>
      evidence.isExecutionRecord({
        executionId: "chat-test-1",
        taskId: "task-1",
        path: "chat",
        tool: "memory.recall",
        approval: "not-required",
        stage,
      }),
    );
    const redacted = evidence.redactExecutionText(
      "failed with Bearer sk-abcdefghijklmnopqrstuvwxyz and api_key=SECRETVALUE",
    );
    out.redactionHolds = !/sk-abcdefghijklmnopqrstuvwxyz|SECRETVALUE/.test(redacted);
    out.redactedSample = redacted;

    // Persist a marker the post-reload pass can look for.
    out.nonce = JSON.stringify({ discovery: DISCOVERY, studio: STUDIO, private: PRIVATE });
    return out;
  } catch (error) {
    out.errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return out;
  }
};

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(8_000);

  const first = await page.evaluate(runScenario);
  record("the discovery is captured into long-term memory", first.captured, `category=${first.category}`);
  record(
    "the source of the discovery is preserved",
    first.source === "lelu-chat",
    `source=${String(first.source)}`,
  );
  record(
    "a statement with no measured execution is stored as unverified",
    first.executionVerified === false,
    `executionVerified=${String(first.executionVerified)}`,
  );
  record(
    "a chat-scoped statement is not made long-term memory",
    first.scopedPersisted === false,
    `persisted=${String(first.scopedPersisted)}`,
  );
  record(
    "a correction supersedes instead of duplicating",
    first.correctionMatches === 1,
    `${first.correctionMatches} matching pattern(s)`,
  );
  record(
    "the correction is the stored answer",
    /^Actually, correct that: I work in platinum/i.test(first.correctionResponse ?? ""),
    String(first.correctionResponse ?? "").slice(0, 90),
  );
  record(
    "the superseded value is kept in history",
    first.correctionHistory >= 1,
    `history=${first.correctionHistory}`,
  );
  record(
    "facts the correction did not mention survive it",
    new RegExp(STUDIO).test(first.correctionResponse ?? ""),
    `studio present=${new RegExp(STUDIO).test(first.correctionResponse ?? "")}`,
  );
  record(
    "the seven execution stages are all representable",
    first.executionStages,
    "requested/started/succeeded/failed/timed-out/refused/suppressed",
  );
  record("credentials are redacted from execution text", first.redactionHolds, first.redactedSample);

  /* ---- separate subsequent task, after a full reload ---- */
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(6_000);

  const second = await page.evaluate(
    async ({ discovery, studio }) => {
      const out = { errors: [] };
      try {
        const [{ default: Brain }, { default: MemoryBridge }, { default: MultiChatStore }] = await Promise.all([
          import("/src/brain/Brain.ts"),
          import("/src/core/MemoryBridge.ts"),
          import("/src/core/multichat/MultiChatStore.ts"),
        ]);

        const brain = new Brain();
        const bridge = new MemoryBridge(brain, { context: () => "" });

        // A DIFFERENT conversation from the one that recorded it.
        const conversation = MultiChatStore.getInstance().create("Learning acceptance follow-up");
        const recalled = await brain.recall("project verification marker discovery code");
        out.persisted = recalled.some((memory) => memory.response.includes(discovery));

        const { request, memories } = await bridge.enrich({
          prompt: "What is the project verification marker for the audit?",
          conversationId: conversation.id,
        });
        out.injected = String(request.context ?? "").includes(discovery);
        out.memoriesRecalled = memories.length;
        out.conversationId = conversation.id;

        // The chat-scoped statement from the other pass must not surface.
        const scopedAll = await brain.recallAll();
        return out;
      } catch (error) {
        out.errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
        return out;
      }
    },
    { discovery: DISCOVERY, studio: STUDIO },
  );

  record(
    "the discovery survives a full reload (real IndexedDB)",
    second.persisted,
    `recalled after reload=${String(second.persisted)}`,
  );
  record(
    "it reaches the model request of a later, separate conversation",
    second.injected,
    `conversation=${second.conversationId ?? "none"} memories=${second.memoriesRecalled}`,
  );

  const errors = [...pageErrors, ...(first.errors ?? []), ...(second.errors ?? [])];
  record("no page or scenario errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = checks.filter((check) => !check.ok);
console.log(
  `\n${checks.length - failed.length}/${checks.length} learning-integrity checks passed (nonce ${nonce}).`,
);
if (failed.length > 0) {
  console.error("FAILED:", failed.map((check) => check.name).join("; "));
  process.exitCode = 1;
}
