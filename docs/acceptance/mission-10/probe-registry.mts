/**
 * Proves which tools exist in the ONE registry after the real
 * bootstrap registration path runs — the surface a model is
 * actually offered, not a static list.
 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

const globalAny = globalThis as unknown as { localStorage?: unknown; window?: unknown };
if (!globalAny.localStorage) globalAny.localStorage = new MemoryStorage();
if (!globalAny.window) globalAny.window = globalThis;

const { default: ToolRegistry } = await import("../../../src/core/tools/ToolRegistry");
const { registerInterfaceTools } = await import("../../../src/core/interface/InterfaceTools");

registerInterfaceTools();

const registry = ToolRegistry.getInstance();
const ids = registry.all().map((tool) => tool.id);
const byPrefix = (prefix: string) => ids.filter((id) => id.startsWith(prefix)).sort();

console.log(JSON.stringify({
  total: ids.length,
  interface: byPrefix("interface."),
  environment: byPrefix("environment."),
  repo: byPrefix("repo."),
  duplicates: ids.length - new Set(ids).size,
}, null, 1));
