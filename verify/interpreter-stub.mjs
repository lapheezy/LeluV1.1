/**
 * A local OpenAI-compatible endpoint used ONLY for verification.
 *
 * IMPORTANT — what this does and does not prove.
 *
 * No real LLM is reachable in this environment (GitHub Models is in a
 * retirement brownout; no other provider key is present). This stands in
 * for the model so the CONTRACT and the CONTROL FLOW can be verified:
 * that cognition is consulted before any parser, that its decision is
 * what writes project state, that references are resolved from the real
 * conversation the interpreter was handed, and that an unresolvable
 * reference produces a clarifying question instead of a garbage record.
 *
 * It does NOT prove the reasoning quality of a real model. Everything it
 * returns is derived from the conversation text it is given in the
 * prompt — nothing about pendants, metals or platinum is hardcoded.
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.STUB_PORT || 8899);
const LOG = process.env.STUB_LOG || "/tmp/provider-stub-calls.json";
const calls = [];

/* ------------------------- prompt parsing ------------------------- */

function parseProjects(prompt) {
  const block = prompt.split("LÉLU'S CURRENT PROJECTS:")[1]?.split("RECENT CONVERSATION")[0] ?? "";
  const projects = [];
  for (const line of block.split("\n")) {
    const m = line.match(/id=(\S+)\s+\|\s+name="([^"]*)"\s+\|\s+status=(\S+)\s+\|\s+objective="([^"]*)"/);
    if (m) projects.push({ id: m[1], name: m[2], status: m[3], objective: m[4] });
  }
  return projects;
}

function parseTurns(prompt) {
  const block = prompt.split("RECENT CONVERSATION (oldest first):")[1]?.split("LATEST USER MESSAGE:")[0] ?? "";
  return block
    .split("\n")
    .map((l) => l.match(/^(USER|ASSISTANT):\s*(.*)$/))
    .filter(Boolean)
    .map((m) => ({ role: m[1].toLowerCase(), text: m[2] }));
}

function parseLatest(prompt) {
  return (prompt.split("LATEST USER MESSAGE:")[1] ?? "").split("\n")[0].trim();
}

/* --------------------- generic reference resolution --------------- */

/** The most recent value the user ASSIGNED, e.g. "use platinum" -> platinum. */
function lastAssignedValue(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role !== "user") continue;
    const m = turns[i].text.match(/^(?:use|switch to|change to|go with|let'?s use)\s+(.+?)[.!]?$/i);
    if (m) return m[1].trim();
    // "platinum supersedes rose gold" — the superseding value wins.
    const sup = turns[i].text.match(/(.+?)\s+supersedes\s+(.+?)[.!]?$/i);
    if (sup) return sup[1].replace(/^(?:actually|no),?\s*/i, "").trim();
  }
  return null;
}

/** The subject the user introduced, e.g. "an idea for a pendant collection". */
function introducedSubject(turns, latest) {
  const all = [...turns.filter((t) => t.role === "user").map((t) => t.text), latest];
  for (let i = all.length - 1; i >= 0; i--) {
    const m =
      all[i].match(/idea for (?:a|an|the)\s+(.+?)[.!]?$/i) ||
      all[i].match(/(?:i want|i'd like|let'?s (?:do|make|build))\s+(?:a|an|the)\s+(.+?)[.!]?$/i) ||
      all[i].match(/(?:continue|resume)\s+(?:the\s+)?(.+?)[.!]?$/i);
    if (m) return m[1].trim();
  }
  return null;
}

function titleFor(subject) {
  if (!subject) return null;
  return subject
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function decide(prompt) {
  const projects = parseProjects(prompt);
  const turns = parseTurns(prompt);
  const latest = parseLatest(prompt);
  const lower = latest.toLowerCase();

  const deictic = latest.match(/\bthat\s+(\w+)\b/i);
  const resolved = {};
  let unresolved = null;

  if (deictic) {
    const value = lastAssignedValue(turns);
    if (value) resolved[`that ${deictic[1]}`] = value;
    else unresolved = `that ${deictic[1]}`;
  }

  const target = projects.find((p) => p.status !== "archived");
  const isModification =
    /\b(make|add|change|update|expand|extend|larger|bigger|more|start working|continue|resume)\b/i.test(lower);
  const setsAttribute = /^(?:use|switch to|change to|go with|let'?s use)\b/i.test(lower);

  // A reference that cannot be grounded is a question, never a guess.
  if (unresolved && !target) {
    return {
      action: "clarify",
      question: `You mentioned "${unresolved}" — which one do you mean? I don't have it from our conversation yet.`,
      reasoning: `No prior turn assigned a value for "${unresolved}".`,
    };
  }

  if (target && (isModification || setsAttribute || deictic)) {
    const tasks = [];
    const addN = latest.match(/add\s+(\w+)\s+(?:more\s+)?(\w+)/i);
    if (addN) tasks.push(`Add ${addN[1]} ${addN[2]}`);
    if (/\b(larger|bigger|expand|extend)\b/i.test(lower)) tasks.push("Increase the scope of the collection");
    if (/start working/i.test(lower)) tasks.push("Begin execution");

    const attributes = {};
    if (setsAttribute) {
      const v = latest.replace(/^(?:use|switch to|change to|go with|let'?s use)\s+/i, "").replace(/[.!]$/, "").trim();
      if (v) attributes.material = v;
    }
    for (const [k, v] of Object.entries(resolved)) attributes[k.replace(/^that\s+/, "")] = v;

    return {
      action: "update",
      projectId: target.id,
      execute: /\b(start working|run it|go ahead|begin now|get started)\b/i.test(lower),
      objective: target.objective || undefined,
      tasks,
      attributes: Object.keys(attributes).length ? attributes : undefined,
      resolvedReferences: Object.keys(resolved).length ? resolved : undefined,
      reasoning: `Refers to the existing project "${target.name}".`,
    };
  }

  const subject = introducedSubject(turns, latest);
  if (subject) {
    return {
      action: "create",
      name: titleFor(subject),
      objective: `Develop ${subject}.`,
      tasks: [`Define the scope of ${subject}`],
      resolvedReferences: Object.keys(resolved).length ? resolved : undefined,
      reasoning: "A new piece of work was introduced.",
    };
  }

  return { action: "none", reasoning: "Not a project instruction." };
}

/* ------------------------------ server ---------------------------- */

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }

  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* recorded as unparsed */ }
    const messages = parsed?.messages ?? [];
    const prompt = messages.map((m) => m.content).join("\n");
    const isProjectDecision = /Return the JSON decision|You interpret a user's project request/.test(prompt);

    let content;
    if (isProjectDecision) {
      content = JSON.stringify(decide(prompt));
    } else {
      const lines = prompt.split("\n").filter((l) => l.trim().startsWith("- "));
      content = [
        `ANSWER: The evidence establishes ${lines.length} observation(s).`,
        "CONFIDENCE: tested — taken from the attached evidence.",
        "NEXT: What evidence would settle this question?",
      ].join("\n");
    }

    calls.push({
      at: Date.now(),
      kind: isProjectDecision ? "project-decision" : "reasoning",
      roles: messages.map((m) => m.role),
      promptChars: prompt.length,
      latest: isProjectDecision ? parseLatest(prompt) : undefined,
      decision: isProjectDecision ? content : undefined,
    });
    try { writeFileSync(LOG, JSON.stringify(calls, null, 2)); } catch { /* best effort */ }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: `stub-${calls.length}`,
      object: "chat.completion",
      model: parsed?.model ?? "stub",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: 40, total_tokens: 0 },
    }));
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[interpreter-stub] listening on http://127.0.0.1:${PORT} (log: ${LOG})`);
});
