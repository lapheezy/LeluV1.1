/**
 * ==========================================================
 * LÉLU — ACQUISITION IDENTITY
 *
 * One repository is one acquisition, whatever shape its URL
 * arrived in. A person types `github.com/owner/repo`, a model
 * pastes `https://github.com/owner/repo.git`, a clone line uses
 * `git@github.com:owner/repo.git`, and a trailing slash appears
 * from a copy-paste. All four name the same repository, so all
 * four must resolve to the same acquisition.
 *
 * This module is the single normalizer. It is pure — no
 * filesystem, no network — so the server's clone path and the
 * tests that guard it agree by construction rather than by
 * coincidence.
 * ==========================================================
 */

/** Structural minimum the reuse check needs; no import cycle, no runtime coupling. */
export interface AcquisitionIdentityCarrier {
  source?: { identifier?: string; url?: string } | null;
  ref?: string;
}

export interface RepositoryIdentity {
  /** Lowercased host, without a leading `www.`. */
  host: string;
  /** `owner/name`, lowercased, without `.git`. */
  identifier: string;
  /** The canonical https clone URL for this identity. */
  url: string;
}

const SCP_STYLE = /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):(?!\/)(.+)$/;

function stripRepoSuffix(pathname: string): string {
  return pathname
    .replace(/^\/+/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

function canonicalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Resolve any accepted spelling of a repository to one identity.
 * Throws only when nothing repository-shaped is present, so a
 * caller can never silently dedupe two different repositories.
 */
export function normalizeRepositoryUrl(raw: string): RepositoryIdentity {
  const input = String(raw ?? "").trim();
  if (!input) throw new Error("A repository URL or owner/name is required.");

  let host = "";
  let path = "";

  const scp = SCP_STYLE.exec(input);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    host = scp[1];
    path = scp[2];
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error(`Not a valid repository URL: ${input}`);
    }
    host = parsed.hostname;
    path = parsed.pathname;
  } else if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}\//.test(input)) {
    // A host without a scheme: github.com/owner/repo.
    let parsed: URL;
    try {
      parsed = new URL(`https://${input.replace(/^\/+/, "")}`);
    } catch {
      throw new Error(`Not a valid repository URL: ${input}`);
    }
    host = parsed.hostname;
    path = parsed.pathname;
  } else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(input)) {
    // Bare `owner/name` — the GitHub shorthand the workforce uses.
    host = "github.com";
    path = input;
  } else {
    throw new Error(`Cannot read a repository identity from "${input}".`);
  }

  const identifier = stripRepoSuffix(path).toLowerCase();
  if (!/^[A-Za-z0-9_.\-\/]+$/.test(identifier) || !identifier.includes("/")) {
    throw new Error(`Expected a repository path like owner/name, got "${identifier}".`);
  }

  const canonical = canonicalHost(host);
  if (!canonical) throw new Error(`Cannot read a repository host from "${input}".`);

  return {
    host: canonical,
    identifier,
    url: `https://${canonical}/${identifier}.git`,
  };
}

/** True when two spellings name the same repository. */
export function sameRepository(a: string, b: string): boolean {
  try {
    const left = normalizeRepositoryUrl(a);
    const right = normalizeRepositoryUrl(b);
    return left.host === right.host && left.identifier === right.identifier;
  } catch {
    return false;
  }
}

/**
 * The existing acquisition for this repository, if one already
 * holds the requested ref. A different ref is a deliberate
 * reinspection and is allowed to produce its own record.
 */
export function findReusableAcquisition<T extends AcquisitionIdentityCarrier>(
  records: readonly T[],
  identity: RepositoryIdentity,
  ref = "",
): T | null {
  const wanted = ref.trim();
  for (const record of records) {
    const source = record.source;
    if (!source) continue;
    let candidate: RepositoryIdentity;
    try {
      candidate = normalizeRepositoryUrl(source.identifier || source.url || "");
    } catch {
      continue;
    }
    if (candidate.host !== identity.host || candidate.identifier !== identity.identifier) continue;
    if (wanted && record.ref !== wanted) continue;
    return record;
  }
  return null;
}

/**
 * Concurrent callers asking for the same repository share one
 * clone. Without this, two identical requests in flight together
 * both miss the reuse check and both clone — the duplicate the
 * guard exists to prevent.
 */
export class AcquisitionSingleFlight {
  private inflight = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const started = work().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, started);
    return started;
  }

  /** Test-only: how many keys are in flight right now. */
  size(): number {
    return this.inflight.size;
  }
}
