/**
 * ==========================================================
 * LÉLU
 * SELF-DIAGNOSTICS — periodic evaluation of the real system
 *
 * Every check reads ACTUAL runtime state: provider health,
 * memory retrieval, agent execution history, creative store
 * health, storage capacity. Findings are structured
 * (id, category, severity, message, evidence) and surfaced in
 * the Evolution workspace + fed to the opportunity detector.
 * ==========================================================
 */

import AIService from "../AIService";
import AgentStore from "../agents/AgentStore";
import SketchStore from "../creative/SketchDocument";
import RenderStore from "../creative/RenderStore";
import VideoStore from "../creative/VideoProject";
import AvatarStore from "../avatar/AvatarProfile";
import SandboxFS from "../engineering/SandboxFS";
import KnowledgeLibrary from "../cognition/KnowledgeLibrary";
import WorkQueue from "../cognition/WorkQueue";
import SelfModel from "../cognition/SelfModel";
import SystemEnvironment from "../cognition/SystemEnvironment";
import KvStore from "../storage/KvStore";
import CapabilityRegistry from "./CapabilityRegistry";
import ArchitectureMap from "./ArchitectureMap";

export type DiagnosticCategory =
  | "software"
  | "cognition"
  | "agents"
  | "creative"
  | "storage"
  | "capabilities";

export type DiagnosticSeverity = "ok" | "info" | "warn" | "error";

export interface DiagnosticFinding {
  id: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  message: string;
  evidence: string;
}

export interface DiagnosticReport {
  updatedAt: number;
  findings: DiagnosticFinding[];
  summary: {
    ok: number;
    info: number;
    warn: number;
    error: number;
  };
  healthy: boolean;
}

export default class SelfDiagnostics {
  private static instance: SelfDiagnostics | null = null;
  private lastReport: DiagnosticReport | null = null;

  private constructor() {}

  public static getInstance(): SelfDiagnostics {
    if (!SelfDiagnostics.instance) {
      SelfDiagnostics.instance = new SelfDiagnostics();
    }
    return SelfDiagnostics.instance;
  }

  public getLastReport(): DiagnosticReport | null {
    return this.lastReport;
  }

  /** Run every real check and produce a structured report. */
  public async run(): Promise<DiagnosticReport> {
    const findings: DiagnosticFinding[] = [];
    const add = (
      category: DiagnosticCategory,
      severity: DiagnosticSeverity,
      message: string,
      evidence: string,
    ) => {
      findings.push({
        id: `${category}-${findings.length}-${crypto.randomUUID().slice(0, 6)}`,
        category,
        severity,
        message,
        evidence,
      });
    };

    /* ---------------- SOFTWARE ---------------- */
    try {
      const providers = AIService.getInstance().getProviders();
      const ai = providers.ai ?? [];
      const knowledge = providers.knowledge ?? [];
      const enabled = ai.filter((provider) => provider.enabled);
      if (ai.length === 0) {
        add("software", "warn", "No AI providers registered.", "provider registry empty");
      } else if (enabled.length === 0) {
        add(
          "software",
          "error",
          `No AI provider is enabled (${ai.length} registered).`,
          ai.map((provider) => `${provider.name}:${provider.enabled ? "enabled" : "disabled"}`).join(", "),
        );
      } else {
        add("software", "ok", `${enabled.length}/${ai.length} AI providers enabled.`, enabled.map((p) => p.name).join(", "));
      }
      add(
        "software",
        knowledge.length > 0 ? "info" : "warn",
        `${knowledge.length} knowledge provider(s) registered.`,
        knowledge.map((p) => p.name).join(", ") || "none",
      );
    } catch (error) {
      add("software", "error", "Provider registry check failed.", error instanceof Error ? error.message : String(error));
    }

    /* ---------------- COGNITION ---------------- */
    try {
      const memories = await AIService.getInstance().getMemories(50);
      add(
        "cognition",
        Array.isArray(memories) ? "ok" : "error",
        `Memory retrieval works (${Array.isArray(memories) ? memories.length : 0} memories read).`,
        "AIService.getMemories(50)",
      );
    } catch {
      add("cognition", "warn", "Memory retrieval unavailable (IndexedDB may be empty or blocked).", "getMemories threw");
    }
    const selfModel = SelfModel.getInstance().get();
    add(
      "cognition",
      Date.now() - selfModel.updatedAt > 7 * 24 * 60 * 60 * 1000 ? "warn" : "ok",
      `Self-model active (last updated ${new Date(selfModel.updatedAt).toLocaleString()}).`,
      `identity: ${selfModel.identity.name}`,
    );
    const gaps = KnowledgeLibrary.getInstance().gaps().length;
    add(
      "cognition",
      gaps > 0 ? "info" : "ok",
      `${gaps} knowledge gap(s) tracked.`,
      "KnowledgeLibrary.gaps()",
    );
    const blocked = WorkQueue.getInstance().list().filter((item) => item.category === "BLOCKED" && item.status === "open").length;
    add(
      "cognition",
      blocked > 0 ? "info" : "ok",
      `${blocked} blocked queue item(s).`,
      "WorkQueue BLOCKED count",
    );

    /* ---------------- AGENTS ---------------- */
    try {
      const agents = AgentStore.getInstance().list();
      const failed = agents.reduce(
        (count, agent) =>
          count +
          agent.executions.filter((execution) => !execution.result.trim() || execution.provider === "error").length,
        0,
      );
      const disabled = agents.filter((agent) => !agent.enabled && agent.status !== "archived").length;
      add("agents", "ok", `${agents.length} agent(s) configured (${disabled} paused).`, "AgentStore.list()");
      if (failed > 0) {
        add("agents", "warn", `${failed} failed agent execution(s) recorded.`, "AgentStore execution history");
      }
    } catch (error) {
      add("agents", "error", "Agent store check failed.", error instanceof Error ? error.message : String(error));
    }

    /* ---------------- CREATIVE ---------------- */
    try {
      const sketches = SketchStore.getInstance().list().length;
      const renders = RenderStore.getInstance().list().length;
      const videos = VideoStore.getInstance().list().length;
      const avatar = AvatarStore.getInstance().get();
      add("creative", "ok", `Creative stores healthy: ${sketches} sketch(es), ${renders} render(s), ${videos} video project(s).`, "store counts");
      add(
        "creative",
        avatar.identity.name ? "info" : "warn",
        `Avatar identity: ${avatar.identity.name || "not configured"}.`,
        "AvatarStore.get()",
      );
    } catch (error) {
      add("creative", "error", "Creative store check failed.", error instanceof Error ? error.message : String(error));
    }

    /* ---------------- STORAGE ---------------- */
    try {
      const sandbox = SandboxFS.getInstance();
      const sizeKB = sandbox.sizeKB();
      add(
        "storage",
        sizeKB > 400 ? "warn" : "ok",
        `Sandbox uses ${sizeKB} KB of the 512 KB cap.`,
        "SandboxFS.sizeKB()",
      );
      const storedKeys = KvStore.getInstance().keys().length;
      add("storage", "ok", `${storedKeys} persisted key(s).`, "KvStore.keys()");
    } catch (error) {
      add("storage", "error", "Storage check failed.", error instanceof Error ? error.message : String(error));
    }
    try {
      const env = await SystemEnvironment.getInstance().refresh();
      if (env.storage?.quotaBytes && env.storage.availableBytes !== null && env.storage.availableBytes !== undefined) {
        const usedPct = Math.round((env.storage.availableBytes / env.storage.quotaBytes) * 1000) / 10;
        add(
          "storage",
          usedPct > 80 ? "warn" : "info",
          `Browser storage ${usedPct}% of quota.`,
          `${(env.storage.availableBytes / (1024 * 1024)).toFixed(1)} MB used`,
        );
      }
    } catch {
      // estimate unavailable — skip
    }

    /* ---------------- CAPABILITIES ---------------- */
    const registry = CapabilityRegistry.getInstance();
    const counts = registry.statusCounts();
    add(
      "capabilities",
      "info",
      `${counts.available} available, ${counts.partial} partial, ${counts.experimental} experimental, ${counts["provider-dependent"]} provider-dependent, ${counts.planned} planned.`,
      "CapabilityRegistry.statusCounts()",
    );
    const broken = registry.byStatus("broken");
    for (const capability of broken) {
      add("capabilities", "error", `Capability ${capability.name} is marked broken.`, capability.id);
    }
    try {
      const map = ArchitectureMap.getInstance();
      add(
        "capabilities",
        "info",
        `Architecture map: ${map.list().length} subsystems mapped, ${map.countFiles()} curated files, ${map.allSourceFiles().length} real source files.`,
        "ArchitectureMap",
      );
    } catch (error) {
      add("capabilities", "warn", "Architecture map unavailable.", error instanceof Error ? error.message : String(error));
    }

    const summary = { ok: 0, info: 0, warn: 0, error: 0 };
    for (const finding of findings) {
      summary[finding.severity] += 1;
    }
    const report: DiagnosticReport = {
      updatedAt: Date.now(),
      findings,
      summary,
      healthy: summary.error === 0 && summary.warn <= 2,
    };
    this.lastReport = report;
    return report;
  }
}
