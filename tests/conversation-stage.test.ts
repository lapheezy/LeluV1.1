import test from "node:test";
import assert from "node:assert/strict";
import { buildStage, gistOf, slidesOf } from "../src/app/scene/genesis/chat/stage/conversationModel";

const messages = [
  { id: "u1", role: "user" as const, text: "Research how deep-sea creatures make light" },
  { id: "a1", role: "assistant" as const, text: "## How it glows\nAbout **76%** glow. See [NOAA](https://oceanexplorer.noaa.gov/x).\n\n![Jellyfish](/universe/jellyfish.webp)\n\n## Why\n1. Lures\n2. Alarms https://en.wikipedia.org/wiki/Bioluminescence" },
  { id: "u2", role: "user" as const, text: "Compare them" },
  { id: "a2", role: "assistant" as const, text: "Both use blue light.\n\n![Galaxy](/universe/galaxy.webp)" },
  { id: "u3", role: "user" as const, text: "And plankton?" },
];

test("a conversation becomes turns, sections, media and sources — from the stored text only", () => {
  const stage = buildStage("Deep sea", messages);
  assert.equal(stage.turns.length, 3);
  assert.deepEqual(stage.turns[0].sections.map((s) => s.heading), ["How it glows", "Why"]);
  assert.deepEqual(stage.media.map((m) => m.src), ["/universe/jellyfish.webp", "/universe/galaxy.webp"]);
  assert.deepEqual(stage.links.map((l) => l.label), ["NOAA", "en.wikipedia.org"]);
  assert.equal(stage.turns[2].answerId, null, "an unanswered question is still a turn");
  assert.ok(!stage.turns[0].sections[0].text.includes("!["), "section text is free of image markdown");
});

test("gists and slides", () => {
  assert.equal(gistOf("## T\nFirst sentence here. Second one."), "First sentence here.");
  const slides = slidesOf(buildStage("Deep sea", messages));
  assert.equal(slides[0].kind, "title");
  assert.ok(slides.some((s) => s.kind === "question" && s.heading.startsWith("Compare")));
  assert.equal(slides.filter((s) => s.kind === "section").length, 3);
});
