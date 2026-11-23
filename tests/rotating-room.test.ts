/**
 * LÉLUVERSE — HER ROTATING ROOM
 *
 * The room's layout and turning are pure (src/core/world/RotatingRoom.ts):
 *   - choosing a section turns the ring the short way and brings it to the back
 *   - while it turns, what leaves the back sinks and what arrives rises
 *   - stage retracts everything, plan raises everything
 *   - every piece faces the room's centre (unless turned on purpose)
 *   - she walks around only what is standing
 *   - the person's words pick the section; LÉLU's world.room tool turns the room
 */
import assert from "node:assert/strict";
import test from "node:test";
import RoomStore, {
  angleDelta,
  BACK_ANGLE,
  layout,
  modeFromText,
  ringAngleFor,
  ROOM_SECTIONS,
  roomObstacles,
  sectionIndex,
  sectionWorldAngle,
  standing,
} from "../src/core/world/RotatingRoom";
import { mountRoom, roomObstaclesWorld } from "../src/core/world/roomPresence";
import { WORLD_EXECUTORS, WORLD_TOOLS } from "../src/core/world/WorldTools";

test("each section's ring angle brings it to the back of the room", () => {
  for (const s of ROOM_SECTIONS) {
    const a = sectionWorldAngle(sectionIndex(s.id), ringAngleFor(s.id));
    assert.equal(Math.abs(angleDelta(BACK_ANGLE, a)) < 1e-9, true, s.id);
  }
});

test("the section at the back stands; the open front is clear", () => {
  for (const s of ROOM_SECTIONS) {
    const placed = layout(ringAngleFor(s.id), s.id);
    for (const p of placed.filter((x) => x.section === s.id)) assert.ok(p.rise > 0.99, `${s.id} ${p.piece} stands`);
    // nothing stands in front of the centre (z > 0 is toward the viewer)
    for (const p of placed.filter((x) => x.rise > 0.01)) assert.ok(p.z < 0.6, `${p.key} is not in front (z=${p.z.toFixed(2)})`);
    // the section opposite has sunk
    const opposite = ROOM_SECTIONS[(sectionIndex(s.id) + 3) % ROOM_SECTIONS.length].id;
    for (const p of placed.filter((x) => x.section === opposite)) assert.equal(p.rise, 0, `${opposite} ${p.piece} has sunk`);
  }
});

test("stage retracts everything and plan raises everything", () => {
  assert.ok(layout(0, "stage").every((p) => p.rise === 0));
  assert.ok(layout(37, "plan").every((p) => p.rise === 1));
  assert.equal(standing(BACK_ANGLE, "lounge"), 1);
  assert.equal(standing(0, "lounge"), 0);
  // rising is continuous between; a neighbouring section (one span away) has sunk
  const mid = standing(BACK_ANGLE + 30, "kitchen");
  assert.ok(mid > 0 && mid < 1, `half way: ${mid}`);
  assert.equal(standing(BACK_ANGLE + 60, "kitchen"), 0);
});

test("furniture faces the room's centre unless turned on purpose", () => {
  for (const p of layout(-120, "plan")) {
    // the model's front (+Z) turned by rotationY, compared with the direction to the centre
    const fx = Math.sin(p.rotationY);
    const fz = Math.cos(p.rotationY);
    const len = Math.hypot(p.x, p.z);
    const dot = (fx * -p.x + fz * -p.z) / len;
    const expected = Math.cos(((p.yaw ?? 0) * Math.PI) / 180);
    assert.ok(Math.abs(dot - expected) < 1e-6, `${p.key}: ${dot} vs ${expected}`);
  }
});

test("a turn goes the short way round and takes longer for a longer turn", () => {
  RoomStore.reset();
  const t0 = 1_000_000;
  const a = RoomStore.goTo("theater", t0); // one section on
  assert.ok(a.turn);
  assert.equal(Math.abs(a.turn!.to - a.turn!.from), 60);
  const done = t0 + a.turn!.seconds * 1000 + 1;
  assert.equal(RoomStore.ringAt(done), ringAngleFor("theater"));
  const b = RoomStore.goTo("studio", done); // studio is next to the lounge: the other way round
  assert.ok(Math.abs(b.turn!.to - b.turn!.from) <= 180);
  assert.ok(b.turn!.seconds >= a.turn!.seconds);
  const end = done + b.turn!.seconds * 1000 + 1;
  assert.equal(Math.abs(angleDelta(RoomStore.ringAt(end), ringAngleFor("studio"))) < 1e-9, true);
  // mid-turn, the ring is between
  const c = RoomStore.goTo("kitchen", end);
  const mid = RoomStore.ringAt(end + (c.turn!.seconds * 1000) / 2);
  assert.ok(mid !== c.turn!.from && mid !== c.turn!.to);
  // stage and plan keep the section; an unknown part is refused
  RoomStore.goTo("stage", end + 10_000);
  assert.equal(RoomStore.get().section, "kitchen");
  assert.throws(() => RoomStore.goTo("garage" as never));
  RoomStore.reset();
});

test("she walks around what stands, in world units, only while the room is there", () => {
  RoomStore.reset();
  assert.deepEqual(roomObstaclesWorld(), []);
  const unmount = mountRoom({ centre: [0, 2.2], floorY: -2.55, unitsPerMetre: 2 });
  const world = roomObstaclesWorld();
  const local = roomObstacles(RoomStore.get().ring, "lounge");
  assert.equal(world.length, local.length);
  assert.ok(world.length > 0);
  assert.equal(world[0].x, local[0].x * 2);
  assert.equal(world[0].z, 2.2 + local[0].z * 2);
  // hanging pieces are not in her way
  assert.ok(!world.some((o) => o.id.includes("chandelier")));
  RoomStore.goTo("stage");
  assert.deepEqual(roomObstaclesWorld(), []);
  unmount();
  RoomStore.reset();
});

test("the person's words choose the part of the room", () => {
  assert.equal(modeFromText("take me to the kitchen"), "kitchen");
  assert.equal(modeFromText("let's watch a movie"), "theater");
  assert.equal(modeFromText("I need a bath"), "bathroom");
  assert.equal(modeFromText("show me the floor plan"), "plan");
  assert.equal(modeFromText("go to your creator studio"), "studio");
  assert.equal(modeFromText("back to the lounge"), "lounge");
  assert.equal(modeFromText("clear the room"), "stage");
  assert.equal(modeFromText("hello there"), null);
});

test("LÉLU turns her room with world.room", async () => {
  RoomStore.reset();
  assert.ok(WORLD_TOOLS.some((t) => t.id === "world.room"));
  const exec = WORLD_EXECUTORS.find((e) => e.id === "world.room")!;
  const turned = await exec.run({ section: "bedroom" });
  assert.equal(turned.ok, true);
  assert.equal(RoomStore.get().section, "bedroom");
  const fromWords = await exec.run({ request: "let's have dinner" });
  assert.equal(fromWords.ok, true);
  assert.equal(RoomStore.get().section, "kitchen");
  const unclear = await exec.run({ request: "somewhere nice" });
  assert.equal(unclear.ok, false);
  RoomStore.reset();
});
