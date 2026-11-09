/**
 * Mission 5.3 — the agent's portal path, end to end.
 *
 * Not an executor in isolation: this drives `dispatchToolCall`, the entry point
 * a model-issued tool call actually goes through, against the real registry
 * over isolated storage, and then "reloads" to see what persisted.
 *
 * The scene side of the contract is the same one the app mounts: a
 * `lelu-portal-create` listener that answers `lelu-portal-created`. The
 * smallest DOM event bus that contract needs is installed here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { dispatchToolCall, toolNameForModel } from "../src/core/tools/ToolDispatcher";
import { registerInterfaceTools } from "../src/core/interface/InterfaceTools";
import PortalRegistry, {
  PORTAL_STORAGE_KEY,
  type PortalPort,
  type PortalRecord,
} from "../src/app/scene/spatial/PortalRegistry";

interface BusEvent {
  type: string;
  detail?: unknown;
}

type Handler = (event: BusEvent) => void;

function installWindow() {
  const listeners = new Map<string, Set<Handler>>();
  const stub = {
    addEventListener(type: string, handler: Handler) {
      const set = listeners.get(type) ?? new Set<Handler>();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: Handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event: BusEvent) {
      for (const handler of [...(listeners.get(event.type) ?? [])]) handler(event);
      return true;
    },
  };
  const globals = globalThis as unknown as { window?: unknown; CustomEvent?: unknown };
  const previous = { window: globals.window, CustomEvent: globals.CustomEvent };
  globals.window = stub;
  globals.CustomEvent = class {
    type: string;
    detail?: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  return {
    stub,
    restore() {
      if (previous.window === undefined) delete globals.window;
      else globals.window = previous.window;
      if (previous.CustomEvent === undefined) delete globals.CustomEvent;
      else globals.CustomEvent = previous.CustomEvent;
    },
  };
}

function memoryPort() {
  const data = new Map<string, unknown>();
  const port: PortalPort = {
    get<T>(key: string): T | null {
      return (data.get(key) as T) ?? null;
    },
    set(key: string, value: unknown): boolean {
      data.set(key, value);
      return true;
    },
  };
  return { data, port };
}

/** The scene's half of the channel, exactly as SpatialExperience mounts it. */
function mountScene(bus: { stub: ReturnType<typeof installWindow>["stub"] }, registry: PortalRegistry) {
  const { CustomEvent } = globalThis as unknown as { CustomEvent: new (type: string, init?: { detail?: unknown }) => BusEvent };
  bus.stub.addEventListener("lelu-portal-create", (event) => {
    const detail = (event.detail ?? {}) as { destination?: string; label?: string; workspace?: string; requestId?: string };
    const result = registry.create({
      destination: detail.destination,
      label: detail.label,
      workspace: detail.workspace,
      createdBy: "agent",
    });
    bus.stub.dispatchEvent(new CustomEvent("lelu-portal-created", { detail: { ...result, requestId: detail.requestId } }));
  });
  bus.stub.addEventListener("lelu-portal-remove", (event) => {
    const detail = (event.detail ?? {}) as { id?: string; requestId?: string };
    const ok = detail.id ? registry.remove(detail.id) : false;
    bus.stub.dispatchEvent(new CustomEvent("lelu-portal-removed", { detail: { ok, id: detail.id, requestId: detail.requestId } }));
  });
}

test("a model-issued tool call creates a portal that survives a reload", async () => {
  const bus = installWindow();
  const { port, data } = memoryPort();
  try {
    const registry = PortalRegistry.resetForTests(port);
    mountScene(bus, registry);
    registerInterfaceTools();

    const result = await dispatchToolCall(
      { name: toolNameForModel("spatial.portal.create"), arguments: { destination: "studio", label: "Agent atelier" } } as never,
      "mission-5-3",
    );
    assert.equal(result.ok, true, result.content);
    assert.match(result.content, /Created the portal "Agent atelier"/);

    const stored = registry.list().filter((portal) => portal.label === "Agent atelier");
    assert.equal(stored.length, 1, "exactly one portal was created");
    assert.equal(stored[0].createdBy, "agent");
    assert.equal(stored[0].destination, "studio");
    assert.ok(Array.isArray(data.get(PORTAL_STORAGE_KEY)), "the write reached storage");

    // A reload: a fresh registry over the same storage keeps the identity.
    const reloaded = PortalRegistry.resetForTests(port);
    assert.equal(reloaded.get(stored[0].id)?.destination, "studio");
    assert.equal(
      reloaded.list().filter((portal: PortalRecord) => portal.label === "Agent atelier").length,
      1,
      "the reload produced no duplicate",
    );
  } finally {
    bus.restore();
  }
});

test("a model-issued removal also survives a reload", async () => {
  const bus = installWindow();
  const { port } = memoryPort();
  try {
    const registry = PortalRegistry.resetForTests(port);
    mountScene(bus, registry);
    registerInterfaceTools();

    const created = registry.create({ destination: "media", label: "Cutting room", createdBy: "agent" });
    assert.ok(created.ok);

    const removed = await dispatchToolCall(
      { name: toolNameForModel("spatial.portal.remove"), arguments: { id: created.portal.id } } as never,
      "mission-5-3",
    );
    assert.equal(removed.ok, true, removed.content);
    assert.equal(registry.get(created.portal.id), null);

    const reloaded = PortalRegistry.resetForTests(port);
    assert.equal(reloaded.get(created.portal.id), null, "the removal persisted");
  } finally {
    bus.restore();
  }
});
