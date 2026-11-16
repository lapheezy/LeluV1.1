/**
 * Rift Runner 3D — the world, as pure logic.
 *
 * The renderer never decides anything: movement, collision, pickups, the
 * gate and the quest all live here, where Node can test them without a
 * GPU. `main.js` draws this state and feeds it input.
 */

export const WORLD = { half: 16, playerRadius: 0.45, speed: 7 };

export const OBSTACLES = [
  { id: "pillar-a", x: -5, z: -2, w: 2.4, d: 2.4 },
  { id: "pillar-b", x: 4.5, z: -6, w: 1.8, d: 3.6 },
  { id: "wall-a", x: 0, z: -11, w: 10, d: 1.2 },
  { id: "crate-a", x: 7, z: 4, w: 2.2, d: 2.2 },
  { id: "pillar-c", x: -9, z: 8, w: 1.6, d: 1.6 },
];

export const SHARDS = [
  { id: "shard-1", x: -8, z: 5 },
  { id: "shard-2", x: 9, z: -4 },
  { id: "shard-3", x: -11, z: -8 },
  { id: "shard-4", x: 2, z: 11 },
];

export const NPC = { id: "keeper", x: -2, z: 3, radius: 2.4 };

export const GATE = { id: "gate", x: 12, z: -12, w: 3.4, d: 1.2, required: 4 };

export const SHARD_RADIUS = 1.05;
export const WIN_RADIUS = 2.1;

export function createState() {
  return {
    player: { x: 0, z: 8 },
    yaw: 0,
    shards: SHARDS.map((shard) => ({ ...shard, collected: false })),
    gateOpen: false,
    won: false,
    npcNear: false,
    dialogue: null,
    quest: "intro",
    collisions: 0,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function circleIntersectsRect(px, pz, radius, rect) {
  const halfW = rect.w / 2;
  const halfD = rect.d / 2;
  const closestX = clamp(px, rect.x - halfW, rect.x + halfW);
  const closestZ = clamp(pz, rect.z - halfD, rect.z + halfD);
  const dx = px - closestX;
  const dz = pz - closestZ;
  return dx * dx + dz * dz < radius * radius;
}

/** Is a position inside the world and clear of geometry? */
export function isBlocked(state, x, z) {
  if (Math.abs(x) > WORLD.half - WORLD.playerRadius) return true;
  if (Math.abs(z) > WORLD.half - WORLD.playerRadius) return true;
  for (const obstacle of OBSTACLES) {
    if (circleIntersectsRect(x, z, WORLD.playerRadius, obstacle)) return true;
  }
  if (!state.gateOpen && circleIntersectsRect(x, z, WORLD.playerRadius, GATE)) return true;
  return false;
}

/**
 * Move with axis-separated resolution, so sliding along a wall works
 * instead of sticking. Returns a new state; the old one is untouched.
 */
export function movePlayer(state, dx, dz) {
  const next = { ...state, player: { ...state.player }, collisions: state.collisions };
  const stepX = isBlocked(state, next.player.x + dx, next.player.z) ? 0 : dx;
  if (stepX === 0 && dx !== 0) next.collisions += 1;
  next.player.x += stepX;

  const stepZ = isBlocked(state, next.player.x, next.player.z + dz) ? 0 : dz;
  if (stepZ === 0 && dz !== 0) next.collisions += 1;
  next.player.z += stepZ;

  next.player.x = clamp(next.player.x, -WORLD.half + WORLD.playerRadius, WORLD.half - WORLD.playerRadius);
  next.player.z = clamp(next.player.z, -WORLD.half + WORLD.playerRadius, WORLD.half - WORLD.playerRadius);
  return next;
}

/** Pick up every shard within reach. */
export function collectNearby(state) {
  let collectedAny = false;
  const shards = state.shards.map((shard) => {
    if (shard.collected) return shard;
    const dx = shard.x - state.player.x;
    const dz = shard.z - state.player.z;
    if (Math.sqrt(dx * dx + dz * dz) <= SHARD_RADIUS) {
      collectedAny = true;
      return { ...shard, collected: true };
    }
    return shard;
  });
  const count = shards.filter((shard) => shard.collected).length;
  const gateOpen = count >= GATE.required;
  return {
    ...state,
    shards,
    gateOpen,
    quest: gateOpen ? "gate" : count > 0 ? "collect" : state.quest,
    dialogue: collectedAny ? null : state.dialogue,
  };
}

export function shardCount(state) {
  return state.shards.filter((shard) => shard.collected).length;
}

export function interact(state) {
  if (state.dialogue) return { ...state, dialogue: null };
  const dx = NPC.x - state.player.x;
  const dz = NPC.z - state.player.z;
  const near = Math.sqrt(dx * dx + dz * dz) <= NPC.radius;
  if (!near) return state;
  const count = shardCount(state);
  const line = state.gateOpen
    ? "The rift gate is open. Walk into it and end this."
    : count === 0
      ? "Four shards fell when the rift opened. Bring them back, runner."
      : `You carry ${count}. ${GATE.required - count} still out there.`;
  return { ...state, dialogue: line, npcNear: true, quest: state.gateOpen ? "gate" : "collect" };
}

export function updateNpc(state) {
  const dx = NPC.x - state.player.x;
  const dz = NPC.z - state.player.z;
  return { ...state, npcNear: Math.sqrt(dx * dx + dz * dz) <= NPC.radius };
}

/** Did the player walk into the open gate? */
export function checkWin(state) {
  if (!state.gateOpen || state.won) return state;
  const dx = GATE.x - state.player.x;
  const dz = GATE.z - state.player.z;
  if (Math.sqrt(dx * dx + dz * dz) <= WIN_RADIUS) {
    return { ...state, won: true, dialogue: null, quest: "won" };
  }
  return state;
}

/** One frame: input is {x, y} in [-1, 1]; dt in seconds. */
export function step(state, input, dt) {
  if (state.won) return state;
  const length = Math.hypot(input.x, input.y);
  const scale = length > 1 ? 1 / length : 1;
  const distance = WORLD.speed * Math.max(0, Math.min(dt, 0.1));
  const dx = input.x * scale * distance;
  const dz = input.y * scale * distance;
  let next = dx === 0 && dz === 0 ? state : movePlayer(state, dx, dz);
  if (dx !== 0 || dz !== 0) {
    next = { ...next, yaw: Math.atan2(dx, dz + 0.0001) };
  }
  next = collectNearby(next);
  next = updateNpc(next);
  next = checkWin(next);
  return next;
}

export function questLabel(state) {
  if (state.won) return "Rift closed";
  if (state.gateOpen) return "Enter the open gate";
  if (shardCount(state) > 0) return `Recover the shards (${shardCount(state)}/4)`;
  if (state.quest === "intro") return "Speak to the Keeper";
  return "Find the four shards";
}
