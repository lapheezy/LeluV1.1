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
