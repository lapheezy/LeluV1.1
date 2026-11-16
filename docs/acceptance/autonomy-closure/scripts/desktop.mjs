/**
 * LÉLU — consolidated acceptance, phase 1 (desktop, real pointer).
 *
 * Drives the PRODUCTION app on the real runtime:
 *   boot → compose through EnvironmentOrchestrationEngine (real engine path,
 *   no model turn) → surfaces mount in the System environment → real mouse
 *   press selects one → in-place mutation -> revision advances and the DOM
 *   agrees -> save snapshot -> page reload (fresh runtime) -> restore from
 *   KvStore -> the same ids/revisions are on screen again.
 *
 * The engine calls stand in ONLY for the model's tool calls. Nothing about
 * rendering, selection, persistence or revision is stubbed: the same
 * WorkspaceEngine/VisualEngine/GenesisScene code that runs for a model turn
 * runs here.
 *
 * Output: docs/acceptance/autonomy-closure/desktop.json (+ screenshots).
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "docs/acceptance/autonomy-closure";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:4321/";
mkdirSync(`${OUT}/shots`, { recursive: true });

const result = { startedAt: new Date().toISOString(), steps: [], views: [], selection: {}, mutation: {}, restore: {}, errors: [] };
const save = () => writeFileSync(`${OUT}/desktop.json`, JSON.stringify(result, null, 2));
const step = (name, data = {}) => {
  result.steps.push({ name, at: new Date().toISOString(), ...data });
  save();
  console.log("STEP", name, JSON.stringify(data).slice(0, 300));
};

const browser = await chromium.launchPersistentContext("/tmp/closure-desktop", {
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => result.errors.push(String(error).slice(0, 400)));
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  step("navigated");

  // Sign-in gate: the guest button is the LAST button in the dialog. Its label
  // is "Continue without an account" when identity is configured and plain
  // "Continue" when it is not — so matching the long label left the gate up on
  // an unconfigured deployment, and its transparent backdrop (z 600) swallowed
  // every press on the workspace. That, not the selection wiring, is what the
  // Mission 3.4 pointer test and the first runs here actually measured.
  const gate = page.locator("[data-lelu-signin-gate]");
  if (await gate.count()) {
    await gate.locator("button").last().click({ timeout: 15_000 }).catch(() => {});
    await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 25_000 }).catch(() => {});
    result.gateDismissed = (await page.locator("[data-lelu-signin-gate]").count()) === 0;
    step("gate", { present: !result.gateDismissed });
  }
  await page.waitForTimeout(3000);
  step("past-signin", { url: page.url() });

  const composed = await page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
    const visual = (await import("/src/core/visual/VisualEngine.ts")).default.getInstance();
    ws.clear();
    visual.setInterfaceFocus("genesis");
    const res = await env.composeEnvironment({
      title: "Acceptance workspace",
      category: "research",
      surfaces: [
        { kind: "file", title: "Findings", text: "Evidence collected across three sources." },
        { kind: "file", title: "Source table", text: "source | finding\nA | supports\nB | qualifies" },
        { kind: "file", title: "Open questions", text: "Which claim is load-bearing?" },
      ],
    });
    return {
      ids: res.createdViews.map((view) => ({ id: view.id, revision: view.revision, title: view.title })),
      focus: visual.getState().interfaceFocus,
      views: ws.getState().views.length,
    };
  });
  result.views = composed.ids;
  step("composed", composed);

  // The one presentation path must have pulled the System environment up.
  await page.waitForSelector('[data-workspace="lelu-system"]', { timeout: 60_000 }).catch(() => {});
  await page.waitForSelector("[data-workspace-view]", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const mounted = await page.evaluate(() => {
    const host = document.querySelector('[data-workspace="lelu-system"]');
    const nodes = Array.from(document.querySelectorAll("[data-workspace-view]"));
    return {
      hostPresent: Boolean(host),
      count: nodes.length,
      focus: document.querySelector("[data-workspace]")?.getAttribute("data-workspace") ?? null,
      cards: nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const cx = Math.round(rect.left + rect.width / 2);
        const cy = Math.round(rect.top + rect.height / 2);
        const top = document.elementFromPoint(cx, cy);
        return {
          id: node.getAttribute("data-workspace-view"),
          revision: node.getAttribute("data-revision"),
          selected: node.getAttribute("data-selected"),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          visible: Boolean(node.offsetParent) || rect.width > 0,
          center: { x: cx, y: cy },
          topElement: top ? `${top.tagName.toLowerCase()}${top.getAttribute("data-workspace-view") ? `[view=${top.getAttribute("data-workspace-view")}]` : ""}` : null,
        };
      }),
    };
  });
  result.mounted = mounted;
  step("mounted", { hostPresent: mounted.hostPresent, count: mounted.count });
  await page.screenshot({ path: `${OUT}/shots/desktop-mounted.png` });

  // A press can only land where the surface actually IS. Layout ticks
  // (a provider/memory refresh re-focusing a view) move cards with a 0.3 s
  // transition; pressing a coordinate measured mid-move hit the field
  // behind it and selected nothing. Wait for the geometry to settle twice
  // in a row, then re-read the target, exactly as a person pressing what
  // they see would.
  async function settledCards(timeoutMs = 9000) {
    const started = Date.now();
    let previous = null;
    while (Date.now() - started < timeoutMs) {
      const now = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-workspace-view]")).map((node) => {
          const rect = node.getBoundingClientRect();
          return [node.getAttribute("data-workspace-view"), Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
        }),
      );
      if (previous && JSON.stringify(previous) === JSON.stringify(now)) return now;
      previous = now;
      await page.waitForTimeout(200);
    }
    return previous;
  }
  result.settled = await settledCards();
  const fresh = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-workspace-view]")).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.getAttribute("data-workspace-view"),
        revision: node.getAttribute("data-revision"),
        selected: node.getAttribute("data-selected"),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        center: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
        topElement: (() => { const top = document.elementFromPoint(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)); return top ? `${top.tagName.toLowerCase()}${top.closest("[data-workspace-view]") ? "[in-card]" : "[not-card]"}` : null; })(),
      };
    }),
  );
  result.settledCards = fresh;
  step("settled", { cards: fresh.map((card) => [card.id, card.rect.x, card.rect.y, card.topElement]) });

  // Press only where the surface is genuinely the top element at its own
  // centre. Right after a compose the field fades in and the home surface can
  // still be the topmost node for a moment; a person presses what is exposed,
  // so the harness waits for exposure rather than pressing a card mid-fade.
  async function waitHittable(id, timeoutMs = 12_000) {
    const started = Date.now();
    let last = null;
    let escaped = false;
    while (Date.now() - started < timeoutMs) {
      last = await page.evaluate((viewId) => {
        const node = document.querySelector(`[data-workspace-view="${viewId}"]`);
        if (!node) return { ok: false, reason: "missing" };
        const rect = node.getBoundingClientRect();
        const x = Math.round(rect.x + rect.width / 2);
        const y = Math.round(rect.y + rect.height / 2);
        const top = document.elementFromPoint(x, y);
        return {
          ok: Boolean(top?.closest(`[data-workspace-view="${viewId}"]`)),
          x, y,
          top: top ? `${top.tagName.toLowerCase()}${top.closest("[data-workspace-view]") ? "[in-card]" : "[not-card]"}` : null,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      }, id);
      if (last.ok) return last;
      if (!escaped) {
        // Record WHAT is on top before touching anything, then let the app
        // dismiss its own sheet the way a person does: Escape.
        result.blockedBy = await page.evaluate(({ viewId, x, y }) => {
          const describe = (el) => {
            const style = getComputedStyle(el);
            const data = {};
            for (const attr of Array.from(el.attributes)) {
              if (attr.name.startsWith("data-") || attr.name === "class" || attr.name === "role") data[attr.name] = attr.value.slice(0, 80);
            }
            return { tag: el.tagName.toLowerCase(), data, position: style.position, zIndex: style.zIndex, pointerEvents: style.pointerEvents, inCard: Boolean(el.closest(`[data-workspace-view="${viewId}"]`)) };
          };
          return { point: { x, y }, stack: document.elementsFromPoint(x, y).slice(0, 5).map(describe) };
        }, { viewId: id, x: last.x, y: last.y });
        escaped = true;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        continue;
      }
      await page.waitForTimeout(250);
    }
    return last;
  }

  // Real pointer press on the biggest (focused) surface, from settled geometry.
  const target = [...fresh].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
  const hittable = target ? await waitHittable(target.id) : null;
  result.hittable = hittable;
  step("hittable", { id: target?.id, ok: hittable?.ok, top: hittable?.top });
  if (target && hittable?.ok) {
    await page.mouse.move(hittable.x, hittable.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(700);
    const after = await page.evaluate(async (id) => {
      const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
      const node = document.querySelector(`[data-workspace-view="${id}"]`);
      return {
        engineSelected: ws.getState().selectedId,
        domSelected: node?.getAttribute("data-selected") ?? null,
        allSelected: Array.from(document.querySelectorAll("[data-workspace-view]")).map((n) => ({
          id: n.getAttribute("data-workspace-view"),
          selected: n.getAttribute("data-selected"),
        })),
      };
    }, target.id);
    result.selection = { target: target.id, point: { x: hittable.x, y: hittable.y }, topElement: hittable.top, ...after };
    step("select", { target: target.id, top: target.topElement, selected: after.engineSelected, dom: after.domSelected });
    await page.screenshot({ path: `${OUT}/shots/desktop-selected.png` });

    // Selecting a DIFFERENT surface must move the selection.
    const other = fresh.find((card) => card.id !== target.id);
    const otherPoint = other ? await waitHittable(other.id, 5000) : null;
    if (other && otherPoint?.ok) {
      await page.mouse.move(otherPoint.x, otherPoint.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(600);
      result.selection.second = await page.evaluate(async (id) => {
        const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
        return { engineSelected: ws.getState().selectedId, expected: id, dom: document.querySelector(`[data-workspace-view="${id}"]`)?.getAttribute("data-selected") };
      }, other.id);
      step("select-second", { id: other.id, ...result.selection.second });
      // Leave the first surface selected for the mutation step.
      await page.mouse.move(target.center.x, target.center.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(400);
    }

    // In-place mutation through the engine: revision advances, DOM agrees.
    const mutation = await page.evaluate(async (id) => {
      const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
      const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
      const before = ws.getState().views.find((view) => view.id === id)?.revision;
      env.mutateSurface(id, { text: "Evidence collected and revised: claim A is load-bearing." });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const node = document.querySelector(`[data-workspace-view="${id}"]`);
      return {
        before,
        engineAfter: ws.getState().views.find((view) => view.id === id)?.revision,
        domAfter: node?.getAttribute("data-revision"),
        idPreserved: Boolean(node),
        textShown: node?.textContent?.includes("load-bearing") ?? false,
      };
    }, target.id);
    result.mutation = mutation;
    step("mutate", mutation);

    // Save, then a genuinely fresh runtime: reload the whole document.
    const saved = await page.evaluate(async () => {
      const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
      const snapshot = env.saveSnapshot({ name: "acceptance-desktop", category: "research" });
      return {
        id: snapshot.id,
        views: snapshot.workspaceSnapshot.views.map((view) => ({ id: view.id, revision: view.revision })),
      };
    });
    result.save = saved;
    step("saved", { id: saved.id, views: saved.views.length });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(4000);
    const gate2 = page.locator("[data-lelu-signin-gate]");
    if (await gate2.count()) {
      await gate2.locator("button").last().click({ timeout: 10_000 }).catch(() => {});
      await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 20_000 }).catch(() => {});
    }
    const beforeRestore = await page.evaluate(() => document.querySelectorAll("[data-workspace-view]").length);
    step("fresh-boot", { surfaceNodesBeforeRestore: beforeRestore });

    const restored = await page.evaluate(async (snapshotId) => {
      const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
      const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
      const visual = (await import("/src/core/visual/VisualEngine.ts")).default.getInstance();
      const res = env.restoreSnapshot(snapshotId);
      return {
        ok: res.ok,
        error: res.error ?? null,
        engineViews: ws.getState().views.map((view) => ({ id: view.id, revision: view.revision })),
        focus: visual.getState().interfaceFocus,
        snapshotAvailableAfterReload: env.getSnapshots().length,
      };
    }, saved.id);
    result.restore = restored;
    step("restore", { ok: restored.ok, views: restored.engineViews.length, available: restored.snapshotAvailableAfterReload });

    await page.waitForSelector("[data-workspace-view]", { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const restoredDom = await page.evaluate(() => ({
      count: document.querySelectorAll("[data-workspace-view]").length,
      cards: Array.from(document.querySelectorAll("[data-workspace-view]")).map((node) => ({
        id: node.getAttribute("data-workspace-view"),
        revision: node.getAttribute("data-revision"),
        selected: node.getAttribute("data-selected"),
        rect: (() => { const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      })),
      host: Boolean(document.querySelector('[data-workspace="lelu-system"]')),
    }));
    result.restoredDom = restoredDom;
    step("restored-dom", { count: restoredDom.count, host: restoredDom.host });
    await page.screenshot({ path: `${OUT}/shots/desktop-restored.png` });
  }

  result.finishedAt = new Date().toISOString();
  save();
} catch (error) {
  result.errors.push(String(error).slice(0, 600));
  result.finishedAt = new Date().toISOString();
  save();
  console.error("FAILED", error);
} finally {
  await browser.close();
}
