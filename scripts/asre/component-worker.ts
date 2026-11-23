/** Worker thread: builds one character component and transfers its buffers back. */
import { parentPort } from "node:worker_threads";
import { buildComponent, plan, type Lattice } from "../../src/core/asre/character/build.ts";
import type { CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import type { ComponentId } from "../../src/core/asre/character/components.ts";

parentPort!.on("message", (msg: { jobId: number; spec: CharacterSpec; id: ComponentId; lattice: Lattice }) => {
  const t0 = performance.now();
  const p = plan(msg.spec, msg.lattice);
  const c = buildComponent(msg.id, p, null, msg.lattice);
  const l = c.local!;
  const transfer = [l.cells.buffer, l.mesh.positions.buffer, l.mesh.indices.buffer, ...(l.mesh.colors ? [l.mesh.colors.buffer] : []), ...(l.mesh.normals ? [l.mesh.normals.buffer] : [])];
  parentPort!.postMessage({ jobId: msg.jobId, component: c, workerMs: performance.now() - t0 }, transfer as ArrayBuffer[]);
});
