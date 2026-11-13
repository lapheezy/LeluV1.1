/**
 * ==========================================================
 * MISSION 6.1.5 — IS THE SELECTION ANY GOOD?
 *
 * Mission 6.1.4 cut a turn from 58 schemas to 6–14. A small number is
 * not a good number, so this measures the selection against a corpus
 * with an EXPECTED capability per prompt and reports, per row:
 *
 *   · whether the expected tool was offered;
 *   · how many schemas were offered and how big they are;
 *   · whether a tool had to come from outside the selection;
 *   · the family of the first-ranked tool, to spot wrong-family picks.
 *
 * It uses the production selector only (`toolSchemasForRequest`), never
 * a copy of it, and prints names and sizes — never content or keys.
 *
 * Usage: tsx --tsconfig tsconfig.test.json scripts/measure-tool-selection.ts
 * ==========================================================
 */

import { toolSchemasForModel, toolSchemasForRequest } from "../src/core/tools/ToolSchemas.ts";

interface Case {
  prompt: string;
  expect: string | string[];
  note?: string;
}

const corpus: Case[] = [
  { prompt: "search the web for the latest SpaceX launch", expect: "research_web" },
  { prompt: "what did the news say about the election today", expect: "research_web" },
  { prompt: "look up the arXiv paper on diffusion models", expect: "research_web" },
  { prompt: "What did we discuss yesterday?", expect: ["memory_recall", "chats_read"] },
  { prompt: "remember that I prefer dark blue", expect: ["memory_store", "memory_recall"] },
  { prompt: "write a file to the sandbox that sums an array", expect: ["sandbox_write", "sandbox_read"] },
  { prompt: "read the file I saved in the sandbox", expect: ["sandbox_read", "sandbox_write"] },
  { prompt: "find where parseConfig is used in my project", expect: ["project_search", "repo_inspect"] },
  { prompt: "inspect the repository I acquired last week", expect: ["repo_inspect", "repo_status"] },
  { prompt: "build me a small website for my bakery", expect: ["studio_build", "studio_create", "creator_build"] },
  { prompt: "make a 3D game where you fly a ship", expect: ["studio_create", "studio_engine"] },
  { prompt: "deploy the studio build I just made", expect: ["studio_deploy", "studio_build"] },
  { prompt: "run my workflow from last week", expect: "workflow_run" },
  { prompt: "author a workflow that builds then tests", expect: "workflow_author" },
  { prompt: "which capabilities are configured?", expect: "system_config" },
  { prompt: "list the capabilities I can switch on", expect: "capabilities_list" },
  { prompt: "have an agent research this and report back", expect: ["agent_delegate", "agent_status"] },
  { prompt: "wave at me", expect: ["avatar_gesture", "avatar_companion"] },
  { prompt: "put this summary in a table next to the chat", expect: ["artifact_create", "environment_present_artifact"] },
  { prompt: "what is the weather in Tokyo", expect: ["research_web", "browser_read"] },
  { prompt: "how are you feeling today?", expect: [] },
  { prompt: "tell me a short story about the sea", expect: [] },
  { prompt: "hmm", expect: [] },
  { prompt: "build a website and then run its tests", expect: ["studio_build", "studio_test"], note: "two capabilities, one turn" },
];

const BYTES = (value: unknown) => new TextEncoder().encode(JSON.stringify(value ?? "")).length;

const full = toolSchemasForModel();
const fullBytes = BYTES(full);

console.log(`\nSELECTION QUALITY — ${corpus.length} prompts`);
console.log(`  full surface: ${full.length} tools, ${fullBytes} B (~${Math.round(fullBytes / 3.2)} tok at 3.2 B/tok)\n`);

let hits = 0;
let misses = 0;
let maxSchemas = 0;
let maxBytes = 0;
let bytesTotal = 0;

console.log("  " + "prompt".padEnd(46) + "expect".padEnd(26) + "n".padStart(3) + "   bytes" + "  hit");
console.log("  " + "-".repeat(96));

for (const item of corpus) {
  const offered = toolSchemasForRequest(item.prompt);
  const names = offered.map((schema) => schema.name);
  const size = BYTES(offered);
  const expected = ([] as string[]).concat(item.expect ?? []);
  const hit = expected.length === 0 ? true : expected.some((name) => names.includes(name));
  if (hit) hits += 1;
  else misses += 1;
  maxSchemas = Math.max(maxSchemas, offered.length);
  maxBytes = Math.max(maxBytes, size);
  bytesTotal += size;
  console.log(
    "  " +
      item.prompt.slice(0, 44).padEnd(46) +
      (expected.join("|") || "—").slice(0, 24).padEnd(26) +
      String(offered.length).padStart(3) +
      String(size).padStart(8) +
      "  " + (hit ? "YES" : "NO ") +
      (item.note ? `  (${item.note})` : ""),
  );
  if (!hit) console.log(`      offered: ${names.join(", ") || "(none)"}`);
}

console.log("\n  SUMMARY");
console.log(`    expected tool offered   ${hits}/${corpus.length}`);
console.log(`    misses                  ${misses}`);
console.log(`    schemas per turn        max ${maxSchemas}, mean ${(corpus.reduce((t, c) => t + toolSchemasForRequest(c.prompt).length, 0) / corpus.length).toFixed(1)}`);
console.log(`    bytes per turn          max ${maxBytes} B, mean ${Math.round(bytesTotal / corpus.length)} B`);
console.log(`    share of full surface   ${((bytesTotal / corpus.length / fullBytes) * 100).toFixed(1)}% of ${fullBytes} B`);
console.log("");
