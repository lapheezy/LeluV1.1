/**
 * A local OpenAI-compatible chat-completions endpoint used ONLY by the
 * integration verification.
 *
 * This is NOT another provider system. It is a server that an EXISTING,
 * already-registered provider (GitHubModelsProvider) is pointed at with
 * the existing VITE_AI_PROXY_BASE_URL setting, so the real path can be
 * exercised end to end without a paid API key:
 *
 *   cognition → AIRuntime.reason → ProviderResolver → AIProviderRegistry
 *             → GitHubModelsProvider → HTTP → response → cognition → memory
 *
 * It records every request it receives so the test can prove the call
 * genuinely left the app and came back through the provider chain.
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.STUB_PORT || 8899);
const LOG = process.env.STUB_LOG || "/tmp/provider-stub-calls.json";

const calls = [];

createServer((req, res) => {
  // The browser calls this cross-origin from the Vite dev origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* recorded as unparsed */ }

    const prompt = parsed?.messages?.map((m) => m.content).join("\n") ?? "";
    calls.push({
      at: Date.now(),
      model: parsed?.model,
      // Proof the request carried the Authorization header the provider
      // builds. The value itself is never recorded.
      authorizationPresent: Boolean(req.headers.authorization),
      messageCount: parsed?.messages?.length ?? 0,
      promptChars: prompt.length,
      // Proof that real evidence from the investigation reached the model.
      mentionsEvidence: /INVESTIGATION|evidence/i.test(prompt),
      mentionsDevelopmentRuntime: /REAL DEVELOPMENT RUNTIME/i.test(prompt),
      questionLine: (prompt.match(/QUESTION I AM INVESTIGATING: (.+)/) ?? [])[1] ?? null,
    });
    try { writeFileSync(LOG, JSON.stringify(calls, null, 2)); } catch { /* best effort */ }

    // A well-formed evaluation in the exact shape cognition asks for.
    //
    // The NEXT line is DERIVED FROM THE EVIDENCE IN THIS REQUEST, never
    // from a template: it names a concrete referent that only appears
    // because the investigation actually found it (a real local import,
    // a real exported symbol, or a real failure line). A canned NEXT
    // would make the next objective causally unrelated to the result,
    // which is precisely what must not be provable this way.
    const evidenceLines = prompt
      .split("\n")
      .filter((l) => l.trim().startsWith("- "))
      .map((l) => l.replace(/^\s*-\s*/, ""));

    const importMatch = prompt.match(/Local imports:\s*([^\n]+)/);
    const exportMatch = prompt.match(/Exports:\s*([^\n]+)/);
    const failureLine = evidenceLines.find((l) => /\b(fail|failed|error|unreachable|missing|cannot)\b/i.test(l));

    // Only identifier-shaped referents: a path, a symbol, a subsystem
    // id. A competent model names a thing, not a whole sentence, and a
    // stand-in that splices prose here would only be testing the
    // engine's noise filter rather than the causal chain.
    const identifierLike = (s) =>
      typeof s === "string" &&
      s.length > 2 &&
      s.length < 60 &&
      !/[.!?]\s/.test(s) &&
      !/:\s/.test(s) &&
      /^[\w@./~-]+$/.test(s.trim());

    let referent = null;
    let referentSource = null;
    if (importMatch && !/^none/i.test(importMatch[1].trim())) {
      const c = importMatch[1].split(",")[0].trim();
      if (identifierLike(c)) { referent = c; referentSource = "local import named in the evidence"; }
    }
    if (!referent && exportMatch && !/^none/i.test(exportMatch[1].trim())) {
      const c = exportMatch[1].split(",")[0].trim().split(" ").pop();
      if (identifierLike(c)) { referent = c; referentSource = "exported symbol named in the evidence"; }
    }
    if (!referent && failureLine) {
      const c = (failureLine.match(/([\w.-]+)\s+(?:failed|is unreachable|missing)/i) ?? [])[1];
      if (identifierLike(c)) { referent = c; referentSource = "failing component named in the evidence"; }
    }
    if (!referent) {
      const c = (prompt.match(/\b(src\/[\w./-]+\.ts)\b/) ?? [])[1];
      if (identifierLike(c)) { referent = c; referentSource = "source path named in the evidence"; }
    }

    calls[calls.length - 1].derivedReferent = referent;
    calls[calls.length - 1].derivedReferentSource = referentSource;
    try { writeFileSync(LOG, JSON.stringify(calls, null, 2)); } catch { /* best effort */ }

    const content = [
      `ANSWER: The evidence establishes ${evidenceLines.length} observation(s) about this question${
        referent ? `, centred on ${referent}` : ""
      }.`,
      "CONFIDENCE: tested — every statement above is taken from the attached investigation evidence.",
      referent
        ? `NEXT: What role does ${referent} play here?`
        : "NEXT: What evidence would settle this question?",
    ].join("\n");

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: `stub-${calls.length}`,
      object: "chat.completion",
      model: parsed?.model ?? "stub",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: 32, total_tokens: Math.ceil(prompt.length / 4) + 32 },
    }));
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[provider-stub] listening on http://127.0.0.1:${PORT} (log: ${LOG})`);
});
