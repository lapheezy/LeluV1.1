/**
 * A local stand-in for the Meshy API: the documented create / read task
 * protocol, signed-asset downloads on a separate path, and a record of
 * every request (including its Authorization header) for assertions.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";

import { buildGlb, tinyPng } from "./glbFixture";

export const KEY = "msy_TEST_CANARY_never_leaks";

export interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
  body: string;
}

export interface FakeMeshy {
  base: string;
  seen: Seen[];
  /** Status codes to answer the next create calls with, before succeeding. */
  createFailures: number[];
  balance: number;
  /** Close the socket on the next create without answering. */
  dropNextCreate: boolean;
  glb: Uint8Array;
  riggedGlb: Uint8Array;
  close: () => Promise<void>;
}

function readAll(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

export async function startFakeMeshy(): Promise<FakeMeshy> {
  const polls = new Map<string, number>();
  let tasks = 0;
  const fake = {
    seen: [] as Seen[],
    createFailures: [] as number[],
    balance: 1000,
    dropNextCreate: false,
    glb: buildGlb({ textured: true }),
    riggedGlb: buildGlb({ skinned: true, animated: true, textured: true }),
  } as FakeMeshy;
  const server: Server = createServer(async (req, res) => {
    const body = await readAll(req);
    const url = req.url ?? "";
    fake.seen.push({ method: req.method ?? "", url, auth: req.headers.authorization, body });
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (url.startsWith("/assets/")) {
      const bytes = url.endsWith("rigged.glb") || url.endsWith("walking.glb") ? fake.riggedGlb : url.endsWith(".glb") ? fake.glb : tinyPng();
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(Buffer.from(bytes));
      return;
    }
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { message: "Missing API key" });
    if (url === "/openapi/v1/balance") return json(200, { balance: fake.balance, monthly_credits: 0, permanent_credits: fake.balance });
    const create = /^\/openapi\/v1\/(image-to-3d|multi-image-to-3d|rigging|animations|image-to-image)$/.exec(url);
    if (create && req.method === "POST") {
      if (fake.dropNextCreate) {
        fake.dropNextCreate = false;
        req.socket.destroy();
        return;
      }
      const failure = fake.createFailures.shift();
      if (failure) return json(failure, { message: "busy" });
      tasks++;
      return json(202, { result: `task-${tasks}` });
    }
    const read = /^\/openapi\/v1\/(image-to-3d|multi-image-to-3d|rigging|animations|image-to-image)\/(task-\d+)$/.exec(url);
    if (read) {
      const [, kind, id] = read;
      const n = (polls.get(id) ?? 0) + 1;
      polls.set(id, n);
      if (n === 1) return json(200, { id, status: "IN_PROGRESS", progress: 40 });
      const asset = (name: string) => `${fake.base}/assets/${id}/${name}`;
      if (kind === "rigging") {
        return json(200, {
          id, type: "rig", status: "SUCCEEDED", progress: 100, consumed_credits: 5,
          result: {
            rigged_character_glb_url: asset("rigged.glb"),
            rigged_character_fbx_url: asset("rigged.fbx"),
            basic_animations: { walking_glb_url: asset("walking.glb"), walking_fbx_url: asset("walking.fbx") },
          },
        });
      }
      if (kind === "image-to-image") {
        return json(200, { id, status: "SUCCEEDED", progress: 100, consumed_credits: 9, image_urls: [asset("view_0.png"), asset("view_1.png"), asset("view_2.png")] });
      }
      return json(200, {
        id, status: "SUCCEEDED", progress: 100, consumed_credits: 30,
        model_urls: { glb: asset("model.glb"), fbx: asset("model.fbx") },
        thumbnail_url: asset("preview.png"),
        thumbnail_urls: { front: asset("front.png"), back: asset("back.png") },
        texture_urls: [{ base_color: asset("base_color.png") }],
      });
    }
    json(404, { message: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  fake.base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}
