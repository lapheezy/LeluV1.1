/**
 * ==========================================================
 * LÉLU — WHAT SHE DID FOR THIS REPLY (pure)
 *
 * A turn's activity, built ONLY from real AgentEventBus events
 * that belong to the turn's conversation: searches that ran,
 * pages that were opened, memories recalled, tools called, what
 * she said she was doing, instructions the user added mid-way.
 * Nothing here is inferred or animated — a step exists because
 * an event said it happened, and its status is the event's.
 *
 * The record is plain JSON so it can be stored on the reply and
 * shown again when the user comes back to the conversation.
 * ==========================================================
 */

import type { AgentEvent, AgentResultItem } from "../agent/AgentEvents";

export type ActivityKind = "search" | "browse" | "memory" | "tool" | "agent" | "narration" | "steer" | "provider";
export type StepStatus = "running" | "done" | "failed" | "info";

export interface ActivityStep {
  id: string;
  kind: ActivityKind;
  /** Which tool the events named, used to pair a result with its start. */
  tool?: string;
  label: string;
  detail?: string;
  status: StepStatus;
  query?: string;
  url?: string;
  count?: number;
}

export interface ActivitySource {
  title: string;
  url?: string;
  source?: string;
  excerpt?: string;
}

export interface ActivityPage {
  url: string;
  title?: string;
  excerpt?: string;
  status: "loading" | "read" | "blocked" | "error";
  error?: string;
}

export interface ChatActivity {
  status: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  steps: ActivityStep[];
  sources: ActivitySource[];
  pages: ActivityPage[];
}

const MAX_STEPS = 60;
const MAX_SOURCES = 24;
const MAX_PAGES = 12;
const MAX_EXCERPT = 1200;

export function emptyActivity(now = Date.now()): ChatActivity {
  return { status: "running", startedAt: now, steps: [], sources: [], pages: [] };
}

function host(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 60);
  }
}

function isUrl(text: string | undefined): text is string {
  return Boolean(text && /^https?:\/\//i.test(text));
}

function kindForTool(tool: string): ActivityKind {
  if (/^research/.test(tool)) return "search";
  if (/^browser/.test(tool)) return "browse";
  if (/^memory/.test(tool)) return "memory";
  if (/^agent:/.test(tool)) return "agent";
  return "tool";
}

function addSources(list: ActivitySource[], items: AgentResultItem[] | undefined): ActivitySource[] {
  if (!items?.length) return list;
  const next = [...list];
  for (const item of items) {
    const title = (item.title ?? item.url ?? "").trim();
    if (!title) continue;
    const duplicate = next.some((have) => (item.url && have.url === item.url) || (!item.url && have.title === title));
    if (duplicate) continue;
    next.push({
      title: title.slice(0, 160),
      url: item.url,
      source: item.source ?? (item.url ? host(item.url) : undefined),
      excerpt: (item.content ?? "").replace(/\s+/g, " ").trim().slice(0, 280) || undefined,
    });
  }
  return next.slice(0, MAX_SOURCES);
}

function lastRunning(steps: ActivityStep[], tool: string): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].tool === tool && steps[index].status === "running") return index;
  }
  return -1;
}

let seq = 0;
function stepId(): string {
  seq += 1;
  return `s${Date.now().toString(36)}${seq}`;
}

function push(activity: ChatActivity, step: Omit<ActivityStep, "id">): ChatActivity {
  return { ...activity, steps: [...activity.steps, { id: stepId(), ...step }].slice(-MAX_STEPS) };
}

function patchStep(activity: ChatActivity, index: number, patch: Partial<ActivityStep>): ChatActivity {
  const steps = [...activity.steps];
  steps[index] = { ...steps[index], ...patch };
  return { ...activity, steps };
}

function upsertPage(activity: ChatActivity, page: ActivityPage, from?: string): ChatActivity {
  const pages = [...activity.pages];
  const at = pages.findIndex((have) => have.url === page.url || (from !== undefined && have.url === from));
  if (at >= 0) pages[at] = { ...pages[at], ...page };
  else pages.push(page);
  return { ...activity, pages: pages.slice(-MAX_PAGES) };
}

/** Fold one real event into the turn's activity. Unrelated events change nothing. */
export function reduceActivity(activity: ChatActivity, event: AgentEvent): ChatActivity {
  switch (event.type) {
    case "tool_started": {
      const kind = kindForTool(event.tool);
      if (kind === "agent") return activity; // agent_started describes it better
      const label = event.label?.trim() || `Running ${event.tool}`;
      const query = kind === "search" ? label.replace(/^Searching\s+(the web for\s+)?/i, "").replace(/^[“"]|[”"]$/g, "") : undefined;
      return push(activity, { kind, tool: event.tool, label, status: "running", ...(query ? { query } : {}) });
    }
    case "tool_result": {
      const kind = kindForTool(event.tool);
      const count = Array.isArray(event.results) ? event.results.length : undefined;
      const failed = event.status === "error" || event.status === "blocked";
      const detail = (event.result ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || undefined;
      const index = lastRunning(activity.steps, event.tool);
      // browser.read reports the page twice — browser_result, then its
      // tool_result. The page step already says how it went; a second
      // "finished" row counted every failed page as two issues.
      if (index < 0 && kind === "browse" && event.query && activity.steps.some((step) => step.kind === "browse" && step.url === event.query)) {
        return { ...activity, sources: addSources(activity.sources, event.results) };
      }
      let next =
        index >= 0
          ? patchStep(activity, index, { status: failed ? "failed" : "done", count, detail, ...(event.query && kind === "search" ? { query: event.query } : {}) })
          : push(activity, {
              kind,
              tool: event.tool,
              label: kind === "search" ? `Searched for “${event.query ?? ""}”` : `${event.tool} finished`,
              status: failed ? "failed" : "done",
              count,
              detail,
            });
      next = { ...next, sources: addSources(next.sources, event.results) };
      return next;
    }
    case "tool_failed": {
      const index = lastRunning(activity.steps, event.tool);
      return index >= 0
        ? patchStep(activity, index, { status: "failed", detail: event.error?.slice(0, 200) })
        : push(activity, { kind: kindForTool(event.tool), tool: event.tool, label: `${event.tool} failed`, status: "failed", detail: event.error?.slice(0, 200) });
    }
    case "browser_opened": {
      if (!isUrl(event.url)) return activity; // a sentence, not a page
      let next = upsertPage(activity, { url: event.url, status: "loading" });
      if (lastRunning(next.steps, "browser") < 0) {
        next = push(next, { kind: "browse", tool: "browser", label: `Opening ${host(event.url)}`, status: "running", url: event.url });
      } else {
        next = patchStep(next, lastRunning(next.steps, "browser"), { url: event.url });
      }
      return next;
    }
    case "browser_navigation": {
      if (!isUrl(event.url)) return activity;
      const loading = [...activity.pages].reverse().find((page) => page.status === "loading");
      return upsertPage(activity, { url: event.url, status: "loading" }, loading?.url);
    }
    case "browser_result": {
      if (!isUrl(event.url)) return activity;
      const status = event.status;
      let next = upsertPage(activity, {
        url: event.url,
        title: event.title,
        excerpt: event.excerpt?.slice(0, MAX_EXCERPT),
        status,
        error: event.error,
      });
      const index = lastRunning(next.steps, "browser");
      if (index >= 0) {
        next = patchStep(next, index, {
          status: status === "read" ? "done" : "failed",
          label: status === "read" ? `Read ${event.title?.trim() || host(event.url)}` : `Could not read ${host(event.url)}`,
          url: event.url,
          detail: status === "read" ? undefined : event.error?.slice(0, 200),
        });
      }
      if (status === "read") {
        next = { ...next, sources: addSources(next.sources, [{ title: event.title || event.url, url: event.url, content: event.excerpt }]) };
      }
      return next;
    }
    case "memory_retrieval":
      return push(activity, {
        kind: "memory",
        label: event.count > 0 ? `Recalled ${event.count} related ${event.count === 1 ? "memory" : "memories"}` : "Checked memory — nothing related",
        status: "done",
        count: event.count,
      });
    case "agent_started":
      return push(activity, { kind: "agent", tool: `agent:${event.agent}`, label: `Asked ${event.agent}`, detail: event.objective.slice(0, 160), status: "running" });
    case "agent_completed": {
      const index = lastRunning(activity.steps, `agent:${event.agent}`);
      return index >= 0 ? patchStep(activity, index, { status: "done", detail: event.resultPreview?.slice(0, 200) }) : activity;
    }
    case "agent_failed": {
      const index = lastRunning(activity.steps, `agent:${event.agent}`);
      return index >= 0 ? patchStep(activity, index, { status: "failed", detail: event.error?.slice(0, 200) }) : activity;
    }
    case "tool_narration":
      return push(activity, { kind: "narration", label: event.text.slice(0, 300), status: "info" });
    case "user_steering":
      return push(activity, { kind: "steer", label: `Took in your new instruction: “${event.text.slice(0, 120)}”`, status: "info" });
    case "provider_status":
      // Only a fallback is worth telling: the model she was using failed.
      return /fail/i.test(event.status)
        ? push(activity, { kind: "provider", label: `${event.provider} didn't answer — trying the next model`, status: "info" })
        : activity;
    case "file_opened":
      return push(activity, { kind: "tool", label: `Opened ${event.path}`, status: "done" });
    case "file_changed":
      return push(activity, { kind: "tool", label: `Updated ${event.path}`, status: "done" });
    default:
      return activity;
  }
}

/** The turn is over: nothing is still "running", and the outcome is recorded. */
export function finishActivity(activity: ChatActivity, failed = false, now = Date.now()): ChatActivity {
  return {
    ...activity,
    status: failed ? "failed" : "done",
    finishedAt: now,
    steps: activity.steps.map((step) => (step.status === "running" ? { ...step, status: failed ? "failed" : "done" } : step)),
    pages: activity.pages.map((page) => (page.status === "loading" ? { ...page, status: "error", error: page.error ?? "Did not finish loading." } : page)),
  };
}

/** Anything worth a card? Memory checks alone are routine; tools, pages and fallbacks are not. */
export function hasVisibleActivity(activity: ChatActivity | undefined | null): activity is ChatActivity {
  if (!activity) return false;
  return activity.steps.some((step) => step.kind !== "memory" && step.kind !== "narration") || activity.pages.length > 0;
}

export interface ActivitySummary {
  icon: string;
  title: string;
  facts: string[];
  /** The step happening right now, for the collapsed line. */
  current?: string;
  issues: number;
}

export function summarizeActivity(activity: ChatActivity): ActivitySummary {
  const searches = activity.steps.filter((step) => step.kind === "search").length;
  const reads = activity.pages.filter((page) => page.status === "read").length;
  const opened = activity.pages.length;
  const tools = activity.steps.filter((step) => step.kind === "tool" || step.kind === "agent").length;
  const issues = activity.steps.filter((step) => step.status === "failed").length;
  const icon = opened > 0 ? "🌐" : searches > 0 ? "🔎" : tools > 0 ? "⚙️" : "🧠";
  const title = opened > 0 && searches > 0 ? "Web research" : opened > 0 ? "Reading sources" : searches > 0 ? "Web research" : tools > 0 ? "Working with tools" : "Thinking it through";
  const facts: string[] = [];
  if (searches) facts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
  if (activity.sources.length) facts.push(`${activity.sources.length} ${activity.sources.length === 1 ? "source" : "sources"} found`);
  if (opened) facts.push(`${reads} of ${opened} ${opened === 1 ? "page" : "pages"} read`);
  if (tools) facts.push(`${tools} ${tools === 1 ? "tool" : "tools"} used`);
  const running = [...activity.steps].reverse().find((step) => step.status === "running");
  return { icon, title, facts, current: running?.label, issues };
}
