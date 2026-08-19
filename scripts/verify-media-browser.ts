/**
 * Logic verification for the media-attachment pipeline and the
 * in-app browser tool added to the existing LÉLU architecture.
 *
 * DOM-bound parts (canvas downscaling, video frame capture) can't
 * run in this sandbox — the pure helpers (dimension math, default
 * prompts, display labels) and the browser tool's URL handling and
 * HTML extraction are verified here, including honest "blocked"
 * classification instead of fake success.
 */

import assert from "node:assert/strict";
import {
  defaultMediaPrompt,
  fitDimensions,
  mediaDisplayLabel,
  MAX_DIMENSION,
} from "../src/core/media/mediaProcessor";
import BrowserTool from "../src/core/browser/BrowserTool";

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log("Media processor (pure helpers)");

  await check("fitDimensions keeps small images unchanged", () => {
    assert.deepEqual(fitDimensions(400, 300), { width: 400, height: 300 });
  });

  await check("fitDimensions downscales by the longest side", () => {
    const result = fitDimensions(2560, 1440);
    assert.equal(result.width, MAX_DIMENSION);
    assert.equal(result.height, 720);
  });

  await check("fitDimensions guards zero dimensions", () => {
    assert.deepEqual(fitDimensions(0, 0), { width: 1, height: 1 });
  });

  await check("defaultMediaPrompt covers image-only attachments", () => {
    assert.match(defaultMediaPrompt([{ kind: "image", dataUrl: "data:", label: "a.png" }]), /image/i);
  });

  await check("defaultMediaPrompt covers video attachments", () => {
    assert.match(defaultMediaPrompt([{ kind: "video", dataUrl: "data:", label: "b.mp4" }]), /video/i);
  });

  await check("defaultMediaPrompt covers mixed attachments", () => {
    assert.match(
      defaultMediaPrompt([
        { kind: "image", dataUrl: "data:", label: "a.png" },
        { kind: "video", dataUrl: "data:", label: "b.mp4" },
      ]),
      /images\/videos/i,
    );
  });

  await check("mediaDisplayLabel names the single kind", () => {
    assert.equal(mediaDisplayLabel([{ kind: "image", dataUrl: "data:", label: "a.png" }]), "[Image attached]");
    assert.equal(mediaDisplayLabel([{ kind: "video", dataUrl: "data:", label: "b.mp4" }]), "[Video attached]");
  });

  await check("mediaDisplayLabel counts mixed attachments", () => {
    assert.equal(
      mediaDisplayLabel([
        { kind: "image", dataUrl: "data:", label: "a.png" },
        { kind: "image", dataUrl: "data:", label: "c.png" },
        { kind: "video", dataUrl: "data:", label: "b.mp4" },
      ]),
      "[2 images + 1 video attached]",
    );
  });

  console.log("BrowserTool — URL handling");

  await check("normalizeUrl accepts full URLs unchanged", () => {
    assert.equal(BrowserTool.normalizeUrl("https://example.com/a"), "https://example.com/a");
  });

  await check("normalizeUrl adds https to bare domains", () => {
    assert.equal(BrowserTool.normalizeUrl("example.com"), "https://example.com");
  });

  await check("normalizeUrl rejects plain words", () => {
    assert.equal(BrowserTool.normalizeUrl("hello there"), null);
  });

  await check("findUrl extracts the first URL from a message", () => {
    assert.equal(
      BrowserTool.findUrl("open https://wikipedia.org/wiki/Lelu for me"),
      "https://wikipedia.org/wiki/Lelu",
    );
  });

  await check("findUrl strips trailing punctuation", () => {
    assert.equal(BrowserTool.findUrl("see https://example.com/page."), "https://example.com/page");
  });

  await check("looksLikeBrowseRequest recognizes open+site phrasing", () => {
    assert.equal(BrowserTool.looksLikeBrowseRequest("open the wikipedia page"), true);
    assert.equal(BrowserTool.looksLikeBrowseRequest("browse that website"), true);
    assert.equal(BrowserTool.looksLikeBrowseRequest("tell me a story"), false);
  });

  console.log("BrowserTool — HTML extraction (regex path, no DOM)");

  await check("extract pulls title and body text", () => {
    const html = "<html><head><title>My Page</title></head><body><h1>Hi</h1><p>Body text here.</p></body></html>";
    const { title, text } = BrowserTool.extract(html);
    assert.equal(title, "My Page");
    assert.ok(text.includes("Body text here."));
  });

  await check("extract strips scripts and styles", () => {
    const html = "<html><body><script>var x = 1;</script><style>.a{color:red}</style><p>Keep me</p></body></html>";
    const { text } = BrowserTool.extract(html);
    assert.ok(!text.includes("var x"));
    assert.ok(text.includes("Keep me"));
  });

  console.log("BrowserTool — visit classification");

  await check("visit rejects invalid addresses honestly", async () => {
    const result = await BrowserTool.visit("not a url");
    assert.equal(result.status, "error");
    assert.ok(result.error);
  });

  await check("visit handles unreachable pages as blocked, never fake-read", async () => {
    const result = await BrowserTool.visit("https://definitely-not-a-real-domain.invalid/", 2000);
    assert.ok(result.status === "blocked" || result.status === "error");
    if (result.status === "read") {
      assert.fail("A non-resolving domain must never be reported as read.");
    }
  });

  console.log("BrowserTool — capability honesty");

  await check("native browser launching is reported unavailable in the sandbox", () => {
    assert.equal(BrowserTool.nativeLaunchAvailable(), false);
  });

  console.log("\nMedia + browser verification complete.");
}

void main();
