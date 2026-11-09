/*
 * MISSION 7.2 — does LÉLU choose the repository workforce herself?
 *
 * Three ordinary user messages through the REAL application:
 *   guest entry -> real composer -> real cognition (AIRouter -> provider tool
 *   loop -> ToolDispatcher -> ACQUISITION_EXECUTORS -> /api/acquisition).
 *
 * Nothing is injected: no scripted model response, no direct call to
 * RepoExecutive, RepoExecutor or the acquisition API. The evidence is what the
 * running app did — console tool lines, /api/acquisition requests the page
 * itself made, and the reply text the person sees.
 *
 * usage: TURN=1|2|3 node docs/acceptance/mission-7-2/scripts/repo-chat.mjs
 * TURN=2 needs TURN=1's state; the same browser storage is carried between them.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT ?? '3013';
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/acceptance/mission-7-2';
const TURN = Number(process.env.TURN ?? 1);
const WAIT_MS = Number(process.env.WAIT_MS ?? 120_000);
const PROFILE_STATE = process.env.STATE ?? '/tmp/m72-state.json';
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;

const TURNS = {
  1: {
    stage: 'research',
    prompt:
      'Find a maintained open-source library that could improve LÉLU’s typo-tolerant search. Compare relevant candidates, inspect their licenses, and recommend the best fit.',
  },
  2: {
    stage: 'acquire',
    prompt:
      'Acquire the recommended search capability, inspect the repository, adapt the useful implementation for LÉLU, run its tests, and prepare it for integration. Do not modify canonical code without approval.',
  },
  3: {
    stage: 'followup',
    prompt:
      'Show me what you acquired, what changed, which tests passed, and what remains before integration.',
  },
};

fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const file = path.join(OUT, `chat-turn${TURN}.json`);
const rec = {
  mission: 'mission-7-2', turn: TURN, stage: TURNS[TURN]?.stage, base: BASE,
  at: new Date().toISOString(), console: [], modelRequests: [], acquisitionRequests: [],
  pageErrors: [], before: null, after: null, reply: [], toolLines: [], result: 'RUNNING',
};
const save = () => fs.writeFileSync(file, JSON.stringify(rec, null, 2));

const browser = await chromium.launch({
  headless: true, executablePath: CHROME,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce',
  ...(fs.existsSync(PROFILE_STATE) ? { storageState: PROFILE_STATE } : {}),
});
const page = await ctx.newPage();
page.on('pageerror', (e) => { rec.pageErrors.push(String(e.message || e).slice(0, 300)); save(); });
page.on('console', (msg) => {
  const t = msg.text();
  if (rec.console.length > 2000) return;
  if (/tool|repo[._]|acqui|research|clone|licen|test|provider|429|refus|error/i.test(t)) {
    rec.console.push(`${msg.type()}: ${t}`.slice(0, 600));
    save();
  }
});
ctx.on('request', (r) => {
  const u = r.url();
  if (u.includes('/api/acquisition')) {
    rec.acquisitionRequests.push({ method: r.method(), url: u.replace(BASE, '/'), body: String(r.postData() ?? '').slice(0, 400), at: Date.now() });
    save();
  }
});
ctx.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/model/')) {
    rec.modelRequests.push({ url: u.replace(BASE, '/').slice(0, 140), status: r.status(), at: Date.now() });
    save();
  }
});

const snap = () => page.evaluate(() => {
  const text = document.body.innerText;
  return {
    textLen: text.length,
    tail: text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-40),
    toolMentions: (text.match(/repo[._][a-z_]+/g) || []).slice(-10),
    acquisitionMentions: (text.match(/acq-[a-z0-9-]+/g) || []).slice(-6),
  };
});

const enter = async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);
  const findComposer = async () => {
    for (const sel of ['textarea[placeholder*="Message"]:visible', 'textarea:visible', '[contenteditable="true"]:visible']) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) return loc;
    }
    return null;
  };
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const cosmos = page.locator('button.lch-cosmos').first();
    if (await cosmos.count().catch(() => 0)) { await cosmos.click().catch(() => {}); await page.waitForTimeout(2000); }
    for (const label of ['Continue without an account', 'Continue as guest', 'Guest']) {
      const guest = page.locator(`button:has-text("${label}")`).first();
      if (await guest.count().catch(() => 0)) { await guest.click({ force: true }).catch(() => {}); await page.waitForTimeout(2500); break; }
    }
    let box = await findComposer();
    if (box) return box;
    for (const pill of ['Chat', 'Universe']) {
      const btn = page.locator(`button:has-text("${pill}")`).first();
      if (await btn.count().catch(() => 0)) { await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(2500); box = await findComposer(); if (box) return box; }
    }
    await page.waitForTimeout(3000);
  }
  return page.locator('textarea').first();
};

try {
  let box = await enter();
  if (!(await box.count())) throw new Error('composer not found after guest entry');
  rec.before = await snap();
  save();

  const turn = TURNS[TURN];
  if (!turn) throw new Error(`no turn ${TURN}`);

  await box.evaluate((el) => el.focus());
  await box.fill(turn.prompt).catch(async () => page.keyboard.insertText(turn.prompt));
  await page.waitForTimeout(400);
  await box.evaluate((el) => el.focus());
  await page.keyboard.press('Enter');
  rec.sentAt = Date.now();
  save();

  // Wait for the turn to stop changing: the reply grows, tool lines appear, a
  // request to the acquisition runtime is made. Bounded, and recorded either way.
  const deadline = Date.now() + WAIT_MS;
  let observed = rec.before, grew = false, stable = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    const now = await snap();
    const changed =
      now.textLen !== observed.textLen ||
      now.toolMentions.length > observed.toolMentions.length ||
      now.acquisitionMentions.length > observed.acquisitionMentions.length ||
      rec.acquisitionRequests.length > 0 ||
      rec.modelRequests.length > 0;
    if (changed) grew = true;
    observed = now;
    stable = changed ? 0 : stable + 1;

    // The consent boundary is real: an EXTERNAL_ACTION step asks the person
    // before it runs. Clicking Approve is exactly what a person does here —
    // the harness decides nothing itself and approves nothing on her behalf
    // that the app did not ask for.
    const awaiting = /waiting for your approval/i.test(now.tail.join(' '));
    if (awaiting && !rec.awaitingDom) {
      // What the app really shows at the consent boundary, recorded once so a
      // selector is chosen from the DOM instead of guessed.
      rec.awaitingDom = await page.evaluate(() => {
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const buttons = [...document.querySelectorAll('button')]
          .filter(visible)
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        return {
          buttons: [...new Set(buttons)].slice(0, 80),
          expanders: [...document.querySelectorAll('button[aria-expanded]')]
            .map((el) => ({
              expanded: el.getAttribute('aria-expanded'),
              text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
              visible: visible(el),
            }))
            .slice(0, 8),
        };
      });
      await page.screenshot({ path: path.join(OUT, 'shots', `awaiting-${turn.stage}.png`) }).catch(() => {});
      save();
    }
    if (awaiting && Date.now() - (rec.lastApprovalAt ?? 0) > 6000 && (rec.approvals?.length ?? 0) < 8) {
      // The waiting task is collapsed into a header in the chat:
      //   "… 1 waiting for your approval · Needs your approval: …"
      // The decision controls do not exist until a person opens it, which is
      // why every earlier attempt clicked something that was not this card.
      const opener = page.locator('button', { hasText: /waiting for your approval/i }).first();
      if ((await opener.count().catch(() => 0)) && (await opener.isVisible().catch(() => false))) {
        await opener.click({ force: true }).catch(() => {});
        await page.waitForTimeout(900);
      }
      // A second collapsed level (the timeline's own header) may sit between.
      const header = page.locator('button[aria-expanded="false"]').first();
      if ((await header.count().catch(() => 0)) && (await header.isVisible().catch(() => false))) {
        await header.click({ force: true }).catch(() => {});
        await page.waitForTimeout(700);
      }

      // Decide. The timeline's exact control first, then the label the task
      // header itself offers once opened.
      let approve = page.locator('button:text-is("✓ Approve")').first();
      if (!(await approve.count().catch(() => 0))) {
        approve = page.locator('button', { hasText: /^Approve\b/ }).first();
      }
      if ((await approve.count().catch(() => 0)) && (await approve.isVisible().catch(() => false))) {
        await approve.click({ force: true }).catch(() => {});
        rec.approvals = rec.approvals ?? [];
        rec.approvals.push({ at: new Date().toISOString(), step: turn.stage });
        rec.lastApprovalAt = Date.now();
        rec.openDom = await page.evaluate(() =>
          [...document.querySelectorAll('button')]
            .filter((el) => el.offsetWidth || el.offsetHeight)
            .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
            .filter((text) => /approv/i.test(text))
            .slice(0, 10),
        );
        save();
      }
    }

    // Never stop while the app is waiting on the person: that is not a
    // finished turn, it is a pause.
    if (grew && stable >= 4 && !awaiting) break;
  }
  rec.waitedMs = Date.now() - rec.sentAt;
  rec.after = observed;
  rec.toolLines = rec.console.filter((l) => /tool|repo[._]|acqui|clone|licen/i.test(l)).slice(-40);
  rec.reply = observed.tail;
  rec.result = grew ? 'RECORDED' : 'NO_CHANGE';
  await page.screenshot({ path: path.join(OUT, 'shots', `turn${TURN}-${turn.stage}.png`) }).catch(() => {});
  save();
} catch (e) {
  rec.error = String(e.message || e).slice(0, 500);
  rec.result = 'ERROR';
  await page.screenshot({ path: path.join(OUT, 'shots', `turn${TURN}-error.png`) }).catch(() => {});
  save();
} finally {
  await ctx.storageState({ path: PROFILE_STATE }).catch(() => {});
  await browser.close().catch(() => {});
  rec.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({
    turn: TURN, result: rec.result, waitedMs: rec.waitedMs,
    modelRequests: rec.modelRequests.length, acquisitionRequests: rec.acquisitionRequests.length,
    toolMentions: rec.after?.toolMentions, acquisitions: rec.after?.acquisitionMentions,
    toolLines: rec.toolLines?.slice(-8), reply: rec.reply?.slice(-10), error: rec.error,
  }, null, 1).slice(0, 3000));
}
