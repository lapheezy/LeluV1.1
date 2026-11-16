/**
 * Mission 14.3 — production-build local/offline browser acceptance.
 *
 * Serves are expected at http://127.0.0.1:4173.
 * Every request to a host other than localhost/127.0.0.1 is aborted.
 * The test then performs real UI operations, reloads, and finally isolates
 * the page from all networking while it reads local state.
 *
 * Evidence classes: BROWSER, NETWORK, LIVE (deterministic local path).
 * This is not a model-driven reasoning test.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4173/";
const APP_ORIGIN = new URL(BASE).hostname;
const result = {
  mission: "M14.3",
  base: "4582382",
  startedAt: new Date().toISOString(),
  evidenceClass: ["BROWSER", "NETWORK", "LIVE"],
  blockedExternal: [],
  consoleErrors: [],
  phases: {},
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") result.consoleErrors.push(msg.text().slice(0, 500));
});
page.on("pageerror", (err) => result.consoleErrors.push(`pageerror: ${err.message}`));

await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === APP_ORIGIN || url.hostname === "localhost") return route.continue();
  result.blockedExternal.push(url.href);
  return route.abort();
});

const readStorage = () =>
  page.evaluate(() => {
    const read = (key) => {
      try {
        return JSON.parse(localStorage.getItem(key) || "null");
      } catch {
        return null;
      }
    };
    return {
      projects: read("lelu.projects.v1"),
      chats: read("lelu.multichat.workspace.v1"),
      knowledge: read("lelu.lelu.cognition.knowledge.v1"),
    };
  });

const lastAssistant = async () => {
  const texts = await page.locator('[data-role="assistant"]').evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent || "").trim()).filter(Boolean),
  );
  return texts.length ? texts[texts.length - 1].slice(0, 1200) : null;
};

try {
  const bootStart = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForSelector('button[aria-label*="Cloud sync"]', { timeout: 20_000 });
  const bootReadyMs = Date.now() - bootStart;
  await page.waitForTimeout(8_000);
  result.phases.boot = {
    title: await page.title(),
    readyMs: bootReadyMs,
    ms: Date.now() - bootStart,
    controls: await page.getByRole("button").count(),
    cloudLabel: await page
      .getByRole("button", { name: /Cloud sync/i })
      .first()
      .getAttribute("title")
      .catch(() => null),
  };

  await page.getByRole("button", { name: "Chat" }).first().click();
  await page.waitForTimeout(2_000);
  await page.locator("textarea").first().fill("Start a project to map the offline acceptance path.");
  await page.getByRole("button", { name: /Send to/ }).first().click();
  await page.waitForTimeout(25_000);
  const projectReply = await lastAssistant();
  const afterProject = await readStorage();
  const project = (afterProject.projects || []).find((entry) =>
    /offline acceptance path/i.test(`${entry.name} ${entry.description ?? ""}`),
  );
  result.phases.projectTurn = {
    reply: projectReply,
    projectFound: Boolean(project),
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    knowledgeNodes: afterProject.knowledge?.nodes?.length ?? 0,
    knowledgeEdges: afterProject.knowledge?.edges?.length ?? 0,
    knowledgeRevision: afterProject.knowledge?.revision ?? null,
    knowledgeProvenance: afterProject.knowledge?.provenance ?? null,
  };

  const reloadStart = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForSelector('button[aria-label*="Cloud sync"]', { timeout: 20_000 });
  const reloadReadyMs = Date.now() - reloadStart;
  await page.waitForTimeout(8_000);
  const afterReload = await readStorage();
  result.phases.reload = {
    readyMs: reloadReadyMs,
    ms: Date.now() - reloadStart,
    projectStillPresent: Boolean(
      (afterReload.projects || []).find((entry) => entry.id === project?.id),
    ),
    chatStillPresent: Boolean(
      (afterReload.chats?.conversations || []).find((entry) =>
        (entry.messages || []).some((message) => /offline acceptance path/i.test(message.text ?? "")),
      ),
    ),
    knowledgeRevision: afterReload.knowledge?.revision ?? null,
  };

  if ((await page.locator("textarea").count()) === 0) {
    await page.getByRole("button", { name: "Chat" }).first().click({ force: true });
    await page.waitForTimeout(1_500);
  }
  await context.setOffline(true);
  const offlineBeforeTurn = await page.evaluate(() => ({
    online: navigator.onLine,
    projectKeys: Object.keys(localStorage).filter((key) => /project|chat|knowledge|user/i.test(key)),
  }));
  await page.locator("textarea").first().fill("Who are you?");
  await page.getByRole("button", { name: /Send to/ }).first().click({ force: true });
  await page.waitForTimeout(10_000);
  const offlineReply = await lastAssistant();
  const offlineStorage = await readStorage();
  result.phases.offline = {
    online: offlineBeforeTurn.online,
    projectKeys: offlineBeforeTurn.projectKeys,
    reply: offlineReply,
    projectStillPresent: Boolean(
      (offlineStorage.projects || []).find((entry) => entry.id === project?.id),
    ),
    chatCount: offlineStorage.chats?.conversations?.length ?? 0,
  };
  await page.screenshot({ path: "artifacts/m143-offline.png", fullPage: false });
  await context.setOffline(false);

  result.phases.network = {
    blockedExternalCount: result.blockedExternal.length,
    blockedExternalHosts: [...new Set(result.blockedExternal.map((url) => new URL(url).host))],
    supabaseAttempts: result.blockedExternal.filter((url) => /supabase/i.test(url)),
  };
  result.finishedAt = new Date().toISOString();
  result.status = result.phases.offline.projectStillPresent && result.phases.reload.projectStillPresent ? "PASS" : "FAIL";
} catch (error) {
  result.status = "ERROR";
  result.error = error instanceof Error ? error.stack : String(error);
} finally {
  fs.writeFileSync("artifacts/m143-offline.json", JSON.stringify(result, null, 2));
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
