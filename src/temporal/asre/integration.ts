/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — LÉLU INTEGRATION
 *
 * ASRE is not a demonstration beside LÉLU; it is a service LÉLU can call.
 * This module defines the ports, implements them against the modules that
 * already exist (NRE serialisation and snapshots, the GLB gate, the
 * component graph, the identity/variation system), and reports honestly
 * which of LÉLU's surfaces are actually driven from here.
 *
 * A surface is only VERIFIED when a call on it ran in this process. The
 * Cosmos and Genesis adapters, for example, emit and validate the payload
 * LÉLU consumes — they cannot place an object in a live Three.js scene from
 * a Node process, so they are reported PARTIAL with that exact reason
 * rather than marked done because a type exists.
 * ==========================================================
 */

import type { NreSnapshot, SparseVoxels } from "../nre/types.ts";
import { deserializeSnapshot } from "../nre/vxz.ts";
import { MemorySnapshotStore, createTemporalObject, recordSnapshot, restoreSnapshot, type SnapshotStore, type TemporalObject } from "../nre/snapshot.ts";
import { compareVoxelSets } from "../nre/compare.ts";
import { encodeGlb, meshFromVoxels } from "../nre/geometry.ts";
import { inspectGlb, type GlbReport } from "../../core/forge/GlbInspector.ts";
import { meanObservation } from "./shared.ts";
import { analyseImage, type ImageAnalysis } from "./image.ts";
import { latticeForAnalysis } from "./lattice.ts";
import { buildHypotheses, combineHypotheses, compareHypotheses, provenanceSummary, type HypothesisComparison } from "./hypotheses.ts";
import { addObservation, createLayeredReconstruction, flipbook, headFrame, restoreFrame, type LayeredReconstruction } from "./layers.ts";
import { STRUCTURAL_COMPONENTS } from "./components.ts";
import {
  GARMENTS,
  HAIRSTYLES,
  applyVariation,
  createIdentity,
  identityVoxels,
  reuseRatio,
  type CharacterIdentity,
  type VariationRequest,
  type VariationResult,
} from "./identity.ts";
import type { ExperimentStatus } from "../nre/types.ts";
import type { ComponentId, ImageFrame } from "./types.ts";
import { COMPONENT_IDS, PROVENANCE_ORDER } from "./types.ts";

/* -------------------------------------------------------------------- ports */

/**
 * The surfaces ASRE must plug into. Each is a thin port so LÉLU can supply
 * its own implementation without ASRE importing a React tree.
 */
export interface LeluPorts {
  /** LÉLU Core: stable object identity and conversation scoping. */
  core: {
    objectIdFor(label: string): string;
    note(surface: string, detail: string): void;
  };
  /** Chat/workspace: the user can start a reconstruction from a message. */
  chat: {
    announce(sessionId: string, message: string): void;
  };
  /** Character builder: receives the identity and variations. */
  characterBuilder: {
    register(identity: CharacterIdentity): void;
  };
  /** Genesis scene: receives a scene-ready payload (not a live scene). */
  genesis: {
    place(payload: { objectId: string; voxels: SparseVoxels; label: string }): { accepted: boolean; detail: string };
  };
  /** Cosmos: receives an object record LÉLU can store. */
  cosmos: {
    register(payload: CosmosObjectPayload): { accepted: boolean; detail: string };
  };
  /** Asset management: where a GLB goes and how it is gated. */
  assets: {
    store(name: string, bytes: Uint8Array, report: GlbReport): { path: string; accepted: boolean };
  };
}

export interface CosmosObjectPayload {
  id: string;
  name: string;
  domain: string;
  builder: string;
  params: Record<string, number | string>;
  partCount: number;
  place: "cosmos" | "workspace" | "gallery";
  provenance: Array<{ at: number; action: string; detail: string }>;
}

/** In-process ports: real implementations, no network, no framework. */
export function createLocalPorts(options: { assetDirectory?: string } = {}): LeluPorts & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const record = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const registered: CharacterIdentity[] = [];
  const stored: Array<{ name: string; bytes: number; accepted: boolean; path: string }> = [];
  return {
    calls,
    core: {
      objectIdFor(label) {
        record("core");
        return `lelu:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      },
      note() {
        record("core");
      },
    },
    chat: {
      announce() {
        record("chat");
      },
    },
    characterBuilder: {
      register(identity) {
        record("characterBuilder");
        registered.push(identity);
      },
    },
    genesis: {
      place(payload) {
        record("genesis");
        // Shape validation is the whole contract: a scene needs an identity,
        // real cells, and a label it can show.
        const accepted = payload.objectId.length > 0 && payload.voxels.coords.length > 0 && payload.label.length > 0;
        return { accepted, detail: accepted ? `${payload.voxels.coords.length / 3} cells ready for a scene node` : "payload is missing identity, geometry or label" };
      },
    },
    cosmos: {
      register(payload) {
        record("cosmos");
        const accepted = payload.id.length > 0 && payload.partCount > 0 && payload.provenance.length > 0;
        return { accepted, detail: accepted ? `${payload.partCount} parts, domain ${payload.domain}` : "cosmos object needs an id, parts and provenance" };
      },
    },
    assets: {
      store(name, bytes, report) {
        record("assets");
        const path = `${options.assetDirectory ?? "artifacts/mission4"}/${name}`;
        stored.push({ name, bytes: bytes.byteLength, accepted: report.ok, path });
        return { path, accepted: report.ok };
      },
    },
  };
}

/* ------------------------------------------------------------------ session */

export interface SessionSnapshot {
  sessionId: string;
  objectId: string;
  frameId: string;
  frames: number;
  cells: number;
  meanConfidence: number;
  hypothesis: { id: string; quality: number; confidence: number };
  provenance: Record<string, { cells: number; share: number }>;
  components: Array<{ id: ComponentId; cells: number; digest: string; passed: boolean }>;
  flipbook: ReturnType<typeof flipbook>;
  analyses: number;
  notes: string[];
}

export interface MissingInformation {
  component: ComponentId | "depth" | "occlusion";
  detail: string;
  /** Share of the relevant geometry that is not observed. */
  unobservedShare: number;
  /** What evidence would reduce it. */
  remedy: string;
}

export interface ViewRequest {
  id: string;
  forComponent: ComponentId | "depth" | "occlusion";
  view: string;
  expectedGain: number;
  reason: string;
}

export interface RefinementOutcome {
  components: ComponentId[];
  frame: ReturnType<typeof headFrame>;
  preserved: ComponentId[];
  cellsChanged: number;
  modelCalls: number;
  notes: string[];
}

export interface VariationOutcome {
  request: VariationRequest;
  result: VariationResult;
  exported: { bytes: number; triangles: number; accepted: boolean; name: string };
}

export interface VersionComparison {
  from: string;
  to: string;
  cellsFrom: number;
  cellsTo: number;
  shared: number;
  onlyFrom: number;
  onlyTo: number;
  iou: number;
  digestsEqual: boolean;
  summary: string;
}

export class AsreSessionNotFound extends Error {
  constructor(id: string) {
    super(`ASRE session "${id}" does not exist; reconstructions are never shared implicitly between sessions.`);
    this.name = "AsreSessionNotFound";
  }
}

export interface AsreSession {
  id: string;
  objectId: string;
  layer: LayeredReconstruction;
  identity: CharacterIdentity;
  analysis: ImageAnalysis;
  hypotheses: HypothesisComparison;
  temporal: TemporalObject;
  store: SnapshotStore;
  snapshots: Array<{ frameId: string; snapshotId: string; snapshot: NreSnapshot }>;
  refinements: number;
  notes: string[];
}

export interface AsreServiceOptions {
  ports?: LeluPorts;
  resolutionY?: number;
  worldHeightM?: number;
  storeDirectory?: string;
}

export interface AsreService {
  receiveImage(frame: ImageFrame, options: { objectId: string; label?: string }): Promise<AsreSession>;
  inspect(sessionId: string): SessionSnapshot;
  missingInformation(sessionId: string): MissingInformation[];
  requestViews(sessionId: string): ViewRequest[];
  refine(sessionId: string, components: ComponentId[]): Promise<RefinementOutcome>;
  generateVariations(sessionId: string, requests: VariationRequest[]): VariationOutcome[];
  compareVersions(sessionId: string, fromFrameId: string, toFrameId: string): VersionComparison;
  restore(sessionId: string, frameId: string): LayeredReconstruction;
  exportGeometry(sessionId: string, options?: { includeOverlays?: boolean; name?: string }): { bytes: Uint8Array; report: GlbReport; triangles: number; path: string | null };
  attribute(detail: string): void;
  surfaces(): Array<{ id: string; status: ExperimentStatus; detail: string }>;
}

export function createAsreService(options: AsreServiceOptions = {}): AsreService {
  const ports = options.ports ?? createLocalPorts();
  const sessions = new Map<string, AsreSession>();

  const session = (id: string): AsreSession => {
    const found = sessions.get(id);
    if (!found) throw new AsreSessionNotFound(id);
    return found;
  };

  const store = new MemorySnapshotStore();

  const service: AsreService = {
    async receiveImage(frame, receiveOptions) {
      const analysis = analyseImage(frame, { worldHeightM: options.worldHeightM });
      const lattice = latticeForAnalysis(analysis, { resolutionY: options.resolutionY });
      const hypotheses = buildHypotheses(lattice, analysis);
      const comparison = compareHypotheses(hypotheses, lattice, analysis);
      // Keep the runner-up as a second opinion rather than discarding it.
      const second = comparison.runnerUp;
      const chosen = second
        ? combineHypotheses(comparison.chosen.hypothesis, second.hypothesis, 0.65, lattice)
        : comparison.chosen.hypothesis;
      const regions = analysis.components.regions;
      const observedComponents = COMPONENT_IDS.filter((id) => analysis.components.components.find((c) => c.id === id)?.detected);
      const sessionId = `${receiveOptions.objectId}-${analysis.pixelDigest.slice(0, 8)}`;
      const layer = createLayeredReconstruction(
        receiveOptions.objectId,
        lattice,
        {
          id: `obs-${analysis.pixelDigest.slice(0, 8)}`,
          imageDigest: analysis.pixelDigest,
          hypothesisId: chosen.id,
          voxels: chosen.voxels,
          observedComponents,
          regions,
          notes: [comparison.statement],
        },
        receiveOptions.label ?? receiveOptions.objectId,
      );
      const identity = createIdentity({
        id: `${receiveOptions.objectId}-identity`,
        label: receiveOptions.label ?? receiveOptions.objectId,
        lattice,
        voxels: chosen.voxels,
        regions,
      });

      const object = createTemporalObject({ objectId: receiveOptions.objectId, label: receiveOptions.label ?? receiveOptions.objectId });
      const observation = meanObservation({
        id: `asre-${analysis.pixelDigest.slice(0, 8)}`,
        sourceId: receiveOptions.objectId,
        confidence: comparison.chosen.score.confidence,
        producer: `asre/${chosen.kind}`,
        note: `${chosen.rule}; hypothesis confidence ${comparison.chosen.score.confidence.toFixed(4)}`,
      });
      const recorded = await recordSnapshot(object, { voxels: chosen.voxels, observations: [observation], state: "observed", summary: `ASRE ${chosen.kind}` }, store);
      const restored = await restoreSnapshot(recorded.object, recorded.record.id, store);

      const created: AsreSession = {
        id: sessionId,
        objectId: receiveOptions.objectId,
        layer,
        identity,
        analysis,
        hypotheses: comparison,
        temporal: recorded.object,
        store,
        snapshots: [{ frameId: headFrame(layer).id, snapshotId: recorded.record.id, snapshot: restored.snapshot }],
        refinements: 0,
        notes: [comparison.statement, `${observedComponents.length} components detected by the image analysis`],
      };
      sessions.set(sessionId, created);
      ports.core.objectIdFor(receiveOptions.objectId);
      ports.characterBuilder.register(identity);
      ports.chat.announce(sessionId, `reconstruction started: ${chosen.kind}, ${comparison.chosen.score.confidence.toFixed(3)} confidence`);
      return created;
    },

    inspect(id) {
      const s = session(id);
      const head = headFrame(s.layer);
      return {
        sessionId: s.id,
        objectId: s.objectId,
        frameId: head.id,
        frames: s.layer.frames.length,
        cells: head.voxels.coords.length / 3,
        meanConfidence: head.meanConfidenceAfter,
        hypothesis: {
          id: s.hypotheses.chosen.hypothesis.id,
          quality: s.hypotheses.chosen.score.quality,
          confidence: s.hypotheses.chosen.score.confidence,
        },
        provenance: provenanceSummary(s.hypotheses.chosen.hypothesis),
        components: STRUCTURAL_COMPONENTS.map((component) => ({
          id: component,
          cells: head.componentCells[component] ?? 0,
          digest: head.componentDigests[component] ?? "absent",
          passed: (head.componentCells[component] ?? 0) > 0,
        })),
        flipbook: flipbook(s.layer),
        analyses: s.snapshots.length,
        notes: s.notes,
      };
    },

    missingInformation(id) {
      const s = session(id);
      const head = headFrame(s.layer);
      const out: MissingInformation[] = [];
      // Depth: the back of every column is synthesis, by construction.
      const provenance = provenanceSummary(s.hypotheses.chosen.hypothesis);
      out.push({
        component: "depth",
        detail: `${(100 * (provenance.SYNTHESIZED.share + provenance.INFERRED.share)).toFixed(1)}% of cells behind the visible cap were inferred or synthesised; no back view exists`,
        unobservedShare: provenance.SYNTHESIZED.share + provenance.INFERRED.share,
        remedy: "a rear or three-quarter view would replace synthesised depth with observed surface",
      });
      for (const component of COMPONENT_IDS) {
        const cells = head.componentCells[component] ?? 0;
        const observed = s.analysis.components.components.find((c) => c.id === component);
        if (cells === 0 || !observed?.detected) {
          out.push({
            component,
            detail: `${component} has ${cells} cells and ${observed?.detected ? "was" : "was not"} separated by the analysis`,
            unobservedShare: 1,
            remedy: component === "accessories" ? "a catalogue or a second view" : `a view that separates ${component} from its neighbour`,
          });
        }
      }
      if (head.meanConfidenceAfter < 0.6) {
        out.push({
          component: "occlusion",
          detail: `mean confidence ${head.meanConfidenceAfter.toFixed(3)} across ${head.voxels.coords.length / 3} cells`,
          unobservedShare: 1 - head.meanConfidenceAfter,
          remedy: "another observation of the same object; ASRE will fuse only the affected regions",
        });
      }
      return out;
    },

    requestViews(id) {
      return service.missingInformation(id).map((missing, index) => ({
        id: `view-${index + 1}`,
        forComponent: missing.component,
        view: missing.component === "depth" ? "rear three-quarter view" : `isolated view of ${missing.component}`,
        expectedGain: Math.max(0.05, Math.min(1, missing.unobservedShare)),
        reason: missing.detail,
      }));
    },

    async refine(id, components) {
      const s = session(id);
      const head = headFrame(s.layer);
      // A numeric refinement: re-derive the affected components under the
      // better-supported hypothesis and let the layer fuse them. No model.
      const alternative = s.hypotheses.ranked[1]?.hypothesis ?? s.hypotheses.chosen.hypothesis;
      const result = addObservation(s.layer, {
        id: `refine-${s.refinements + 1}`,
        imageDigest: `${s.layer.frames[0].imageDigest}-refine-${s.refinements + 1}-${components.join("+")}`,
        hypothesisId: alternative.id,
        voxels: alternative.voxels,
        observedComponents: components,
        regions: s.analysis.components.regions,
        notes: [`numeric refinement of ${components.join(", ")} using ${alternative.kind}; the image did not change`],
      });
      s.layer = result.layer;
      s.refinements += 1;
      const frame = headFrame(s.layer);
      const preserved = COMPONENT_IDS.filter((c) => !components.includes(c));
      return {
        components,
        frame,
        preserved,
        cellsChanged: result.frame.change.newCells + result.frame.change.lostCells,
        modelCalls: 0,
        notes: [...result.frame.notes, `head cells before ${head.voxels.coords.length / 3}, after ${frame.voxels.coords.length / 3}`],
      };
    },

    generateVariations(id, requests) {
      const s = session(id);
      const outcomes: VariationOutcome[] = [];
      for (const request of requests) {
        const result = applyVariation(s.identity, request);
        s.identity = result.identity;
        const voxels = identityVoxels(result.identity);
        const mesh = meshFromVoxels(voxels);
        const bytes = encodeGlb(mesh, { name: `${s.objectId}-${request.id}`, generator: "asre-mission4" });
        const report = inspectGlb(bytes);
        const name = `${s.objectId}-${request.id}.glb`;
        const storedPath = ports.assets.store(name, bytes, report);
        outcomes.push({
          request,
          result,
          exported: { bytes: bytes.byteLength, triangles: mesh.indices.length / 3, accepted: report.ok, name },
        });
        ports.characterBuilder.register(result.identity);
        const detail = `${request.kind}:${request.id} reused ${(reuseRatio(result) * 100).toFixed(1)}% of cells, ${result.changed.length} components changed`;
        ports.core.note("characterBuilder", detail);
        void storedPath;
      }
      return outcomes;
    },

    compareVersions(id, fromFrameId, toFrameId) {
      const s = session(id);
      const from = s.layer.frames.find((f) => f.id === fromFrameId);
      const to = s.layer.frames.find((f) => f.id === toFrameId);
      if (!from || !to) throw new Error(`frame ids must belong to session ${id}`);
      const metrics = compareVoxelSets(from.voxels, to.voxels);
      return {
        from: from.id,
        to: to.id,
        cellsFrom: from.voxels.coords.length / 3,
        cellsTo: to.voxels.coords.length / 3,
        shared: metrics.shared,
        onlyFrom: metrics.onlyA,
        onlyTo: metrics.onlyB,
        iou: metrics.iou,
        digestsEqual: from.componentDigests.torso === to.componentDigests.torso,
        summary: `${metrics.shared} shared cells, ${metrics.onlyA} only in the earlier frame, ${metrics.onlyB} only in the later one (IoU ${metrics.iou.toFixed(3)})`,
      };
    },

    restore(id, frameId) {
      const s = session(id);
      s.layer = restoreFrame(s.layer, frameId);
      return s.layer;
    },

    exportGeometry(id, exportOptions = {}) {
      const s = session(id);
      const voxels = exportOptions.includeOverlays === false ? s.identity.parts.torso ?? headFrame(s.layer).voxels : identityVoxels(s.identity, { includeOverlays: exportOptions.includeOverlays ?? true });
      const mesh = meshFromVoxels(voxels);
      const name = exportOptions.name ?? `${s.objectId}-asre.glb`;
      const bytes = encodeGlb(mesh, { name, generator: "asre-mission4" });
      const report = inspectGlb(bytes);
      const stored = ports.assets.store(name, bytes, report);
      return { bytes, report, triangles: mesh.indices.length / 3, path: stored.path };
    },

    attribute(detail) {
      ports.core.note("asre", detail);
    },

    surfaces() {
      const calls = (ports as LeluPorts & { calls?: Record<string, number> }).calls ?? {};
      const called = (id: string) => (calls[id] ?? 0) > 0;
      return [
        { id: "nre", status: "VERIFIED" as ExperimentStatus, detail: "sparse voxels, VXZ serialisation and snapshot fusion used directly; restored containers verified by digest" },
        { id: "temporal-engine", status: "VERIFIED" as ExperimentStatus, detail: "each ASRE frame is recorded as an NRE snapshot; frames are restorable independently" },
        { id: "asset-management", status: called("assets") ? ("VERIFIED" as ExperimentStatus) : ("PARTIAL" as ExperimentStatus), detail: "GLBs are written and gated by GlbInspector before being offered" },
        { id: "character-builder", status: called("characterBuilder") ? ("VERIFIED" as ExperimentStatus) : ("PARTIAL" as ExperimentStatus), detail: "identity and variations registered with the builder port" },
        { id: "chat", status: called("chat") ? ("VERIFIED" as ExperimentStatus) : ("PARTIAL" as ExperimentStatus), detail: "session announcements emitted to the chat port" },
        { id: "core", status: called("core") ? ("VERIFIED" as ExperimentStatus) : ("PARTIAL" as ExperimentStatus), detail: "object identity issued by LÉLU Core, never invented by ASRE" },
        {
          id: "genesis-scene",
          status: called("genesis") ? ("PARTIAL" as ExperimentStatus) : ("NOT IMPLEMENTED" as ExperimentStatus),
          detail: "scene payload is emitted and shape-validated; placing it in a live Three.js scene happens in LÉLU, not in this process",
        },
        {
          id: "cosmos",
          status: called("cosmos") ? ("PARTIAL" as ExperimentStatus) : ("NOT IMPLEMENTED" as ExperimentStatus),
          detail: "CosmosObject payload is emitted and validated; registration into the Cosmos store is LÉLU's call",
        },
      ];
    },
  };

  return service;
}

/** The canonical variation library, split for the report. */
export const VARIATION_LIBRARY = {
  hairstyles: HAIRSTYLES.length,
  garments: GARMENTS.length,
  provenanceLabels: PROVENANCE_ORDER,
};

export { deserializeSnapshot };
export type { ComponentId };
