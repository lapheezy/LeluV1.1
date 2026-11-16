import test from "node:test";
import assert from "node:assert/strict";
import {
  planPresence,
  presenceModeFor,
  spatialStateFor,
  sizeFor,
  overlaps,
  sameSpace,
  type PresenceIntent,
  type SpaceLayout,
} from "../src/app/scene/genesis/avatar/spatialPresence.ts";

const intent = (over: Partial<PresenceIntent> = {}): PresenceIntent => ({
  mode: "interactive",
  chatOpen: true,
  workspaceOpen: false,
  demonstrating: false,
  speaking: false,
  listening: false,
  interacting: false,
  toolActive: false,
  ...over,
});

const phone: SpaceLayout = {
  viewport: { width: 390, height: 844 },
  safe: { top: 47, right: 0, bottom: 34, left: 0 },
  chat: { left: 12, top: 120, width: 366, height: 600 },
  panels: [],
  composer: { left: 24, top: 640, width: 342, height: 56 },
  controls: [{ left: 0, top: 780, width: 390, height: 64 }],
  reducedMotion: false,
};

const desktop: SpaceLayout = {
  viewport: { width: 1440, height: 900 },
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
  chat: { left: 80, top: 120, width: 380, height: 620 },
  panels: [],
  composer: { left: 100, top: 660, width: 340, height: 56 },
  controls: [{ left: 40, top: 830, width: 300, height: 54 }],
  reducedMotion: false,
};

test("on a phone she stands clear of the composer and the safe areas", () => {
  const plan = planPresence(phone, intent());
  assert.equal(plan.hidden, false, "a 390px phone has room for her");
  assert.ok(plan.rect.left >= phone.safe.left, "inside the left safe area");
  assert.ok(plan.rect.top >= phone.safe.top, "below the notch");
  assert.ok(plan.rect.top + plan.rect.height <= phone.viewport.height - phone.safe.bottom, "above the home indicator");
  assert.equal(overlaps(plan.rect, phone.composer!, 0), false, "never covers the chat input");
  assert.equal(overlaps(plan.rect, phone.chat!, 0), false, "a phone has no beside-space, so she peeks outside the window");
  assert.ok(plan.rect.top + plan.rect.height <= phone.chat!.top, "entirely above the conversation window");
  for (const control of phone.controls) assert.equal(overlaps(plan.rect, control), false, "never covers a control");
});

test("on a cramped panel she peeks over the window instead of standing in the transcript", () => {
  const cramped: SpaceLayout = {
    viewport: { width: 328, height: 528 },
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    chat: { left: 8, top: 107, width: 312, height: 329 },
    panels: [],
    composer: { left: 9, top: 366, width: 310, height: 70 },
    controls: [],
    reducedMotion: false,
  };
  const plan = planPresence(cramped, intent());
  assert.equal(plan.hidden, false);
  assert.equal(plan.state, "peeking");
  assert.equal(overlaps(plan.rect, cramped.chat!, 0), false, "outside the chat window, not over its text");
  assert.equal(overlaps(plan.rect, cramped.composer!, 0), false);
});

test("on a desktop she stands beside the conversation", () => {
  const plan = planPresence(desktop, intent());
  assert.equal(plan.hidden, false);
  assert.equal(plan.reason, "beside the conversation");
  assert.equal(plan.edge, "right");
  assert.ok(plan.rect.left >= desktop.chat!.left + desktop.chat!.width, "to the right of the chat");
  assert.equal(overlaps(plan.rect, desktop.composer!, 0), false);
});

test("while demonstrating she is placed beside the panel being shown, not the chat", () => {
  const panel = { left: 520, top: 90, width: 640, height: 500 };
  const space: SpaceLayout = { ...desktop, panels: [panel] };
  const plan = planPresence(space, intent({ demonstrating: true }));
  assert.equal(plan.state, "demonstrating");
  assert.equal(plan.reason, "beside the demonstration");
  assert.ok(plan.rect.left >= 520, "on the demonstration side of the screen");
  assert.equal(plan.posture, "lean", "she leans toward what is happening");
});

test("with nothing open she rests at the edge, quietly", () => {
  const space: SpaceLayout = { ...desktop, chat: null, composer: null, controls: [] };
  const plan = planPresence(space, intent({ mode: "ambient", chatOpen: false }));
  assert.equal(plan.hidden, false);
  assert.equal(plan.state, "resting");
  assert.ok(plan.opacity < 1, "ambient presence is quieter");
});

test("a viewport that cannot hold her without covering controls hides her", () => {
  const tiny: SpaceLayout = { ...desktop, viewport: { width: 280, height: 400 } };
  const plan = planPresence(tiny, intent());
  assert.equal(plan.hidden, true);
  assert.equal(plan.opacity, 0);
  assert.equal(plan.durationMs, 0);
});

test("when the only free space is covered by a control, she retreats instead", () => {
  const space: SpaceLayout = {
    viewport: { width: 390, height: 844 },
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    chat: null,
    panels: [],
    composer: null,
    controls: [{ left: 0, top: 600, width: 390, height: 244 }],
    reducedMotion: false,
  };
  const plan = planPresence(space, intent({ mode: "companion", chatOpen: false }));
  assert.equal(plan.hidden, true, "she does not sit on the dock");
});

test("reduced motion removes travel, not the placement", () => {
  const plan = planPresence({ ...desktop, reducedMotion: true }, intent());
  assert.equal(plan.hidden, false);
  assert.equal(plan.transform, "none");
  assert.equal(plan.durationMs, 0);
});

test("states come from real app state, in order of what is most visible", () => {
  assert.equal(spatialStateFor(intent({ demonstrating: true, speaking: true })), "demonstrating");
  assert.equal(spatialStateFor(intent({ speaking: true })), "speaking");
  assert.equal(spatialStateFor(intent({ speaking: true, mode: "companion" })), "observing");
  assert.equal(spatialStateFor(intent({ listening: true })), "listening");
  assert.equal(spatialStateFor(intent({ toolActive: true, workspaceOpen: true })), "climbing");
  assert.equal(spatialStateFor(intent({ toolActive: true })), "observing");
  assert.equal(spatialStateFor(intent({ workspaceOpen: true })), "leaning");
  assert.equal(spatialStateFor(intent({ mode: "ambient" })), "resting");
  assert.equal(spatialStateFor(intent({ chatOpen: false, mode: "companion" })), "idle");
});

test("presence mode follows the conversation, the workspace, then quiet", () => {
  assert.equal(presenceModeFor({ chatOpen: true, workspaceOpen: false, turnActive: true, dialogue: "listening" }), "interactive");
  assert.equal(presenceModeFor({ chatOpen: true, workspaceOpen: false, turnActive: false, dialogue: "listening" }), "interactive");
  assert.equal(presenceModeFor({ chatOpen: true, workspaceOpen: false, turnActive: false, dialogue: "idle" }), "companion");
  assert.equal(presenceModeFor({ chatOpen: false, workspaceOpen: true, turnActive: false, dialogue: "idle" }), "companion");
  assert.equal(presenceModeFor({ chatOpen: false, workspaceOpen: false, turnActive: false, dialogue: "idle" }), "ambient");
});

test("her box is never large enough to become the interface", () => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    for (const mode of ["ambient", "companion", "interactive"] as const) {
      const size = sizeFor(mode, { width, height: 844 });
      assert.ok(size.width <= width * 0.42, `${mode} at ${width}px stays a minority of the width`);
      assert.ok(size.height <= 422, `${mode} at ${width}px stays under half the height`);
    }
  }
});

test("every legal placement is inside the viewport and clear of the composer", () => {
  const spaces: SpaceLayout[] = [phone, desktop, { ...desktop, panels: [{ left: 420, top: 80, width: 520, height: 460 }] }];
  for (const space of spaces) {
    for (const mode of ["ambient", "companion", "interactive"] as const) {
      const plan = planPresence(space, intent({ mode }));
      if (plan.hidden) continue;
      assert.ok(plan.rect.left >= space.safe.left);
      assert.ok(plan.rect.top >= space.safe.top);
      assert.ok(plan.rect.left + plan.rect.width <= space.viewport.width - space.safe.right + 0.001);
      if (space.composer) assert.equal(overlaps(plan.rect, space.composer, 0), false);
    }
  }
});

test("identical readings are recognised as the same space", () => {
  assert.equal(sameSpace(phone, { ...phone }), true);
  assert.equal(sameSpace(phone, { ...phone, viewport: { width: 391, height: 844 } }), false);
});
