/**
 * ==========================================================
 * LÉLU — SIGN-IN GATE
 *
 * The first thing a session asks, and only once.
 *
 * Cloud identity was reachable only by opening Settings and finding the
 * Supabase block, so most sessions simply ran signed out — and a signed-out
 * session silently keeps everything on one device. The Profile panel made it
 * worse by offering only "Sign out" while showing an empty identity, which
 * reads as "signed in, broken" rather than "not signed in".
 *
 * So the choice is presented up front, before the conversation starts, and
 * it is a CHOICE: skipping is a first-class answer, remembered, and LÉLU
 * works fully without an account. Local-only is a supported way to run, not
 * a failure — so the gate never nags and never blocks a second time.
 *
 * It uses the existing SupabasePersistence client. No second client, no
 * second auth path.
 * ==========================================================
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import SupabasePersistence, {
  type SupabaseAuthState,
} from "../../../core/persistence/SupabasePersistence";
import KvStore from "../../../core/storage/KvStore";
import { layer } from "../../../core/ui/Layers";
import { useWorkspace } from "./useWorkspace";

/** Remembers that the user chose to carry on without an account. */
const SKIP_KEY = "lelu.auth.skipped.v1";

const persistence = SupabasePersistence.getInstance();

export default function LeluSignInGate() {
  const workspace = useWorkspace();
  const [authState, setAuthState] = useState<SupabaseAuthState>(() =>
    persistence.getAuthState(),
  );
  const [skipped, setSkipped] = useState<boolean>(
    () => KvStore.getInstance().get<boolean>(SKIP_KEY) === true,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => persistence.subscribeAuth(setAuthState), []);

  /**
   * Make persistence work out its own state before the gate judges it.
   *
   * Nothing initialized Supabase until the first chat turn, so at the moment
   * this gate renders the status was still its initial "disabled" — and the
   * gate reported "cloud sign-in unavailable" on a perfectly well configured
   * deployment. Asking first is the difference between "not configured" and
   * "not asked yet".
   *
   * `initialize()` is idempotent and returns early once connected, so this is
   * safe under StrictMode's double mount.
   */
  const [probed, setProbed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void persistence
      .initialize()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setProbed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const skip = useCallback(() => {
    KvStore.getInstance().set(SKIP_KEY, true);
    setSkipped(true);
  }, []);

  const submit = useCallback(
    async (event: FormEvent, mode: "in" | "up") => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        if (mode === "up") {
          const result = await persistence.signUpWithEmail(email, password);
          if (result.error) setError(result.error);
          else if (result.requiresConfirmation) {
            setNotice("Check your email to confirm the account, then sign in.");
          }
        } else {
          const result = await persistence.signInWithEmail(email, password);
          if (result.error) setError(result.error);
        }
      } finally {
        setBusy(false);
      }
    },
    [email, password],
  );

  // Already signed in, already answered, or still working it out — say nothing.
  if (skipped || authState.session) return null;
  // Say nothing until persistence has actually answered. Showing the
  // unconfigured message while still connecting is how a working deployment
  // got told it had none.
  if (!probed || authState.status === "connecting") return null;

  // Supabase genuinely cannot be reached: there is nothing to sign in to, so
  // asking would be asking for something the user cannot give. State the real
  // reason once and get out of the way.
  const unconfigured = authState.status === "disabled";

  return (
    <div
      data-lelu-signin-gate
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to LÉLU"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: layer("modal"),
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(2, 6, 23, 0.72)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <div
        style={{
          width: workspace.compact ? "100%" : "min(92vw, 420px)",
          maxWidth: 420,
          maxHeight: "90%",
          overflowY: "auto",
          borderRadius: 18,
          border: "1px solid rgba(103, 232, 249, 0.22)",
          background: "rgba(8, 16, 38, 0.96)",
          color: "rgba(226, 232, 240, 0.92)",
          padding: 20,
          fontSize: 13,
          lineHeight: 1.5,
          boxShadow: "0 24px 64px rgba(2, 6, 23, 0.6)",
        }}
      >
        <div
          style={{
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: "0.22em",
            opacity: 0.6,
            marginBottom: 10,
          }}
        >
          LÉLU · cloud identity
        </div>

        {unconfigured ? (
          <>
            <p style={{ margin: "0 0 14px" }}>
              Cloud sign-in is unavailable: this deployment has no Supabase URL
              configured, so there is no account to sign in to. LÉLU runs
              normally — memory, projects and conversations stay on this device.
            </p>
            <p style={{ margin: "0 0 16px", opacity: 0.68, fontSize: 12 }}>
              To enable sync, set <code>SUPABASE_URL</code> and{" "}
              <code>SUPABASE_PUBLISHABLE_KEY</code> in the environment and
              reload.
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: "0 0 14px" }}>
              Sign in to carry memory, projects and conversations across your
              devices. You can also continue without an account — everything
              works, it just stays here.
            </p>

            <form
              onSubmit={(event) => void submit(event, "in")}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email address"
                autoComplete="email"
                required
                disabled={busy}
                style={inputStyle}
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                required
                minLength={6}
                disabled={busy}
                style={inputStyle}
              />
              {error ? (
                <div role="alert" style={{ color: "rgba(252, 165, 165, 0.95)", fontSize: 12 }}>
                  {error}
                </div>
              ) : null}
              {notice ? (
                <div style={{ color: "rgba(167, 243, 208, 0.95)", fontSize: 12 }}>{notice}</div>
              ) : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <button type="submit" disabled={busy} style={primaryStyle}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(event) => void submit(event, "up")}
                  style={secondaryStyle}
                >
                  Create account
                </button>
              </div>
            </form>
          </>
        )}

        <button
          type="button"
          onClick={skip}
          style={{
            ...secondaryStyle,
            width: "100%",
            marginTop: 14,
            borderColor: "rgba(255,255,255,0.14)",
          }}
        >
          {unconfigured ? "Continue" : "Continue without an account"}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  background: "rgba(0,0,0,0.26)",
  color: "white",
  padding: "10px 11px",
  fontSize: 13,
  fontFamily: "inherit",
} as const;

const primaryStyle = {
  border: "1px solid rgba(103, 232, 249, 0.5)",
  borderRadius: 8,
  background: "rgba(103, 232, 249, 0.14)",
  color: "white",
  padding: "9px 14px",
  fontSize: 12.5,
  cursor: "pointer",
  fontFamily: "inherit",
} as const;

const secondaryStyle = {
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.05)",
  color: "rgba(226, 232, 240, 0.9)",
  padding: "9px 14px",
  fontSize: 12.5,
  cursor: "pointer",
  fontFamily: "inherit",
} as const;
