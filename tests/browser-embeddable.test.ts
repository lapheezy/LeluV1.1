import test from "node:test";
import assert from "node:assert/strict";
import { embeddableFrom } from "../plugins/safeFetch";

test("embedding verdict from X-Frame-Options and CSP frame-ancestors (headers never leave the server)", () => {
  assert.equal(embeddableFrom("", ""), true);
  assert.equal(embeddableFrom("DENY", ""), false);
  assert.equal(embeddableFrom("sameorigin", ""), false);
  assert.equal(embeddableFrom("", "default-src 'self'; frame-ancestors 'none'"), false);
  assert.equal(embeddableFrom("", "frame-ancestors 'self' *.wikipedia.org"), false);
  assert.equal(embeddableFrom("", "frame-ancestors *"), true);
  assert.equal(embeddableFrom("", "script-src 'self'"), true);
});
