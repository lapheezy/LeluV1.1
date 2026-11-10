/**
 * Verify the live browser session runtime with a real browser.
 *
 * This is not a mocked test: it starts scopes/browserSessionsApi's real
 * Chromium, opens a real page, reads it, follows a real link, screenshots
 * each step, and checks that every claim matches what the browser returned
 * — including that a consequential click is REFUSED without confirmation.
 *
 * Run:
 *   bun run scripts/verify-browser-sessions.ts
 *
 * If Chromium's system libraries live in a local prefix (this container
 * has no root), point LD_LIBRARY_PATH at them first, as the runtime itself
 * documents:
 *   LD_LIBRARY_PATH="$PWD/.pw-libs/root/usr/lib/x86_64-linux-gnu" \
 *     bun run scripts/verify-browser-sessions.ts
 *
 * Exit code 0 means every check passed. A missing browser fails loudly with
 * the server's own reason — it never prints a success it did not observe.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  browserSessionsAvailable,
  closeAllBrowserSessions,
  runSessionAction,
} from "../plugins/browserSessionsApi.ts";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

/** Run an action; a throw becomes a reported failure instead of a crash. */
async function action(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    return await runSessionAction(body);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

async function main(): Promise<void> {
  const availability = await browserSessionsAvailable();
  if (!availability.ok) {
    console.error(`FAIL  no browser available — ${availability.reason}`);
    process.exit(1);
  }
  check("a real browser is running", true, availability.reason);

  const opened = await action({ action: "open", name: "verify", url: "https://example.com" });
  const session = String(opened.session ?? "");
  check("open navigated to the page", opened.ok === true && String(opened.url).includes("example.com"), `url=${opened.url} title=${opened.title}`);
  check("the browser reported the page's own title", String(opened.title).includes("Example Domain"), `title=${opened.title}`);

  const openEvidence = opened.evidence as { dir: string; step: number; file?: string } | undefined;
  const openFile = openEvidence?.file ? path.join(openEvidence.dir, openEvidence.file) : "";
  check("open wrote a screenshot", Boolean(openFile) && existsSync(openFile) && statSync(openFile).size > 1000, `${openFile} (${openFile ? statSync(openFile).size : 0} bytes)`);

  const read = await action({ action: "read", session });
  const readText = String(read.text ?? "");
  check("read returns the page's real text", read.ok === true && readText.length > 20, `${readText.length} chars, starts “${readText.split("\n")[0].slice(0, 60)}”`);
  check("read text mentions the page's subject", /example domain/i.test(readText), readText.slice(0, 80));

  // A consequential action must be refused before anything happens.
  const refused = await action({
    action: "click",
    session,
    selector: "a",
    label: "Buy now",
  });
  check(
    "a consequential click is refused without confirmation",
    refused.ok === false && refused.needsConfirmation === true,
    String(refused.error ?? "").slice(0, 90),
  );

  // A real click on a real link: example.com's "More information..." → IANA.
  const clicked = await action({
    action: "click",
    session,
    selector: "a",
    label: "More information",
  });
  const clickedUrl = String(clicked.url ?? "");
  check("clicking a link really navigated", clicked.ok === true && /iana\.org/.test(clickedUrl), `url=${clickedUrl}`);

  const afterClick = await action({ action: "read", session });
  check("the second page is readable too", afterClick.ok === true && String(afterClick.text ?? "").length > 20, `${String(afterClick.text ?? "").length} chars`);

  const shot = await action({ action: "screenshot", session });
  const shotEvidence = shot.evidence as { dir: string; step: number; file?: string } | undefined;
  const shotFile = shotEvidence?.file ? path.join(shotEvidence.dir, shotEvidence.file) : "";
  check("screenshot bytes were written", Boolean(shotFile) && existsSync(shotFile) && statSync(shotFile).size > 1000, `${shotFile} (${shotFile ? statSync(shotFile).size : 0} bytes)`);

  const listed = await action({ action: "list" });
  const sessions = (listed.sessions ?? []) as Array<{ id: string; steps: number; tabs: unknown[] }>;
  const mine = sessions.find((entry) => entry.id === session);
  check("the session is listed with its tabs and steps", Boolean(mine) && (mine?.steps ?? 0) >= 4, JSON.stringify(mine ?? null));

  const second = await action({ action: "newTab", session, url: "https://www.iana.org/help/example-domains" });
  check("a second tab opens independently", second.ok === true && String(second.url).includes("iana.org"), `url=${second.url}`);

  const closed = await action({ action: "close", session });
  const afterClose = await action({ action: "list" });
  check("close destroys the session", closed.ok === true && ((afterClose.sessions ?? []) as unknown[]).length === 0, "no sessions remain");

  const manifest = openEvidence ? path.join(openEvidence.dir, "manifest.jsonl") : "";
  check("an evidence manifest was written", Boolean(manifest) && existsSync(manifest), manifest);
  if (existsSync(manifest)) {
    console.log("\n--- manifest ---");
    console.log(await (await import("node:fs/promises")).readFile(manifest, "utf8"));
  }

  await closeAllBrowserSessions();

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.map((entry) => entry.name).join("; ")}`);
    process.exit(1);
  }
}

await main();
