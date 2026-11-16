/**
 * Obtain a real Supabase session through the app's passwordless email flow.
 *
 * The harness opens the app in a Chromium context, requests the sign-in email,
 * and waits for the normal email link/code to establish a session. The session
 * is read from that context's localStorage into memory only. It is never
 * printed, written to an artifact, or persisted to a file.
 *
 * Run with a visible browser (LELU_M145_HEADFUL=1) when the email link must be
 * completed by the person. A headless run is useful only if an external
 * automation can complete the link in this context.
 */
import { chromium } from "playwright";

const AUTH_STORAGE_PREFIX = "sb-";

function parseStoredSession(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const session = parsed?.currentSession ?? parsed;
    if (!session?.access_token || !session?.refresh_token) return null;
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
    };
  } catch {
    return null;
  }
}

export async function acquireEmailSession({
  appUrl,
  email,
  timeoutMs = 10 * 60 * 1000,
  headless = process.env.LELU_M145_HEADFUL !== "1",
} = {}) {
  if (!appUrl) throw new Error("LELU_M145_APP_URL is required to complete email sign-in.");
  if (!email) throw new Error("LELU_M145_EMAIL is required to request email sign-in.");

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const gate = page.locator("[data-lelu-auth-email]");
    await gate.waitFor({ state: "visible", timeout: 45_000 });
    await gate.fill(email);
    await page.locator("[data-lelu-auth-submit]").click();

    const notice = page.locator("text=Check your email");
    await notice.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const stored = await page.evaluate((prefix) => {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (key && key.startsWith(prefix) && key.endsWith("-auth-token")) {
            return localStorage.getItem(key);
          }
        }
        return null;
      }, AUTH_STORAGE_PREFIX);
      const session = parseStoredSession(stored);
      if (session) return { session, page, context, browser };
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(
      "email sign-in was not completed in the harness browser before the timeout; " +
        "run with LELU_M145_HEADFUL=1 and open the sign-in link in that browser",
    );
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function closeEmailSession(handle) {
  await handle?.browser?.close().catch(() => {});
}
