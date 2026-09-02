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

    // A well-formed evaluation in the exact shape cognition asks for, so
    // the ANSWER/CONFIDENCE/NEXT contract is exercised for real.
    const marker = `STUB-PROVIDER-CALL-${calls.length}`;
    const content = [
      `ANSWER: ${marker} — evaluated ${prompt.length} characters of investigation evidence supplied by cognition.`,
      "CONFIDENCE: tested — the evidence came from the investigation attached to this request.",
      `NEXT: Which subsystem depends most on ${marker}?`,
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
