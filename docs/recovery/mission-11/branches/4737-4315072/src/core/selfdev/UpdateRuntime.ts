/**
 * ==========================================================
 * LÉLU — UPDATE RUNTIME (browser side)
 *
 * The single client for the verified update pipeline. It does the
 * three things a UI must not do itself:
 *
 *   1. It polls the pipeline only while something is actually
 *      happening (1.5s while a stage runs, 10s idle, and it stops
 *      when nothing is watching) — no permanent loop.
 *   2. After a restart it performs the HEALTH CHECK: the server must
 *      report a NEW generation timestamp, HEAD must be the verified
 *      commit, and the application's own HTML must load. Only then is
 *      the update "applied" — and only then does the page reload, so
 *      a reload is never cosmetic. If that reload destroys the page
 *      mid-check, the check is finished on the next visit from the same
 *      evidence (see recoverInterruptedHealth) rather than left pending.
 *   3. It announces the verified commit once. The tag is recorded in
 *      KvStore, so a page reload does not repeat a notification the
 *      user has already seen.
 *
 * It holds no state of its own about what is verified: that answer
 * always comes from the server's job record.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import NotificationProvider from "../notifications/NotificationProvider";
import {
  ALL_CHECKS,
  appliedAnnouncement,
  readyAnnouncement,
  type UpdateCheckId,
  type UpdateJob,
  type UpdateState,
} from "./UpdateLifecycle";

const BASE = "/api/engineer/update";
const ANNOUNCED_KEY = "lelu.update.announced.v1";
const MAX_ANNOUNCED = 40;
const ACTIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 10_000;
const HEALTH_TIMEOUT_MS = 45_000;

const SETTLED_STAGES = new Set(["applied", "failed", "ready", "commit-verified"]);

export interface PrepareInput {
  message: string;
  paths: string[];
  checks?: UpdateCheckId[];
}

export interface CandidatePath {
  path: string;
  status: "added" | "modified" | "deleted";
}

export interface HealthOutcome {
  ok: boolean;
  detail: string;
  pageLoaded: boolean;
  serverStartedAt: number;
  head: string;
}

export interface ApplyOutcome {
  ok: boolean;
  alreadyApplied?: boolean;
  restartSupported?: boolean;
  error?: string;
  health?: HealthOutcome;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class UpdateRuntime {
  private static instance: UpdateRuntime | null = null;

  private state: UpdateState | null = null;
  private listeners = new Set<(state: UpdateState | null) => void>();
  private watchers = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<UpdateState | null> | null = null;
  private recovering = false;

  public static getInstance(): UpdateRuntime {
    if (!UpdateRuntime.instance) {
      UpdateRuntime.instance = new UpdateRuntime();
    }
    return UpdateRuntime.instance;
  }

  public getState(): UpdateState | null {
    return this.state;
  }

  /** Subscribe to state changes; returns the unsubscribe. */
  public subscribe(listener: (state: UpdateState | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Poll while a panel is open. Polling stops the moment the last
   * watcher leaves, and runs faster only while a stage is moving.
   */
  public watch(): () => void {
    this.watchers += 1;
    void this.refresh();
    this.schedule();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0) this.stop();
    };
  }

  private stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private active(): boolean {
    if (!this.state?.job) return false;
    return !SETTLED_STAGES.has(this.state.job.stage);
  }

  private schedule(): void {
    this.stop();
    if (this.watchers === 0) return;
    const interval = this.active() ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    this.timer = setTimeout(async () => {
      await this.refresh();
      this.schedule();
    }, interval);
  }

  /** Read the pipeline's current job and runtime facts. */
  public async refresh(): Promise<UpdateState | null> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const response = await fetch(`${BASE}/status`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as UpdateState & { ok?: boolean; error?: string };
        if (!data?.ok) throw new Error(data?.error ?? "the update runtime refused to answer");
        this.state = { job: data.job ?? null, facts: data.facts, history: data.history ?? [] };
        this.announce(this.state.job);
      } catch (error) {
        // A missing pipeline is a real, reportable state — a static
        // deployment has no /api/engineer/update at all.
        this.state = {
          job: this.state?.job ?? null,
          facts: {
            runtime: "unavailable",
            branch: "—",
            head: "—",
            serverStartedAt: 0,
            restartSupported: false,
            workspace: "",
            identityVerification: false,
            authority: "",
            available: false,
            error:
              error instanceof Error
                ? `No update runtime answered (${error.message}). This deployment serves static files only.`
                : "No update runtime answered.",
          },
          history: this.state?.history ?? [],
        };
      } finally {
        this.inFlight = null;
      }
      this.emit();
      this.recoverInterruptedHealth();
      return this.state;
    })();
    return this.inFlight;
  }

  /**
   * Finish a health check that a page reload destroyed.
   *
   * apply() records "restarting" and then waits, in this page, for the
   * restarted server. If the tab reloads, is closed, or is the browser that
   * went away mid-apply, that wait never finishes and the panel shows
   * "Restarting application" forever — even though the process really did
   * restart. The evidence is already here: if the runtime answering this
   * page started AFTER the apply request, the restart happened. So the same
   * checks apply() makes are made again — a new generation, HEAD at the
   * verified commit, and the app's own HTML loading — and only then is it
   * recorded as applied. Nothing is assumed from the mere reload.
   */
  private recoverInterruptedHealth(): void {
    const job = this.state?.job;
    const facts = this.state?.facts;
    if (!job || job.stage !== "restarting" || !job.commit) return;
    if (!facts?.available || !facts.serverStartedAt) return;
    if (facts.serverStartedAt <= job.updatedAt) return;
    if (this.recovering) return;
    // Captured here: the narrowing above does not survive into the async
    // closure below.
    const commit = job.commit;
    this.recovering = true;
    void (async () => {
      let pageLoaded = false;
      try {
        const page = await fetch("/", { cache: "no-store" });
        pageLoaded = page.ok;
      } catch {
        pageLoaded = false;
      }
      const ok = pageLoaded && facts.head === commit;
      const detail = ok
        ? `restart completed before this page loaded · serving ${facts.head.slice(0, 7)} · app answered`
        : pageLoaded
          ? `the restart completed, but HEAD is ${facts.head.slice(0, 7)} instead of ${commit.slice(0, 7)}`
          : "the restart completed, but the app did not load";
      try {
        await fetch(`${BASE}/health`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commit,
            ok,
            detail,
            serverStartedAt: facts.serverStartedAt,
            pageLoaded,
          }),
        });
      } catch {
        // Leave the job as it is; the next visit retries.
        this.recovering = false;
        return;
      }
      this.recovering = false;
      await this.refresh();
    })();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error("[LÉLU UpdateRuntime] listener threw (contained)", error);
      }
    }
  }

  /** Every path git reports as changed, so the user picks what is committed. */
  public async changeCandidates(): Promise<CandidatePath[]> {
    try {
      const response = await fetch("/api/engineer/git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { ok?: boolean; status?: string };
      if (!data.ok || typeof data.status !== "string") return [];
      const candidates: CandidatePath[] = [];
      for (const line of data.status.split("\n")) {
        if (!line.trim()) continue;
        const code = line.slice(0, 2);
        let file = line.slice(3).trim();
        if (file.includes(" -> ")) file = file.split(" -> ").pop()!.trim();
        file = file.replace(/^"|"$/g, "");
        if (!file) continue;
        if (/^\.lelu\//.test(file) || /(^|\/)\.env(\.|$)/.test(file)) continue;
        candidates.push({
          path: file,
          status: code.includes("?") || code.includes("A") ? "added" : code.includes("D") ? "deleted" : "modified",
        });
      }
      return candidates;
    } catch {
      return [];
    }
  }

  /** Start verification. Resolves once the job exists — not when it finishes. */
  public async prepare(input: PrepareInput): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${BASE}/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: input.message,
          paths: input.paths,
          checks: input.checks ?? ALL_CHECKS,
          confirm: true,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      await this.refresh();
      this.schedule();
      return data.ok ? { ok: true } : { ok: false, error: data.error ?? `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Apply the verified commit: the server restarts, then this proves it
   * happened before anything is called applied.
   */
  public async apply(commit: string): Promise<ApplyOutcome> {
    let previousServerStartedAt = this.state?.facts.serverStartedAt ?? 0;
    try {
      const response = await fetch(`${BASE}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commit, confirm: true }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        alreadyApplied?: boolean;
        restarting?: boolean;
        restartSupported?: boolean;
        previousServerStartedAt?: number;
      };
      if (!data.ok) {
        await this.refresh();
        return {
          ok: false,
          error: data.error ?? `HTTP ${response.status}`,
          restartSupported: data.restartSupported,
        };
      }
      if (data.alreadyApplied) {
        await this.refresh();
        return { ok: true, alreadyApplied: true };
      }
      if (typeof data.previousServerStartedAt === "number") {
        previousServerStartedAt = data.previousServerStartedAt;
      }
    } catch (error) {
      // The server may drop the connection as it restarts; that is the
      // expected path, and the health check below decides the outcome.
      if (!/network|fetch|failed/i.test(String(error))) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const health = await this.waitForRestart(commit, previousServerStartedAt);
    try {
      await fetch(`${BASE}/health`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commit,
          ok: health.ok,
          detail: health.detail,
          serverStartedAt: health.serverStartedAt,
          pageLoaded: health.pageLoaded,
        }),
      });
    } catch {
      // The record is a convenience for the next visitor; the outcome
      // the user sees comes from the check just performed.
    }
    await this.refresh();
    this.schedule();

    if (health.ok) {
      // Reload only now — the running process is the verified commit and
      // the app has already answered a request.
      setTimeout(() => {
        if (typeof window !== "undefined") window.location.reload();
      }, 1_200);
    }
    return { ok: health.ok, health, error: health.ok ? undefined : health.detail };
  }

  /** Revert an applied commit (a new commit — never a reset). */
  public async rollback(commit: string): Promise<{ ok: boolean; error?: string; head?: string }> {
    try {
      const response = await fetch(`${BASE}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commit, confirm: true }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; head?: string };
      await this.refresh();
      return data.ok ? { ok: true, head: data.head } : { ok: false, error: data.error ?? `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The commit's real patch, for inspection. */
  public async patch(commit: string): Promise<string> {
    try {
      const response = await fetch(`${BASE}/diff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commit }),
      });
      const data = (await response.json()) as { ok?: boolean; patch?: string; error?: string };
      return data.ok ? (data.patch ?? "") : `diff unavailable: ${data.error ?? "unknown error"}`;
    } catch (error) {
      return `diff unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async waitForRestart(commit: string, previousServerStartedAt: number): Promise<HealthOutcome> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    let lastProblem = "nothing answered yet";
    while (Date.now() < deadline) {
      await delay(800);
      try {
        const response = await fetch(`${BASE}/status`, { cache: "no-store" });
        if (!response.ok) {
          lastProblem = `status answered HTTP ${response.status}`;
          continue;
        }
        const data = (await response.json()) as UpdateState & { ok?: boolean };
        const facts = data?.facts;
        if (!facts) {
          lastProblem = "the runtime reported no facts";
          continue;
        }
        if (!(facts.serverStartedAt > previousServerStartedAt)) {
          lastProblem = "the server has not restarted yet";
          continue;
        }
        // The API answering is not the app working: ask for the app itself.
        let pageLoaded = false;
        let pageStatus = "no response";
        try {
          const page = await fetch("/", { cache: "no-store" });
          pageLoaded = page.ok;
          pageStatus = `HTTP ${page.status}`;
        } catch (error) {
          pageStatus = error instanceof Error ? error.message : String(error);
        }
        const ok = pageLoaded && facts.head === commit;
        return {
          ok,
          detail: ok
            ? `restarted at ${new Date(facts.serverStartedAt).toLocaleTimeString()} · serving ${facts.head.slice(0, 7)} · app answered ${pageStatus}`
            : `restarted, but ${!pageLoaded ? `the app did not load (${pageStatus})` : `HEAD is ${facts.head.slice(0, 7)} instead of ${commit.slice(0, 7)}`}`,
          pageLoaded,
          serverStartedAt: facts.serverStartedAt,
          head: facts.head,
        };
      } catch (error) {
        lastProblem = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      ok: false,
      detail: `the application did not come back within ${Math.round(HEALTH_TIMEOUT_MS / 1000)}s (${lastProblem})`,
      pageLoaded: false,
      serverStartedAt: previousServerStartedAt,
      head: "",
    };
  }

  /**
   * Announce a verified or applied commit — once. The tag is remembered
   * in KvStore so a reload does not repeat it, and the notification
   * carries the Apply & Restart action rather than only text.
   */
  private announce(job: UpdateJob | null): void {
    if (!job) return;
    const provider = NotificationProvider.getInstance();
    const stored = KvStore.getInstance().get<string[]>(ANNOUNCED_KEY) ?? [];
    const seen = new Set(stored);

    const ready = readyAnnouncement(job);
    if (ready && !seen.has(ready.tag)) {
      const record = provider.notify({
        type: "update",
        title: ready.title,
        body: ready.body,
        tag: ready.tag,
        priority: 4,
        action: job.commit ? { label: "Apply & Restart", kind: "apply-update", commit: job.commit } : undefined,
      });
      if (record) seen.add(ready.tag);
    }

    const applied = appliedAnnouncement(job);
    if (applied && !seen.has(applied.tag)) {
      const record = provider.notify({
        type: "info",
        title: applied.title,
        body: applied.body,
        tag: applied.tag,
        priority: 5,
      });
      if (record) seen.add(applied.tag);
    }

    if (seen.size !== stored.length) {
      KvStore.getInstance().set(ANNOUNCED_KEY, [...seen].slice(-MAX_ANNOUNCED));
    }
  }
}
