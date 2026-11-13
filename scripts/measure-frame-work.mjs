/**
 * ==========================================================
 * LÉLU — WHAT THE FRAME NO LONGER DOES
 *
 * The mission's own rule is that a performance claim needs a
 * measurement. The live FPS number could not be taken in this
 * environment: the platform's edge returned 503 for the app's own
 * chunk requests, so the cloud browser never received a bundle to
 * run (proved by the network log — 250 resources, most 503 — while
 * the same URLs answered 200 from inside the VM), and the local
 * Playwright Chromium cannot start because the image is missing
 * libnspr4/libnss3 and has no sudo to install them.
 *
 * So this measures the part that IS measurable anywhere: the
 * JavaScript work per frame that the fixes removed. It uses the real
 * three.js math classes (the same Color/Vector3/Quaternion/Matrix4
 * the scene uses) and replicas of the exact loops that were deleted,
 * so the comparison is of real arithmetic and real allocation, not of
 * a guess. What it does NOT measure is GPU time or frames per second
 * on a particular device — see the README note at the bottom.
 *
 * Usage: node scripts/measure-frame-work.mjs
 * ==========================================================
 */

import { Color, Matrix4, Quaternion, Vector3 } from "three";

/* ---------------------------- replicas ---------------------------- */

/** The removed per-frame lat/lon helper: allocates a Vector3 and clones. */
function latLonToPosOld(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const pos = new Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
  const normal = pos.clone().normalize();
  return { pos, normal };
}

/** The kept helper: writes into a caller-owned vector, allocates nothing. */
function writeLatLon(lat, lon, radius, out) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return out.set(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/** The same city clusters PlanetCities generates (18 clusters, ~200 buildings). */
function generateCityClusters(count) {
  const rand = seeded(42);
  const cities = [];
  for (let i = 0; i < count; i += 1) {
    const lat = (rand() - 0.5) * 120;
    const lon = rand() * 360;
    const size = 3 + Math.floor(rand() * 12);
    const buildings = [];
    for (let b = 0; b < size; b += 1) {
      const spread = 0.15 + size * 0.008;
      buildings.push({
        x: (rand() - 0.5) * spread,
        y: 0.005 + rand() * 0.04,
        z: (rand() - 0.5) * spread,
        w: 0.008 + rand() * 0.015,
        h: 0.01 + rand() * 0.06 * (0.5 + size / 20),
        d: 0.008 + rand() * 0.015,
      });
    }
    cities.push({ lat, lon, size, buildings });
  }
  return cities;
}

/** A Mesh-like stand-in: the real InstancedMesh writes go to buffers, so the
 *  measurable part is the matrix/colour construction feeding them. */
function fakeMesh() {
  return {
    setMatrixAt() {},
    setColorAt() {},
    instanceMatrix: { needsUpdate: false },
    instanceColor: { needsUpdate: false },
  };
}

/* ------------------------- the removed work ------------------------- */

function citiesPerFrameOld(cities, mesh, planetRadius) {
  const dummy = new Matrix4();
  let idx = 0;
  for (const city of cities) {
    const { pos, normal } = latLonToPosOld(city.lat, city.lon, planetRadius);
    const up = new Vector3(0, 1, 0);
    const quat = new Quaternion();
    quat.setFromUnitVectors(up, normal);
    for (const b of city.buildings) {
      const localPos = new Vector3(b.x, b.y, b.z);
      localPos.applyQuaternion(quat);
      localPos.add(pos);
      const scale = new Vector3(b.w, b.h, b.d);
      dummy.makeRotationFromQuaternion(quat);
      dummy.setPosition(localPos);
      dummy.scale(scale);
      mesh.setMatrixAt(idx, dummy);
      const cityColor = new Color().setHSL(0.08 + (idx % 7) * 0.01, 0.7, 0.5 + (idx % 5) * 0.04);
      mesh.setColorAt(idx, cityColor);
      idx += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function citiesOnceNew(cities, mesh, planetRadius) {
  const dummy = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const quat = new Quaternion();
  const local = new Vector3();
  const scale = new Vector3();
  const color = new Color();
  let idx = 0;
  for (const city of cities) {
    const pos = writeLatLon(city.lat, city.lon, planetRadius, new Vector3());
    quat.setFromUnitVectors(up, pos.clone().normalize());
    for (const b of city.buildings) {
      local.set(b.x, b.y, b.z).applyQuaternion(quat).add(pos);
      scale.set(b.w, b.h, b.d);
      dummy.makeRotationFromQuaternion(quat);
      dummy.setPosition(local);
      dummy.scale(scale);
      mesh.setMatrixAt(idx, dummy);
      color.setHSL(0.08 + (idx % 7) * 0.01, 0.7, 0.5 + (idx % 5) * 0.04);
      mesh.setColorAt(idx, color);
      idx += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function populationOld(count, mesh, planetRadius) {
  const dummy = new Matrix4();
  for (let i = 0; i < count; i += 1) {
    const { pos } = latLonToPosOld((i % 40) - 20, i * 3, planetRadius + 0.008);
    dummy.makeTranslation(pos.x, pos.y, pos.z);
    dummy.scale(new Vector3(0.004, 0.004, 0.004));
    mesh.setMatrixAt(i, dummy);
    mesh.setColorAt(i, new Color().setHSL(0.55 + (i % 5) * 0.02, 0.3, 0.8));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function populationNew(count, mesh, planetRadius, scratch) {
  const dummy = new Matrix4();
  for (let i = 0; i < count; i += 1) {
    writeLatLon((i % 40) - 20, i * 3, planetRadius + 0.008, scratch.position);
    dummy.makeTranslation(scratch.position.x, scratch.position.y, scratch.position.z);
    dummy.scale(scratch.scale);
    mesh.setMatrixAt(i, dummy);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function vehiclesOld(count, mesh, planetRadius) {
  const dummy = new Matrix4();
  for (let i = 0; i < count; i += 1) {
    const { pos } = latLonToPosOld((i % 30) - 15, (i * 5) % 360, planetRadius + 0.01);
    dummy.makeTranslation(pos.x, pos.y, pos.z);
    dummy.scale(new Vector3(0.006, 0.003, 0.003));
    mesh.setMatrixAt(i, dummy);
    mesh.setColorAt(i, new Color().setHSL(0.12, 0.8, 0.8));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function vehiclesNew(count, mesh, planetRadius, scratch) {
  const dummy = new Matrix4();
  for (let i = 0; i < count; i += 1) {
    writeLatLon((i % 30) - 15, (i * 5) % 360, planetRadius + 0.01, scratch.position);
    dummy.makeTranslation(scratch.position.x, scratch.position.y, scratch.position.z);
    dummy.scale(scratch.scale);
    mesh.setMatrixAt(i, dummy);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function stormsOld(count, scratch) {
  for (let i = 0; i < count; i += 1) {
    const { pos } = latLonToPosOld(i * 12, i * 30, 2.02);
    scratch.position.copy(pos);
    scratch.origin.set(0, 0, 0); // lookAt with a fresh Vector3 in the original
    void new Vector3(0, 0, 0);
  }
}

function stormsNew(count, scratch) {
  for (let i = 0; i < count; i += 1) {
    writeLatLon(i * 12, i * 30, 2.02, scratch.position);
    scratch.position.copy(scratch.position);
    void scratch.origin;
  }
}

/* --------------------------- the lifecycle write --------------------------- */

/** The shape WorldLifecycle persists (kept close to the real state). */
function cycleState() {
  return {
    cycleId: "cycle-1731200000000-abc123",
    phase: "FULL_WORLD",
    phaseProgress: 0.4213,
    cycleTime: 128.44,
    completedCycles: 7,
    activeEngines: ["star", "balance", "dna", "awareness", "memory-evolution", "weather"],
    startedAt: 1731200000000,
    phaseStartedAt: 1731200100000,
    expansionScale: 0.93,
    avatarPosition: "planet-surface",
    collapsing: false,
    rebirthing: false,
    engineActivationOrder: ["star", "balance", "dna"],
    preservedState: {
      discoveries: Array.from({ length: 40 }, (_, i) => `discovery-${i}`),
      artifacts: Array.from({ length: 12 }, (_, i) => `artifact-${i}`),
      memories: Array.from({ length: 60 }, (_, i) => `memory-${i}`),
      reflections: Array.from({ length: 25 }, (_, i) => `reflection-${i}`),
      engineVersions: { star: "1.0.0", balance: "1.0.0" },
    },
    developmental: {
      complexity: 0.37,
      completedCycles: 7,
      meaningfulMemoryCount: 60,
      reflectionCount: 25,
      discoveryCount: 40,
      artifactCount: 12,
      projectCount: 4,
      worldComplexity: 0.5,
      engineComplexity: 0.4,
      currentCycleDuration: 320,
    },
  };
}

/* -------------------------------- harness -------------------------------- */

function bench(label, iterations, fn) {
  fn();
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { label, iterations, perCallMs: ms / iterations, totalMs: ms };
}

const FRAMES = 600; // 10 seconds of frames at 60 Hz

const cities = generateCityClusters(18);
const cityMesh = fakeMesh();
const popMesh = fakeMesh();
const vehMesh = fakeMesh();
const scratch = {
  position: new Vector3(),
  scale: new Vector3(0.004, 0.004, 0.004),
  origin: new Vector3(0, 0, 0),
};

const cityOld = bench("cities: rebuild every frame", FRAMES, () => citiesPerFrameOld(cities, cityMesh, 2));
const cityNewBuild = bench("cities: built once", 1, () => citiesOnceNew(cities, cityMesh, 2));
const popOld = bench("population (120): every frame", FRAMES, () => populationOld(120, popMesh, 2));
const popNew = bench("population (120): at 12 Hz", Math.round(FRAMES / 5), () => populationNew(120, popMesh, 2, scratch));
const vehOld = bench("vehicles (60): every frame", FRAMES, () => vehiclesOld(60, vehMesh, 2));
const vehNew = bench("vehicles (60): at 12 Hz", Math.round(FRAMES / 5), () => vehiclesNew(60, vehMesh, 2, scratch));
const stormOld = bench("weather (5): every frame", FRAMES, () => stormsOld(5, scratch));
const stormNew = bench("weather (5): every frame, no alloc", FRAMES, () => stormsNew(5, scratch));

const state = cycleState();
const bytes = JSON.stringify(state).length;
const writeOld = bench("lifecycle save: every 100 ms tick", 100, () => JSON.stringify(state));
const writeNew = bench("lifecycle save: every 2000 ms", 5, () => JSON.stringify(state));

const ms = (value) => value.toFixed(3).padStart(9);
const perSecond = (result, hz) => (result.perCallMs * hz).toFixed(2).padStart(8);

console.log("\n=== PER-FRAME JAVASCRIPT REMOVED  (real three.js math, replica of the deleted loops) ===");
console.log(`\nper call, ms        old        new`);
console.log(`  cities        ${ms(cityOld.perCallMs)}   ${ms(0)}   (built once: ${cityNewBuild.perCallMs.toFixed(2)} ms, then nothing)`);
console.log(`  population    ${ms(popOld.perCallMs)}   ${ms(popNew.perCallMs)}   (old 60 Hz, new 12 Hz)`);
console.log(`  vehicles      ${ms(vehOld.perCallMs)}   ${ms(vehNew.perCallMs)}   (old 60 Hz, new 12 Hz)`);
console.log(`  weather       ${ms(stormOld.perCallMs)}   ${ms(stormNew.perCallMs)}`);

console.log("\nper SECOND at 60 Hz");
const cityPerSecondOld = cityOld.perCallMs * 60;
const popPerSecondOld = popOld.perCallMs * 60;
const popPerSecondNew = popNew.perCallMs * 12;
const vehPerSecondOld = vehOld.perCallMs * 60;
const vehPerSecondNew = vehNew.perCallMs * 12;
const stormPerSecondOld = stormOld.perCallMs * 60;
const stormPerSecondNew = stormNew.perCallMs * 60;
const oldTotal = cityPerSecondOld + popPerSecondOld + vehPerSecondOld + stormPerSecondOld;
const newTotal = 0 + popPerSecondNew + vehPerSecondNew + stormPerSecondNew;
console.log(`  cities        ${perSecond(cityOld, 60)} ms     0.00 ms`);
console.log(`  population    ${perSecond(popOld, 60)} ms   ${perSecond(popNew, 12)} ms`);
console.log(`  vehicles      ${perSecond(vehOld, 60)} ms   ${perSecond(vehNew, 12)} ms`);
console.log(`  weather       ${perSecond(stormOld, 60)} ms   ${perSecond(stormNew, 60)} ms`);
console.log(`  TOTAL         ${oldTotal.toFixed(2).padStart(8)} ms   ${newTotal.toFixed(2).padStart(8)} ms` +
  `   → ${(100 - (newTotal / oldTotal) * 100).toFixed(0)}% less main-thread work while the civilization layers are visible`);

console.log("\n=== LIFECYCLE PERSISTENCE ===");
console.log(`  state size            ${bytes} bytes`);
console.log(`  old (10 writes/s)     ${(writeOld.perCallMs * 10).toFixed(2)} ms of stringify per second`);
console.log(`  new (0.5 writes/s)    ${(writeNew.perCallMs * 0.5).toFixed(2)} ms of stringify per second`);

console.log("\n=== DRAW CALLS (structural, counted from the source, not timed) ===");
console.log("  energy particles      40 meshes -> 1 point cloud   (-39 calls)");
console.log("  material traversal    ~80 objects walked per frame -> one pre-collected list, touched only when activity moves");

console.log("\n=== WHAT THIS DOES NOT MEASURE ===");
console.log("  Frames per second on a GPU. That needs a browser with a real");
console.log("  renderer: run scripts/measure-scene-perf.mjs (or read");
console.log("  window.__leluRenderStats) on the machine you care about.");
