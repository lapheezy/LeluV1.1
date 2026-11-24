/**
 * ==========================================================
 * LÉLU — WHAT SHE IS CONFIGURED WITH
 *
 * Secrets and settings arrive by several routes: a platform
 * injects them into the process, an operator writes .env or
 * .env.local (loaded by plugins/loadEnvFiles.ts and by Vite),
 * and the runtime key bridge republishes unprefixed names onto
 * the __LELU_*__ channel for the browser. resolveEnv already
 * walks all of those. What did not exist was a way for LÉLU to
 * ASK what came through.
 *
 * That gap has a cost, and this project has now paid it twice.
 * A capability was simply dead — Supabase with a publishable
 * key and no project URL — and nothing anywhere said which half
 * was missing. She could not report it, because she could not
 * see it.
 *
 * So this is a read-only view over the EXISTING resolver and
 * the EXISTING endpoint registry. It stores nothing, resolves
 * nothing new, and is deliberately incapable of returning a
 * secret: it answers "is this configured, and if not which name
 * is absent" and nothing else. Every field below is a name or a
 * boolean. There is no code path here that returns a value.
 * ==========================================================
 */

import { resolveEnvValue } from "../resolveEnv";
import { endpoint } from "../Endpoints";
import {
  CREDENTIAL_SPECS,
  credentialNames,
  resolveProviderCredentials,
  type CredentialProviderId,
} from "../model/ProviderCredentials";

/** One capability, and whether its configuration is complete. */
export interface ConfigCapability {
  id: string;
  /** What it unlocks, in plain terms. */
  purpose: string;
  /**
   * The environment names that satisfy each required part. A part is
   * satisfied when ANY of its names resolves; the capability is
   * configured when EVERY part is satisfied — which is the case a
   * single boolean gets wrong, and the case that bit us.
   */
  parts: Array<{ label: string; names: string[]; present: boolean }>;
  configured: boolean;
  /** The parts that are absent, by the name an operator should set. */
  missing: string[];
}

/** True only in a real browser — the shim in tests defines no document. */
function inBrowser(): boolean {
  const host = globalThis as { document?: unknown };
  return host.document !== undefined;
}

const present = (names: string[]): boolean =>
  names.some((name) => {
    const value = resolveEnvValue(name);
    return typeof value === "string" && value.trim().length > 0;
  });

/** A part satisfied by an endpoint that resolves to a real URL. */
const endpointPresent = (id: Parameters<typeof endpoint>[0]): boolean => {
  try {
    return endpoint(id).trim().length > 0;
  } catch {
    return false;
  }
};

interface Definition {
  id: string;
  purpose: string;
  parts: Array<{ label: string; names: string[]; resolver?: () => boolean }>;
}

/**
 * A chat provider's credential part, judged by the canonical contract: the
 * same names the server broker reads, and a value only counts when it is
 * usable (a placeholder or another provider's key does not).
 */
function chatProvider(id: string, provider: CredentialProviderId, purpose: string): Definition {
  return {
    id,
    purpose,
    parts: [
      {
        label: provider === "githubModels" ? "token" : "API key",
        // Canonical name first: `missing` reports names[0], and that should
        // be the server-side name to set, not a legacy VITE_ alias.
        names: [
          CREDENTIAL_SPECS[provider].canonical,
          ...credentialNames(provider).filter((name) => name !== CREDENTIAL_SPECS[provider].canonical),
        ],
        resolver: () => resolveProviderCredentials(provider).state === "configured",
      },
    ],
  };
}

/**
 * What LÉLU can be configured with.
 *
 * Providers are listed individually because the fallback chain treats
 * them individually: knowing "some provider is configured" is not the
 * same as knowing which one will answer.
 */
const DEFINITIONS: Definition[] = [
  chatProvider("provider.groq", "groq", "Chat/reasoning provider (priority 1 in the fallback chain), and voice transcription"),
  chatProvider("provider.openrouter", "openrouter", "Chat/reasoning provider (fallback)"),
  chatProvider("provider.cerebras", "cerebras", "Chat/reasoning provider (fallback)"),
  chatProvider("provider.mistral", "mistral", "Chat/reasoning provider (fallback)"),
  chatProvider("provider.fireworks", "fireworks", "Chat/reasoning provider (fallback)"),
  chatProvider("provider.gemini", "gemini", "Chat/reasoning provider (fallback)"),
  chatProvider("provider.anthropic", "anthropic", "Chat/reasoning provider with native tool use (opt-in: LELU_ENABLE_ANTHROPIC)"),
  // GITHUB_TOKEN used to count here. It is the ambient git token CI and
  // Codespaces set, which the provider and the broker both refuse, so this
  // said "configured" for a provider that had no credential.
  chatProvider("provider.github-models", "githubModels", "Chat provider proxied through the server broker"),
  {
    // THE CASE THAT MOTIVATED THIS. Both halves are required and only
    // one was present, so every "is Supabase set up" check that asked
    // about the key alone answered yes about something that could not
    // connect.
    id: "persistence.supabase",
    purpose: "Cloud persistence and sync for memories, knowledge and cognitive events",
    parts: [
      {
        label: "project URL",
        names: ["VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
        resolver: () =>
          present(["VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) ||
          endpointPresent("supabase"),
      },
      {
        label: "publishable key",
        names: [
          "VITE_SUPABASE_PUBLISHABLE_KEY",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          "SUPABASE_PUBLISHABLE_KEY",
          "SUPABASE_ANON_KEY",
        ],
      },
    ],
  },
];

/** Every capability, with the parts it still needs. Names only. */
export function configCapabilities(): ConfigCapability[] {
  return DEFINITIONS.map((definition) => {
    const parts = definition.parts.map((part) => ({
      label: part.label,
      names: [...part.names],
      present: part.resolver ? part.resolver() : present(part.names),
    }));
    const missing = parts.filter((part) => !part.present).map((part) => part.names[0]);
    return {
      id: definition.id,
      purpose: definition.purpose,
      parts,
      configured: missing.length === 0,
      missing,
    };
  });
}

/** Just the ones that can actually be used. */
export function configuredCapabilityIds(): string[] {
  return configCapabilities().filter((entry) => entry.configured).map((entry) => entry.id);
}

/**
 * The half-configured ones — the most useful answer here.
 *
 * A capability nobody set up is expected. One where a key was supplied
 * and a URL was not is somebody believing it works.
 */
export function partiallyConfigured(): ConfigCapability[] {
  return configCapabilities().filter(
    (entry) => !entry.configured && entry.parts.some((part) => part.present),
  );
}

/**
 * A plain-language account, for the cognitive context and the tool.
 *
 * It names environment variables and says present or absent. It never
 * reads a value into the string — there is no branch here that could.
 */
export function describeConfiguration(): string {
  const capabilities = configCapabilities();
  const ready = capabilities.filter((entry) => entry.configured);
  const half = capabilities.filter(
    (entry) => !entry.configured && entry.parts.some((part) => part.present),
  );
  const absent = capabilities.filter(
    (entry) => !entry.configured && !entry.parts.some((part) => part.present),
  );

  const lines: string[] = [
    `Configured: ${ready.map((entry) => entry.id).join(", ") || "nothing"}.`,
  ];
  if (half.length > 0) {
    lines.push(
      "PARTLY configured — these look set up but cannot work until the missing name is supplied:",
      ...half.map(
        (entry) =>
          `- ${entry.id} (${entry.purpose}) — missing ${entry.missing.join(", ")}. ` +
          `Set it in the environment or in a .env file at the project root.`,
      ),
    );
  }
  if (absent.length > 0) {
    lines.push(`Not configured: ${absent.map((entry) => entry.id).join(", ")}.`);
  }
  lines.push(
    "These are names and presence only. You cannot read a secret's value, and must never ask a user to paste one into the conversation.",
  );
  if (inBrowser()) {
    // The page is deliberately not given every secret — a server-held
    // credential reaches a provider through the same-origin broker and
    // is never published here. So this view is the PAGE's view, and
    // saying so stops it being read as the whole truth.
    lines.push(
      "This is what the page can see. A credential held only by the server is invisible from here " +
        "and still works, because provider calls go through the same-origin broker — so treat " +
        "anything above as 'not visible to me', not as 'absent from the system'.",
    );
  }
  return lines.join("\n");
}
