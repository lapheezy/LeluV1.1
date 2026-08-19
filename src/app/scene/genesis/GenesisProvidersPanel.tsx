/**
 * ==========================================================
 * LÉLUVERSE
 * API STATUS PANEL
 *
 * The "API Status" side tab. Reads ONLY from the real AI
 * infrastructure through AIService.getApiStatus():
 *
 *   - AIProviderRegistry runtime state (the provider that last
 *     succeeded = "currently active", per-provider last
 *     success/failure/cooldown/usage) — the exact state the
 *     fallback chain (ProviderResolver) writes to,
 *   - each provider's own health() report,
 *   - the knowledge/research provider list.
 *
 * No second registry, no second fallback system, no frontend
 * guesses: if the runtime says a provider failed with a
 * credit/quota error, this panel shows ⚠ OUT OF CREDITS. If
 * the device is offline it shows ⌁ OFFLINE — never a made-up
 * credit error. Keys and .env contents never appear; only safe
 * status diagnostics.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { genesisTheme } from "./GenesisTheme";
import AIService from "../../../core/AIService";
import GenesisWindowFrame from "./GenesisWindowFrame";

const ai = AIService.getInstance();

type StatusKind =
  | "operational"
  | "out-of-credits"
  | "rate-limited"
  | "auth-error"
  | "provider-error"
  | "offline"
  | "not-configured";

type ApiStatus = Awaited<ReturnType<typeof ai.getApiStatus>>;
type RuntimeRow = ApiStatus["runtime"]["providers"][number];
type HealthRow = ApiStatus["health"][number];

interface ProviderFailure {
  count: number;
  lastFailure: number;
  reason: string;
}

interface MergedProvider {
  name: string;
  priority: number;
  enabled: boolean;
  requiresApiKey: boolean;
  timeout: number;
  lastSuccess?: number;
  lastUsage: unknown;
  failure: ProviderFailure | null;
  inCooldown: boolean;
  health?: HealthRow["health"];
  kind: StatusKind;
  detail: string;
  isActive: boolean;
}

/**
 * Verified official provider pages — never invented URLs.
 * "manage" = key/auth console, "credits" = billing/credits page.
 */
const PROVIDER_LINKS: Record<string, { manage: string; credits: string }> = {
  Groq: {
    manage: "https://console.groq.com/keys",
    credits: "https://console.groq.com/settings/billing",
  },
  OpenRouter: {
    manage: "https://openrouter.ai/settings/keys",
    credits: "https://openrouter.ai/settings/credits",
  },
  "GitHub Models": {
    manage: "https://github.com/settings/tokens",
    credits: "https://github.com/settings/tokens",
  },
  Cerebras: {
    manage: "https://cloud.cerebras.ai/platform/account/api-keys",
    credits: "https://cloud.cerebras.ai/platform/account/billing",
  },
  Mistral: {
    manage: "https://console.mistral.ai/api-keys/",
    credits: "https://console.mistral.ai/billing/",
  },
  Fireworks: {
    manage: "https://fireworks.ai/api-keys",
    credits: "https://fireworks.ai/account",
  },
};

const STATUS_META: Record<StatusKind, { label: string; color: string }> = {
  operational: { label: "✓ OPERATIONAL", color: genesisTheme.status.ok },
  "out-of-credits": { label: "⚠ OUT OF CREDITS", color: genesisTheme.status.warn },
  "rate-limited": { label: "⚠ RATE LIMITED", color: genesisTheme.status.warn },
  "auth-error": { label: "✕ AUTHENTICATION ERROR", color: genesisTheme.status.error },
  "provider-error": { label: "✕ PROVIDER ERROR", color: genesisTheme.status.error },
  offline: { label: "⌁ OFFLINE", color: genesisTheme.status.idle },
  "not-configured": { label: "○ NOT CONFIGURED", color: genesisTheme.status.idle },
};

function classifyProvider(opts: {
  online: boolean;
  enabled: boolean;
  failure: ProviderFailure | null;
  inCooldown: boolean;
  health?: HealthRow["health"];
}): { kind: StatusKind; detail: string } {
  if (!opts.enabled) {
    return { kind: "not-configured", detail: "Provider disabled" };
  }

  if (!opts.online) {
    return {
      kind: "offline",
      detail: "Device offline — external providers unreachable. Local identity & memory keep working.",
    };
  }

  // A failure recorded by the real runtime (ProviderResolver) while
  // it is inside its failure cooldown is the authoritative state.
  if (opts.failure && opts.inCooldown) {
    const reason = opts.failure.reason;
    if (/quota|credit|billing|insufficient|402|payment/i.test(reason)) {
      return { kind: "out-of-credits", detail: reason };
    }
    if (/rate|429|too many|throttl/i.test(reason)) {
      return { kind: "rate-limited", detail: reason };
    }
    if (/401|403|unauthor|invalid.{0,12}key|api key/i.test(reason)) {
      return { kind: "auth-error", detail: reason };
    }
    return { kind: "provider-error", detail: reason };
  }

  const h = opts.health;
  if (h) {
    if (h.available) {
      return { kind: "operational", detail: "Available" };
    }
    const err = h.lastError ?? "";
    if (/key missing|not configured|not initialized/i.test(err)) {
      return { kind: "not-configured", detail: err };
    }
    if (/401|403|unauthor|invalid.{0,12}key/i.test(err)) {
      return { kind: "auth-error", detail: err };
    }
    return { kind: "provider-error", detail: err || "Unavailable" };
  }

  return { kind: "not-configured", detail: "Not checked yet" };
}

function ago(timestamp: number | undefined | null): string {
  if (!timestamp) {
    return "never";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function usageSummary(usage: unknown): string | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const record = usage as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.prompt_tokens === "number") parts.push(`${record.prompt_tokens} in`);
  if (typeof record.completion_tokens === "number") parts.push(`${record.completion_tokens} out`);
  if (typeof record.total_tokens === "number") parts.push(`${record.total_tokens} total`);
  if (parts.length > 0) {
    return `Last response: ${parts.join(" · ")}`;
  }
  const raw = JSON.stringify(record);
  return raw && raw.length <= 80 ? `Last response usage: ${raw}` : null;
}

function StatusChip({ kind, compact = false }: { kind: StatusKind; compact?: boolean }) {
  const meta = STATUS_META[kind];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${meta.color}`,
        color: meta.color,
        borderRadius: 999,
        padding: compact ? "1px 8px" : "2px 10px",
        fontSize: compact ? 10 : 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        whiteSpace: "nowrap",
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: meta.color,
          boxShadow: `0 0 8px ${meta.color}`,
          flexShrink: 0,
        }}
      />
      {meta.label}
    </span>
  );
}

function ProviderCard({ provider }: { provider: MergedProvider }) {
  const links = PROVIDER_LINKS[provider.name];
  const usage = usageSummary(provider.lastUsage);
  const health = provider.health;
  const auth =
    provider.requiresApiKey === false
      ? "no key required"
      : health?.available
        ? "authenticated"
        : health?.lastError && /key/i.test(health.lastError)
          ? "key not detected"
          : "key status unknown";

  return (
    <div
      style={{
        border: provider.isActive
          ? `1px solid ${genesisTheme.status.accent}`
          : genesisTheme.glass.borderSoft,
        borderRadius: genesisTheme.radius.md,
        background: provider.isActive
          ? "rgba(34, 211, 238, 0.08)"
          : "rgba(255,255,255,0.03)",
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          {provider.name}
          {provider.isActive ? (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: genesisTheme.status.accent,
                border: `1px solid ${genesisTheme.status.accent}`,
                borderRadius: 999,
                padding: "1px 8px",
              }}
            >
              ● ACTIVE — IN USE
            </span>
          ) : null}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <StatusChip kind={provider.kind} compact />
        </span>
      </div>

      <div style={{ fontSize: 11, lineHeight: 1.7, opacity: 0.78 }}>
        <div>
          Fallback priority #{provider.priority} · auth: {auth} · timeout {provider.timeout}ms
        </div>
        <div>
          Last successful connection: <strong>{ago(provider.lastSuccess)}</strong> · last status
          check: <strong>{ago(health?.lastChecked)}</strong>
        </div>
        {usage ? <div style={{ opacity: 0.9 }}>{usage}</div> : null}
        {provider.failure ? (
          <div style={{ color: genesisTheme.status.error, marginTop: 2 }}>
            Last failure ({provider.failure.count}×): {provider.failure.reason}
          </div>
        ) : null}
        {provider.kind === "not-configured" && provider.detail ? (
          <div style={{ opacity: 0.9 }}>{provider.detail}</div>
        ) : null}
      </div>

      {links ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a
            href={links.manage}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...genesisTheme.closeButton,
              minHeight: 32,
              padding: "6px 12px",
              fontSize: 11,
              textDecoration: "none",
            }}
          >
            MANAGE API
          </a>
          {provider.kind === "out-of-credits" ? (
            <a
              href={links.credits}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                ...genesisTheme.closeButton,
                minHeight: 32,
                padding: "6px 12px",
                fontSize: 11,
                textDecoration: "none",
                border: `1px solid ${genesisTheme.status.warn}`,
                color: genesisTheme.status.warn,
              }}
            >
              GET CREDITS
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface GenesisProvidersPanelProps {
  onClose: () => void;
}

export default function GenesisProvidersPanel({ onClose }: GenesisProvidersPanelProps) {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [online, setOnline] = useState(
    () => (typeof navigator !== "undefined" ? navigator.onLine : true),
  );
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await ai.getApiStatus();
      setStatus(snapshot);
      setLastCheck(Date.now());
    } catch (error) {
      console.error("[ApiStatusPanel] Status check failed", error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const snapshot = await ai.getApiStatus();
        if (!cancelled) {
          setStatus(snapshot);
          setLastCheck(Date.now());
        }
      } catch (error) {
        console.error("[ApiStatusPanel] Poll failed", error);
      }
    }

    void poll();
    const interval = window.setInterval(poll, 5000);

    const handleOnline = () => {
      setOnline(true);
      void poll();
    };
    const handleOffline = () => {
      setOnline(false);
      void poll();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function handleCheck() {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  }

  const providers = useMemo<MergedProvider[]>(() => {
    if (!status) {
      return [];
    }
    const healthByName = new Map(status.health.map((h) => [h.name, h]));
    const active = status.activeProvider;

    return status.runtime.providers
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((row: RuntimeRow) => {
        const health = healthByName.get(row.name)?.health;
        const classified = classifyProvider({
          online,
          enabled: row.enabled,
          failure: row.failure,
          inCooldown: row.inCooldown,
          health,
        });
        return {
          name: row.name,
          priority: row.priority,
          enabled: row.enabled,
          requiresApiKey: row.requiresApiKey,
          timeout: row.timeout,
          lastSuccess: row.lastSuccess,
          lastUsage: row.lastUsage,
          failure: row.failure,
          inCooldown: row.inCooldown,
          health,
          kind: classified.kind,
          detail: classified.detail,
          isActive: active === row.name,
        };
      });
  }, [status, online]);

  const activeProvider = providers.find((p) => p.isActive) ?? null;
  const operationalCount = providers.filter((p) => p.kind === "operational").length;
  const configuredCount = providers.filter((p) => p.kind !== "not-configured").length;

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · System"
      title={
        <>
          API Status · {activeProvider ? `${activeProvider.name} active` : "no provider active"}
        </>
      }
      onClose={onClose}
      width="min(92vw, 600px)"
      maxHeight="80vh"
      overflow="hidden"
    >
      {/*
       * Self-contained scroll body. The panel is dense enough that it
       * will always overflow a laptop viewport, so it owns its own
       * scroll container instead of relying on the window frame's
       * overflow behavior — bounded max-height + overflow-y:auto is
       * deterministic, with contain overscroll and a visible thin
       * scrollbar (see .genesis-scroll in index.css).
       */}
      <div
        className="genesis-scroll"
        style={{
          maxHeight: "calc(80vh - 132px)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          touchAction: "pan-y",
          paddingRight: 6,
        }}
      >
        {/* Header: network state + last checked + CHECK button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: 10,
          borderRadius: genesisTheme.radius.md,
          border: online
            ? `1px solid ${genesisTheme.status.ok}`
            : `1px solid ${genesisTheme.status.idle}`,
          background: "rgba(255,255,255,0.03)",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: online ? genesisTheme.status.ok : genesisTheme.status.idle,
            boxShadow: online ? `0 0 10px ${genesisTheme.status.ok}` : "none",
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            {online ? "ONLINE" : "⌁ OFFLINE"}
          </div>
          <div style={{ fontSize: 11, opacity: 0.68 }}>
            Last status check: {lastCheck ? ago(lastCheck) : "pending…"} · auto-refresh every 5s
          </div>
        </div>
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking}
          style={{
            ...genesisTheme.closeButton,
            minHeight: 36,
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.04em",
            border: `1px solid ${genesisTheme.status.accent}`,
            color: genesisTheme.status.accent,
            background: "rgba(34, 211, 238, 0.1)",
            cursor: checking ? "default" : "pointer",
            opacity: checking ? 0.7 : 1,
          }}
        >
          {checking ? "CHECKING…" : "CHECK API STATUS"}
        </button>
      </div>

      {!online ? (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            padding: "8px 12px",
            borderRadius: 12,
            border: `1px solid ${genesisTheme.status.idle}`,
            color: genesisTheme.status.idle,
            marginBottom: 12,
          }}
        >
          ⌁ OFFLINE — external AI providers are unreachable. LÉLU's local identity, memory and
          profile keep working, and the fallback chain resumes automatically when the connection
          returns.
        </div>
      ) : null}

      {/* CURRENT ACTIVE PROVIDER */}
      <div
        style={{
          borderRadius: genesisTheme.radius.md,
          border: `1px solid ${genesisTheme.status.accent}`,
          background: "linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(2, 8, 23, 0.4))",
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div style={genesisTheme.text.label}>Current active provider</div>
        {activeProvider ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 800 }}>{activeProvider.name}</span>
            <StatusChip kind={activeProvider.kind} />
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              Lélu is generating through this provider.
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6, lineHeight: 1.6 }}>
            No provider has succeeded yet — the first successful chat message sets the active
            provider and the tab updates immediately.
          </div>
        )}
      </div>

      {/* FALLBACK CHAIN */}
      <div style={genesisTheme.text.label}>Fallback chain</div>
      <div style={{ margin: "8px 0 14px" }}>
        {providers.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6 }}>No AI providers registered.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {providers.map((provider, index) => {
              const label = index === 0 ? "PRIMARY" : `FALLBACK ${index}`;
              return (
                <div key={provider.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {index > 0 ? (
                    <div style={{ fontSize: 11, color: genesisTheme.status.idle, paddingLeft: 14 }}>
                      ↓
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 10px",
                      borderRadius: 12,
                      border: provider.isActive
                        ? `1px solid ${genesisTheme.status.accent}`
                        : genesisTheme.glass.borderSoft,
                      background: provider.isActive
                        ? "rgba(34, 211, 238, 0.1)"
                        : "rgba(255,255,255,0.03)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        color: provider.isActive
                          ? genesisTheme.status.accent
                          : "rgba(255,255,255,0.5)",
                        width: 72,
                        flexShrink: 0,
                      }}
                    >
                      {provider.isActive ? "▶ " : ""}
                      {label}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 12, flex: 1 }}>{provider.name}</span>
                    <StatusChip kind={provider.kind} compact />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* PROVIDER DETAILS */}
      <div style={genesisTheme.text.label}>
        Provider status · {configuredCount}/{providers.length} configured · {operationalCount}{" "}
        operational
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "8px 0 14px" }}>
        {providers.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6 }}>No AI providers registered.</div>
        ) : (
          providers.map((provider) => <ProviderCard key={provider.name} provider={provider} />)
        )}
      </div>

      {/* KNOWLEDGE / RESEARCH PROVIDERS */}
      {status && status.knowledge.length > 0 ? (
        <>
          <div style={genesisTheme.text.label}>Research / knowledge providers</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0 14px" }}>
            {status.knowledge
              .slice()
              .sort((a, b) => a.priority - b.priority)
              .map((provider) => (
                <div
                  key={provider.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: provider.enabled
                        ? genesisTheme.status.ok
                        : genesisTheme.status.idle,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600 }}>{provider.name}</span>
                  <span style={{ opacity: 0.6, fontSize: 11 }}>
                    {provider.category} · {provider.capabilities.join(", ") || "general"}
                  </span>
                </div>
              ))}
          </div>
        </>
      ) : null}

        <div style={{ fontSize: 10, opacity: 0.5, lineHeight: 1.5 }}>
          Keys and .env contents never leave the runtime — this panel shows safe status diagnostics
          only. Provider pages open in a new tab.
        </div>
      </div>
    </GenesisWindowFrame>
  );
}
