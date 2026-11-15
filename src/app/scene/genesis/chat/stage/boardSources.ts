/**
 * LÉLU — browser → research board.
 *
 * A page the person (or LÉLU) is reading becomes a source node on the
 * conversation's board: written into the SAME per-conversation board edits
 * the board itself persists, then announced so an open board merges it in.
 */
import KvStore from "../../../../../core/storage/KvStore";

export const BOARD_SOURCE_EVENT = "lelu-board-source";

export function addSourceToBoard(conversationId: string, page: { title: string; href: string }): void {
  const key = `lelu.board.v1.${conversationId}`;
  const store = KvStore.getInstance();
  // The board's own node shape, kept loose here so this module does not pull
  // React Flow into the browser's chunk.
  type Note = { id: string; type: "card"; position: { x: number; y: number }; data: { kind: string; title: string; href?: string; detail?: string } };
  const edits = (store.get<Record<string, unknown>>(key) ?? {}) as { notes?: Note[] };
  const notes = edits.notes ?? [];
  if (!notes.some((n) => n.data?.href === page.href)) {
    notes.push({
      id: `src-${Date.now()}`,
      type: "card",
      position: { x: -360, y: notes.length * 120 },
      data: { kind: "link", title: page.title, href: page.href, detail: "Added from the browser" },
    });
  }
  store.set(key, { positions: {}, labels: {}, removed: [], edges: [], ...edits, notes });
  window.dispatchEvent(new CustomEvent(BOARD_SOURCE_EVENT, { detail: { conversationId } }));
}
