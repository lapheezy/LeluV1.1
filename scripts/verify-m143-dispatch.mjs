/**
 * Mission 14.3 — real browser execution trace with a scripted model.
 *
 * The model is scripted. Everything after its `toolCalls` response is the
 * production path: ProviderResolver → tool discovery → authorization →
 * ToolDispatcher → real executor → tool result → next model request.
 *
 * Evidence labels: BROWSER, DISPATCH, LIVE (deterministic executors).
 * This does NOT claim remote-model reasoning.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000/";
const result = {
  mission: "M14.3",
  base: "4582382",
  startedAt: new Date().toISOString(),
  evidenceClass: ["BROWSER", "DISPATCH", "LIVE"],
  blockedExternal: [],
  consoleErrors: [],
  trace: null,
  reload: null,
  status: "ERROR",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") result.consoleErrors.push(msg.text().slice(0, 400));
});
page.on("pageerror", (err) => result.consoleErrors.push(`pageerror: ${err.message}`));
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
  result.blockedExternal.push(url.href);
  return route.abort();
});

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(8_000);

  result.trace = await page.evaluate(async () => {
    const providerMod = await import("/src/core/router/ProviderResolver.ts");
    const loggerMod = await import("/src/core/ExecutionLogger.ts");
    const projectMod = await import("/src/core/projects/ProjectStore.ts");
    const sandboxMod = await import("/src/core/engineering/SandboxFS.ts");
    const cosmosToolsMod = await import("/src/core/cosmos/CosmosTools.ts");
    const registryMod = await import("/src/core/tools/ToolRegistry.ts");
    const dispatchMod = await import("/src/core/tools/ToolDispatcher.ts");
    const navMod = await import("/src/core/cosmos/CosmosNavigation.ts");
    const autonomyMod = await import("/src/core/cognition/AutonomyGate.ts");
    const approvalMod = await import("/src/core/agentic/ApprovalGate.ts");
    const cognitionMod = await import("/src/core/cognition/CognitiveCore.ts");
    const authMod = await import("/src/core/engineering/EngineeringAuthorization.ts");

    // The app boot registers Cosmos tools; this is idempotent if already done.
    if (!registryMod.default.getInstance().get("cosmos.workspace")) {
      cosmosToolsMod.registerCosmosTools();
    }

    const offeredFor = (request) =>
      (request.tools || []).map((tool) => tool.name).filter(Boolean);

    function scriptedProvider(turns, label) {
      const requests = [];
      let index = 0;
      return {
        label,
        requests,
        provider: {
          name: `ScriptedNative-${label}`,
          priority: 1,
          enabled: true,
          timeout: 10_000,
          requiresApiKey: false,
          capabilities: ["chat"],
          supportsTools: true,
          initialize: async () => {},
          isAvailable: async () => true,
          health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
          canHandle: () => true,
          generate: async (request) => {
            requests.push({
              offered: offeredFor(request),
              messages: request.messages || [],
            });
            const turn = turns[Math.min(index, turns.length - 1)];
            index += 1;
            return {
              text: turn.text ?? "",
              provider: `scripted-${label}`,
              model: "scripted-1",
              processingTime: 1,
              ...(turn.toolCalls ? { toolCalls: turn.toolCalls } : {}),
            };
          },
        },
      };
    }

    function harness(provider, prompt) {
      return {
        request: {
          prompt,
          messages: [{ role: "user", content: prompt }],
          timestamp: Date.now(),
          allowTools: true,
        },
        started: Date.now(),
        logger: new loggerMod.default(),
        aiProviders: {
          available: async () => [provider],
          names: () => [provider.name],
          markFailure: () => {},
          markSuccess: () => {},
          all: () => [provider],
          get: () => provider,
        },
      };
    }

    const run = async (label, prompt, turns) => {
      const started = Date.now();
      const scripted = scriptedProvider(turns, label);
      const response = await new providerMod.default().execute(harness(scripted.provider, prompt));
      return {
        label,
        prompt,
        durationMs: Date.now() - started,
        response: response?.response?.text ?? response?.text ?? null,
        handled: response?.handled ?? null,
        requests: scripted.requests.map((request) => ({
          offered: request.offered,
          toolResults: (request.messages || [])
            .filter((message) => message.role === "tool")
            .map((message) => ({
              name: message.toolName ?? null,
              content: String(message.content ?? "").slice(0, 800),
            })),
        })),
      };
    };

    const projectPrompt = "Create a local project named M143 Scripted Dispatch and then report it.";
    const projectRun = await run("project", projectPrompt, [
      {
        toolCalls: [{
          id: "tc-project",
          name: "project_manage",
          arguments: { action: "create", name: "M143 Scripted Dispatch", objective: "Prove the model-to-tool path" },
        }],
      },
      { text: "The project was created through the dispatcher." },
    ]);
    const project = projectMod.default.getInstance().list().find((entry) => entry.name === "M143 Scripted Dispatch");

    const sandboxPrompt = "Write a local proof file in the sandbox, then read it back.";
    const sandboxRun = await run("sandbox", sandboxPrompt, [
      {
        toolCalls: [{
          id: "tc-write",
          name: "sandbox_write",
          arguments: { path: "m143/proof.txt", content: "local dispatch proof" },
        }],
      },
      {
        toolCalls: [{
          id: "tc-read",
          name: "sandbox_read",
          arguments: { path: "m143/proof.txt" },
        }],
      },
      { text: "The sandbox file was written and read back." },
    ]);
    const sandboxRead = sandboxMod.default.getInstance().read("m143/proof.txt");

    const cosmosPrompt = "Create a room in the cosmos called M143 Scripted Room.";
    const cosmosArgs = { action: "create-room", room: { label: "M143 Scripted Room" } };
    const cosmosRequest = await run("cosmos-request", cosmosPrompt, [
      {
        toolCalls: [{
          id: "tc-cosmos-request",
          name: "cosmos_workspace",
          arguments: cosmosArgs,
        }],
      },
      { text: "Waiting for approval." },
    ]);
    const approvalId = cosmosRequest.requests
      .flatMap((request) => request.toolResults)
      .map((result) => result.content.match(/approval-[0-9a-f-]+/)?.[0])
      .find(Boolean) ?? null;
    if (approvalId) approvalMod.default.getInstance().decide(approvalId, "approved");
    const cosmosRun = await run("cosmos-approved", cosmosPrompt, [
      {
        toolCalls: [{
          id: "tc-cosmos-approved",
          name: "cosmos_workspace",
          arguments: { ...cosmosArgs, approvalId },
        }],
      },
      { text: "The approved Cosmos room was created." },
    ]);
    const room = navMod.default.getInstance().getState().nodes.find((node) => node.label === "M143 Scripted Room");

    const cognitive = new cognitionMod.default();
    cognitive.observe("M143 knowledge persistence proof");
    const knowledgeNode = cognitive.graph.all().find((node) => node.label === "M143 knowledge persistence proof");
    if (knowledgeNode) cognitive.connect(knowledgeNode.id, knowledgeNode.id, "proves");

    const registry = registryMod.default.getInstance();
    // The engineering tools are honestly unavailable until the runtime probe
    // answers. Force that probe now, then expose project.apply solely to
    // exercise its separate authorization boundary.
    await registry.ensureAvailability(0);
    registry.updateAvailability("project.apply", true);
    const authPreflight = authMod.default.getInstance().preflight();
    const deniedTool = await dispatchMod.dispatchToolCall(
      { id: "tc-denied-apply", name: "project_apply", arguments: { workspace: "not-authorized" } },
      "m143-denial",
    );
    const invalidTool = await dispatchMod.dispatchToolCall(
      { id: "tc-invalid", name: "not_a_real_tool", arguments: {} },
      "m143-invalid",
    );
    const invalidArgs = await dispatchMod.dispatchToolCall(
      { id: "tc-invalid-args", name: "cosmos_workspace", arguments: { action: "open-workspace" } },
      "m143-invalid-args",
    );
    registry.updateAvailability("project.apply", false);

    return {
      autonomyLevel: autonomyMod.default.getInstance().getLevel(),
      project: {
        ...projectRun,
        persisted: Boolean(project),
        projectId: project?.id ?? null,
        toolResult: projectRun.requests.at(-1)?.toolResults?.[0]?.content ?? null,
      },
      sandbox: {
        ...sandboxRun,
        readBack: sandboxRead,
        toolResults: sandboxRun.requests.flatMap((request) => request.toolResults),
      },
      cosmos: {
        approvalId,
        pendingResult: cosmosRequest.requests.at(-1)?.toolResults?.[0]?.content ?? null,
        ...cosmosRun,
        roomCreated: Boolean(room),
        roomId: room?.id ?? null,
        roomLabel: room?.label ?? null,
        toolResult: cosmosRun.requests.at(-1)?.toolResults?.[0]?.content ?? null,
      },
      knowledge: {
        nodeCreated: Boolean(knowledgeNode),
        edgeCreated: cognitive.graph.connections().some((edge) => edge.relation === "proves"),
        revision: cognitive.graph.getRevision(),
      },
      denial: {
        authPreflight,
        projectApply: { ok: deniedTool.ok, content: deniedTool.content },
        unknownTool: { ok: invalidTool.ok, content: invalidTool.content },
        invalidArguments: { ok: invalidArgs.ok, content: invalidArgs.content },
      },
    };
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(8_000);
  result.reload = await page.evaluate(() => {
    const read = (key) => {
      try {
        return JSON.parse(localStorage.getItem(key) || "null");
      } catch {
        return null;
      }
    };
    const projects = read("lelu.projects.v1") || [];
    const nav = read("lelu.lelu.cosmos.nav.v1");
    const knowledge = read("lelu.lelu.cognition.knowledge.v1");
    return {
      projectStillPresent: projects.some((entry) => entry.name === "M143 Scripted Dispatch"),
      roomStillPresent: Boolean(nav?.rooms?.some((room) => room.label === "M143 Scripted Room")),
      knowledgeNodeStillPresent: Boolean(knowledge?.nodes?.some((node) => node.label === "M143 knowledge persistence proof")),
      knowledgeEdgeStillPresent: Boolean(knowledge?.edges?.some((edge) => edge.relation === "proves")),
      knowledgeRevision: knowledge?.revision ?? null,
      knowledgeProvenance: knowledge?.provenance ?? null,
      supabaseKeys: Object.keys(localStorage).filter((key) => /supabase/i.test(key)),
    };
  });

  const projectOk = result.trace.project.persisted && result.reload.projectStillPresent;
  const sandboxOk = result.trace.sandbox.readBack === "local dispatch proof";
  const cosmosOk = result.trace.cosmos.roomCreated && result.reload.roomStillPresent;
  const approvalOk = Boolean(result.trace.cosmos.approvalId) && /Created|Found/.test(result.trace.cosmos.toolResult || "");
  const knowledgeOk =
    result.trace.knowledge.nodeCreated &&
    result.trace.knowledge.edgeCreated &&
    result.reload.knowledgeNodeStillPresent &&
    result.reload.knowledgeEdgeStillPresent;
  const deniedOk =
    result.trace.denial.authPreflight.ready === false &&
    /No authenticated session/.test(result.trace.denial.authPreflight.reason) &&
    result.trace.denial.projectApply.ok === false &&
    /requires an explicit authorization/.test(result.trace.denial.projectApply.content) &&
    result.trace.denial.unknownTool.ok === false &&
    result.trace.denial.invalidArguments.ok === false;
  result.status = projectOk && sandboxOk && cosmosOk && approvalOk && knowledgeOk && deniedOk ? "PASS" : "FAIL";
  result.checks = { projectOk, sandboxOk, cosmosOk, approvalOk, knowledgeOk, deniedOk };
} catch (error) {
  result.status = "ERROR";
  result.error = error instanceof Error ? error.stack : String(error);
} finally {
  fs.writeFileSync("artifacts/m143-dispatch.json", JSON.stringify(result, null, 2));
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
