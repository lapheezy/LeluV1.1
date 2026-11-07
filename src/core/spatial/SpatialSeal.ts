/**
 * ==========================================================
 * LÉLU — SPATIAL WRITE SEAL
 *
 * The one thing that separates "the registry was updated by a
 * verified commit" from "something wrote into the scene".
 *
 * A seal is an object, not a field: it carries a module-private
 * symbol and is registered in a WeakSet at the moment it is
 * issued. `SpatialObjectRegistry.write()` refuses anything that
 * is not in that WeakSet, so handing it a plain object shaped
 * like a seal fails at runtime — a direct write cannot skip the
 * guard by imitating its result.
 *
 * In-process JavaScript cannot be defended against an attacker
 * who can call the issuer itself; this is the boundary the app
 * can actually enforce in a browser, and it is stated as such in
 * docs/architecture/SPATIAL_API.md rather than overclaimed.
 * ==========================================================
 */

import type { SpatialOperationId } from "./SpatialTypes";

const SEAL_SYMBOL = Symbol("lelu.spatial.write-seal");

export interface SpatialWriteSeal {
  readonly [SEAL_SYMBOL]: true;
  /** Revision this write produces. */
  readonly revision: number;
  readonly ops: readonly SpatialOperationId[];
  readonly issuedAt: number;
}

const issued = new WeakSet<object>();

export function issueSpatialWriteSeal(
  revision: number,
  ops: readonly SpatialOperationId[],
): SpatialWriteSeal {
  const seal: SpatialWriteSeal = Object.freeze({
    [SEAL_SYMBOL]: true as const,
    revision,
    ops: [...ops],
    issuedAt: Date.now(),
  });
  issued.add(seal);
  return seal;
}

export function isSpatialWriteSeal(value: unknown): value is SpatialWriteSeal {
  return typeof value === "object" && value !== null && issued.has(value);
}
