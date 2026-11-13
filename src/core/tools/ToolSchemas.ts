/**
 * ==========================================================
 * LÉLU
 * TOOL SCHEMAS — what a model is allowed to be told it has
 *
 * The set of tools offered to a model is derived, never authored:
 *
 *   ToolRegistry (what LÉLU declares)
 *     ∩ ToolDispatcher (what actually executes)
 *     ∩ AutonomyGate (what is permitted right now)
 *
 * All three must agree. A registry entry with no executor is not
 * offered; an executor for a tool the registry marks unavailable is
 * not offered; and neither is a tool above the current autonomy level.
 *
 * This is the mechanism that keeps native tool calling honest. A model
 * offered a tool it cannot actually run will call it, be told it
 * failed, and then — reliably — describe the result it expected. The
 * fix is not to prompt against that; it is to never make the offer.
 * ==========================================================
 */

import type { ToolSchema } from "../../providers/AIProvider";
import ToolRegistry from "./ToolRegistry";
import {
  executableToolIds,
  executorParameters,
  toolNameForModel,
  toolPermitted,
} from "./ToolDispatcher";

/**
 * Every tool that is registered, executable and currently permitted,
 * in provider-neutral form.
 */
export function toolSchemasForModel(): ToolSchema[] {
  const registry = ToolRegistry.getInstance();
  const schemas: ToolSchema[] = [];

  for (const id of executableToolIds()) {
    const definition = registry.get(id);
    if (!definition) continue;
    if (!toolPermitted(id)) continue;

    const parameters = executorParameters(id);
    if (!parameters) continue;

    schemas.push({
      name: toolNameForModel(id),
      // The registry description is what LÉLU already tells the rest of
      // the system this tool does; the model gets the same sentence
      // rather than a second, drifting one.
      description: `${definition.description} (category: ${definition.category})`,
      parameters,
    });
  }

  return schemas;
}

/**
 * An OPERATE-MY-ENVIRONMENT turn: it asks to build, change or present what
 * is on screen. Deliberately the same vocabulary the environment tools
 * themselves serve, so the narrowing below cannot drift from them.
 */
const ENVIRONMENT_REQUEST =
  /\b(?:environment|workspaces?|surfaces?|layout|artifact|diagram|table|chart|panel|window|cosmos)\b/i;

export const ENVIRONMENT_TOOL_PREFIX = "environment_";

/**
 * Narrow an already-derived tool list to the environment family.
 *
 * Fails OPEN: if the narrowing would leave nothing to offer, the full set
 * is returned instead — a turn is never left with no tools because a
 * category happened to be empty.
 */
export function scopeToolSchemas(
  schemas: ToolSchema[],
  prompt = "",
  intent?: string,
): ToolSchema[] {
  const environmentTurn = Boolean(intent && /environment/i.test(intent)) || ENVIRONMENT_REQUEST.test(prompt);
  if (!environmentTurn) return schemas;
  const narrowed = schemas.filter((schema) => schema.name.startsWith(ENVIRONMENT_TOOL_PREFIX));
  return narrowed.length > 0 ? narrowed : schemas;
}

/**
 * The tools offered for ONE turn.
 *
 * Offering every executable tool made each request ~19.5k tokens. Measured
 * against Groq: `413 Request too large … tokens per minute (TPM): Limit
 * 8000, Requested 19553`. The resolver then did what it is designed to do —
 * retried the SAME request without tool schemas — so the model never had a
 * single tool to choose from and answered with prose about a workspace it
 * could not build. Autonomy was not missing; it was refused by the request
 * size, on a payload the schemas were 90% of.
 *
 * Mission 6.1.4 measured the integrated app (broker log): 58 tools, ~35 KB of
 * schemas, 102 KB body — OpenRouter refused it for credits, Groq for its 8k
 * TPM, and a turn only completed after two refusals. So EVERY turn is now
 * narrowed to what it plausibly needs, not only environment turns. The
 * narrowing is a filter over the derived list (registry ∩ executor ∩ gate),
 * never a second list, and it fails OPEN: a turn always keeps the discovery
 * tools, so a capability outside the selected set stays findable.
 */
export function toolSchemasForRequest(prompt = "", intent?: string): ToolSchema[] {
  return selectToolSchemas(toolSchemasForModel(), prompt, intent);
}

/**
 * Tools that survive every selection.
 *
 * These are how she finds and switches on anything else, so withholding them
 * would make the reduction a capability loss rather than a payload saving.
 * Names are matched against the derived list; a name that is not executable
 * right now is simply absent.
 */
export const DISCOVERY_TOOL_NAMES: readonly string[] = [
  "capabilities_list",
  "capabilities_activate",
  "system_config",
];

/** How many schemas one conversational turn may carry. */
export const TURN_TOOL_LIMIT = 14;

/**
 * How many bytes of schema one conversational turn may carry.
 *
 * JSON schemas tokenise at ~3.2 bytes/token, so 12 KB is ~3.7k tokens — a
 * third of Groq's whole minute, leaving room for prompt, system and history
 * instead of spending the minute on schemas the turn will not use.
 */
export const TURN_TOOL_BUDGET_BYTES = 12_000;

const STOPWORDS = new Set([
  "the", "and", "for", "you", "your", "that", "this", "with", "have", "what", "when", "where",
  "which", "who", "why", "how", "can", "could", "would", "should", "please", "about", "into",
  "from", "them", "they", "there", "here", "just", "some", "then", "than", "also", "will",
  "does", "did", "was", "were", "are", "but", "not", "all", "any", "one", "two", "its", "it",
]);

const words = (value: unknown): string[] =>
  (typeof value === "string" ? value : "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));

/**
 * What a turn's vocabulary usually means, in tool names.
 *
 * Lexical overlap alone missed the common paraphrase: "what is the weather in
 * Tokyo" shares no word with research_web's description, so the turn was
 * offered the cheapest schemas instead of the one that could answer it. These
 * are families, not defaults — a match only raises a tool in the ranking.
 */
const FAMILY_HINTS: Array<[RegExp, string[]]> = [
  [/\b(weather|news|latest|search|research|find out|look up|source|sources|arxiv|wikipedia)\b/i, ["research_web", "browser_read", "browser_capture", "repo_research", "kb_search"]],
  [/\b(remember|recall|memory|memories|discuss|discussed|yesterday|earlier|conversation|chats?)\b/i, ["memory_recall", "memory_store", "chats_read", "chats_list"]],
  [/\b(file|files|folder|directory|write|save|sandbox|script|code)\b/i, ["sandbox_read", "sandbox_write", "sandbox_execute", "project_search", "project_manage"]],
  [/\b(website|web ?app|app|game|build|scaffold|studio|deploy|publish)\b/i, ["studio_engine", "studio_create", "studio_build", "studio_preview", "creator_build", "studio_deploy"]],
  [/\b(workflow|automation|pipeline|steps?)\b/i, ["workflow_list", "workflow_run", "workflow_author", "workflow_status"]],
  [/\b(project|repository|repo|codebase|function|module|import)\b/i, ["project_search", "project_preview", "repo_inspect", "repo_status", "project_manage"]],
  [/\b(avatar|body|gesture|wave|dance|companion)\b/i, ["avatar_gesture", "avatar_companion"]],
  [/\b(artifact|diagram|table|chart|note|document)\b/i, ["artifact_create", "artifact_edit", "artifact_read", "environment_present_artifact"]],
  [/\b(agent|delegate|workforce|task force)\b/i, ["agent_delegate", "agent_status", "agent_resume"]],
];

/**
 * The tools a turn keeps when nothing in it matched — a conversation still
 * needs to be able to remember, look something up and write something down.
 */
export const CORE_TOOL_NAMES: readonly string[] = [
  "memory_recall",
  "research_web",
  "artifact_create",
];

/** Bytes as UTF-8, the unit the request budget uses. */
const schemaBytes = (schema: ToolSchema): number =>
  new TextEncoder().encode(JSON.stringify(schema)).length;

/**
 * How much a schema looks like the thing the turn is about.
 *
 * Deliberately lexical and deterministic: a name match counts double a
 * description match, and the schema's own size is the tie-breaker so that
 * among equally relevant tools the cheaper one is carried. No model call, no
 * embedding service, no new dependency.
 */
function relevance(schema: ToolSchema, wanted: Set<string>): number {
  if (wanted.size === 0) return 0;
  let score = 0;
  for (const word of words(String(schema.name).replace(/_/g, " "))) {
    if (wanted.has(word)) score += 2;
  }
  for (const word of words(String(schema.description ?? ""))) {
    if (wanted.has(word)) score += 1;
  }
  return score;
}

/**
 * The turn's tool set: the discovery tools plus the most relevant schemas that
 * fit the turn's budget.
 *
 * Ordering is stable: relevance first, then the cheaper schema, then name, so
 * the same turn always transmits the same bytes and a cache can be trusted.
 */
export function selectToolSchemas(
  schemas: ToolSchema[],
  prompt = "",
  intent?: string,
): ToolSchema[] {
  // An environment turn keeps its existing, narrower contract.
  const environmentTurn = Boolean(intent && /environment/i.test(intent)) || ENVIRONMENT_REQUEST.test(prompt);
  if (environmentTurn) {
    const scoped = scopeToolSchemas(schemas, prompt, intent);
    if (scoped.length > 0) return scoped;
  }

  const discovery = schemas.filter((schema) => DISCOVERY_TOOL_NAMES.includes(String(schema.name)));
  const wanted = new Set(words(prompt));
  const hinted = new Set<string>();
  for (const [pattern, names] of FAMILY_HINTS) {
    if (pattern.test(prompt)) for (const name of names) hinted.add(name);
  }

  const ranked = schemas
    .filter((schema) => !DISCOVERY_TOOL_NAMES.includes(String(schema.name)))
    .map((schema) => {
      const name = String(schema.name);
      const boost = hinted.has(name) ? 3 : 0;
      return { schema, score: relevance(schema, wanted) + boost, cost: schemaBytes(schema) };
    })
    .sort((a, b) => b.score - a.score || a.cost - b.cost || String(a.schema.name).localeCompare(String(b.schema.name)));

  const chosen: ToolSchema[] = [];
  let spent = discovery.reduce((total, schema) => total + schemaBytes(schema), 0);
  const nothingMatched = ranked.every((entry) => entry.score === 0);
  for (const entry of ranked) {
    if (chosen.length + discovery.length >= TURN_TOOL_LIMIT) break;
    if (spent + entry.cost > TURN_TOOL_BUDGET_BYTES && chosen.length > 0) break;
    // A turn with no signal at all keeps the conversational core, not the
    // cheapest four — remembering and looking something up matter more
    // than whichever schema happens to be smallest.
    if (nothingMatched && !CORE_TOOL_NAMES.includes(String(entry.schema.name))) continue;
    if (!nothingMatched && entry.score === 0 && chosen.length >= 4) break;
    chosen.push(entry.schema);
    spent += entry.cost;
  }

  // Fails OPEN like the environment narrowing: never leave a turn with no
  // tool at all just because the budget was already spent.
  if (chosen.length === 0 && schemas.length > 0) {
    return schemas.slice(0, Math.min(TURN_TOOL_LIMIT, schemas.length));
  }
  return [...discovery, ...chosen];
}

/** What a turn's selection decided — for diagnostics, never for content. */
export function describeToolSelection(
  schemas: ToolSchema[],
  prompt = "",
  intent?: string,
): { offered: number; available: number; bytes: number; names: string[] } {
  const offered = selectToolSchemas(schemas, prompt, intent);
  return {
    offered: offered.length,
    available: schemas.length,
    bytes: offered.reduce((total, schema) => total + schemaBytes(schema), 0),
    names: offered.map((schema) => String(schema.name)),
  };
}

/**
 * How many tools a size-refused turn may still carry on its retry.
 *
 * Small on purpose: this is the middle rung, not a budget.
 */
export const REDUCED_TOOL_LIMIT = 3;

/**
 * The set offered on a retry after a size refusal.
 *
 * The resolver used to answer a 413 by sending the SAME request with NO tools
 * at all — which is why the model then described work it could not perform.
 * A refused turn now first retries with a smaller set: the environment family
 * when the turn is about the environment, otherwise the cheapest schemas to
 * carry, so a tool-calling turn keeps the ability to act while it shrinks.
 * Only if THAT is still refused does the turn fall back to no tools.
 */
export function reducedToolSchemas(
  prompt: string | ToolSchema[] = "",
  intent?: string,
): ToolSchema[] {
  // Two call shapes exist and both must stay honest: production passes
  // (prompt, intent) and the resolver's retry decides from the derived list;
  // a caller that already holds a list passes (schemas, prompt). Rebuilding
  // from the registry in the second shape invented tools the caller never
  // had, which is exactly what the reduced-set tests exist to prevent.
  const givenList = Array.isArray(prompt);
  const schemas = givenList ? prompt : toolSchemasForModel();
  const text = givenList ? (intent ?? "") : prompt;
  const scoped = selectToolSchemas(schemas, text, givenList ? undefined : intent);
  if (scoped.length <= REDUCED_TOOL_LIMIT) return scoped;

  const environment = scoped.filter((schema) => schema.name.startsWith(ENVIRONMENT_TOOL_PREFIX));
  if (environment.length > 0) return environment.slice(0, REDUCED_TOOL_LIMIT);

  return [...scoped]
    .sort((a, b) => a.description.length - b.description.length)
    .slice(0, REDUCED_TOOL_LIMIT);
}

/**
 * Diagnostic: why each executable tool is or is not being offered.
 * Used by the verification script and the capability matrix so the
 * offered set can be inspected rather than assumed.
 */
export function toolSchemaDiagnostics(): Array<{
  id: string;
  registered: boolean;
  available: boolean;
  permitted: boolean;
  offered: boolean;
}> {
  const registry = ToolRegistry.getInstance();
  return executableToolIds().map((id) => {
    const definition = registry.get(id);
    const permitted = toolPermitted(id);
    return {
      id,
      registered: Boolean(definition),
      available: Boolean(definition?.available),
      permitted,
      offered: Boolean(definition) && permitted && Boolean(executorParameters(id)),
    };
  });
}
