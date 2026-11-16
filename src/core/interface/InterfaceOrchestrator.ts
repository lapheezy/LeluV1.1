/**
 * ==========================================================
 * LÉLU CORE → SPATIAL INTELLIGENCE → INTERFACE ORCHESTRATION ENGINE
 *
 * LÉLU's native control over her own visual environment —
 * windows, typography, themes, materials, lighting, backdrop
 * and the 3D Cosmos — with the user as the final authority.
 *
 *   A. UNDERSTAND   inspect()        the live environment, windows,
 *                                    their relationships, design
 *                                    system, scene, workspaces
 *   B. CONSTRUCT    propose()        build the complete next state
 *                                    in ISOLATION and preview it
 *                                    (theme shown temporarily, new
 *                                    window geometry as outlines)
 *   C. AUTHORIZE    decide()         a human approves → applied,
 *                                    versioned, persisted, undoable
 *
 * Invariants:
 *   • Nothing LÉLU proposes changes the live interface until a
 *     human approves it. No tool can approve: decide() is called
 *     by the consent bar, and the timeline's existing Approve /
 *     Reject buttons reach it through `approval_resolved`.
 *   • Destructive changes (closing windows, removing several or
 *     linked scene objects, deleting a saved theme) need a SECOND,
 *     explicit confirmation — a timeline "approve" alone is not
 *     enough for them.
 *   • A proposal built on an older live version is never applied
 *     over newer changes: it becomes "stale" and must be re-made.
 *   • This engine edits interface STATE only. It cannot touch
 *     application code, credentials, security settings or project
 *     data; those stay behind project.* and their own authorization.
 *   • Every applied change is a snapshot: undo / redo / restore.
 *
 * The React layer attaches an InterfaceHost — the live window
 * manager (GenesisCore modules + chat) — so this engine never
 * imports React and is fully testable.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import KvStore from "../storage/KvStore";
import {
  DEFAULT_TOKENS,
  designWarnings,
  diffTokens,
  mergeTokens,
  tokensEqual,
  type DeepPartial,
  type DesignTokens,
} from "./DesignTokens";
import { describeFontLibrary, getFont, validateCustomFont, type CustomFont } from "./FontLibrary";
import { ENVIRONMENT_PRESETS, TYPOGRAPHY_SYSTEMS, getPreset, recommendEnvironment, type EnvironmentRecommendation } from "./EnvironmentLibrary";
import { EMPTY_SCENE, SCENE_KINDS, applySceneOps, describeScene, type SceneCamera, type SceneOp, type SceneState, type WorkspaceRef } from "./SceneModel";
import {
  contradictedClaims,
  describeRelationships,
  describeWindows,
  makeViewport,
  planWindows,
  relationshipsOf,
  type Viewport,
  type WindowDescriptor,
  type WindowLayout,
  type WindowOp,
} from "./SpatialModel";

/* ------------------------------------------------------------------ *
 * TYPES
 * ------------------------------------------------------------------ */

export type InterfaceScope = "layout" | "typography" | "theme" | "materials" | "environment" | "scene" | "library";
export const INTERFACE_SCOPES: InterfaceScope[] = ["layout", "typography", "theme", "materials", "environment", "scene", "library"];
export type ScopePolicy = "ask" | "blocked";

export interface InterfaceConfig {
  version: number;
  name: string;
  description: string;
  presetId: string | null;
  tokens: DesignTokens;
  customFonts: CustomFont[];
  scene: SceneState;
  /** The last approved window layout (empty = never arranged by LÉLU). */
  windows: Record<string, WindowLayout>;
  updatedAt: number;
}

export interface ChangeSet {
  /** What the user asked for, in LÉLU's words — shown on the consent bar. */
  description: string;
  /** Why this design works. */
  rationale?: string;
  /** Environment preset id or saved theme id to start from. */
  preset?: string;
  /** Start from the original Genesis tokens instead of the live ones. */
  resetTokens?: boolean;
  /** Named typography system (see capabilities). */
  typographySystem?: string;
  tokens?: DeepPartial<DesignTokens>;
  customFonts?: unknown[];
  windows?: WindowOp[];
  scene?: SceneOp[];
  environment?: { name?: string; description?: string };
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "superseded" | "stale";
export type ProposalKind = "change" | "restore" | "delete-theme";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  origin: "lelu" | "user";
  createdAt: number;
  description: string;
  rationale?: string;
  changes: string[];
  notes: string[];
  warnings: string[];
  scopes: InterfaceScope[];
  destructive: boolean;
  destructiveReasons: string[];
  baseVersion: number;
  next: InterfaceConfig;
  windowsChanged: boolean;
  status: ProposalStatus;
  decidedAt?: number;
  decisionNote?: string;
  /** Set by the consent bar's explicit second confirmation. */
  destructiveConfirmed?: boolean;
  themeId?: string;
}

export interface Snapshot {
  version: number;
  label: string;
  at: number;
  config: InterfaceConfig;
}

export interface SavedTheme {
  id: string;
  name: string;
  description: string;
  tokens: DesignTokens;
  customFonts: CustomFont[];
  createdAt: number;
}

export interface InterfaceHost {
  windows(): WindowDescriptor[];
  viewport(): Viewport;
  workspaces(): WorkspaceRef[];
  applyWindows(layout: Record<string, WindowLayout>): void;
  applyCamera?(camera: SceneCamera): void;
}

export interface InterfaceSnapshotView {
  live: InterfaceConfig;
  effective: InterfaceConfig;
  previewing: Proposal | null;
  pending: Proposal[];
  history: Array<Pick<Snapshot, "version" | "label" | "at">>;
  cursor: number;
  canUndo: boolean;
  canRedo: boolean;
  themes: SavedTheme[];
  scopes: Record<InterfaceScope, ScopePolicy>;
  lastApplied: { proposalId: string; at: number; description: string } | null;
}

type Listener = (view: InterfaceSnapshotView) => void;

export const INTERFACE_STORAGE_KEYS = {
  live: "lelu.interface.live.v1",
  history: "lelu.interface.history.v1",
  proposals: "lelu.interface.proposals.v1",
  themes: "lelu.interface.themes.v1",
  scopes: "lelu.interface.scopes.v1",
  observed: "lelu.interface.windows.observed.v1",
};
const KEYS = INTERFACE_STORAGE_KEYS;

const MAX_HISTORY = 40;
const MAX_PROPOSALS = 30;
const TASK_ID = "interface";

export function defaultConfig(): InterfaceConfig {
  return {
    version: 0,
    name: "Genesis",
    description: "The original LÉLU Cosmos.",
    presetId: "genesis",
    tokens: structuredClone(DEFAULT_TOKENS),
    customFonts: [],
    scene: structuredClone(EMPTY_SCENE),
    windows: {},
    updatedAt: 0,
  };
}

/** True when the config would render exactly the original Genesis look. */
export function isDefaultLook(config: InterfaceConfig): boolean {
  return tokensEqual(config.tokens, DEFAULT_TOKENS) && config.customFonts.length === 0;
}

/* ------------------------------------------------------------------ *
 * ENGINE
 * ------------------------------------------------------------------ */

export default class InterfaceOrchestrator {
  private static instance: InterfaceOrchestrator | null = null;

  private live: InterfaceConfig;
  private history: Snapshot[];
  private cursor: number;
  private proposals: Proposal[];
  private themes: SavedTheme[];
  private scopes: Record<InterfaceScope, ScopePolicy>;
  private previewId: string | null = null;
  private host: InterfaceHost | null = null;
  private listeners = new Set<Listener>();
  private suppressEvent: string | null = null;
  private lastApplied: InterfaceSnapshotView["lastApplied"] = null;
  private cachedView: InterfaceSnapshotView | null = null;
  /** Monotonic: a version number is never reused, even after undo. */
  private versionCounter: number;

  private constructor() {
    const kv = KvStore.getInstance();
    this.live = this.revive(kv.get<InterfaceConfig>(KEYS.live)) ?? defaultConfig();
    const storedHistory = kv.get<{ snapshots: Snapshot[]; cursor: number; counter: number }>(KEYS.history);
    if (storedHistory?.snapshots?.length) {
      this.history = storedHistory.snapshots.map((s) => ({ ...s, config: this.revive(s.config) ?? defaultConfig() }));
      this.cursor = Math.min(Math.max(0, storedHistory.cursor), this.history.length - 1);
      this.versionCounter = Math.max(storedHistory.counter ?? 0, ...this.history.map((s) => s.version));
    } else {
      this.history = [{ version: this.live.version, label: this.live.version === 0 ? "Original Genesis" : this.live.name, at: Date.now(), config: structuredClone(this.live) }];
      this.cursor = 0;
      this.versionCounter = this.live.version;
    }
    // Pending proposals survive a reload, but are never auto-previewed:
    // on restart the user sees the applied state first.
    this.proposals = kv.get<Proposal[]>(KEYS.proposals) ?? [];
    this.themes = kv.get<SavedTheme[]>(KEYS.themes) ?? [];
    this.scopes = { ...Object.fromEntries(INTERFACE_SCOPES.map((s) => [s, "ask"])), ...(kv.get<Record<InterfaceScope, ScopePolicy>>(KEYS.scopes) ?? {}) } as Record<InterfaceScope, ScopePolicy>;

    AgentEventBus.getInstance().subscribe((event) => {
      if (event.type !== "approval_resolved" || !event.approvalId.startsWith("iface-")) return;
      if (this.suppressEvent === event.approvalId) return;
      // The timeline's buttons. "modified" means the human wanted something
      // else, which LÉLU cannot know — it is a rejection.
      this.resolve(event.approvalId, event.decision === "approved" ? "approved" : "rejected", "timeline");
    });
  }

  public static getInstance(): InterfaceOrchestrator {
    if (!InterfaceOrchestrator.instance) InterfaceOrchestrator.instance = new InterfaceOrchestrator();
    return InterfaceOrchestrator.instance;
  }

  /** Tests only: forget the singleton (storage is left as-is). */
  public static resetForTests(): void {
    InterfaceOrchestrator.instance = null;
  }

  private revive(config: InterfaceConfig | null): InterfaceConfig | null {
    if (!config || typeof config !== "object" || !config.tokens) return null;
    const custom = (config.customFonts ?? []).map((f) => f.id);
    return {
      ...defaultConfig(),
      ...config,
      // Re-validate persisted tokens: a schema change never breaks boot.
      tokens: mergeTokens(DEFAULT_TOKENS, config.tokens as DeepPartial<DesignTokens>, custom).tokens,
      scene: config.scene?.objects ? config.scene : structuredClone(EMPTY_SCENE),
      windows: config.windows ?? {},
    };
  }

  /* ----------------------------- host ------------------------------ */

  /** The live window manager registers itself here (front end). */
  public attachHost(host: InterfaceHost): () => void {
    this.host = host;
    return () => {
      if (this.host === host) this.host = null;
    };
  }

  public hasHost(): boolean {
    return this.host !== null;
  }

  /* --------------------------- observers --------------------------- */

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.cachedView = null;
    const view = this.view();
    for (const listener of this.listeners) {
      try {
        listener(view);
      } catch (error) {
        console.error("[Interface] listener failed (contained)", error);
      }
    }
  }

  /** Stable between changes, so React can use it as an external store. */
  public view(): InterfaceSnapshotView {
    if (this.cachedView) return this.cachedView;
    const previewing = this.previewId ? this.proposals.find((p) => p.id === this.previewId && p.status === "pending") ?? null : null;
    this.cachedView = {
      live: this.live,
      effective: previewing ? previewing.next : this.live,
      previewing,
      pending: this.proposals.filter((p) => p.status === "pending"),
      history: this.history.map(({ version, label, at }) => ({ version, label, at })),
      cursor: this.cursor,
      canUndo: this.cursor > 0,
      canRedo: this.cursor < this.history.length - 1,
      themes: this.themes,
      scopes: this.scopes,
      lastApplied: this.lastApplied,
    };
    return this.cachedView;
  }

  public getLive(): InterfaceConfig {
    return this.live;
  }

  public getProposal(id: string): Proposal | undefined {
    return this.proposals.find((p) => p.id === id);
  }

  /* ---------------------------- inspect ---------------------------- */

  public inspect(section: "all" | "environment" | "windows" | "design" | "scene" | "history" | "capabilities" = "all"): { text: string; data: Record<string, unknown> } {
    const windows = this.host?.windows() ?? [];
    const viewport = this.host?.viewport() ?? makeViewport(1280, 800);
    const workspaces = this.host?.workspaces() ?? [];
    const relationships = relationshipsOf(windows.map((w) => ({ id: w.id, rect: w.rect, presentation: w.presentation })));
    const t = this.live.tokens;
    const parts: string[] = [];
    const want = (s: string) => section === "all" || section === s;

    if (want("environment")) {
      parts.push(
        `ENVIRONMENT: "${this.live.name}" (version ${this.live.version}${this.live.presetId ? `, from preset ${this.live.presetId}` : ""}${isDefaultLook(this.live) ? ", original Genesis look" : ""}). ${this.live.description}\n` +
          `Viewport ${viewport.width}×${viewport.height} (${viewport.mobile ? "phone — chat is full-screen, one tool sheet at a time" : "desktop"}). Backdrop: ${t.environment.backdrop}. ` +
          `Workspaces: ${workspaces.length ? workspaces.map((w) => `${w.kind} ${w.id} "${w.title}"${w.active ? " (active)" : ""}`).join("; ") : "none"}.` +
          (this.host ? "" : "\nThe Cosmos window manager is not mounted in this runtime, so window operations cannot be planned here."),
      );
    }
    if (want("windows")) {
      parts.push(`WINDOWS:\n${describeWindows(windows)}\nRELATIONSHIPS:\n${describeRelationships(relationships)}`);
    }
    if (want("design")) {
      parts.push(
        `DESIGN: fonts body=${t.typography.bodyFont} heading=${t.typography.headingFont} mono=${t.typography.monoFont}, base ${t.typography.baseSize}px ×${t.typography.scaleRatio} scale, weights ${t.typography.bodyWeight}/${t.typography.headingWeight}, tracking ${t.typography.letterSpacing}em, line-height ${t.typography.lineHeight}, align ${t.typography.textAlign}, headings ${t.typography.headingCase}, text animation ${t.typography.textAnimation}. ` +
          `Palette bg ${t.palette.background} surface ${t.palette.surface} text ${t.palette.text} accent ${t.palette.accent}. ` +
          `Materials: opacity ${t.materials.surfaceOpacity}, blur ${t.materials.blur}px, ${t.materials.windowShape} windows r${t.materials.radius}, texture ${t.materials.texture}, shadow ${t.materials.shadowDepth}, glow ${t.materials.glowStrength}, density ${t.materials.density}. ` +
          `Lighting ambient ${t.lighting.ambient} key ${t.lighting.keyIntensity} ${t.lighting.keyColor}, fog ${t.lighting.fogDensity}. Motion ${t.motion.profile} ${t.motion.durationMs}ms float ${t.motion.floatAmplitude}px.` +
          (t.typography.rationale ? `\nTypography rationale: ${t.typography.rationale}` : ""),
      );
    }
    if (want("scene")) parts.push(`COSMOS SCENE:\n${describeScene(this.live.scene)}`);
    if (want("history")) {
      const pending = this.proposals.filter((p) => p.status === "pending");
      parts.push(
        `HISTORY: ${this.history.map((s, i) => `v${s.version} ${s.label}${i === this.cursor ? " ← live" : ""}`).join(" · ")}\n` +
          `PENDING PROPOSALS: ${pending.length ? pending.map((p) => `${p.id} "${p.description}"`).join("; ") : "none"}\n` +
          `SAVED THEMES: ${this.themes.length ? this.themes.map((th) => `${th.id} "${th.name}"`).join(", ") : "none"}\n` +
          `SCOPES: ${INTERFACE_SCOPES.map((s) => `${s}=${this.scopes[s]}`).join(", ")}`,
      );
    }
    if (want("capabilities")) {
      parts.push(
        `CAPABILITIES:\nPresets (starting points — you may invent entirely new environments with tokens + scene): ${ENVIRONMENT_PRESETS.map((p) => `${p.id} (${p.description})`).join("; ")}\n` +
          `Typography systems: ${Object.entries(TYPOGRAPHY_SYSTEMS).map(([id, s]) => `${id}: ${s.rationale}`).join("\n")}\n` +
          `Fonts:\n${describeFontLibrary()}\nCustom fonts: { family, url (https .woff2/.woff/.ttf/.otf), licence (OFL-1.1, Apache-2.0, MIT, Ubuntu, user-owned, licensed) }.\n` +
          `Scene kinds: ${SCENE_KINDS.join(", ")} (animations none/spin/orbit/bob/pulse/sway/drift; link objects to a conversation/module/project to make them open it). ` +
          `Scene op "populate" from "workspaces" builds one object per active workspace.\n` +
          `Window ops: move, resize, transform (rotation ±12°), open, minimize, maximize, restore, close, raise, group, ungroup, arrange (relations | grid | columns | focus | cascade | organic | fit). Relations: beside, left-of, right-of, above, below.\n` +
          `Backdrops: cosmos (original sky), gradient, nebula, garden, river, studio, plain. Window shapes: rect, rounded, pill, organic. Textures: none, grain, paper, silk, stars, leaf, water.\n` +
          `Out of scope here: application code, credentials, security settings and project data — those go through project.* with their own authorization.`,
      );
    }

    return {
      text: parts.join("\n\n"),
      data: {
        environment: { name: this.live.name, description: this.live.description, version: this.live.version, presetId: this.live.presetId, default: isDefaultLook(this.live) },
        viewport,
        windows,
        relationships,
        workspaces,
        tokens: this.live.tokens,
        scene: this.live.scene,
        pending: this.proposals.filter((p) => p.status === "pending").map((p) => ({ id: p.id, description: p.description })),
        history: this.history.map(({ version, label, at }) => ({ version, label, at })),
        themes: this.themes.map(({ id, name }) => ({ id, name })),
        scopes: this.scopes,
      },
    };
  }

  public recommend(request: string): EnvironmentRecommendation {
    return recommendEnvironment(request);
  }

  /* ---------------------------- propose ---------------------------- */

  /**
   * Build the complete next interface in isolation and stage it for the
   * user's decision. Never changes the live interface.
   */
  public propose(change: ChangeSet, options: { origin?: "lelu" | "user"; preview?: boolean } = {}): { ok: boolean; proposal?: Proposal; reason?: string; issues: string[] } {
    const issues: string[] = [];
    const notes: string[] = [];
    const changes: string[] = [];
    const description = typeof change?.description === "string" && change.description.trim() ? change.description.trim().slice(0, 300) : "";
    if (!description) return { ok: false, reason: "a proposal needs a description of what it changes, for the user to read", issues };

    const before = this.live;
    const next: InterfaceConfig = structuredClone(before);
    next.updatedAt = Date.now();

    // 1. custom fonts first, so tokens can reference them
    for (const raw of change.customFonts ?? []) {
      const { font, error } = validateCustomFont(raw);
      if (error) issues.push(`custom font refused: ${error}`);
      else if (font && !next.customFonts.some((f) => f.id === font.id)) {
        next.customFonts.push(font);
        changes.push(`add custom font "${font.family}" (${font.licence}) as ${font.id}`);
      }
    }
    const fontIds = next.customFonts.map((f) => f.id);

    // 2. tokens: base → preset/theme → typography system → patch
    let tokens: DesignTokens = change.resetTokens ? structuredClone(DEFAULT_TOKENS) : structuredClone(before.tokens);
    let presetScene: SceneOp[] = [];
    let presetWindows: WindowOp[] = [];
    if (change.preset) {
      const preset = getPreset(change.preset);
      const saved = this.themes.find((th) => th.id === change.preset);
      if (preset) {
        const merged = mergeTokens(DEFAULT_TOKENS, preset.tokens, fontIds);
        tokens = merged.tokens;
        next.presetId = preset.id;
        next.name = preset.name;
        next.description = preset.description;
        presetScene = (preset.scene ?? []).map((op) => (op.op === "add" ? { ...op, object: { ...op.object, source: `preset:${preset.id}` } } : op));
        presetWindows = preset.windows ?? [];
        notes.push(`starts from the "${preset.name}" environment`);
      } else if (saved) {
        tokens = structuredClone(saved.tokens);
        for (const font of saved.customFonts) if (!next.customFonts.some((f) => f.id === font.id)) next.customFonts.push(font);
        next.presetId = saved.id;
        next.name = saved.name;
        next.description = saved.description;
        notes.push(`starts from the saved theme "${saved.name}"`);
      } else {
        issues.push(`there is no preset or saved theme "${change.preset}"`);
      }
    }
    if (change.typographySystem) {
      const system = TYPOGRAPHY_SYSTEMS[change.typographySystem];
      if (system) tokens = mergeTokens(tokens, { typography: system }, fontIds).tokens;
      else issues.push(`there is no typography system "${change.typographySystem}" (${Object.keys(TYPOGRAPHY_SYSTEMS).join(", ")})`);
    }
    if (change.tokens) {
      const merged = mergeTokens(tokens, change.tokens, fontIds);
      tokens = merged.tokens;
      issues.push(...merged.issues);
    }
    if (change.rationale && (change.tokens?.typography || change.typographySystem)) {
      tokens.typography.rationale = change.rationale.slice(0, 600);
    }
    next.tokens = tokens;
    const tokenDiff = diffTokens(before.tokens, tokens);
    if (tokenDiff.length > 24) changes.push(...tokenDiff.slice(0, 24), `… and ${tokenDiff.length - 24} more design values`);
    else changes.push(...tokenDiff);

    // 3. scene
    const destructiveReasons: string[] = [];
    let sceneOps: SceneOp[] = [...(change.scene ?? [])];
    const replacedDecorations = new Set<string>();
    if (change.preset && getPreset(change.preset)) {
      // A new environment replaces the previous environment's decorations
      // (regenerable), never objects LÉLU or the user composed.
      const old = next.scene.objects.filter((o) => o.source?.startsWith("preset:"));
      for (const o of old) replacedDecorations.add(o.id);
      sceneOps = [...old.map((o) => ({ op: "remove", id: o.id }) as SceneOp), ...presetScene, ...sceneOps];
      if (old.length) changes.push(`replace the previous environment's ${old.length} decoration(s)`);
    }
    if (sceneOps.length) {
      const removedLinked = sceneOps.filter((op) => op.op === "remove").map((op) => next.scene.objects.find((o) => o.id === (op as { id: string }).id)).filter((o) => o?.link && !o.source?.startsWith("preset:"));
      const userRemovals = sceneOps.filter((op) => {
        if (op.op === "clear") return next.scene.objects.some((o) => !o.source?.startsWith("preset:"));
        if (op.op !== "remove") return false;
        const object = next.scene.objects.find((o) => o.id === op.id);
        return object && !object.source?.startsWith("preset:");
      }).length;
      const result = applySceneOps(next.scene, sceneOps, this.host?.workspaces() ?? [], [tokens.palette.accent, ...tokens.environment.nebulaColors, "#93c5fd", "#86efac", "#fcd34d"]);
      next.scene = result.scene;
      changes.push(...result.changes.filter((c) => !replacedDecorations.has(c.replace(/^remove /, ""))));
      issues.push(...result.issues);
      if (sceneOps.some((op) => op.op === "clear") && userRemovals) destructiveReasons.push("removes every object composed in the Cosmos");
      else if (userRemovals > 3) destructiveReasons.push(`removes ${userRemovals} Cosmos objects`);
      if (removedLinked.length) destructiveReasons.push(`removes ${removedLinked.length} object(s) linked to your workspaces`);
      if (result.scene.camera && JSON.stringify(result.scene.camera) !== JSON.stringify(before.scene.camera)) notes.push("moves the Cosmos camera");
    }

    // 4. windows
    let windowsChanged = false;
    const windowOps = change.windows ?? presetWindows;
    if (windowOps.length) {
      if (!this.host) {
        issues.push("window changes need the Cosmos window manager, which is not mounted in this runtime — they were left out");
      } else {
        const current = this.host.windows();
        const viewport = this.host.viewport();
        const plan = planWindows(current, windowOps, viewport);
        issues.push(...plan.issues);
        notes.push(...plan.notes);
        if (plan.check.overlaps.length) issues.push(`still overlapping: ${plan.check.overlaps.map(([a, b]) => `${a}/${b}`).join(", ")}`);
        if (plan.check.offscreen.length) issues.push(`partly off-screen: ${plan.check.offscreen.join(", ")}`);
        if (plan.check.coversComposer.length) issues.push(`covers the chat composer: ${plan.check.coversComposer.join(", ")}`);
        for (const w of current) {
          const after = plan.layout[w.id];
          if (!after) continue;
          const moved = Math.round(after.x) !== Math.round(w.rect.x) || Math.round(after.y) !== Math.round(w.rect.y);
          const resized = Math.round(after.width) !== Math.round(w.rect.width) || Math.round(after.height) !== Math.round(w.rect.height);
          const parts: string[] = [];
          if (after.presentation !== w.presentation) parts.push(after.presentation === "inline" ? (w.presentation === "closed" ? "open" : "restore") : after.presentation);
          if (after.presentation === "inline" && (moved || resized)) parts.push(`to (${after.x}, ${after.y}) ${after.width}×${after.height}`);
          if ((after.rotation ?? 0) !== (w.rotation ?? 0)) parts.push(`tilt ${after.rotation}°`);
          if (after.zIndex !== w.zIndex && !moved && !resized && after.presentation === w.presentation) parts.push("bring to front");
          if ((after.group ?? "") !== (w.group ?? "")) parts.push(after.group ? `group "${after.group}"` : "ungroup");
          if (parts.length) {
            windowsChanged = true;
            changes.push(`${w.label}: ${parts.join(", ")}`);
          }
          if (after.presentation === "closed" && w.presentation !== "closed") destructiveReasons.push(`closes the ${w.label} window (its unsaved state may be lost)`);
        }
        if (windowsChanged) next.windows = plan.layout;
        // Say-one-thing-do-another guard: relational claims in the
        // description must hold in the geometry that was actually planned.
        issues.push(...contradictedClaims(description, plan.layout, current));
      }
    }

    // 5. environment identity
    if (change.environment?.name) {
      next.name = change.environment.name.slice(0, 60);
      if (next.name !== before.name) changes.push(`name the environment "${next.name}"`);
    }
    if (change.environment?.description) next.description = change.environment.description.slice(0, 300);
    if (!change.preset && (tokenDiff.length || sceneOps.length) && !change.environment?.name && next.presetId === before.presetId) {
      next.presetId = null;
    }

    if (!changes.length) {
      return { ok: false, reason: `nothing would change${issues.length ? ` (${issues.join("; ")})` : ""}`, issues };
    }

    const scopes = new Set<InterfaceScope>();
    for (const line of tokenDiff) {
      if (line.startsWith("typography.")) scopes.add("typography");
      else if (line.startsWith("palette.")) scopes.add("theme");
      else if (line.startsWith("materials.") || line.startsWith("motion.")) scopes.add("materials");
      else scopes.add("environment");
    }
    if (next.customFonts.length !== before.customFonts.length) scopes.add("typography");
    if (sceneOps.length) scopes.add("scene");
    if (windowsChanged) scopes.add("layout");
    if (next.name !== before.name) scopes.add("environment");
    const blocked = [...scopes].filter((s) => this.scopes[s] === "blocked");
    if (blocked.length) {
      return { ok: false, reason: `the user has blocked LÉLU from changing: ${blocked.join(", ")}. Nothing was proposed.`, issues };
    }

    const proposal: Proposal = {
      id: `iface-${crypto.randomUUID().slice(0, 12)}`,
      kind: "change",
      origin: options.origin ?? "lelu",
      createdAt: Date.now(),
      description,
      ...(change.rationale ? { rationale: change.rationale.slice(0, 600) } : {}),
      changes,
      notes,
      warnings: [...designWarnings(next.tokens), ...issues],
      scopes: [...scopes],
      destructive: destructiveReasons.length > 0,
      destructiveReasons,
      baseVersion: before.version,
      next,
      windowsChanged,
      status: "pending",
    };
    return this.stage(proposal, options.preview ?? true, issues);
  }

  /** Propose returning to an earlier snapshot (LÉLU must ask, too). */
  public proposeRestore(version: number, options: { origin?: "lelu" | "user" } = {}): { ok: boolean; proposal?: Proposal; reason?: string; issues: string[] } {
    const snapshot = this.history.find((s) => s.version === version);
    if (!snapshot) return { ok: false, reason: `there is no version ${version} (have ${this.history.map((s) => s.version).join(", ")})`, issues: [] };
    if (version === this.live.version) return { ok: false, reason: `version ${version} is already live`, issues: [] };
    const next = structuredClone(snapshot.config);
    const changes = [`restore "${snapshot.label}" (version ${version})`, ...diffTokens(this.live.tokens, next.tokens).slice(0, 12)];
    const proposal: Proposal = {
      id: `iface-${crypto.randomUUID().slice(0, 12)}`,
      kind: "restore",
      origin: options.origin ?? "lelu",
      createdAt: Date.now(),
      description: `Restore the interface to "${snapshot.label}" (version ${version})`,
      changes,
      notes: Object.keys(next.windows).length ? ["window positions return to that version's layout"] : [],
      warnings: [],
      scopes: ["environment"],
      destructive: false,
      destructiveReasons: [],
      baseVersion: this.live.version,
      next,
      windowsChanged: Object.keys(next.windows).length > 0,
      status: "pending",
    };
    return this.stage(proposal, true, []);
  }

  private stage(proposal: Proposal, preview: boolean, issues: string[]): { ok: true; proposal: Proposal; issues: string[] } {
    // One live question at a time: a newer LÉLU proposal supersedes her
    // older undecided ones, so the user never approves a stale idea.
    if (proposal.origin === "lelu") {
      for (const p of this.proposals) {
        if (p.status === "pending" && p.origin === "lelu") {
          p.status = "superseded";
          p.decidedAt = Date.now();
        }
      }
    }
    this.proposals.unshift(proposal);
    this.proposals = this.proposals.slice(0, MAX_PROPOSALS);
    if (preview) this.previewId = proposal.id;
    this.persistProposals();
    this.notify();
    AgentEventBus.getInstance().emit({
      type: "approval_requested",
      taskId: TASK_ID,
      approvalId: proposal.id,
      title: `Interface: ${proposal.description}`,
      detail: [...proposal.changes.slice(0, 8), ...(proposal.destructive ? [`⚠ ${proposal.destructiveReasons.join("; ")} — confirm in the interface bar`] : [])].join("\n"),
      systemsAffected: proposal.scopes.map((s) => `interface.${s}`),
    });
    return { ok: true, proposal, issues };
  }

  /* ---------------------------- preview ---------------------------- */

  public startPreview(id: string): boolean {
    const proposal = this.getProposal(id);
    if (!proposal || proposal.status !== "pending") return false;
    this.previewId = id;
    this.notify();
    return true;
  }

  public stopPreview(): void {
    if (this.previewId === null) return;
    this.previewId = null;
    this.notify();
  }

  /* ---------------------------- consent ---------------------------- */

  /**
   * The HUMAN decision. Called by the consent bar (and, through the event
   * bus, by the execution timeline). LÉLU's tools never call this.
   */
  public decide(id: string, decision: "approved" | "rejected", options: { confirmDestructive?: boolean } = {}): { ok: boolean; reason?: string; proposal?: Proposal } {
    const proposal = this.getProposal(id);
    if (proposal && options.confirmDestructive) proposal.destructiveConfirmed = true;
    const result = this.resolve(id, decision, "consent bar");
    if (result.ok) {
      // Tell every other listener (timeline, executive) about the decision,
      // without re-entering resolve().
      this.suppressEvent = id;
      try {
        AgentEventBus.getInstance().emit({ type: "approval_resolved", taskId: TASK_ID, approvalId: id, decision });
      } finally {
        this.suppressEvent = null;
      }
    }
    return result;
  }

  private resolve(id: string, decision: "approved" | "rejected", via: string): { ok: boolean; reason?: string; proposal?: Proposal } {
    const proposal = this.getProposal(id);
    if (!proposal) return { ok: false, reason: `no interface proposal ${id}` };
    if (proposal.status !== "pending") return { ok: false, reason: `that proposal is already ${proposal.status}`, proposal };

    if (decision === "rejected") {
      proposal.status = "rejected";
      proposal.decidedAt = Date.now();
      proposal.decisionNote = `rejected via ${via}`;
      if (this.previewId === id) this.previewId = null;
      this.persistProposals();
      this.notify();
      return { ok: true, proposal };
    }

    if (proposal.destructive && !proposal.destructiveConfirmed) {
      proposal.decisionNote = "waiting for the explicit destructive-change confirmation in the interface bar";
      this.persistProposals();
      this.notify();
      return { ok: false, reason: `this change is destructive (${proposal.destructiveReasons.join("; ")}) and needs the separate confirmation`, proposal };
    }

    if (proposal.baseVersion !== this.live.version) {
      proposal.status = "stale";
      proposal.decidedAt = Date.now();
      proposal.decisionNote = `the interface changed (now v${this.live.version}) since this was proposed on v${proposal.baseVersion}`;
      if (this.previewId === id) this.previewId = null;
      this.persistProposals();
      this.notify();
      return { ok: false, reason: `${proposal.decisionNote} — ask LÉLU to propose it again`, proposal };
    }

    if (proposal.kind === "delete-theme") {
      this.themes = this.themes.filter((th) => th.id !== proposal.themeId);
      KvStore.getInstance().set(KEYS.themes, this.themes);
    } else {
      const version = ++this.versionCounter;
      this.live = { ...structuredClone(proposal.next), version, updatedAt: Date.now() };
      this.history = this.history.slice(0, this.cursor + 1);
      this.history.push({ version, label: proposal.description.slice(0, 80), at: Date.now(), config: structuredClone(this.live) });
      if (this.history.length > MAX_HISTORY) this.history = [this.history[0], ...this.history.slice(-(MAX_HISTORY - 1))];
      this.cursor = this.history.length - 1;
      this.persistLive();
      this.applyToHost(proposal.windowsChanged ? this.live.windows : null, proposal.next.scene.camera);
    }

    proposal.status = "approved";
    proposal.decidedAt = Date.now();
    proposal.decisionNote = `approved via ${via}`;
    if (this.previewId === id) this.previewId = null;
    this.lastApplied = { proposalId: id, at: Date.now(), description: proposal.description };
    this.persistProposals();
    this.notify();
    return { ok: true, proposal };
  }

  private applyToHost(windows: Record<string, WindowLayout> | null, camera: SceneCamera | undefined): void {
    if (!this.host) return;
    try {
      if (windows && Object.keys(windows).length) this.host.applyWindows(windows);
      if (camera) this.host.applyCamera?.(camera);
    } catch (error) {
      console.error("[Interface] host apply failed (contained)", error);
    }
  }

  /* ------------------------- undo / redo --------------------------- */

  /** User control (consent bar). Moves along already-approved history. */
  public undo(): boolean {
    if (this.cursor <= 0) return false;
    return this.moveTo(this.cursor - 1);
  }

  public redo(): boolean {
    if (this.cursor >= this.history.length - 1) return false;
    return this.moveTo(this.cursor + 1);
  }

  /** User control: restore a previous version directly (the user IS the authority). */
  public restoreVersion(version: number): boolean {
    const index = this.history.findIndex((s) => s.version === version);
    if (index < 0) return false;
    return this.moveTo(index);
  }

  private moveTo(index: number): boolean {
    const snapshot = this.history[index];
    this.cursor = index;
    this.live = structuredClone(snapshot.config);
    this.previewId = null;
    // Proposals built on the version we just left are now stale.
    for (const p of this.proposals) {
      if (p.status === "pending" && p.baseVersion !== this.live.version) {
        p.status = "stale";
        p.decisionNote = "the interface was undone/redone after this was proposed";
      }
    }
    this.persistLive();
    this.persistProposals();
    this.applyToHost(Object.keys(this.live.windows).length ? this.live.windows : null, this.live.scene.camera);
    this.lastApplied = null;
    this.notify();
    return true;
  }

  /* ---------------------------- library ---------------------------- */

  /** Additive: saving a theme never changes what is on screen. */
  public saveTheme(name: string, description = "", source: "live" | "preview" = "live"): SavedTheme {
    const config = source === "preview" ? this.view().effective : this.live;
    const base = name.trim().slice(0, 60) || "Untitled theme";
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "theme";
    let id = `theme-${slug}`;
    for (let n = 2; this.themes.some((th) => th.id === id) || getPreset(id); n++) id = `theme-${slug}-${n}`;
    const theme: SavedTheme = { id, name: base, description: description.slice(0, 300), tokens: structuredClone(config.tokens), customFonts: structuredClone(config.customFonts), createdAt: Date.now() };
    this.themes.push(theme);
    KvStore.getInstance().set(KEYS.themes, this.themes);
    this.notify();
    return theme;
  }

  /** Deleting user data is destructive: it is only ever proposed. */
  public proposeDeleteTheme(id: string, options: { origin?: "lelu" | "user" } = {}): { ok: boolean; proposal?: Proposal; reason?: string; issues: string[] } {
    const theme = this.themes.find((th) => th.id === id);
    if (!theme) return { ok: false, reason: `there is no saved theme "${id}"`, issues: [] };
    const proposal: Proposal = {
      id: `iface-${crypto.randomUUID().slice(0, 12)}`,
      kind: "delete-theme",
      origin: options.origin ?? "lelu",
      createdAt: Date.now(),
      description: `Delete the saved theme "${theme.name}"`,
      changes: [`delete saved theme "${theme.name}" permanently`],
      notes: [],
      warnings: [],
      scopes: ["library"],
      destructive: true,
      destructiveReasons: [`permanently deletes your saved theme "${theme.name}"`],
      baseVersion: this.live.version,
      next: this.live,
      windowsChanged: false,
      status: "pending",
      themeId: id,
    };
    return this.stage(proposal, false, []);
  }

  /* ----------------------------- scopes ---------------------------- */

  public setScopePolicy(scope: InterfaceScope, policy: ScopePolicy): void {
    if (!INTERFACE_SCOPES.includes(scope)) return;
    this.scopes = { ...this.scopes, [scope]: policy };
    KvStore.getInstance().set(KEYS.scopes, this.scopes);
    this.notify();
  }

  /* ---------------------- observed window state -------------------- */

  /**
   * The window manager reports where windows actually are (including the
   * user's own drags), so a reload restores the workspace as it was left.
   * This is not a version — it is the user's own arrangement.
   */
  public recordObservedWindows(layout: Record<string, WindowLayout>): void {
    try {
      KvStore.getInstance().set(KEYS.observed, layout);
    } catch {
      /* best effort */
    }
  }

  public observedWindows(): Record<string, WindowLayout> {
    return KvStore.getInstance().get<Record<string, WindowLayout>>(KEYS.observed) ?? {};
  }

  /* --------------------------- persistence ------------------------- */

  private persistLive(): void {
    const kv = KvStore.getInstance();
    kv.set(KEYS.live, this.live);
    kv.set(KEYS.history, { snapshots: this.history, cursor: this.cursor, counter: this.versionCounter });
  }

  private persistProposals(): void {
    // Keep the decision log light: the `next` config of decided proposals
    // is already in history (approved) or irrelevant (rejected).
    const slim = this.proposals.map((p) => (p.status === "pending" ? p : { ...p, next: { ...p.next, scene: { objects: [] }, windows: {} } }));
    KvStore.getInstance().set(KEYS.proposals, slim);
  }

  /** Re-read everything from storage (what a reload sees). */
  public reload(): void {
    InterfaceOrchestrator.instance = null;
  }

  /** Decision log, newest first — the change history the user can audit. */
  public log(): Array<Pick<Proposal, "id" | "description" | "status" | "createdAt" | "decidedAt" | "decisionNote" | "scopes" | "destructive">> {
    return this.proposals.map(({ id, description, status, createdAt, decidedAt, decisionNote, scopes, destructive }) => ({ id, description, status, createdAt, decidedAt, decisionNote, scopes, destructive }));
  }

  /** For a font id, the family the CSS should name (library or custom). */
  public static customFamilies(config: InterfaceConfig): Record<string, string> {
    return Object.fromEntries(config.customFonts.map((f) => [f.id, f.family]));
  }

  public static fontIsLibrary(id: string): boolean {
    return Boolean(getFont(id));
  }
}
