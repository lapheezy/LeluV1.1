/**
 * The browser's local image store for workspace images (photos taken or
 * uploaded, visuals that arrived as data). Images stay on this device
 * (IndexedDB); a world stores only the key "img:<id>".
 */
import { addWorld } from "../../../core/worlds/WorldStore";
import { imageWorkspace, type ImageSource, type Palette } from "../../../core/workspaces/imageWorkspace";
import { getReference } from "./referenceLibrary";

const DB = "lelu-workspace-images", STORE = "images";
const open = () =>
  new Promise<IDBDatabase>((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });

export async function putImage(blob: Blob): Promise<string> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const db = await open();
  await new Promise<void>((ok, fail) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(blob, id);
    t.oncomplete = () => ok();
    t.onerror = () => fail(t.error);
  });
  return `img:${id}`;
}

const urls = new Map<string, string>();
/** A displayable URL for a source: local keys become object URLs; URLs pass through. */
export async function imageUrl(src: string): Promise<string | null> {
  if (!src.startsWith("img:")) return src;
  if (urls.has(src)) return urls.get(src)!;
  const db = await open();
  const blob = await new Promise<Blob | undefined>((ok) => {
    const r = db.transaction(STORE).objectStore(STORE).get(src.slice(4));
    r.onsuccess = () => ok(r.result as Blob | undefined);
    r.onerror = () => ok(undefined);
  });
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(src, u);
  return u;
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error("image not available"));
    im.src = url;
  });

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** Sky bands, most saturated colour and brightest colour, read from the image's pixels (inside its crop). */
export async function paletteFromImage(url: string, crop?: [number, number, number, number]): Promise<Palette> {
  const im = await loadImage(url);
  const [cx, cy, cx2, cy2] = crop ?? [0, 0, im.naturalWidth, im.naturalHeight];
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
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2;
    const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
    const score = s * (l > 0.2 && l < 0.85 ? 1 : 0.3);
    if (score > best.s) best = { s: score, c: hex(d[i], d[i + 1], d[i + 2]) };
    if (l > bright.l) bright = { l, c: hex(d[i], d[i + 1], d[i + 2]) };
  }
  return { sky: [band(0, 0.25), band(0.35, 0.6), band(0.7, 1)], accent: best.c, glow: bright.c };
}

/**
 * Turn any image into a full-screen 2D workspace and make it the active one.
 * `image` is a reference id, a URL, a data URL, or a Blob (photo/upload).
 */
export async function makeWorkspace(input: { origin: ImageSource["origin"]; title: string; ref?: string; url?: string; blob?: Blob; provenance?: string }) {
  let src: string | undefined;
  let crop: [number, number, number, number] | undefined;
  let view: string | null = null;
  if (input.ref) {
    const e = await getReference(input.ref);
    if (!e) throw new Error(`Reference ${input.ref} is not available on this machine.`);
    if (e.status !== "usable") throw new Error(`${e.code} is ${e.status}; it is not used as a visual.`);
    view = e.url;
    crop = e.crop;
  } else if (input.blob) {
    src = await putImage(input.blob);
    view = await imageUrl(src);
  } else if (input.url?.startsWith("data:")) {
    src = await putImage(await (await fetch(input.url)).blob());
    view = await imageUrl(src);
  } else if (input.url) {
    src = input.url;
    view = input.url;
  }
  if (!view) throw new Error("No image to build a workspace from.");
  let palette: Palette | undefined;
  try {
    palette = await paletteFromImage(view, crop);
  } catch {
    palette = undefined; // a cross-origin image can still be shown; its palette just cannot be read
  }
  return addWorld(imageWorkspace({ origin: input.origin, title: input.title, ref: input.ref, src, provenance: input.provenance }, palette));
}
