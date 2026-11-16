import test from "node:test";
import assert from "node:assert/strict";

import { createMeshyApi, MESHY_KEY_NAMES } from "../plugins/meshyApi";

const SECRET = "msy_SUPER_SECRET_TEST_VALUE_123";

type Handler = (req: any, res: any) => void;

function harness(options: Parameters<typeof createMeshyApi>[1] = {}) {
  const routes = new Map<string, Handler>();
  const api = createMeshyApi(
    (name) => (name === "Meshy" ? SECRET : name === "MESHY_API_KEY" ? "" : undefined),
    options,
  );
  api.attach({ use: (path, handler) => routes.set(path, handler) });
  assert.ok(routes.has("/api/meshy"), "the broker must be mounted at /api/meshy");
  return { api, routes };
}

function fakeResponse() {
  const state = { statusCode: 200, headers: {} as Record<string, string>, body: "" };
  return {
    state,
    res: {
      get statusCode() {
        return state.statusCode;
      },
      set statusCode(value: number) {
        state.statusCode = value;
      },
      setHeader: (name: string, value: string) => {
        state.headers[name] = value;
      },
      end: (body?: string) => {
        state.body = body ?? "";
      },
    },
  };
}

function fakeRequest(init: { method?: string; url?: string; body?: string; headers?: Record<string, string> }) {
  const listeners = new Map<string, Array<(chunk?: unknown) => void>>();
  return {
    method: init.method ?? "GET",
    url: init.url ?? "/",
    headers: init.headers ?? {},
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(listener);
      /* Microtask so the handler has attached its listeners first. */
      queueMicrotask(() => {
        if (event === "data" && init.body) {
          for (const each of listeners.get("data") ?? []) each(Buffer.from(init.body));
        }
        if (event === "end") {
          for (const each of listeners.get("end") ?? []) each();
        }
      });
    },
  };
}

test("the key is found under the deployment's own secret name", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const { api } = harness({
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ balance: 42 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch,
  });

  const status = await api.status();
  assert.equal(status.configured, true);
  assert.equal(status.source, "Meshy", "the source must be reported by NAME");
  assert.equal(status.upstream, "reachable");
  assert.equal(status.balance, 42);

  /* The bearer token is attached server-side... */
  const auth = (calls[0].init.headers as Record<string, string>).Authorization;
  assert.equal(auth, `Bearer ${SECRET}`);
  /* ...and never appears in what the client receives. */
  assert.ok(!JSON.stringify(status).includes(SECRET), "the status response leaked the key");
});

test("no key anywhere means clearly unconfigured, not a crash", async () => {
  const api = createMeshyApi(() => undefined, {
    fetchImpl: (async () => {
      throw new Error("must not be called without a key");
    }) as unknown as typeof fetch,
  });
  const status = await api.status();
  assert.equal(status.configured, false);
  assert.equal(status.source, null);
  assert.equal(status.upstream, "not-checked");
  assert.match(status.error ?? "", /MESHY_API_KEY/);
  assert.ok(MESHY_KEY_NAMES.includes("Meshy"), "the platform's secret name is a first-class key name");
});

test("a revoked key reports unreachable instead of pretending", async () => {
  const { api } = harness({
    fetchImpl: (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch,
  });
  const status = await api.status();
  assert.equal(status.configured, false);
  assert.equal(status.upstream, "unreachable");
  assert.match(status.error ?? "", /401/);
});

test("status endpoint answers JSON and never echoes the key", async () => {
  const { api, routes } = harness({
    fetchImpl: (async () => new Response(JSON.stringify({ balance: 7 }), { status: 200 })) as unknown as typeof fetch,
  });
  const handler = (req: any, res: any) => api.handle(req, res);
  const { res, state } = fakeResponse();
  await handler(fakeRequest({ method: "GET", url: "/status", headers: { host: "localhost:3000" } }), res);
  assert.equal(state.statusCode, 200);
  assert.equal(state.headers["Cache-Control"], "no-store");
  assert.ok(state.body.includes('"configured":true'));
  assert.ok(!state.body.includes(SECRET), "status response leaked the key");
});

test("a task is created through the proxy with the key attached only upstream", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const { api, routes } = harness({
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ result: "task-abc" }), { status: 200 });
    }) as unknown as typeof fetch,
  });

  const handler = (req: any, res: any) => api.handle(req, res);
  const { res, state } = fakeResponse();
  const payload = JSON.stringify({ image_url: "data:image/png;base64,AAA", ai_model: "meshy-6" });
  await handler(
    fakeRequest({ method: "POST", url: "/image-to-3d", body: payload, headers: { host: "localhost:3000", "content-type": "application/json" } }),
    res,
  );

  assert.equal(state.statusCode, 200);
  assert.ok(state.body.includes("task-abc"));
  assert.ok(!state.body.includes(SECRET), "task response leaked the key");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/openapi\/v1\/image-to-3d$/);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${SECRET}`);
  /* Forwarded as raw bytes, not re-encoded: a data-URI round trip through
     utf8 is how multipart/audio got corrupted in the model broker. */
  assert.equal(Buffer.from(calls[0].init.body as Buffer).toString(), payload, "the reference image must be forwarded verbatim");
});

test("polling a task goes through the same allowlist", async () => {
  const calls: string[] = [];
  const { api, routes } = harness({
    fetchImpl: (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ status: "IN_PROGRESS", progress: 40 }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  const handler = (req: any, res: any) => api.handle(req, res);
  const { res, state } = fakeResponse();
  await handler(fakeRequest({ url: "/image-to-3d/task-abc", headers: { host: "localhost:3000" } }), res);
  assert.equal(state.statusCode, 200);
  assert.ok(state.body.includes("IN_PROGRESS"));
  assert.match(calls[0], /\/openapi\/v1\/image-to-3d\/task-abc$/);
});

test("a cross-origin page cannot spend the deployment's credits", async () => {
  let called = false;
  const { api, routes } = harness({
    fetchImpl: (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  });
  const handler = (req: any, res: any) => api.handle(req, res);
  const { res, state } = fakeResponse();
  await handler(
    fakeRequest({
      method: "POST",
      url: "/image-to-3d",
      body: "{}",
      headers: { host: "localhost:3000", origin: "https://evil.example" },
    }),
    res,
  );
  assert.equal(state.statusCode, 403);
  assert.equal(called, false, "the upstream must not be called for a foreign origin");
});

test("path traversal is not forwarded", async () => {
  const calls: string[] = [];
  const { api, routes } = harness({
    fetchImpl: (async (url: string) => {
      calls.push(url);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  });
  const handler = (req: any, res: any) => api.handle(req, res);
  const { res, state } = fakeResponse();
  await handler(fakeRequest({ url: "/image-to-3d/..%2Fbalance", headers: { host: "localhost:3000" } }), res);
  assert.equal(state.statusCode, 404);
  assert.deepEqual(calls, []);
});

test("without a key, a create request is refused instead of silently failing upstream", async () => {
  const api = createMeshyApi(() => undefined, {
    fetchImpl: (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch,
  });
  const { res, state } = fakeResponse();
  await api.handle(
    fakeRequest({ method: "POST", url: "/image-to-3d", body: "{}", headers: { host: "localhost:3000" } }),
    res,
  );
  assert.equal(state.statusCode, 503);
  assert.match(state.body, /not configured/i);
});
