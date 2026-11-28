/**
 * ==========================================================
 * LÉLU — IMAGE WORKSPACES
 *
 * Any image can become a full-screen 2D workspace: one of the owner's
 * references, a photo they take or upload, or a visual LÉLU made or that
 * arrived in a conversation. The image IS the environment (it covers the
 * stage, no 3D); the thread, in any variant, floats over it, and the
 * panels take their frame colours from the image's own palette.
 *
 * The world stores only where the image is (a reference id, a local image
 * key, or a URL), never the pixels: large or private images stay in the
 * browser's local image store.
 *
 * Pure: no DOM, no storage.
 * ==========================================================
 */

import { validateWorld, type WorldConfig, type WorldPalette } from "../worlds/WorldSchema";

export type ImageOrigin = "reference" | "photo" | "generated" | "thread-image";

export interface ImageSource {
  origin: ImageOrigin;
  title: string;
  /** Registry id for references (e.g. owner:U-04). */
  ref?: string;
  /** A local image key ("img:…") or an http(s)/same-origin URL. */
  src?: string;
  /** Where it came from, for the record (conversation, message, reference code). */
  provenance?: string;
}

export interface Palette {
  sky: [string, string, string];
  accent: string;
  glow: string;
}

const ORIGIN_LABEL: Record<ImageOrigin, string> = { reference: "Reference", photo: "Photo", generated: "Her visual", "thread-image": "Thread image" };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "image";

/** The world for an image workspace. `palette` comes from the image when the browser could read it. */
export function imageWorkspace(source: ImageSource, palette?: Palette, now = Date.now()): WorldConfig {
  if (!source.ref && !source.src) throw new Error("An image workspace needs a reference id or an image source.");
  const p: WorldPalette = palette ? { sky: palette.sky, accent: palette.accent, glow: palette.glow, ink: "#ffffff" } : { sky: ["#0b0620", "#1d0b48", "#3a1a5c"], accent: "#a855f7", glow: "#f5c46b", ink: "#ffffff" };
  const { world } = validateWorld({
    id: `ws-${source.origin}-${slug(source.ref ?? source.title)}`,
    name: `${ORIGIN_LABEL[source.origin]} · ${source.title}`.slice(0, 80),
    families: [],
    palette: p,
    mode: "2d",
    quality: "auto",
    motion: 1,
    density: 1,
    camera: { auto: false, distance: 30, height: 6 },
    layers: [
      { id: "workspace-image", slot: "graphics2d", kind: "reference-plate", label: source.title.slice(0, 60), family: `image:${source.origin}`, params: { fit: "fullscreen", title: source.title.slice(0, 160), ...(source.ref ? { ref: source.ref } : {}), ...(source.src ? { src: source.src } : {}), origin: source.origin, ...(source.provenance ? { provenance: source.provenance.slice(0, 80) } : {}) } },
      { id: "workspace-frame", slot: "spatialUI", kind: "panel-frame", label: "Panel frames", family: `image:${source.origin}`, params: { tint: p.sky[0], edge: p.glow, glow: p.accent, blur: 16 } },
      { id: "workspace-motion", slot: "motion", kind: "motion", label: "Motion", family: `image:${source.origin}`, params: { wind: 0, parallax: 0 } },
    ],
    updatedAt: now,
  });
  return world!;
}
