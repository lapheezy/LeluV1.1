/**
 * ==========================================================
 * LÉLU — CANONICAL PROVIDER CREDENTIAL CONTRACT
 *
 * The ONE answer to "which environment names carry provider X's
 * credential, in what order, and is what they carry usable?".
 *
 * Before this, the same question was answered separately by the
 * model broker (plugins/modelApi.ts), the key ring
 * (model/ProviderKeyRing.ts), every provider constructor,
 * Environment.ts, config/ConfigStatus.ts and plugins/envApi.ts —
 * with different name lists. Consequences that were measured:
 *   • GROQ_API_KEYS (a comma list) worked for the key ring but the
 *     broker — the path every browser request takes — ignored it, so
 *     the server reported Groq UNCONFIGURED while holding keys;
 *   • OPEN_ROUTER_API_KEY and GROQ_API_KEY_2 worked in the broker but
 *     Environment, ConfigStatus and /api/env-check reported MISSING;
 *   • ConfigStatus accepted the ambient GITHUB_TOKEN (CI/Codespaces
 *     git token) as a GitHub Models credential, which the provider
 *     itself refuses — a false-positive "configured";
 *   • any non-empty string counted, so "your-key-here" or a Groq key
 *     pasted into OPENROUTER_API_KEY read as configured.
 *
 * RULES
 *   1. Names are a deliberate compatibility mapping, not a rename.
 *      Every name that worked anywhere before is still accepted by
 *      the provider it belongs to; the CANONICAL name is the one to
 *      document and to set on a server.
 *   2. Server-side. VITE_-prefixed names are accepted for backwards
 *      compatibility only: Vite's dev server exposes every VITE_
 *      variable to the page, so the broker warns about them. Nothing
 *      here reads import.meta.env (a dynamic read inlines the whole
 *      env record into the bundle — see resolveEnv.ts).
 *   3. A credential is used only by its own provider. A value that
 *      carries another provider's distinctive prefix is reported
 *      INVALID, never sent.
 *   4. Results carry names and states. Only `credentials` holds key
 *      material, and only for the code that sends the request.
 *
 * Anthropic's names are listed so diagnostics are complete, but
 * Anthropic is policy-gated (model/ProviderPolicy.ts, and the broker's
 * own LELU_ENABLE_ANTHROPIC check). This module does not change that.
 * ==========================================================
 */

export type CredentialProviderId =
  | "groq"
  | "openrouter"
  | "cerebras"
  | "fireworks"
  | "mistral"
  | "gemini"
  | "githubModels"
  | "anthropic";

/** Reads exactly one environment name. Never resolves aliases itself. */
export type EnvNameReader = (name: string) => string | undefined;

export interface CredentialSpec {
  /** The name to document and set on a server. */
  canonical: string;
  /** Every accepted single-value name, in order of preference. */
  names: readonly string[];
  /** Names holding a comma/space separated list of keys. */
  lists: readonly string[];
  /**
   * Names that look related but must never be adopted, with the reason.
   * They are reported when present so an operator sees why they are ignored.
   */
  refused: Readonly<Record<string, string>>;
  /** Distinctive key prefix, when the provider has one. Used only to spot a
   *  key configured under the WRONG provider — never to reject a key that
   *  lacks it. */
  prefix?: string;
  /** Policy-gated: configured is not the same as allowed. */
  policyGated?: boolean;
}

const slots = (base: string): string[] => [1, 2, 3, 4].map((n) => `${base}_${n}`);

export const CREDENTIAL_SPECS: Readonly<Record<CredentialProviderId, CredentialSpec>> = {
  groq: {
    canonical: "GROQ_API_KEY",
    names: ["VITE_GROQ_API_KEY", "GROQ_API_KEY", ...slots("GROQ_API_KEY")],
    lists: ["GROQ_API_KEYS", "GROQ_KEYS"],
    refused: {},
    prefix: "gsk_",
  },
  openrouter: {
    canonical: "OPENROUTER_API_KEY",
    names: ["VITE_OPENROUTER_API_KEY", "OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY", ...slots("OPENROUTER_API_KEY")],
    lists: ["OPENROUTER_API_KEYS"],
    refused: {},
    prefix: "sk-or-",
  },
  cerebras: {
    canonical: "CEREBRAS_API_KEY",
    names: ["VITE_CEREBRAS_API_KEY", "CEREBRAS_API_KEY"],
    lists: [],
    refused: {},
    prefix: "csk-",
  },
  fireworks: {
    canonical: "FIREWORKS_API_KEY",
    names: ["VITE_FIREWORKS_API_KEY", "FIREWORKS_API_KEY"],
    lists: [],
    refused: {},
  },
  mistral: {
    canonical: "MISTRAL_API_KEY",
    names: ["VITE_MISTRAL_API_KEY", "MISTRAL_API_KEY"],
    lists: [],
    refused: {},
  },
  gemini: {
    canonical: "GEMINI_API_KEY",
    // Gemini-specific names before the generic GOOGLE_API_KEY, which Google's
    // own SDK also accepts for Gemini but which projects often hold for Maps
    // or YouTube: when both are set, the Gemini-specific one wins.
    names: ["VITE_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
    lists: [],
    refused: {},
    prefix: "AIza",
  },
  githubModels: {
    canonical: "GITHUB_MODELS_TOKEN",
    names: ["VITE_GITHUB_TOKEN", "GITHUB_MODELS_TOKEN"],
    lists: [],
    refused: {
      GITHUB_TOKEN: "ambient git-tooling token set by CI and Codespaces, not a GitHub Models credential",
      GITHUB_CODESPACE_TOKEN: "ambient Codespaces token, not a GitHub Models credential",
    },
  },
  anthropic: {
    canonical: "ANTHROPIC_API_KEY",
    names: ["VITE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "LELU_ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    lists: [],
    refused: {},
    prefix: "sk-ant-",
    policyGated: true,
  },
};

/** The six chat providers this runtime is authorised to use. */
export const AUTHORIZED_CHAT_PROVIDERS = ["groq", "openrouter", "cerebras", "fireworks", "mistral", "gemini"] as const;

/** Every name that can carry this provider's credential (singles, then lists). */
export function credentialNames(id: CredentialProviderId): string[] {
  const spec = CREDENTIAL_SPECS[id];
  return [...spec.names, ...spec.lists];
}

export type CredentialState = "configured" | "missing" | "invalid";

export interface ResolvedCredential {
  /** The environment name (and list position) it came from. Never a secret. */
  label: string;
  key: string;
}

export interface CredentialIssue {
  name: string;
  reason: string;
}

export interface CredentialResolution {
  provider: CredentialProviderId;
  state: CredentialState;
  /** Name of the first usable credential, for diagnostics. */
  source?: string;
  /** Usable credentials, de-duplicated, in preference order. KEY MATERIAL. */
  credentials: ResolvedCredential[];
  /** Values present under an accepted name but unusable. Names only. */
  invalid: CredentialIssue[];
  /** Refused names that are set (ignored on purpose). Names only. */
  ignored: CredentialIssue[];
}

/** The same answer with the key material removed — safe to log or return. */
export type CredentialReport = Omit<CredentialResolution, "credentials"> & {
  canonical: string;
  acceptedNames: string[];
  /** How many distinct usable credentials are configured. */
  count: number;
  policyGated: boolean;
};

/**
 * Template values people leave in .env files. Anchored to whole-word shapes
 * so a real random key that merely starts with "my" or "todo" is never
 * rejected: a placeholder word must be followed by a separator, or be the
 * entire value.
 */
const PLACEHOLDERS: RegExp[] = [
  /^(?:your|my|insert|enter|replace|paste|add)[-_ ]/i,
  /^(?:change[-_]?me|todo|placeholder|example|dummy|none|null|undefined|x{3,}|\*{3,})$/i,
  /^<.*>$/,
  /^\$\{.*\}$/,
  /\.{3}/,
  /[-_]here$/i,
];

/** Why a value cannot be this provider's credential, or undefined if it can. */
export function credentialProblem(id: CredentialProviderId, value: string): string | undefined {
  if (/\s/.test(value)) return "contains whitespace";
  if (value.length < 8) return "too short to be an API key";
  if (PLACEHOLDERS.some((pattern) => pattern.test(value))) return "looks like a placeholder, not a key";
  for (const [other, spec] of Object.entries(CREDENTIAL_SPECS) as Array<[CredentialProviderId, CredentialSpec]>) {
    if (other === id || !spec.prefix) continue;
    // A provider whose own prefix is a longer form of another's (none today)
    // must not be flagged by the shorter one.
    const own = CREDENTIAL_SPECS[id].prefix;
    if (own && own.startsWith(spec.prefix)) continue;
    if (value.startsWith(spec.prefix)) return `has the ${other} key prefix — configured under the wrong provider`;
  }
  return undefined;
}

/**
 * The default reader: one exact name, through the same channels resolveEnv
 * uses, minus import.meta.env.
 *
 *   1. globalThis.__LELU_<BARE>__  (native shells and verification scripts
 *      inject keys here; runtimeKeyBridge never publishes model keys)
 *   2. process.env.<NAME>          (server runtimes)
 */
export const defaultEnvNameReader: EnvNameReader = (name) => {
  const bare = name.startsWith("VITE_") ? name.slice("VITE_".length) : name;
  const runtime = globalThis as unknown as Record<string, unknown>;
  const fromGlobal = runtime[`__LELU_${bare}__`];
  if (typeof fromGlobal === "string" && fromGlobal.trim()) return fromGlobal;
  const env =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined> | undefined)
      : undefined;
  const fromProcess = env?.[name];
  return typeof fromProcess === "string" && fromProcess.trim() ? fromProcess : undefined;
};

/** Resolve every usable credential for a provider, with reasons for the rest. */
export function resolveProviderCredentials(
  id: CredentialProviderId,
  read: EnvNameReader = defaultEnvNameReader,
): CredentialResolution {
  const spec = CREDENTIAL_SPECS[id];
  const credentials: ResolvedCredential[] = [];
  const invalid: CredentialIssue[] = [];
  const seen = new Set<string>();

  const consider = (label: string, raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const problem = credentialProblem(id, value);
    if (problem) {
      invalid.push({ name: label, reason: problem });
      return;
    }
    // The same key under two names is one key.
    if (seen.has(value)) return;
    seen.add(value);
    credentials.push({ label, key: value });
  };

  for (const name of spec.names) {
    const value = read(name);
    if (typeof value === "string") consider(name, value);
  }
  for (const name of spec.lists) {
    const value = read(name);
    if (typeof value !== "string") continue;
    value
      .split(/[,\s]+/)
      .filter(Boolean)
      .forEach((entry, index) => consider(`${name}[${index + 1}]`, entry));
  }

  const ignored: CredentialIssue[] = [];
  for (const [name, reason] of Object.entries(spec.refused)) {
    const value = read(name);
    if (typeof value === "string" && value.trim()) ignored.push({ name, reason });
  }

  const state: CredentialState = credentials.length > 0 ? "configured" : invalid.length > 0 ? "invalid" : "missing";
  return {
    provider: id,
    state,
    ...(credentials[0] ? { source: credentials[0].label } : {}),
    credentials,
    invalid,
    ignored,
  };
}

/** The first usable credential, or "" — for a provider sending directly. */
export function primaryCredential(id: CredentialProviderId, read: EnvNameReader = defaultEnvNameReader): string {
  return resolveProviderCredentials(id, read).credentials[0]?.key ?? "";
}

/** A diagnostics report with no key material in it. */
export function credentialReport(
  id: CredentialProviderId,
  read: EnvNameReader = defaultEnvNameReader,
): CredentialReport {
  const { credentials, ...rest } = resolveProviderCredentials(id, read);
  const spec = CREDENTIAL_SPECS[id];
  return {
    ...rest,
    canonical: spec.canonical,
    acceptedNames: credentialNames(id),
    count: credentials.length,
    policyGated: spec.policyGated === true,
  };
}

/** One line an operator can act on. Names only. */
export function describeCredentialState(report: CredentialReport): string {
  if (report.state === "configured") {
    return `${report.provider}: configured from ${report.source}${report.count > 1 ? ` (+${report.count - 1} more)` : ""}.`;
  }
  if (report.state === "invalid") {
    const detail = report.invalid.map((issue) => `${issue.name} ${issue.reason}`).join("; ");
    return `${report.provider}: credential present but unusable — ${detail}. Set a valid ${report.canonical} on the server.`;
  }
  const ignored = report.ignored.length
    ? ` (${report.ignored.map((issue) => `${issue.name} is ignored: ${issue.reason}`).join("; ")})`
    : "";
  return `${report.provider}: no credential. Set ${report.canonical} on the server${ignored}.`;
}
