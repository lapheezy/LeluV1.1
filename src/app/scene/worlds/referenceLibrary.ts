/**
 * The local reference registry in the browser (dev server only: it serves the
 * Git-ignored reference/ folder; a production build has no such files, so the
 * library is empty there and says so). Also: a palette taken from a reference.
 */
import { referenceById, referencesFor, searchReferences, type ReferenceEntry, type ReferenceQuery, type Registry } from "../../../core/references/ReferenceRegistry";

let cache: Promise<Registry | null> | null = null;
export function loadReferences(): Promise<Registry | null> {
  cache ??= fetch("/reference/registry.json", { cache: "no-store" })
    .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? (r.json() as Promise<Registry>) : null))
    .catch(() => null);
  return cache;
}
export const findReferences = async (q: ReferenceQuery) => searchReferences((await loadReferences()) ?? { entries: [] }, q);
export const getReference = async (id: string) => referenceById((await loadReferences()) ?? { entries: [] }, id);
export const referencesForTarget = async (t: string) => referencesFor((await loadReferences()) ?? { entries: [] }, t);

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error(`reference image not available: ${url}`));
    im.src = url;
  });

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/**
 * Sky (top → horizon), accent and glow taken from the reference's own pixels
 * (inside its crop): the bands' average colours, the most saturated colour and
 * the brightest. Reads the image; never stores or uploads it.
 */
export async function paletteFromReference(e: ReferenceEntry): Promise<{ sky: [string, string, string]; accent: string; glow: string }> {
  const im = await loadImage(e.url);
  const [cx, cy, cx2, cy2] = e.crop ?? [0, 0, im.naturalWidth, im.naturalHeight];
  const W = 64, H = 64;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(im, cx, cy, cx2 - cx, cy2 - cy, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const band = (y0: number, y1: number) => {
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        r += d[i];
        gg += d[i + 1];
        b += d[i + 2];
        n++;
      }
    return hex(r / n, gg / n, b / n);
  };
  let best = { s: -1, c: "#a855f7" }, bright = { l: -1, c: "#f5c46b" };
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
    if (s * (l > 0.2 && l < 0.85 ? 1 : 0.3) > best.s) best = { s: s * (l > 0.2 && l < 0.85 ? 1 : 0.3), c: hex(d[i], d[i + 1], d[i + 2]) };
    if (l > bright.l) bright = { l, c: hex(d[i], d[i + 1], d[i + 2]) };
  }
  return { sky: [band(0, 0.25), band(0.35, 0.6), band(0.7, 1)], accent: best.c, glow: bright.c };
}
