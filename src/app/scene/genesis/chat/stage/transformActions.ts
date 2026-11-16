/**
 * LÉLU — "turn this into a document / deck / diagram / chart / workbook /
 * film": one function, used by the environments' buttons and by LÉLU
 * (UIActionBus transform_conversation ← workspace.transform tool ← her
 * local intent path). Builds a real Studio artifact from the stored
 * conversation; no model call.
 */
import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import type { TransformTarget } from "../../../../../core/interface/WorkspaceSteward";
import { buildStage, contentMessages } from "./conversationModel";
import { tableToChart, tableToWorkbook, tablesOf, toDeck, toDocument, toFilmScenes, toMermaid } from "./transforms";
import { createWork } from "./works";

export function transformConversation(conversationId: string, target: TransformTarget): { ok: boolean; detail: string; artifactId?: string } {
  const c = MultiChatStore.getInstance().get(conversationId);
  if (!c) return { ok: false, detail: "That conversation no longer exists." };
  if (!c.messages.length) return { ok: false, detail: "The conversation is empty — there is nothing to turn into work yet." };
  const model = buildStage(c.title, contentMessages(c.messages));
  const title = c.title || "Conversation";
  let spec: unknown;
  let note: string;
  switch (target) {
    case "document": spec = toDocument(model); note = "Wrote a document from this conversation"; break;
    case "deck": spec = toDeck(model); note = "Built a slide deck from this conversation"; break;
    case "diagram": spec = { kind: "visual", medium: "diagram", title: `${title} — map`, program: { source: toMermaid(model) } }; note = "Drew a diagram of this conversation"; break;
    case "workbook": {
      const tables = tablesOf(model);
      if (!tables.length) return { ok: false, detail: "There are no tables in this conversation to put in a workbook." };
      spec = tableToWorkbook(`${title} — data`, tables); note = "Collected this conversation's tables into a workbook"; break;
    }
    case "chart": {
      const chart = tablesOf(model).map(tableToChart).find(Boolean);
      if (!chart) return { ok: false, detail: "No table in this conversation has a numeric column to chart. Live public data can be charted from the Data workspace." };
      spec = { kind: "visual", medium: "chart", title: chart.title || `${title} — chart`, program: chart }; note = "Charted a table from this conversation"; break;
    }
    case "film": spec = { kind: "visual", medium: "video", title: `${title} — film`, program: { scenes: toFilmScenes(model), width: 960, height: 540, fps: 24, transition: "fade", soundtrack: "calm" } }; note = "Storyboarded a film from this conversation"; break;
    default: return { ok: false, detail: `Unknown target ${String(target)}.` };
  }
  const r = createWork(conversationId, spec, note);
  return r.ok ? { ok: true, detail: `${note}: “${r.artifact.title}” [${r.artifact.id}] — versioned in the Studio, exportable. No model call.`, artifactId: r.artifact.id } : { ok: false, detail: `Nothing was created: ${r.reason}.` };
}
