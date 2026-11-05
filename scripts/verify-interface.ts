/**
 * ==========================================================
 * LIVE VERIFICATION — INTERFACE ORCHESTRATION
 *
 * The acceptance requests, phrased as a user would phrase them, sent
 * through LÉLU's real chat path (AIService → provider chain → native
 * tools). No request names a tool. For each one this checks that:
 *
 *   • the model itself chose interface.propose (after inspecting),
 *   • NOTHING was applied before the human decision,
 *   • the proposal contains the requested kind of change,
 *   • approving (the consent bar's decide()) applies it.
 *
 * Windows come from a host with the same contract as the Genesis
 * window manager (chat + Browser + Projects, overlapping, 1440×900).
 *
 * Needs a provider credential (e.g. LELU_ANTHROPIC_API_KEY).
 * Spends about five model turns.
 * ==========================================================
 */

// -- browser storage shim: KvStore persists through localStorage --
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
};

// -- in-memory IndexedDB (Brain's long-term store), same shim as verify-tool-execute --
const databases = new Map<string, Map<string, Map<string, unknown>>>();
class ShimRequest {
  result: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  settle(): void {
    queueMicrotask(() => this.onsuccess?.());
  }
}
class ShimObjectStore {
  constructor(private readonly rows: Map<string, unknown>) {}
  put(value: unknown): void {
    const record = value as { id: string };
    this.rows.set(record.id, structuredClone(value));
  }
  delete(id: string): void {
    this.rows.delete(id);
  }
  clear(): void {
    this.rows.clear();
  }
  get(id: string): ShimRequest {
    const req = new ShimRequest();
    req.result = this.rows.has(id) ? structuredClone(this.rows.get(id)) : null;
    req.settle();
    return req;
  }
  getAll(): ShimRequest {
    const req = new ShimRequest();
    req.result = [...this.rows.values()].map((v) => structuredClone(v));
    req.settle();
    return req;
  }
}
class ShimTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly stores: Map<string, ShimObjectStore>;
  constructor(db: ShimDatabase, storeName: string) {
    this.stores = new Map([[storeName, new ShimObjectStore(db.store(storeName))]]);
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore(name: string): ShimObjectStore {
    return this.stores.get(name)!;
  }
}
class ShimDatabase {
  onversionchange: (() => void) | null = null;
  constructor(private readonly name: string) {}
  store(storeName: string): Map<string, unknown> {
    const db = databases.get(this.name)!;
    if (!db.has(storeName)) db.set(storeName, new Map());
    return db.get(storeName)!;
  }
  get objectStoreNames() {
    return { contains: (name: string) => databases.get(this.name)!.has(name) };
  }
  createObjectStore(storeName: string): void {
    databases.get(this.name)!.set(storeName, new Map());
  }
  transaction(storeName: string): ShimTransaction {
    return new ShimTransaction(this, storeName);
  }
  close(): void {}
}
(globalThis as Record<string, unknown>).indexedDB = {
  open(name: string, _version?: number): ShimRequest {
    if (!databases.has(name)) databases.set(name, new Map());
    const req = new ShimRequest();
    const db = new ShimDatabase(name);
    req.result = db;
    queueMicrotask(() => {
      if (!db.objectStoreNames.contains("memories")) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

async function main(): Promise<void> {
  const [{ default: AIService }, { default: AgentEventBus }, { registerInterfaceTools }, { default: InterfaceOrchestrator }, spatial] = await Promise.all([
    import("../src/core/AIService"),
    import("../src/core/agent/AgentEvents"),
    import("../src/core/interface/InterfaceTools"),
    import("../src/core/interface/InterfaceOrchestrator"),
    import("../src/core/interface/SpatialModel"),
  ]);
  type Descriptor = import("../src/core/interface/SpatialModel").WindowDescriptor;

  const windows = new Map<string, Descriptor>([
    ["chat", { id: "chat", kind: "chat", label: "Chat", presentation: "inline", rect: { x: 440, y: 200, width: 560, height: 480 }, zIndex: 21, rotation: 0 }],
    ["browser", { id: "browser", kind: "module", label: "Browser", presentation: "inline", rect: { x: 120, y: 110, width: 620, height: 480 }, zIndex: 31, rotation: 0 }],
    ["projects", { id: "projects", kind: "module", label: "Projects", presentation: "inline", rect: { x: 160, y: 140, width: 620, height: 480 }, zIndex: 32, rotation: 0 }],
    ["render", { id: "render", kind: "module", label: "Render", presentation: "closed", rect: { x: 0, y: 0, width: 620, height: 480 }, zIndex: 30, rotation: 0 }],
  ]);
  const orchestrator = InterfaceOrchestrator.getInstance();
  orchestrator.attachHost({
    windows: () => [...windows.values()].map((w) => structuredClone(w)),
    viewport: () => spatial.makeViewport(1440, 900),
    workspaces: () => [
      { kind: "conversation", id: "conv-core", title: "LÉLU core", active: true },
      { kind: "conversation", id: "conv-garden", title: "Garden research" },
      { kind: "project", id: "proj-studio", title: "Studio launch" },
    ],
    applyWindows: (layout) => {
      for (const [id, l] of Object.entries(layout)) {
        const w = windows.get(id);
        if (w) Object.assign(w, { presentation: l.presentation, rect: { x: l.x, y: l.y, width: l.width, height: l.height }, zIndex: l.zIndex, rotation: l.rotation });
      }
    },
  });
  registerInterfaceTools();
  if (process.env.VERIFY_SHOW_ARGS) {
    const original = orchestrator.propose.bind(orchestrator);
    orchestrator.propose = ((change, options) => {
      console.log(`      change set: ${JSON.stringify(change).slice(0, 1500)}`);
      return original(change, options);
    }) as typeof orchestrator.propose;
  }
  const ai = AIService.getInstance();
  await ai.initialize();

  const only = process.argv[2];
  async function turn(name: string, request: string, verify: (p: NonNullable<ReturnType<typeof orchestrator.getProposal>>) => string | null) {
    if (only && !name.startsWith(only)) return;
    const calls: string[] = [];
    const stopCalls = AgentEventBus.getInstance().subscribe((event) => {
      if (event.type === "tool_started" || event.type === "tool_selected") calls.push(event.tool);
    });
    const used: string[] = [];
    const stop = AgentEventBus.getInstance().subscribe((event) => {
      if (event.type === "tool_result") used.push(`${event.tool}:${event.status ?? "?"}`);
    });
    const versionBefore = orchestrator.getLive().version;
    const response = await ai.chat(request);
    stop();
    const pending = orchestrator.view().pending[0];
    const appliedEarly = orchestrator.getLive().version !== versionBefore;
    if (!pending) {
      check(name, false, `no proposal. provider ${response.provider}; tools: ${used.join(", ") || "none"}; reply: ${response.text.slice(0, 240).replace(/\s+/g, " ")}`);
      return;
    }
    stopCalls();
    const problem = verify(pending);
    if (problem) console.log(`      proposal changes:\n      - ${pending.changes.join("\n      - ")}\n      notes: ${pending.notes.join("; ")}\n      warnings: ${pending.warnings.join("; ")}`);
    const decision = orchestrator.decide(pending.id, "approved", { confirmDestructive: pending.destructive });
    const ok = used.some((u) => u.startsWith("interface.propose:complete")) && !appliedEarly && !problem && decision.ok;
    check(
      name,
      ok,
      `provider ${response.provider}; tools: ${used.join(", ")}; applied before consent: ${appliedEarly}; ${problem ?? "content as requested"}; ` +
        `approved → v${orchestrator.getLive().version}. scopes [${pending.scopes.join(", ")}]. reply: ${response.text.slice(0, 220).replace(/\s+/g, " ")}`,
    );
  }

  await turn("1 typography", "Change the Cosmos typography to a futuristic editorial style.", (p) =>
    p.scopes.includes("typography") && p.next.tokens.typography.headingFont !== "system-sans" ? null : "no typography change",
  );

  await turn("2 windows", "Move my browser window beside the chat, put my project window above it, and make everything fit on screen.", (p) => {
    const l = p.next.windows;
    if (!l.browser || !l.chat || !l.projects) return "windows missing from plan";
    const beside = l.browser.x >= l.chat.x + l.chat.width || l.browser.x + l.browser.width <= l.chat.x;
    const above = l.projects.y + l.projects.height <= l.browser.y;
    const check2 = spatial.checkLayout(l, spatial.makeViewport(1440, 900), { chat: "chat" });
    return beside && above && !check2.overlaps.length && !check2.offscreen.length ? null : `beside=${beside} above=${above} overlaps=${JSON.stringify(check2.overlaps)} offscreen=${JSON.stringify(check2.offscreen)}`;
  });

  await turn("3 garden", "Turn my workspace into a living Cosmos Garden.", (p) =>
    p.scopes.includes("scene") && p.next.tokens.environment.backdrop !== "cosmos" && p.next.scene.objects.length > 0 ? null : `scopes ${p.scopes.join(",")}, backdrop ${p.next.tokens.environment.backdrop}, objects ${p.next.scene.objects.length}`,
  );

  await turn("4 planets", "Create three floating planets for my three active workspaces.", (p) => {
    const linked = p.next.scene.objects.filter((o) => o.kind === "planet" && o.link);
    return linked.length >= 3 ? null : `only ${linked.length} linked planets`;
  });

  await turn("5 transformation", "Redesign my entire workspace. Make it organic, fluid, colorful, and remove the rigid box-based appearance.", (p) => {
    const need = ["materials", "theme"];
    const missing = need.filter((s) => !p.scopes.includes(s as never));
    const organic = p.next.tokens.materials.windowShape === "organic" || p.next.tokens.materials.radius >= 24;
    return !missing.length && organic ? null : `missing scopes ${missing.join(",")}; windowShape ${p.next.tokens.materials.windowShape} radius ${p.next.tokens.materials.radius}`;
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} live interface checks passed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
