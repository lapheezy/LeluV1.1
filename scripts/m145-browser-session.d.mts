export interface BrowserSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

export interface EmailSessionHandle {
  session: BrowserSession;
  page: import("playwright").Page;
  context: import("playwright").BrowserContext;
  browser: import("playwright").Browser;
}

export function acquireEmailSession(options: {
  appUrl?: string;
  email?: string;
  timeoutMs?: number;
  headless?: boolean;
}): Promise<EmailSessionHandle>;

export function closeEmailSession(handle: EmailSessionHandle | null): Promise<void>;
