/**
 * ==========================================================
 * LÉLU — THE LAYOUT STORE (one per shell)
 *
 * One authoritative layout state, persisted through the app's
 * existing KvStore. There is deliberately no second store: the
 * dock, the module host and LÉLU's own tool actions all read and
 * write this one.
 *
 * On first use it migrates whatever the shell already kept —
 * per-module geometry and the `lelu.dock.v1` settings — and
 * reports what it could not read instead of inventing it.
 * ==========================================================
 */

import KvStore from "../../../../core/storage/KvStore";
import {
  DEFAULT_WORKSPACE,
  LAYOUT_STORAGE_KEY,
  LEGACY_DOCK_KEY,
  addEntry,
  autoArrange,
  dockOrder,
  migrateLayout,
  placeManual,
  readLayout,
  releaseManual,
  reorder,
  reflowForViewport,
  removeEntry,
  restoreAutoLayout,
  setMinimized,
  setPinned,
  workspaceEntries,
  type LayoutRect,
  type LayoutViewport,
  type ModuleLayoutEntry,
  type WorkspaceLayout,
} from "./moduleLayout";

type Listener = (layout: WorkspaceLayout) => void;

export interface LayoutMigrationReport {
  skipped: number;
  migrated: string[];
}

const MODULE_STATE_KEY = "lelu.modules.v1";

function defaultViewport(): LayoutViewport {
  if (typeof window === "undefined") return { width: 1440, height: 900 };
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

function readJson<T>(key: string): T | null {
  try {
    return KvStore.getInstance().get<T>(key) ?? null;
  } catch {
    return null;
  }
}

export default class ModuleLayoutStore {
  private static instance: ModuleLayoutStore | null = null;
  private layout: WorkspaceLayout;
  private listeners = new Set<Listener>();
  private migration: LayoutMigrationReport = { skipped: 0, migrated: [] };

  private constructor() {
    const stored = readJson<WorkspaceLayout>(LAYOUT_STORAGE_KEY);
    if (stored) {
      const parsed = readLayout(stored);
      this.layout = parsed.layout;
      this.migration = { skipped: parsed.skipped, migrated: parsed.layout.entries.map((e) => e.moduleId) };
    } else {
      const legacyModules = readJson<
        Record<string, { position?: { x: number; y: number }; size?: { width: number; height: number }; zIndex?: number }>
      >(MODULE_STATE_KEY);
      const migrated = migrateLayout(
        legacyModules,
        readJson(LEGACY_DOCK_KEY),
        defaultViewport(),
      );
      this.layout = migrated.layout;
      this.migration = { skipped: migrated.skipped, migrated: migrated.migrated };
      this.persist();
    }
  }

  static getInstance(): ModuleLayoutStore {
    if (!ModuleLayoutStore.instance) {
      ModuleLayoutStore.instance = new ModuleLayoutStore();
    }
    return ModuleLayoutStore.instance;
  }

  /** Tests only: drop the singleton so a fresh migration can be observed. */
  static resetForTests(): void {
    ModuleLayoutStore.instance = null;
  }

  getState(): WorkspaceLayout {
    return this.layout;
  }

  getMigrationReport(): LayoutMigrationReport {
    return this.migration;
  }

  entries(workspace = DEFAULT_WORKSPACE): ModuleLayoutEntry[] {
    return workspaceEntries(this.layout.entries, workspace);
  }

  rectFor(moduleId: string): LayoutRect | null {
    return this.layout.entries.find((entry) => entry.moduleId === moduleId)?.rect ?? null;
  }

  isManual(moduleId: string): boolean {
    return this.layout.entries.find((entry) => entry.moduleId === moduleId)?.manual === true;
  }

  order(): string[] {
    return dockOrder(this.layout.entries);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(entries: ModuleLayoutEntry[]): WorkspaceLayout {
    this.layout = { ...this.layout, entries, updatedAt: Date.now() };
    this.persist();
    for (const listener of this.listeners) listener(this.layout);
    return this.layout;
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(LAYOUT_STORAGE_KEY, this.layout);
    } catch {
      // Persistence must never take the shell down with it.
    }
  }

  ensure(moduleId: string, workspace = DEFAULT_WORKSPACE): void {
    if (this.layout.entries.some((entry) => entry.moduleId === moduleId)) return;
    this.commit(autoArrange(addEntry(this.layout.entries, moduleId, workspace), defaultViewport()));
  }

  /** A drag or resize the person performed: manual from now on. */
  place(moduleId: string, rect: Partial<LayoutRect>, viewport = defaultViewport()): void {
    const current = this.rectFor(moduleId) ?? { x: 0, y: 0, width: 320, height: 240 };
    this.ensure(moduleId);
    this.commit(
      placeManual(
        this.layout.entries,
        moduleId,
        {
          x: rect.x ?? current.x,
          y: rect.y ?? current.y,
          width: rect.width ?? current.width,
          height: rect.height ?? current.height,
        },
        viewport,
      ),
    );
  }

  release(moduleId: string): void {
    this.commit(releaseManual(this.layout.entries, moduleId));
  }

  arrange(viewport = defaultViewport()): void {
    this.commit(autoArrange(this.layout.entries, viewport));
  }

  /** Explicit "regenerate my layout": every entry returns to auto. */
  restore(viewport = defaultViewport()): string[] {
    const { entries, changed } = restoreAutoLayout(this.layout.entries, viewport);
    this.commit(entries);
    return changed;
  }

  reflow(viewport = defaultViewport()): void {
    this.commit(reflowForViewport(this.layout.entries, viewport));
  }

  pin(moduleId: string, pinned: boolean): void {
    this.commit(setPinned(this.layout.entries, moduleId, pinned));
  }

  minimize(moduleId: string, minimized: boolean): void {
    this.commit(setMinimized(this.layout.entries, moduleId, minimized));
  }

  move(moduleId: string, overId: string): void {
    this.commit(reorder(this.layout.entries, moduleId, overId));
  }

  forget(moduleId: string): void {
    this.commit(removeEntry(this.layout.entries, moduleId));
  }
}
