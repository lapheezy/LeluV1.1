/**
 * ==========================================================
 * LÉLU — ARCHITECTURE SELF-MODEL INTEGRITY
 *
 * CATEGORY: unit. Reads the real source tree.
 *
 * Why this exists: ArchitectureMap names ~75 files by hand and
 * ten modules trust it, including SelfStudyEngine and
 * StudyAgentRouter, which use it to choose what LÉLU studies.
 * A renamed or deleted file does not fail loudly there — it
 * quietly sends her to read something that is not present, and
 * her self-model becomes a second, wrong account of her own
 * architecture.
 *
 * Also asserts the route table actually mounts the OG pages,
 * which is the failure this audit found: AppShell rendered an
 * <Outlet/> that nothing filled, so half of OG UI #2 was
 * unreachable while everything still compiled and rendered.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

test("every file the architecture map names actually exists", () => {
  const source = readFileSync("src/core/selfdev/ArchitectureMap.ts", "utf8");
  const declared = [...new Set(source.match(/"src\/[^"]+"/g) ?? [])].map((q) => q.slice(1, -1));

  assert.ok(declared.length > 50, "the map should still be describing the codebase");
  const missing = declared.filter((path) => !existsSync(path));
  assert.deepEqual(missing, [], `the self-model names files that are gone: ${missing.join(", ")}`);
});

test("the Inner Sky shell's pages are mounted, not just its shell", () => {
  // AppShell renders <Outlet/>; without child routes the interface comes up
  // empty and every nav tab leads nowhere.
  const routes = readFileSync("src/og/OgRoutes.tsx", "utf8");
  const shell = readFileSync("src/og/components/app/AppShell.tsx", "utf8");

  assert.ok(shell.includes("<Outlet />"), "AppShell is a layout and needs children");

  for (const page of ["chats", "agents", "memories", "files", "universes", "queue", "settings"]) {
    assert.ok(
      new RegExp(`path="${page}"`).test(routes),
      `OG page "${page}" is not mounted — its nav tab would lead nowhere`,
    );
  }
});

test("OG nav targets resolve under the /og mount", () => {
  // AppShell links to its original "/app/..." paths; the compat router is what
  // maps those onto "/og/app/...". If that scoping is removed the tabs all
  // navigate out of the OG interfaces entirely.
  const compat = readFileSync("src/og/compat/router.tsx", "utf8");
  assert.ok(/OG_ROOTS/.test(compat), "compat router must scope OG-internal paths");
  assert.ok(/\/og\$\{to\}|`\/og\$\{to\}`/.test(compat), "scoping must prefix /og");
});

test("polling panels cannot poll a database that cannot answer", () => {
  // Four panels refreshed every 3-6s unconditionally. With Supabase absent or
  // rejecting that is a failing request per panel, several times a minute,
  // forever, on a phone.
  const hook = readFileSync("src/og/compat/usePersistedQuery.ts", "utf8");
  assert.ok(/isSupabaseConfigured/.test(hook), "polling must be gated on availability");
  assert.ok(/retry: false/.test(hook), "a poll must not also retry — the next tick is the retry");

  for (const panel of ["AgentsPanel", "ExecutivePanel", "LogsPanel", "MemoryLogPanel"]) {
    const source = readFileSync(`src/og/components/core/panels/${panel}.tsx`, "utf8");
    assert.ok(
      !/\buseQuery\(\{/.test(source),
      `${panel} must poll through usePersistedQuery, not react-query directly`,
    );
  }
});

test("ingestion cannot re-enter the chat runtime", () => {
  // ingestSource runs from inside a chat turn (BrowserResolver sees a URL).
  // If it extracted via AIService.chat() it would run the router, which runs
  // BrowserResolver, which ingests again.
  const source = readFileSync("src/core/memory/ingestSource.ts", "utf8");
  assert.ok(
    !/\bai\.chat\(/.test(source),
    "ingestion must resolve a provider directly, never call chat()",
  );
  assert.ok(/getAIProviderRegistry/.test(source), "…and must use the same provider registry");
});

test("a browsed page is not fetched twice", () => {
  // BrowserResolver fetches to answer the turn, then asks for ingestion.
  // Passing only the URL would make the pipeline fetch the same page again.
  const resolver = readFileSync("src/core/router/BrowserResolver.ts", "utf8");
  assert.ok(/ingestSource\(page\.url, \{/.test(resolver), "must hand over the fetched page");
  assert.ok(/text: page\.text/.test(resolver), "…including its already-read text");
});
