/**
 * Firecrawl uses EVERY configured key: trimmed, rotated, and a key that is
 * out of credits / rate-limited / refused sits out while the next serves.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createFirecrawl, firecrawlKeys, FirecrawlError } from "../plugins/firecrawl";

const env = (vars: Record<string, string>) => (name: string) => vars[name];
const ok = (url: string) => new Response(JSON.stringify({ success: true, data: { markdown: "# Page\\nbody", metadata: { title: "T", sourceURL: url } } }), { status: 200 });

test("all keys are read, trimmed and de-duplicated", () => {
  const keys = firecrawlKeys(env({ FIRECRAWL_API_KEY: "fc-a", FIRECRAWL_API_KEY_2: " fc-b ", FIRECRAWL_API_KEY_3: "fc-c ", FIRECRAWL_API_KEY_4: "fc-a" }));
  assert.deepEqual(keys, ["fc-a", "fc-b", "fc-c"]);
});

test("a key out of credits is skipped and sits out; the next key serves", async () => {
  const used: string[] = [];
  const fake = (async (_u: unknown, init: RequestInit) => {
    const key = String((init.headers as Record<string, string>).Authorization).slice(7);
    used.push(key);
    return key === "fc-a" ? new Response('{"success":false,"error":"Insufficient credits"}', { status: 402 }) : ok("https://example.com/");
  }) as typeof fetch;
  let t = 0;
  const fc = createFirecrawl(env({ FIRECRAWL_API_KEY: "fc-a", FIRECRAWL_API_KEY_2: "fc-b", FIRECRAWL_API_KEY_3: "fc-c" }), fake, () => t);
  const first = await fc.scrape("https://example.com/");
  assert.equal(first.slot, 2);
  assert.equal(first.title, "T");
  // Later requests never retry the spent key while it cools down.
  used.length = 0;
  for (let i = 0; i < 4; i += 1) await fc.scrape("https://example.com/");
  assert.ok(!used.includes("fc-a"), `spent key reused: ${used.join(",")}`);
  assert.ok(used.includes("fc-b") && used.includes("fc-c"), "work is spread across the remaining keys");
  // After its cooldown it is tried again.
  t += 61 * 60_000;
  used.length = 0;
  for (let i = 0; i < 3; i += 1) await fc.scrape("https://example.com/");
  assert.ok(used.includes("fc-a"));
});

test("when every key refuses, the caller gets one clear error with the attempts (slots only)", async () => {
  const fake = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
  const fc = createFirecrawl(env({ FIRECRAWL_API_KEY: "fc-a", FIRECRAWL_API_KEY_2: "fc-b", FIRECRAWL_API_KEY_3: "fc-c" }), fake);
  await assert.rejects(fc.scrape("https://example.com/"), (e: unknown) => {
    assert.ok(e instanceof FirecrawlError);
    assert.deepEqual(e.attempts.map((a) => a.slot), [1, 2, 3]);
    assert.doesNotMatch(JSON.stringify(e.attempts) + e.message, /fc-[abc]/, "no key material in errors");
    return true;
  });
});

test("a page that fails on its own is not retried on other keys", async () => {
  let calls = 0;
  const fake = (async () => { calls += 1; return new Response('{"success":false,"error":"Site returned 404"}', { status: 400 }); }) as unknown as typeof fetch;
  const fc = createFirecrawl(env({ FIRECRAWL_API_KEY: "fc-a", FIRECRAWL_API_KEY_2: "fc-b" }), fake);
  await assert.rejects(fc.scrape("https://example.com/missing"), /404/);
  assert.equal(calls, 1);
});
