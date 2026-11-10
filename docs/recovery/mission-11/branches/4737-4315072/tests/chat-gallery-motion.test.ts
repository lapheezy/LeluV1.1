/**
 * ==========================================================
 * LÉLU — CHAT GALLERY MOTION
 *
 * CATEGORY: source-level guarantees. The gallery has to feel alive
 * without animating a hundred cards at full intensity, and it must
 * stop moving for anyone who asked it to. Those are properties of
 * the stylesheet and the open transition, so they are asserted
 * against the real files rather than described in prose.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/scene/genesis/chat/chatGallery.css", "utf8");
const gallery = readFileSync("src/app/scene/genesis/chat/ChatGallery.tsx", "utf8");

test("the library arrives in layers: shell, controls, then cards", () => {
  assert.match(css, /\.lelu-ccg \{[^}]*animation: lelu-ccg-shell/);
  assert.match(css, /\.lelu-ccg-head \{ animation: lelu-ccg-rise/);
  assert.match(css, /\.lelu-ccg-search \{ animation: lelu-ccg-rise/);
  assert.match(css, /\.lelu-ccg-filters \{ animation: lelu-ccg-rise/);
  assert.match(css, /@keyframes lelu-ccg-shell/);
  assert.match(css, /@keyframes lelu-ccg-card-in/);
});

test("cards stagger, and the stagger is bounded", () => {
  assert.match(css, /animation-delay: calc\(var\(--ccg-i, 0\) \* 26ms\)/);
  assert.match(gallery, /"--ccg-i": index/);
  assert.match(gallery, /Math\.min\(cardIndex, MAX_STAGGER\)/, "a big library does not wait a second to appear");
  assert.match(gallery, /cardIndex \+= 1/, "the stagger runs across sections, pinned first");
});

test("the entrance cannot fight the press transform", () => {
  assert.match(
    css,
    /animation: lelu-ccg-card-in 230ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) backwards/,
    "backwards fill leaves no animation transform once it is over",
  );
  assert.match(css, /\.lelu-ccg-card:active \{ transform: scale\(0\.972\)/);
  assert.match(
    css,
    /\.lelu-ccg-grid:has\(\.lelu-ccg-card:active\) \.lelu-ccg-card:not\(:active\)/,
    "the pressed tile's neighbours recede",
  );
});

test("a chosen card grows into the conversation, and the open is deferred", () => {
  assert.match(css, /\.lelu-ccg-card\.is-chosen \{[^}]*transform: scale\(1\.035\)/);
  assert.match(css, /\.lelu-ccg\.is-leaving \{ opacity: 0/);
  assert.match(gallery, /data-lelu-gallery-leaving/);
  assert.match(gallery, /setLeaving\(id\)/);
  assert.match(gallery, /window\.setTimeout\(\(\) => onOpen\(id\), OPEN_TRANSITION_MS\)/);
  assert.match(gallery, /if \(prefersReducedMotion\(\)\) \{[\s\S]{0,80}onOpen\(id\)/, "reduced motion opens immediately");
});

test("only pinned, working and unread cards animate while idle", () => {
  assert.match(css, /\.lelu-ccg-card\.is-pinned::after/);
  assert.match(css, /\.lelu-ccg-card\.is-unread \.lelu-ccg-badge\.is-unread \{ animation: lelu-ccg-unread/);
  assert.match(css, /\.lelu-ccg-badge\.is-working::before/);
  assert.match(gallery, /card\.processing \? "is-working" : ""/, "the working class follows the store's processing state");
  assert.match(gallery, /card\.unread > 0 \? "is-unread" : ""/, "and the unread class follows unread state");
});

test("the gallery remembers where it was and which card was opened", () => {
  assert.match(gallery, /galleryMemory/);
  assert.match(gallery, /element\.scrollTop = galleryMemory\.scrollTop/, "returning lands where the user left it");
  assert.match(gallery, /galleryMemory\.lastOpenedId = id/);
  assert.match(gallery, /data-lelu-gallery-chosen/, "the last opened card stays identifiable");
});

test("search and filter results transition rather than snapping", () => {
  assert.match(css, /\.lelu-ccg-body \{ animation: lelu-ccg-results/);
  assert.match(gallery, /key=\{`\$\{filter\}:\$\{query\}`\}/, "changing the view animates the new results in");
});

test("reduced motion replaces movement with state, not with nothing", () => {
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(block, /\.lelu-ccg-card,/);
  assert.match(block, /animation: none/);
  assert.match(block, /\.lelu-ccg-card\.is-chosen \{ transform: none; \}/);
  assert.match(block, /transition: opacity 120ms ease, border-color 120ms ease/);
});

test("motion is transforms and opacity, not layout", () => {
  const keyframes = css.match(/@keyframes[\s\S]*?}\s*}/g) ?? [];
  assert.ok(keyframes.length >= 5, "the gallery has its own keyframes");
  for (const frame of keyframes) {
    assert.ok(
      !/(^|\s)(width|height|top|left|margin)\s*:/.test(frame),
      `keyframes animate transform/opacity only: ${frame.slice(0, 40)}`,
    );
  }
});
