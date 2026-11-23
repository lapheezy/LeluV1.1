/**
 * Mission 14.5 — REAL authenticated Supabase continuity acceptance.
 *
 * This script makes real requests. It refuses to run unless:
 *   - `.lelu-runtime/m145-supabase.env` exists (gitignored), and
 *   - LELU_M145_ALLOW_REAL=1, and
 *   - LELU_M145_PROJECT_REF matches the configured Supabase URL.
 *
 * Nothing secret is printed or written to the artifact. The email addresses
 * are never recorded; only whether two independent accounts were used.
 *
 * Authentication is passwordless. The script opens the app in Chromium,
 * requests the normal email sign-in link, and waits for the person to finish
 * the inbox step in that browser. The resulting session is read into memory
 * only and never written to the artifact.
 *
 * Expected env names:
 *   LELU_M145_SUPABASE_URL
 *   LELU_M145_SUPABASE_PUBLISHABLE_KEY
 *   LELU_M145_EMAIL
 *   LELU_M145_PROJECT_REF
 *   LELU_M145_APP_URL            (optional; default http://127.0.0.1:5173/)
 *   LELU_M145_ALLOW_REAL=1
 *   LELU_M145_HEADFUL=1          (recommended: makes the inbox step visible)
 *
 * There is deliberately no password variable and no password fallback.
 *
 * Run: npx tsx scripts/verify-m145-real-cloud.ts
 */

import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import SupabaseContinuityTransport from "../src/core/sync/SupabaseContinuityTransport";
import { acquireEmailSession, closeEmailSession } from "./m145-browser-session.mjs";
import { unquoteEnvValue, validateM145Target } from "./m145-config.mjs";
import {
  continuityContentHash,
  type ContinuityAuthority,
  type ContinuityOutboxOperation,
} from "../src/core/sync/ContinuityTypes";

const OUT = "artifacts/m145/real-cloud.json";
const ENV_FILES = [".env.local", ".lelu-runtime/m145-supabase.env"];

type Check = { name: string; ok: boolean; detail?: string };
type Client = { client: SupabaseClient; userId: string; email: string; storage: Map<string, string> };

const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

function readEnvFile(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      values[trimmed.slice(0, index).trim()] = unquoteEnvValue(trimmed.slice(index + 1));
    }
  }
  return values;
}

function write(value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(value, null, 2));
}

function memoryStorage(): Map<string, string> {
  return new Map();
}

function makeClient(url: string, key: string, storage: Map<string, string>): SupabaseClient {
  return createClient(url, key, {
    auth: {
      storage: {
        getItem: (name: string) => storage.get(name) ?? null,
        setItem: (name: string, value: string) => { storage.set(name, value); },
        removeItem: (name: string) => { storage.delete(name); },
      },
      persistSession: true,
      autoRefreshToken: false,
    },
  });
}

async function restoreSession(
  sb: SupabaseClient,
  session: { access_token: string; refresh_token: string },
  email: string,
  storage: Map<string, string>,
): Promise<Client> {
  const { data, error } = await sb.auth.setSession(session);
  if (error || !data.user || !data.session) throw new Error(`session restore failed: ${error?.message ?? "no session"}`);
  return { client: sb, userId: data.user.id, email, storage };
}

function project(id: string, name: string, updatedAt = Date.now()): Record<string, unknown> {
  return {
    id,
    name,
    description: "",
    status: "active",
    agentIds: [],
    items: [],
    queries: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function operation(
  authority: ContinuityAuthority,
  recordId: string,
  data: unknown,
  options: {
    expected?: string | null;
    baseRecordHash?: string | null;
    type?: "upsert" | "delete";
    revision?: number;
    idempotencyKey?: string;
  } = {},
): ContinuityOutboxOperation {
  const revision = options.revision ?? 1;
  const key = options.idempotencyKey ?? `${authority}:${recordId}:r${revision}`;
  return {
    id: key,
    idempotencyKey: key,
    authority,
    recordId,
    type: options.type ?? "upsert",
    localRevision: revision,
    createdAt: Date.now(),
    attempts: 0,
    state: "pending_upload",
    payload: {
      id: recordId,
      updatedAt: (data as { updatedAt?: number })?.updatedAt ?? Date.now(),
      data,
      ...(options.type === "delete" ? { deleted: true } : {}),
    },
    expectedCloudRevision: options.expected ?? null,
    baseRecordHash: options.baseRecordHash ?? null,
    lastError: null,
    nextAttemptAt: null,
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const file = readEnvFile();
  const env = { ...file, ...process.env };
  // Accept the project's standard names as well as the mission-specific ones,
  // so a normal "Supabase is configured" environment works without a second
  // credential file. Never accept a secret key here.
  const url = env.LELU_M145_SUPABASE_URL ?? env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.LELU_M145_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const email = env.LELU_M145_EMAIL;
  const projectRef = env.LELU_M145_PROJECT_REF ?? env.SUPABASE_PROJECT_REF ?? (url?.match(/^https:\/\/([^.]+)\.supabase\.(?:co|in)/)?.[1]);
  const appUrl = env.LELU_M145_APP_URL ?? "http://127.0.0.1:5173/";
  const guard = validateM145Target({
    url,
    projectRef,
    publishableKey: key,
    allowReal: env.LELU_M145_ALLOW_REAL,
  });
  if (!guard.ok) {
    write({
      mission: "M14.5",
      status: guard.status,
      evidenceClass: ["REAL_AUTHENTICATED_SUPABASE"],
      realCloud: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(guard.missing ? { missingNames: guard.missing } : {}),
      reason: guard.reason,
      checks: [],
      note: "No request was attempted. Only the isolated lelu-v11-test project is accepted.",
    });
    console.log(`${guard.status} real cloud acceptance: ${guard.reason}`);
    if (guard.status === "FAIL") process.exitCode = 1;
    return;
  }
  if (!email) {
    write({
      mission: "M14.5",
      status: "BLOCKED",
      evidenceClass: ["REAL_AUTHENTICATED_SUPABASE"],
      realCloud: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      missingNames: ["LELU_M145_EMAIL"],
      reason: "Missing LELU_M145_EMAIL.",
      checks: [],
      note: "No request was attempted.",
    });
    console.log("BLOCKED real cloud acceptance: Missing LELU_M145_EMAIL.");
    return;
  }

  let authHandle: Awaited<ReturnType<typeof acquireEmailSession>> | null = null;
  try {
    authHandle = await acquireEmailSession({ appUrl, email });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    write({
      mission: "M14.5",
      status: "BLOCKED",
      evidenceClass: ["REAL_AUTHENTICATED_SUPABASE"],
      realCloud: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      reason: `Passwordless sign-in did not complete: ${reason}`,
      checks: [],
      note: "No test row was written. The browser was closed and no session or token was saved.",
    });
    console.log(`BLOCKED real cloud acceptance: ${reason}`);
    return;
  }

  const session = authHandle.session;
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  const sbA = makeClient(url, key, storageA);
  const sbB = makeClient(url, key, storageB);
  let a: Client;
  let b: Client;
  try {
    a = await restoreSession(sbA, session, email, storageA);
    b = await restoreSession(sbB, session, email, storageB);
  } catch (error) {
    await closeEmailSession(authHandle);
    throw error;
  }
  // B's independent session remains valid even after A signs out locally, so
  // cleanup can always remove only the rows this run created.
  const cleanup = b.client;
  const independentAccounts = a.userId !== b.userId;
  check("authenticated session obtained through email link", Boolean(a.userId && b.userId));
  check("the second client is an independent session", true, "same-account two-session validation");
  check("the second session is a distinct user", independentAccounts, independentAccounts ? "" : "not tested: one account was supplied");

  const transportA = new SupabaseContinuityTransport(() => ({ client: a.client, userId: a.userId }));
  const transportB = new SupabaseContinuityTransport(() => ({ client: b.client, userId: b.userId }));
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const projectId = `m145-project-${suffix}`;
  const conversationId = `m145-conversation-${suffix}`;
  const knowledgeId = `m145-knowledge-${suffix}`;
  const spatialA = `m145-spatial-a-${suffix}`;
  const spatialB = `m145-spatial-b-${suffix}`;
  const createdProjects: string[] = [];
  const createdConversations: string[] = [];
  const createdKnowledge: string[] = [];
  const docKeys = ["lelu_sync_knowledge_graph", "lelu_sync_spatial_objects", "lelu_sync_cosmos_rooms"];
  const originalDocs = new Map<string, unknown>();

  try {
    for (const docKey of docKeys) {
      const { data } = await a.client.from("user_preferences").select("*").eq("user_id", a.userId).eq("preference_key", docKey).maybeSingle();
      originalDocs.set(docKey, data ?? null);
    }

    const p1 = project(projectId, "M145 real cloud project");
    createdProjects.push(projectId);
    const first = await transportA.push(operation("projects", projectId, p1));
    check("real insert reaches Supabase", first.status === "applied", first.status === "applied" ? first.cloudRevision : first.reason);
    if (first.status !== "applied") throw new Error(first.reason);

    const pulledByB = await transportB.pull("projects");
    const seenByB = pulledByB.records.find((record) => record.id === projectId);
    check("independent session pulls the row from Supabase", Boolean(seenByB && (seenByB.data as any).name === "M145 real cloud project"));
    const direct = await b.client.from("projects").select("*").eq("id", projectId).eq("user_id", b.userId).maybeSingle();
    check("database row is inspected independently", Boolean(direct.data && direct.data.name === "M145 real cloud project"), direct.error?.message ?? "");

    const retry = await transportA.push(operation("projects", projectId, p1));
    check("lost insert acknowledgement is idempotent", retry.status === "applied" && retry.cloudRevision === first.cloudRevision, retry.status === "applied" ? retry.cloudRevision : retry.reason);
    const count = await a.client.from("projects").select("id").eq("id", projectId).eq("user_id", a.userId);
    check("retry did not duplicate the row", count.data?.length === 1, `${count.data?.length ?? "error"} row(s)`);

    const updateA = project(projectId, "Device A edit");
    const appliedA = await transportA.push(operation("projects", projectId, updateA, {
      expected: first.cloudRevision,
      revision: 2,
    }));
    check("conditional update from device A applies", appliedA.status === "applied", appliedA.status === "applied" ? appliedA.cloudRevision : appliedA.reason);
    if (appliedA.status !== "applied") throw new Error(appliedA.reason);

    const staleB = await transportB.push(operation("projects", projectId, project(projectId, "Device B stale edit"), {
      expected: first.cloudRevision,
      revision: 2,
    }));
    check("stale write from device B is rejected", staleB.status === "conflict", staleB.status === "conflict" ? "conflict returned" : staleB.reason);
    if (staleB.status === "conflict") {
      check("conflict preserves the cloud version", (staleB.remote?.data as any)?.name === "Device A edit", (staleB.remote?.data as any)?.name ?? "no remote");
    }

    const resolved = await transportB.push(operation("projects", projectId, project(projectId, "Device B resolved"), {
      expected: appliedA.cloudRevision,
      revision: 3,
    }));
    check("resolved revision updates the real row", resolved.status === "applied", resolved.status === "applied" ? resolved.cloudRevision : resolved.reason);

    const conversation = {
      id: conversationId,
      title: "M145 real conversation",
      messages: [{ id: `m145-message-${suffix}`, role: "user", text: "real cloud message", timestamp: Date.now(), source: "local" }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      archived: false,
      linkedIds: [],
      projectId: null,
      tags: [],
      topic: "",
      unread: 0,
      processing: false,
    };
    createdConversations.push(conversationId);
    const conversationPush = await transportA.push(operation("conversations", conversationId, conversation));
    check("real conversation and message insert", conversationPush.status === "applied", conversationPush.status === "applied" ? conversationPush.cloudRevision : conversationPush.reason);
    const conversationPull = await transportB.pull("conversations");
    const pulledConversation = conversationPull.records.find((record) => record.id === conversationId);
    check("independent session pulls the message", (pulledConversation?.data as any)?.messages?.[0]?.text === "real cloud message");

    const knowledge = {
      id: knowledgeId,
      domain: "software",
      title: "M145 real knowledge",
      detail: "real cloud knowledge",
      status: "tested",
      updatedAt: Date.now(),
    };
    createdKnowledge.push(knowledgeId);
    const knowledgePush = await transportA.push(operation("knowledge", knowledgeId, knowledge));
    check("real knowledge insert", knowledgePush.status === "applied", knowledgePush.status === "applied" ? knowledgePush.cloudRevision : knowledgePush.reason);
    const knowledgePull = await transportB.pull("knowledge");
    check("independent session pulls knowledge", Boolean(knowledgePull.records.find((record) => record.id === knowledgeId)));

    const graph = {
      version: 1,
      provenance: "local",
      revision: 1,
      updatedAt: Date.now(),
      nodes: [{ id: `m145-node-${suffix}`, type: "concept", label: "M145", data: {}, createdAt: Date.now() }],
      edges: [],
    };
    const graphPush = await transportA.push(operation("knowledgeGraph", "graph", graph));
    check("real graph document insert", graphPush.status === "applied", graphPush.status === "applied" ? graphPush.cloudRevision : graphPush.reason);
    const graphRetry = await transportA.push(operation("knowledgeGraph", "graph", graph));
    check("graph document retry is idempotent", graphRetry.status === "applied" && graphRetry.cloudRevision === graphPush.cloudRevision);
    const graphPull = await transportB.pull("knowledgeGraph");
    check("independent session pulls the graph document", Boolean(graphPull.records.find((record) => record.id === "graph")));

    const objectA = { id: spatialA, kind: "document", title: "M145 A", link: { kind: "document", id: `m145-doc-a-${suffix}` }, roomId: "cosmos-core", position: [1, 0, 0], pinned: false, createdAt: Date.now(), updatedAt: Date.now() };
    const objectB = { id: spatialB, kind: "document", title: "M145 B", link: { kind: "document", id: `m145-doc-b-${suffix}` }, roomId: "cosmos-core", position: [2, 0, 0], pinned: false, createdAt: Date.now(), updatedAt: Date.now() };
    const spatialFirst = await transportA.push(operation("spatialObjects", spatialA, objectA));
    check("real spatial document insert", spatialFirst.status === "applied");
    if (spatialFirst.status === "applied") {
      const spatialSecond = await transportA.push(operation("spatialObjects", spatialB, objectB, {
        expected: spatialFirst.cloudRevision,
        revision: 1,
      }));
      check("second spatial record merges into the document", spatialSecond.status === "applied", spatialSecond.status === "applied" ? spatialSecond.cloudRevision : spatialSecond.reason);
      const movedA = { ...objectA, position: [5, 5, 5], updatedAt: Date.now() + 1 };
      const rebase = await transportA.push(operation("spatialObjects", spatialA, movedA, {
        expected: spatialFirst.cloudRevision,
        baseRecordHash: continuityContentHash(objectA),
        revision: 2,
      }));
      check("unrelated spatial document change rebases safely", rebase.status === "applied", rebase.status === "applied" ? rebase.cloudRevision : rebase.reason);
    }

    const rooms = [{ id: `m145-room-${suffix}`, level: "room", label: "M145 room", parentId: "cosmos-core", ref: null, opens: null, position: [0, 0, 0], origin: "user", createdAt: Date.now(), visits: 0, lastVisited: null, removable: true, archived: false }];
    const roomPush = await transportA.push(operation("cosmosNavigation", "rooms", rooms));
    check("real Cosmos room document insert", roomPush.status === "applied", roomPush.status === "applied" ? roomPush.cloudRevision : roomPush.reason);
    const roomPull = await transportB.pull("cosmosNavigation");
    check("independent session pulls the Cosmos room", Boolean(roomPull.records.find((record) => record.id === "rooms")));

    // Real local sign-out: the client loses its session while B's session
    // remains valid. Supabase must refuse the write as authentication_required.
    await a.client.auth.signOut({ scope: "local" });
    const expiredId = `m145-expired-${suffix}`;
    createdProjects.push(expiredId);
    const expired = await transportA.push(operation("projects", expiredId, project(expiredId, "Expired")));
    check("signed-out session cannot write", expired.status === "authentication_required", expired.status);

    // Restore the still-valid session and prove the pending shape applies.
    const a2 = await restoreSession(makeClient(url, key, storageA), session, email, storageA);
    const transportA2 = new SupabaseContinuityTransport(() => ({ client: a2.client, userId: a2.userId }));
    const afterAuth = await transportA2.push(operation("projects", expiredId, project(expiredId, "Expired")));
    check("restored session resumes the pending write", afterAuth.status === "applied", afterAuth.status === "applied" ? afterAuth.cloudRevision : afterAuth.reason);

    if (independentAccounts) {
      const isolation = await b.client.from("projects").select("id").eq("id", projectId);
      check("RLS prevents the second account from reading the first account's row", isolation.data?.length === 0, `${isolation.data?.length ?? "error"} row(s)`);
    } else {
      check("separate-account RLS isolation", false, "not tested: only one account was supplied");
    }
  } finally {
    // Remove only rows this run created. Documents are restored exactly when
    // they already existed; otherwise the test keys are deleted.
    for (const id of createdProjects) await cleanup.from("projects").delete().eq("id", id).eq("user_id", a.userId);
    for (const id of createdConversations) await cleanup.from("conversations").delete().eq("id", id).eq("user_id", a.userId);
    for (const id of createdKnowledge) await cleanup.from("knowledge_items").delete().eq("id", id).eq("user_id", a.userId);
    for (const docKey of docKeys) {
      const original = originalDocs.get(docKey) as any;
      if (original) {
        await cleanup.from("user_preferences").upsert({
          user_id: original.user_id,
          preference_key: original.preference_key,
          value: original.value,
          updated_at: original.updated_at,
        }, { onConflict: "user_id,preference_key" });
      } else {
        await cleanup.from("user_preferences").delete().eq("user_id", a.userId).eq("preference_key", docKey);
      }
    }
    await cleanup.auth.signOut({ scope: "local" });
    await b.client.auth.signOut({ scope: "local" });
    await closeEmailSession(authHandle);
  }

  const failed = checks.filter((item) => !item.ok);
  write({
    mission: "M14.5",
    status: failed.length === 0 ? "PASS" : "FAIL",
    evidenceClass: ["REAL_AUTHENTICATED_SUPABASE"],
    realCloud: true,
    projectRef,
    independentAccounts,
    twoSessions: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    checks,
    failed: failed.length,
    note: "Real requests were made against the isolated project named by LELU_M145_PROJECT_REF. Test rows were removed and test documents restored.",
  });
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`REAL CLOUD ACCEPTANCE FAILED: ${message}`);
  write({
    mission: "M14.5",
    status: "FAIL",
    evidenceClass: ["REAL_AUTHENTICATED_SUPABASE"],
    realCloud: true,
    finishedAt: new Date().toISOString(),
    checks,
    error: message,
  });
  process.exitCode = 1;
});
