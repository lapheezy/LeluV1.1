import * as THREE from "../vendor/three.module.js";
import {
  GATE,
  NPC,
  OBSTACLES,
  SHARDS,
  createState,
  interact,
  isBlocked,
  questLabel,
  shardCount,
  step,
} from "./logic.js";

const app = document.getElementById("app");
const questEl = document.getElementById("quest");
const shardsEl = document.getElementById("shards");
const dialogueEl = document.getElementById("dialogue");
const dialogueText = document.getElementById("dialogue-text");
const winEl = document.getElementById("win");
const againEl = document.getElementById("again");
const interactEl = document.getElementById("interact");
const hintEl = document.getElementById("hint");

let state = createState();
const keys = new Set();
const touch = { up: false, down: false, left: false, right: false };

/* ------------------------------- renderer ------------------------------ */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch (error) {
  const message = document.createElement("p");
  message.style.cssText = "padding:2rem;color:#e7eefc;font-family:system-ui";
  message.textContent = `This browser could not start WebGL, so the 3D world cannot render: ${error.message}`;
  app.replaceChildren(message);
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
app.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04070f);
scene.fog = new THREE.Fog(0x04070f, 24, 46);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0, 9, 17);

scene.add(new THREE.HemisphereLight(0x93c5fd, 0x0b1120, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(8, 16, 10);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -24;
key.shadow.camera.right = 24;
key.shadow.camera.top = 24;
key.shadow.camera.bottom = -24;
scene.add(key);
const rim = new THREE.PointLight(0x22d3ee, 40, 40, 2);
rim.position.set(-10, 6, -10);
scene.add(rim);

/* --------------------------------- world ------------------------------- */

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(30, 64),
  new THREE.MeshStandardMaterial({ color: 0x0a1424, roughness: 0.9, metalness: 0.1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(32, 32, 0x1e3a5f, 0x11213a);
grid.position.y = 0.01;
scene.add(grid);

const obstacleMeshes = new Map();
for (const obstacle of OBSTACLES) {
  const geometry = new THREE.BoxGeometry(obstacle.w, 2.4, obstacle.d);
  const material = new THREE.MeshStandardMaterial({
    color: 0x16243c,
    emissive: 0x0b3b52,
    emissiveIntensity: 0.7,
    roughness: 0.5,
    metalness: 0.3,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(obstacle.x, 1.2, obstacle.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 }),
  );
  mesh.add(edges);
  obstacleMeshes.set(obstacle.id, mesh);
}

const shardMeshes = new Map();
for (const shard of SHARDS) {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshStandardMaterial({
      color: 0xfcd34d,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.5,
    }),
  );
  mesh.position.set(shard.x, 1.1, shard.z);
  mesh.castShadow = true;
  const halo = new THREE.PointLight(0xfcd34d, 6, 5, 2);
  mesh.add(halo);
  scene.add(mesh);
  shardMeshes.set(shard.id, mesh);
}

const gateGroup = new THREE.Group();
gateGroup.position.set(GATE.x, 0, GATE.z);
const gateRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.7, 0.14, 12, 48),
  new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    emissive: 0x0e7490,
    emissiveIntensity: 0.6,
    metalness: 0.7,
    roughness: 0.35,
  }),
);
gateRing.position.y = 2;
gateGroup.add(gateRing);
const gateBarrier = new THREE.Mesh(
  new THREE.PlaneGeometry(GATE.w, 3.2),
  new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
);
gateBarrier.position.y = 1.6;
gateBarrier.rotation.y = Math.PI / 2;
gateGroup.add(gateBarrier);
scene.add(gateGroup);

const npcGroup = new THREE.Group();
npcGroup.position.set(NPC.x, 0, NPC.z);
const npcBody = new THREE.Mesh(
  new THREE.ConeGeometry(0.55, 1.8, 6),
  new THREE.MeshStandardMaterial({ color: 0x4c1d95, emissive: 0x7c3aed, emissiveIntensity: 0.7, roughness: 0.4 }),
);
npcBody.position.y = 0.9;
npcBody.castShadow = true;
npcGroup.add(npcBody);
const npcHalo = new THREE.Mesh(
  new THREE.TorusGeometry(0.8, 0.035, 8, 40),
  new THREE.MeshBasicMaterial({ color: 0xa78bfa }),
);
npcHalo.rotation.x = Math.PI / 2;
npcHalo.position.y = 0.08;
npcGroup.add(npcHalo);
scene.add(npcGroup);

/* -------------------------------- player ------------------------------- */

const playerGroup = new THREE.Group();
const playerBody = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.42, 0.9, 6, 12),
  new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x0e7490, emissiveIntensity: 0.5, roughness: 0.35 }),
);
playerBody.position.y = 1;
playerBody.castShadow = true;
playerGroup.add(playerBody);
const playerRing = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.7, 32),
  new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
);
playerRing.rotation.x = -Math.PI / 2;
playerRing.position.y = 0.03;
playerGroup.add(playerRing);
scene.add(playerGroup);

// Session 3B asset: the character reference card, used as a billboard
// texture above the procedural figure until a rigged GLB exists.
const textureLoader = new THREE.TextureLoader();
textureLoader.load(
  "./assets/character-card.png",
  (texture) => {
    const card = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.92 }),
    );
    card.scale.set(1.35, 1.9, 1);
    card.position.set(0, 2.7, 0);
    playerGroup.add(card);
  },
  undefined,
  () => {
    if (hintEl) hintEl.textContent = "Character card art unavailable; the figure is procedural.";
  },
);

/* --------------------------------- input ------------------------------- */

const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [0, 1], ArrowRight: [1, 0],
};

window.addEventListener("keydown", (event) => {
  if (event.code === "KeyE") {
    applyInteraction();
    return;
  }
  if (MOVE_KEYS[event.code]) {
    keys.add(event.code);
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

for (const button of document.querySelectorAll("[data-move]")) {
  const direction = button.getAttribute("data-move");
  const set = (value) => {
    if (direction) touch[direction] = value;
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    set(true);
  });
  button.addEventListener("pointerup", () => set(false));
  button.addEventListener("pointercancel", () => set(false));
  button.addEventListener("pointerleave", () => set(false));
}

interactEl?.addEventListener("click", applyInteraction);

function applyInteraction() {
  state = interact(state);
  renderHud();
}

/* A slow orbit of the camera with the pointer: look, not control. */
let cameraYaw = 0;
let dragging = false;
let lastX = 0;
renderer.domElement.addEventListener("pointerdown", (event) => {
  dragging = true;
  lastX = event.clientX;
});
window.addEventListener("pointerup", () => (dragging = false));
window.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  cameraYaw -= (event.clientX - lastX) * 0.005;
  lastX = event.clientX;
});

function inputVector() {
  let x = 0;
  let z = 0;
  for (const code of keys) {
    const [dx, dz] = MOVE_KEYS[code] ?? [0, 0];
    x += dx;
    z += dz;
  }
  if (touch.left) x -= 1;
  if (touch.right) x += 1;
  if (touch.up) z -= 1;
  if (touch.down) z += 1;
  return { x, y: z };
}

/* --------------------------------- HUD --------------------------------- */

function renderHud() {
  if (questEl) questEl.textContent = questLabel(state);
  if (shardsEl) shardsEl.textContent = String(shardCount(state));
  if (dialogueEl) {
    dialogueEl.hidden = !state.dialogue;
    if (state.dialogue) dialogueText.textContent = state.dialogue;
  }
  if (winEl) winEl.hidden = !state.won;
  if (gateBarrier) gateBarrier.visible = !state.gateOpen;
}

againEl?.addEventListener("click", () => {
  state = createState();
  renderHud();
});

/* --------------------------------- loop -------------------------------- */

const clock = new THREE.Clock();
const forward = new THREE.Vector3();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  state = step(state, inputVector(), dt);

  playerGroup.position.set(state.player.x, 0, state.player.z);
  playerGroup.rotation.y = state.yaw;

  cameraYaw += dt * 0.035;
  const targetX = state.player.x + Math.sin(cameraYaw) * 15;
  const targetZ = state.player.z + Math.cos(cameraYaw) * 15;
  camera.position.x += (targetX - camera.position.x) * Math.min(1, dt * 2.4);
  camera.position.z += (targetZ - camera.position.z) * Math.min(1, dt * 2.4);
  camera.position.y += (9 - camera.position.y) * Math.min(1, dt * 2);
  forward.set(state.player.x, 1.2, state.player.z);
  camera.lookAt(forward);

  for (const shard of state.shards) {
    const mesh = shardMeshes.get(shard.id);
    if (!mesh) continue;
    mesh.visible = !shard.collected;
    mesh.rotation.y += dt * 1.6;
    mesh.position.y = 1.1 + Math.sin(elapsed * 2 + shard.x) * 0.12;
  }

  gateRing.rotation.z += dt * 0.6;
  gateRing.material.emissiveIntensity = state.gateOpen ? 1.8 + Math.sin(elapsed * 3) * 0.4 : 0.25;
  gateBarrier.material.opacity = state.gateOpen ? 0.08 : 0.22;
  npcHalo.scale.setScalar(1 + Math.sin(elapsed * 2) * 0.05);
  playerBody.position.y = 1 + Math.abs(Math.sin(elapsed * 6)) * (state.won ? 0 : 0.04);

  renderHud();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* The floor is a real collision boundary; expose it for one honest check. */
if (isBlocked(createState(), 0, 0)) {
  hintEl.textContent = "The world failed its spawn check.";
}

renderHud();
animate();
