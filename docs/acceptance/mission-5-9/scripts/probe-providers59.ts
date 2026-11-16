/**
 * MISSION 5.9 — PROVIDER CAPABILITY PROBES
 *
 * One provider/model combination at a time, small payloads, no key ever
 * written to the output. Each probe answers the only question that
 * matters for this mission: does THIS model, on THIS account, return a
 * completion, and does it return a genuine `tool_calls` array when
 * offered a tool? Documentation and configuration are not accepted as
 * evidence here.
 *
 *   bunx tsx docs/acceptance/mission-5-9/scripts/probe-providers59.ts
 */

import { loadEnvFilesIntoProcess } from "../../../../plugins/loadEnvFiles.ts";

const filled = loadEnvFilesIntoProcess(["GROQ_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"]);

const GROQ_ENDPOINT = process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1";
const OPENROUTER_ENDPOINT =
  process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

const TIME_TOOL = {
  type: "function" as const,
  function: {
    name: "current_utc_time",
    description: "Return the current UTC time as an ISO-8601 string. Call this whenever the user asks what time it is.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

interface Probe {
  provider: string;
  model: string;
  kind: "text" | "tool";
  at: string;
  httpStatus?: number;
  contentType?: string;
  ok: boolean;
  classification: string;
  finishReason?: string;
  textPreview?: string;
  toolCalls?: Array<{ name: string; arguments: string }>;
  usage?: unknown;
  bodyKeys?: string[];
  errorPreview?: string;
  notes?: string[];
}

const probes: Probe[] = [];

async function call(
  url: string,
  key: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; contentType: string; raw: string; json: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", raw, json };
}

function record(probe: Probe, result: Awaited<ReturnType<typeof call>>, notes: string[] = []): Probe {
  const choice = result.json?.choices?.[0];
  probe.httpStatus = result.status;
  probe.contentType = result.contentType;
  probe.bodyKeys = result.json ? Object.keys(result.json).slice(0, 12) : [];
  probe.finishReason = choice?.finish_reason;
  probe.usage = result.json?.usage;
  probe.textPreview = typeof choice?.message?.content === "string" ? choice.message.content.slice(0, 200) : undefined;
  const calls = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];
  if (calls.length > 0) {
    probe.toolCalls = calls
      .slice(0, 3)
      .map((entry: any) => ({ name: String(entry?.function?.name ?? ""), arguments: String(entry?.function?.arguments ?? "").slice(0, 300) }));
  }
  probe.ok = result.status >= 200 && result.status < 300;
  if (!probe.ok) {
    probe.classification = result.status === 401 || result.status === 403 ? "AUTHENTICATION_FAILED" : result.status === 404 ? "MODEL_UNAVAILABLE" : result.status === 429 ? "CAPACITY_LIMITED" : "UNKNOWN";
    probe.errorPreview = result.raw.slice(0, 300);
  } else if (probe.kind === "tool") {
    probe.classification = calls.length > 0 ? "TOOL_CALLING_VERIFIED" : "COMPLETION_VERIFIED_NO_TOOL_CALL";
    if (calls.length === 0) notes.push("a real completion came back but the model answered without a tool call");
  } else {
    probe.classification = choice ? "COMPLETION_VERIFIED" : "MALFORMED_COMPLETION";
  }
  probe.notes = notes;
  probes.push(probe);
  console.log(`[${probe.provider}/${probe.model}/${probe.kind}] ${probe.classification}${probe.httpStatus ? ` (HTTP ${probe.httpStatus})` : ""}`);
  return probe;
}

/* ------------------------------ GROQ ------------------------------ */

const groqKey = process.env.GROQ_API_KEY?.trim() ?? "";
if (!groqKey) {
  probes.push({ provider: "groq", model: GROQ_MODEL, kind: "text", at: new Date().toISOString(), ok: false, classification: "UNCONFIGURED" });
} else {
  const at = () => new Date().toISOString();
  const textProbe: Probe = { provider: "groq", model: GROQ_MODEL, kind: "text", at: at(), ok: false, classification: "UNKNOWN" };
  try {
    const r = await call(`${GROQ_ENDPOINT}/chat/completions`, groqKey, {
      model: GROQ_MODEL,
      max_tokens: 24,
      messages: [{ role: "user", content: "Reply with the single word: ready." }],
    });
    record(textProbe, r);
  } catch (error) {
    textProbe.classification = "UNREACHABLE";
    textProbe.errorPreview = String(error).slice(0, 200);
    probes.push(textProbe);
  }

  const toolProbe: Probe = { provider: "groq", model: GROQ_MODEL, kind: "tool", at: at(), ok: false, classification: "UNKNOWN" };
  try {
    const r = await call(`${GROQ_ENDPOINT}/chat/completions`, groqKey, {
      model: GROQ_MODEL,
      max_tokens: 128,
      tools: [TIME_TOOL],
      tool_choice: "auto",
      messages: [{ role: "user", content: "What time is it right now? Use the tool rather than guessing." }],
    });
    record(toolProbe, r);
  } catch (error) {
    toolProbe.classification = "UNREACHABLE";
    toolProbe.errorPreview = String(error).slice(0, 200);
    probes.push(toolProbe);
  }
}

/* --------------------------- OPENROUTER --------------------------- */

const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
const modelCatalog: { at: string; httpStatus?: number; total?: number; freeToolCapable?: Array<{ id: string; context?: number }>; errorPreview?: string } = {
  at: new Date().toISOString(),
};
if (!openrouterKey) {
  modelCatalog.errorPreview = "OPENROUTER_API_KEY not present in this runtime";
} else {
  try {
    const response = await fetch(`${OPENROUTER_ENDPOINT}/models`, {
      headers: { authorization: `Bearer ${openrouterKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    modelCatalog.httpStatus = response.status;
    const json: any = await response.json().catch(() => null);
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    modelCatalog.total = data.length;
    // Free AND advertising tool support in supported_parameters.
    modelCatalog.freeToolCapable = data
      .filter((entry) => {
        const promptCost = Number(entry?.pricing?.prompt ?? "1");
        const completionCost = Number(entry?.pricing?.completion ?? "1");
        const supportsTools = Array.isArray(entry?.supported_parameters)
          ? entry.supported_parameters.includes("tools")
          : false;
        return promptCost === 0 && completionCost === 0 && supportsTools;
      })
      .map((entry) => ({ id: String(entry.id), context: entry?.context_length }))
      .slice(0, 12);
  } catch (error) {
    modelCatalog.errorPreview = String(error).slice(0, 200);
  }
}
console.log(
  `[openrouter/catalog] HTTP ${modelCatalog.httpStatus ?? "n/a"}, ${modelCatalog.total ?? 0} model(s), ` +
    `${modelCatalog.freeToolCapable?.length ?? 0} free tool-capable`,
);

/* Probe at most two free tool-capable candidates, one at a time. */
const candidates = (modelCatalog.freeToolCapable ?? []).slice(0, 2);
for (const candidate of candidates) {
  const probe: Probe = { provider: "openrouter", model: candidate.id, kind: "tool", at: new Date().toISOString(), ok: false, classification: "UNKNOWN" };
  try {
    const r = await call(
      `${OPENROUTER_ENDPOINT}/chat/completions`,
      openrouterKey,
      {
        model: candidate.id,
        max_tokens: 128,
        tools: [TIME_TOOL],
        tool_choice: "auto",
        messages: [{ role: "user", content: "What time is it right now? Use the tool rather than guessing." }],
      },
      { "HTTP-Referer": "https://lelu.local", "X-Title": "LELU mission 5.9 capability probe" },
    );
    record(probe, r);
  } catch (error) {
    probe.classification = "UNREACHABLE";
    probe.errorPreview = String(error).slice(0, 200);
    probes.push(probe);
  }
}

/* Anthropic is POLICY_DISABLED: recorded, never called. */
probes.push({
  provider: "anthropic",
  model: "(not called)",
  kind: "tool",
  at: new Date().toISOString(),
  ok: false,
  classification: "POLICY_DISABLED",
  notes: ["Anthropic is excluded from this mission by policy; no request was made."],
});

const out = {
  mission: "5.9",
  capturedAt: new Date().toISOString(),
  envFilesLoaded: filled,
  credentialsPresent: {
    GROQ_API_KEY: Boolean(groqKey),
    OPENROUTER_API_KEY: Boolean(openrouterKey),
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  },
  anthropicPolicy: "POLICY_DISABLED — never called in this mission",
  groqModelTested: GROQ_MODEL,
  openrouterCatalog: modelCatalog,
  probes,
  verdict: probes.some((probe) => probe.classification === "TOOL_CALLING_VERIFIED")
    ? "TOOL_CALLING_VERIFIED"
    : probes.some((probe) => probe.classification === "COMPLETION_VERIFIED")
      ? "TEXT_ONLY"
      : "NO_LIVE_CAPACITY",
};

const destination = new URL("../02-provider-capability.json", import.meta.url);
const { writeFileSync } = await import("node:fs");
writeFileSync(destination, JSON.stringify(out, null, 2) + "\n");
console.log(`\nwrote ${destination.pathname}`);
console.log(`verdict: ${out.verdict}`);
