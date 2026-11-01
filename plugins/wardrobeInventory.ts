/**
 * ==========================================================
 * LÉLU 3D FORGE — WARDROBE INVENTORY (server + tests)
 *
 * The plan that sits between a reference board and a spend:
 * every physical asset of a look, named, categorised, given
 * the wardrobe slot and the bone it will follow, and the
 * references that may drive its geometry.
 *
 * Reading it is free. Planning it creates the exact Meshy
 * request each asset would send, with the published price
 * attached, so the total is a number a person can approve
 * rather than a surprise.
 *
 * Nothing here fabricates an asset: an entry whose references
 * are not on disk is reported as blocked, not estimated away.
 * ==========================================================
 */

import { estimateCredits, type ForgeJobKind } from "../src/core/forge/MeshyCatalog.ts";
import type { ReferenceRecord } from "./forgeReferences.ts";
import type { WardrobeCategory } from "./forgeStore.ts";

export const INVENTORY_CATEGORIES: ReadonlySet<string> = new Set([
  "look",
  "hair",
  "headwear",
  "jewelry",
  "outerwear",
  "bag",
  "shoes",
  "accessory",
  "other",
]);

export interface InventoryAsset {
  /** Wardrobe id once generated: lowercase, unique across the character. */
  id: string;
  name: string;
  category: string;
  /** Interchangeable slot: items sharing one slot replace each other. */
  slot: string;
  /** Bone the finished piece follows; absent for a look, which replaces her model. */
  bone?: string;
  /** Which physical part of the outfit this is, in plain words. */
  part?: string;
  /** Reference ids that may drive this asset's geometry, most authoritative first. */
  references: string[];
  generation: { kind: "image-to-3d" | "multi-image-to-3d"; geometry?: "standard" | "2k"; polycount?: number };
  /** Rig it to her skeleton (only meaningful for a full outfit). */
  rig?: boolean;
  /** True when this asset can be worn as a complete look. */
  isLook?: boolean;
  /** Design features a person must confirm, because the source cannot show them. */
  inferred?: string[];
  /** Runtime/wearable notes worth keeping with the asset. */
  note?: string;
}

export interface InventoryLook {
  id: string;
  title: string;
  authority: string[];
  boards: string[];
  assets: InventoryAsset[];
}

export interface WardrobeInventory {
  version: number;
  character: string;
  looks: InventoryLook[];
}

export interface PlannedAsset {
  look: string;
  asset: InventoryAsset;
  kind: ForgeJobKind;
  body: Record<string, unknown>;
  estimate: number;
  rigEstimate: number;
  /** Empty when the asset can be planned now. */
  blockers: string[];
}

const PIECE_POLYCOUNT = 20_000;
const OUTFIT_POLYCOUNT = 60_000;

export function validateInventory(raw: unknown): WardrobeInventory {
  const data = raw as WardrobeInventory;
  if (!data || typeof data !== "object") throw new Error("Inventory must be a JSON object.");
  if (!Array.isArray(data.looks) || data.looks.length === 0) throw new Error("Inventory needs a non-empty looks array.");
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const look of data.looks) {
    if (!look.id || !/^[a-z][a-z0-9_]*$/.test(look.id)) problems.push(`Look id "${look.id}" must be lowercase a-z, 0-9, underscore.`);
    if (!Array.isArray(look.assets) || look.assets.length === 0) problems.push(`Look "${look.id}" has no assets.`);
    for (const asset of look.assets ?? []) {
      const where = `${look.id}/${asset.id}`;
      if (!asset.id || !/^[a-z][a-z0-9_]*$/.test(asset.id)) problems.push(`${where}: id must be lowercase a-z, 0-9, underscore.`);
      if (seen.has(asset.id)) problems.push(`${where}: id is used more than once.`);
      seen.add(asset.id);
      if (!INVENTORY_CATEGORIES.has(asset.category)) problems.push(`${where}: category "${asset.category}" is not a wardrobe category (${[...INVENTORY_CATEGORIES].join(", ")}).`);
      if (!asset.slot) problems.push(`${where}: needs a slot.`);
      if (asset.category !== "look" && !asset.bone) problems.push(`${where}: needs the bone it follows (only a look replaces her model).`);
      if (!Array.isArray(asset.references)) problems.push(`${where}: references must be an array (empty is allowed, and blocks it).`);
      if (asset.generation?.kind === "multi-image-to-3d" && (asset.references ?? []).length > 4) problems.push(`${where}: multi-image takes at most 4 references.`);
    }
  }
  if (problems.length) throw new Error(`Inventory is invalid:\n  - ${problems.join("\n  - ")}`);
  return data;
}

/** The request an asset would send, built from the same settings as the approved looks. */
export function requestFor(asset: InventoryAsset, referenceIds: string[]): Record<string, unknown> {
  const piece = asset.category !== "look";
  const shared = {
    ai_model: "meshy-7.1",
    should_texture: true,
    enable_pbr: true,
    texture_resolution: "2k",
    should_remesh: true,
    topology: "triangle",
    target_polycount: asset.generation.polycount ?? (piece ? PIECE_POLYCOUNT : OUTFIT_POLYCOUNT),
    image_enhancement: false,
  };
  if (asset.generation.geometry === "2k") shared["geometry_resolution"] = "2k";
  return asset.generation.kind === "multi-image-to-3d"
    ? { ...shared, image_urls: referenceIds.map((id) => `ref:${id}`) }
    : { ...shared, image_url: `ref:${referenceIds[0]}` };
}

/**
 * Plan every asset in the inventory against the references that actually
 * exist. Free: no job is filed, nothing is submitted.
 */
export function planInventory(inventory: WardrobeInventory, references: ReferenceRecord[]): PlannedAsset[] {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const planned: PlannedAsset[] = [];
  for (const look of inventory.looks) {
    for (const asset of look.assets) {
      const blockers: string[] = [];
      const usable = asset.references.filter((id) => byId.has(id));
      for (const id of asset.references.filter((id) => !byId.has(id))) blockers.push(`reference "${id}" is not ingested`);
      if (!asset.references.length) blockers.push("no reference assigned: a crop of the board or the original photograph must be chosen first");
      if (asset.references.length && !usable.length) blockers.push("none of its references exist on disk");
      if (asset.generation.kind === "multi-image-to-3d" && usable.length < 2) blockers.push(`multi-image needs at least 2 usable references (has ${usable.length})`);
      if (asset.generation.kind === "multi-image-to-3d" && usable.length > 4) blockers.push("multi-image takes at most 4 references");
      if (asset.isLook && usable.length < 1) blockers.push("a look needs at least one full-body reference");
      const body = requestFor(asset, usable.length ? usable : asset.references.slice(0, 1));
      const estimate = blockers.length ? 0 : estimateCredits(asset.generation.kind, body);
      const rigEstimate = blockers.length || !asset.rig ? 0 : estimateCredits("rigging", {});
      planned.push({ look: look.id, asset, kind: asset.generation.kind, body, estimate, rigEstimate, blockers });
    }
  }
  return planned;
}

export function totalise(planned: PlannedAsset[]): { ready: number; blocked: number; generation: number; rigging: number } {
  return planned.reduce(
    (sum, item) => ({
      ready: sum.ready + (item.blockers.length ? 0 : 1),
      blocked: sum.blocked + (item.blockers.length ? 1 : 0),
      generation: sum.generation + item.estimate,
      rigging: sum.rigging + item.rigEstimate,
    }),
    { ready: 0, blocked: 0, generation: 0, rigging: 0 },
  );
}

export function categoryOf(asset: InventoryAsset): WardrobeCategory {
  return asset.category as WardrobeCategory;
}
