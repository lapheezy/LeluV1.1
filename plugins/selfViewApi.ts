/**
 * ==========================================================
 * LÉLU — SEEING HER OWN WORK: CAPTURE, PREVIEW, SEARCH
 *
 * LÉLU could already copy her project into an isolated workspace, edit
 * it, diff it and run its typecheck/tests (engineerApi). What she could
 * not do was SEE anything: not a rendered web page, not her own
 * interface, not the result of a change to it. A UI improvement judged
 * from source code alone is a guess. This gives her eyes, on the server:
 *
 *   POST /api/browser/capture   a real headless Chromium (Playwright)
 *        loads a page and returns a screenshot plus a LAYOUT REPORT —
 *        controls that sit partly off-screen and controls covered by
 *        something else — measured in the rendered page, not inferred.
 *        Targets: public http(s) pages; this app's own origin (her
 *        running UI); or one of her preview servers (below).
 *        For her own UI it can open a named panel at a phone or desktop
 *        size first, the same way the user would get there.
 *
 *   POST /api/engineer/preview  start / stop / status a dev server for a
 *        WORKSPACE COPY (.lelu-sandbox/<id>), on a loopback port. She can
 *        look at her changed interface before anything reaches the real
 *        project. One preview per workspace, stopped after 20 minutes.
 *
 *   POST /api/engineer/search   read-only text search inside the project
 *        or a workspace copy — how she finds the code behind what she saw.
 *
 * SAFETY
 *   - Same-origin POST only (CSRF), and LELU_ENGINEER_TOKEN when set —
 *     the engineering runtime's own gates.
 *   - Capture never fetches a private/loopback address except this
 *     server's own origin and its own previews. It returns pixels and
 *     visible text only — no cookies, headers or storage.
 *   - Preview runs the project's own `vite` binary with fixed arguments;
 *     no caller-supplied command. Search is a bounded in-process scan,
 *     no shell.
 *   - No headless browser installed → an honest 503, never a fake image.
 * ==========================================================
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isBlockedHost } from "./browseApi.ts";

interface ConnectLikeReq {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on: (event: string, handler: (chunk?: unknown) => void) => void;
}
interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}
type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

const PROJECT_ROOT = process.cwd();
const SANDBOX_ROOT = path.join(PROJECT_ROOT, ".lelu-sandbox");
const PREVIEW_PORT_BASE = 5310;
const PREVIEW_PORTS = 20;
const PREVIEW_LIFETIME_MS = 20 * 60 * 1000;
// Her app and previews are loaded twice (see capture()); at the ~2 frames a
// second a headless renderer manages here, each load with its settle wait
// can take ~35 s.
const CAPTURE_TIMEOUT_MS = 150_000;
const MAX_SCREENSHOT_BYTES = 900_000;

export const CAPTURE_VIEWPORTS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false },
} as const;
export type CaptureViewport = keyof typeof CAPTURE_VIEWPORTS;

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: ConnectLikeReq, limit = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    req.on("data", (chunk) => {
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
      size += text.length;
      if (size > limit) reject(new Error("Request body too large."));
      else chunks.push(text);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? (JSON.parse(chunks.join("")) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Body is not valid JSON."));
      }
    });
    req.on("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
}

function header(req: ConnectLikeReq, name: string): string {
  const value = req.headers?.[name];
  return typeof value === "string" ? value : "";
}

function isCrossOrigin(req: ConnectLikeReq): boolean {
  const origin = header(req, "origin");
  const host = header(req, "host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function tokenOk(req: ConnectLikeReq): boolean {
  const required = process.env.LELU_ENGINEER_TOKEN;
  if (!required) return true;
  return header(req, "x-lelu-engineer-token") === required;
}

/* ------------------------------ previews ------------------------------ */

interface Preview {
  workspace: string;
  port: number;
  child: ChildProcess;
  startedAt: number;
  log: string[];
  timer: ReturnType<typeof setTimeout>;
}

const previews = new Map<string, Preview>();

export function safeWorkspaceId(raw: unknown): string {
  const id = String(raw ?? "");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id) || id.startsWith(".")) {
    throw new Error("A workspace id is letters, digits, dot, dash or underscore (max 64).");
  }
  return id;
}

function workspaceRoot(id: string): string {
  const root = path.join(SANDBOX_ROOT, id);
  if (!existsSync(root)) throw new Error(`No workspace "${id}". Create it with project.copy first.`);
  return root;
}

function previewOrigins(): string[] {
  return [...previews.values()].map((preview) => `http://127.0.0.1:${preview.port}`);
}

function stopPreview(id: string): boolean {
  const preview = previews.get(id);
  if (!preview) return false;
  clearTimeout(preview.timer);
  try {
    if (preview.child.pid) process.kill(-preview.child.pid, "SIGTERM");
  } catch {
    preview.child.kill("SIGTERM");
  }
  previews.delete(id);
  return true;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function startPreview(id: string): Promise<{ ok: boolean; url?: string; error?: string; log?: string }> {
  const existing = previews.get(id);
  if (existing) return { ok: true, url: `http://127.0.0.1:${existing.port}` };
  const root = workspaceRoot(id);
  const used = new Set([...previews.values()].map((preview) => preview.port));
  let port = 0;
  for (let i = 0; i < PREVIEW_PORTS; i += 1) {
    if (!used.has(PREVIEW_PORT_BASE + i)) {
      port = PREVIEW_PORT_BASE + i;
      break;
    }
  }
  if (!port) return { ok: false, error: "Every preview port is in use; stop one first." };
  const vite = path.join(root, "node_modules", ".bin", "vite");
  if (!existsSync(vite)) return { ok: false, error: "The workspace has no vite binary (node_modules missing)." };
  const log: string[] = [];
  const child = spawn(vite, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    detached: true,
    env: { ...process.env, LELU_PREVIEW_OF: id, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (chunk: Buffer) => {
    log.push(chunk.toString("utf8"));
    if (log.length > 60) log.splice(0, log.length - 60);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const timer = setTimeout(() => stopPreview(id), PREVIEW_LIFETIME_MS);
  previews.set(id, { workspace: id, port, child, startedAt: Date.now(), log, timer });
  child.on("exit", () => {
    const current = previews.get(id);
    if (current?.child === child) {
      clearTimeout(current.timer);
      previews.delete(id);
    }
  });
  const url = `http://127.0.0.1:${port}`;
  const up = await waitForHttp(url, 60_000);
  if (!up) {
    stopPreview(id);
    return { ok: false, error: "The preview server did not start within 60 s.", log: log.join("").slice(-2000) };
  }
  return { ok: true, url };
}

/* ------------------------------- search ------------------------------- */

const SEARCH_SKIP = new Set([".git", "node_modules", "dist", ".lelu-sandbox", ".vite", ".cache", "android", "ios"]);
const SEARCH_EXT = /\.(tsx?|jsx?|mjs|cjs|css|html|json|md)$/;

export function searchFiles(root: string, query: string, options: { regex?: boolean; limit?: number; under?: string } = {}) {
  const limit = Math.min(options.limit ?? 40, 200);
  const pattern = options.regex ? new RegExp(query, "i") : null;
  const needle = query.toLowerCase();
  const start = options.under ? path.resolve(root, options.under) : root;
  if (start !== root && !start.startsWith(root + path.sep)) throw new Error("Search path escapes the workspace.");
  const matches: Array<{ path: string; line: number; text: string }> = [];
  let filesScanned = 0;
  const walk = (dir: string) => {
    if (matches.length >= limit) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (matches.length >= limit) return;
      if (SEARCH_SKIP.has(name)) continue;
      const full = path.join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (SEARCH_EXT.test(name) && stat.size < 1_500_000) {
        filesScanned += 1;
        const lines = readFileSync(full, "utf8").split("\n");
        for (let i = 0; i < lines.length && matches.length < limit; i += 1) {
          const line = lines[i];
          if (pattern ? pattern.test(line) : line.toLowerCase().includes(needle)) {
            matches.push({ path: path.relative(root, full).split(path.sep).join("/"), line: i + 1, text: line.trim().slice(0, 200) });
          }
        }
      }
    }
  };
  walk(start);
  return { matches, filesScanned, truncated: matches.length >= limit };
}

/* ------------------------------- capture ------------------------------ */

export interface LayoutFinding {
  label: string;
  rect: [number, number, number, number];
  problem: "off-screen" | "partly-off-screen" | "covered" | "sideways-overflow";
  coveredBy?: string;
  /** For sideways-overflow: how much wider the content is than its box. */
  detail?: string;
}

/**
 * Which origins may be captured: any public http(s) page, this server's
 * own origin (her running UI) and her own previews. Nothing else on the
 * private network.
 */
export function captureTargetAllowed(target: URL, ownHost: string, previewHosts: readonly string[]): boolean {
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;
  if (ownHost && target.host === ownHost) return true;
  if (previewHosts.includes(target.host)) return true;
  return !isBlockedHost(target.hostname);
}

/* Page scripts — they run inside the captured page. */

const DISMISS_NOTICE_SCRIPT = `(() => {
  const button = [...document.querySelectorAll("[data-lelu-signin-gate] button")].find((b) => b.textContent && b.textContent.trim() === "Continue");
  if (button) button.click();
  return Boolean(button);
})()`;

function openPanelScript(panel: string): string {
  return `(async () => {
    try {
      const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
      const result = Bus.getInstance().dispatch({ type: "open_panel", target: ${JSON.stringify(panel)}, reason: "self-inspection", initiatedBy: "lelu" });
      return result.ok ? ${JSON.stringify(panel)} : "failed: " + result.detail;
    } catch (error) {
      return "failed: " + String(error);
    }
  })()`;
}

/**
 * Measured in the rendered page: every visible control that is off-screen,
 * partly off-screen, or covered at its centre by something else; and every
 * box whose content is wider than the box itself (sideways overflow).
 *
 * Measured before (self-improvement run 8): two captures of the SAME page
 * reported 12 and 9 problems — in one, the panel happened to be scrolled
 * sideways — and controls simply below the fold of a scrolling panel were
 * reported "off-screen", though a user scrolls to them. So:
 *   - every scroll position is reset first: the page as a user first sees it;
 *   - a control is judged against what is VISIBLE of it — the viewport cut
 *     down by every ancestor that clips (overflow other than visible);
 *   - out of view only vertically, inside something that scrolls
 *     vertically, is reachable and not a finding;
 *   - sideways is always a finding: on a phone nobody finds a hidden
 *     sideways scroll.
 */
export const LAYOUT_SCRIPT = `(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const findings = [];
  const describe = (el) => {
    const aria = el.getAttribute("aria-label");
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40);
    const testid = el.getAttribute("data-testid");
    return el.tagName.toLowerCase() + (aria ? "[" + aria + "]" : "") + (testid ? "#" + testid : "") + (text && !aria ? ' "' + text + '"' : "");
  };
  let scrollsReset = 0;
  window.scrollTo(0, 0);
  for (const el of document.querySelectorAll("*")) {
    if (el.scrollLeft !== 0 || el.scrollTop !== 0) { el.scrollLeft = 0; el.scrollTop = 0; scrollsReset += 1; }
  }
  const clips = (value) => value !== "visible";
  const scrolls = (value) => value === "auto" || value === "scroll";
  // What is visible of an element: the viewport, cut down by every clipping
  // ancestor; and whether some ancestor scrolls vertically.
  const visibleBox = (el) => {
    let left = 0, top = 0, right = vw, bottom = vh, scrollsVertically = false;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.position === "fixed") {
        // Nothing above a fixed box clips it.
        if (clips(s.overflowX) || clips(s.overflowY)) {
          const r = a.getBoundingClientRect();
          if (clips(s.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
          if (clips(s.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
        }
        if (scrolls(s.overflowY) && a.scrollHeight > a.clientHeight + 1) scrollsVertically = true;
        break;
      }
      const r = a.getBoundingClientRect();
      if (clips(s.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
      if (clips(s.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
      if (scrolls(s.overflowY) && a.scrollHeight > a.clientHeight + 1) scrollsVertically = true;
    }
    if (document.documentElement.scrollHeight > vh + 1 && getComputedStyle(document.body).overflowY !== "hidden") scrollsVertically = true;
    return { left, top, right, bottom, scrollsVertically };
  };
  // A modal's backdrop: a fixed layer over the whole viewport, tinted but
  // see-through. Controls behind it are covered ON PURPOSE while the modal
  // is open (measured in runs 10 and 13: the header buttons behind an
  // expanded panel's backdrop, reported as covered, were chased as a bug
  // twice). They are counted, not reported as problems.
  const isModalBackdrop = (el) => {
    const s = getComputedStyle(el);
    if (s.position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    if (r.left > 1 || r.top > 1 || r.right < vw - 1 || r.bottom < vh - 1) return false;
    const m = /rgba?\\(([^)]+)\\)/.exec(s.backgroundColor);
    const alpha = m ? (m[1].split(",")[3] === undefined ? 1 : Number(m[1].split(",")[3])) : 0;
    return (alpha > 0.05 && alpha < 0.95) || s.backdropFilter !== "none";
  };
  const controls = [...document.querySelectorAll("button, a[href], input, textarea, select, [role='button'], [role='switch'], [role='tab']")];
  let belowTheFold = 0;
  let behindModal = 0;
  for (const el of controls) {
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    const box = visibleBox(el);
    const sidewaysOut = r.right <= box.left || r.left >= box.right;
    const sidewaysPartly = !sidewaysOut && (r.left < box.left - 1 || r.right > box.right + 1);
    const verticalOut = r.bottom <= box.top || r.top >= box.bottom;
    const verticalPartly = !verticalOut && (r.top < box.top - 1 || r.bottom > box.bottom + 1);
    if (sidewaysOut) {
      // Drawers parked off-screen on purpose are not findings; a control in
      // a container that is itself on screen is.
      const parent = el.parentElement && el.parentElement.getBoundingClientRect();
      if (parent && parent.right > 0 && parent.left < vw) findings.push({ label: describe(el), rect, problem: "off-screen" });
      continue;
    }
    if (sidewaysPartly) {
      findings.push({ label: describe(el), rect, problem: "partly-off-screen" });
      continue;
    }
    if (verticalOut || verticalPartly) {
      if (box.scrollsVertically) { belowTheFold += 1; continue; }
      findings.push({ label: describe(el), rect, problem: verticalOut ? "off-screen" : "partly-off-screen" });
      continue;
    }
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) {
      if (isModalBackdrop(top)) { behindModal += 1; continue; }
      findings.push({ label: describe(el), rect, problem: "covered", coveredBy: describe(top) });
    }
  }
  // Boxes whose content is wider than they are: the cause behind most
  // sideways findings. Outermost only; at most five.
  const wide = [];
  for (const el of document.querySelectorAll("body *")) {
    // Clipped text (an ellipsis), or content that is wider without hiding
    // anything, is not a layout problem: only a box that actually cuts off
    // one of its controls counts. (Measured in run 11: a chat tab whose
    // content measured 159px in a 110px box, every part of it visible —
    // reported as overflow, it sent LÉLU after a problem that did not exist.)
    if (el.scrollWidth <= el.clientWidth + 8 || el.clientWidth < 40) continue;
    const s = getComputedStyle(el);
    if (!clips(s.overflowX) || s.display === "none" || s.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    const cutOff = [...el.querySelectorAll("button, a[href], input, textarea, select, [role='button'], [role='switch'], [role='tab']")].some((control) => {
      const c = control.getBoundingClientRect();
      return c.width >= 2 && (c.left < r.left - 1 || c.right > r.right + 1);
    });
    if (!cutOff) continue;
    if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) continue;
    if (wide.some((outer) => outer.contains(el))) continue;
    wide.push(el);
    // Where the overflow BEGINS — what devtools would show: descendants
    // that stick out past this box while their own parent still fits,
    // with their size and the styles that size them. Run 14 measured the
    // need: LÉLU saw "518px in a 356px box", guessed the title text, and
    // spent three attempts on padding and the window width. This names no
    // fix; it says which element is too wide and how it is sized.
    // The narrowest this element can be (its min-content width): a
    // stretched child is as wide as its parent whatever it holds, so the
    // current width alone cannot tell the element that FORCES the width
    // from one merely stretched to it. Measured by setting width:
    // min-content for an instant and restoring the inline style exactly.
    const minContent = (node) => {
      const before = node.style.getPropertyValue("width");
      const priority = node.style.getPropertyPriority("width");
      node.style.setProperty("width", "min-content", "important");
      const w = Math.round(node.getBoundingClientRect().width);
      if (before) node.style.setProperty("width", before, priority); else node.style.removeProperty("width");
      return w;
    };
    const sizing = (node) => {
      const cs = getComputedStyle(node);
      const parts = ["width " + Math.round(node.getBoundingClientRect().width) + "px", "needs at least " + minContent(node) + "px"];
      const parentDisplay = node.parentElement ? getComputedStyle(node.parentElement).display : "";
      // For a flex or grid item, min-width auto vs 0 decides whether it can
      // shrink below its content: always shown.
      if (/flex|grid/.test(parentDisplay) || (cs.minWidth !== "auto" && cs.minWidth !== "0px")) parts.push("min-width " + cs.minWidth);
      if (cs.maxWidth !== "none") parts.push("max-width " + cs.maxWidth);
      if (cs.flexGrow !== "0" || cs.flexShrink !== "1" || cs.flexBasis !== "auto") parts.push("flex " + cs.flexGrow + " " + cs.flexShrink + " " + cs.flexBasis);
      if (cs.display === "flex" || cs.display === "inline-flex") parts.push("display flex" + (cs.flexWrap !== "nowrap" ? " wrap" : "") + (cs.flexDirection !== "row" ? " " + cs.flexDirection : ""));
      if (cs.display === "grid") parts.push("grid columns " + cs.gridTemplateColumns);
      return parts.join(", ");
    };
    const begins = [];
    const queue = [...el.children].map((child) => ({ node: child, depth: 1 }));
    while (queue.length && begins.length < 2) {
      const { node, depth } = queue.shift();
      const nr = node.getBoundingClientRect();
      if (nr.width < 2) continue;
      const parentRight = node.parentElement === el ? r.right : node.parentElement.getBoundingClientRect().right;
      if (nr.right > r.right + 1 && nr.right > parentRight + 1) {
        // Then down the widest path to what actually sets the width: the
        // child reaching furthest right, while it still sticks out.
        const chain = [describe(node).slice(0, 40) + " (" + sizing(node) + ")"];
        let at = node;
        for (let step = 0; step < 6; step += 1) {
          // Follow the child that FORCES the width — the largest min-content
          // — not the one reaching furthest right: in a column every child
          // is stretched to the same width (measured on the Avatar panel:
          // a header row needing 223px and a body needing 494px, both 494px
          // wide; following the furthest-right one led to the header).
          let next = null;
          let nextNeeds = -1;
          const out = [];
          for (const child of at.children) {
            const cr = child.getBoundingClientRect();
            if (cr.width < 2 || cr.right <= r.right + 1) continue;
            const needs = minContent(child);
            out.push({ child, needs });
            if (needs > nextNeeds) { next = child; nextNeeds = needs; }
          }
          if (!next) break;
          const also = out.filter((entry) => entry.child !== next).slice(0, 2).map((entry) => describe(entry.child).slice(0, 30) + " (" + sizing(entry.child) + (entry.needs <= r.width ? "; fits when not stretched" : "") + ")");
          chain.push(describe(next).slice(0, 40) + " (" + sizing(next) + ")" + (also.length ? " [also sticking out here: " + also.join("; ") + "]" : ""));
          at = next;
        }
        begins.push(chain.join(" → ") + (node.parentElement === el ? "" : " — inside " + describe(node.parentElement).slice(0, 30) + " (" + sizing(node.parentElement) + ")"));
        continue;
      }
      if (depth < 8) for (const child of node.children) queue.push({ node: child, depth: depth + 1 });
    }
    findings.push({
      label: describe(el).slice(0, 80),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      problem: "sideways-overflow",
      detail: "content " + el.scrollWidth + "px wide in a " + el.clientWidth + "px box" + (begins.length ? "; the overflow begins at: " + begins.join(" | ") : ""),
    });
    if (wide.length >= 5) break;
  }
  if (document.documentElement.scrollWidth > vw + 1) {
    findings.push({ label: "page", rect: [0, 0, document.documentElement.scrollWidth, vh], problem: "sideways-overflow", detail: "page " + document.documentElement.scrollWidth + "px wide in a " + vw + "px viewport" });
  }
  return {
    viewport: [vw, vh],
    controls: controls.length,
    belowTheFold,
    behindModal,
    scrollsReset,
    findings: findings.slice(0, 40),
    text: (document.body.innerText || "").slice(0, 2500),
  };
})()`;

/** Where every control is, rounded: equal twice in a row = the layout has settled. */
const LAYOUT_SIGNATURE_SCRIPT = `(() => [...document.querySelectorAll("button, a[href], input, textarea, select, [role='button'], [role='switch'], [role='tab']")]
  .map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(","); })
  .join(";"))()`;

/**
 * Measured in run 8: the same panel measured 12 and then 9 problems, its
 * controls caught at different widths and offsets — the panel's opening
 * transition was still running (a headless renderer here draws ~2 frames
 * a second). Wait until every control's position is identical across two
 * readings, bounded; the report says whether it settled.
 */
export async function waitForStableLayout(page: { evaluate: (script: string) => Promise<unknown>; waitForTimeout: (ms: number) => Promise<void> }, limitMs = 12_000): Promise<{ settled: boolean; waitedMs: number }> {
  const started = Date.now();
  let previous = String(await page.evaluate(LAYOUT_SIGNATURE_SCRIPT));
  while (Date.now() - started < limitMs) {
    await page.waitForTimeout(700);
    const next = String(await page.evaluate(LAYOUT_SIGNATURE_SCRIPT));
    if (next === previous) return { settled: true, waitedMs: Date.now() - started };
    previous = next;
  }
  return { settled: false, waitedMs: Date.now() - started };
}

let captureBusy = false;

async function capture(options: {
  url: string;
  viewport: CaptureViewport;
  panel?: string;
  ownApp: boolean;
}): Promise<Record<string, unknown>> {
  let chromium: { launch: (options: Record<string, unknown>) => Promise<unknown> };
  try {
    ({ chromium } = (await import("playwright")) as unknown as { chromium: typeof chromium });
  } catch {
    return { ok: false, status: 503, error: "No headless browser on this server (playwright is not installed), so nothing can be captured." };
  }
  const executablePath = process.env.LELU_CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  type PageLike = {
    goto: (url: string, options: Record<string, unknown>) => Promise<unknown>;
    waitForTimeout: (ms: number) => Promise<void>;
    /** Runs IN THE PAGE: page scripts are strings, since this file has no DOM types. */
    evaluate: (script: string) => Promise<unknown>;
    screenshot: (options: Record<string, unknown>) => Promise<Buffer>;
    title: () => Promise<string>;
    on: (event: string, handler: (arg: { type?: () => string; text?: () => string } & Error) => void) => void;
  };
  const browser = (await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] })) as {
    newContext: (options: Record<string, unknown>) => Promise<{ newPage: () => Promise<PageLike> }>;
    close: () => Promise<void>;
  };
  const size = CAPTURE_VIEWPORTS[options.viewport];
  // One independent load: a fresh context (fresh storage), the same steps.
  const loadOnce = async () => {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.hasTouch });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error.message ?? error).slice(0, 300)));
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(options.ownApp ? 3500 : 1500);

    let panelOpened: string | null = null;
    if (options.ownApp) {
      // Her own UI: clear the first-run notice the way a user would, then
      // open the requested panel through the app's own UI action bus.
      for (let i = 0; i < 6; i += 1) {
        const dismissed = await page.evaluate(DISMISS_NOTICE_SCRIPT);
        await page.waitForTimeout(dismissed ? 500 : 300);
      }
      if (options.panel) {
        panelOpened = String(await page.evaluate(openPanelScript(options.panel)));
        await page.waitForTimeout(2500);
      }
    }

    const stability = await waitForStableLayout(page);
    const layout = { ...((await page.evaluate(LAYOUT_SCRIPT)) as Record<string, unknown>), ...stability } as MeasuredLayout;

    let shot = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });
    if (shot.byteLength > MAX_SCREENSHOT_BYTES) shot = await page.screenshot({ type: "jpeg", quality: 30, fullPage: false });
    return { layout, shot, panelOpened, errors, title: await page.title() };
  };
  try {
    // Her app and her previews are loaded TWICE, independently. Measured in
    // run 20: the same chat panel read 0 and then 2 problems — a background
    // message had arrived in one load, its unread dot widening a tab — and
    // her preview did the same, so "2 → 0" was two app states, not her
    // fix. Findings seen in only some loads are marked as depending on the
    // app's state at load time.
    const loads = [];
    for (let i = 0; i < (options.ownApp ? 2 : 1); i += 1) loads.push(await loadOnce());
    const layout = mergeLoads(loads.map((load) => load.layout));
    // Show the load that found the most: the problem, when it occurs.
    const shown = loads.reduce((best, load) => ((load.layout.findings?.length ?? 0) > (best.layout.findings?.length ?? 0) ? load : best), loads[0]);
    return {
      ok: true,
      url: options.url,
      viewport: options.viewport,
      panel: options.panel ?? null,
      panelOpened: shown.panelOpened,
      title: shown.title,
      layout,
      pageErrors: [...new Set(loads.flatMap((load) => load.errors))].slice(0, 10),
      screenshot: `data:image/jpeg;base64,${shown.shot.toString("base64")}`,
      capturedAt: Date.now(),
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

interface MeasuredLayout {
  viewport?: number[];
  controls?: number;
  findings?: Array<LayoutFinding & { seenIn?: number }>;
  settled?: boolean;
  [key: string]: unknown;
}

/**
 * Several independent loads of the same page, as one report: every finding
 * seen in any load, with `seenIn` (how many loads showed it) and `loads`.
 * A finding seen in fewer than all loads depends on the app's state when
 * it was loaded — not on its code — and is evidence of nothing by itself.
 */
export function mergeLoads(layouts: readonly MeasuredLayout[]): MeasuredLayout & { loads: number; stable: boolean } {
  const key = (finding: LayoutFinding) => `${finding.problem}: ${finding.label}`;
  const merged = new Map<string, LayoutFinding & { seenIn: number }>();
  for (const layout of layouts) {
    for (const finding of layout.findings ?? []) {
      const existing = merged.get(key(finding));
      if (existing) existing.seenIn += 1;
      else merged.set(key(finding), { ...finding, seenIn: 1 });
    }
  }
  const findings = [...merged.values()];
  const first = layouts[0] ?? {};
  return {
    ...first,
    findings,
    settled: layouts.every((layout) => layout.settled !== false),
    loads: layouts.length,
    stable: findings.every((finding) => finding.seenIn === layouts.length),
  };
}

/* ------------------------------- routes ------------------------------- */

export function createSelfViewApi(): { attach: (middlewares: { use: (route: string, handler: Handler) => void }) => void } {
  const guard = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): boolean => {
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
      next();
      return false;
    }
    if (isCrossOrigin(req)) {
      sendJson(res, { ok: false, error: "Cross-origin requests are not permitted." }, 403);
      return false;
    }
    if (!tokenOk(req)) {
      sendJson(res, { ok: false, error: "Engineering runtime requires an access token (LELU_ENGINEER_TOKEN)." }, 401);
      return false;
    }
    return true;
  };

  return {
    attach(middlewares) {
      middlewares.use("/api/browser/capture", (req, res, next) => {
        if (!guard(req, res, next)) return;
        void (async () => {
          if (captureBusy) {
            sendJson(res, { ok: false, error: "A capture is already running; try again in a moment." }, 429);
            return;
          }
          captureBusy = true;
          try {
            const body = await readJsonBody(req);
            const viewport: CaptureViewport = body.viewport === "phone" ? "phone" : "desktop";
            const ownHost = header(req, "host");
            let url: URL;
            let ownApp = false;
            if (typeof body.preview === "string" && body.preview) {
              const preview = previews.get(safeWorkspaceId(body.preview));
              if (!preview) {
                sendJson(res, { ok: false, error: `No running preview for workspace "${body.preview}". Start it with project.preview first.` }, 404);
                return;
              }
              url = new URL(`http://127.0.0.1:${preview.port}/`);
              ownApp = true;
            } else if (body.app === true || typeof body.url !== "string" || !body.url) {
              // Her own running UI, as served to the user by this server.
              url = new URL(`http://127.0.0.1:${(ownHost.split(":")[1] ?? "") || "5173"}/`);
              ownApp = true;
            } else {
              url = new URL(String(body.url));
              if (!captureTargetAllowed(url, ownHost, previewOrigins().map((origin) => new URL(origin).host))) {
                sendJson(res, { ok: false, error: "That address is on a private network; only public pages, this app and its previews can be captured." }, 403);
                return;
              }
              ownApp = url.host === ownHost;
            }
            const result = await Promise.race([
              capture({ url: url.toString(), viewport, panel: typeof body.panel === "string" ? body.panel : undefined, ownApp }),
              new Promise<Record<string, unknown>>((resolve) =>
                setTimeout(() => resolve({ ok: false, status: 504, error: `Capture did not finish within ${CAPTURE_TIMEOUT_MS / 1000} s.` }), CAPTURE_TIMEOUT_MS),
              ),
            ]);
            sendJson(res, result, typeof result.status === "number" ? result.status : result.ok ? 200 : 502);
          } catch (error) {
            sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
          } finally {
            captureBusy = false;
          }
        })();
      });

      middlewares.use("/api/engineer/preview", (req, res, next) => {
        if (!guard(req, res, next)) return;
        void (async () => {
          try {
            const body = await readJsonBody(req);
            const action = String(body.action ?? "status");
            if (action === "status") {
              sendJson(res, {
                ok: true,
                previews: [...previews.values()].map((preview) => ({ workspace: preview.workspace, url: `http://127.0.0.1:${preview.port}`, startedAt: preview.startedAt })),
              });
              return;
            }
            const id = safeWorkspaceId(body.workspace);
            if (action === "start") {
              const started = await startPreview(id);
              sendJson(res, started, started.ok ? 200 : 500);
              return;
            }
            if (action === "stop") {
              sendJson(res, { ok: true, stopped: stopPreview(id) });
              return;
            }
            sendJson(res, { ok: false, error: `Unknown preview action "${action}".` }, 400);
          } catch (error) {
            sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
          }
        })();
      });

      middlewares.use("/api/engineer/search", (req, res, next) => {
        if (!guard(req, res, next)) return;
        void (async () => {
          try {
            const body = await readJsonBody(req);
            const query = String(body.query ?? "");
            if (!query.trim()) {
              sendJson(res, { ok: false, error: "A search needs a query." }, 400);
              return;
            }
            const root = body.workspace ? workspaceRoot(safeWorkspaceId(body.workspace)) : PROJECT_ROOT;
            const result = searchFiles(root, query, {
              regex: body.regex === true,
              limit: typeof body.limit === "number" ? body.limit : undefined,
              under: typeof body.path === "string" ? body.path : undefined,
            });
            sendJson(res, { ok: true, ...result });
          } catch (error) {
            sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
          }
        })();
      });
    },
  };
}

/** Stop every preview (server shutdown). */
export function stopAllPreviews(): void {
  for (const id of [...previews.keys()]) stopPreview(id);
}
