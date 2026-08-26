/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS COMMAND PALETTE
 *
 * Phase 6.
 *
 * The brief explicitly names a "command palette" as part of
 * the AI-operating-system UI. Everything it needs already
 * exists on the Genesis context (openPanel, focusWorkspace,
 * selectDestination, clearConversation) — this is a single
 * searchable entry point over actions that previously only
 * lived as separate buttons scattered across GenesisInterface,
 * which is the "one living environment rather than separate
 * screens" ask made concrete.
 *
 * Cmd/Ctrl+K to open, Esc to close, arrow keys + Enter to
 * run. Workspace list is read live from state.cognition so it
 * never drifts from what the quick-action buttons show.
 * ==========================================================
 */

import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGenesis } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import { openStudioMode } from "./GenesisVisualStudio";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const EMPTY_WORKSPACES: Array<{ id?: string; name?: string }> = [];

export default function GenesisCommandPalette({
  onNavigate,
}: {
  /** When provided (Genesis v2 scope), every command routes through this
      handler instead of openPanel — so palette navigation never ejects the
      v2 workspace back to v1. */
  onNavigate?: (commandId: string) => void;
}) {
  const { state, openPanel, focusWorkspace, selectDestination, clearConversation } = useGenesis();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isPaletteShortcut) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const workspaces = (state.cognition?.workspaces as Array<{ id?: string; name?: string }> | undefined) ?? EMPTY_WORKSPACES;

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "open-chat", label: "Open chat", hint: "Genesis Core", run: () => openPanel("chat") },
      { id: "open-genesis-v2", label: "Open Genesis v2 · Transformation Lab", hint: "Genesis Core", run: () => openPanel("genesisv2") },
      { id: "open-history", label: "Open conversation history", hint: "Genesis Core", run: () => openPanel("history") },
      { id: "open-projects", label: "Open Projects", hint: "Projects", run: () => openPanel("projects") },
      { id: "open-reasoning", label: "Open reasoning & planning", hint: "Genesis Core", run: () => openPanel("reasoning") },
      { id: "open-cognition", label: "Open Cognition — self, knowledge, queue", hint: "Cognition", run: () => openPanel("cognition") },
      { id: "open-engineering", label: "Open Engineering sandbox", hint: "Engineering", run: () => openPanel("engineering") },
      { id: "open-evolution", label: "Open Evolution — self-development engine", hint: "Evolution", run: () => openPanel("evolution") },
      { id: "open-visualstudio", label: "Open Genesis Studios", hint: "Visual environment", run: () => openPanel("visualstudio") },
      // Earth Core — a capability of the unified environment, not a tab.
      { id: "open-earth", label: "Open Earth Core — live spatial intelligence", hint: "Earth", run: () => openPanel("earth") },
      { id: "earth-aircraft", label: "Show aircraft on Earth", hint: "Earth", run: () => { openPanel("earth"); void import("../../../core/earth/EarthCore").then((m) => m.default.getInstance().execute({ op: "show", layer: "aircraft" })); } },
      { id: "earth-quakes", label: "Show earthquakes on Earth", hint: "Earth", run: () => { openPanel("earth"); void import("../../../core/earth/EarthCore").then((m) => m.default.getInstance().execute({ op: "show", layer: "earthquakes" })); } },
      { id: "earth-satellites", label: "Show satellites on Earth", hint: "Earth", run: () => { openPanel("earth"); void import("../../../core/earth/EarthCore").then((m) => m.default.getInstance().execute({ op: "show", layer: "satellites" })); } },
      { id: "open-agents", label: "Open knowledge & agents", hint: "Genesis Core", run: () => openPanel("agents") },
      { id: "open-memory", label: "Open memory", hint: "Genesis Core", run: () => openPanel("memory") },
      { id: "open-providers", label: "Open API status", hint: "Genesis Core", run: () => openPanel("providers") },
      { id: "open-device", label: "Open device capabilities", hint: "Genesis Core", run: () => openPanel("device") },
      { id: "open-diagnostics", label: "Open engine diagnostics", hint: "Genesis Core", run: () => openPanel("diagnostics") },
      { id: "open-logs", label: "Open execution logs", hint: "Genesis Core", run: () => openPanel("logs") },
      // Sketch, Render and Avatar are modes inside Genesis Studios —
      // these commands open the ONE studio in the requested mode.
      { id: "open-sketch", label: "Open Genesis Studios — Sketch", hint: "Visual environment", run: () => { openStudioMode("sketch"); openPanel("visualstudio"); } },
      { id: "open-render", label: "Open Genesis Studios — Render", hint: "Visual environment", run: () => { openStudioMode("render"); openPanel("visualstudio"); } },
      { id: "open-avatar", label: "Open Genesis Studios — Avatar", hint: "Visual environment", run: () => { openStudioMode("avatar"); openPanel("visualstudio"); } },
      { id: "open-video", label: "Open Video workspace", hint: "Motion Studio", run: () => openPanel("video") },
      { id: "open-projects-panel", label: "Open Projects", hint: "Projects", run: () => openPanel("projects") },
      { id: "open-settings", label: "Open Settings", hint: "System", run: () => openPanel("settings") },
      { id: "open-knowledge", label: "Open Knowledge providers", hint: "System", run: () => openPanel("knowledge") },
      { id: "close-panel", label: "Close active panel", hint: "Genesis Core", run: () => openPanel("none") },
      { id: "clear-chat", label: "Clear conversation history", hint: "Genesis Core", run: () => clearConversation() },
    ];

    const workspaceCommands: Command[] = workspaces.map((workspace, index) => ({
      id: `workspace-${workspace.id ?? index}`,
      label: `Go to ${workspace.name ?? "Workspace"}`,
      hint: "Workspace",
      run: () => {
        const id = workspace.id ?? String(index);
        const name = workspace.name ?? "Workspace";
        focusWorkspace(id);
        selectDestination({ id, type: "workspace", name, position: { x: index * 3 - 3, y: 0, z: -5 } });
      },
    }));

    return [...base, ...workspaceCommands];
  }, [workspaces, openPanel, focusWorkspace, selectDestination, clearConversation]);

  const [recentIds, setRecentIds] = useState<string[]>([]);

  const orderedCommands = useMemo(() => {
    if (recentIds.length === 0) return commands;
    const byId = new Map(commands.map((command) => [command.id, command]));
    const recent = recentIds.map((id) => byId.get(id)).filter((command): command is Command => Boolean(command));
    const rest = commands.filter((command) => !recentIds.includes(command.id));
    return [...recent, ...rest];
  }, [commands, recentIds]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return orderedCommands;
    return orderedCommands.filter((command) => command.label.toLowerCase().includes(normalized));
  }, [orderedCommands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function runCommand(command: Command) {
    if (onNavigate) {
      onNavigate(command.id);
    } else {
      command.run();
    }
    setRecentIds((current) => [command.id, ...current.filter((id) => id !== command.id)].slice(0, 5));
    setOpen(false);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      runCommand(filtered[activeIndex]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          pointerEvents: "auto",
          border: "1px solid rgba(148, 163, 184, 0.24)",
          borderRadius: genesisTheme.radius.pill,
          background: "rgba(8, 16, 38, 0.55)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          color: "rgba(214, 228, 244, 0.92)",
          padding: "7px 13px",
          fontSize: 12,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          letterSpacing: "0.02em",
          boxShadow: "0 6px 20px rgba(2, 6, 23, 0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
          transition: "background 0.15s ease, border-color 0.15s ease",
        }}
      >
        <span aria-hidden style={{ fontSize: 11.5, opacity: 0.85 }}>⌘K</span>
        <span>Command Palette</span>
        <svg
          aria-hidden
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          style={{ opacity: 0.8 }}
        >
          <path d="M12 2.8 14 10 21.2 12 14 14 12 21.2 10 14 2.8 12 10 10Z" />
        </svg>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2, 6, 23, 0.55)",
              backdropFilter: "blur(4px)",
              zIndex: 60,
              pointerEvents: "auto",
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start",
              paddingTop: "14vh",
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(92vw, 480px)",
                background: genesisTheme.glass.panel,
                border: genesisTheme.glass.borderAccent,
                borderRadius: genesisTheme.radius.lg,
                boxShadow: genesisTheme.glass.shadow,
                backdropFilter: genesisTheme.glass.blur,
                color: "white",
                overflow: "hidden",
              }}
            >
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a command or workspace…"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "none",
                  borderBottom: genesisTheme.glass.borderSoft,
                  background: "transparent",
                  color: "white",
                  padding: "14px 16px",
                  fontSize: 14,
                  outline: "none",
                }}
              />
              <div style={{ maxHeight: "50vh", overflowY: "auto", padding: 6 }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: "10px 12px", fontSize: 12, opacity: 0.6 }}>No matching commands.</div>
                ) : (
                  filtered.map((command, index) => (
                    <button
                      key={command.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => runCommand(command)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        borderRadius: 10,
                        background: index === activeIndex ? "rgba(34, 211, 238, 0.16)" : "transparent",
                        color: "white",
                        padding: "8px 10px",
                        fontSize: 13,
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span>{command.label}</span>
                      <span style={{ opacity: 0.5, fontSize: 11 }}>
                        {!query.trim() && recentIds.includes(command.id) ? "Recent" : command.hint}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
