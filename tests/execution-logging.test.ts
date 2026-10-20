/**
 * ==========================================================
 * LÉLU — EXECUTION LOGGING OUTSIDE A BROWSER
 *
 * CATEGORY: unit. The real ExecutionLogger, with console
 * captured.
 *
 * The property being pinned: printing a log line never costs
 * the result of the test that printed it.
 *
 * Measured, and this is the whole reason the file exists:
 * tests/provider-fallback-cognition.test.ts failed at FILE
 * level in roughly half its runs with "Unable to deserialize
 * cloned data due to invalid or unsupported version", thrown
 * inside the node:test runner's own stream parser. Every one of
 * its five assertions passed; the result was simply unreadable,
 * so the suite reported a failure that pointed at nothing.
 *
 * The cause was this logger's output. Under `node --test` the
 * child reports results to the runner as framed binary messages
 * interleaved with console output, and two things in the output
 * mis-framed it: console.table's box drawing, and the 🟢/🔴
 * markers. Measured one variable at a time — table silenced: 0
 * failures in 6 runs. Table fixed, markers left: 2 in 8. Both
 * fixed: 0 in 10.
 *
 * Both were browser devtools affordances. In devtools a
 * collapsed group, a table and a coloured dot are all real; in
 * Node they are ASCII art, a flat list and a hazard. Nothing is
 * logged in one case and withheld in the other — only the shape
 * differs, and these pin that.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ExecutionLogger from "../src/core/ExecutionLogger";

/** Everything the logger wrote, with console put back afterwards. */
function captured(body: () => void): string[] {
  const lines: string[] = [];
  const saved = {
    log: console.log,
    table: console.table,
    group: console.groupCollapsed,
    groupEnd: console.groupEnd,
  };
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  console.table = (...args: unknown[]) => { lines.push(`TABLE ${args.map((a) => JSON.stringify(a)).join(" ")}`); };
  console.groupCollapsed = (...args: unknown[]) => { lines.push(`GROUP ${args.map(String).join(" ")}`); };
  console.groupEnd = () => { lines.push("GROUPEND"); };
  try {
    body();
  } finally {
    console.log = saved.log;
    console.table = saved.table;
    console.groupCollapsed = saved.group;
    console.groupEnd = saved.groupEnd;
  }
  return lines;
}

/** Run `body` with the globals a browser would have, then restore them. */
function asBrowser(body: () => void): void {
  const runtime = globalThis as Record<string, unknown>;
  const hadDocument = "document" in runtime;
  const savedDocument = runtime.document;
  const hadWindow = "window" in runtime;
  const savedWindow = runtime.window;
  runtime.document = { title: "test" };
  runtime.window = runtime;
  try {
    body();
  } finally {
    if (hadDocument) runtime.document = savedDocument;
    else delete runtime.document;
    if (hadWindow) runtime.window = savedWindow;
    else delete runtime.window;
  }
}

const logger = new ExecutionLogger();

test("outside a browser every line is plain ASCII", () => {
  const lines = captured(() => {
    logger.info("ProviderResolver", "Trying Tooler", { provider: "Tooler", priority: 1 });
    logger.error("ProviderResolver", "Tooler failed; falling back", { latencyMs: 3 });
  });
  assert.ok(lines.length > 0, "the logger wrote nothing at all");
  for (const line of lines) {
    // eslint-disable-next-line no-control-regex
    assert.ok(
      /^[\x20-\x7E]*$/.test(line),
      `a non-ASCII byte in log output mis-frames the node:test reporter: ${JSON.stringify(line)}`,
    );
  }
});

test("outside a browser it uses neither a group nor a table", () => {
  const lines = captured(() => {
    logger.info("Stage", "message", { a: 1 });
  });
  assert.ok(!lines.some((line) => line.startsWith("TABLE")), "console.table outside a browser is ASCII box art");
  assert.ok(!lines.some((line) => line.startsWith("GROUP")), "an uncollapsible group is not a group");
});

test("nothing is withheld: the stage, the message and the metadata all still appear", () => {
  const lines = captured(() => {
    logger.info("ProviderResolver", "Trying Tooler", { provider: "Tooler", priority: 1 });
  });
  const all = lines.join("\n");
  assert.match(all, /ProviderResolver/);
  assert.match(all, /Trying Tooler/);
  assert.match(all, /"priority":1/, "metadata must survive the plain-text shape");
});

test("a failure is still unmistakably a failure without the coloured dot", () => {
  const lines = captured(() => {
    logger.error("ProviderResolver", "Tooler failed", {});
  });
  assert.match(lines.join("\n"), /^FAIL\b/m);
  const ok = captured(() => {
    logger.info("ProviderResolver", "Trying Tooler", {});
  });
  assert.match(ok.join("\n"), /^OK\b/m);
});

test("in a browser the devtools affordances are still used", () => {
  // The plain shape is for Node, not a downgrade everywhere: a devtools
  // console renders the group and the table, which is why they are there.
  let lines: string[] = [];
  asBrowser(() => {
    lines = captured(() => {
      logger.info("Stage", "message", { a: 1 });
    });
  });
  assert.ok(lines.some((line) => line.startsWith("GROUP")), "a browser lost its collapsed group");
  assert.ok(lines.some((line) => line.startsWith("TABLE")), "a browser lost its table");
  assert.match(lines.join("\n"), /🟢/, "a browser lost the marker that reads at a glance");
});

test("the shape is chosen by a real document, not by the methods existing", () => {
  // Node defines console.table too, which is exactly how this went
  // unnoticed for as long as it did.
  const source = readFileSync("src/core/ExecutionLogger.ts", "utf8");
  assert.match(source, /typeof candidate\.document !== "undefined"/);
});
