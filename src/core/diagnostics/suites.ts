/**
 * The diagnostic suites. Each check measures the LIVE page and stores (it runs in her own page, where the
 * person is), or runs the project's own test files through the engineering authority.
 *
 * Changes made to measure something (moving an object, typing into the composer) are put back afterwards,
 * and the evidence records the before and after.
 */

import { getObject, objectsFor, setTransform, update, variantFor, setVariant, group, type ThreadObject } from "../thread/ThreadObjects";
import { registerSuite, timed, type CheckContext, type DiagnosticCheck } from "./Diagnostics";

const frame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "undefined" ? setTimeout(r, 16) : requestAnimationFrame(() => r())));
const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) await frame();
};
async function waitFor<T>(fn: () => T | null | undefined | false, ms = 4000): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 80));
  }
}
const stageEl = (cid: string) => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>(`[data-thread-stage="${CSS.escape(cid)}"]`));
const objectEl = (cid: string, id: string) => stageEl(cid)?.querySelector<HTMLElement>(`[data-thread-object="${CSS.escape(id)}"]`) ?? null;
const rectOf = (el: Element) => el.getBoundingClientRect();
/** Is the visible centre of this element really this element (not covered by something else)? */
function hits(el: HTMLElement): { ok: boolean; at: [number, number]; got: string } {
  // A wrapped link's bounding-box centre can fall between its lines: aim at its first line box.
  const r = el.getClientRects().length > 1 ? el.getClientRects()[0] : rectOf(el);
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
  const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 60), 1), innerHeight - 1);
  const got = document.elementFromPoint(x, y);
  return { ok: !!got && (el === got || el.contains(got)), at: [Math.round(x), Math.round(y)], got: got ? describe(got) : "nothing" };
}
function describe(el: Element): string {
  const h = el as HTMLElement;
  const label = h.getAttribute?.("aria-label") || (el.tagName === "BUTTON" ? (h.textContent ?? "").trim().slice(0, 24) : "");
  return `${el.tagName.toLowerCase()}${h.className && typeof h.className === "string" ? `.${h.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}${h.dataset?.threadObject ? `[${h.dataset.threadObject}]` : ""}${label ? ` "${label}"` : ""}`;
}
const BLOCKED_NO_STAGE = (cid: string | null): Pick<DiagnosticCheck, "status" | "evidence" | "reason" | "next"> => ({
  status: "BLOCKED",
  evidence: cid ? `no [data-thread-stage="${cid}"] on screen` : "no open conversation",
  reason: "The conversation's Thread view is not open, so there is nothing on screen to measure.",
  next: { action: "Open the conversation in the Chat Universe and switch to its Thread view, then rerun.", kind: "read-only" },
});

/* ------------------------------------------------------------------ Freestyle + chat (§17) */

async function freestyle(ctx: CheckContext): Promise<void> {
  const cid = ctx.conversationId;
  const stage = cid ? stageEl(cid) : null;
  if (!cid || !stage) {
    for (const cat of ["a-spatial", "b-borderless", "c-chat", "d-coexistence", "e-persistence"]) await timed(ctx, { id: `${cat}:stage`, category: cat, title: `${cat}: Thread view on screen` }, () => BLOCKED_NO_STAGE(cid));
    await device(ctx);
    return;
  }
  // Measure Freestyle where the person is: switch to it for the run, then put their variant back.
  const before = variantFor(cid);
  if (before !== "freestyle") {
    setVariant(cid, "freestyle");
    await waitFor(() => stageEl(cid)?.dataset.base === "freestyle");
    await settle(6);
  }
  try {
    const objs = objectsFor(cid);
    await spatial(ctx, cid, objs);
    await borderless(ctx, cid, objs);
    await chat(ctx, cid);
    await coexistence(ctx, cid, objs);
    await persistence(ctx, cid, before);
    await device(ctx);
  } finally {
    if (before !== "freestyle") setVariant(cid, before);
  }
}

async function spatial(ctx: CheckContext, cid: string, objs: readonly ThreadObject[]): Promise<void> {
  const cat = "a-spatial";
  const first = objs.find((o) => objectEl(cid, o.id));
  if (!first) {
    await timed(ctx, { id: "a:objects", category: cat, title: "Objects in the Freestyle space" }, () => ({ status: "NOT_RUN", evidence: `${objs.length} object(s) stored, none on screen`, reason: "This conversation has no objects to move. Ask her to show the Neural Map, a page or a video, then rerun." }));
    return;
  }
  const id = first.id;
  const original = structuredClone(getObject(id)!.transforms);
  const originalStyle = { ...getObject(id)!.style };
  const t = () => getObject(id)!.transforms.freestyle;
  try {
    await timed(ctx, { id: "a:move", category: cat, title: "Move an object", target: { kind: "thread-object", ref: id } }, async () => {
      const el = objectEl(cid, id)!;
      const r0 = rectOf(el);
      setTransform(id, "freestyle", { dx: (t()?.dx ?? 0) + 40, dy: (t()?.dy ?? 0) + 24, manual: true });
      await settle();
      const r1 = rectOf(objectEl(cid, id)!);
      const dx = Math.round(r1.left - r0.left), dy = Math.round(r1.top - r0.top);
      return { status: Math.abs(dx - 40) <= 2 && Math.abs(dy - 24) <= 2 ? "PASS" : "FAIL", evidence: `asked +40,+24 px; the element moved ${dx},${dy} px`, reason: Math.abs(dx - 40) > 2 ? "The element did not move by the stored offset." : undefined };
    });
    await timed(ctx, { id: "a:resize", category: cat, title: "Resize an object", target: { kind: "thread-object", ref: id } }, async () => {
      const w0 = Math.round(rectOf(objectEl(cid, id)!).width);
      setTransform(id, "freestyle", { w: w0 + 60, manual: true });
      await settle();
      const w1 = Math.round(objectEl(cid, id)!.offsetWidth);
      return { status: Math.abs(w1 - (w0 + 60)) <= 2 ? "PASS" : "FAIL", evidence: `width ${w0} → asked ${w0 + 60}, measured ${w1} px` };
    });
    await timed(ctx, { id: "a:rotate", category: cat, title: "Rotate an object", target: { kind: "thread-object", ref: id } }, async () => {
      setTransform(id, "freestyle", { rot: 7, manual: true });
      await settle();
      const m = getComputedStyle(objectEl(cid, id)!).transform;
      const deg = m && m !== "none" ? Math.round((Math.atan2(Number(m.split(",")[1]), Number(m.split("(")[1].split(",")[0])) * 180) / Math.PI) : 0;
      return { status: deg === 7 ? "PASS" : "FAIL", evidence: `asked 7°, computed ${deg}°` };
    });
    if (objs.length >= 2 && objectEl(cid, objs[1].id)) {
      const other = objs.find((o) => o.id !== id && objectEl(cid, o.id))!;
      const otherT = structuredClone(getObject(other.id)!.transforms);
      const otherGroup = getObject(other.id)!.group;
      const myGroup = getObject(id)!.group;
      await timed(ctx, { id: "a:layer", category: cat, title: "Bring an object forward (z-order)", target: { kind: "thread-object", ref: id } }, async () => {
        setTransform(id, "freestyle", { z: 20, manual: true });
        await settle();
        const zA = Number(getComputedStyle(objectEl(cid, id)!).zIndex), zB = Number(getComputedStyle(objectEl(cid, other.id)!).zIndex);
        return { status: zA > zB ? "PASS" : "FAIL", evidence: `z ${zA} above the neighbour's ${zB}` };
      });
      await timed(ctx, { id: "a:group", category: cat, title: "Group two objects" }, async () => {
        const name = group([id, other.id], `diag-${Date.now().toString(36)}`);
        await settle();
        const same = objectEl(cid, id)!.dataset.group === name && objectEl(cid, other.id)!.dataset.group === name;
        update(id, { group: myGroup });
        update(other.id, { group: otherGroup });
        return { status: same ? "PASS" : "FAIL", evidence: `both carry data-group="${name}": ${same}; groups restored` };
      });
      update(other.id, { transforms: otherT });
    } else {
      await timed(ctx, { id: "a:layer", category: cat, title: "Bring an object forward (z-order)" }, () => ({ status: "NOT_RUN", evidence: "1 object on screen", reason: "Layering needs two objects." }));
    }
    await timed(ctx, { id: "a:collapse", category: cat, title: "Collapse and restore (minimize)", target: { kind: "thread-object", ref: id } }, async () => {
      const h0 = objectEl(cid, id)!.offsetHeight;
      update(id, { style: { ...getObject(id)!.style, collapsed: true } });
      await settle();
      const h1 = objectEl(cid, id)?.offsetHeight ?? -1;
      update(id, { style: originalStyle });
      await settle();
      const h2 = objectEl(cid, id)?.offsetHeight ?? -1;
      return { status: h1 < h0 && Math.abs(h2 - h0) <= 2 ? "PASS" : "FAIL", evidence: `height ${h0} → collapsed ${h1} → restored ${h2} px; same object id ${id}` };
    });
  } finally {
    update(id, { transforms: original, style: originalStyle });
    await settle();
  }
}

async function borderless(ctx: CheckContext, cid: string, objs: readonly ThreadObject[]): Promise<void> {
  const cat = "b-borderless";
  const els = objs.map((o) => [o, objectEl(cid, o.id)] as const).filter((p): p is readonly [ThreadObject, HTMLElement] => !!p[1]);
  if (!els.length) {
    await timed(ctx, { id: "b:none", category: cat, title: "Borderless outputs on screen" }, () => ({ status: "NOT_RUN", evidence: "0 objects on screen", reason: "Nothing to hit-test." }));
    return;
  }
  await timed(ctx, { id: "b:no-frames", category: cat, title: "Outputs have no decorative border" }, () => {
    const framed = els.filter(([, el]) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    });
    return { status: framed.length ? "FAIL" : "PASS", evidence: `${els.length - framed.length}/${els.length} without a border${framed.length ? `; framed: ${framed.map(([o]) => o.id).join(", ")}` : ""}` };
  });
  const scroller = stageEl(cid)?.querySelector<HTMLElement>("[data-freestyle-scroll]");
  const hitResults: string[] = [];
  let hitOk = 0;
  for (const [o, el] of els) {
    el.scrollIntoView({ block: "center", behavior: "instant" });
    await settle(2);
    const h = hits(el);
    if (h.ok) hitOk++;
    else hitResults.push(`${o.id} at ${h.at.join(",")} hit ${h.got}`);
  }
  if (scroller) scroller.scrollTop = 0;
  await timed(ctx, { id: "b:hit", category: cat, title: "Each output can be hit at its centre (not covered)" }, () => ({ status: hitOk === els.length ? "PASS" : hitOk ? "PARTIAL" : "FAIL", evidence: `${hitOk}/${els.length} hit${hitResults.length ? `; covered: ${hitResults.join("; ")}` : ""}`, reason: hitResults.length ? "Something else is on top of these outputs." : undefined }));
  await timed(ctx, { id: "b:handles", category: cat, title: "Every output has a move handle and labelled controls (no border needed to grab it)" }, () => {
    const missing = els.filter(([, el]) => !el.querySelector('[aria-label="Move"]') || !el.querySelector('[aria-label="Collapse"], [aria-label="Expand"]'));
    return { status: missing.length ? "FAIL" : "PASS", evidence: `${els.length - missing.length}/${els.length} have Move + Collapse/Expand` };
  });
  await timed(ctx, { id: "b:keyboard", category: cat, title: "Output controls are keyboard-reachable" }, () => {
    const controls = els.flatMap(([, el]) => [...el.querySelectorAll<HTMLElement>("button, a[href], [tabindex]")]);
    const reachable = controls.filter((c) => c.tabIndex >= 0 && !(c as HTMLButtonElement).disabled);
    const grip = els.filter(([, el]) => (el.querySelector<HTMLElement>('[aria-label="Move"]')?.tabIndex ?? -1) >= 0).length;
    return { status: grip === els.length ? "PASS" : "PARTIAL", evidence: `${reachable.length}/${controls.length} controls focusable; move handle focusable on ${grip}/${els.length}`, reason: grip < els.length ? "The move handle is pointer-only: it cannot be reached or operated by keyboard." : undefined, next: grip < els.length ? { action: "Give the move handle tabIndex=0 and arrow-key moves in ThreadStage LiquidShell.", kind: "needs-approval" } : undefined };
  });
  await timed(ctx, { id: "b:overflow", category: cat, title: "Content stays inside its output (no spill)" }, () => {
    const spill = els.filter(([, el]) => {
      const body = el.querySelector<HTMLElement>(".to-body");
      if (!body) return false;
      const cs = getComputedStyle(body);
      return body.scrollWidth > body.clientWidth + 1 && cs.overflowX === "visible";
    });
    return { status: spill.length ? "FAIL" : "PASS", evidence: `${els.length - spill.length}/${els.length} contained` };
  });
  await timed(ctx, { id: "b:embedded", category: cat, title: "Links, buttons and embeds inside outputs can be hit" }, async () => {
    let total = 0, ok = 0;
    const bad: string[] = [];
    for (const [o, el] of els) {
      const inner = [...el.querySelectorAll<HTMLElement>(".to-body button, .to-body a[href], .to-body iframe")].slice(0, 4);
      for (const c of inner) {
        c.scrollIntoView({ block: "center", behavior: "instant" });
        await settle(1);
        total++;
        const h = hits(c);
        if (h.ok) ok++;
        else bad.push(`${o.kind}:${describe(c)} hit ${h.got}`);
      }
    }
    return total ? { status: ok === total ? "PASS" : ok ? "PARTIAL" : "FAIL", evidence: `${ok}/${total} inner controls hit${bad.length ? `; blocked: ${bad.slice(0, 4).join("; ")}` : ""}` } : { status: "NOT_RUN", evidence: "no inner controls", reason: "No output holds a link, button or embed." };
  });
}

const composer = () => document.querySelector<HTMLTextAreaElement>('[data-lelu-universe-window] textarea[aria-label^="Message"], textarea[aria-label^="Message "]');
const sendBtn = () => document.querySelector<HTMLButtonElement>("button.lcu-send");
function setNative(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function chat(ctx: CheckContext, cid: string): Promise<void> {
  const cat = "c-chat";
  const c = composer();
  await timed(ctx, { id: "c:composer", category: cat, title: "Composer visible and not covered", target: { kind: "selector", ref: 'textarea[aria-label^="Message"]' } }, () => {
    if (!c) return { status: "FAIL", evidence: "no composer textarea found", reason: "The chat composer is not on screen in Freestyle." };
    const h = hits(c);
    return { status: h.ok ? "PASS" : "FAIL", evidence: `composer ${Math.round(rectOf(c).width)}×${Math.round(rectOf(c).height)} px; centre hits ${h.got}` };
  });
  if (!c) return;
  const draft = c.value;
  await timed(ctx, { id: "c:type", category: cat, title: "Focus and type into the composer (draft put back)" }, async () => {
    c.focus();
    setNative(c, "diagnostic probe");
    await settle(2);
    const typed = composer()?.value === "diagnostic probe";
    const focused = document.activeElement === composer();
    setNative(composer()!, draft);
    await settle(2);
    return { status: typed && focused ? "PASS" : "FAIL", evidence: `focused: ${focused}; value took: ${typed}; draft restored: ${composer()?.value === draft}` };
  });
  await timed(ctx, { id: "c:send-control", category: cat, title: "Send control present, enabled with text, and not covered" }, async () => {
    const before = c.value;
    setNative(c, "x");
    await settle(2);
    const b = sendBtn();
    const enabled = !!b && !b.disabled;
    const h = b ? hits(b) : null;
    setNative(composer()!, before);
    await settle(1);
    return { status: enabled && h?.ok ? "PASS" : "FAIL", evidence: b ? `enabled with text: ${enabled}; centre hits ${h?.got}` : "no send button" };
  });
  await timed(ctx, { id: "c:send", category: cat, title: "Send, stream and render a reply" }, () => ({ status: "NOT_RUN", evidence: "not sent", reason: "Sending would spend a provider turn and add a message to this conversation. Ask for \"validate Freestyle, including sending\" to run it.", next: { action: "Rerun with sending included.", kind: "reversible" } }));
  await timed(ctx, { id: "c:render", category: cat, title: "Messages rendered in the Freestyle conversation" }, () => {
    const chatEl = stageEl(cid)?.querySelector<HTMLElement>("[data-thread-chat]");
    const shown = chatEl?.querySelectorAll(".lcu-msg:not(.lcu-msg-interim)").length ?? 0;
    return { status: chatEl ? (shown > 0 ? "PASS" : "PARTIAL") : "FAIL", evidence: chatEl ? `${shown} message(s) drawn in the Freestyle conversation (${chatEl.classList.contains("fs-chat") ? "beside the space" : "inside the space, compact"})` : "no [data-thread-chat]", reason: chatEl && !shown ? "No messages to show yet." : undefined };
  });
  await timed(ctx, { id: "c:scroll", category: cat, title: "Conversation scrolls on its own (the space does not move)" }, async () => {
    const chatEl = stageEl(cid)?.querySelector<HTMLElement>(".fs-chat");
    const space = stageEl(cid)?.querySelector<HTMLElement>("[data-freestyle-scroll]");
    if (!chatEl && space && stageEl(cid)?.dataset.compact === "true") return { status: "NOT_RUN", evidence: "compact (phone) Freestyle: the conversation is part of the space", reason: "On a phone the conversation scrolls with the space by design; there is no second scroll to test." };
    if (!chatEl || !space) return { status: "FAIL", evidence: "missing .fs-chat or the Freestyle scroll" };
    if (chatEl.scrollHeight <= chatEl.clientHeight + 1) return { status: "NOT_RUN", evidence: `${chatEl.scrollHeight} ≤ ${chatEl.clientHeight} px`, reason: "The conversation is too short to scroll." };
    const s0 = space.scrollTop, c0 = chatEl.scrollTop;
    chatEl.scrollTop = c0 + 80;
    await settle(2);
    const moved = chatEl.scrollTop !== c0, spaceStill = space.scrollTop === s0;
    chatEl.scrollTop = c0;
    return { status: moved && spaceStill ? "PASS" : "FAIL", evidence: `chat scrolled: ${moved}; space unmoved: ${spaceStill}` };
  });
}

async function coexistence(ctx: CheckContext, cid: string, objs: readonly ThreadObject[]): Promise<void> {
  const cat = "d-coexistence";
  const c = composer();
  const first = objs.find((o) => objectEl(cid, o.id));
  if (!c || !first) {
    await timed(ctx, { id: "d:needs", category: cat, title: "Chat beside objects" }, () => ({ status: "NOT_RUN", evidence: `composer: ${!!c}; objects on screen: ${!!first}`, reason: "Needs both the composer and at least one object." }));
    return;
  }
  await timed(ctx, { id: "d:focus-kept", category: cat, title: "Moving an object does not steal the composer's focus" }, async () => {
    const original = structuredClone(getObject(first.id)!.transforms);
    c.focus();
    setTransform(first.id, "freestyle", { dx: (original.freestyle?.dx ?? 0) + 30, manual: true });
    await settle();
    const still = document.activeElement === composer();
    update(first.id, { transforms: original });
    await settle();
    return { status: still ? "PASS" : "FAIL", evidence: `composer kept focus while ${first.id} moved: ${still}` };
  });
  await timed(ctx, { id: "d:not-covered", category: cat, title: "No object covers the composer or send control" }, () => {
    const covered: string[] = [];
    for (const el of [c, sendBtn()].filter(Boolean) as HTMLElement[]) {
      const r = rectOf(el);
      for (const [x, y] of [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]]) {
        const got = document.elementFromPoint(x, y);
        const obj = got?.closest("[data-thread-object]");
        if (obj) covered.push(`${describe(el)} corner covered by ${(obj as HTMLElement).dataset.threadObject}`);
      }
    }
    return { status: covered.length ? "FAIL" : "PASS", evidence: covered.length ? covered.join("; ") : "all corners of composer and Send are clear" };
  });
  await timed(ctx, { id: "d:kinds", category: cat, title: "Chat coexists with browser, video and Neural Map objects" }, () => {
    const kinds = new Set(objs.filter((o) => objectEl(cid, o.id)).map((o) => o.kind));
    const want = ["web", "youtube", "neural-map"];
    const have = want.filter((k) => kinds.has(k as ThreadObject["kind"]));
    return { status: have.length === want.length ? "PASS" : have.length ? "PARTIAL" : "NOT_RUN", evidence: `on screen together with the chat: ${have.join(", ") || "none"} of ${want.join(", ")}`, reason: have.length < want.length ? `Not present in this conversation: ${want.filter((k) => !have.includes(k)).join(", ")}.` : undefined };
  });
}

async function persistence(ctx: CheckContext, cid: string, before: string): Promise<void> {
  const cat = "e-persistence";
  await timed(ctx, { id: "e:stored", category: cat, title: "Positions and sizes are stored, not only drawn" }, async () => {
    const o = objectsFor(cid).find((x) => objectEl(cid, x.id));
    if (!o) return { status: "NOT_RUN", evidence: "no object", reason: "Nothing to store." };
    const original = structuredClone(getObject(o.id)!.transforms);
    setTransform(o.id, "freestyle", { dx: (original.freestyle?.dx ?? 0) + 11, manual: true });
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("lelu.thread.objects.v1") ?? "" : "";
    const parsed = JSON.parse(raw || "null") as { objects?: ThreadObject[] } | ThreadObject[] | null;
    const list = Array.isArray(parsed) ? parsed : parsed?.objects ?? [];
    const stored = list.find((x) => x.id === o.id)?.transforms.freestyle?.dx;
    update(o.id, { transforms: original });
    return { status: stored === (original.freestyle?.dx ?? 0) + 11 ? "PASS" : "FAIL", evidence: `stored dx ${stored}, expected ${(original.freestyle?.dx ?? 0) + 11}; put back` };
  });
  await timed(ctx, { id: "e:same-object", category: cat, title: "A mode switch reuses the same object (no copy)" }, async () => {
    const ids0 = objectsFor(cid).map((o) => o.id).join(",");
    setVariant(cid, "workspace");
    await waitFor(() => stageEl(cid)?.dataset.variant === "workspace");
    await settle(3);
    setVariant(cid, "freestyle");
    await waitFor(() => stageEl(cid)?.dataset.base === "freestyle");
    await settle(3);
    const ids1 = objectsFor(cid).map((o) => o.id).join(",");
    return { status: ids0 === ids1 ? "PASS" : "FAIL", evidence: `object ids before and after Freestyle → Liquid workspace → Freestyle: ${ids0 === ids1 ? "identical" : `${ids0} vs ${ids1}`}` };
  });
  await timed(ctx, { id: "e:variant", category: cat, title: "The chosen mode is stored per conversation" }, () => {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("lelu.thread.objects.v1") ?? "" : "";
    const stored = (JSON.parse(raw || "null") as { variants?: Record<string, string> } | null)?.variants?.[cid];
    return { status: variantFor(cid) === "freestyle" && stored === "freestyle" ? "PASS" : "FAIL", evidence: `variantFor = ${variantFor(cid)}; stored = ${stored ?? "nothing"} (was ${before} before the run)` };
  });
  await timed(ctx, { id: "e:reload", category: cat, title: "Survives a reload" }, () => ({ status: "NOT_RUN", evidence: "not reloaded", reason: "A reload would end this run. It is covered by scripts/thread/verify-thread-visual.mjs (WP06/WP07) and by node scripts/diagnostics/freestyle-chat.mjs, which reloads and re-measures." }));
}

async function device(ctx: CheckContext): Promise<void> {
  const cat = "f-device";
  const touch = typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0 && matchMedia("(pointer: coarse)").matches;
  const iphone = typeof navigator !== "undefined" && /iPhone/.test(navigator.userAgent);
  await timed(ctx, { id: "f:physical", category: cat, title: "Physical iPhone (touch, keyboard, safe areas)" }, () =>
    iphone && touch
      ? { status: "PASS", evidence: `running on an iPhone: ${innerWidth}×${innerHeight}, touch points ${navigator.maxTouchPoints}` }
      : { status: "BLOCKED", evidence: `this run is on ${touch ? "a touch device that is not an iPhone" : "a non-touch device"}`, reason: "Physical-iPhone behaviour can only be measured on an iPhone. Open LÉLU on the phone and run this from its chat.", next: { action: "Run \"validate Freestyle, including chat\" from the iPhone.", kind: "outside-environment" } },
  );
  // Measure at rest: objects animate in after a mode switch, and a mid-animation size is not the real size.
  if (typeof document !== "undefined" && document.getAnimations) await Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 2500))]);
  await new Promise((r) => setTimeout(r, 600)); // the map lays out its bar after a resize observer fires
  await timed(ctx, { id: "f:targets", category: cat, title: "Touch targets at least 44 px (thread controls)" }, () => {
    if (!touch) return { status: "NOT_RUN", evidence: `pointer is fine (mouse) at ${innerWidth}×${innerHeight}`, reason: "The 44 px rule is for touch. Run this on the phone (or the emulated-phone run) to measure it." };
    const ctrls = [...document.querySelectorAll<HTMLElement>("[data-thread-stage] .to-grip, [data-thread-stage] .to-actions button, [data-thread-stage] .to-body button, button.lcu-send")].filter((e) => e.offsetParent);
    const small = ctrls.filter((e) => {
      const r = rectOf(e);
      return Math.min(r.width, r.height) < 44;
    });
    const kind = iphone ? "measured" : "simulated";
    return { status: small.length === 0 ? "PASS" : small.length < ctrls.length / 2 ? "PARTIAL" : "FAIL", evidence: `${ctrls.length - small.length}/${ctrls.length} controls ≥ 44 px at ${innerWidth}×${innerHeight} (${iphone ? "this iPhone" : "emulated touch, not a physical phone"})${small.length ? `; small: ${small.slice(0, 4).map(describe).join(", ")}` : ""}`, metric: { name: "small touch targets", value: small.length, unit: "controls", kind }, reason: small.length ? "Small targets are hard to hit with a finger." : undefined };
  });
}

/* ------------------------------------------------------------------ Chat + Neural Map + browser */

async function integration(ctx: CheckContext): Promise<void> {
  const cat = "integration";
  const cid = ctx.conversationId;
  await timed(ctx, { id: "i:chat", category: cat, title: "Chat Universe conversation open" }, () => (cid ? { status: "PASS", evidence: `conversation ${cid}` } : { status: "BLOCKED", evidence: "none", reason: "No conversation is open." }));
  await timed(ctx, { id: "i:neko", category: cat, title: "Live browser (Neko) reachable" }, async () => {
    const r = await fetch("/api/neko/status", { signal: AbortSignal.timeout(7000) }).catch(() => null);
    const p = r ? ((await r.json().catch(() => ({}))) as { configured?: boolean; reachable?: boolean }) : {};
    return p.reachable ? { status: "PASS", evidence: "Neko web client reachable" } : { status: "BLOCKED", evidence: `configured: ${!!p.configured}; reachable: ${!!p.reachable}`, reason: p.configured ? "Neko is configured but not answering." : "Neko is not configured on this server.", next: { action: "Start Neko (deploy/neko/local/run.sh --refresh-proxy on the dev machine).", kind: "outside-environment" } };
  });
  const objs = cid ? objectsFor(cid) : [];
  await timed(ctx, { id: "i:map", category: cat, title: "Neural Map renders in the conversation" }, async () => {
    const m = objs.find((o) => o.kind === "neural-map");
    if (!m || !cid) return { status: "NOT_RUN", evidence: "no Neural Map object", reason: "Ask her to show the Neural Map, then rerun." };
    const el = await waitFor(() => objectEl(cid, m.id));
    const drawn = el?.querySelector("svg, canvas");
    return { status: drawn ? "PASS" : "FAIL", evidence: el ? `${m.map?.aspect} ${m.map?.view}: ${drawn ? drawn.tagName.toLowerCase() : "nothing drawn"}` : "object not on screen" };
  });
  await timed(ctx, { id: "i:web", category: cat, title: "Browser objects offer the live view" }, () => {
    const webs = cid ? objs.filter((o) => o.kind === "web" && objectEl(cid, o.id)) : [];
    if (!webs.length) return { status: "NOT_RUN", evidence: "no web object", reason: "No page in this conversation." };
    const withLive = webs.filter((o) => objectEl(cid!, o.id)!.querySelector("[data-neko-toggle]")).length;
    return { status: withLive === webs.length ? "PASS" : withLive ? "PARTIAL" : "FAIL", evidence: `${withLive}/${webs.length} pages have "Live here (Neko)"` };
  });
  await timed(ctx, { id: "i:video", category: cat, title: "Video object reports its player state" }, () => {
    const v = cid ? objs.find((o) => o.kind === "youtube") : undefined;
    const el = v && cid ? objectEl(cid, v.id)?.querySelector<HTMLElement>("[data-youtube]") : null;
    return v ? (el ? { status: "PASS", evidence: `player state: ${el.dataset.playerState}` } : { status: "FAIL", evidence: "video object not drawn" }) : { status: "NOT_RUN", evidence: "no video object", reason: "No video in this conversation." };
  });
}

/* ------------------------------------------------------------------ the project's own tests */

const UNIT_FILES = ["tests/diagnostics.test.ts", "tests/thread-variants.test.ts", "tests/grounded-completion.test.ts", "tests/self-awareness.test.ts"];
async function unit(ctx: CheckContext): Promise<void> {
  await timed(ctx, { id: "u:tests", category: "unit", title: `Project tests (${UNIT_FILES.length} files) through the engineering runtime`, target: { kind: "test", ref: UNIT_FILES.join(" ") } }, async () => {
    const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
    const r = await EngineeringWorkspace.getInstance().checkFiles(null, "test-files", UNIT_FILES);
    if (!("exitCode" in r)) return { status: "BLOCKED", evidence: "not run", reason: r.error, next: { action: "Configure LELU_ENGINEER_TOKEN for the development runtime (Settings → Engineering).", kind: "needs-approval" } };
    const pass = Number(r.output.match(/# pass (\d+)/)?.[1] ?? NaN), fail = Number(r.output.match(/# fail (\d+)/)?.[1] ?? NaN);
    return { status: r.ok ? "PASS" : "FAIL", evidence: `exit ${r.exitCode}; ${Number.isNaN(pass) ? "?" : pass} pass, ${Number.isNaN(fail) ? "?" : fail} fail; ${Math.round(r.durationMs / 1000)} s`, reason: r.ok ? undefined : r.output.split("\n").filter((l) => /^not ok/.test(l)).slice(0, 4).join("; ") || "see the runtime output", metric: { name: "test duration", value: r.durationMs, unit: "ms", kind: "measured" } };
  });
}

let registered = false;
export function registerDiagnosticSuites(): void {
  if (registered) return;
  registered = true;
  registerSuite({ id: "freestyle-chat", title: "Freestyle + chat", match: /freestyle|borderless/i, run: freestyle });
  registerSuite({ id: "integration", title: "Chat + Neural Map + browser", match: /integrat|neural map|browser|neko/i, run: integration });
  registerSuite({ id: "unit", title: "Project tests", match: /unit|project tests?|test files/i, run: unit });
  registerSuite({ id: "full", title: "Full diagnostic", match: /full|everything|all|cosmos diagnostic|broken interactions?/i, run: async () => undefined });
}
