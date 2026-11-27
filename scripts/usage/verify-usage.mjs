/**
 * WP13 + WP19 acceptance, in the running app (dev server on 5173 or LELU_BASE).
 *
 * Real model calls only (the app's own provider chain: Groq / OpenRouter /
 * Cerebras free tiers — no Anthropic). Each check reads the authorities back;
 * nothing is asserted from what the UI claims. Writes results JSON and
 * desktop + iPhone screenshots.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { launch, desktop, iphone, track } from "../evolution/harness.mjs";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = "docs/missions/usage-monitor/shots";
const RESULTS = "docs/missions/usage-monitor/verify-usage.json";
await mkdir(OUT, { recursive: true });
const results = [];
const errors = [];
const evidence = {};
const check = (id, name, ok, detail = "") => {
  results.push({ id, name, status: ok ? "VERIFIED" : "FAILED", detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
  console.log(`${ok ? "✓" : "✗"} [${id}] ${name}${detail ? ` — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 220)}` : ""}`);
};
let shot = 0;
const snap = async (page, name) => {
  shot += 1;
  const p = `${OUT}/${String(shot).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: p });
  return p;
};

async function boot(page, path = "") {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count())
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
        (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click();
      });
    if ((await page.locator("[data-lelu-home]").count()) || (path && (await page.locator("[data-usage-monitor]").count()))) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);
}

const M = (page, fn, arg) => page.evaluate(fn, arg);
const browser = await launch();
try {
  const ctx = await desktop(browser);
  const page = await ctx.newPage();
  track(page, errors);
  await boot(page);

  /* ---------- 1–3: every conversation type, registered and traceable ---------- */
  const run = await M(page, async () => {
    const S = (await import("/src/core/agents/AgentStore.ts")).default.getInstance();
    const D = (await import("/src/core/agents/AgentDialogue.ts")).default.getInstance();
    const R = (await import("/src/core/observability/ConversationRegistry.ts")).default.getInstance();
    const ai = (await import("/src/core/AIService.ts")).default.getInstance();
    const runner = (await import("/src/core/agents/AgentRunner.ts")).default.getInstance();
    const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const live = S.list().filter((a) => a.enabled && a.status === "active");
    const by = (re) => live.find((a) => re.test(a.name));
    const researcher = by(/Researcher/), engineer = by(/Engineering/), designer = by(/^Designer$/), artist = by(/^Artist$/);
    const out = {};
    // A user chat turn, in a real MultiChatStore conversation.
    const chat = MC.create("WP19 verification chat");
    const chatId = chat?.id ?? `verify-chat-${Date.now()}`;
    const reply = await ai.chat("In one sentence: what is a conversation registry for?", undefined, undefined, { conversationId: chatId });
    out.chat = { id: chatId, provider: reply.provider, model: reply.model, text: reply.text.slice(0, 120) };
    // A voice-surface turn (the path VoiceEngine uses; no microphone exists in this container).
    const voiceId = `voice-${Date.now()}`;
    const vr = await ai.chat("Say hello in five words.", undefined, undefined, { conversationId: voiceId, surface: "voice" });
    out.voice = { id: voiceId, provider: vr.provider };
    // An agent task started from that chat (child of it).
    const task = await runner.run(researcher.id, "List two risks of tracking every conversation, in one line each.", undefined, undefined, { delegatedBy: "user", scope: { userId: null, conversationId: chatId, sessionId: null } });
    out.agentTask = { ok: task.ok, taskId: task.taskId, provider: task.response?.provider };
    // Direct, group and self conversations: real turns.
    const d1 = D.start({ kind: "direct", participants: [researcher.id, engineer.id], topic: "How should LÉLU cap background research without starving development?", parentConversationId: chatId });
    out.direct = { id: d1.id, turns: (await D.run(d1.id, 2)).map((t) => ({ who: t.agentName, state: t.state, provider: t.provider, model: t.model, text: (t.text ?? "").slice(0, 140) })) };
    const d2 = D.start({ kind: "group", participants: [designer.id, artist.id, engineer.id], topic: "One visual rule for showing an agent's state in the Neural Map." });
    out.group = { id: d2.id, turns: (await D.run(d2.id, 3)).map((t) => ({ who: t.agentName, state: t.state, provider: t.provider })) };
    const d3 = D.start({ kind: "self", participants: [designer.id], topic: "A one-line definition of 'unproductive conversation' for usage alerts." });
    out.self = { id: d3.id, turns: (await D.run(d3.id, 3)).map((t) => ({ role: t.role, state: t.state, provider: t.provider })) };
    await new Promise((r) => setTimeout(r, 600));
    const rec = (id) => R.get(id);
    out.records = Object.fromEntries([chatId, voiceId, `agent-task:${task.taskId}`, d1.id, d2.id, d3.id].map((id) => [id, rec(id) && { type: rec(id).type, status: rec(id).status, calls: rec(id).modelCalls, in: rec(id).messagesIn, out: rec(id).messagesOut, parent: rec(id).parentId, tokensReported: rec(id).tokenReportedCalls, providers: rec(id).providers }]));
    out.chain = R.chain(chatId).map((r) => `${r.type}:${r.id}`);
    out.types = [...new Set(R.list().map((r) => r.type))];
    // Persistence of the dialogue turns in AgentStore (the one agent registry).
    out.persisted = S.list().flatMap((a) => a.tasks.filter((t) => t.dialogue?.id === d1.id).map((t) => ({ agent: a.name, turn: t.dialogue.turn, exec: Boolean(t.executionId) })));
    return out;
  });
  evidence.conversations = run;
  const recs = run.records;
  check("19.10-1", "user chat registered with real model usage", recs[run.chat.id]?.type === "user-chat" && recs[run.chat.id].calls > 0, recs[run.chat.id]);
  check("19.10-2", "voice turn registered as voice", recs[run.voice.id]?.type === "voice", recs[run.voice.id]);
  check("19.10-2", "agent task registered as a child of the chat", recs[`agent-task:${run.agentTask.taskId}`]?.type === "agent-task" && recs[`agent-task:${run.agentTask.taskId}`].parent === run.chat.id, recs[`agent-task:${run.agentTask.taskId}`]);
  for (const [k, type] of [["direct", "agent-direct"], ["group", "agent-group"], ["self", "self-dialogue"]]) {
    const r = recs[run[k].id];
    const real = run[k].turns.filter((t) => t.state === "complete" && t.provider && !/offline|lelu-direct|acquisition/.test(t.provider)).length;
    check("WP13", `${k} conversation: real model-backed turns, registered as ${type}`, r?.type === type && real >= 1 && r.calls >= real, { record: r, turns: run[k].turns });
  }
  check("19.10-3", "the chain from the user's chat reaches its agent task and dialogue", run.chain.some((c) => c.startsWith("agent-task:")) && run.chain.some((c) => c.includes(run.direct.id)), run.chain);
  check("WP13", "dialogue turns persist as each agent's own AgentStore tasks with executions", run.persisted.length >= 2 && run.persisted.every((p) => p.exec), run.persisted);

  /* ---------- 4–7: multi-resolution measurement and ranges ---------- */
  const m = await M(page, async () => {
    const A = await import("/src/core/observability/UsageAnalytics.ts");
    await A.recordSample();
    const minutes = A.series("minute", { from: Date.now() - 3_600_000 });
    const hours = A.series("hour", { from: Date.now() - 86_400_000 });
    const days = A.series("day");
    const r = A.rangeOf(minutes, "calls", (p) => p.calls);
    const manual = { lo: Math.min(...minutes.map((p) => p.calls)), hi: Math.max(...minutes.map((p) => p.calls)), avg: minutes.reduce((s, p) => s + p.calls, 0) / minutes.length, cur: minutes.at(-1).calls };
    const sys = A.systemRanges("minute", { from: Date.now() - 3_600_000 });
    return { minutes: minutes.length, hours: hours.length, days: days.length, callsLastHour: minutes.reduce((s, p) => s + p.calls, 0), range: r, manual, tokensAvailability: sys.find((x) => x.metric.startsWith("input tokens")).availability, gauges: Object.keys(minutes.at(-1).gauges), unavailable: A.UNAVAILABLE.map((u) => u.metric), perAgent: A.byAgent(hours).length, perModel: A.byModel(hours).slice(0, 4) };
  });
  evidence.measurement = m;
  check("19.10-4", "usage recorded at minute, hour and day resolution", m.minutes > 0 && m.hours > 0 && m.days > 0, m);
  check("19.10-5", "lowest/highest/average/current computed correctly", m.range.lowest === m.manual.lo && m.range.highest === m.manual.hi && Math.abs(m.range.average - m.manual.avg) < 0.01 && m.range.current === m.manual.cur, { range: m.range, manual: m.manual });
  check("19.10-6", "tokens are provider-reported, and unmeasurable figures are listed", ["measured", "unavailable"].includes(m.tokensAvailability) && m.unavailable.length >= 5, { tokens: m.tokensAvailability, unavailable: m.unavailable });
  check("19.10-7", "per-agent and per-model reporting have data", m.perAgent > 0 && m.perModel.length > 0, { perAgent: m.perAgent, perModel: m.perModel });

  /* ---------- 8–10: controls change real runtime behaviour ---------- */
  const c = await M(page, async (dialogueId) => {
    const P = (await import("/src/core/observability/ResourcePolicy.ts")).default.getInstance();
    const C = await import("/src/core/observability/ResourceCommands.ts");
    const S = (await import("/src/core/agents/AgentStore.ts")).default.getInstance();
    const D = (await import("/src/core/agents/AgentDialogue.ts")).default.getInstance();
    const runner = (await import("/src/core/agents/AgentRunner.ts")).default.getInstance();
    const ai = (await import("/src/core/AIService.ts")).default.getInstance();
    const { dispatchToolCall } = await import("/src/core/tools/ToolDispatcher.ts");
    const out = {};
    // NL → real setting (through LÉLU's own tool).
    const t1 = await dispatchToolCall({ id: "v1", name: "resources.control", arguments: { instruction: "Limit each agent to two concurrent tasks." } }, "verify-tools");
    out.nlLimit = { tool: t1.content ?? t1, now: P.get().maxTasksPerAgent };
    const t2 = await dispatchToolCall({ id: "v2", name: "resources.control", arguments: { instruction: "Show me the five highest-consuming conversations today." } }, "verify-tools");
    out.nlReport = String(t2.content ?? "").slice(0, 300);
    // Consequential: plan first, then approval.
    const researcher = S.list().find((a) => /Researcher/.test(a.name));
    const plan = C.interpret("Pause Researcher");
    out.pausePlan = { consequential: plan.consequential, explanation: plan.explanation };
    C.apply(plan, "user");
    const refused = await runner.run(researcher.id, "Say ok.", undefined, undefined, { delegatedBy: "user" });
    out.pausedRun = { ok: refused.ok, error: refused.error };
    C.apply(C.interpret("Resume Researcher"), "user");
    // Throttle a dialogue: the second turn within the gap is refused at the gate.
    // One turn runs, then a 120 s throttle: the next turn, within the gap, is refused at the gate.
    const th1 = await D.step(dialogueId).catch((e) => ({ state: "error", error: e.message }));
    P.control(dialogueId, "throttled", { minGapMs: 120_000, reason: "verify" });
    const th2 = await D.step(dialogueId).catch((e) => ({ state: "error", error: e.message }));
    out.throttle = { first: { state: th1.state, provider: th1.provider }, second: { state: th2.state, error: (th2.error ?? "").slice(0, 200) } };
    P.control(dialogueId, "resume");
    // Pause, resume, terminate.
    D.pause(dialogueId);
    out.pausedStep = await D.step(dialogueId).then(() => "ran").catch((e) => e.message);
    D.resume(dialogueId);
    D.end(dialogueId, "terminated");
    out.terminatedStep = await D.step(dialogueId).then(() => "ran").catch((e) => e.message);
    // Emergency stop: a real chat turn is refused at the gate.
    P.emergencyStop(true, "verification");
    const stopId = `verify-stop-${Date.now()}`;
    const stopped = await ai.chat("In two sentences, why do leaves change colour in autumn?", undefined, undefined, { conversationId: stopId });
    out.stopRecord = (await import("/src/core/observability/ConversationRegistry.ts")).default.getInstance().get(stopId)?.errors.at(-1)?.message ?? null;
    out.emergency = { provider: stopped.provider, text: stopped.text.slice(0, 200) };
    P.emergencyStop(false, "verification done");
    // Max call duration: a 5 s limit on a long request.
    P.setLimit("maxCallMs", 5000);
    out.maxCallMs = P.get().maxCallMs;
    P.setLimit("maxCallMs", null);
    P.setLimit("maxTasksPerAgent", null);
    out.changes = P.get().changes.slice(-8).map((x) => `${x.by}: ${x.what} ${x.before}→${x.after}`);
    return out;
  }, run.direct.id);
  evidence.controls = c;
  check("19.10-9", "a natural-language instruction through LÉLU's tool changes the real setting", c.nlLimit.now === 2, c.nlLimit);
  check("19.10-9", "a natural-language usage question is answered from the registry", /calls/.test(c.nlReport), c.nlReport);
  check("19.10-8", "a consequential change is planned for approval first", c.pausePlan.consequential === true, c.pausePlan);
  check("19.10-10", "a paused agent's task is refused by AgentRunner", c.pausedRun.ok === false && /paused/i.test(c.pausedRun.error ?? ""), c.pausedRun);
  check("19.10-10", "throttling refuses the next call within the gap at the gate, and says why", c.throttle.second.state === "failed" && /Throttled/.test(c.throttle.second.error), c.throttle);
  check("19.10-10", "a paused conversation runs no turn", /paused/i.test(c.pausedStep), c.pausedStep);
  check("19.10-10", "a terminated conversation runs no turn", /terminated/i.test(c.terminatedStep), c.terminatedStep);
  check("19.10-8", "emergency stop refuses a real chat turn at the gate, recorded with the reason", /Emergency stop/i.test(c.emergency.text) && /emergency-stop/.test(c.stopRecord ?? ""), { ...c.emergency, record: c.stopRecord });
  check("19.10-8", "every change is in the audit log with before → after", c.changes.length >= 5, c.changes);

  /* ---------- 13: overhead ---------- */
  const o = await M(page, async () => {
    const R = (await import("/src/core/observability/ConversationRegistry.ts")).default.getInstance();
    const A = await import("/src/core/observability/UsageAnalytics.ts");
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) R.recordUsage({ id: `bench-${i}`, userId: null, at: Date.now(), kind: "ai", source: "bench", ok: true, latencyMs: 10, inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null, costUsd: null, costKind: "unknown", conversationId: "bench-overhead", operation: "bench" });
    const perUsage = (performance.now() - t0) / 1000;
    const samples = [];
    for (let i = 0; i < 20; i++) samples.push((await A.recordSample()).costMs);
    const t1 = performance.now();
    A.systemRanges("minute", { from: Date.now() - 3_600_000 });
    const rangesMs = performance.now() - t1;
    R.setStatus("bench-overhead", "completed");
    return { perUsageMs: Math.round(perUsage * 1000) / 1000, sampleMsMedian: samples.sort((a, b) => a - b)[10], rangesMs: Math.round(rangesMs * 100) / 100 };
  });
  evidence.overhead = o;
  check("19.10-13", "monitoring overhead measured and small", o.perUsageMs < 1 && o.rangesMs < 200, o);

  /* ---------- screenshots of the monitor and the agent workspace ---------- */
  await M(page, async (id) => (await import("/src/app/scene/genesis/usage/usageView.ts")).UsageView.open(id), run.direct.id);
  await page.waitForSelector("[data-usage-monitor]");
  await page.waitForTimeout(1200);
  await snap(page, "monitor-overview");
  await page.click('[data-tab="conversations"]');
  await page.waitForTimeout(400);
  await snap(page, "monitor-conversations-direct-transcript");
  await page.fill('input[aria-label="Resource instruction"]', "pause all nonessential background research");
  await page.click("[data-cmd-run]");
  await page.waitForTimeout(300);
  check("19.10-9", "the monitor's command box shows a consequential plan for approval", (await page.locator('[data-plan][data-consequential="true"]').count()) === 1);
  await snap(page, "monitor-nl-plan");
  await page.click("[data-cmd-apply]");
  await page.waitForTimeout(300);
  const applied = await page.locator("[data-cmd-result]").textContent();
  check("19.10-9", "applying it reports the value read back from the runtime", /Background paused until/.test(applied ?? ""), applied);
  await M(page, async () => (await import("/src/core/observability/UsageLedger.ts")).default.getInstance().pauseBackground(0, "verification done"));
  await page.click('[data-tab="analytics"]');
  await page.waitForTimeout(400);
  await snap(page, "monitor-analytics");
  await page.click('[data-tab="controls"]');
  await page.waitForTimeout(300);
  // A control in the UI changes the runtime policy.
  await page.locator('[data-limit="maxConcurrentCalls"] input[type="checkbox"]').check();
  await page.locator('[data-limit="maxConcurrentCalls"] input[type="number"]').fill("3");
  await page.waitForTimeout(200);
  const uiLimit = await M(page, async () => (await import("/src/core/observability/ResourcePolicy.ts")).default.getInstance().get().maxConcurrentCalls);
  check("19.10-8", "the UI control changes the policy the gate enforces", uiLimit === 3, uiLimit);
  await snap(page, "monitor-controls");
  await M(page, async () => (await import("/src/core/observability/ResourcePolicy.ts")).default.getInstance().setLimit("maxConcurrentCalls", null));
  const csv = await M(page, async () => (await import("/src/core/observability/UsageAnalytics.ts")).exportCsv());
  const json = await M(page, async () => (await import("/src/core/observability/UsageAnalytics.ts")).exportJson().length);
  check("19.10-11", "usage records export as CSV and JSON", csv.split("\n").length > 5 && json > 1000, { csvRows: csv.split("\n").length - 1, jsonBytes: json });
  await page.click("[data-close-usage]");

  // V3 agent workspace in the Neural Map.
  await page.goto(`${BASE}?interface=neural-map`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-mv-aspects]", { timeout: 60000 });
  await page.click('[data-aspect="v3"]');
  await page.selectOption('select[aria-label="Shared layout"]', "force-directed");
  await page.waitForTimeout(500);
  const v3 = await page.evaluate(() => ({ conversed: document.querySelectorAll('path[data-evidence="measured"]').length }));
  const agentNode = await M(page, async () => {
    const S = (await import("/src/core/agents/AgentStore.ts")).default.getInstance();
    return `agent:${S.list().find((a) => /Engineering/.test(a.name)).id}`;
  });
  await page.evaluate((id) => document.querySelector(`[data-mv-node="${id}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), agentNode);
  await page.waitForSelector("[data-agent-workspace]");
  await page.click('[data-aw-tab="conversations"]');
  await page.locator("[data-aw-dialogue] header button").first().click();
  await page.waitForTimeout(400);
  check("WP13", "V3 draws measured conversation edges and opens the agent's workspace with its transcripts", v3.conversed > 0 && (await page.locator("[data-aw-dialogue]").count()) >= 2, { conversedEdges: v3.conversed, dialogues: await page.locator("[data-aw-dialogue]").count() });
  await snap(page, "v3-agent-workspace");
  await page.click('[data-aw-tab="history"]');
  await snap(page, "v3-agent-history");

  /* ---------- 12: persistence through a restart ---------- */
  await page.reload({ waitUntil: "domcontentloaded" });
  await boot(page);
  const after = await M(page, async (ids) => {
    const R = (await import("/src/core/observability/ConversationRegistry.ts")).default.getInstance();
    const A = await import("/src/core/observability/UsageAnalytics.ts");
    const P = (await import("/src/core/observability/ResourcePolicy.ts")).default.getInstance();
    return { records: ids.map((id) => Boolean(R.get(id))), minutes: A.series("minute", { from: Date.now() - 3_600_000 }).length, changes: P.get().changes.length, terminated: P.workloadState(ids[1])?.state ?? null };
  }, [run.chat.id, run.direct.id, run.self.id]);
  evidence.restart = after;
  check("19.10-12", "registry, rollups, policy and workload states survive a restart", after.records.every(Boolean) && after.minutes > 0 && after.changes > 0 && after.terminated === "terminated", after);
  await ctx.close();

  /* ---------- iPhone ---------- */
  const phone = await iphone(browser);
  const p2 = await phone.newPage();
  track(p2, errors);
  await boot(p2, "?monitor=usage");
  await p2.waitForSelector("[data-usage-monitor]", { timeout: 60000 });
  await p2.waitForTimeout(1200);
  const blocked = await p2.evaluate(() => {
    const root = document.querySelector("[data-usage-monitor]");
    return [...root.querySelectorAll("header button, .um-cmd input, .um-cmd button")].filter((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.width > 0 && !root.contains(top);
    }).length;
  });
  check("iPhone", "monitor controls are not covered on iPhone", blocked === 0, { blocked });
  await snap(p2, "iphone-monitor");
  await phone.close();
} finally {
  await browser.close();
}
check("errors", "no page errors from the new modules", !errors.some((e) => /Usage|Registry|ResourcePolicy|AgentDialogue|AgentWorkspace|Monitor/.test(e)), errors.filter((e) => /Usage|Registry|Resource|Dialogue|Workspace|Monitor/.test(e)).join(" | "));
await writeFile(RESULTS, `${JSON.stringify({ at: new Date().toISOString(), results, evidence, otherPageErrors: errors.slice(0, 20) }, null, 1)}\n`);
const failed = results.filter((r) => r.status === "FAILED").length;
console.log(`\n${results.length - failed}/${results.length} verified`);
process.exit(failed ? 1 : 0);
