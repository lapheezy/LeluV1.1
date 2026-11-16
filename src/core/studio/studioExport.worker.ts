/**
 * LÉLU — Creation Studio export worker.
 *
 * Writing a file, re-opening it and hashing it are CPU work; on the main
 * thread they competed with the Cosmos scene for every frame and a deck
 * took minutes. Here they run off the main thread. The result is the
 * same ExportResult the direct path returns; the bytes are transferred,
 * not copied.
 */

import { exportArtifact, type ExportResult } from "./StudioExport";
import type { ArtifactSpec, ExportFormat } from "./StudioTypes";

interface Request { id: number; spec: ArtifactSpec; format: ExportFormat }
type Reply = { id: number; ok: true; result: ExportResult } | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, spec, format } = event.data;
  try {
    const result = await exportArtifact(spec, format);
    const reply: Reply = { id, ok: true, result };
    (self as unknown as Worker).postMessage(reply, [result.bytes.buffer]);
  } catch (error) {
    const reply: Reply = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
    (self as unknown as Worker).postMessage(reply);
  }
};
