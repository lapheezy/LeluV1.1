/**
 * Session 3D — live model → studio lifecycle.
 *
 * Runs against an already-running dev server (default 127.0.0.1:3004).
 * The model call is real: the server's Anthropic broker attaches the key,
 * and the model chooses whether to call the real studio_create tool.
 * The tool call is dispatched to the same runtime endpoints the Studio
 * tool executor uses; nothing here fabricates a build or test result.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ORIGIN = process.env.STUDIO_ORIGIN ?? "http://127.0.0.1:3004";
const MODEL = process.env.STUDIO_MODEL ?? "claude-opus-5-5";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function post(route, body) {
  const response = await fetch(`${ORIGIN}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

const tools = [
  {
    name: "studio_create",
    description:
      "Scaffold a real website, application or game in the isolated studio on this runtime. " +
      "The application template includes a working Node backend and tests. Returns the real file count.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["website", "application", "game"] },
        name: { type: "string", description: "Human-readable project name." },
        dimension: { type: "string", enum: ["2d", "3d"] },
      },
      required: ["kind", "name"],
    },
  },
];

const messages = [
  {
    role: "user",
    content:
      "Build me a small application called Focus Ledger: a two-person task board where tasks can be " +
      "added and completed, with a real backend that persists them. Use the studio_create tool now. " +
      "Choose kind=application. Do not describe the plan instead of calling the tool.",
  },
];

const live = { rounds: [], model: null, text: "", toolCalls: [] };

for (let round = 1; round <= 3; round += 1) {
  const response = await post("/api/model/anthropic/messages", {
    model: MODEL,
    max_tokens: 2048,
    system:
      "You are LÉLU's engineering intelligence. You have a real studio tool that scaffolds projects on " +
      "this runtime. Call it when asked; never claim a tool result you were not given.",
    tools,
    messages,
  });
  live.rounds.push({ round, status: response.status });
  if (response.status !== 200 || !Array.isArray(response.data.content)) {
    check("live Anthropic model responds", false, `HTTP ${response.status}`);
    break;
  }
  check(`live Anthropic round ${round}`, true, `${response.data.model} · ${response.data.usage?.output_tokens ?? "?"} output tokens`);
  live.model = response.data.model;

  const text = response.data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (text) live.text = text;

  const calls = response.data.content.filter((block) => block.type === "tool_use");
  if (calls.length === 0) break;

  messages.push({ role: "assistant", content: response.data.content });

  for (const call of calls) {
    live.toolCalls.push({ name: call.name, args: call.input, id: call.id });
    let result;
    if (call.name === "studio_create") {
      result = await post("/api/studio/scaffold", call.input);
    } else {
      result = { status: 400, data: { ok: false, error: `unexpected tool ${call.name}` } };
    }
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result.data).slice(0, 4000),
          is_error: !result.data?.ok,
        },
      ],
    });
  }
}

check("the model chose a real studio tool", live.toolCalls.length > 0, live.toolCalls.map((call) => call.name).join(", ") || "no tool_use block");

const created = live.toolCalls.find((call) => call.name === "studio_create");
const slug = created ? String(created.args?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "";
check("the model supplied a project name", Boolean(slug), slug || "none");

let build = null;
let tests = null;
let preview = null;
if (slug) {
  const health = await post("/api/studio/health", {});
  check("studio runtime is live", health.data?.ok === true, health.data?.runtime ?? "no runtime");
  build = await post("/api/studio/build", { slug });
  check("the model-created project builds", build.data?.ok === true && build.data?.exitCode === 0, `${build.data?.bytes ?? 0} B, exit ${build.data?.exitCode}`);
  tests = await post("/api/studio/test", { slug });
  check("the model-created project's tests pass", tests.data?.ok === true && tests.data?.failed === 0, `${tests.data?.passed}/${tests.data?.passed + tests.data?.failed}`);
  const page = await fetch(`${ORIGIN}/api/studio/serve/${slug}/`);
  const html = await page.text();
  preview = { status: page.status, bytes: html.length, hasTitle: /<title>/i.test(html) };
  check("the model-created project is served live", page.status === 200 && html.length > 0, `HTTP ${page.status}, ${html.length} B`);
  check("the live preview is the built application, not a placeholder", /Focus Ledger|task/i.test(html), preview.hasTitle ? "title present" : "no title");
}

const results = {
  at: new Date().toISOString(),
  origin: ORIGIN,
  live,
  slug,
  build: build?.data ?? null,
  tests: tests?.data ?? null,
  preview,
  checks,
  passed: checks.filter((entry) => entry.ok).length,
  total: checks.length,
};

const dir = path.join("docs", "evidence", "session-3d", stamp);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.passed}/${results.total} checks passed. Evidence: ${dir}`);
process.exit(results.passed === results.total ? 0 : 1);
