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
import { isMissionResume } from "../router/continuationContext";

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
  // "Build a 3D environment", "make a diagram", "chart the earthquakes" are
  // environment-shaped words, but the work itself is a creative-kit or data
  // tool: keep the ones the turn's own vocabulary raises next to the
  // environment family, or the turn could present but never make the thing.
  const kit = new Set<string>();
  for (const [pattern, names] of FAMILY_HINTS) if (pattern.test(prompt)) for (const name of names) if (/^(creative_|data_|research_board)/.test(name)) kit.add(name);
  const narrowed = schemas.filter((schema) => schema.name.startsWith(ENVIRONMENT_TOOL_PREFIX) || kit.has(String(schema.name)));
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

/**
 * The continuity family, pinned as a set.
 *
 * Measured in a real turn: "call mission_update on m-…, then mission_brief"
 * offered mission_update, mission_brief and mission_list, but not
 * self_operational — the read that proves what state the work is in. A turn
 * that can advance a workstream must also be able to inspect and resume it,
 * so when continuity is the subject these travel together.
 */
export const CONTINUITY_TOOL_NAMES: readonly string[] = [
  "self_operational",
  "mission_list",
  "mission_find",
  "mission_record",
  "mission_update",
  "mission_brief",
];

/** How many schemas one conversational turn may carry. */
export const TURN_TOOL_LIMIT = 14;

/**
 * A resume turn needs these four, and nothing else: find the record, read its
 * brief, advance it, and list if the find is ambiguous. Discovery tools and
 * self.operational are useful on open-ended turns but were measured as spent
 * Groq TPM on a blocked Mission 14 retry (system.config + self.operational
 * before any mission read).
 */
export const MISSION_RESUME_TOOL_NAMES: readonly string[] = [
  "mission_list",
  "mission_find",
  "mission_brief",
  "mission_update",
];

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
  // Phrasal particle ("find out", "figure out"): it names no topic.
  "out",
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
/** Her own subsystems, by the names people use for them. */
const OWN_SYSTEM =
  "(?:supabase|database|db|persistence|memor(?:y|ies)|voice|tts|moss|speech|microphone|mic|stt|whisper|transcri\\w*|providers?|groq|openrouter|models?|engineering agent|agents?|tools?|runtime|server|backend|api|deploy\\w*|production|https|certificate|login|auth\\w*|sync|chat|yourself|your (?:own )?(?:system|code|runtime|state))";
/** Something wrong, or a request to look at its state. */
const PROBLEM =
  "(?:broken|break\\w*|working|not working|isn'?t working|aren'?t working|doesn'?t work|don'?t work|won'?t|fail\\w*|failure|errors?|issues?|problems?|down|503|502|500|401|fix\\w*|repair\\w*|diagnos\\w*|investigat\\w*|debug\\w*|health|status|why)";

/**
 * A turn about one of LÉLU's OWN systems being wrong (or its state): both a
 * subsystem and a problem/status word, in either order.
 */
export const SELF_DIAGNOSIS_REQUEST = new RegExp(`(?=[\\s\\S]*\\b${OWN_SYSTEM}\\b)(?=[\\s\\S]*\\b${PROBLEM}\\b)`, "i");

/**
 * A turn that refers back to THIS conversation: what was discussed, said,
 * recommended, or "the second thing". Resolving it needs the conversation,
 * never a fresh research query or a question back to the user.
 */
export const CONVERSATION_REFERENCE =
  /\b(?:we(?:'ve| have)? (?:discussed|talked|covered|decided|agreed)|we discussed|our (?:conversation|discussion|chat|work)|everything we|so far|recap|still broken|what'?s (?:left|broken|missing|outstanding)|outstanding|unfinished|you (?:recommended|suggested|said|mentioned|proposed|listed)|(?:the )?(?:first|second|third|fourth|last|other|next) (?:thing|one|option|step|item|recommendation|suggestion|idea|point))\b/i;

const FAMILY_HINTS: Array<[RegExp, string[]]> = [
  // SELF-DIAGNOSIS: the turn is about one of HER OWN systems and something
  // being wrong with it (or its state). MEASURED (Mission 3, full startup
  // registry): "Find out why Supabase isn't working and fix it" was offered
  // research_web, repo_research, kb_search, browser_* and unrelated 3D tools,
  // and no tool that reads her live state — so the model could only search
  // the web or ask which repository to look at. These are the tools that
  // inspect the running system (live provider probe, configuration presence,
  // recent changes, playbook runs).
  [SELF_DIAGNOSIS_REQUEST, ["self_operational", "system_config", "self_changes", "self_run_status", "memory_recall", "chats_read"]],
  // CONVERSATION REVIEW: the turn refers back to THIS conversation. The
  // history is in the request; these let her also read older chats, her
  // memory and the recorded workstreams instead of asking the user to repeat.
  [CONVERSATION_REFERENCE, ["chats_read", "memory_recall", "mission_list", "mission_find", "self_operational"]],
  [/\b(weather|news|latest|search|research|find out|look up|source|sources|arxiv|wikipedia)\b/i, ["research_web", "browser_read", "browser_capture", "repo_research", "kb_search"]],
  [/\b(remember|recall|memory|memories|discuss|discussed|yesterday|earlier|conversation|chats?)\b/i, ["memory_recall", "memory_store", "chats_read", "chats_list"]],
  [/\b(file|files|folder|directory|write|save|sandbox|script|code)\b/i, ["sandbox_read", "sandbox_write", "sandbox_execute", "project_search", "project_manage"]],
  [/\b(website|web ?app|app|game|build|scaffold|studio|deploy|publish)\b/i, ["studio_engine", "studio_project_create", "studio_create", "studio_build", "studio_preview", "creator_build", "studio_deploy"]],
  [/\b(workflow|automation|pipeline|steps?)\b/i, ["workflow_list", "workflow_run", "workflow_author", "workflow_status"]],
  [/\b(project|repository|repo|codebase|function|module|import)\b/i, ["project_search", "project_preview", "repo_inspect", "repo_status", "project_manage"]],
  [/\b(avatar|body|gesture|wave|dance|companion|hologram|holographic|walk|move|face me|come here|closer)\b/i, ["avatar_gesture", "avatar_companion", "avatar_move"]],
  [/\b(artifact|diagram|table|chart|note|document)\b/i, ["artifact_create", "artifact_edit", "artifact_read", "environment_present_artifact"]],
  [/\b(agent|delegate|workforce|task force)\b/i, ["agent_delegate", "agent_status", "agent_resume"]],
  // Continuity is its own family. Without this, a turn saying "call
  // mission_update on m-..." matched no hint, so only the accidentally
  // lexical tools were offered and the model truthfully answered that it
  // could not see mission_update. The five tools are one set: a turn that
  // can open a workstream must also be able to advance and resume it.
  [/(?:\b(missions?|workstreams?|continuity|resuming?|brief|ledger|blockers?)\b|\boperational state\b|mission_(?:list|find|record|update|brief)|self_operational)/i, ["self_operational", "mission_list", "mission_find", "mission_record", "mission_update", "mission_brief"]],
  // Measured: "Draw me a quick sketch of a cat…" matched no family, so the
  // drawing tool (studio_create, kind "drawing") was never offered and the
  // model answered with an invented image link, then ASCII art.
  [/\b(draw|drawing|drawn|sketch\w*|doodle|illustrat\w*|paint\w*|cartoon|storyboard)\b/i, ["studio_create", "studio_preview", "artifact_create"]],
  // Job 2 creative kit + public data. Each family raises the tool that
  // executes the request directly (no image/video API involved).
  [/\b(generative|procedural|abstract art|pattern|artwork|wallpaper|texture|moodboard|mood board|p5|creative coding)\b/i, ["creative_art", "creative_export"]],
  [/\b(diagram|flowchart|flow chart|architecture|sequence diagram|mind ?map|mermaid|timeline|org chart|gantt|er diagram|class diagram)\b/i, ["creative_diagram", "creative_export"]],
  [/\b(visuali[sz]\w*|chart|graph|plot|dashboard|data viz|infographic)\b/i, ["creative_chart", "data_query", "creative_export"]],
  [/\b(earthquakes?|seismic|forecast|preprints?|papers?|citations?|wikidata|crossref|openalex|hacker news|releases?|geocode|coordinates|public data|dataset)\b/i, ["data_query", "data_sources", "creative_chart"]],
  [/\b(3d|3-d|scene|environment|landscape|glb|gltf|model|terrain|runway|garment|collection)\b/i, ["creative_scene3d", "creative_export"]],
  [/\b(film|video|movie|clip|trailer|animation|animated|reel|montage|webm)\b/i, ["creative_film", "creative_export"]],
  [/\b(research|investigate|study|literature|sources?|cite|citations?)\b/i, ["research_board", "data_query"]],
  [/\b(export|download|save as|svg|png|glb|excalidraw|file)\b/i, ["creative_export"]],
  // "What can you actually do right now?" missed the literal "what can you do".
  [/\b(capabilit\w*|webgpu|webgl|webcodecs|what (?:can|could) you (?:actually |really |currently |now )?(?:do|run)|tools?|offline|right now)\b/i, ["self_operational", "device_capabilities", "tools_catalog", "capability_discover"]],
  // Her spatial engine (ASRE): real reconstruction from images and her persistent
  // character. Raised only when the turn is about turning views into 3D, the
  // numerical record, or changing/restoring a character's components.
  [/\b(reconstruct\w*|image[- ]to[- ]3d|photo[- ]to[- ]3d|(?:into|in|to) 3d|3d (?:scan|model of)|voxel\w*|hypothes[ie]s|silhouette|another (?:view|angle)|side view|back view|hairstyle|haircut|outfit|clothing|body proportions?|restore (?:the |her )?(?:original|earlier|previous)|character version|asre)\b/i, ["asre_reconstruct", "asre_job", "asre_observe", "asre_character", "asre_history", "asre_export"]],
  // 3D and her world: the world.* executors build real objects in the Cosmos.
  [/\b(3d|3-d|sculpt\w*|mesh|statue|hologram|world|cosmos|universe)\b/i, ["world_object", "world_generate", "world_state", "world_environment"]],
  // Her rotating room: turning to a section, the bare stage, the floor plan.
  [/\b(room|lounge|theat(?:er|re)|kitchen|dining|bed ?room|bath ?room|studio|floor ?plan|turntable|stage)\b/i, ["world_room"]],
  // Exporting what she built: STL for printing, OBJ for other 3D tools.
  [/\b(stl|obj|3d[- ]?print\w*|export\w*)\b/i, ["world_export", "world_state"]],
  // Resource intelligence: finding, judging and testing tools for herself.
  [/\b(open[- ]?source|free (?:tools?|librar(?:y|ies)|alternatives?)|alternative|missing|capabilit\w*|expand|improve your|dependenc\w*|library|libraries|package|npm|github|gitlab)\b/i, ["resources_gaps", "resources_discover", "resources_evaluate", "resources_sandbox", "resources_register", "resources_audit"]],
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
  // Each description word counts ONCE: a description that repeats a common
  // word ("out of … out as … out of") must not outrank a tool that is about
  // the turn's subject.
  for (const word of new Set(words(String(schema.description ?? "")))) {
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
  // A mission resume is a closed read/advance turn. Offering the discovery
  // and self-inspection families alongside it invited detours that consumed
  // the provider's minute before the ledger was read.
  if (isMissionResume(prompt)) {
    const resume = schemas.filter((schema) => MISSION_RESUME_TOOL_NAMES.includes(String(schema.name)));
    if (resume.length > 0) return resume;
  }

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
  // The ledger set travels together when the turn is about the LEDGER
  // (a mission tool was hinted). self_operational alone is raised by the
  // diagnosis/review families and must not pin six slots on every such turn.
  const continuityHinted = [...hinted].some((name) => name.startsWith("mission_"));
  const pinned = continuityHinted
    ? schemas.filter((schema) => CONTINUITY_TOOL_NAMES.includes(String(schema.name)))
    : [];
  const pinnedNames = new Set(pinned.map((schema) => String(schema.name)));

  const ranked = schemas
    .filter((schema) => !DISCOVERY_TOOL_NAMES.includes(String(schema.name)))
    .filter((schema) => !pinnedNames.has(String(schema.name)))
    .map((schema) => {
      const name = String(schema.name);
      const boost = hinted.has(name) ? 3 : 0;
      return { schema, score: relevance(schema, wanted) + boost, cost: schemaBytes(schema) };
    })
    .sort((a, b) => b.score - a.score || a.cost - b.cost || String(a.schema.name).localeCompare(String(b.schema.name)));

  const chosen: ToolSchema[] = [];
  let spent = [...discovery, ...pinned].reduce((total, schema) => total + schemaBytes(schema), 0);
  const nothingMatched = ranked.every((entry) => entry.score === 0) && pinned.length === 0;
  // When the turn's vocabulary matched a family, a tool OUTSIDE the matched
  // families must earn its slot with a strong lexical match (as much as a
  // hint is worth). MEASURED (Mission 3): weak one-word overlaps filled the
  // remaining slots of a Supabase-diagnosis turn with cosmos_object_remove
  // and world_promote, and of a voice-failure turn with studio_deploy — tools
  // that cannot help and, offered, invite the model to try them. `ranked` is
  // sorted by score, so the first entry under the floor ends the selection.
  const floor = hinted.size > 0 ? 3 : 0;
  for (const entry of ranked) {
    if (chosen.length + discovery.length + pinned.length >= TURN_TOOL_LIMIT) break;
    if (!nothingMatched && entry.score < floor) break;
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
  if (chosen.length === 0 && pinned.length === 0 && schemas.length > 0) {
    return schemas.slice(0, Math.min(TURN_TOOL_LIMIT, schemas.length));
  }
  return [...discovery, ...pinned, ...chosen];
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
