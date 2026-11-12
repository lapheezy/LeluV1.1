/**
 * ==========================================================
 * LÉLU — WHAT ONE REQUEST ACTUALLY CARRIES
 *
 * Mission 5.7 could not capture the prompt / history / schema split because
 * the provider refused the request before anything was measured. The right
 * place to measure is the moment the request is assembled, BEFORE it is sent,
 * and that is what this describes: lengths and counts of the payload the
 * resolver is about to hand to a provider.
 *
 * Two rules it keeps:
 *
 *   1. BYTES ARE BYTES. Nothing here is called "tokens" except the single
 *      field that says it is an estimate, and that field states its method.
 *      A character count labelled as tokens is how a budget analysis becomes
 *      fiction.
 *   2. NO CONTENT. Lengths, counts and the schema tier only — never the text
 *      of a message, a tool argument, or a credential.
 * ==========================================================
 */

export type SchemaTier = "FULL" | "REDUCED" | "NONE";

export interface RequestBudget {
  provider?: string;
  model?: string;
  tier: SchemaTier;
  messageCount: number;
  systemBytes: number;
  historyBytes: number;
  promptBytes: number;
  toolCount: number;
  toolSchemaBytes: number;
  totalBytes: number;
  /** Coarse, deliberately labelled: bytes / 4. Not a provider token count. */
  estimatedTokens: number;
  estimation: "bytes/4";
  toolNames: string[];
}

const bytes = (value: unknown): number => {
  if (value === undefined || value === null) return 0;
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).length;
};

export function describeRequestBudget(input: {
  messages?: Array<{ role?: string; content?: unknown }>;
  prompt?: string;
  tools?: Array<{ name?: string; description?: string; parameters?: unknown }>;
  tier?: SchemaTier;
  provider?: string;
  model?: string;
}): RequestBudget {
  const messages = input.messages ?? [];
  const tools = input.tools ?? [];

  let systemBytes = 0;
  let historyBytes = 0;
  for (const message of messages) {
    const size = bytes(message.content) + bytes(message.role);
    if (message.role === "system") systemBytes += size;
    else historyBytes += size;
  }

  const promptBytes = bytes(input.prompt);
  const toolSchemaBytes = tools.length > 0 ? bytes(tools) : 0;
  const totalBytes = systemBytes + historyBytes + promptBytes + toolSchemaBytes;

  return {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    tier: input.tier ?? "FULL",
    messageCount: messages.length,
    systemBytes,
    historyBytes,
    promptBytes,
    toolCount: tools.length,
    toolSchemaBytes,
    totalBytes,
    estimatedTokens: Math.ceil(totalBytes / 4),
    estimation: "bytes/4",
    toolNames: tools.map((tool) => String(tool.name ?? "")).filter(Boolean).slice(0, 24),
  };
}

// ---------------------------------------------------------------------------
// THE CEILING — applied before transmission, not discovered from a 413
// ---------------------------------------------------------------------------

/** Used when neither the provider nor the model gives a better number. */
const DEFAULT_CEILING_BYTES = 96_000;

/** A trimmed message keeps at least this many bytes of its own text. */
const MIN_TRIMMED_BYTES = 512;

/**
 * Context windows, in tokens, for models whose value we actually know.
 *
 * A model that is not here does not get a guessed number: it falls through to
 * the provider's transport ceiling or to the default, and `requestCeiling`
 * says which one applied. Inventing a window for an unknown model is how a
 * budget becomes fiction.
 */
const MODEL_CONTEXT_TOKENS: Array<[RegExp, number]> = [
  [/claude-/i, 200_000],
  [/gemini-1\.5|gemini-2/i, 1_000_000],
  [/gpt-4o|gpt-4\.1|gpt-4-turbo/i, 128_000],
  [/llama-3\.(3|1)-70b|llama-3\.1-8b|gpt-oss/i, 131_072],
  [/mixtral-8x7b/i, 32_768],
  [/gemma2?-9b/i, 8_192],
  [/deepseek/i, 65_536],
  [/mistral-/i, 32_768],
];

/**
 * Transport ceilings, in UTF-8 bytes, for providers whose HTTP body limit is
 * smaller than the model's context.
 *
 * Groq is the measured one, twice over.
 *
 * First the limit itself: the account's ceiling is 8,000 TOKENS PER MINUTE,
 * not 12,000. A chat turn came back `413 … Limit 8000, Requested 10184`.
 *
 * Then, once the byte ceiling was set to an 8,000-token equivalent, the
 * broker still refused a 35,246-byte turn:
 *
 *   429 … TPM: Limit 8000, Used 2454, Requested 7846 … tools≈7868tok
 *
 * The tool schemas alone were 7,868 tokens — the whole minute, before the
 * prompt or the system message were counted. JSON schemas tokenise far
 * denser than prose: about 3.2 bytes per token here, not the 4 this module
 * assumes for text. So a body sized to the limit by the text ratio still
 * requests more than the limit once tools are attached, and every turn 429s
 * until the window drains; degrading to zero tools then produced
 *
 *   400 tool_use_failed … "Tool choice is none, but model called a tool"
 *
 * Conversational turns do not need 53 schemas. This ceiling deliberately
 * leaves room for prompt, system message and history, so the fitter withholds
 * tools instead of spending the minute on them.
 *
 * That is what a request must fit, not the 131k-token context window printed
 * on the model card. Being generous here is the failure mode: the ceiling
 * exists to stop a refusal that is already certain.
 */
/**
 * Tokens-per-minute ceilings, for providers that meter that way.
 *
 * Measured (2026-11-11) on this account: `413 ... tokens per minute (TPM):
 * Limit 8000, Requested 10198` for gpt-oss-120b, with `tools≈11880tok` in the
 * body. The old constant said 12,000 TPM (48KB) and also ignored the reply's
 * `max_tokens`, which the provider counts against the same minute — so a
 * request the fitter considered acceptable was certain to be refused, and the
 * turn came back with nothing.
 */
const PROVIDER_TPM: Record<string, number> = {
  groq: 8_000,
};

/** Room kept so a request that fills the minute still has room to answer. */
const TPM_MARGIN_TOKENS = 256;

/**
 * The byte ceiling implied by a provider's per-minute metering, with the
 * reply's own budget subtracted. Undefined when the provider is not metered
 * this way, so an unknown provider is never given an invented number.
 */
function providerTransportBytes(providerKey: string, maxTokens: number): number | undefined {
  const tpm = Object.entries(PROVIDER_TPM).find(([name]) => providerKey.includes(name))?.[1];
  if (tpm === undefined) return undefined;
  return Math.max(4_096, (tpm - Math.max(0, maxTokens) - TPM_MARGIN_TOKENS) * 4);
}

function byteLength(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).length;
}

export interface BudgetCeiling {
  bytes: number;
  source: "configured" | "provider" | "model" | "default";
  detail: string;
}

/**
 * How large a request this provider and model will actually accept.
 *
 * Order, smallest binding limit first: an explicit operator override, the
 * provider's transport ceiling, the model's context window minus the room the
 * reply needs, then the default.
 */
export function requestCeiling(input: {
  provider?: string;
  model?: string;
  maxTokens?: number;
  limitBytes?: number;
}): BudgetCeiling {
  if (input.limitBytes && Number.isFinite(input.limitBytes) && input.limitBytes >= 4_096) {
    return { bytes: Math.floor(input.limitBytes), source: "configured", detail: "operator override" };
  }

  const providerKey = (input.provider ?? "").toLowerCase();
  const transport = providerTransportBytes(providerKey, input.maxTokens ?? 1_024);

  let modelBytes: number | undefined;
  let modelDetail = "no model ceiling known";
  if (input.model) {
    for (const [pattern, tokens] of MODEL_CONTEXT_TOKENS) {
      if (!pattern.test(input.model)) continue;
      // Leave room for the reply: a request that exactly fills the window
      // leaves the model nothing to answer with.
      const reserve = Math.ceil((input.maxTokens ?? 1_024) * 1.25) + 256;
      modelBytes = Math.max(1_024, tokens - reserve) * 4;
      modelDetail = `${tokens} token context`;
      break;
    }
  }

  if (transport !== undefined && (modelBytes === undefined || transport < modelBytes)) {
    return { bytes: transport, source: "provider", detail: "provider transport ceiling" };
  }
  if (modelBytes !== undefined) {
    return { bytes: modelBytes, source: "model", detail: modelDetail };
  }
  return { bytes: DEFAULT_CEILING_BYTES, source: "default", detail: "no provider or model ceiling known" };
}

export interface FittedRequest<M, T> {
  messages: M[];
  tools: T[];
  tier: SchemaTier;
  budget: RequestBudget;
  ceiling: BudgetCeiling;
  changed: boolean;
  droppedTools: number;
  droppedMessages: number;
  trimmedMessages: number;
  notes: string[];
}

/**
 * Make one request fit what the provider will accept — before it is sent.
 *
 * The two-step degradation in ProviderResolver reacts to a 413 that has
 * already happened, and it retries the SAME history: a turn whose history is
 * the problem is refused twice and then answers without any work. This is the
 * same decision made first, and in the order that keeps the most meaning:
 *
 *   1. tool schemas, from the end — ToolSchemas already orders by relevance,
 *      and a conversational answer needs none of them;
 *   2. the oldest history, never a system message, never the recent tail —
 *      the question and its results are the recent tail;
 *   3. the oldest history's own text, keeping each message's end, where the
 *      request and its results are.
 *
 * The prompt is never touched. If the person's own message is larger than the
 * provider accepts, the request still fails — honestly, at the provider —
 * instead of silently answering a question that was rewritten.
 */
export function fitRequestBudget<
  M extends { role?: string; content?: unknown },
  T extends { name?: string },
>(input: {
  messages?: M[];
  prompt?: string;
  tools?: T[];
  tier?: SchemaTier;
  provider?: string;
  model?: string;
  maxTokens?: number;
  limitBytes?: number;
  /** How many of the most recent messages must survive untouched. */
  protectedTail?: number;
}): FittedRequest<M, T> {
  const ceiling = requestCeiling(input);
  const protectedTail = Math.max(2, input.protectedTail ?? 12);
  let messages: M[] = [...(input.messages ?? [])];
  let tools: T[] = [...(input.tools ?? [])];
  let tier: SchemaTier = input.tier ?? "FULL";
  const notes: string[] = [];
  let droppedTools = 0;
  let droppedMessages = 0;
  let trimmedMessages = 0;

  const measure = () =>
    describeRequestBudget({
      messages: messages as never,
      prompt: input.prompt,
      tools: tools as never,
      tier,
      provider: input.provider,
      model: input.model,
    });

  let budget = measure();
  const before = budget.totalBytes;
  if (budget.totalBytes <= ceiling.bytes) {
    return { messages, tools, tier, budget, ceiling, changed: false, droppedTools, droppedMessages, trimmedMessages, notes };
  }

  // 1. TOOL SCHEMAS.
  while (tools.length > 0 && budget.totalBytes > ceiling.bytes) {
    tools = tools.slice(0, -1);
    droppedTools += 1;
    budget = measure();
  }
  if (droppedTools > 0) {
    tier = tools.length > 0 ? "REDUCED" : "NONE";
    budget = measure();
    notes.push(`${droppedTools} tool schema(s) withheld to fit the ${ceiling.source} ceiling`);
  }

  // 2. OLDEST HISTORY, keeping system prompts and the recent tail.
  const oldestDroppable = (list: M[]): number => {
    const from = Math.max(0, list.length - protectedTail);
    return list.findIndex((message, index) => index < from && message.role !== "system");
  };
  while (budget.totalBytes > ceiling.bytes) {
    const index = oldestDroppable(messages);
    if (index < 0) break;
    const drop = new Set<number>([index]);
    // Never leave a tool result without the assistant turn that asked for it:
    // providers reject an orphaned `tool` message outright.
    if (messages[index]?.role === "assistant" && Array.isArray((messages[index] as { toolCalls?: unknown }).toolCalls)) {
      let next = index + 1;
      while (next < messages.length && messages[next]?.role === "tool") {
        drop.add(next);
        next += 1;
      }
    }
    if (messages[index]?.role === "tool" && index > 0 && messages[index - 1]?.role === "assistant") {
      drop.add(index - 1);
    }
    messages = messages.filter((_, position) => !drop.has(position));
    droppedMessages += drop.size;
    budget = measure();
  }
  if (droppedMessages > 0) {
    notes.push(`${droppedMessages} older message(s) dropped, ${Math.min(protectedTail, messages.length)} most recent kept`);
  }

  // 3. THE OLDEST TEXT, keeping its end.
  while (budget.totalBytes > ceiling.bytes) {
    const from = Math.max(0, messages.length - protectedTail);
    const index = messages.findIndex(
      (message, position) =>
        position < from &&
        message.role !== "system" &&
        typeof message.content === "string" &&
        byteLength(message.content) > MIN_TRIMMED_BYTES,
    );
    if (index < 0) break;
    const text = messages[index].content as string;
    const keep = Math.max(Math.floor(text.length / 2), Math.min(text.length, 256));
    messages = messages.map((message, position) =>
      position === index
        ? ({ ...message, content: `[…earlier content trimmed…]${text.slice(-keep)}` } as M)
        : message,
    );
    trimmedMessages += 1;
    budget = measure();
  }
  if (trimmedMessages > 0) notes.push(`${trimmedMessages} older message(s) shortened`);

  if (budget.totalBytes > ceiling.bytes) {
    notes.push("still above the ceiling after trimming; the prompt itself is larger than the provider accepts");
  }

  return {
    messages,
    tools,
    tier,
    budget,
    ceiling,
    changed: before !== budget.totalBytes || droppedTools > 0 || droppedMessages > 0 || trimmedMessages > 0,
    droppedTools,
    droppedMessages,
    trimmedMessages,
    notes,
  };
}
