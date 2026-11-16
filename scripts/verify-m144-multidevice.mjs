/**
 * Mission 14.4 — two independent browser contexts, one local fixture cloud.
 *
 * This is NOT Supabase and NOT two physical devices. Each Chromium context
 * has its own localStorage and its own module instances; both talk to a
 * small conditional-write fixture server on 127.0.0.1:3101.
 *
 * Evidence: BROWSER, MULTI_CONTEXT_SIMULATION, SIMULATED_BACKEND.
 */
import fs from "node:fs";
import http from "node:http";
import { chromium } from "playwright";

const APP = "http://127.0.0.1:3000/";
const PORT = 3101;
const result = {
  mission: "M14.4",
  evidenceClass: ["BROWSER", "MULTI_CONTEXT_SIMULATION", "SIMULATED_BACKEND"],
  realDevices: false,
  realCloud: false,
  startedAt: new Date().toISOString(),
  contexts: {},
  conflict: null,
  status: "ERROR",
  consoleErrors: [],
  requests: [],
};

const cloud = new Map();
const acknowledged = new Map();
let revision = 0;

function bucket(authority) {
  let value = cloud.get(authority);
  if (!value) {
    value = new Map();
    cloud.set(authority, value);
  }
  return value;
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/pull")) {
    const authority = new URL(req.url, `http://127.0.0.1:${PORT}`).searchParams.get("authority");
    const records = [...bucket(authority).values()].map((stored) => ({
      ...stored.record,
      cloudRevision: stored.cloudRevision,
    }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ records }));
    return;
  }
  if (req.method === "POST" && req.url === "/push") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const operation = JSON.parse(body);
      result.requests.push({
        context: operation.context ?? null,
        authority: operation.authority,
        recordId: operation.recordId,
        localRevision: operation.localRevision,
        expectedCloudRevision: operation.expectedCloudRevision,
        idempotencyKey: operation.idempotencyKey,
      });
      const already = acknowledged.get(operation.idempotencyKey);
      const records = bucket(operation.authority);
      if (already) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "applied", cloudRevision: already }));
        return;
      }
      const existing = records.get(operation.recordId);
      if (operation.expectedCloudRevision === null && existing) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "conflict", cloudRevision: existing.cloudRevision, remote: existing.record, reason: "fixture: record exists" }));
        return;
      }
      if (operation.expectedCloudRevision !== null && existing?.cloudRevision !== operation.expectedCloudRevision) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "conflict", cloudRevision: existing?.cloudRevision ?? null, remote: existing?.record ?? null, reason: "fixture: stale revision" }));
        return;
      }
      const cloudRevision = `fixture-${++revision}`;
      records.set(operation.recordId, { record: operation.payload, cloudRevision });
      acknowledged.set(operation.idempotencyKey, cloudRevision);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "applied", cloudRevision }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const browser = await chromium.launch({ headless: true });

async function makeContext(label) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") result.consoleErrors.push(`${label}: ${message.text().slice(0, 300)}`);
  });
  page.on("pageerror", (error) => result.consoleErrors.push(`${label}: pageerror ${error.message}`));
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(3_000);
  await page.evaluate(async ({ label, port }) => {
    const [engineMod, storeMod, projectMod] = await Promise.all([
      import("/src/core/sync/ContinuityEngine.ts"),
      import("/src/core/sync/ContinuityStore.ts"),
      import("/src/core/projects/ProjectStore.ts"),
    ]);
    const Engine = engineMod.default;
    const Store = storeMod.default;
    Engine.resetForTests();
    Store.reset();
    class FixtureTransport {
      kind = "simulated";
      availability() {
        return window.__m144Offline ? "cloud_unavailable" : "ready";
      }
      async push(operation) {
        const response = await fetch(`http://127.0.0.1:${port}/push`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...operation, context: label }),
        });
        return response.json();
      }
      async pull(authority) {
        const response = await fetch(`http://127.0.0.1:${port}/pull?authority=${encodeURIComponent(authority)}`);
        return response.json();
      }
    }
    const engine = Engine.getInstance();
    engine.start({ transport: new FixtureTransport(), autoProcess: false });
    window.__m144 = { engine, Engine, Store, ProjectStore: projectMod.default, label, newTransport: () => new FixtureTransport() };
  }, { label, port: PORT });
  return { context, page };
}

try {
  const a = await makeContext("device-a");
  const b = await makeContext("device-b");
  result.contexts.a = await a.page.evaluate(() => ({ label: window.__m144.label, localKeys: Object.keys(localStorage).filter((key) => key.startsWith("lelu.")).length }));
  result.contexts.b = await b.page.evaluate(() => ({ label: window.__m144.label, localKeys: Object.keys(localStorage).filter((key) => key.startsWith("lelu.")).length }));

  const drain = async (page) => page.evaluate(async () => {
    const engine = window.__m144.engine;
    engine.setTransport(window.__m144.newTransport());
    // Always pull once, even when this context has no pending uploads.
    await engine.synchronize();
    for (let index = 0; index < 40 && engine.pending().length > 0; index += 1) {
      const before = engine.pending().length;
      await engine.synchronize();
      if (engine.pending().length >= before) break;
    }
  });
  await drain(a.page);
  await drain(b.page);
  result.contexts.bDiagnostics = await b.page.evaluate(async () => {
    const engine = window.__m144.engine;
    engine.setTransport(window.__m144.newTransport());
    const before = { pending: engine.pending().length, status: engine.status() };
    const processed = await engine.processOutbox();
    return { before, after: { pending: engine.pending().length, status: processed }, availability: engine.evidence().status.lastError };
  });

  const created = await a.page.evaluate(async () => {
    const project = window.__m144.ProjectStore.getInstance().create({ name: "M144 two-context project" });
    return { id: project.id, name: project.name };
  });
  // Wait until the fixture cloud actually holds the project before asking the
  // second context to pull it; otherwise this becomes a timing test.
  for (let attempt = 0; attempt < 25 && !bucket("projects").has(created.id); attempt += 1) {
    await drain(a.page);
    await a.page.waitForTimeout(100);
  }
  result.contexts.a.projectReachedCloud = bucket("projects").has(created.id);
  await drain(b.page);
  const seenByB = await b.page.evaluate((id) => {
    const project = window.__m144.ProjectStore.getInstance().get(id);
    return project ? { id: project.id, name: project.name } : null;
  }, created.id);

  await a.page.evaluate(async ({ id }) => {
    window.__m144.engine.setTransport(window.__m144.newTransport());
    window.__m144Offline = true;
    window.__m144.ProjectStore.getInstance().update(id, { name: "Device A edit" });
    await window.__m144.engine.synchronize();
  }, { id: created.id });
  await b.page.evaluate(async ({ id }) => {
    window.__m144.engine.setTransport(window.__m144.newTransport());
    window.__m144Offline = true;
    window.__m144.ProjectStore.getInstance().update(id, { name: "Device B edit" });
    await window.__m144.engine.synchronize();
  }, { id: created.id });
  result.contexts.offlinePending = {
    a: await a.page.evaluate(() => window.__m144.engine.pending().length),
    b: await b.page.evaluate(() => window.__m144.engine.pending().length),
  };

  await a.page.evaluate(async () => {
    window.__m144.engine.setTransport(window.__m144.newTransport());
    window.__m144Offline = false;
    await window.__m144.engine.synchronize();
  });
  const bReconnect = await b.page.evaluate(async ({ id }) => {
    window.__m144.engine.setTransport(window.__m144.newTransport());
    window.__m144Offline = false;
    await window.__m144.engine.synchronize();
    const conflicts = window.__m144.engine.conflicts();
    const conflict = conflicts.find((item) => item.recordId === id) ?? null;
    return {
      conflicts: conflicts.length,
      conflict: conflict ? {
        id: conflict.id,
        local: conflict.local?.data?.name ?? null,
        cloud: conflict.cloud?.data?.name ?? null,
        localRevision: conflict.localRevision,
        cloudRevision: conflict.cloudRevision,
      } : null,
      localName: window.__m144.ProjectStore.getInstance().get(id)?.name ?? null,
    };
  }, { id: created.id });

  let resolution = null;
  if (bReconnect.conflict) {
    resolution = await b.page.evaluate(async ({ conflictId }) => {
      const engine = window.__m144.engine;
      const resolved = engine.resolveConflict(engine.conflicts(true), conflictId, "keep_cloud");
      if (resolved.ok) await engine.processOutbox();
      return resolved;
    }, { conflictId: bReconnect.conflict.id });
  }
  const bAfter = await b.page.evaluate((id) => window.__m144.ProjectStore.getInstance().get(id)?.name ?? null, created.id);

  result.contexts.a = { ...result.contexts.a, created, name: await a.page.evaluate((id) => window.__m144.ProjectStore.getInstance().get(id)?.name ?? null, created.id) };
  result.contexts.b = { ...result.contexts.b, seenByB, reconnect: bReconnect, resolution, nameAfter: bAfter };
  result.conflict = bReconnect.conflict;
  result.status = Boolean(seenByB) && bReconnect.conflicts > 0 && Boolean(bReconnect.conflict) && bAfter === "Device A edit"
    ? "PASS"
    : "FAIL";
  result.note = "Two independent Chromium contexts, each with its own localStorage and continuity metadata, against a local conditional-write fixture. Not physical devices, not Supabase.";
  result.finishedAt = new Date().toISOString();

  fs.writeFileSync("artifacts/m144/multidevice-acceptance.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.status = "ERROR";
  result.error = error instanceof Error ? error.stack : String(error);
  fs.writeFileSync("artifacts/m144/multidevice-acceptance.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (result.status !== "PASS") process.exitCode = 1;
