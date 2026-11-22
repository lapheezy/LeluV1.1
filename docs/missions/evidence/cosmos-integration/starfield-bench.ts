// Run: NODE_PATH=node_modules npx tsx docs/missions/evidence/cosmos-integration/starfield-bench.ts
// The old per-frame star-field work (CosmosLayer before) vs the new (in-place colours only).
import { BufferAttribute, BufferGeometry, Color } from "three";
import InfiniteCosmos from "../../../../src/app/scene/genesis/engines/InfiniteCosmos";
const c = InfiniteCosmos.getInstance();
c.preloadAround(0, 0, 0);
const stars = c.getRenderableData().stars;
const g = new BufferGeometry();
function oldFrame(t: number) {
  const count = stars.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = stars[i];
    positions[i * 3] = s.x; positions[i * 3 + 1] = s.y; positions[i * 3 + 2] = s.z - 25;
    const col = new Color().setHSL(s.hue / 360, 0.6, s.brightness * (0.7 + 0.3 * Math.sin(t * s.twinkleSpeed + s.twinklePhase)));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setAttribute("color", new BufferAttribute(colors, 3));
}
const colorAttr = new BufferAttribute(new Float32Array(stars.length * 3), 3);
const scratch = new Color();
function newFrame(t: number) {
  const colors = colorAttr.array as Float32Array;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    scratch.setHSL(s.hue / 360, 0.6, s.brightness * (0.7 + 0.3 * Math.sin(t * s.twinkleSpeed + s.twinklePhase)));
    colors[i * 3] = scratch.r; colors[i * 3 + 1] = scratch.g; colors[i * 3 + 2] = scratch.b;
  }
  colorAttr.needsUpdate = true;
}
function bench(name: string, fn: (t: number) => void) {
  for (let i = 0; i < 200; i++) fn(i / 60);
  const N = 2000; const t0 = performance.now();
  for (let i = 0; i < N; i++) fn(i / 60);
  const ms = (performance.now() - t0) / N;
  console.log(`${name}: ${stars.length} stars, ${ms.toFixed(3)} ms/frame, GPU bytes re-uploaded/frame: ${name === "old" ? stars.length * 24 : stars.length * 12}`);
}
bench("old", oldFrame); bench("new", newFrame);
