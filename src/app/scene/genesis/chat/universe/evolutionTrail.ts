/**
 * LÉLU — the Evolution Trail: the visual record of how this interface was
 * rebuilt, written into a real conversation so it lives in Chat Universe.
 *
 * Reads /evolution/trail/trail.json (shipped static assets, fetched only when
 * asked), writes one message per checkpoint through MultiChatStore — the same
 * store every conversation uses — and stages it as a gallery. Local only.
 */
import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import WorkspaceStewardStore from "../../../../../core/interface/WorkspaceStewardStore";

interface TrailEntry { image: string; title: string; changed?: string; working?: string; incomplete?: string; failed?: string }

const BASE = `${import.meta.env?.BASE_URL ?? "/"}evolution/trail/`.replace(/\/\/+/g, "/");

export async function openEvolutionTrail(): Promise<string | null> {
  const response = await fetch(`${BASE}trail.json`, { cache: "no-cache" }).catch(() => null);
  if (!response?.ok) return null;
  const trail = (await response.json()) as { title: string; entries: TrailEntry[] };
  const store = MultiChatStore.getInstance();
  const existing = store.listAll().find((c) => c.title === trail.title);
  const conversation = existing ?? store.create(trail.title);
  if (!existing) {
    const now = Date.now();
    trail.entries.forEach((e, i) => {
      const lines = [`## ${e.title}`, "", `![${e.title}](${BASE}${e.image})`, ""];
      if (e.changed) lines.push(`**What changed** — ${e.changed}`, "");
      if (e.working) lines.push(`**Working** — ${e.working}`, "");
      if (e.incomplete) lines.push(`**Incomplete** — ${e.incomplete}`, "");
      if (e.failed) lines.push(`**Failed / fixed** — ${e.failed}`, "");
      store.addMessage(conversation.id, { id: `trail-${i}`, role: "assistant", text: lines.join("\n"), timestamp: now - (trail.entries.length - i) * 1000, source: "local", provider: "lelu-trail" });
    });
  }
  WorkspaceStewardStore.setStage(conversation.id, "gallery");
  return conversation.id;
}
