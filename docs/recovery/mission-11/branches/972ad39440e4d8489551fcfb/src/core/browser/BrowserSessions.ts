/**
 * ==========================================================
 * LÉLU
 * BROWSER SESSIONS — client
 *
 * The client half of plugins/browserSessionsApi.ts. Every call here is
 * a real action in a real Chromium session on the server; nothing is
 * inferred locally. When the server has no browser it answers 503 with
 * the reason, and that reason is what the caller sees — this layer never
 * invents a page.
 *
 * The route, token and base URL come from EngineeringWorkspace, which
 * already owns the runtime source; there is no second transport.
 * ==========================================================
 */

import EngineeringWorkspace from "../engineering/EngineeringWorkspace";

export interface BrowserTabView {
  id: string;
  url: string;
  title: string;
}

export interface BrowserSessionView {
  id: string;
  name: string;
  private: boolean;
  viewport: string;
  steps: number;
  createdAt: number;
  lastUsed: number;
  activeTab: string;
  evidenceDir: string;
  tabs: BrowserTabView[];
}

export interface BrowserEvidence {
  dir: string;
  step: number;
  file?: string;
}

export interface BrowserStepResult {
  ok: boolean;
  available?: boolean;
  error?: string;
  needsConfirmation?: boolean;
  session?: string;
  tab?: string;
  url?: string;
  title?: string;
  text?: string;
  evidence?: BrowserEvidence;
  screenshotPath?: string | null;
  sessionView?: BrowserSessionView | null;
  sessions?: BrowserSessionView[];
}

export type BrowserAction =
  | "open"
  | "navigate"
  | "read"
  | "click"
  | "type"
  | "press"
  | "screenshot"
  | "newTab"
  | "closeTab"
  | "close"
  | "list";

export default class BrowserSessions {
  private static instance: BrowserSessions | null = null;

  static getInstance(): BrowserSessions {
    if (!BrowserSessions.instance) BrowserSessions.instance = new BrowserSessions();
    return BrowserSessions.instance;
  }

  private async call(body: Record<string, unknown>): Promise<BrowserStepResult> {
    const data = await EngineeringWorkspace.getInstance().callRuntime("/api/browser/session", body);
    return data as unknown as BrowserStepResult;
  }

  /** Start a named session (its own browser context) and optionally open a page. */
  open(options: { name?: string; url?: string; private?: boolean; viewport?: "phone" | "desktop" }): Promise<BrowserStepResult> {
    return this.call({ action: "open", ...options });
  }

  navigate(session: string, url: string, tab?: string): Promise<BrowserStepResult> {
    return this.call({ action: "navigate", session, url, tab });
  }

  read(session: string, tab?: string): Promise<BrowserStepResult> {
    return this.call({ action: "read", session, tab });
  }

  /**
   * Click an element. Consequential targets need `confirm` — the server
   * refuses them otherwise and returns needsConfirmation, so the decision
   * stays with the user rather than with this call.
   */
  click(session: string, selector: string, options: { label?: string; confirm?: boolean; tab?: string } = {}): Promise<BrowserStepResult> {
    return this.call({ action: "click", session, selector, ...options });
  }

  type(session: string, selector: string, text: string, options: { submit?: boolean; tab?: string } = {}): Promise<BrowserStepResult> {
    return this.call({ action: "type", session, selector, text, ...options });
  }

  press(session: string, selector: string, key: string): Promise<BrowserStepResult> {
    return this.call({ action: "press", session, selector, key });
  }

  screenshot(session: string, tab?: string): Promise<BrowserStepResult> {
    return this.call({ action: "screenshot", session, tab });
  }

  newTab(session: string, url?: string): Promise<BrowserStepResult> {
    return this.call({ action: "newTab", session, url });
  }

  closeTab(session: string, tab: string): Promise<BrowserStepResult> {
    return this.call({ action: "closeTab", session, tab });
  }

  /** Destroy the context. A private session leaves nothing behind but its evidence. */
  close(session: string): Promise<BrowserStepResult> {
    return this.call({ action: "close", session });
  }

  list(): Promise<BrowserStepResult> {
    return this.call({ action: "list" });
  }

  /** The captured pixels, served by the same route that wrote them. */
  static shotUrl(sessionId: string, file: string): string {
    return `/api/browser/session/shot?session=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(file)}`;
  }
}
