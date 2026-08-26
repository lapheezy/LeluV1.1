/**
 * ==========================================================
 * LÉLU
 * PROJECT RUNNER
 *
 * Executes a project's research queries through the SAME
 * ProviderRegistry the rest of the runtime uses. No duplicate
 * research system — projects orchestrate existing providers.
 * ==========================================================
 */

import type ProviderRegistry from "../ProviderRegistry";
import type { KnowledgeResult } from "../../providers/Provider";
import AgentEventBus from "../agent/AgentEvents";

export interface ProjectRunFailure {
  provider: string;
  error: string;
  latencyMs: number;
}

export interface ProjectRunResult {
  results: KnowledgeResult[];
  summary: string;
  providerNames: string[];
  failures: ProjectRunFailure[];
  resultCount: number;
  startedAt: number;
  finishedAt: number;
}

const MAX_RESULTS = 10;
const TIMEOUT_MS = 12000;
const MAX_PROVIDERS = 6;

/** Every knowledge domain the ProviderRegistry can serve. */
const KNOWLEDGE_CAPS = [
  "news",
  "current-events",
  "global",
  "technology",
  "encyclopedia",
  "fact",
  "reference",
  "knowledge",
  "weather",
  "geography",
  "location",
  "map",
  "place",
  "space",
  "astronomy",
  "academic",
  "research",
  "paper",
  "scientific",
  "code",
  "github",
  "video",
  "youtube",
  "developer",
  "startups",
  "general",
];

export default class ProjectRunner {
  constructor(private readonly providers: ProviderRegistry) {}

  /**
   * Run research queries for a project. Selects the best
   * matching providers by capability and executes them with
   * per-provider timeouts (same fallback model as ResearchResolver).
   */
  async run(
    projectName: string,
    queries: string[],
  ): Promise<ProjectRunResult> {
    const events = AgentEventBus.getInstance();
    const taskId = String(Date.now());

    events.emit({
      type: "tool_selected",
      taskId,
      tool: "project_research",
      label: `Running "${projectName}" — ${queries.length} query(ies)`,
    });

    const startedAt = Date.now();
    const collected: KnowledgeResult[] = [];
    const providerNames: string[] = [];
    const failures: ProjectRunFailure[] = [];

    // Select EVERY applicable knowledge provider (not just news):
    // match the number of knowledge capabilities each provider serves,
    // then rank by priority. A provider that is merely configured but
    // cannot search this project's queries is skipped at call time.
    const newsProviders = this.providers
      .all()
      .filter(
        (p) =>
          p.enabled &&
          p.capabilities.some((cap) => KNOWLEDGE_CAPS.includes(cap)),
      )
      .map((provider) => ({
        provider,
        matches: provider.capabilities.filter((cap) => KNOWLEDGE_CAPS.includes(cap)).length,
      }))
      // ProviderRegistry priorities are ascending: lower numbers are
      // higher priority, matching ResearchResolver and the global chain.
      .sort((a, b) => b.matches - a.matches || a.provider.priority - b.provider.priority)
      .slice(0, MAX_PROVIDERS)
      .map((item) => item.provider);

    for (const query of queries) {
      if (collected.length >= MAX_RESULTS) break;

      for (const provider of newsProviders) {
        if (collected.length >= MAX_RESULTS) break;
        if (!provider.canSearch?.(query)) continue;

        const providerStarted = Date.now();
        events.emit({
          type: "provider_selected",
          taskId,
          provider: provider.name,
          priority: provider.priority,
        });
        events.emit({
          type: "tool_started",
          taskId,
          tool: provider.name,
          label: `Project query: ${query.slice(0, 100)}`,
        });

        try {
          const results = await Promise.race([
            provider.search(query),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`${provider.name} timed out`)),
                TIMEOUT_MS,
              ),
            ),
          ]);

          const usable = Array.isArray(results)
            ? results.filter(
                (r) =>
                  r &&
                  typeof r.title === "string" &&
                  r.title.trim().length > 0,
              )
            : [];

          if (usable.length > 0 && !providerNames.includes(provider.name)) {
            providerNames.push(provider.name);
          }

          for (const r of usable.slice(0, MAX_RESULTS - collected.length)) {
            // De-duplicate across providers by normalized title so the
            // same story from two sources is only surfaced once.
            const normalized = r.title.trim().toLowerCase().replace(/\s+/g, " ");
            if (!collected.some((existing) => existing.title.trim().toLowerCase().replace(/\s+/g, " ") === normalized)) {
              collected.push(r);
            }
          }

          events.emit({
            type: "provider_status",
            taskId,
            provider: provider.name,
            status: usable.length > 0 ? "operational" : "empty response",
          });
          events.emit({
            type: "tool_result",
            taskId,
            tool: "project_research",
            result: `${provider.name}: ${usable.length} result(s) in ${Date.now() - providerStarted}ms`,
            results: usable.slice(0, 3).map((r) => ({
              title: r.title,
              url: r.url ?? undefined,
              type: r.source,
            })),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const latencyMs = Date.now() - providerStarted;
          failures.push({ provider: provider.name, error: message, latencyMs });
          events.emit({
            type: "provider_status",
            taskId,
            provider: provider.name,
            status: `failed — fallback continues (${message})`,
          });
          events.emit({
            type: "tool_result",
            taskId,
            tool: "project_research",
            result: `${provider.name} failed after ${latencyMs}ms: ${message}`,
          });
          // Per-provider failure: continue to the next configured provider.
        }
      }
    }

    const summary = this.formatSummary(projectName, collected, providerNames, failures);

    events.emit({
      type: "tool_result",
      taskId,
      tool: "project_research",
      result: `Complete — ${collected.length} total result(s) from ${providerNames.join(", ") || "none"}`,
    });

    return {
      results: collected,
      summary,
      providerNames,
      failures,
      resultCount: collected.length,
      startedAt,
      finishedAt: Date.now(),
    };
  }

  private formatSummary(
    projectName: string,
    results: KnowledgeResult[],
    providers: string[],
    failures: ProjectRunFailure[],
  ): string {
    if (results.length === 0) {
      // Only reached after every applicable provider was actually
      // attempted. Report the attempt honestly instead of a bare
      // "no results" claim.
      const attempted =
        failures.length > 0
          ? failures.map((failure) => `${failure.provider} (${failure.error})`).join("; ")
          : providers.join(", ") || "no applicable provider";
      return `[${projectName}] No results returned after attempting: ${attempted}.`;
    }

    const lines = results.slice(0, 6).map((r, i) => {
      const snippet = (r.content ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      return `${i + 1}. ${r.title}${snippet ? ` — ${snippet}` : ""}${r.source ? ` (${r.source})` : ""}${r.url ? ` ${r.url}` : ""}`;
    });

    return `[${projectName}] ${results.length} result(s) via ${providers.join(", ")}:\n${lines.join("\n")}`;
  }
}
