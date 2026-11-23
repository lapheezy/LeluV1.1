/**
 * Mission 14.5 — real transport contract against an in-memory PostgREST
 * stand-in.
 *
 * CATEGORY: unit/local integration. No Supabase request is made. These tests
 * exercise the actual SupabaseContinuityTransport code path for the defects
 * found by the M14.5 audit: lost insert acknowledgements, stale row writes,
 * document rebases, same-record document conflicts and expired sessions.
 *
 * This is NOT real cloud acceptance. The real-cloud harness is separate and
 * is labelled BLOCKED when no authorized project is configured.
 */

import assert from "node:assert/strict";
import test from "node:test";
import SupabaseContinuityTransport from "../src/core/sync/SupabaseContinuityTransport";
import { continuityContentHash, type ContinuityOutboxOperation } from "../src/core/sync/ContinuityTypes";

type Row = Record<string, any>;
type DbError = { message: string; code?: string; status?: number };

class FakeQuery {
  private operation: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: any = null;
  private options: any = null;
  private filters: Array<[string, unknown]> = [];
  private columns = "*";

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(columns = "*"): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row): this {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  upsert(payload: Row[], options?: any): this {
    this.operation = "upsert";
    this.payload = payload;
    this.options = options;
    return this;
  }

  maybeSingle(): Promise<{ data: any; error: DbError | null }> {
    return Promise.resolve(this.run(true));
  }

  then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown> {
    return Promise.resolve(this.run(false)).then(resolve, reject);
  }

  private matching(): Row[] {
    return this.db.rowsOf(this.table).filter((row) =>
      this.filters.every(([column, value]) => row[column] === value));
  }

  private project(row: Row): Row {
    if (this.columns === "*") return { ...row };
    const columns = this.columns.split(",").map((item) => item.trim());
    return Object.fromEntries(columns.map((column) => [column, row[column]]));
  }

  private result(data: any, single: boolean, error: DbError | null = null): { data: any; error: DbError | null } {
    if (error) return { data: null, error };
    if (single) return { data: Array.isArray(data) ? data[0] ?? null : data ?? null, error: null };
    return { data, error: null };
  }

  private run(single: boolean): { data: any; error: DbError | null } {
    if (this.db.failNext) {
      const error = this.db.failNext;
      this.db.failNext = null;
      return { data: null, error };
    }

    if (this.operation === "select") {
      return this.result(this.matching().map((row) => this.project(row)), single);
    }

    if (this.operation === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      for (const row of rows) {
        if (this.db.find(this.table, row)) {
          return this.result(null, single, { message: "duplicate key", code: "23505" });
        }
        this.db.store(this.table, { ...row });
      }
      return this.result(rows.map((row) => this.project(this.db.find(this.table, row) ?? row)), single);
    }

    if (this.operation === "upsert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      for (const row of rows) {
        const existing = this.db.find(this.table, row);
        if (existing && this.options?.ignoreDuplicates) continue;
        this.db.store(this.table, existing ? { ...existing, ...row } : { ...row });
      }
      return this.result(null, false);
    }

    const rows = this.matching();
    if (rows.length === 0) return this.result([], single);

    if (this.operation === "delete") {
      const deleted = rows.map((row) => ({ ...row }));
      this.db.remove(this.table, rows);
      return this.result(deleted.map((row) => this.project(row)), single);
    }

    const updated = rows.map((row) => {
      const next = { ...row, ...this.payload };
      next.continuity_revision = Number(row.continuity_revision ?? 1) + 1;
      next.updated_at = new Date(this.db.clock++).toISOString();
      this.db.store(this.table, next);
      return this.project(next);
    });
    return this.result(updated, single);
  }
}

class FakeDb {
  public failNext: DbError | null = null;
  public clock = Date.parse("2026-11-16T12:00:00.000Z");
  private tables = new Map<string, Row[]>();

  public rowsOf(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  public seed(table: string, row: Row): void {
    const rows = this.rowsOf(table);
    rows.push({ ...row });
    this.tables.set(table, rows);
  }

  public store(table: string, row: Row): Row {
    const key = this.key(table, row);
    const rows = this.rowsOf(table);
    const index = rows.findIndex((item) => this.key(table, item) === key);
    const next = {
      ...row,
      continuity_revision: Number(row.continuity_revision ?? 1),
      updated_at: row.updated_at ?? new Date(this.clock++).toISOString(),
    };
    if (index >= 0) rows[index] = next;
    else rows.push(next);
    this.tables.set(table, rows);
    return next;
  }

  public find(table: string, row: Row): Row | undefined {
    const key = this.key(table, row);
    return this.rowsOf(table).find((item) => this.key(table, item) === key);
  }

  public remove(table: string, rows: Row[]): void {
    const removed = new Set(rows.map((row) => this.key(table, row)));
    this.tables.set(table, this.rowsOf(table).filter((row) => !removed.has(this.key(table, row))));
  }

  public client = {
    from: (table: string) => new FakeQuery(this, table),
  };

  private key(table: string, row: Row): string {
    if (table === "messages") return `${row.id}|${row.user_id}`;
    if (table === "user_preferences") return `${row.user_id}|${row.preference_key}`;
    return `${row.id}|${row.user_id}`;
  }
}

const USER = "11111111-1111-4111-8111-111111111111";

function transport(db: FakeDb, userId: string | null = USER): SupabaseContinuityTransport {
  return new SupabaseContinuityTransport(() =>
    userId ? { client: db.client as any, userId } : null);
}

function project(name: string, updatedAt = Date.now()): Row {
  return {
    id: "project-1",
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
  authority: ContinuityOutboxOperation["authority"],
  recordId: string,
  data: unknown,
  options: {
    expected?: string | null;
    baseRecordHash?: string | null;
    type?: "upsert" | "delete";
    revision?: number;
  } = {},
): ContinuityOutboxOperation {
  const updatedAt = (data as { updatedAt?: number })?.updatedAt ?? Date.now();
  return {
    id: `${authority}:${recordId}:r${options.revision ?? 1}`,
    idempotencyKey: `${authority}:${recordId}:r${options.revision ?? 1}`,
    authority,
    recordId,
    type: options.type ?? "upsert",
    localRevision: options.revision ?? 1,
    createdAt: Date.now(),
    attempts: 0,
    state: "pending_upload",
    payload: {
      id: recordId,
      updatedAt,
      data,
      ...(options.type === "delete" ? { deleted: true } : {}),
    },
    expectedCloudRevision: options.expected ?? null,
    baseRecordHash: options.baseRecordHash ?? null,
    lastError: null,
    nextAttemptAt: null,
  };
}

test("an insert whose acknowledgement was lost is retried idempotently", async () => {
  const db = new FakeDb();
  const client = transport(db);
  const first = await client.push(operation("projects", "project-1", project("One")));
  assert.equal(first.status, "applied");
  if (first.status !== "applied") return;

  const retry = await client.push(operation("projects", "project-1", project("One")));
  assert.deepEqual(retry, { status: "applied", cloudRevision: first.cloudRevision });
  assert.equal(db.rowsOf("projects").length, 1, "the retry did not duplicate the row");
  assert.equal(db.rowsOf("projects")[0].continuity_revision, 1, "no unnecessary revision bump");
});

test("a stale row write is rejected and both versions remain available", async () => {
  const db = new FakeDb();
  const client = transport(db);
  const inserted = await client.push(operation("projects", "project-1", project("Base")));
  assert.equal(inserted.status, "applied");
  if (inserted.status !== "applied") return;

  const deviceB = await client.push(operation("projects", "project-1", project("Device B"), {
    expected: inserted.cloudRevision,
    revision: 2,
  }));
  assert.equal(deviceB.status, "applied");
  if (deviceB.status !== "applied") return;

  const stale = await client.push(operation("projects", "project-1", project("Device C"), {
    expected: inserted.cloudRevision,
    revision: 2,
  }));
  assert.equal(stale.status, "conflict");
  if (stale.status !== "conflict") return;
  assert.equal((stale.remote?.data as any).name, "Device B");
});

test("a repeated update with the old base is applied, not a false conflict", async () => {
  const db = new FakeDb();
  const client = transport(db);
  const inserted = await client.push(operation("projects", "project-1", project("Base")));
  assert.equal(inserted.status, "applied");
  if (inserted.status !== "applied") return;

  const update = operation("projects", "project-1", project("Edited"), {
    expected: inserted.cloudRevision,
    revision: 2,
  });
  const first = await client.push(update);
  assert.equal(first.status, "applied");
  const retry = await client.push(update);
  assert.equal(retry.status, "applied", "the second delivery is the same operation");
  assert.equal(db.rowsOf("projects").length, 1);
});

test("an expired session is reported as authentication_required", async () => {
  const db = new FakeDb();
  db.failNext = { message: "JWT expired", status: 401 };
  const result = await transport(db).push(operation("projects", "project-1", project("One")));
  assert.equal(result.status, "authentication_required");
  assert.match(result.status === "authentication_required" ? result.reason : "", /JWT expired/);
});

test("a missing session never attempts a write", async () => {
  const result = await transport(new FakeDb(), null).push(operation("projects", "project-1", project("One")));
  assert.equal(result.status, "authentication_required");
});

test("a graph document retry is idempotent", async () => {
  const db = new FakeDb();
  const client = transport(db);
  const graph = {
    version: 1,
    provenance: "local",
    revision: 1,
    updatedAt: 1,
    nodes: [{ id: "n1", type: "concept", label: "One", data: {}, createdAt: 1 }],
    edges: [],
  };
  const first = await client.push(operation("knowledgeGraph", "graph", graph));
  assert.equal(first.status, "applied");
  if (first.status !== "applied") return;
  const retry = await client.push(operation("knowledgeGraph", "graph", graph));
  assert.equal(retry.status, "applied");
  assert.equal(db.rowsOf("user_preferences").length, 1);
});

test("separate records in one document rebase without losing unrelated fields", async () => {
  const db = new FakeDb();
  const client = transport(db);
  const objectA = { id: "obj-a", kind: "document", title: "A", link: { kind: "document", id: "a" }, roomId: "core", position: [1, 0, 0], pinned: false, createdAt: 1, updatedAt: 1 };
  const objectB = { id: "obj-b", kind: "document", title: "B", link: { kind: "document", id: "b" }, roomId: "core", position: [2, 0, 0], pinned: false, createdAt: 1, updatedAt: 1 };

  const a = await client.push(operation("spatialObjects", "obj-a", objectA));
  assert.equal(a.status, "applied");
  if (a.status !== "applied") return;
  const b = await client.push(operation("spatialObjects", "obj-b", objectB, {
    expected: a.cloudRevision,
    revision: 1,
  }));
  assert.equal(b.status, "applied", "a different record can be added to the same document");

  const baseHash = continuityContentHash(objectA);
  const movedA = { ...objectA, position: [5, 5, 5], updatedAt: 2 };
  const moved = await client.push(operation("spatialObjects", "obj-a", movedA, {
    expected: a.cloudRevision,
    baseRecordHash: baseHash,
    revision: 2,
  }));
  assert.equal(moved.status, "applied", "the document revision moved, but this record did not");
  const doc = db.rowsOf("user_preferences")[0].value;
  assert.equal(doc.records.find((record: any) => record.id === "obj-a").data.position[0], 5);
  assert.equal(doc.records.find((record: any) => record.id === "obj-b").data.title, "B");
});

test("a changed same-record document write is a conflict", async () => {
  const db = new FakeDb();
  const client = transport(db);
  const object = { id: "obj-a", kind: "document", title: "A", link: { kind: "document", id: "a" }, roomId: "core", position: [1, 0, 0], pinned: false, createdAt: 1, updatedAt: 1 };
  const first = await client.push(operation("spatialObjects", "obj-a", object));
  assert.equal(first.status, "applied");
  if (first.status !== "applied") return;
  const baseHash = continuityContentHash(object);

  const cloudMoved = { ...object, position: [9, 9, 9], updatedAt: 2 };
  const cloud = await client.push(operation("spatialObjects", "obj-a", cloudMoved, {
    expected: first.cloudRevision,
    baseRecordHash: baseHash,
    revision: 2,
  }));
  assert.equal(cloud.status, "applied");
  if (cloud.status !== "applied") return;

  const stale = await client.push(operation("spatialObjects", "obj-a", {
    ...object,
    position: [5, 5, 5],
    updatedAt: 3,
  }, {
    expected: first.cloudRevision,
    baseRecordHash: baseHash,
    revision: 3,
  }));
  assert.equal(stale.status, "conflict");
  if (stale.status !== "conflict") return;
  assert.deepEqual((stale.remote?.data as any).position, [9, 9, 9]);
});

test("pull accepts both strict revisions and legacy timestamps", async () => {
  const db = new FakeDb();
  const client = transport(db);
  db.seed("projects", {
    ...project("Legacy"),
    user_id: USER,
    updated_at: "2026-11-16T11:00:00.000Z",
  });
  const result = await client.pull("projects");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cloudRevision, "ts:2026-11-16T11:00:00.000Z");
});
