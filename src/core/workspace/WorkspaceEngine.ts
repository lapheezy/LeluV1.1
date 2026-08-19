/**
 * ==========================================================
 * LÉLU
 * WORKSPACE ENGINE
 *
 * The controlled workspace API — the single source of truth for
 * the visual agent workspace. The agent (via WorkspaceResolver)
 * and the workspace bridge (via real agent events) drive it with
 * explicit operations; the UI subscribes and renders.
 *
 * Structured operations, not hard-coded conversational commands:
 *
 *   create · open · close · focus · minimize · maximize · resize
 *   split · stack · pin · group · reorder · render · update
 *   replace · layout · lock · save/restore layout · closeTemporary
 *
 * Views hold structured VisualSpecs (data, not HTML) and can be
 * edited in place. The engine also keeps the real agent-event log
 * used by the activity view, and snapshots previous layouts so
 * LÉLU can restore them.
 *
 * Singleton, same pattern as AIService / VoiceEngine. No UI code
 * in here — fully testable without React.
 * ==========================================================
 */

import AgentEventBus, { type AgentEvent } from "../agent/AgentEvents";
import type { VisualSpec } from "./VisualSpec";

export interface WorkspaceViewState {
  zoom: number;
  pan: { x: number; y: number };
  highlighted: string[];
  selected: string[];
  traced: string[];
  expanded: boolean;
}

export function defaultViewState(): WorkspaceViewState {
  return {
    zoom: 1,
    pan: { x: 0, y: 0 },
    highlighted: [],
    selected: [],
    traced: [],
    expanded: false,
  };
}

export type WorkspaceViewKind =
  | "diagram"
  | "chart"
  | "table"
  | "timeline"
  | "wireframe"
  | "file"
  | "browser"
  | "video"
  | "image"
  | "memory"
  | "cognition"
  | "providers"
  | "genesis"
  | "activity"
  | "design";

export interface WorkspaceView {
  id: string;
  kind: WorkspaceViewKind;
  title: string;
  spec?: VisualSpec;
  /** File/code content for file views. */
  text?: string;
  /** URL for browser/video/image views. */
  url?: string;
  createdAt: number;
  updatedAt: number;
  minimized: boolean;
  /** Pinned views survive close-temporary and are never auto-minimized. */
  pinned: boolean;
  /** Task-scoped views: cleaned up when the task ends. */
  temporary: boolean;
  /** Related views share a group id (the layout engine groups them). */
  group?: string;
  /** Resize weight: 1 = normal cell, 2 = large cell. */
  weight: number;
  /** Stack order (stack layout). */
  stackOrder: number;
  /** Agent-controlled view state (focus/highlight/trace/zoom/pan/expand). */
  viewState: WorkspaceViewState;
}

export type WorkspaceLayoutMode = "auto" | "grid" | "split" | "stack";

export interface WorkspaceSnapshot {
  views: WorkspaceView[];
  focusId: string | null;
  layout: WorkspaceLayoutMode;
  splitIds: string[];
  capturedAt: number;
}

export interface WorkspaceState {
  views: WorkspaceView[];
  focusId: string | null;
  /** Whether the workspace surface is visible. */
  visible: boolean;
  /** Two-up split mode: the two most recently focused views. */
  splitIds: string[];
  /** Layout orchestration mode. */
  layout: WorkspaceLayoutMode;
  /** User locked the layout — the engine won't reorganize until unlocked. */
  locked: boolean;
  /** User explicitly minimized → never auto-show until they re-open. */
  pinnedByUser: boolean;
  /** Recent real agent events (for the activity view). */
  events: AgentEvent[];
  lastEvent: AgentEvent | null;
  /** Previous layouts for restore. */
  history: WorkspaceSnapshot[];
}

type WorkspaceListener = (state: WorkspaceState) => void;

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export default class WorkspaceEngine {
  private static instance: WorkspaceEngine | null = null;

  private state: WorkspaceState = {
    views: [],
    focusId: null,
    visible: false,
    splitIds: [],
    layout: "auto",
    locked: false,
    pinnedByUser: false,
    events: [],
    lastEvent: null,
    history: [],
  };

  private readonly listeners = new Set<WorkspaceListener>();
  private readonly events = AgentEventBus.getInstance();
  private unsubscribeEvents: (() => void) | null = null;

  private constructor() {
    this.unsubscribeEvents = this.events.subscribe((event) => {
      this.state = {
        ...this.state,
        events: [...this.state.events, event].slice(-60),
        lastEvent: event,
      };
      this.autoShow(event);
      this.notify();
    });
  }

  public static getInstance(): WorkspaceEngine {
    if (!WorkspaceEngine.instance) {
      WorkspaceEngine.instance = new WorkspaceEngine();
    }
    return WorkspaceEngine.instance;
  }

  public getState(): WorkspaceState {
    return this.state;
  }

  public subscribe(listener: WorkspaceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Unsubscribe from the agent event bus (used by tests to reset). */
  public dispose(): void {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error("[Lélu Workspace] listener threw (contained)", error);
      }
    }
  }

  /**
   * Real agent activity reveals the workspace — unless the user
   * explicitly minimized it. Events that carry visible work
   * (task/tool/browser/diagram/memory/provider) auto-show; a plain
   * text reply does not fabricate activity.
   */
  private autoShow(event: AgentEvent): void {
    if (this.state.pinnedByUser || this.state.visible) {
      return;
    }
    const visibleWork = new Set<AgentEvent["type"]>([
      "task_started",
      "tool_selected",
      "tool_started",
      "tool_result",
      "file_opened",
      "browser_opened",
      "browser_navigation",
      "memory_retrieval",
      "memory_update",
      "provider_selected",
      "provider_status",
      "diagram_created",
      "visual_created",
      "ui_prototype_created",
    ]);
    if (visibleWork.has(event.type)) {
      this.state = { ...this.state, visible: true };
    }
  }

  /* ------------------------------------------------------------
   * Structured workspace API.
   * ---------------------------------------------------------- */

  private upsertView(input: {
    id?: string;
    kind: WorkspaceViewKind;
    title: string;
    spec?: VisualSpec;
    text?: string;
    url?: string;
    pinned?: boolean;
    temporary?: boolean;
    group?: string;
  }): WorkspaceView {
    const now = Date.now();
    const existing = input.id
      ? this.state.views.find((view) => view.id === input.id)
      : undefined;

    if (existing) {
      const updated: WorkspaceView = {
        ...existing,
        title: input.title || existing.title,
        spec: input.spec ?? existing.spec,
        text: input.text ?? existing.text,
        url: input.url ?? existing.url,
        pinned: input.pinned ?? existing.pinned,
        temporary: input.temporary ?? existing.temporary,
        group: input.group ?? existing.group,
        updatedAt: now,
        minimized: false,
      };
      this.state = {
        ...this.state,
        views: this.state.views.map((view) => (view.id === updated.id ? updated : view)),
        focusId: updated.id,
      };
      return updated;
    }

    const view: WorkspaceView = {
      id: input.id ?? makeId("view"),
      kind: input.kind,
      title: input.title,
      spec: input.spec,
      text: input.text,
      url: input.url,
      createdAt: now,
      updatedAt: now,
      minimized: false,
      pinned: input.pinned ?? false,
      temporary: input.temporary ?? false,
      group: input.group,
      weight: 1,
      stackOrder: this.state.views.length,
      viewState: defaultViewState(),
    };
    this.state = {
      ...this.state,
      views: [...this.state.views, view],
      focusId: view.id,
    };
    return view;
  }

  /** workspace.create / open / render — create or update a view and focus it. */
  public openView(input: {
    id?: string;
    kind: WorkspaceViewKind;
    title: string;
    spec?: VisualSpec;
    text?: string;
    url?: string;
    show?: boolean;
    pinned?: boolean;
    temporary?: boolean;
    group?: string;
  }): WorkspaceView {
    this.upsertView(input);
    if (input.show !== false) {
      this.state = { ...this.state, visible: true };
    }
    this.notify();
    const view = this.state.views.find((item) => item.id === this.state.focusId);
    return view ?? this.state.views[this.state.views.length - 1];
  }

  /** Alias: workspace.create (creates without forcing focus if show:false). */
  public create(input: Parameters<WorkspaceEngine["openView"]>[0]): WorkspaceView {
    return this.openView(input);
  }

  /** workspace.focus — move focus to an existing view. */
  public focusView(id: string): void {
    if (!this.state.views.some((view) => view.id === id)) {
      return;
    }
    this.state = {
      ...this.state,
      focusId: id,
      splitIds: [id, ...this.state.splitIds.filter((viewId) => viewId !== id)].slice(0, 2),
      views: this.state.views.map((view) =>
        view.id === id ? { ...view, minimized: false } : view,
      ),
      visible: true,
      pinnedByUser: false,
    };
    this.notify();
  }

  /** workspace.close — remove a view. */
  public closeView(id: string): void {
    this.state = {
      ...this.state,
      views: this.state.views.filter((view) => view.id !== id),
      splitIds: this.state.splitIds.filter((viewId) => viewId !== id),
      focusId: this.state.focusId === id ? null : this.state.focusId,
    };
    if (this.state.focusId && !this.state.views.some((view) => view.id === this.state.focusId)) {
      this.state = { ...this.state, focusId: this.state.views[0]?.id ?? null };
    }
    this.notify();
  }

  /** workspace.minimize — collapse a view (keeps it available). */
  public minimizeView(id: string): void {
    this.state = {
      ...this.state,
      views: this.state.views.map((view) => (view.id === id ? { ...view, minimized: true } : view)),
    };
    this.notify();
  }

  /** workspace.maximize — restore, enlarge, and focus a view. */
  public maximizeView(id: string): void {
    const target = this.state.views.find((view) => view.id === id);
    if (!target) {
      return;
    }
    this.state = {
      ...this.state,
      views: this.state.views.map((view) =>
        view.id === id
          ? { ...view, minimized: false, weight: 2 }
          : view.weight > 1
            ? { ...view, weight: 1 }
            : view,
      ),
      focusId: id,
      visible: true,
      pinnedByUser: false,
    };
    this.notify();
  }

  /** workspace.resize — change a view's grid weight. */
  public resizeView(id: string, weight: number): void {
    const clamped = Math.max(1, Math.min(3, Math.round(weight)));
    this.state = {
      ...this.state,
      views: this.state.views.map((view) =>
        view.id === id ? { ...view, weight: clamped } : view,
      ),
    };
    this.notify();
  }

  /** Restore a minimized view. */
  public restoreView(id: string): void {
    this.state = {
      ...this.state,
      views: this.state.views.map((view) => (view.id === id ? { ...view, minimized: false } : view)),
      focusId: id,
    };
    this.notify();
  }

  /** workspace.split — two-up split mode with the given view IDs. */
  public splitView(ids: string[]): void {
    const valid = ids.filter((id) => this.state.views.some((view) => view.id === id));
    if (valid.length === 0) {
      return;
    }
    this.state = {
      ...this.state,
      splitIds: valid.slice(0, 2),
      layout: "split",
      visible: true,
      pinnedByUser: false,
    };
    this.notify();
  }

  /** workspace.stack — layer the given views; the last one is focused on top. */
  public stackView(ids: string[]): void {
    const valid = ids.filter((id) => this.state.views.some((view) => view.id === id));
    if (valid.length === 0) {
      return;
    }
    const order = new Map<string, number>();
    valid.forEach((id, index) => order.set(id, index));
    this.state = {
      ...this.state,
      views: this.state.views.map((view) =>
        order.has(view.id) ? { ...view, stackOrder: order.get(view.id) ?? view.stackOrder, minimized: false } : view,
      ),
      layout: "stack",
      focusId: valid[valid.length - 1],
      visible: true,
      pinnedByUser: false,
    };
    this.notify();
  }

  /** workspace.pin / unpin — pinned views survive cleanup and never auto-minimize. */
  public pinView(id: string, pinned = true): void {
    this.state = {
      ...this.state,
      views: this.state.views.map((view) =>
        view.id === id ? { ...view, pinned, minimized: pinned ? false : view.minimized } : view,
      ),
    };
    this.notify();
  }

  /** workspace.group — assign related views to a group. */
  public groupViews(ids: string[], groupId?: string): void {
    const idSet = new Set(ids);
    const resolved = groupId ?? `group-${Date.now().toString(36)}`;
    this.state = {
      ...this.state,
      views: this.state.views.map((view) =>
        idSet.has(view.id) ? { ...view, group: resolved } : view,
      ),
    };
    this.notify();
  }

  /** workspace.reorder — set explicit display order (first = primary). */
  public reorderViews(ids: string[]): void {
    const valid = ids.filter((id) => this.state.views.some((view) => view.id === id));
    if (valid.length === 0) {
      return;
    }
    const order = new Map(valid.map((id, index) => [id, index]));
    const base = this.state.views.length;
    this.state = {
      ...this.state,
      views: this.state.views
        .map((view) => ({
          view,
          rank: order.has(view.id) ? order.get(view.id)! : base + view.stackOrder,
        }))
        .sort((a, b) => a.rank - b.rank)
        .map((entry, index) => ({ ...entry.view, stackOrder: index })),
    };
    this.notify();
  }

  /** workspace.update / replace — replace a view's model in place. */
  public updateView(id: string, patch: { spec?: VisualSpec; text?: string; url?: string; title?: string; kind?: WorkspaceViewKind }): void {
    this.state = {
      ...this.state,
      views: this.state.views.map((view) =>
        view.id === id
          ? {
              ...view,
              spec: patch.spec ?? view.spec,
              text: patch.text ?? view.text,
              url: patch.url ?? view.url,
              title: patch.title ?? view.title,
              kind: patch.kind ?? view.kind,
              updatedAt: Date.now(),
            }
          : view,
      ),
    };
    this.notify();
  }

  /** workspace.layout — set the orchestration mode. */
  public setLayout(mode: WorkspaceLayoutMode): void {
    this.state = { ...this.state, layout: mode };
    this.notify();
  }

  /** User override: lock the current arrangement — the engine stops reorganizing. */
  public lockLayout(locked = true): void {
    this.state = { ...this.state, locked };
    this.notify();
  }

  /** workspace.save — snapshot the current layout for later restore. */
  public saveLayout(): void {
    const snapshot: WorkspaceSnapshot = {
      views: this.state.views.map((view) => ({ ...view })),
      focusId: this.state.focusId,
      layout: this.state.layout,
      splitIds: [...this.state.splitIds],
      capturedAt: Date.now(),
    };
    this.state = {
      ...this.state,
      history: [...this.state.history, snapshot].slice(-8),
    };
    this.notify();
  }

  /** workspace.restore — restore the most recent saved layout. */
  public restoreLayout(): boolean {
    const previous = this.state.history.pop();
    if (!previous) {
      return false;
    }
    this.state = {
      ...this.state,
      views: previous.views.map((view) => ({ ...view })),
      focusId: previous.focusId,
      layout: previous.layout,
      splitIds: [...previous.splitIds],
      visible: true,
      locked: false,
    };
    this.notify();
    return true;
  }

  /** Close temporary task views (pinned views survive). */
  public closeTemporary(): number {
    const removable = this.state.views.filter(
      (view) => view.temporary && !view.pinned,
    );
    const removableIds = new Set(removable.map((view) => view.id));
    this.state = {
      ...this.state,
      views: this.state.views.filter((view) => !removableIds.has(view.id)),
      splitIds: this.state.splitIds.filter((id) => !removableIds.has(id)),
      focusId:
        this.state.focusId && removableIds.has(this.state.focusId)
          ? (this.state.views.find((view) => !removableIds.has(view.id))?.id ?? null)
          : this.state.focusId,
    };
    this.notify();
    return removable.length;
  }

  /* ------------------------------------------------------------
   * Agent-controlled view state — the agent moves THROUGH content:
   * focus elements, trace connections, expand, pan, zoom, follow.
   * ---------------------------------------------------------- */

  private patchViewState(id: string, patch: Partial<WorkspaceViewState>): void {
    this.state = {
      ...this.state,
      views: this.state.views.map((view) =>
        view.id === id
          ? { ...view, viewState: { ...view.viewState, ...patch }, updatedAt: Date.now() }
          : view,
      ),
    };
    this.notify();
  }

  /** focus — bring elements (node ids) into focus on a view. */
  public focusElements(id: string, elements: string[]): void {
    const view = this.state.views.find((item) => item.id === id);
    if (!view) {
      return;
    }
    this.state = {
      ...this.state,
      views: this.state.views.map((item) =>
        item.id === id
          ? { ...item, viewState: { ...item.viewState, highlighted: elements } }
          : item,
      ),
      focusId: id,
      visible: true,
    };
    this.notify();
  }

  /** select — mark a single element as selected. */
  public selectElement(id: string, element: string): void {
    this.patchViewState(id, { selected: [element] });
  }

  /** trace — animate the connections between the given elements. */
  public tracePath(id: string, elements: string[]): void {
    this.patchViewState(id, { traced: elements });
  }

  /** expand — expand/collapse a view's detail. */
  public expandView(id: string, expanded?: boolean): void {
    const view = this.state.views.find((item) => item.id === id);
    if (!view) {
      return;
    }
    this.patchViewState(id, { expanded: expanded ?? !view.viewState.expanded });
  }

  /** pan — shift the view content. */
  public panView(id: string, dx: number, dy: number): void {
    const view = this.state.views.find((item) => item.id === id);
    if (!view) {
      return;
    }
    this.patchViewState(id, { pan: { x: view.viewState.pan.x + dx, y: view.viewState.pan.y + dy } });
  }

  /** zoom — scale the view content. */
  public zoomView(id: string, factor: number): void {
    const view = this.state.views.find((item) => item.id === id);
    if (!view) {
      return;
    }
    this.patchViewState(id, { zoom: Math.max(0.5, Math.min(3, view.viewState.zoom * factor)) });
  }

  /** follow — focus, expand, and reset the transform on a view. */
  public follow(id: string): void {
    const view = this.state.views.find((item) => item.id === id);
    if (!view) {
      return;
    }
    this.state = {
      ...this.state,
      views: this.state.views.map((item) =>
        item.id === id
          ? { ...item, viewState: { ...defaultViewState(), expanded: true } }
          : item,
      ),
      focusId: id,
      visible: true,
    };
    this.notify();
  }

  /** return_to_core — clear all active view-state focus/traces. */
  public returnToCore(): void {
    this.state = {
      ...this.state,
      views: this.state.views.map((view) => ({ ...view, viewState: defaultViewState() })),
    };
    this.notify();
  }

  /** Toggle workspace visibility (user action). */
  public toggle(): void {
    this.state = {
      ...this.state,
      visible: !this.state.visible,
      pinnedByUser: this.state.visible ? true : this.state.pinnedByUser,
    };
    this.notify();
  }

  /** Explicit user open — cancels the pinned-minimized state. */
  public show(): void {
    this.state = { ...this.state, visible: true, pinnedByUser: false };
    this.notify();
  }

  /** Explicit user minimize — never auto-show again until re-opened. */
  public minimizeAll(): void {
    this.state = { ...this.state, visible: false, pinnedByUser: true };
    this.notify();
  }

  /** Clear all views (e.g. when a task completes and the user leaves). */
  public clear(): void {
    this.state = {
      ...this.state,
      views: [],
      splitIds: [],
      focusId: null,
      layout: "auto",
      locked: false,
    };
    this.notify();
  }

  /* ------------ convenience wrappers used by the bridge ------------ */

  public showFile(title: string, text: string, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "file", title, text, temporary });
  }

  public showBrowser(title: string, url: string, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "browser", title, url, temporary });
  }

  public showData(title: string, spec: VisualSpec, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: spec.kind === "chart" ? "chart" : "table", title, spec, temporary });
  }

  public showDiagram(title: string, spec: VisualSpec, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "diagram", title, spec, temporary });
  }

  public showProviderStatus(title: string, spec: VisualSpec, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "providers", title, spec, temporary });
  }

  public showMemory(title: string, spec: VisualSpec, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "memory", title, spec, temporary });
  }

  public showCognition(title: string, spec: VisualSpec, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "cognition", title, spec, temporary });
  }

  public showVideo(title: string, url: string, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "video", title, url, temporary });
  }

  public showImage(title: string, url: string, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "image", title, url, temporary });
  }

  public showGenesis(title: string, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "genesis", title, temporary });
  }

  public showActivity(title: string, id?: string, temporary = false): WorkspaceView {
    return this.openView({ id, kind: "activity", title, temporary });
  }
}
