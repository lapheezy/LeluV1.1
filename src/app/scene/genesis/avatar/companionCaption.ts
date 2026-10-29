/**
 * What the companion says about a real event on LÉLU's bus — or nothing.
 * Only real events: the tool that started, the page she opened, an agent
 * that finished. Kept apart from the component so it is plain logic.
 */

import type { AgentEvent } from "../../../../core/agent/AgentEvents";

/** What she says in her caption about an event, or null to stay quiet. */
export function captionForEvent(event: AgentEvent): string | null {
  switch (event.type) {
    case "tool_started":
      return event.label ? `${event.label}…` : null;
    case "browser_navigation":
      return `Reading ${hostOf(event.url)}…`;
    case "browser_opened":
      return "Opening the browser…";
    case "agent_started":
      return `${event.agent} is on it…`;
    case "agent_completed":
      return `${event.agent} finished.`;
    case "agent_failed":
      return `${event.agent} ran into a problem.`;
    case "task_completed":
      return event.label ? `Done — ${event.label}` : "Done.";
    case "task_failed":
      return event.label ? `That failed: ${event.label}` : "That failed.";
    default:
      return null;
  }
}

function hostOf(url: string | undefined): string {
  if (!url) return "the page";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the page";
  }
}

