import { GOLDEN_ANGLE } from "../src/core/geometry/golden/index.ts";
import { cloudFrom, PointIndex, cloudSize } from "../src/core/asre/lelu2/pointcloud.ts";
import { selectAll } from "../src/core/asre/lelu2/distributions.ts";
const pts: number[] = [];
const R = 0.05, count = 24000;
for (let k = 0; k < count; k++) {
  const c = 1 - (2 * (k + 0.5)) / count;
  const r = Math.sqrt(Math.max(0, 1 - c * c));
  const az = k * GOLDEN_ANGLE;
  pts.push(R * r * Math.cos(az), R * c, R * r * Math.sin(az));
}
const cloud = cloudFrom(pts, "sphere");
const index = new PointIndex(cloud);
console.log("cloud", cloudSize(cloud), "cell", index.cell.toFixed(5));
const probe = index.nearestUnused(0.03, 0.02, 0.03, new Set([0,1,2]));
console.log("nearestUnused probe", probe);
for (const s of selectAll(cloud, 800, index)) console.log(s.id, s.achieved, "/", s.requested, "attempts", s.attempts, s.ms.toFixed(0) + "ms");
