/**
 * ==========================================================
 * LÉLU — SESSION 3C: STUDIO RUNTIME (CLIENT)
 *
 * The Studio's transport. Every method reaches the real studio runtime
 * (POST /api/studio/*) that Session 3A's engineering server already
 * exposes for the dev and standalone runtimes. Nothing is simulated: a
 * build result is the process's exit code, a tree is the real directory.
 *
 * The runtime is the existing one — SourceAccess owns the base URL and
 * access token, exactly as it does for every other engineering call.
 * ==========================================================
 */

import SourceAccess from "../selfdev/SourceAccess";
import type { StudioProjectKind } from "./StudioTypes";

export interface StudioHealth {
  ok: boolean;
  runtime: string;
  root: string;
  templates: string[];
  capabilities: {
    node: boolean;
    godot: boolean;
    unity: boolean;
    unreal: boolean;
    headlessBrowser: boolean;
  };
  error?: string;
}

export interface StudioEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface StudioBuildResult {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  output: string;
  artifact: string | null;
  bytes: number;
  error?: string;
}

export interface StudioTestResult {
  ok: boolean;
  exitCode: number;
  passed: number;
  failed: number;
  durationMs: number;
  output: string;
  error?: string;
}

export interface StudioDeploymentResult {
  ok: boolean;
  status: "prepared" | "published" | "blocked" | "failed";
  environment: "preview" | "production";
  target: string;
  url?: string;
  note?: string;
  error?: string;
}

export interface StudioAssetResponse {
  ok: boolean;
  assets: Array<{
    id: string;
    source: string;
    path: string;
    kind: string;
    state: string;
    jobId?: string;
    note?: string;
  }>;
  error?: string;
}

interface ServerReply {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export default class StudioRuntime {
  private static instance: StudioRuntime | null = null;

  public static getInstance(): StudioRuntime {
    if (!StudioRuntime.instance) StudioRuntime.instance = new StudioRuntime();
    return StudioRuntime.instance;
  }

  private async post(route: string, body: Record<string, unknown> = {}): Promise<ServerReply> {
    const source = SourceAccess.getInstance();
    try {
      const response = await fetch(source.url(route), {
        method: "POST",
        headers: { ...source.headers() },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let data: ServerReply = {};
      try {
        data = text ? (JSON.parse(text) as ServerReply) : {};
      } catch {
        return { ok: false, error: text.slice(0, 400) || `HTTP ${response.status}` };
      }
      if (!response.ok && data.ok !== false) {
        return { ok: false, error: String(data.error ?? `HTTP ${response.status}`) };
      }
      return data;
    } catch (error) {
      return {
        ok: false,
        error:
          `The studio runtime is not reachable (${error instanceof Error ? error.message : String(error)}). ` +
          "A static deployment has no /api/studio; run the app with its development runtime.",
      };
    }
  }

  public async health(): Promise<StudioHealth> {
    const data = await this.post("/api/studio/health");
    return {
      ok: data.ok === true,
      runtime: String(data.runtime ?? "unknown"),
      root: String(data.root ?? ""),
      templates: Array.isArray(data.templates) ? (data.templates as string[]) : [],
      capabilities: (data.capabilities as StudioHealth["capabilities"]) ?? {
        node: false,
        godot: false,
        unity: false,
        unreal: false,
        headlessBrowser: false,
      },
      error: data.error ? String(data.error) : undefined,
    };
  }

  public async projects(): Promise<Array<{ slug: string; files: number; bytes: number; updatedAt: number; built: boolean }>> {
    const data = await this.post("/api/studio/projects");
    return Array.isArray(data.projects)
      ? (data.projects as Array<{ slug: string; files: number; bytes: number; updatedAt: number; built: boolean }>)
      : [];
  }

  public async scaffold(input: {
    kind: StudioProjectKind;
    name: string;
    requirements?: Record<string, unknown>;
  }): Promise<{ ok: boolean; slug?: string; root?: string; files?: number; error?: string }> {
    const data = await this.post("/api/studio/scaffold", input);
    return {
      ok: data.ok === true,
      slug: data.slug ? String(data.slug) : undefined,
      root: data.root ? String(data.root) : undefined,
      files: typeof data.files === "number" ? data.files : undefined,
      error: data.error ? String(data.error) : undefined,
    };
  }

  /** Create the three first-demonstration projects. Real files, real copies. */
  public async seedDemos(): Promise<Array<{ ok: boolean; kind: string; slug: string; files: number; error?: string }>> {
    const data = await this.post("/api/studio/demo");
    return Array.isArray(data.projects)
      ? (data.projects as Array<{ ok: boolean; kind: string; slug: string; files: number; error?: string }>)
      : [];
  }

  public async tree(slug: string, path = "."): Promise<{ ok: boolean; entries: StudioEntry[]; error?: string }> {
    const data = await this.post("/api/studio/tree", { slug, path });
    return {
      ok: data.ok === true,
      entries: Array.isArray(data.entries) ? (data.entries as StudioEntry[]) : [],
      error: data.error ? String(data.error) : undefined,
    };
  }

  public async read(slug: string, path: string): Promise<{ ok: boolean; content?: string; error?: string }> {
    const data = await this.post("/api/studio/read", { slug, path });
    return {
      ok: data.ok === true,
      content: typeof data.content === "string" ? data.content : undefined,
      error: data.error ? String(data.error) : undefined,
    };
  }

  public async write(slug: string, path: string, content: string): Promise<{ ok: boolean; error?: string }> {
    const data = await this.post("/api/studio/write", { slug, path, content });
    return { ok: data.ok === true, error: data.error ? String(data.error) : undefined };
  }

  public async build(slug: string): Promise<StudioBuildResult> {
    const data = await this.post("/api/studio/build", { slug });
    return {
      ok: data.ok === true,
      exitCode: typeof data.exitCode === "number" ? data.exitCode : 1,
      durationMs: typeof data.durationMs === "number" ? data.durationMs : 0,
      output: String(data.output ?? data.error ?? ""),
      artifact: data.artifact ? String(data.artifact) : null,
      bytes: typeof data.bytes === "number" ? data.bytes : 0,
      error: data.error ? String(data.error) : undefined,
    };
  }

  public async test(slug: string): Promise<StudioTestResult> {
    const data = await this.post("/api/studio/test", { slug });
    return {
      ok: data.ok === true,
      exitCode: typeof data.exitCode === "number" ? data.exitCode : 1,
      passed: typeof data.passed === "number" ? data.passed : 0,
      failed: typeof data.failed === "number" ? data.failed : 0,
      durationMs: typeof data.durationMs === "number" ? data.durationMs : 0,
      output: String(data.output ?? data.error ?? ""),
      error: data.error ? String(data.error) : undefined,
    };
  }

  /** Same-origin preview URL, served by the studio runtime from real dist output. */
  public previewUrl(slug: string): string {
    return `/api/studio/serve/${encodeURIComponent(slug)}/`;
  }

  public async assets(): Promise<StudioAssetResponse> {
    const data = await this.post("/api/studio/assets");
    return {
      ok: data.ok === true,
      assets: Array.isArray(data.assets) ? (data.assets as StudioAssetResponse["assets"]) : [],
      error: data.error ? String(data.error) : undefined,
    };
  }

  /** Prepare a deployment. Production requires a live human approval id. */
  public async deploy(input: {
    slug: string;
    environment: "preview" | "production";
    approvalId?: string;
  }): Promise<StudioDeploymentResult> {
    const data = await this.post("/api/studio/deploy", input);
    const environment = input.environment;
    return {
      ok: data.ok === true,
      status: (data.status as StudioDeploymentResult["status"]) ?? "failed",
      environment,
      target: String(data.target ?? ""),
      url: data.url ? String(data.url) : undefined,
      note: data.note ? String(data.note) : undefined,
      error: data.error ? String(data.error) : undefined,
    };
  }

  /** Ask a person to approve a protected action. Never grants it. */
  public requestApproval(input: {
    slug: string;
    action: string;
    reason: string;
    scope?: string[];
  }): Promise<{ ok: boolean; approvalId?: string; approval?: Record<string, unknown>; error?: string }> {
    return this.post("/api/studio/approvals/request", input).then((data) => ({
      ok: data.ok === true,
      approvalId: data.approvalId ? String(data.approvalId) : undefined,
      approval: (data.approval as Record<string, unknown>) ?? undefined,
      error: data.error ? String(data.error) : undefined,
    }));
  }

  public async approvals(slug: string): Promise<Array<Record<string, unknown>>> {
    const data = await this.post("/api/studio/approvals/list", { slug });
    return Array.isArray(data.approvals) ? (data.approvals as Array<Record<string, unknown>>) : [];
  }

  /**
   * A person's own decision. The panel calls this from a click; no tool
   * executor does, and the server requires the explicit user-confirmed
   * header that only the panel sends.
   */
  public async decideApproval(input: {
    approvalId: string;
    decision: "approved" | "denied";
    decidedBy: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const source = SourceAccess.getInstance();
    try {
      const response = await fetch(source.url("/api/studio/approvals/decide"), {
        method: "POST",
        headers: { ...source.headers(), "x-lelu-user-confirmed": "1" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as ServerReply;
      return { ok: data.ok === true, error: data.error ? String(data.error) : undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
