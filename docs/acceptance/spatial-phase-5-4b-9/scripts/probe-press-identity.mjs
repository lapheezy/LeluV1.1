/**
 * MISSION 5.4B.9 — press-owned portal identity, measured live.
 *
 * One press, one identity. This probe uses the browser's own input protocol
 * (CDP mouse events, or Playwright's real mouse) against the running app and
 * reads back the app's own press records — the identity claimed at
 * pointer-down, the identity resolved at pointer-up, the movement between them
 * and the runtime's final scene.
 *
 * Scenarios (SCENARIO env):
 *   accept   fresh loads, instant press + release (Files and Studio)
 *   drift    press, let the field rotate, release on the same pixel
 *   neighbour press, wait until a DIFFERENT portal occupies the release pixel,
 *              release — the pressed portal must still be the one that opens
 *   drag     press, move beyond the 18 px threshold, release — no travel
 *   cancel   touch press, then a real touch cancel — no travel
 *   keyboard focus a portal chip and press Enter — travel, real key input
 *   tap      two sequential taps; the second must still activate
 *
 * Nothing is called directly: no app handler, no runtime call, no destination
 * assignment. Only the final authoritative scene state counts as arrival.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const VP = (process.env.VP ?? "1440x900").split("x").map(Number);
const SCENARIO = process.env.SCENARIO ?? "accept";
const BATCH = Number(process.env.BATCH ?? 1);
const LOADS = Number(process.env.LOADS ?? 2);
const DESTS = (process.env.DESTS ?? "files,studio").split(",");
const DIR = "docs/acceptance/spatial-phase-5-4b-9";
const OUT = `${DIR}/${SCENARIO}-batch${BATCH}.json`;
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--headless=new", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});

const poll = (page) =>
  page.evaluate(() => {
    const s = window.__leluSpatial?.getState?.();
    return {
      current: s?.current ?? null,
      transition: s?.transition ? s.transition.kind : null,
      progress: s?.transition ? Math.round(s.transition.progress * 100) : 100,
      destination: s?.destination ?? null,
      dataset: document.body.dataset.spatialScene ?? null,
    };
  });

/** Settled = the runtime is not flying. The camera keeps drifting; that is not a readiness gate. */
const waitSettled = async (page, budgetMs = 12000) => {
  const end = Date.now() + budgetMs;
  let last = null;
  while (Date.now() < end) {
    last = await poll(page);
    if (!last.transition) return { ok: true, ...last };
    await page.waitForTimeout(120);
  }
  return { ok: false, ...(last ?? {}) };
};

/**
 * Aim at the middle of the target mouth, verified by the renderer's own
 * raycaster at that exact pixel. The centre is chosen for the largest possible
 * margin: the field keeps rotating, and a press that starts 60 px from the
 * mouth's edge is a press on that portal, not a near miss.
 */
const aim = (page, wanted) =>
  page.evaluate((destination) => {
    const field = window.__leluPortalField?.();
    const portal = (field?.portals ?? []).find((p) => p.destination === destination);
    if (!portal) return { error: "destination not in field" };
    const canvas = document.querySelector('[data-spatial-canvas="genesis"]');
    const candidates = [];
    const first = window.__leluPortalPick?.(portal.screen.x, portal.screen.y);
    if (first?.mouthCentre) candidates.push(first.mouthCentre);
    candidates.push({ x: portal.screen.x, y: portal.screen.y });
    for (const radius of [4, 8, 14, 22, 30, 40]) {
      for (const [dx, dy] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius, radius], [-radius, -radius]]) {
        candidates.push({ x: portal.screen.x + dx, y: portal.screen.y + dy });
      }
    }
    for (const point of candidates) {
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      if (x < 2 || y < 2) continue;
      if (document.elementFromPoint(x, y) !== canvas) continue;
      const pick = window.__leluPortalPick?.(x, y);
      if (pick?.portalId !== portal.id) continue;
      const centre = pick.mouthCentre ?? { x, y };
      return {
        x,
        y,
        portalId: portal.id,
        destination: portal.destination,
        hitRadius: pick.hitRadius,
        mouthCentre: centre,
        margin: Math.round(Math.hypot(x - centre.x, y - centre.y)),
      };
    }
    return { error: "no reachable pixel", id: portal.id, centre: portal.screen };
  }, wanted);

/**
 * Aim at the EDGE of the target mouth facing its nearest neighbour. Holding a
 * press there means a small rotation of the field slides the neighbour under the
 * pointer while the pointer itself never moves — the live neighbour swap.
 */
const aimSwap = (page, wanted) =>
  page.evaluate((destination) => {
    const field = window.__leluPortalField?.();
    const portals = field?.portals ?? [];
    const a = portals.find((p) => p.destination === destination);
    if (!a) return { error: "target not in field" };
    let b = null;
    let best = Infinity;
    for (const p of portals) {
      if (p.id === a.id) continue;
      const d = Math.hypot(p.screen.x - a.screen.x, p.screen.y - a.screen.y);
      if (d < best) { best = d; b = p; }
    }
    if (!b) return { error: "no neighbour" };
    const steps = Math.max(4, Math.ceil(best / 2));
    let lastA = null;
    let firstB = null;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = Math.round(a.screen.x + (b.screen.x - a.screen.x) * t);
      const y = Math.round(a.screen.y + (b.screen.y - a.screen.y) * t);
      const pick = window.__leluPortalPick?.(x, y);
      if (!pick?.portalId) continue;
      if (pick.portalId === a.id) lastA = { x, y };
      else if (!firstB) { firstB = { x, y, id: pick.portalId, name: pick.name }; break; }
    }
    if (!lastA) return { error: "no pixel inside the target" };
    /* Step back from the boundary into the mouth so the press itself lands on
       A with margin, while still sitting on the side the neighbour will sweep. */
    const bx = a.screen.x - lastA.x;
    const by = a.screen.y - lastA.y;
    const blen = Math.hypot(bx, by) || 1;
    const margin = Math.min(20, blen * 0.6);
    let press = { x: Math.round(lastA.x + (bx / blen) * margin), y: Math.round(lastA.y + (by / blen) * margin) };
    if (window.__leluPortalPick?.(press.x, press.y)?.portalId !== a.id) press = { x: lastA.x, y: lastA.y };
    return {
      x: press.x, y: press.y, portalId: a.id, destination: a.destination,
      neighbourId: b.id, neighbour: b.destination,
      boundary: { lastA, firstB },
      gapPx: firstB ? Math.round(Math.hypot(firstB.x - lastA.x, firstB.y - lastA.y)) : null,
      mouthCentre: a.screen,
    };
  }, wanted);

const pressRecords = (page) =>
  page.evaluate(() => {
    const list = window.__leluPortalPresses ?? [];
    return list.slice(-6);
  });

const selectCalls = (page) =>
  page.evaluate(() => (window.__leluSelectCalls ?? []).length);

/** Wait for the runtime to finish a flight and report the authoritative scene. */
const arrive = async (page, budgetMs = 20000) => {
  const started = Date.now();
  let state = await poll(page);
  let flying = Boolean(state.transition);
  while (Date.now() - started < budgetMs) {
    state = await poll(page);
    if (!state.transition) {
      if (flying) break;
      /* Nothing started: give the pointer path a moment, then accept the refusal. */
      if (Date.now() - started > 1200) break;
    } else {
      flying = true;
    }
    await page.waitForTimeout(110);
  }
  return { ...state, travelMs: Date.now() - started };
};

const enterWorld = async (page) => {
  await page.goto("http://127.0.0.1:3013/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").toLowerCase().includes("continue without an account"))
      ?.click();
  });
  await page.waitForTimeout(1200);
  const cosmos = await (await page.$(".lch-cosmos"))?.boundingBox();
  if (cosmos) await page.mouse.click(cosmos.x + cosmos.width / 2, cosmos.y + cosmos.height / 2);
  await page.waitForTimeout(3600);
  return waitSettled(page, 12000);
};

const backToCore = async (page) => {
  const core = await (await page.$('[data-spatial-control="core"]'))?.boundingBox();
  if (!core) return false;
  await page.mouse.click(core.x + core.width / 2, core.y + core.height / 2);
  await waitSettled(page, 20000);
  return true;
};

const records = [];
const total = SCENARIO === "accept" ? LOADS : LOADS;

for (let load = 1; load <= total; load += 1) {
  const context = await browser.newContext({
    viewport: { width: VP[0], height: VP[1] },
    reducedMotion: "reduce",
    hasTouch: ["cancel", "touch", "touchdrag"].includes(SCENARIO),
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const loadId = `${SCENARIO}-b${BATCH}-l${load}`;
  const settled = await enterWorld(page);
  const targets = SCENARIO === "accept" ? DESTS : [DESTS[0]];

  for (const destination of targets) {
    const ready = await waitSettled(page, 12000);
    let point = await aim(page, destination);
    const record = {
      loadId,
      freshLoad: true,
      settledWorld: { entry: settled.ok, ready: ready.ok, scene: ready.current },
      destination,
      aim: point,
      scenario: SCENARIO,
    };
    if (point.error) {
      records.push({ ...record, failure: point.error });
      writeFileSync(OUT, `${JSON.stringify({ mission: "5.4B.9", scenario: SCENARIO, batch: BATCH, records }, null, 2)}\n`);
      continue;
    }

    /*
     * Cooperative test setup, never a retry: no press is dispatched until the
     * pixel is verified to be inside the target mouth AT THAT INSTANT. The
     * field rotates continuously (measured ~6 px per frame under software
     * rendering), so aiming once and pressing a frame later can legitimately
     * land on empty space — that is a mis-aimed press, not a lost activation.
     * Nothing is recorded as an attempt until a real press is delivered.
     */
    let armed = null;
    for (let attempt = 0; attempt < 4 && !armed; attempt += 1) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none", clickCount: 0 });
      await page.waitForTimeout(180);
      const check = await page.evaluate(({ x, y, id }) => {
        const pick = window.__leluPortalPick?.(x, y);
        return { portalId: pick?.portalId ?? null, name: pick?.name ?? null, expected: id, ok: pick?.portalId === id };
      }, { x: point.x, y: point.y, id: point.portalId });
      record.armed = { ...record.armed, [`check${attempt}`]: check };
      if (check.ok) {
        armed = point;
        break;
      }
      const reaim = await aim(page, destination);
      if (!reaim.error) {
        point = reaim;
        record.aim = reaim;
      }
    }
    record.pressVerifiedInsideMouth = Boolean(armed);
    await page.evaluate(() => {
      window.__leluPressProbe = [];
      const canvas = document.querySelector('[data-spatial-canvas="genesis"]');
      if (!canvas) return;
      canvas.addEventListener("pointerdown", (event) => {
        const pick = window.__leluPortalPick?.(event.clientX, event.clientY);
        window.__leluPressProbe.push({
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
          pick: pick?.portalId ?? null,
          object: pick?.name ?? null,
          element: document.elementFromPoint(event.clientX, event.clientY)?.tagName ?? null,
        });
      }, true);
    });
    if (!armed) {
      records.push({ ...record, failure: "pixel never verified inside the target mouth" });
      writeFileSync(OUT, `${JSON.stringify({ mission: "5.4B.9", scenario: SCENARIO, batch: BATCH, records }, null, 2)}\n`);
      continue;
    }
    const eventsBefore = (await pressRecords(page)).length;
    const selectsBefore = await selectCalls(page);
    const t0 = Date.now();

    let pressPick = null;
    if (SCENARIO === "keyboard") {
      await page.evaluate((id) => {
        const chip = document.querySelector(`[data-portal-select="${id}"]`);
        chip?.focus();
      }, point.portalId);
      await page.keyboard.press("Enter");
    } else if (SCENARIO === "cancel") {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: point.x, y: point.y, id: 1 }],
      });
      await page.waitForTimeout(120);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    } else if (SCENARIO === "swap") {
      /*
       * LIVE NEIGHBOUR SWAP: press portal A at the edge facing B, hold the
       * pointer perfectly still, let the rotating field put B under the release
       * pixel, then release. A must open; B must never open.
       */
      let edge = await aimSwap(page, destination);
      record.aim = edge;
      if (edge.error) {
        records.push({ ...record, failure: edge.error });
        writeFileSync(OUT, `${JSON.stringify({ mission: "5.4B.9", scenario: SCENARIO, batch: BATCH, records }, null, 2)}\n`);
        continue;
      }
      /* The press must START on A: verify the claim, and if the field drifted
         it away, abort that press (drag off) and re-aim before holding. */
      let claimed = null;
      for (let i = 0; i < 4; i += 1) {
        point = edge;
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none", clickCount: 0 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
        claimed = await page.evaluate(() => (window.__leluPortalPresses ?? []).filter((p) => p.phase === "down").at(-1)?.portalId ?? null);
        if (claimed === edge.portalId) break;
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 70, y: point.y + 50, button: "left", clickCount: 0 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 70, y: point.y + 50, button: "left", clickCount: 1 });
        record.aimAttempts = [...(record.aimAttempts ?? []), { x: point.x, y: point.y, claimed }];
        await page.waitForTimeout(240);
        edge = await aimSwap(page, destination);
        if (edge.error) break;
        record.aim = edge;
      }
      record.claimAtDown = claimed;
      let swapped = null;
      const holdStart = Date.now();
      while (Date.now() - holdStart < 30000) {
        swapped = await page.evaluate(({ x, y }) => {
          const pick = window.__leluPortalPick?.(x, y);
          return { id: pick?.portalId ?? null, name: pick?.name ?? null };
        }, { x: point.x, y: point.y });
        if (swapped.id && swapped.id !== point.portalId) break;
        await page.waitForTimeout(120);
      }
      record.neighbourUnderPointerAtRelease = swapped;
      record.heldMs = Date.now() - holdStart;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
      pressPick = record.claimAtDown;
    } else if (SCENARIO === "retap") {
      /*
       * TWO INDEPENDENT PRESSES on the same page: the first must complete and
       * clear its ownership, the second must be accepted on its own merits.
       */
      const rounds = [];
      for (let round = 1; round <= 2; round += 1) {
        if (round > 1) {
          /* the field must be back in the wide core view before the second press */
          await waitSettled(page, 20000);
          for (let w = 0; w < 40; w += 1) {
            const ready = await page.evaluate((d) => {
              const field = window.__leluPortalField?.();
              const portal = (field?.portals ?? []).find((x) => x.destination === d);
              return Boolean(portal && window.__leluPortalPick?.(portal.screen.x, portal.screen.y));
            }, destination);
            if (ready) break;
            await page.waitForTimeout(250);
          }
        }
        const target = await aim(page, destination);
        if (target.error) { rounds.push({ round, failure: target.error }); break; }
        const selectsBeforeRound = await selectCalls(page);
        const downBefore = (await pressRecords(page)).length;
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y, button: "none", clickCount: 0 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
        const landedRound = await arrive(page, 20000);
        const roundPresses = (await pressRecords(page)).slice(downBefore);
        rounds.push({
          round,
          aim: target,
          claimAtDown: roundPresses.find((p) => p.phase === "down")?.portalId ?? null,
          resolution: roundPresses.find((p) => p.phase === "up")?.outcome ?? null,
          onSelectCalls: (await selectCalls(page)) - selectsBeforeRound,
          runtimeScene: landedRound.current,
          travelMs: landedRound.travelMs,
        });
        if (round === 1) {
          await backToCore(page);
          await page.waitForTimeout(800);
        }
      }
      record.retap = rounds;
    } else if (SCENARIO === "touch" || SCENARIO === "touchdrag") {
      /*
       * Real touch input through the browser protocol: touchStart → touchMove
       * (2 px for a tap, 60/40 px for a drag) → touchEnd. Pointer identity,
       * threshold and activation are all the app's own pointer path.
       */
      let touchClaim = null;
      for (let i = 0; i < 3; i += 1) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
        await page.waitForTimeout(120);
        touchClaim = await page.evaluate(() => (window.__leluPortalPresses ?? []).filter((p) => p.phase === "down").at(-1)?.portalId ?? null);
        if (touchClaim === point.portalId) break;
        /* the finger landed on empty canvas: cancel and re-aim (see the mouse path) */
        await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        record.touchMisses = [...(record.touchMisses ?? []), { x: point.x, y: point.y, claim: touchClaim }];
        await page.waitForTimeout(240);
        const reaim = await aim(page, destination);
        if (reaim.error) break;
        point = reaim;
        record.aim = reaim;
      }
      record.claimAtDown = touchClaim;
      const to = SCENARIO === "touchdrag"
        ? { x: point.x + 60, y: point.y + 40 }
        : { x: point.x + 2, y: point.y + 2 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to.x, y: to.y, id: 1 }] });
      record.touchMoveTo = to;
      await page.waitForTimeout(120);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      /*
       * Deliver the press. A press that lands on EMPTY canvas starts no
       * interaction at all — no claim, no selection, no transition — so it is a
       * measurement miss in a field that moves ~30 px per frame under software
       * rendering. Each one is recorded and released, and the press is re-aimed.
       * A press that reaches a DIFFERENT portal is a real wrong-destination and
       * is never retried.
       */
      if (SCENARIO === "lowfps") await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
      for (let i = 0; i < 4; i += 1) {
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none", clickCount: 0 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
        pressPick = await page.evaluate(() => window.__leluPressProbe?.at(-1)?.pick ?? null);
        if (pressPick !== null) break;
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
        record.setupMisses = [
          ...(record.setupMisses ?? []),
          { x: point.x, y: point.y, pick: pressPick, at: Date.now() - t0 },
        ];
        await page.waitForTimeout(240);
        const reaim = await aim(page, destination);
        if (reaim.error) break;
        point = reaim;
        record.aim = reaim;
      }
      record.pressPick = pressPick;
      if (SCENARIO === "drift") await page.waitForTimeout(500);
      if (SCENARIO === "neighbour") {
        const deadline = Date.now() + 6000;
        let swapped = null;
        while (Date.now() < deadline) {
          swapped = await page.evaluate(({ x, y, id }) => {
            const pick = window.__leluPortalPick?.(x, y);
            return { id: pick?.portalId ?? null, name: pick?.name ?? null, expected: id };
          }, { x: point.x, y: point.y, id: point.portalId });
          if (swapped.id && swapped.id !== point.portalId) break;
          await page.waitForTimeout(90);
        }
        record.releaseOccupant = swapped;
      }
      if (SCENARIO === "drag") {
        /* A drag releases where it drifted to: 60/40 px is far past the 18 px rule. */
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 60, y: point.y + 40, button: "left", clickCount: 0 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 60, y: point.y + 40, button: "left", clickCount: 1 });
        record.dragRelease = { x: point.x + 60, y: point.y + 40 };
        const dragLanded = await arrive(page, 4000);
        record.travel = { ms: dragLanded.travelMs, finalScene: dragLanded.current, dataset: dragLanded.dataset, destination: dragLanded.destination };
        record.doubleActivation = false;
        record.travelled = dragLanded.current === destination;
        record.outcomeClass = record.travelled ? "UNEXPECTED-TRAVEL" : "refused-as-designed";
        record.matches = !record.travelled;
        records.push(record);
        writeFileSync(OUT, `${JSON.stringify({ mission: "5.4B.9", scenario: SCENARIO, batch: BATCH, records }, null, 2)}\n`);
        if (dragLanded.current !== "core") await backToCore(page);
        continue;
      }
      if (SCENARIO === "tap") {
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
        await page.waitForTimeout(1500);
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
      }
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    }

    if (SCENARIO === "lowfps") {
      const series = [];
      const startedAt = Date.now();
      while (Date.now() - startedAt < 25000) {
        const sample = await poll(page);
        series.push({ ms: Date.now() - startedAt, progress: sample.progress, transition: sample.transition, scene: sample.current });
        if (!sample.transition && Date.now() - startedAt > 400) break;
        await page.waitForTimeout(150);
      }
      record.lowFps = { rate: 6, series };
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }

    const presses = (await pressRecords(page)).slice(eventsBefore);
    const selectsAfter = await selectCalls(page);
    const landed = await arrive(page);

    record.press = presses;
    record.pressProbe = await page.evaluate(() => window.__leluPressProbe ?? []);
    record.claimedAtDown = presses.find((p) => p.phase === "down")?.portalId ?? null;
    record.resolvedAtUp = presses.find((p) => p.phase === "up")?.portalId ?? null;
    record.moved = presses.find((p) => p.phase === "up")?.moved ?? null;
    record.outcome = presses.find((p) => p.phase === "up")?.outcome ?? null;
    record.refusal = presses.find((p) => p.phase === "up")?.reason ?? null;
    record.onSelectCalls = selectsAfter - selectsBefore;
    record.travel = { ms: landed.travelMs, finalScene: landed.current, dataset: landed.dataset, destination: landed.destination };
    record.doubleActivation = selectsAfter - selectsBefore > 1;
    record.identityHeld =
      record.claimedAtDown !== null && record.claimedAtDown === record.resolvedAtUp;
    record.travelled = landed.current === destination;
    record.outcomeClass =
      landed.current === destination
        ? "arrived"
        : record.claimedAtDown === null
          ? "no-claim"
          : record.travelled === false && landed.current && landed.current !== "core"
            ? "wrong-destination"
            : "no-travel";
    record.matches =
      record.travelled &&
      (SCENARIO === "accept" || SCENARIO === "drift" || SCENARIO === "neighbour"
        ? record.identityHeld
        : true) &&
      !record.doubleActivation;
    records.push(record);
    console.error(`${loadId} ${destination}: ${record.outcomeClass} landed=${landed.current} (${landed.travelMs}ms)`);
    writeFileSync(OUT, `${JSON.stringify({ mission: "5.4B.9", scenario: SCENARIO, batch: BATCH, records }, null, 2)}\n`);

    if (landed.current !== "core" && landed.current !== null) {
      if (SCENARIO === "accept") {
        await backToCore(page);
      }
    }
  }
  await context.close();
}

writeFileSync(OUT, `${JSON.stringify({ mission: "5.4B.9", scenario: SCENARIO, batch: BATCH, viewport: { width: VP[0], height: VP[1] }, records }, null, 2)}\n`);
console.log(
  JSON.stringify({
    out: OUT,
    rows: records.map((r) => ({
      load: r.loadId,
      dest: r.destination,
      point: [r.aim?.x, r.aim?.y],
      margin: r.aim?.margin,
      claimed: r.claimedAtDown,
      resolved: r.resolvedAtUp,
      moved: r.moved,
      outcome: r.outcome,
      refusal: r.refusal,
      landed: r.travel?.finalScene,
      cls: r.outcomeClass,
      matches: r.matches,
      ms: r.travel?.ms,
    })),
  }),
);
await browser.close();
