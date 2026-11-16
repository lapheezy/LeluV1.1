import test from "node:test";
import assert from "node:assert/strict";
import { ensureCryptoRandomUUID } from "../src/core/env/cryptoRandomUUID";

// The failure this guards: over plain HTTP (a phone on the LAN, an embedded
// webview) `crypto.randomUUID` does not exist, and the first engine to need an
// id threw during boot, leaving an empty #root and a white page.

test("installs a v4 randomUUID when the platform leaves it out", () => {
  // Two calls must differ, so the bytes have to advance between them.
  let draw = 0;
  const insecure: {
    randomUUID?: () => string;
    getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
  } = {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      draw += 1;
      const view = new Uint8Array(array.buffer as ArrayBuffer, (array as Uint8Array).byteOffset, (array as Uint8Array).byteLength);
      for (let i = 0; i < view.length; i += 1) view[i] = (i * 37 + 11 + draw * 97) & 0xff;
      return array;
    },
  };

  assert.equal(ensureCryptoRandomUUID(insecure), true);
  const first = insecure.randomUUID!();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // Distinct calls must not collide — the id is used for messages and exchanges.
  assert.notEqual(first, insecure.randomUUID!());
});

test("leaves a native implementation alone", () => {
  const native = () => "native-id";
  const crypto = { randomUUID: native };
  assert.equal(ensureCryptoRandomUUID(crypto), true);
  assert.equal(crypto.randomUUID, native);
  assert.equal(crypto.randomUUID(), "native-id");
});

test("still works without getRandomValues, so old webviews boot", () => {
  const bare: { randomUUID?: () => string } = {};
  assert.equal(ensureCryptoRandomUUID(bare), true);
  assert.match(bare.randomUUID!(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
