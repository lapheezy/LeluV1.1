/**
 * ==========================================================
 * LÉLU — LABORATORY CLIENT
 *
 * The browser half of the self-development laboratory. Every
 * method performs a real request against plugins/labApi.ts and
 * returns what the server actually answered — including its
 * refusals. Nothing here invents state: if the server says an
 * experiment does not exist, the caller sees that, not an empty
 * object that looks like an experiment.
 *
 * The session token is issued by /api/lab/status and is attached
 * to every mutating call. It is a CSRF credential, not a model
 * credential: it never leaves this origin and is never logged.
 * ==========================================================
 */

export interface LabHead {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
}

export interface LabRepository {
  remote: string;
  fullName: string;
  branch: string;
  head: LabHead;
  dirty: number;
  dirtyFiles: string[];
  branches: number;
  branchList: string[];
  ahead: number;
  behind: number;
}

export interface LabSync {
  at: number;
  ok: boolean;
  commit: string;
  branch: string;
  remoteHeads: string[];
  newCommits: number;
  error?: string;
}

export type LabFindingSeverity = "info" | "low" | "medium" | "high";

export interface LabFinding {
  id: string;
  kind: string;
  severity: LabFindingSeverity;
  title: string;
  detail: string;
  evidence: string[];
  files: string[];
}

export interface LabDiscovery {
  id: string;
  at: number;
  repository: string;
  branch: string;
  commit: string;
  fingerprint: string;
  filesInspected: string[];
  findings: LabFinding[];
  research: Array<{ kind: "repository" | "external"; question: string; sources: string[]; conclusion: string }>;
  recommendedAction: string;
  priority: { score: number; severity: LabFindingSeverity; reach: number; rationale: string };
  status: "open" | "already-known" | "promoted" | "dismissed" | "resolved";
  supersedes?: string;
  /** The seven questions, answered from this inspection's own evidence. */
  rationale?: {
    what: string;
    evidence: string;
    whyItMatters: string;
    alternatives: string[];
    research: string;
    smallestCorrection: string;
    successMeasure: string;
  };
  /** The earlier discovery this one repeats, when the fingerprint matched. */
  previous?: string;
  /** Why an earlier discovery now counts as resolved. */
  resolvedBy?: string;
}

export interface LabSchedulerState {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  intervalMs: number;
  nextAt: number | null;
  cycles: number;
  ok: boolean | null;
  lastCycleAt: number | null;
  lastDiscoveryId: string | null;
  lastFindings: number | null;
  lastError: string | null;
  mode: "daemon" | "manual";
  failures?: number;
}

export interface LabPreview {
  port: number;
  pid: number;
  startedAt: number;
  url: string;
}

export interface LabExperiment {
  id: string;
  branch: string;
  root: string;
  createdAt: number;
  baseCommit: string;
  baseBranch: string;
  baselineCommit?: string;
  overlaidFiles: string[];
  preview: LabPreview | null;
  discoveryId?: string;
  findingId?: string;
  reason?: string;
  status?: "open" | "verified" | "abandoned";
  verifications?: Array<{ at: number; command: string; ok: boolean; status: number; durationMs: number }>;
  commit?: { sha: string; at: number; message: string } | null;
}

export interface LabDiffFile {
  path: string;
  addedLines: number;
  removedLines: number;
  status: string;
  patch: string;
}

export interface LabDiff {
  branch: string;
  baseCommit: string;
  files: LabDiffFile[];
  stat: string;
  head: string;
}

export interface LabStatus {
  ok: boolean;
  token: string;
  root: string;
  repository: LabRepository;
  github: { reachable: boolean; heads: number; checkedAt: number; error?: string };
  sync: LabSync | null;
  discoveries: LabDiscovery[];
  experiments: LabExperiment[];
  worktrees?: Array<{ path: string; head: string; branch: string }>;
  scheduler?: LabSchedulerState;
  commands: Array<{ id: string; label: string }>;
  boundaries: Record<string, unknown>;
}

export interface LabCommandResult {
  ok: boolean;
  command: string;
  label: string;
  status: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface LabTreeEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface LabCommit {
  sha: string;
  short: string;
  date: string;
  author: string;
  subject: string;
  files: string[];
}

export interface LabJournalEntry {
  at: number;
  kind: string;
  [key: string]: unknown;
}

export interface LabGenealogy {
  path: string;
  exists: boolean;
  origin: { commit: string; author: string; date: string; subject: string } | null;
  history: Array<{ commit: string; date: string; author: string; subject: string }>;
  contributors: Array<{ author: string; commits: number }>;
  branches: string[];
  lineCount: number;
  lastChange: { commit: string; date: string; author: string; subject: string } | null;
}

interface Envelope<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

export default class LabClient {
  private static instance: LabClient | null = null;

  private token: string | null = null;
  private statusCache: LabStatus | null = null;

  private constructor() {}

  public static getInstance(): LabClient {
    if (!LabClient.instance) LabClient.instance = new LabClient();
    return LabClient.instance;
  }

  private async post<T>(route: string, body: Record<string, unknown> = {}): Promise<T> {
    /*
     * The session token is issued by /status, and every mutating route needs
     * it. A caller that goes straight to a tool — a conversation, a script,
     * a reload — never asked for one, so the first POST would be refused with
     * "reload the workspace" even though nothing was wrong with its request.
     */
    if (!this.token) {
      try {
        await this.status(true);
      } catch {
        /* the POST below reports the real refusal */
      }
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers["x-lelu-lab"] = this.token;
    const response = await fetch(route, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`${route} answered ${response.status} with a non-JSON body.`);
    }
    if (payload.ok !== true) {
      throw new Error(typeof payload.error === "string" ? payload.error : `${route} refused (HTTP ${response.status}).`);
    }
    return payload as T;
  }

  /** Read-only routes answer GET; no token is needed for them. */
  private async get<T>(route: string): Promise<T> {
    const response = await fetch(route);
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`${route} answered ${response.status} with a non-JSON body.`);
    }
    if (payload.ok !== true) {
      throw new Error(typeof payload.error === "string" ? payload.error : `${route} refused (HTTP ${response.status}).`);
    }
    return payload as T;
  }

  /** The runtime's own report — and where the session token comes from. */
  public async status(force = false): Promise<LabStatus> {
    if (this.statusCache && !force) return this.statusCache;
    const response = await fetch("/api/lab/status");
    const payload = (await response.json()) as Envelope<never> & LabStatus;
    if (payload.ok !== true) {
      throw new Error(
        typeof payload.error === "string"
          ? payload.error
          : "The laboratory runtime did not answer. It is only available from the development server.",
      );
    }
    this.token = payload.token;
    this.statusCache = payload;
    return payload;
  }

  public sync(): Promise<{ ok: boolean; sync: LabSync; fetch: { ok: boolean; output: string } }> {
    return this.post("/api/lab/sync");
  }

  public inspect(): Promise<{ ok: boolean; discovery: LabDiscovery }> {
    return this.post("/api/lab/inspect");
  }

  public discoveries(): Promise<{ discoveries: LabDiscovery[] }> {
    return this.post("/api/lab/discoveries");
  }

  public tree(path = ""): Promise<{ path: string; entries: LabTreeEntry[] }> {
    return this.post("/api/lab/tree", { path });
  }

  public file(path: string): Promise<{ path: string; content: string; lines: number; bytes: number }> {
    return this.post("/api/lab/file", { path });
  }

  public search(query: string): Promise<{ query: string; hits: Array<{ path: string; line: number; text: string }> }> {
    return this.post("/api/lab/search", { query });
  }

  public commits(limit = 12): Promise<{ commits: LabCommit[] }> {
    return this.post("/api/lab/commits", { limit });
  }

  public genealogy(path: string): Promise<{ genealogy: LabGenealogy }> {
    return this.post("/api/lab/genealogy", { path });
  }

  public journal(): Promise<{ entries: LabJournalEntry[] }> {
    return this.get("/api/lab/journal");
  }

  /* --------------------------- experiments --------------------------- */

  public listExperiments(): Promise<{ experiments: LabExperiment[] }> {
    return this.post("/api/lab/experiment", { action: "list" });
  }

  public createExperiment(
    options: string | { id?: string; discoveryId?: string; findingId?: string; reason?: string } = {},
  ): Promise<{ experiment: LabExperiment }> {
    const body = typeof options === "string" ? { id: options } : options;
    return this.post("/api/lab/experiment", { action: "create", ...body });
  }

  public concludeExperiment(
    id: string,
    status: "verified" | "abandoned",
    note?: string,
  ): Promise<{ experiment: LabExperiment }> {
    return this.post("/api/lab/experiment", { action: "conclude", id, status, ...(note ? { note } : {}) });
  }

  /* ---------------------------- scheduler ---------------------------- */

  public scheduler(): Promise<{ scheduler: LabSchedulerState }> {
    return this.get("/api/lab/scheduler");
  }

  public startScheduler(intervalMs = 86_400_000): Promise<{ scheduler: LabSchedulerState; spawned: number | null }> {
    return this.post("/api/lab/scheduler", { action: "start", intervalMs });
  }

  public stopScheduler(): Promise<{ stopped: number; scheduler: LabSchedulerState }> {
    return this.post("/api/lab/scheduler", { action: "stop" });
  }

  /** One real cycle, in the running server: same engine, same journal. */
  public runCycle(): Promise<{ discovery: LabDiscovery; scheduler: LabSchedulerState }> {
    return this.post("/api/lab/scheduler", { action: "run-once" });
  }

  public removeExperiment(id: string): Promise<{ removed: string }> {
    return this.post("/api/lab/experiment", { action: "remove", id });
  }

  public readExperiment(id: string, path: string): Promise<{ path: string; content: string | null }> {
    return this.post("/api/lab/experiment", { action: "read", id, path });
  }

  public writeExperiment(id: string, path: string, content: string): Promise<{ path: string; chars: number }> {
    return this.post("/api/lab/experiment", { action: "write", id, path, content });
  }

  /** One exact replacement; the server refuses an anchor that is absent or ambiguous. */
  public patchExperiment(
    id: string,
    path: string,
    find: string,
    replace: string,
  ): Promise<{ path: string; before: number; after: number }> {
    return this.post("/api/lab/experiment", { action: "patch", id, path, find, replace });
  }

  public experimentDiff(id: string): Promise<{ diff: LabDiff }> {
    return this.post("/api/lab/experiment", { action: "diff", id });
  }

  public commitExperiment(
    id: string,
    message: string,
  ): Promise<{ commit: string; branch: string; files: string[]; show: string; output: string }> {
    return this.post("/api/lab/experiment", { action: "commit", id, message });
  }

  public runCommand(id: string, command: string): Promise<LabCommandResult> {
    return this.post("/api/lab/experiment", { action: "command", id, command });
  }

  public startPreview(id: string, port = 3002): Promise<{ preview: LabPreview }> {
    return this.post("/api/lab/experiment", { action: "preview-start", id, port });
  }

  public stopPreview(id: string): Promise<{ stopped: string }> {
    return this.post("/api/lab/experiment", { action: "preview-stop", id });
  }

  public screenshot(
    id: string,
    viewport: { width: number; height: number },
    label: string,
  ): Promise<{ ok: boolean; file?: string; error?: string }> {
    return this.post("/api/lab/experiment", { action: "screenshot", id, width: viewport.width, height: viewport.height, label });
  }

  public evidence(): Promise<{ files: Array<{ path: string; name: string; bytes: number }> }> {
    return this.get("/api/lab/evidence");
  }
}
