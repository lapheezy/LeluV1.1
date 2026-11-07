/**
 * ==========================================================
 * LÉLU — YOUR WORLDS (navigator row)
 *
 * Environments LÉLU, an agent or the person created through
 * the world engine (plugins/worldEngine.ts, /api/forge/world)
 * were saved and versioned but never reachable: the spatial
 * navigator lists only the fixed scene graph. This row lists
 * them in the same navigator, from the same store — not a
 * second world system.
 *
 * Choosing one enters it in the world engine and opens the
 * world view (Genesis v2's WorldScene, the one renderer for
 * these environments). Chat stays available there; leaving
 * returns to the Cosmos.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import ForgeClient, { FORGE_CHANGED_EVENT, type WorldState } from "../../../core/forge/ForgeClient";
import { useGenesis } from "../genesis/GenesisCore";

type Environment = WorldState["environments"][number];

/** Environments worth listing: real ones, not sandboxes under test. */
export function listedWorlds(world: Pick<WorldState, "environments"> | null): Environment[] {
  return (world?.environments ?? []).filter((e) => !e.sandbox).slice(0, 12);
}

export default function SavedWorlds({ compact, accent = "#86efac" }: { compact: boolean; accent?: string }) {
  const { openPanel } = useGenesis();
  const [world, setWorld] = useState<WorldState | null>(null);
  const [entering, setEntering] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      ForgeClient.world()
        .then((w) => { if (alive) setWorld(w); })
        .catch(() => { /* the world engine is optional: no row without it */ });
    };
    load();
    window.addEventListener(FORGE_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(FORGE_CHANGED_EVENT, load);
    };
  }, []);

  const worlds = listedWorlds(world);
  if (worlds.length === 0) return null;

  const enter = async (id: string) => {
    setEntering(id);
    try {
      await ForgeClient.enterEnvironment(id);
      openPanel("genesisv2");
    } catch {
      /* stays in the Cosmos; the engine reports its own failure */
    } finally {
      setEntering(null);
    }
  };

  return (
    <div data-spatial-group="worlds" style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          flex: "0 0 auto",
          width: compact ? 34 : 98,
          textAlign: "right",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          font: "600 8.5px system-ui, sans-serif",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: `${accent}b0`,
        }}
      >
        {compact ? "⌂" : "Your worlds"}
      </span>
      <span aria-hidden style={{ flex: "0 0 auto", width: 1, height: 18, background: "rgba(148,163,184,0.16)" }} />
      <span style={{ display: "flex", flexWrap: "wrap", gap: 5, minWidth: 0 }}>
        {worlds.map((e) => (
          <button
            key={e.id}
            type="button"
            data-saved-world={e.id}
            aria-label={`Enter ${e.name}`}
            aria-current={world?.current === e.id ? "true" : undefined}
            disabled={entering !== null}
            onClick={() => void enter(e.id)}
            title={`${e.name} · ${e.kind} · version ${e.version}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: 999,
              border: `1px solid ${world?.current === e.id ? `${accent}99` : "rgba(148,163,184,0.22)"}`,
              background: "rgba(8,16,36,0.6)",
              color: "rgba(226,232,240,0.92)",
              font: "500 11px system-ui, sans-serif",
              cursor: "pointer",
              opacity: entering && entering !== e.id ? 0.5 : 1,
            }}
          >
            <span aria-hidden style={{ color: accent }}>⌂</span>
            {entering === e.id ? `Entering ${e.name}…` : e.name}
          </button>
        ))}
      </span>
    </div>
  );
}
