/**
 * ==========================================================
 * LÉLU — LOCAL-ONLY OPERATION
 *
 * CATEGORY: acceptance-level unit. No Supabase project, no network,
 * no account and no credential.
 *
 * Pins the architecture WP05 exists to guarantee:
 *   - absent Supabase configuration means local-only, not a hidden default;
 *   - local identity, projects and conversations persist through KvStore;
 *   - a configured Supabase adapter still initializes separately;
 *   - neither path performs a remote write during initialization.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: () => null,
  };
}

import {
  SUPABASE_KEY_NAMES,
  SUPABASE_PUBLIC_DEFAULT_FLAG_NAMES,
  SUPABASE_URL_NAMES,
  resolveSupabaseConfig,
} from "../src/core/config/supabaseEnv";
import { resetPublicEnv } from "../src/core/env/publicEnv";
import { isSupabaseConfigured } from "../src/og/integrations/supabase/client";
import SupabasePersistence from "../src/core/persistence/SupabasePersistence";
import UserManager from "../src/core/user/UserManager";
import ProjectStore from "../src/core/projects/ProjectStore";
import MultiChatStore from "../src/core/multichat/MultiChatStore";
import KnowledgeGraph, { KNOWLEDGE_GRAPH_STORAGE_KEY } from "../src/core/cognition/KnowledgeGraph";
import KvStore from "../src/core/storage/KvStore";

const SUPABASE_NAMES = [
  ...SUPABASE_URL_NAMES,
  ...SUPABASE_KEY_NAMES,
  ...SUPABASE_PUBLIC_DEFAULT_FLAG_NAMES,
];

/** Remove every Supabase alias, including the VITE_ and bridged forms. */
function clearSupabaseEnv(): () => void {
  const names = new Set<string>();
  for (const name of SUPABASE_NAMES) {
    const bare = name.replace(/^VITE_/, "");
    names.add(name);
    names.add(bare);
    names.add(`VITE_${bare}`);
    names.add(`__LELU_${bare}__`);
  }
  const saved = new Map<string, string | undefined>();
  for (const name of names) {
    saved.set(name, process.env[name]);
    delete process.env[name];
    const runtime = globalThis as Record<string, unknown>;
    if (name.startsWith("__LELU_")) {
      delete runtime[name];
    }
  }
  resetPublicEnv();
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetPublicEnv();
  };
}

async function withFetchSpy<T>(work: () => Promise<T>): Promise<{ result: T; calls: string[] }> {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    throw new Error("controlled test: local-only must not fetch");
  }) as typeof globalThis.fetch;
  try {
    return { result: await work(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("no Supabase configuration is local-only, not an implicit cloud project", async () => {
  const restore = clearSupabaseEnv();
  try {
    assert.equal(resolveSupabaseConfig(), null);
    assert.equal(isSupabaseConfigured(), false);

    const persistence = SupabasePersistence.getInstance();
    persistence.resetForTests();
    const { calls } = await withFetchSpy(async () => persistence.initialize());

    assert.equal(persistence.getStatus(), "disabled");
    assert.equal(persistence.isConnected(), false);
    assert.equal(persistence.getAuthState().session, null);
    assert.deepEqual(calls, [], "local-only initialization contacted the network");
  } finally {
    SupabasePersistence.getInstance().resetForTests();
    restore();
  }
});

test("local identity survives without IndexedDB and without Supabase", async () => {
  const restore = clearSupabaseEnv();
  try {
    const first = new UserManager();
    await first.initialize();
    assert.ok(first.get(), "the local profile did not initialize");
    await first.update({ name: "Local-only user" });

    const second = new UserManager();
    await second.initialize();
    assert.equal(second.get()?.name, "Local-only user", "the local profile did not survive a new manager");
  } finally {
    KvStore.getInstance().remove("user.profile.v1");
    restore();
  }
});

test("local projects and conversations persist through the shared KvStore", () => {
  const store = ProjectStore.getInstance();
  const project = store.create({
    name: "WP05 local project",
    description: "A project that does not need an account",
  });
  assert.equal(store.get(project.id)?.name, "WP05 local project");

  store.update(project.id, { description: "Edited locally" });
  store.addNote(project.id, "Local note", "Written without Supabase");
  const reopened = store.get(project.id);
  assert.equal(reopened?.description, "Edited locally");
  assert.equal(reopened?.items[0]?.title, "Local note");

  const persisted = KvStore.getInstance().get<Array<{ id: string }>>("projects.v1");
  assert.ok(persisted?.some((item) => item.id === project.id), "the project was not written to KvStore");
  store.remove(project.id);
  assert.equal(store.get(project.id), undefined);

  const chats = MultiChatStore.getInstance();
  const conversation = chats.create("WP05 local chat");
  chats.addMessage(conversation.id, {
    id: "local-message",
    role: "user",
    text: "hello without an account",
    timestamp: Date.now(),
    source: "local",
  });
  assert.equal(MultiChatStore.getInstance().get(conversation.id)?.messages.length, 1);
  chats.flush();
  const storedChats = KvStore.getInstance().get<{ conversations: Array<{ id: string }> }>("multichat.workspace.v1");
  assert.ok(storedChats?.conversations.some((item) => item.id === conversation.id));
});

test("knowledge nodes, relationships and revisions survive a new graph", () => {
  KvStore.getInstance().remove(KNOWLEDGE_GRAPH_STORAGE_KEY);
  try {
    const first = new KnowledgeGraph();
    first.addNode({ id: "local-node", type: "concept", label: "Local", data: {}, createdAt: Date.now() });
    first.connect("local-node", "local-node", "self");
    const revision = first.getRevision();
    assert.ok(revision > 0);

    const second = new KnowledgeGraph();
    assert.equal(second.all()[0]?.label, "Local");
    assert.equal(second.connections()[0]?.relation, "self");
    assert.equal(second.getRevision(), revision);

    second.addNode({ id: "local-node", type: "concept", label: "Updated", data: {}, createdAt: Date.now() });
    const third = new KnowledgeGraph();
    assert.equal(third.all()[0]?.label, "Updated");
    const stored = KvStore.getInstance().get<{ provenance: string }>(KNOWLEDGE_GRAPH_STORAGE_KEY);
    assert.equal(stored?.provenance, "local");
  } finally {
    KvStore.getInstance().remove(KNOWLEDGE_GRAPH_STORAGE_KEY);
  }
});

test("a blocked local write is reported as a failure, never as success", () => {
  const blocked = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota exceeded");
    },
    removeItem: () => undefined,
  };
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: blocked, sessionStorage: blocked };
  try {
    assert.equal(
      KvStore.getInstance().set("m143.blocked.write", { value: true }),
      false,
      "a write that no backend accepted was reported as saved",
    );
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("corrupt local data is treated as absent, not as a crash", () => {
  localStorage.setItem("lelu.m143.corrupt", "{not json");
  try {
    assert.equal(KvStore.getInstance().get("m143.corrupt"), null);
  } finally {
    localStorage.removeItem("lelu.m143.corrupt");
  }
});

test("a configured Supabase adapter still initializes separately and makes no write", async () => {
  const restore = clearSupabaseEnv();
  process.env.SUPABASE_URL = "https://local-test.invalid";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_local_test";
  resetPublicEnv();
  try {
    const persistence = SupabasePersistence.getInstance();
    persistence.resetForTests();
    const { calls } = await withFetchSpy(async () => persistence.initialize());

    assert.equal(persistence.getStatus(), "signed_out");
    assert.equal(persistence.getAuthState().session, null);
    assert.deepEqual(calls, [], "configured initialization wrote before a user signed in");
  } finally {
    SupabasePersistence.getInstance().resetForTests();
    restore();
  }
});
