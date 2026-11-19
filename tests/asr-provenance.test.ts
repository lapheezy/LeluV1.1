/**
 * ==========================================================
 * LÉLU — ASR PROVENANCE
 *
 * CATEGORY: unit. The real MemoryBridge, a recording brain.
 *
 * M22.5 found that voice transcripts carried no source or confidence, so a
 * remembered sentence could not be traced to the engine that heard it. The
 * voice engine now records a TranscriptProvenance on the turn and passes it
 * through `AIService.chat` to `MemoryBridge.learn`; this pins the last hop:
 * the provenance reaches the context the memory engine stores.
 *
 * Confidence is asserted ABSENT when the recogniser did not supply one. A
 * fabricated 0.9 would be worse than no number at all.
 */

import assert from "node:assert/strict";
import test from "node:test";

import MemoryBridge from "../src/core/MemoryBridge";

function bridge(): { bridge: MemoryBridge; stored: Array<Record<string, unknown>> } {
  const stored: Array<Record<string, unknown>> = [];
  const brain = {
    learn: async (
      _prompt: string,
      _response: string,
      _category: string,
      _keywords: string[],
      context: Record<string, unknown>,
    ) => {
      stored.push(context);
      return null;
    },
    recall: async () => [],
  };
  const user = { context: () => "" };
  return { bridge: new MemoryBridge(brain as never, user as never), stored };
}

test("a recognised transcript's engine is stored with the memory", async () => {
  const { bridge: memory, stored } = bridge();

  await memory.learn(
    "My project codename is FIELDNOTE and the archive migration depends on it.",
    "Noted.",
    "task-1",
    { transcriptSource: "groq-whisper", transcriptFinal: true, transcriptAt: 1_700_000_000_000 },
  );

  assert.equal(stored.length, 1);
  assert.equal(stored[0].transcriptSource, "groq-whisper");
  assert.equal(stored[0].transcriptFinal, true);
  assert.equal(stored[0].transcriptAt, 1_700_000_000_000);
});

test("confidence is stored only when the recogniser reported one", async () => {
  const { bridge: memory, stored } = bridge();

  await memory.learn(
    "My project codename is FIELDNOTE and the archive migration depends on it.",
    "Noted.",
    "task-2",
    { transcriptSource: "browser-recognition", transcriptFinal: true, transcriptAt: 1 },
  );
  assert.equal(
    "transcriptConfidence" in stored[0],
    false,
    "an absent confidence must not be invented",
  );

  await memory.learn(
    "My project codename is FIELDNOTE and the archive migration depends on it.",
    "Noted.",
    "task-3",
    { transcriptSource: "browser-recognition", transcriptFinal: true, transcriptAt: 2, transcriptConfidence: 0.82 },
  );
  assert.equal(stored[1].transcriptConfidence, 0.82);
});

test("typing a message carries no transcript provenance at all", async () => {
  const { bridge: memory, stored } = bridge();

  await memory.learn(
    "My project codename is FIELDNOTE and the archive migration depends on it.",
    "Noted.",
    "task-4",
  );

  assert.equal("transcriptSource" in stored[0], false);
  assert.equal("transcriptConfidence" in stored[0], false);
});
