/**
 * ==========================================================
 * LÉLU — LIVE BROWSER SESSIONS
 *
 * Until now LÉLU could READ a page (browseApi, a server-side text
 * fetch) and LOOK at a page (selfViewApi, a one-shot screenshot). She
 * could not USE a browser: no tabs that persist between steps, no
 * clicking, no typing, no way to reach the second page a first page
 * links to, and nothing to show the user while it happens.
 *
 * This is that capability, on the server, with a real Chromium:
 *
 *   POST /api/browser/session   one action in a named session
 *   GET  /api/browser/session   what sessions/tabs exist right now
 *   GET  /api/browser/session/shot  a captured screenshot (evidence)
 *
 * A named session is its own BrowserContext, so two sessions never
 * share cookies, storage or history. Tabs are pages inside that
 * context and survive between actions — that is what makes a process
 * (search → open → compare → act) possible instead of isolated reads.
 *
 * A PRIVATE session is a context with no persistence at all and is
 * destroyed on close. Private is not anonymous: the sites still see
 * this host's address. The report says so rather than implying more.
 *
 * SAFETY
 *   - Every navigation and every sub-request is host-checked with the
 *     same isBlockedHost used by the page reader: no loopback, no
 *     RFC1918, no link-local (cloud metadata). The browser cannot be
 *     used to reach inside the host's own network.
 *   - Consequential actions (clicking something that submits, buys,
 *     pays, deletes, posts or follows) require `confirm: true`.
 *     Refused actions return the reason and do nothing.
 *   - Identity: a verified Supabase session, or — for the local
 *     development server only — a loopback request while
 *     LELU_BROWSER_ALLOW_LOOPBACK is not "0".
 *   - No cookies, headers, storage or environment values are ever
 *     returned; a caller gets pixels and visible text.
 *   - No Chromium available → an honest 503 with the real reason,
 *     never a simulated page.
 * ==========================================================
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractReadable, isBlockedHost } from "./browseApi.ts";
import { verifyRequestIdentity } from "./engineerIdentity.ts";

/* ------------------------------ limits ------------------------------ */

const MAX_SESSIONS = 4;
const MAX_TABS = 8;
const NAV_TIMEOUT_MS = 30_000;
const IDLE_MS = 15 * 60 * 1000;
const STEP_TEXT_LIMIT = 8000;
const MAX_SCREENSHOT_BYTES = 900_000;
const EVIDENCE_ROOT = path.join(process.cwd(), "artifacts", "browser-evidence");
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;
export type SessionViewport = keyof typeof VIEWPORTS;

/* ------------------------- Playwright surface ------------------------ */

interface PwRequest {
  url(): string;
}
interface PwRoute {
  request(): PwRequest;
  abort(): Promise<void>;
  continue(): Promise<void>;
}
interface PwPage {
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded"; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  innerText(selector: string): Promise<string>;
  content(): Promise<string>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
  screenshot(options?: { type?: "png"; fullPage?: boolean }): Promise<Uint8Array>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
  close(): Promise<void>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
  route(url: string, handler: (route: PwRoute) => void): Promise<void>;
}
interface PwBrowser {
  newContext(options?: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}

/* ------------------------------ sessions ----------------------------- */

interface Tab {
  id: string;
  page: PwPage;
  lastUrl: string;
  lastTitle: string;
}

interface Session {
  id: string;
  name: string;
  private: boolean;
  context: PwContext;
  tabs: Map<string, Tab>;
  order: string[];
  activeTab: string;
  createdAt: number;
  lastUsed: number;
  steps: number;
  viewport: SessionViewport;
}

const sessions = new Map<string, Session>();
let browserPromise: Promise<PwBrowser> | null = null;
let browserFailure: string | null = null;

/* --------------------------- small helpers --------------------------- */

interface ConnectLikeReq {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on: (event: string, handler: (chunk?: unknown) => void) => void;
}
interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Buffer) => void;
}
type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function header(req: ConnectLikeReq, name: string): string {
  const value = req.headers?.[name];
  return typeof value === "string" ? value : "";
}

function readJsonBody(req: ConnectLikeReq, limit = 128 * 1024): Promise<Record<string, unknown>> {
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

/** A session name/id that cannot escape the evidence directory. */
export function safeSessionName(raw: unknown): string {
  const name = String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const trimmed = name.replace(/^-+|-+$/g, "").slice(0, 40);
  if (!trimmed) throw new Error("A session needs a name of letters, digits, dash or underscore.");
  return trimmed;
}

/**
 * Does this action change something outside the session? A click on
 * "Buy", "Submit", "Post", "Delete" is not a read; it needs the user's
 * explicit confirmation and must not be inferred from a vague request.
 */
export function isConsequentialAction(text: string): boolean {
  return /\b(submit|send|post|publish|buy|purchase|pay|checkout|order|confirm|delete|remove|follow|subscribe|sign\s?up|register|transfer|book|apply)\b/i.test(
    text,
  );
}

/** Evidence step file inside a session directory — zero padded, ordered. */
export function evidenceStepFile(step: number, action: string): string {
  const safeAction = String(action).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "step";
  return `${String(step).padStart(4, "0")}-${safeAction}.png`;
}

function sessionDir(session: Session): string {
  return path.join(EVIDENCE_ROOT, `${session.id}${session.private ? "-private" : ""}`);
}

/**
 * Record one real step: the screenshot pixels on disk, and one JSON line
 * with what was asked, what the page reported afterwards, and the file.
 * This is the audit trail — it is written from what the browser returned,
 * not from what the caller claimed.
 */
function recordStep(
  session: Session,
  action: string,
  detail: Record<string, unknown>,
  screenshot?: Uint8Array,
): { dir: string; step: number; file?: string } {
  const dir = sessionDir(session);
  mkdirSync(dir, { recursive: true });
  session.steps += 1;
  const step = session.steps;
  let file: string | undefined;
  if (screenshot && screenshot.byteLength > 0) {
    file = evidenceStepFile(step, action);
    writeFileSync(path.join(dir, file), screenshot);
  }
  appendFileSync(
    path.join(dir, "manifest.jsonl"),
    `${JSON.stringify({
      step,
      action,
      at: new Date().toISOString(),
      tab: session.activeTab,
      ...detail,
      file: file ?? null,
    })}\n`,
  );
  return { dir, step, ...(file ? { file } : {}) };
}

/* --------------------------- the browser ---------------------------- */

async function browser(): Promise<PwBrowser> {
  if (browserFailure) throw new Error(browserFailure);
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = (await import("playwright")) as unknown as {
        chromium: { launch: (options: Record<string, unknown>) => Promise<PwBrowser> };
      };
      const executablePath =
        process.env.LELU_CHROMIUM_PATH ||
        (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
      // A container with no font stack paints nothing (measured: a page laid
      // out but every element had zero visible text, so clicks timed out
      // "element is not visible"). If this workspace carries its own fonts,
      // hand them to the browser rather than failing invisibly.
      const localFonts = path.join(process.cwd(), ".pw-libs", "fonts.conf");
      if (!process.env.FONTCONFIG_FILE && existsSync(localFonts)) {
        process.env.FONTCONFIG_FILE = localFonts;
      }
      return chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    })().catch((error: unknown) => {
      browserPromise = null;
      browserFailure =
        `No headless browser could be started here (${
          error instanceof Error ? error.message.split("\n")[0] : String(error)
        }). Nothing was opened or simulated.`;
      throw new Error(browserFailure);
    });
  }
  return browserPromise;
}

/** True when a real browser can run — used by the tool to report honestly. */
export async function browserSessionsAvailable(): Promise<{ ok: boolean; reason: string }> {
  try {
    await browser();
    return { ok: true, reason: "A real headless Chromium is running." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function newContext(session: { private: boolean; viewport: SessionViewport }): Promise<PwContext> {
  const driver = await browser();
  const context = await driver.newContext({
    viewport: VIEWPORTS[session.viewport],
    // A private session keeps nothing on disk; a normal one may keep
    // cookies for the life of the session so a logged-in flow works.
    ...(session.private ? {} : {}),
  });
  /* The browser must not become a way into the host's own network.
     Applied per context, so it also covers sub-resources and redirects. */
  await context.route("**/*", (route) => {
    let host = "";
    try {
      host = new URL(route.request().url()).hostname;
    } catch {
      host = "";
    }
    if (!host || isBlockedHost(host)) {
      void route.abort();
      return;
    }
    void route.continue();
  });
  return context;
}

function normalizeUrl(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("A url is required.");
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("That does not look like a web address.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https pages can be opened.");
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error("That address is not permitted from a browser session.");
  }
  return parsed.toString();
}

function requireSession(raw: unknown): Session {
  const id = String(raw ?? "").trim();
  const session = sessions.get(id);
  if (!session) throw new Error(`No browser session "${id || "(none)"}". Open one first.`);
  session.lastUsed = Date.now();
  return session;
}

function requireTab(session: Session, raw: unknown): Tab {
  const id = raw ? String(raw).trim() : session.activeTab;
  const tab = session.tabs.get(id);
  if (!tab) throw new Error(`Session "${session.name}" has no tab "${id}".`);
  session.activeTab = id;
  return tab;
}

function view(session: Session): Record<string, unknown> {
  return {
    id: session.id,
    name: session.name,
    private: session.private,
    viewport: session.viewport,
    steps: session.steps,
    createdAt: session.createdAt,
    lastUsed: session.lastUsed,
    activeTab: session.activeTab,
    evidenceDir: sessionDir(session),
    tabs: session.order.map((id) => {
      const tab = session.tabs.get(id)!;
      return { id, url: tab.lastUrl, title: tab.lastTitle };
    }),
  };
}

/** Close every session. Called on shutdown and by the idle sweeper. */
export async function closeAllBrowserSessions(): Promise<void> {
  for (const session of [...sessions.values()]) {
    try {
      await session.context.close();
    } catch {
      // A context that is already gone is closed; nothing to report.
    }
    sessions.delete(session.id);
  }
  if (browserPromise) {
    try {
      await (await browserPromise).close();
    } catch {
      // Already closed.
    }
    browserPromise = null;
  }
}

setInterval(() => {
  const cutoff = Date.now() - IDLE_MS;
  for (const session of [...sessions.values()]) {
    if (session.lastUsed < cutoff) {
      void session.context.close().catch(() => undefined);
      sessions.delete(session.id);
    }
  }
}, 60_000).unref?.();

/* ------------------------------ actions ------------------------------ */

async function screenshotOf(tab: Tab, fullPage = false): Promise<Uint8Array> {
  const shot = await tab.page.screenshot({ type: "png", fullPage });
  return shot.byteLength > MAX_SCREENSHOT_BYTES ? new Uint8Array(0) : shot;
}

async function settle(tab: Tab): Promise<void> {
  try {
    await tab.page.waitForLoadState("domcontentloaded");
  } catch {
    // A page that never settles is still readable; the caller sees its URL.
  }
}

async function afterAction(session: Session, tab: Tab, action: string, detail: Record<string, unknown>) {
  try {
    tab.lastUrl = tab.page.url() || tab.lastUrl;
    tab.lastTitle = (await tab.page.title()) || tab.lastTitle;
  } catch {
    // Keep the last known values rather than inventing new ones.
  }
  const shot = await screenshotOf(tab);
  const evidence = recordStep(session, action, { url: tab.lastUrl, title: tab.lastTitle, ...detail }, shot);
  return {
    ok: true as const,
    session: session.id,
    tab: tab.id,
    url: tab.lastUrl,
    title: tab.lastTitle,
    evidence,
    screenshotBytes: shot.byteLength,
  };
}

export async function runSessionAction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const action = String(body.action ?? "").trim();

  if (action === "list") {
    return { ok: true, available: true, sessions: [...sessions.values()].map(view) };
  }

  if (action === "open") {
    if (sessions.size >= MAX_SESSIONS) {
      throw new Error(`There are already ${MAX_SESSIONS} browser sessions; close one first.`);
    }
    const name = safeSessionName(body.name ?? `session-${sessions.size + 1}`);
    const id = `${name}-${Date.now().toString(36).slice(-5)}`;
    const viewport: SessionViewport = body.viewport === "phone" ? "phone" : "desktop";
    const isPrivate = body.private === true;
    const context = await newContext({ private: isPrivate, viewport });
    const page = await context.newPage();
    const tabId = "tab-1";
    const session: Session = {
      id,
      name,
      private: isPrivate,
      context,
      tabs: new Map([[tabId, { id: tabId, page, lastUrl: "", lastTitle: "" }]]),
      order: [tabId],
      activeTab: tabId,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      steps: 0,
      viewport,
    };
    sessions.set(id, session);
    const tab = session.tabs.get(tabId)!;
    if (body.url !== undefined && body.url !== "") {
      const url = normalizeUrl(body.url);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await settle(tab);
    }
    const result = await afterAction(session, tab, "open", { private: isPrivate, viewport });
    return { ...result, sessionView: view(session) };
  }

  if (action === "navigate") {
    const session = requireSession(body.session);
    const tab = requireTab(session, body.tab);
    const url = normalizeUrl(body.url);
    await tab.page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await settle(tab);
    return { ...(await afterAction(session, tab, "navigate", { requested: url })), sessionView: view(session) };
  }

  if (action === "read") {
    const session = requireSession(body.session);
    const tab = requireTab(session, body.tab);
    // innerText measured empty in this headless renderer, and textContent
    // alone carried the page's CSS. The page's HTML goes through the same
    // extractReadable the server-side reader uses, so script/style/tags are
    // stripped exactly once, in one place, for both paths.
    const html = await tab.page.content().catch(() => "");
    const extracted = html ? extractReadable(html) : { title: "", text: "" };
    const rendered = extracted.text.trim() ? "" : await tab.page.innerText("body").catch(() => "");
    const text = (extracted.text || rendered).replace(/\s+\n/g, "\n").trim();
    const clipped = text.length > STEP_TEXT_LIMIT ? `${text.slice(0, STEP_TEXT_LIMIT)}…` : text;
    if (!clipped) {
      const evidence = recordStep(session, "read", { url: tab.page.url(), empty: true });
      return {
        ok: false,
        session: session.id,
        tab: tab.id,
        url: tab.page.url(),
        error:
          "The page is open but has no readable text — it may still be loading, or it renders inside a canvas. Take a screenshot to see what is there.",
        evidence,
        sessionView: view(session),
      };
    }
    const detail = await afterAction(session, tab, "read", { chars: clipped.length });
    const shotPath = detail.evidence.file ? path.join(detail.evidence.dir, detail.evidence.file) : null;
    return {
      ...detail,
      text: clipped,
      screenshotPath: shotPath,
      sessionView: view(session),
    };
  }

  if (action === "click" || action === "type" || action === "press") {
    const session = requireSession(body.session);
    const tab = requireTab(session, body.tab);
    const selector = String(body.selector ?? "").trim();
    if (!selector) throw new Error("A selector is required.");

    const label = `${selector} ${String(body.label ?? "")}`;
    const consequential = isConsequentialAction(label);
    if (consequential && body.confirm !== true) {
      return {
        ok: false,
        needsConfirmation: true,
        session: session.id,
        tab: tab.id,
        error:
          `"${selector}" looks consequential (submit/buy/post/delete/…). Nothing was done. ` +
          "Ask the user, then call again with confirm: true.",
        sessionView: view(session),
      };
    }

    if (action === "click") {
      await tab.page.click(selector, { timeout: NAV_TIMEOUT_MS });
    } else if (action === "type") {
      await tab.page.fill(selector, String(body.text ?? ""));
      if (body.submit === true) await tab.page.press(selector, "Enter");
    } else {
      await tab.page.press(selector, String(body.key ?? "Enter"));
    }
    await settle(tab);
    return {
      ...(await afterAction(session, tab, action, { selector, confirmed: body.confirm === true })),
      sessionView: view(session),
    };
  }

  if (action === "screenshot") {
    const session = requireSession(body.session);
    const tab = requireTab(session, body.tab);
    const result = await afterAction(session, tab, "screenshot", { fullPage: body.fullPage === true });
    const file = result.evidence.file ? path.join(result.evidence.dir, result.evidence.file) : null;
    return { ...result, screenshotPath: file, sessionView: view(session) };
  }

  if (action === "newTab") {
    const session = requireSession(body.session);
    if (session.order.length >= MAX_TABS) throw new Error(`A session holds at most ${MAX_TABS} tabs.`);
    const page = await session.context.newPage();
    const tabId = `tab-${session.order.length + 1}`;
    session.tabs.set(tabId, { id: tabId, page, lastUrl: "", lastTitle: "" });
    session.order.push(tabId);
    session.activeTab = tabId;
    const tab = session.tabs.get(tabId)!;
    if (body.url) {
      const url = normalizeUrl(body.url);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await settle(tab);
    }
    return { ...(await afterAction(session, tab, "newTab", {})), sessionView: view(session) };
  }

  if (action === "closeTab") {
    const session = requireSession(body.session);
    const tab = requireTab(session, body.tab);
    await tab.page.close().catch(() => undefined);
    session.tabs.delete(tab.id);
    session.order = session.order.filter((id) => id !== tab.id);
    if (session.order.length === 0) {
      await session.context.close().catch(() => undefined);
      sessions.delete(session.id);
      return { ok: true, closed: session.id, sessionView: null };
    }
    session.activeTab = session.order[session.order.length - 1];
    return { ok: true, closedTab: tab.id, sessionView: view(session) };
  }

  if (action === "close") {
    const session = requireSession(body.session);
    await session.context.close().catch(() => undefined);
    sessions.delete(session.id);
    return { ok: true, closed: session.id };
  }

  throw new Error(
    `Unknown browser session action "${action}". Use open, navigate, read, click, type, press, screenshot, newTab, closeTab, close or list.`,
  );
}

/* ----------------------------- endpoints ---------------------------- */

/** Who may drive a browser: a verified user, or loopback in development. */
async function authorized(req: ConnectLikeReq): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const identity = await verifyRequestIdentity(req);
  if (identity.ok) return { ok: true };
  const host = header(req, "host").toLowerCase();
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (loopback && process.env.LELU_BROWSER_ALLOW_LOOPBACK !== "0") return { ok: true };
  return {
    ok: false,
    status: identity.status === 503 ? 401 : identity.status,
    error:
      `Browser sessions need a signed-in user (${identity.reason}) ` +
      "Local loopback requests are accepted while LELU_BROWSER_ALLOW_LOOPBACK is not \"0\".",
  };
}

export function createBrowserSessionsApi(): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  return {
    attach(middlewares) {
      middlewares.use("/api/browser/session", (req, res, next) => {
        const method = (req.method ?? "GET").toUpperCase();
        const requestUrl = new URL(req.url ?? "", "http://localhost");

        // A captured screenshot is served back as evidence pixels only —
        // confined to the evidence root, and never a directory listing.
        if (method === "GET" && requestUrl.pathname.replace(/\/+$/, "").endsWith("/shot")) {
          void (async () => {
            const sessionId = safeQuery(requestUrl, "session");
            const file = safeQuery(requestUrl, "file");
            if (!sessionId || !file) {
              sendJson(res, { ok: false, error: "session and file are required." }, 400);
              return;
            }
            const target = path.join(EVIDENCE_ROOT, sessionId, file);
            const root = path.join(EVIDENCE_ROOT, sessionId);
            if (!target.startsWith(root + path.sep) || !existsSync(target)) {
              sendJson(res, { ok: false, error: "No such evidence file." }, 404);
              return;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "image/png");
            res.setHeader("Cache-Control", "no-store");
            res.end(readFileSync(target));
          })();
          return;
        }

        if (method !== "POST") {
          next();
          return;
        }
        if (isCrossOrigin(req)) {
          sendJson(res, { ok: false, error: "Cross-origin requests are refused." }, 403);
          return;
        }

        void (async () => {
          const gate = await authorized(req);
          if (!gate.ok) {
            sendJson(res, { ok: false, error: gate.error }, gate.status);
            return;
          }
          let body: Record<string, unknown>;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            sendJson(res, { ok: false, error: error instanceof Error ? error.message : "Bad request." }, 400);
            return;
          }
          try {
            const available = await browserSessionsAvailable();
            if (!available.ok) {
              sendJson(res, { ok: false, available: false, error: available.reason }, 503);
              return;
            }
            sendJson(res, await runSessionAction(body));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const clientError = /^(A |No |That |Only |There |Session |Unknown )/.test(message);
            sendJson(res, { ok: false, error: message }, clientError ? 400 : 500);
          }
        })();
      });
    },
  };
}

function safeQuery(url: URL, name: string): string {
  const raw = (url.searchParams.get(name) ?? "").replace(/[^A-Za-z0-9._-]/g, "");
  return raw.replace(/^\.+/, "");
}
