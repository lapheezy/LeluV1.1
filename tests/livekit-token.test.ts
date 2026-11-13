/**
 * LiveKit token endpoint (plugins/livekitApi.ts).
 *
 * Offline: identity is injected, LiveKit's RoomService is a real server only
 * in the live block. What these pin:
 *   · no LiveKit configuration → 503, no identity → 401 (fail closed);
 *   · the room is derived from the VERIFIED user, never from the request;
 *   · the grant names exactly that room, the token is short-lived;
 *   · the API secret never appears in a response.
 *
 * Live (LIVEKIT_LIVE_ENV=path to an env file with LIVEKIT_URL/KEY/SECRET):
 * issues a real token against the running livekit-server, confirms the room
 * exists on the server, and joins it as a real participant (Python rtc SDK).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { RoomServiceClient } from "livekit-server-sdk";
import { createLivekitApi, roomForUser } from "../plugins/livekitApi";

const SECRET = "test-secret-that-must-never-leak-0123456789";
const offlineEnv: Record<string, string> = {
  LIVEKIT_URL: "ws://127.0.0.1:1",
  LIVEKIT_API_KEY: "APItest",
  LIVEKIT_API_SECRET: SECRET,
};

function decode(jwt: string): Record<string, any> {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
}

const verified = async () => ({ ok: true, status: 200, reason: "ok", identity: { userId: "1111-aaaa", email: "a@example.test" } });

test("no LiveKit configuration is 503", async () => {
  const api = createLivekitApi({ readEnv: () => undefined, verifyIdentity: verified });
  const out = await api.issue({ headers: {} });
  assert.equal(out.status, 503);
});

test("no verified identity is refused with the verifier's status", async () => {
  const api = createLivekitApi({
    readEnv: (k) => offlineEnv[k],
    verifyIdentity: async () => ({ ok: false, status: 401, reason: "No Supabase access token was presented." }),
  });
  const out = await api.issue({ headers: {} });
  assert.equal(out.status, 401);
  assert.doesNotMatch(JSON.stringify(out.body), new RegExp(SECRET));
});

test("an unreachable LiveKit server is 502, not a token for a room that cannot exist", async () => {
  const api = createLivekitApi({ readEnv: (k) => offlineEnv[k], verifyIdentity: verified });
  const out = await api.issue({ headers: {} });
  assert.equal(out.status, 502);
});

test("the room comes from the user id and cannot be injected", () => {
  assert.equal(roomForUser("1111-aaaa"), "lelu-1111-aaaa");
  assert.equal(roomForUser("../other room"), "lelu-otherroom");
});

const liveEnvPath = process.env.LIVEKIT_LIVE_ENV;
const liveEnv: Record<string, string> = {};
if (liveEnvPath) {
  for (const line of readFileSync(liveEnvPath, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) liveEnv[line.slice(0, at)] = line.slice(at + 1);
  }
}

test("live: token issued, room created, real participant joins", { skip: !liveEnvPath && "LIVEKIT_LIVE_ENV not set" }, async () => {
  const userId = `test-${Date.now()}`;
  const api = createLivekitApi({
    readEnv: (k) => liveEnv[k] ?? (k === "LELU_VOICE_AGENT_TOKEN" ? "" : undefined),
    verifyIdentity: async () => ({ ok: true, status: 200, reason: "ok", identity: { userId, email: null } }),
  });
  const out = await api.issue({ headers: {} });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const body = out.body as { token: string; room: string; url: string; identity: string; expiresAt: number };
  assert.equal(body.room, `lelu-${userId}`);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(liveEnv.LIVEKIT_API_SECRET));

  const claims = decode(body.token);
  assert.equal(claims.video.room, body.room);
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.sub, `user-${userId}`);
  assert.ok(claims.exp - claims.nbf <= 600, "token lives at most 10 minutes");
  assert.equal(claims.video.roomAdmin, undefined, "no admin rights");

  const rooms = new RoomServiceClient(liveEnv.LIVEKIT_URL.replace(/^ws/, "http"), liveEnv.LIVEKIT_API_KEY, liveEnv.LIVEKIT_API_SECRET);
  const listed = await rooms.listRooms([body.room]);
  assert.equal(listed.length, 1, "room exists on the server");
  assert.equal(listed[0].maxParticipants, 3);

  const probe = execFileSync(".venv-livekit-agent/bin/python", ["services/livekit-agent/probe_connect.py", body.url, body.token, "1"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const joined = JSON.parse(probe.trim().split("\n").pop() as string);
  assert.equal(joined.connected, true);
  assert.equal(joined.room, body.room);
  assert.equal(joined.identity, `user-${userId}`);
  assert.match(joined.roomSid, /^RM_/);

  // A token for this user cannot open someone else's room: the grant is the room.
  assert.notEqual(claims.video.room, roomForUser("someone-else"));
  await rooms.deleteRoom(body.room);
});
