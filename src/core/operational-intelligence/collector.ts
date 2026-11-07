/**
 * ==========================================================
 * LÉLU — READ-ONLY STUDIO COLLECTOR
 *
 * Reads the four studios through injected sources and builds a
 * snapshot. It does not import an adapter, does not register a
 * capability, and cannot execute anything: the sources it is
 * given are the only things it may touch.
 *
 * Failure is per-studio. One studio that throws produces an
 * UNAVAILABLE studio with its real error; the other three are
 * still read, because a security outage must not blind LÉLU to
 * whether her voice works.
 * ==========================================================
 */

import { buildDependencyGraph, type DependencyGraph } from "./dependencies.ts";
import { normalizeStudio, summarizeReadiness } from "./model.ts";
import type {
  OperationalSnapshot,
  RawStudioPayload,
  StudioId,
  StudioStatus,
} from "./types.ts";
import { STUDIO_IDS } from "./types.ts";

export interface StudioSource {
  studioId: StudioId;
  /** Read the studio. Must not mutate it. */
  read(): Promise<RawStudioPayload>;
}

export interface CollectorOptions {
  now?: () => number;
  /** How long a snapshot may be served from cache. */
  ttlMs?: number;
  /** Per-studio read timeout. */
  timeoutMs?: number;
}

const DEFAULT_TTL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 8_000;

function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function buildSnapshot(studios: StudioStatus[], meta: { at: number; durationMs: number; fromCache: boolean }): OperationalSnapshot {
  const capabilities = studios.flatMap((studio) => studio.capabilities);
  const graph: DependencyGraph = buildDependencyGraph(capabilities);
  const timestamp = meta.at;
  const stale = studios.some((studio) => timestamp - studio.timestamp > DEFAULT_TTL_MS * 4);
  return {
    snapshotId: `snap-${timestamp}-${studios.length}`,
    timestamp,
    studioStatuses: studios,
    capabilities,
    dependencies: graph.statuses,
    findings: studios.flatMap((studio) =>
      studio.capabilities
        .filter((capability) => capability.state === "NOT_CONFIGURED" || capability.state === "BLOCKED")
        .map((capability) => ({
          findingId: `blocked:${capability.capabilityId}`,
          sourceStudio: studio.studioId,
          severity: "medium" as const,
          category: "availability" as const,
          description: `${capability.label} is ${capability.state}: ${capability.blockingReasons.join("; ") || "no reason reported"}`,
          affectedCapability: capability.capabilityId,
          remediation: capability.blockingReasons[0] ?? "inspect the capability",
          evidenceReference: capability.evidence[0]?.id ?? null,
          status: "open" as const,
        })),
    ),
    overallReadiness: summarizeReadiness(studios),
    collection: {
      collectedAt: meta.at,
      durationMs: meta.durationMs,
      fromCache: meta.fromCache,
      stale,
      studiosRead: studios.filter((studio) => studio.operationalState !== "UNAVAILABLE").length,
      studiosFailed: studios.filter((studio) => studio.operationalState === "UNAVAILABLE").length,
    },
  };
}

export class OperationalCollector {
  private cache: { snapshot: OperationalSnapshot; at: number } | null = null;
  private inflight: Promise<OperationalSnapshot> | null = null;
  private readonly sources: StudioSource[];
  private readonly options: CollectorOptions;

  constructor(sources: StudioSource[], options: CollectorOptions = {}) {
    this.sources = sources;
    this.options = options;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private ttl(): number {
    return this.options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Serve the last snapshot if it is still inside its TTL. */
  public cachedSnapshot(): OperationalSnapshot | null {
    if (!this.cache) return null;
    return this.now() - this.cache.at <= this.ttl() ? { ...this.cache.snapshot, collection: { ...this.cache.snapshot.collection, fromCache: true } } : null;
  }

  public invalidate(): void {
    this.cache = null;
  }

  /**
   * Collect every studio.
   *
   * Concurrent, bounded by the number of sources (four), each with its
   * own timeout, and every failure isolated to its studio. A second call
   * while a collection is in flight joins it rather than doubling the work.
   */
  public async collect(options: { force?: boolean } = {}): Promise<OperationalSnapshot> {
    if (!options.force) {
      const cached = this.cachedSnapshot();
      if (cached) return cached;
    }
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const startedAt = this.now();
      const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const studios = await Promise.all(
        this.sources.map(async (source) => {
          try {
            const payload = await timeout(source.read(), timeoutMs, `studio ${source.studioId}`);
            return normalizeStudio(source.studioId, payload, this.now());
          } catch (error) {
            return normalizeStudio(
              source.studioId,
              {
                ok: false,
                readAt: this.now(),
                capabilities: [],
                error: error instanceof Error ? error.message : String(error),
              },
              this.now(),
            );
          }
        }),
      );

      // A studio the host did not even supply is reported, not omitted.
      const supplied = new Set(this.sources.map((source) => source.studioId));
      for (const studioId of STUDIO_IDS) {
        if (!supplied.has(studioId)) {
          studios.push(
            normalizeStudio(
              studioId,
              { ok: false, readAt: this.now(), capabilities: [], error: `no source was supplied for ${studioId}` },
              this.now(),
            ),
          );
        }
      }

      const snapshot = buildSnapshot(studios, {
        at: this.now(),
        durationMs: this.now() - startedAt,
        fromCache: false,
      });
      this.cache = { snapshot, at: this.now() };
      return snapshot;
    })();

    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }
}

