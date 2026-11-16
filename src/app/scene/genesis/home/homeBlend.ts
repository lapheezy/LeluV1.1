/**
 * ==========================================================
 * LÉLU HOME — BLEND AND MERGE LAYOUTS (Mission 15.1)
 *
 *   blend   two layouts mixed by a weight t (0 = all A, 1 = all B):
 *           module order and sizes interpolate per device, hidden,
 *           docked, pinned and collapsed are decided by weighted
 *           vote, numeric parameters interpolate, the family (kind)
 *           comes from the dominant side, and the looks blend too
 *           (colours mix; both borders can be kept as a pair).
 *
 *   merge   pick per device which layout supplies the family, and
 *           separately where the arrangement, the parameters and the
 *           look come from — e.g. phone from A, desktop from B, the
 *           arrangement blended, the look from A.
 *
 * The result is a NEW custom layout (parents recorded); A and B are
 * never changed. Pure: no React, no DOM, no storage.
 * ==========================================================
 */

import {
  DEVICE_CLASSES,
  HOME_MODULES,
  SIZES,
  paramsFor,
  profileFromTemplate,
  type DeviceClass,
  type DeviceOverride,
  type HomeModuleId,
  type HomeTemplate,
  type LayoutParams,
  type ModuleSettings,
  type NRect,
} from "./homeComposition";
import { blendStyles, type HomeStyle } from "./homeStyle";

let seq = 0;
export function newLayoutId(prefix = "layout", now = Date.now()): string {
  seq += 1;
  return `${prefix}-${now.toString(36)}-${seq.toString(36)}`;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Numeric params interpolate (a side that lacks one lends the other's); choices come from the dominant side. */
export function blendParams(a: LayoutParams, b: LayoutParams, t: number): LayoutParams {
  const dominant = t < 0.5 ? a : b;
  const out: LayoutParams = { ...(t < 0.5 ? b : a), ...dominant };
  for (const key of ["lanes", "ratio", "density", "tilt", "depth", "maxWidth", "window"] as const) {
    const x = a[key];
    const y = b[key];
    if (x === undefined && y === undefined) continue;
    const v = lerp(x ?? y!, y ?? x!, t);
    out[key] = key === "lanes" || key === "maxWidth" ? Math.round(v) : Math.round(v * 1000) / 1000;
  }
  return out;
}

/** One device's arrangement, blended from two profiles. */
function blendProfiles(a: HomeTemplate, b: HomeTemplate, device: DeviceClass, t: number): DeviceOverride {
  const pa = profileFromTemplate(a, device);
  const pb = profileFromTemplate(b, device);
  const rankA = new Map(pa.order.map((id, i) => [id, i]));
  const rankB = new Map(pb.order.map((id, i) => [id, i]));
  const order = [...HOME_MODULES].sort((x, y) => {
    const rx = lerp(rankA.get(x) ?? 99, rankB.get(x) ?? 99, t);
    const ry = lerp(rankA.get(y) ?? 99, rankB.get(y) ?? 99, t);
    return rx - ry || HOME_MODULES.indexOf(x) - HOME_MODULES.indexOf(y);
  });
  const vote = (f: (m: ModuleSettings) => boolean) => order.filter((id) => (f(pa.modules[id]) ? 1 - t : 0) + (f(pb.modules[id]) ? t : 0) >= 0.5);
  const sizes: Partial<Record<HomeModuleId, (typeof SIZES)[number]>> = {};
  for (const id of order) sizes[id] = SIZES[Math.round(lerp(SIZES.indexOf(pa.modules[id].size), SIZES.indexOf(pb.modules[id].size), t))];
  const dom = t < 0.5 ? pa : pb;
  const floats: Partial<Record<HomeModuleId, NRect>> = {};
  for (const id of order) {
    const fa = pa.modules[id].mode === "float" ? pa.modules[id].float : undefined;
    const fb = pb.modules[id].mode === "float" ? pb.modules[id].float : undefined;
    if (fa && fb) floats[id] = { x: lerp(fa.x, fb.x, t), y: lerp(fa.y, fb.y, t), w: lerp(fa.w, fb.w, t), h: lerp(fa.h, fb.h, t) };
    else if ((fa ?? fb) && dom.modules[id].mode === "float") floats[id] = (fa ?? fb)!;
  }
  const groupIds = [...new Set(order.map((id) => dom.modules[id].group).filter((g): g is string => Boolean(g)))];
  return {
    order,
    sizes,
    hidden: vote((m) => m.hidden),
    docked: vote((m) => m.mode === "dock"),
    pinned: vote((m) => m.pinned),
    collapsed: vote((m) => m.collapsed),
    floats,
    groups: groupIds.map((g) => ({ id: g, members: order.filter((id) => dom.modules[id].group === g) })).filter((g) => g.members.length > 1),
  };
}

function finish(base: Omit<HomeTemplate, "order" | "sizes"> & { device: Partial<Record<DeviceClass, DeviceOverride>> }): HomeTemplate {
  return { ...base, order: base.device.desktop?.order ?? [...HOME_MODULES], sizes: base.device.desktop?.sizes ?? {} };
}

export function blendLayouts(a: HomeTemplate, b: HomeTemplate, t: number, name?: string, now = Date.now()): HomeTemplate {
  const w = Math.max(0, Math.min(1, t));
  const dominant = w < 0.5 ? a : b;
  const device: Partial<Record<DeviceClass, DeviceOverride>> = {};
  const deviceParams: Partial<Record<DeviceClass, LayoutParams>> = {};
  for (const d of DEVICE_CLASSES) {
    device[d] = blendProfiles(a, b, d, w);
    deviceParams[d] = blendParams(paramsFor(a, d), paramsFor(b, d), w);
  }
  const pct = Math.round(w * 100);
  return finish({
    id: newLayoutId("blend", now),
    name: (name?.trim() || `${a.name} × ${b.name}`).slice(0, 60),
    blurb: `Blend: ${100 - pct}% ${a.name}, ${pct}% ${b.name}.`,
    kind: { ...dominant.kind },
    device,
    deviceParams,
    style: a.style || b.style ? blendStyles(a.style, b.style, w) : undefined,
    parents: [a.id, b.id],
    custom: true,
  });
}

export type Side = "a" | "b";
export interface MergePlan {
  /** Which layout's family (kind) each device uses. */
  kind: Record<DeviceClass, Side>;
  /** Where each device's arrangement comes from: the same side as its kind, a side, or a 50/50 blend. */
  arrangement: "follow" | Side | "blend";
  params: "follow" | Side | "blend";
  look: Side | "blend" | "none";
}

export const DEFAULT_MERGE: MergePlan = { kind: { phone: "a", tablet: "b", desktop: "b" }, arrangement: "follow", params: "follow", look: "blend" };

export function mergeLayouts(a: HomeTemplate, b: HomeTemplate, plan: MergePlan = DEFAULT_MERGE, name?: string, now = Date.now()): HomeTemplate {
  const of = (s: Side) => (s === "a" ? a : b);
  const device: Partial<Record<DeviceClass, DeviceOverride>> = {};
  const deviceParams: Partial<Record<DeviceClass, LayoutParams>> = {};
  const kind = {} as HomeTemplate["kind"];
  for (const d of DEVICE_CLASSES) {
    const side = plan.kind[d];
    kind[d] = of(side).kind[d];
    const arr = plan.arrangement === "follow" ? side : plan.arrangement;
    device[d] = arr === "blend" ? blendProfiles(a, b, d, 0.5) : blendProfiles(of(arr), of(arr), d, 0);
    const par = plan.params === "follow" ? side : plan.params;
    deviceParams[d] = par === "blend" ? blendParams(paramsFor(a, d), paramsFor(b, d), 0.5) : paramsFor(of(par), d);
  }
  const style: HomeStyle | Partial<HomeStyle> | undefined =
    plan.look === "none" ? undefined : plan.look === "blend" ? (a.style || b.style ? blendStyles(a.style, b.style, 0.5) : undefined) : of(plan.look).style;
  const from = DEVICE_CLASSES.map((d) => `${d} ${plan.kind[d] === "a" ? a.name : b.name}`).join(", ");
  return finish({
    id: newLayoutId("merge", now),
    name: (name?.trim() || `${a.name} + ${b.name}`).slice(0, 60),
    blurb: `Merge — ${from}.`,
    kind,
    device,
    deviceParams,
    ...(style ? { style } : {}),
    parents: [a.id, b.id],
    custom: true,
  });
}
