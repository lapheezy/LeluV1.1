/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS MEMORY PANEL
 *
 * Phase 7 — makes the Memory Engine visible.
 *
 * Brain.recallAll() already returns every stored ResponsePattern
 * (see brain/Brain.ts, brain/PatternMemory.ts) — this panel is
 * the first UI surface for it. Browsing never mutates it. The one
 * mutation is the user deleting a single memory, which goes through
 * the existing authoritative path (AIService.forgetMemory →
 * Brain.forgetMemory → store record + cognitive observation +
 * graph node). There is no second deletion subsystem here.
 *
 * Follows AIService.getInstance() directly, the same pattern
 * GenesisChat and GenesisBridge already use, rather than routing
 * through the GenesisCore reducer — this data has no push
 * events to subscribe to, so it's polled locally on an interval
 * and refreshed whenever the panel opens or a new assistant
 * message arrives.
 * ==========================================================
 */

import { useEffect, useMemo, useState } from "react";
import { useGenesisState } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import AIService from "../../../core/AIService";
import type { ResidueReport } from "../../../core/memory/ResidueMigration";
import GenesisWindowFrame from "./GenesisWindowFrame";

const ai = AIService.getInstance();

interface MemoryRow {
  id: string;
  category: string;
  prompt: string;
  response: string;
  confidence: number;
  timestamp: number;
}

const CATEGORY_COLOR: Record<string, string> = {
  identity: genesisTheme.status.accent,
  preference: genesisTheme.status.ok,
  goal: genesisTheme.status.warn,
  skill: genesisTheme.status.accent,
  project: genesisTheme.status.ok,
  relationship: genesisTheme.status.warn,
  experience: genesisTheme.status.idle,
  conversation: genesisTheme.status.idle,
  general: genesisTheme.status.idle,
};

interface GenesisMemoryPanelProps {
  onClose: () => void;
}

export default function GenesisMemoryPanel({ onClose }: GenesisMemoryPanelProps) {
  const { state } = useGenesisState();
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [residue, setResidue] = useState<ResidueReport | null>(null);
  const [residueBusy, setResidueBusy] = useState(false);
  const [healing, setHealing] = useState<ReturnType<typeof ai.memoryIntegrityStatus> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const rows = await ai.getMemories(300);
      if (!cancelled) {
        setMemories(rows);
        setLoading(false);
      }
    }

    async function readResidue() {
      try {
        const report = await ai.residueReport({ dryRun: true });
        if (!cancelled) {
          setResidue(report);
          // Automatic healing happens without this panel; say what it did.
          setHealing(ai.memoryIntegrityStatus());
        }
      } catch (error) {
        console.warn("[GenesisMemoryPanel] residue check failed (contained)", error);
      }
    }

    void refresh();
    void readResidue();
    const interval = window.setInterval(refresh, 6000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // Re-poll immediately whenever the message count changes,
    // since a completed exchange is the most common moment new
    // memories are written.
  }, [state.messages.length]);

  /**
   * Delete one memory through the ONE existing path, then re-read the store
   * so the list reflects what is actually left rather than what we assumed.
   */
  async function forgetMemory(id: string) {
    setDeleting(id);
    setNotice("");
    try {
      const result = await ai.forgetMemory(id);
      const rows = await ai.getMemories(300);
      setMemories(rows);
      setNotice(
        !result.removed
          ? "That memory was already gone."
          : result.ledgerRecorded
            ? "Memory deleted. It will not be recalled again, and historical copies that quote it are removed automatically."
            : "Memory deleted, but the deletion ledger could not be written — older copies that quote it cannot be proven and removed.",
      );
      setResidue(await ai.residueReport({ dryRun: true }));
    } catch (error) {
      console.error("[GenesisMemoryPanel] delete failed", error);
      setNotice("Could not delete that memory — nothing was removed.");
    } finally {
      setDeleting(null);
      setPendingDelete(null);
    }
  }

  /** Remove the residue the deletion ledger can prove, then re-read the plan. */
  async function cleanResidue() {
    setResidueBusy(true);
    try {
      const applied = await ai.residueReport({ dryRun: false });
      const after = await ai.residueReport({ dryRun: true });
      setResidue(after);
      setNotice(
        applied.cleanedFields > 0
          ? `Removed ${applied.cleanedFields} quote(s) of deleted memories from project text.`
          : "No provable residue left to remove.",
      );
    } catch (error) {
      console.error("[GenesisMemoryPanel] residue migration failed", error);
      setNotice("Residue check failed — nothing was changed.");
    } finally {
      setResidueBusy(false);
    }
  }

  /** Forget or keep one quarantined legacy checkpoint. */
  async function reviewResidue(projectId: string, action: "forget" | "keep") {
    setResidueBusy(true);
    try {
      const after = await ai.reviewMemoryResidue(projectId, action);
      setResidue(after);
      setNotice(
        action === "forget"
          ? "Checkpoint forgotten; the project and its other content are untouched."
          : "Kept. This checkpoint will stop being reported.",
      );
    } catch (error) {
      console.error("[GenesisMemoryPanel] residue review failed", error);
      setNotice("Could not update that checkpoint — nothing changed.");
    } finally {
      setResidueBusy(false);
    }
  }

  const categories = useMemo(() => {
    const set = new Set(memories.map((memory) => memory.category));
    return ["all", ...Array.from(set).sort()];
  }, [memories]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return memories.filter((memory) => {
      if (category !== "all" && memory.category !== category) return false;
      if (!normalized) return true;
      return (
        memory.prompt.toLowerCase().includes(normalized) ||
        memory.response.toLowerCase().includes(normalized)
      );
    });
  }, [memories, query, category]);

  return (
    <GenesisWindowFrame
      title={<>Memory · {memories.length} stored</>}
      onClose={onClose}
      width="min(92vw, 560px)"
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search memories…"
          style={{
            flex: 1,
            border: genesisTheme.glass.borderSoft,
            borderRadius: genesisTheme.radius.md,
            background: "rgba(255,255,255,0.04)",
            color: "white",
            padding: "8px 10px",
            fontSize: 13,
            outline: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {categories.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCategory(option)}
            style={{
              border: category === option ? genesisTheme.glass.borderAccent : genesisTheme.glass.borderSoft,
              borderRadius: genesisTheme.radius.pill,
              background: category === option ? "rgba(34, 211, 238, 0.16)" : "rgba(255,255,255,0.04)",
              color: "white",
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {option}
          </button>
        ))}
      </div>

      {notice ? (
        <div role="status" style={{ fontSize: 12, opacity: 0.8, marginBottom: 10, color: genesisTheme.status.ok }}>
          {notice}
        </div>
      ) : null}

      {residue ? (
        <div
          role="status"
          style={{
            border: "1px solid rgba(251, 191, 36, 0.25)",
            borderRadius: 10,
            padding: "8px 10px",
            marginBottom: 10,
            background: "rgba(251, 191, 36, 0.05)",
            fontSize: 11,
          }}
        >
          <div style={{ opacity: 0.85, marginBottom: residue.quarantined.length ? 6 : 0 }}>
            Historical residue · {residue.scannedProjects} project(s) scanned ·{" "}
            {residue.findings.length} quote(s) of deleted memories · {residue.quarantined.length} checkpoint(s) to review
          </div>
          {healing?.healing ? (
            <div style={{ opacity: 0.6, marginBottom: residue.quarantined.length ? 6 : 0 }}>
              Automatic healing: {healing.healing.state}
              {healing.healing.state === "complete"
                ? ` — removed ${healing.healing.cleanedFields} quote(s) this session, ${healing.healing.quarantined} left for review`
                : ""}
            </div>
          ) : null}
          {residue.quarantined.slice(0, 4).map((finding) => (
            <div
              key={finding.id}
              style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}
            >
              <span style={{ flex: 1, opacity: 0.75, overflowWrap: "anywhere" }}>{finding.preview}</span>
              <button
                type="button"
                onClick={() => void reviewResidue(finding.projectId, "forget")}
                disabled={residueBusy}
                style={{
                  border: "1px solid rgba(248, 113, 113, 0.45)",
                  borderRadius: genesisTheme.radius.pill,
                  background: "rgba(248, 113, 113, 0.14)",
                  color: "white",
                  padding: "2px 8px",
                  fontSize: 10,
                  cursor: residueBusy ? "default" : "pointer",
                }}
              >
                Forget
              </button>
              <button
                type="button"
                onClick={() => void reviewResidue(finding.projectId, "keep")}
                disabled={residueBusy}
                style={{
                  border: genesisTheme.glass.borderSoft,
                  borderRadius: genesisTheme.radius.pill,
                  background: "rgba(255,255,255,0.04)",
                  color: "white",
                  padding: "2px 8px",
                  fontSize: 10,
                  cursor: residueBusy ? "default" : "pointer",
                }}
              >
                Keep
              </button>
            </div>
          ))}
          {residue.findings.length > 0 ? (
            <button
              type="button"
              onClick={() => void cleanResidue()}
              disabled={residueBusy}
              style={{
                marginTop: 6,
                border: "1px solid rgba(251, 191, 36, 0.5)",
                borderRadius: genesisTheme.radius.pill,
                background: "rgba(251, 191, 36, 0.14)",
                color: "white",
                padding: "3px 10px",
                fontSize: 10,
                cursor: residueBusy ? "default" : "pointer",
              }}
            >
              {residueBusy ? "Working…" : `Remove ${residue.findings.length} provable quote(s)`}
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>Reading memory store…</div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          {memories.length === 0
            ? "No memories stored yet — they form automatically as you talk with Lélu."
            : "No memories match this search."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((memory) => (
            <div
              key={memory.id}
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: "8px 10px",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: CATEGORY_COLOR[memory.category] ?? genesisTheme.status.idle,
                  }}
                >
                  {memory.category}
                </span>
                <span style={{ fontSize: 11, opacity: 0.55 }}>
                  {Math.round(memory.confidence * 100)}% confidence
                </span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 2, overflowWrap: "anywhere" }}>
                {memory.prompt || "(no prompt recorded)"}
              </div>
              <div style={{ fontSize: 12, opacity: 0.65, overflowWrap: "anywhere" }}>
                {memory.response}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                {pendingDelete === memory.id ? (
                  <>
                    <span style={{ fontSize: 11, opacity: 0.8, marginRight: "auto" }}>Delete this memory?</span>
                    <button
                      type="button"
                      onClick={() => void forgetMemory(memory.id)}
                      disabled={deleting === memory.id}
                      style={{
                        border: "1px solid rgba(248, 113, 113, 0.55)",
                        borderRadius: genesisTheme.radius.pill,
                        background: "rgba(248, 113, 113, 0.18)",
                        color: "white",
                        padding: "3px 10px",
                        fontSize: 11,
                        cursor: deleting === memory.id ? "default" : "pointer",
                      }}
                    >
                      {deleting === memory.id ? "Deleting…" : "Confirm delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(null)}
                      style={{
                        border: genesisTheme.glass.borderSoft,
                        borderRadius: genesisTheme.radius.pill,
                        background: "rgba(255,255,255,0.04)",
                        color: "white",
                        padding: "3px 10px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(memory.id)}
                    aria-label={`Delete memory: ${memory.prompt.slice(0, 60)}`}
                    style={{
                      marginLeft: "auto",
                      border: genesisTheme.glass.borderSoft,
                      borderRadius: genesisTheme.radius.pill,
                      background: "rgba(255,255,255,0.04)",
                      color: "rgba(248, 113, 113, 0.9)",
                      padding: "3px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </GenesisWindowFrame>
  );
}
