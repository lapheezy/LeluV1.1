/**
 * User-facing tool-call boundary.
 * Providers may return XML/JSON invocation syntax instead of prose.
 * That transport format belongs to the router, never to the chat surface.
 */

const RAW_TOOL_PATTERNS = [
  /<dots_function_call\b/i,
  /<tool_call_start\b/i,
  /<tool_call_end\b/i,
  /<parameter\s+name\s*=/i,
  /function_call\s*\{/i,
  /"tool"\s*:\s*"(?:browser|research|instagram|search)"/i,
  /"name"\s*:\s*"(?:browser|researcher|search)"/i,
];

export function isRawToolMarkup(text: string): boolean {
  return RAW_TOOL_PATTERNS.some((pattern) => pattern.test(text)) || bareActionTool(text) !== null;
}

/** A tool id as models write it: dotted or snake (memory.recall, repo_acquire). */
const TOOL_ID = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)+$/i;
const NAME_KEYS = ["tool", "name", "action", "function", "tool_name"];
const ARG_KEYS = ["arguments", "args", "parameters", "params", "input"];

/**
 * The tool id when the WHOLE reply is an action payload, else null.
 *
 * MEASURED (Mission 3): only four tool names were recognised above, so a
 * provider that wrote `{"tool":"repo.acquire","arguments":{…}}` — or any
 * other of her ~180 tools — as text instead of a native call had that JSON
 * shown to the user as her answer. Deliberately strict, so JSON a person
 * asked for is left alone: the entire reply (``` fences allowed) must parse
 * as one object or a list of objects, each naming a tool-id-shaped value
 * under a name key AND carrying an arguments key.
 */
export function bareActionTool(text: string): string | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!/^[[{]/.test(body)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0) return null;
  let first: string | null = null;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const nameKey = NAME_KEYS.find((key) => typeof record[key] === "string" && TOOL_ID.test(String(record[key])));
    if (!nameKey || !ARG_KEYS.some((key) => key in record)) return null;
    first ??= String(record[nameKey]);
  }
  return first;
}

/** Extract the real query from the invocation formats used by providers. */
export function extractToolQuery(raw: string): string | null {
  const xml = raw.match(
    /<parameter\s+name\s*=\s*["']query["']\s*>([\s\S]*?)<\/parameter>/i,
  );
  if (xml?.[1]) return xml[1].trim();

  const functionCall = raw.match(
    /(?:Researcher|search|browser)\s*\(\s*query\s*=\s*["']([^"']+)["']/i,
  );
  if (functionCall?.[1]) return functionCall[1].trim();

  const json = raw.match(
    /["']query["']\s*:\s*["']([^"']+)["']/i,
  );
  return json?.[1]?.trim() ?? null;
}

/**
 * Keep ordinary prose while removing invocation blocks. If the provider
 * returned only transport markup, return a short truthful placeholder.
 */
export function cleanAssistantText(text: string): string {
  if (!isRawToolMarkup(text)) return text;

  const withoutBlocks = text
    .replace(/<dots_function_call[\s\S]*?<\/invoke>/gi, "")
    .replace(/<tool_call_start[\s\S]*?<tool_call_end>/gi, "")
    .replace(/<parameter\s+name\s*=\s*["'][^"']+["']\s*>[\s\S]*?<\/parameter>/gi, "")
    .replace(/\{\s*["'](?:tool|name)["'][\s\S]*?\}\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (withoutBlocks && !isRawToolMarkup(withoutBlocks)) return withoutBlocks;

  // NEVER promise a result here.
  //
  // This function only sanitises text for display — it dispatches
  // nothing. The previous return said "I'm researching X and will show
  // the live result here", which the UI rendered as a claim that a
  // search was under way when no tool had been invoked at all. Real
  // execution happens in ToolCallInterceptor (wired at AIRouter:167),
  // and when that runs the user sees its actual results or its actual
  // failure. Text reaching this fallback means the transport markup was
  // NOT executed, so the honest report is that nothing ran.
  const tool = bareActionTool(text);
  if (tool) {
    return `I produced a request to use ${tool} instead of running it, so nothing was done and I have no result to show. Ask again and I will run it.`;
  }
  const query = extractToolQuery(text);
  return query
    ? `I produced a tool request for “${query}” but it was not executed, so I have no result to show. Ask again and I will run it.`
    : "I produced a tool request that was not executed, so I have no result to show.";
}
