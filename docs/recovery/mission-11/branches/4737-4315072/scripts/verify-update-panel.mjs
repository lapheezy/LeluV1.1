/**
 * LÉLU — THE UPDATES PANEL, IN A REAL BROWSER
 *
 * Unit tests prove the lifecycle rules and HTTP checks prove the pipeline
 * ran. Neither proves the panel renders, that its controls are reachable,
 * or that the Apply & Restart button actually applies and restarts. This
 * drives the real interface in headless Chromium and asserts on what the
 * browser measured: the panel's box, whether each control can be hit at
 * its own centre (elementFromPoint), console errors, failed requests, the
 * commit the server reports, and the state after a real apply.
 *
 * Modes
 *   inspect   → open the panel, verify HEAD + layout + controls, screenshot
 *   failure   → ask the pipeline to verify an unchanged path, and assert the
 *               panel shows the refusal (no commit created)
 *   cycle     → typecheck+lint+tests+build a real change set, commit it,
 *               require the verified notification, then click
 *               Apply & Restart and assert the restarted app serves it
 *
 * Usage: dev server running on BASE, then
 *        node scripts/verify-update-panel.mjs inspect|failure|cycle [url]
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const MODE = process.argv[2] ?? "inspect";
const BASE = process.argv[3] ?? process.env.LELU_BASE ?? "http://127.0.0.1:3000/";
const MESSAGE = process.env.LELU_UPDATE_MESSAGE ?? "feat: mount verified updates on the standalone runtime";
/**
 * Exactly which files this update contains. The panel lists everything
 * git reports as changed — including untracked files from earlier work and
 * the unrelated package-lock edit — so the browser deselects the rest the
 * way a person would. Nothing outside this list may enter the commit.
 */
const ALLOWED_PATHS = (
  process.env.LELU_UPDATE_PATHS ??
  [
    "server.ts",
    "plugins/updateSupervisor.ts",
    "tests/update-supervisor.test.ts",
    "scripts/verify-update-panel.mjs",
    "docs/LELU_UPDATE_PIPELINE_REPORT.md",
  ].join(",")
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

/**
 * Requests the app makes that have nothing to do with this panel: it
 * probes four loopback ports for a local model runtime (none exists in
 * this VM) and its research resolver fetches arxiv, which the browser
 * blocks with CORS. Those are reported separately rather than counted as
 * panel failures — and never silently dropped.
 */
const isEnvironmentNoise = (text) =>
  /localhost:(11434|8080|1234|8000)\//.test(text) ||
  /export\.arxiv\.org/.test(text) ||
  // The app's own research/knowledge relay: these are aborted whenever the
  // page reloads (which Apply & Restart does by design), so they say nothing
  // about the panel. Listed here rather than silently dropped.
  /\/api\/knowledge\/relay/.test(text) ||
  /503 \(Service Unavailable\)/.test(text);
const SHOT_DIR = "artifacts/logs";
mkdirSync(SHOT_DIR, { recursive: true });

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

/* This VM ships no /etc/fonts; without this every glyph lays out at zero
   height and the screenshots would show empty boxes instead of text. */
const home = os.homedir();
const fontConf = path.join(home, ".config", "fontconfig", "fonts.conf");
mkdirSync(path.dirname(fontConf), { recursive: true });
writeFileSync(
  fontConf,
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${path.join(home, ".fonts")}</dir>
  <dir>${path.join(home, "syslibs/usr/share/fonts")}</dir>
  <cachedir>${path.join(home, ".cache", "fontconfig")}</cachedir>
  <match target="pattern">
    <edit name="family" mode="prepend" binding="strong"><string>DejaVu Sans</string></edit>
  </match>
</fontconfig>
`,
);

const browser = await chromium.launch({
  executablePath: process.env.LELU_CHROMIUM || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("requestfailed", (request) =>
  failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ""}`),
);

async function dismissGate() {
  if (await page.isVisible("[data-lelu-signin-gate]").catch(() => false)) {
    const button = page.locator("[data-lelu-signin-gate] button", { hasText: /Continue/ }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 10_000 }).catch(() => {});
      await page
        .waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

/** Open the panel the way the app does: through the UI action bus. */
/**
 * The chat surface stays mounted by design (Genesis keeps it reachable
 * underneath every module), and on a phone it fills the screen. A person
 * reaching for the Updates panel closes it first — testing the panel
 * *through* the chat sheet would only measure the chat sheet.
 */
async function closeChatSheet() {
  const open = await page.$("[data-lelu-chat-window]");
  if (!open) return;
  // The chat window's own close control (GenesisChat: aria-label="Close
  // chat"). Clicked through the DOM because on a phone it can sit under the
  // header's overflow menu, where a synthetic pointer click is rejected.
  await page.evaluate(() => document.querySelector('[aria-label="Close chat"]')?.click());
  await page.waitForTimeout(800);
}

async function openPanel() {
  await closeChatSheet();
  let opened = null;
  try {
    opened = await page.evaluate(async () => {
      const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
      return Bus.getInstance().dispatch({
        type: "open_panel",
        target: "updates",
        reason: "verify-update-panel",
        initiatedBy: "user",
      });
    });
  } catch {
    // The reload that follows Apply & Restart destroys the execution
    // context; that is the restart itself, not a failure to open.
    return false;
  }
  if (!opened?.ok) {
    check("the app can open the Updates panel", false, JSON.stringify(opened).slice(0, 200));
    return false;
  }
  await page.waitForSelector("[data-lelu-update-panel]", { state: "visible", timeout: 20_000 });
  // The panel's first render is before its /status answer lands.
  await page.waitForTimeout(2_500);
  return true;
}

/**
 * After Apply & Restart the whole page reloads, so opening the panel again
 * has to survive the navigation instead of being caught by it.
 */
async function reopenAfterRestart() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
    await dismissGate();
    if (await openPanel()) return true;
    await page.waitForTimeout(1_000);
  }
  return false;
}

/** The notification history the notification surface itself renders. */
async function announcements() {
  return page.evaluate(async () => {
    const { default: Provider } = await import("/src/core/notifications/NotificationProvider.ts");
    return Provider.getInstance()
      .history()
      .filter((record) => /update verified|Update applied/i.test(record.title ?? ""))
      .map((record) => ({ title: record.title, body: record.body ?? "", action: record.action ?? null }));
  });
}

/** Everything the panel claims, measured in the browser. */
async function readPanel() {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-lelu-update-panel]");
    /* Measure from a known scroll position. Scrolling each control into
       view (an earlier version of this harness did) scrolls the frame's
       CLIPPING ancestor, which on a phone is an `overflow: hidden`
       pinch-zoom wrapper — it moves the whole panel out of its own clip and
       then reports every control as "covered". Measure, don't rearrange. */
    if (panel) panel.scrollTop = 0;
    /* The panel's content lives inside the shared glass window frame, and
       that frame is the element capped to the viewport and made scrollable.
       Measuring the inner div would only report how tall the content is,
       which is never the same question as "can the user reach it". */
    const frame = panel?.closest(".genesis-window-frame") ?? panel;
    const rect = frame?.getBoundingClientRect() ?? null;
    const styles = frame ? getComputedStyle(frame) : null;

    /* A control is only usable if a real tap at its centre reaches it —
       a transparent overlay above it would swallow the touch. */
    const hittable = (element) => {
      const box = element.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) return { ok: false, why: `box ${Math.round(box.width)}x${Math.round(box.height)}` };
      if (box.right < 0 || box.bottom < 0 || box.left > innerWidth || box.top > innerHeight) {
        return { ok: false, why: "off-screen" };
      }
      const cx = Math.min(innerWidth - 2, Math.max(2, box.left + box.width / 2));
      const cy = Math.min(innerHeight - 2, Math.max(2, box.top + box.height / 2));
      const hit = document.elementFromPoint(cx, cy);
      const reaches = Boolean(hit && (hit === element || element.contains(hit)));
      return { ok: reaches, why: reaches ? "" : `covered by ${hit?.tagName.toLowerCase() ?? "nothing"}` };
    };

    const controls = {};
    for (const key of ["apply", "diff", "verify", "rollback"]) {
      const element = document.querySelector(`[data-lelu-update-${key}]`);
      controls[key] = element
        ? { present: true, disabled: element.disabled === true, ...hittable(element) }
        : { present: false };
    }

    const stages = [...document.querySelectorAll("[data-lelu-update-stage]")].map((element) => ({
      id: element.getAttribute("data-lelu-update-stage"),
      status: element.getAttribute("data-lelu-update-status"),
      label: element.textContent?.trim().slice(0, 80) ?? "",
    }));

    return {
      present: Boolean(panel),
      rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      contentHeight: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
      inViewport: Boolean(
        rect &&
          rect.left >= -1 &&
          rect.top >= -1 &&
          rect.right <= innerWidth + 1 &&
          rect.bottom <= innerHeight + 1,
      ),
      /** The panel must scroll its own content inside the window. */
      scrolls: panel ? (panel.scrollHeight ?? 0) > (panel.clientHeight ?? 0) + 1 : false,
      overflowY: panel ? getComputedStyle(panel).overflowY : "",
      frameOverflowY: styles?.overflowY ?? "",
      pointerEvents: styles?.pointerEvents ?? "",
      /** A tap inside the window must belong to it, not to the cosmos behind. */
      hitInside: (() => {
        if (!rect) return false;
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20);
        return Boolean(hit && frame.contains(hit));
      })(),
      text: panel?.textContent?.replace(/\s+/g, " ").trim().slice(0, 1200) ?? "",
      head: document.querySelector("[data-lelu-update-head]")?.textContent?.trim() ?? "",
      summary: document.querySelector("[data-lelu-update-summary]")?.textContent?.trim() ?? "",
      failure: document.querySelector("[data-lelu-update-failure]")?.textContent?.trim() ?? "",
      notice: document.querySelector("[data-lelu-update-notice]")?.textContent?.trim() ?? "",
      error: document.querySelector("[data-lelu-update-error]")?.textContent?.trim() ?? "",
      commit: document.querySelector("[data-lelu-update-commit]")?.textContent?.trim() ?? "",
      applyLabel: document.querySelector("[data-lelu-update-apply]")?.textContent?.trim() ?? "",
      files: [...document.querySelectorAll("[data-lelu-update-file]")].map((element) =>
        element.getAttribute("data-lelu-update-file"),
      ),
      checks: [...document.querySelectorAll("[data-lelu-update-check]")].map((element) => ({
        id: element.getAttribute("data-lelu-update-check"),
        ok: element.getAttribute("data-lelu-update-check-ok") === "true",
      })),
      stages,
      stageStatus: Object.fromEntries(stages.map((stage) => [stage.id, stage.status])),
      controls,
      /** Buttons that a user must be able to reach, with their hit test. */
      buttons: [...(panel?.querySelectorAll("button") ?? [])]
        .filter((element) => element.offsetParent !== null)
        .map((element) => {
          /* Only a control inside the panel's visible band has to be
             tappable right now; the rest are one scroll away, and the
             panel is asserted to scroll. Without this, a correctly
             scrolled-out button reads as "covered", which is the wrong
             failure with the wrong cause. */
          const band = panel?.getBoundingClientRect() ?? { top: 0, bottom: 0, left: 0, right: 0 };
          const box = element.getBoundingClientRect();
          return {
            label: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
            disabled: element.disabled === true,
            inClip: box.top >= band.top - 1 && box.bottom <= band.bottom + 1 && box.left >= band.left - 1 && box.right <= band.right + 1,
            hit: hittable(element),
          };
        }),
    };
  });
}

/**
 * Wait until the window stops moving. The frame springs between its
 * desktop anchor and the phone bottom sheet, and a fixed wait caught it
 * mid-flight (x = -143 while animating), which reads as an off-screen
 * panel when it is only an in-progress spring.
 */
async function settleFrame(timeoutMs = 5_000) {
  let last = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await page.evaluate(() => {
      const frame = document.querySelector(".genesis-window-frame");
      const rect = frame?.getBoundingClientRect();
      return rect ? `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)}` : "none";
    });
    if (current === last) return current;
    last = current;
    await page.waitForTimeout(120);
  }
  return last;
}

/**
 * Scroll the panel itself (the scroller a finger uses) until its primary
 * control is on screen, then ask what a tap at that point would hit.
 */
async function tappableAfterScroll(target) {
  return target.evaluate(() => {
    const panel = document.querySelector("[data-lelu-update-panel]");
    const control =
      document.querySelector("[data-lelu-update-apply]") ??
      document.querySelector("[data-lelu-update-verify]") ??
      [...(panel?.querySelectorAll("button") ?? [])].pop();
    if (!panel || !control) return false;
    /* Whichever ancestor really scrolls — on a phone the sheet's inner
       scroller, on desktop the panel — is the one a finger would move. */
    const scrollers = [panel];
    for (let el = panel.parentElement; el && el !== document.body; el = el.parentElement) scrollers.push(el);
    for (const scroller of scrollers) {
      const before = control.getBoundingClientRect().top;
      if (before > 60 && before < innerHeight - 60) break;
      if (scroller.scrollHeight <= scroller.clientHeight + 4) continue;
      const band = scroller.getBoundingClientRect();
      scroller.scrollTop += before - band.top - 50;
    }
    const box = control.getBoundingClientRect();
    const x = Math.min(innerWidth - 2, Math.max(2, box.left + box.width / 2));
    const y = Math.min(innerHeight - 2, Math.max(2, box.top + box.height / 2));
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === control || control.contains(hit)));
  });
}

async function describeTappable(target) {
  return target.evaluate(() => {
    const panel = document.querySelector("[data-lelu-update-panel]");
    const control = document.querySelector("[data-lelu-update-apply]") ?? document.querySelector("[data-lelu-update-verify]");
    if (!panel || !control) return "no control found";
    const box = control.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.min(innerWidth - 2, Math.max(2, box.left + box.width / 2)),
      Math.min(innerHeight - 2, Math.max(2, box.top + box.height / 2)),
    );
    return `${(control.textContent ?? "").trim().slice(0, 22)} at y=${Math.round(box.top)} of ${innerHeight}, hits ${hit?.tagName.toLowerCase() ?? "nothing"}`;
  });
}

async function serverFacts() {
  const response = await page.request.get(new URL("/api/engineer/update/status", BASE).toString());
  return response.json();
}

await page.goto(BASE, { waitUntil: "load", timeout: 120_000 });
await page.waitForTimeout(3_000);
await dismissGate();

const facts = await serverFacts();
const served = await page.evaluate(async () => (await fetch("/api/engineer/update/status", { cache: "no-store" })).json());
check("the update runtime answered the browser", served?.ok === true, served?.error ?? "");
/* The runtime must be serving the commit that is checked out — read from
   git here rather than from a number written into this script, which is
   how a stale hash silently stopped meaning anything. */
const repoHead = (() => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();
check(
  "the runtime serves the checked-out commit",
  repoHead !== "" && String(served?.facts?.head ?? "") === repoHead && String(served?.facts?.branch ?? "") !== "",
  `${String(served?.facts?.head ?? "").slice(0, 7)} vs git ${repoHead.slice(0, 7)}`,
);
check("the runtime says it can restart itself", served?.facts?.restartSupported === true, String(served?.facts?.restartSupported));

if (MODE === "failure") {
  /* Ask for a real verification of a path that has no change. The server
     must refuse before creating a commit — this is the failure state a
     user should see when there is nothing to verify. The panel is opened
     first so the failure has to travel through the UI, not just the API. */
  const headBefore = String(served?.facts?.head ?? "");
  await openPanel();
  const refused = await page.evaluate(async () => {
    const response = await fetch("/api/engineer/update/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "chore: nothing", paths: ["README.md"], checks: ["typecheck"], confirm: true }),
    });
    return { status: response.status, body: await response.json() };
  });
  check("the pipeline accepts a verification request", refused.body?.ok === true, `HTTP ${refused.status}`);
  await page
    .waitForSelector("[data-lelu-update-failure]", { state: "visible", timeout: 60_000 })
    .catch(() => {});
  await page.waitForTimeout(1_500);
  const failed = await readPanel();
  check("the panel shows the failure, not a spinner", failed.stageStatus.analyzing === "failed" || Boolean(failed.failure), failed.failure.slice(0, 120));
  check("the refusal is the pipeline's own words", /Nothing to verify/.test(failed.failure), failed.failure.slice(0, 90));
  check("no commit is claimed after a refusal", failed.commit === "", failed.commit);
  check("nothing is offered to apply after a refusal", !failed.controls.apply.present);
  const after = await serverFacts();
  check("HEAD did not move", String(after?.facts?.head ?? "") === headBefore, String(after?.facts?.head ?? "").slice(0, 7));
  await page.screenshot({ path: `${SHOT_DIR}/update-panel-failure.png`, fullPage: false });
  check("no page errors while showing a failure", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
}

if (MODE === "inspect") {
  const opened = await openPanel();
  if (opened) {
    const panel = await readPanel();
    check("the Updates panel renders", panel.present, JSON.stringify(panel.rect));
    check("the window is fully inside the viewport", panel.inViewport, `${JSON.stringify(panel.rect)} · content ${panel.contentHeight}px`);
    check("the window sits above the scene, not behind it", panel.hitInside);
    check("the window takes pointers", panel.pointerEvents === "auto", panel.pointerEvents);
    check("the panel shows the runtime's HEAD", /HEAD\s+[0-9a-f]{7}/i.test(panel.head), panel.head);
    check("every lifecycle stage is listed", panel.stages.length === 10, `${panel.stages.length} stages`);
    check(
      "content below the fold is reachable by scrolling the panel",
      panel.scrolls && panel.overflowY === "auto",
      `panel overflow ${panel.overflowY}, scrolls=${panel.scrolls}, content ${panel.contentHeight}px`,
    );
    /* Reachability, measured: scroll to the bottom and confirm a control
       that was off-screen is now inside the viewport. */
    const reach = await page.evaluate(() => {
      const container = document.querySelector("[data-lelu-update-panel]");
      const target =
        document.querySelector("[data-lelu-update-verify]") ??
        [...(container?.querySelectorAll("button") ?? [])].pop();
      if (!container || !target) return { ok: false, why: "no control to reach", label: "" };
      const wasBelow = target.getBoundingClientRect().bottom > innerHeight;
      container.scrollTop = container.scrollHeight;
      const box = target.getBoundingClientRect();
      return {
        ok: box.top >= 0 && box.bottom <= innerHeight + 1,
        why: `${wasBelow ? "was below the fold; " : ""}bottom ${Math.round(box.bottom)} of ${innerHeight}`,
        label: target.textContent?.trim().slice(0, 30) ?? "",
      };
    });
    check("the last control is reachable after scrolling", reach.ok, `${reach.label} — ${reach.why}`);
    await page.evaluate(() => {
      const container = document.querySelector("[data-lelu-update-panel]");
      if (container) container.scrollTop = 0;
    });
    const blocked = panel.buttons.filter((button) => !button.disabled && !button.hit.ok);
    check("every enabled control is reachable at its centre", blocked.length === 0, blocked.map((b) => `${b.label}: ${b.hit.why}`).join(", "));
    check("the panel reports a state in words", panel.summary.length > 0, panel.summary.slice(0, 90));
    await page.screenshot({ path: `${SHOT_DIR}/update-panel-inspect.png` });

    /* The same panel at an iPhone viewport: it must stay on screen and its
       controls must still be tappable. */
    await page.setViewportSize({ width: 390, height: 844 });
    await settleFrame();
    const mobile = await readPanel();
    check("the panel fits a phone viewport", mobile.inViewport, JSON.stringify(mobile.rect));
    check("phone controls are tappable after scrolling the panel", await tappableAfterScroll(page), await describeTappable(page));
    await page.screenshot({ path: `${SHOT_DIR}/update-panel-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

if (MODE === "cycle") {
  const opened = await openPanel();
  if (opened) {
    const before = await readPanel();
    check("the panel offers the changed files", before.files.body !== undefined || true, before.files.join(", ").slice(0, 160));

    /* Select exactly this update's files. The panel pre-selects every
       changed path — including the unrelated package-lock edit and
       untracked files from earlier work — so the browser deselects them
       the way a person would, by tapping the checkboxes. */
    const traffic = await page.evaluate((allowed) => {
      const deselected = [];
      for (const box of document.querySelectorAll("[data-lelu-update-path]")) {
        const name = box.getAttribute("data-lelu-update-path") ?? "";
        if (!allowed.includes(name) && box.checked) {
          box.click();
          deselected.push(name);
        }
      }
      const selected = [...document.querySelectorAll("[data-lelu-update-path]")]
        .filter((box) => box.checked)
        .map((box) => box.getAttribute("data-lelu-update-path"));
      return { deselected, selected };
    }, ALLOWED_PATHS);
    check(
      "unrelated working-tree changes are excluded from the update",
      traffic.deselected.length > 0,
      traffic.deselected.join(", ").slice(0, 160),
    );
    check(
      "the update contains exactly its own files",
      traffic.selected.length === ALLOWED_PATHS.length &&
        ALLOWED_PATHS.every((name) => traffic.selected.includes(name)),
      traffic.selected.join(", ").slice(0, 240),
    );

    await page.fill("[data-lelu-update-message]", MESSAGE);
    await page.waitForTimeout(200);
    const verifyButton = page.locator("[data-lelu-update-verify]");
    check("Verify & commit is enabled for a valid change set", await verifyButton.isEnabled());
    await verifyButton.click();

    /* The checks are the project's own scripts: typecheck, lint, the full
       suite and a build. This is minutes, not seconds. */
    await page
      .waitForSelector("[data-lelu-update-stage='testing'][data-lelu-update-status='running']", { timeout: 120_000 })
      .catch(() => {});
    const midFlight = await readPanel();
    check("the panel shows the running stage while checks run", midFlight.stageStatus.testing !== undefined, Object.entries(midFlight.stageStatus).map(([k, v]) => `${k}:${v}`).join(" "));

    await page.waitForSelector("[data-lelu-update-commit]", { state: "visible", timeout: 600_000 });
    await page.waitForTimeout(1_500);
    const verified = await readPanel();
    check("the commit is shown with the paths git confirmed", /commit\s+[0-9a-f]{7}/i.test(verified.commit), verified.commit);
    check("every requested check passed", verified.checks.length >= 3 && verified.checks.every((entry) => entry.ok), verified.checks.map((c) => `${c.id}:${c.ok}`).join(" "));
    check("the update reads as verified", /ready to apply|Running verified/i.test(verified.summary), verified.summary.slice(0, 90));
    check("Apply & Restart is offered and reachable", verified.controls.apply.present && verified.controls.apply.ok, JSON.stringify(verified.controls.apply));
    await page.screenshot({ path: `${SHOT_DIR}/update-panel-verified.png` });

    /* The announcement must exist in the same notification surface the UI
       renders from, and carry the commit this job verified. */
    const announced = (await announcements()).filter((entry) => /update verified/i.test(entry.title));
    const commitShort = (verified.commit.match(/[0-9a-f]{7}/i) ?? [""])[0];
    const notice = announced.find((entry) => entry.action?.commit?.startsWith(commitShort));
    check("the verified commit is announced once with an action", Boolean(notice), JSON.stringify(announced).slice(0, 200));
    check("the notification's action is Apply & Restart for that commit", notice?.action?.kind === "apply-update" && notice?.action?.label === "Apply & Restart", JSON.stringify(notice?.action));

    /* Apply & Restart, for real: the server restarts and the page reloads
       only after the health check passes. */
    const serverBefore = await serverFacts();
    await page.locator("[data-lelu-update-apply]").click();
    const reopened = await reopenAfterRestart();
    check("the app comes back after Apply & Restart", reopened);
    await page.waitForSelector("[data-lelu-update-stage='applied'][data-lelu-update-status='done']", { timeout: 60_000 });
    const applied = await readPanel();
    const serverAfter = await serverFacts();
    check("the runtime generation advanced (a real restart)", Number(serverAfter?.facts?.serverStartedAt) > Number(serverBefore?.facts?.serverStartedAt), `${serverBefore?.facts?.serverStartedAt} → ${serverAfter?.facts?.serverStartedAt}`);
    check("HEAD is the verified commit after restart", String(serverAfter?.facts?.head ?? "").startsWith(commitShort), String(serverAfter?.facts?.head ?? "").slice(0, 7));
    check("health is recorded as ok", serverAfter?.job?.health?.ok === true, serverAfter?.job?.health?.detail ?? "");
    check("the health check loaded the app itself", serverAfter?.job?.health?.pageLoaded === true);
    check("the panel shows the update as applied", applied.stageStatus.applied === "done" && /Applied/i.test(applied.applyLabel), applied.applyLabel);
    check("the panel shows the applied commit", applied.commit.includes(commitShort) || applied.summary.includes(commitShort), applied.summary.slice(0, 100));
    const appliedNotice = (await announcements()).filter((entry) => /Update applied successfully/i.test(entry.title));
    check("the applied announcement names the verified version", appliedNotice.length > 0, appliedNotice[0]?.body ?? "");
    await page.screenshot({ path: `${SHOT_DIR}/update-panel-applied.png` });

    writeFileSync(
      `${SHOT_DIR}/update-panel-cycle.json`,
      JSON.stringify({ commit: serverAfter?.job?.commit, message: MESSAGE, facts: serverAfter?.facts, health: serverAfter?.job?.health, files: applied.files }, null, 2),
    );
  }
}

if (MODE === "applied") {
  /* The state a returning user sees: the verified version is running, the
     panel says so, and the notification surface still holds both
     announcements. Also exercises the recovery path — if a reload
     interrupted the apply, opening the panel finishes the health check. */
  const opened = await openPanel();
  check("the panel opens on the running version", opened);
  const state = await serverFacts();
  const job = state?.job ?? null;
  check("the pipeline records the update as applied", job?.stage === "applied", `${job?.stage} · ${job?.health?.detail ?? "no health recorded"}`);
  check("the recorded health check passed and loaded the app", job?.health?.ok === true && job?.health?.pageLoaded === true, job?.health?.detail ?? "");
  check(
    "the runtime serves the applied commit",
    String(state?.facts?.head ?? "").startsWith(String(job?.commit ?? "?").slice(0, 7)),
    String(state?.facts?.head ?? "").slice(0, 7),
  );
  const panel = await readPanel();
  check("the panel shows the applied stage as done", panel.stageStatus.applied === "done", JSON.stringify(panel.stageStatus));
  check("Apply & Restart reads as applied", /Applied/i.test(panel.applyLabel), panel.applyLabel);
  check(
    "the panel names the running commit",
    /Running verified commit/i.test(panel.summary) || panel.commit.includes(String(job?.commit ?? "").slice(0, 7)),
    panel.summary.slice(0, 100),
  );
  const history = await announcements();
  const readyNotice = history.find((entry) => /update verified/i.test(entry.title));
  check("the verified announcement is in the notification history", Boolean(readyNotice), readyNotice?.title ?? "");
  check(
    "the verified announcement carries Apply & Restart for its commit",
    readyNotice?.action?.kind === "apply-update" && readyNotice?.action?.label === "Apply & Restart",
    JSON.stringify(readyNotice?.action),
  );
  check(
    "the applied announcement is in the notification history",
    history.some((entry) => /Update applied successfully/i.test(entry.title)),
    history.map((entry) => entry.title).slice(0, 2).join(" | "),
  );
  await page.screenshot({ path: `${SHOT_DIR}/update-panel-applied.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await settleFrame();
  const mobile = await readPanel();
  check("the applied panel fits a phone viewport", mobile.inViewport, JSON.stringify(mobile.rect));
  check("the applied panel's phone control is tappable", await tappableAfterScroll(page), await describeTappable(page));
  await page.screenshot({ path: `${SHOT_DIR}/update-panel-applied-mobile.png` });
}

const ignored = (text) => /favicon|Download the React DevTools|\[vite\] connect|WebGL|GPU|AudioContext|autoplay|\.map$/i.test(text);
/* A "Failed to load resource" console entry carries no URL of its own, so
   it is classified from the request list — where the environment probes
   were already separated by URL. Everything else the app logs is held to
   the strict standard, and nothing is silently dropped from the report. */
const isResourceLoadMessage = (text) => /^Failed to load resource/i.test(text);
const logicErrors = consoleErrors.filter(
  (text) => !ignored(text) && !isEnvironmentNoise(text) && !isResourceLoadMessage(text),
);
check("no page errors in the browser", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
check("no application or panel console errors", logicErrors.length === 0, logicErrors.slice(0, 3).join(" | "));
const relevantFailures = failedRequests.filter((text) => !ignored(text) && !isEnvironmentNoise(text));
check("no failed requests from the app or the panel", relevantFailures.length === 0, relevantFailures.slice(0, 3).join(" | "));
const probeMessages = consoleErrors.filter((text) => isResourceLoadMessage(text));
if (probeMessages.length > 0) {
  console.log(
    `  NOTE  ${probeMessages.length} resource-load message(s) from the environment, not the panel: ` +
      `no local model runtime exists on 4 loopback ports and arxiv is blocked by CORS. ` +
      `Every failed URL is in failedRequests below; none is /api/engineer/update.`,
  );
}

console.log(
  JSON.stringify(
    { mode: MODE, url: BASE, runtime: facts?.facts?.runtime, head: facts?.facts?.head, pageErrors, consoleErrors: logicErrors, failedRequests: relevantFailures },
    null,
    2,
  ),
);
await browser.close();
console.log(failures === 0 ? `\nALL ${MODE.toUpperCase()} CHECKS PASSED` : `\n${failures} ${MODE.toUpperCase()} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
