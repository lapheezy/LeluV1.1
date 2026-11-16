/**
 * ==========================================================
 * LÉLU — INTERFACE LAUNCH BUS (Mission 17)
 *
 * Opening an interface is a UI act (it changes which scene owns the
 * screen), but LÉLU's tools run outside React. The Genesis shell
 * registers ONE launcher while it is mounted; tools and deep links ask
 * through here. With no shell attached (a test, a server, a headless
 * run) a request is refused and says so — it never pretends the
 * interface opened.
 * ==========================================================
 */

import { isInterfaceId, type InterfaceId } from "./InterfaceCatalog";

export type LaunchRequest =
  | { kind: "interface"; id: InterfaceId; entity?: string }
  | { kind: "composition"; id: string; regionKey?: string }
  | { kind: "close-composition" };

export type Launcher = (request: LaunchRequest) => { ok: boolean; detail: string };

let launcher: Launcher | null = null;

export function attachInterfaceLauncher(fn: Launcher): () => void {
  launcher = fn;
  return () => {
    if (launcher === fn) launcher = null;
  };
}

export function requestLaunch(request: LaunchRequest): { ok: boolean; detail: string } {
  if (!launcher) return { ok: false, detail: "No LÉLU interface is on screen to open it in (the Genesis shell is not mounted)." };
  try {
    return launcher(request);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function hasInterfaceLauncher(): boolean {
  return launcher !== null;
}

/**
 * Read a launch request from a URL query — the standalone entry points:
 *   ?interface=lelu-room | lelu-system | cosmos | neural-map[&entity=<id>]
 *   ?composition=<id>[&region=<key>]
 */
export function launchFromQuery(search: string): LaunchRequest | null {
  const params = new URLSearchParams(search);
  const composition = params.get("composition");
  if (composition) return { kind: "composition", id: composition, ...(params.get("region") ? { regionKey: params.get("region")! } : {}) };
  const id = params.get("interface");
  if (!isInterfaceId(id)) return null;
  const entity = params.get("entity");
  return entity ? { kind: "interface", id, entity } : { kind: "interface", id };
}
