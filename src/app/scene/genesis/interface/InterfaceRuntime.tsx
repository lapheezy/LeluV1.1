/**
 * ==========================================================
 * LÉLU — INTERFACE RUNTIME (front-end bridge)
 *
 * Binds the Interface Orchestration Engine to the LIVE Genesis
 * interface. It is the reason LÉLU's interface.* tools act on
 * the real Cosmos rather than on a model of it:
 *
 *   • registers the InterfaceHost — the real windows (every
 *     module window in GenesisCore + the chat), the real
 *     viewport, the real workspaces (conversations, projects) —
 *     and applies approved layouts through GenesisCore's own
 *     window actions in one state update;
 *   • compiles the effective design tokens (live, or the preview
 *     while one is shown) into CSS variables on <html>, loads the
 *     fonts, and removes everything again for the original look;
 *   • records where windows actually are, and restores them on
 *     reload so the workspace comes back as it was left;
 *   • opens the workspace a Cosmos object links to when the user
 *     selects it.
 *
 * Renders nothing.
 * ==========================================================
 */

import { useEffect, useRef } from "react";
import { useGenesis, type GenesisPanel, type ModuleLayoutTarget } from "../GenesisCore";
import InterfaceOrchestrator, { isDefaultLook } from "../../../../core/interface/InterfaceOrchestrator";
import { tokensToCssVariables } from "../../../../core/interface/DesignTokens";
import { fontFaceCss, googleFontsUrl, isKnownFont } from "../../../../core/interface/FontLibrary";
import { makeViewport, planWindows, type WindowDescriptor, type WindowLayout } from "../../../../core/interface/SpatialModel";
import type { WorkspaceRef } from "../../../../core/interface/SceneModel";
import ProjectStore from "../../../../core/projects/ProjectStore";
import useInterface from "./useInterface";

const FONT_LINK_ID = "lelu-interface-fonts";
const CUSTOM_FONT_STYLE_ID = "lelu-interface-custom-fonts";

function currentViewport() {
  const visual = typeof window !== "undefined" ? window.visualViewport : null;
  return makeViewport(Math.round(visual?.width ?? window.innerWidth), Math.round(visual?.height ?? window.innerHeight));
}

function rectOf(element: Element | null) {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function InterfaceRuntime({ windowIds, labelOf }: { windowIds: string[]; labelOf: (id: string) => string }) {
  const genesis = useGenesis();
  const { state, applyModuleLayout, openPanel, openModule, switchConversation } = genesis;
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef({ applyModuleLayout, openPanel, openModule, switchConversation });
  actionsRef.current = { applyModuleLayout, openPanel, openModule, switchConversation };
  const view = useInterface();

  /* ------------------------------ host ------------------------------- */

  useEffect(() => {
    const orchestrator = InterfaceOrchestrator.getInstance();
    return orchestrator.attachHost({
      viewport: currentViewport,

      windows: (): WindowDescriptor[] => {
        const s = stateRef.current;
        const viewport = currentViewport();
        const descriptors: WindowDescriptor[] = [];

        const chatEl = document.querySelector('[data-lelu-window="chat"]');
        descriptors.push({
          id: "chat",
          kind: "chat",
          label: "Chat",
          presentation: !chatEl ? "closed" : chatEl.hasAttribute("data-lelu-chat-minimized") ? "minimized" : "inline",
          rect: (chatEl && !chatEl.hasAttribute("data-lelu-chat-minimized") ? rectOf(chatEl) : null) ?? {
            x: Math.round(viewport.width / 2 - 280),
            y: Math.round(viewport.height * 0.25),
            width: Math.min(560, viewport.width),
            height: Math.min(480, viewport.height),
          },
          zIndex: 21,
          rotation: 0,
        });

        windowIds.forEach((id, index) => {
          const mod = s.modules[id];
          const el = mod && mod.presentation === "inline" ? document.querySelector(`[data-lelu-window="${CSS.escape(id)}"]`) : null;
          const fallback = {
            x: (mod?.position?.x ?? 88 + (index % 6) * 34),
            y: (mod?.position?.y ?? 76 + (index % 5) * 34),
            width: mod?.size?.width ?? Math.min(620, viewport.width - 24),
            height: mod?.size?.height ?? Math.min(480, viewport.height - 64),
          };
          descriptors.push({
            id,
            kind: "module",
            label: labelOf(id),
            presentation: mod ? (mod.presentation === ("detached" as never) ? "inline" : mod.presentation) : "closed",
            rect: rectOf(el) ?? fallback,
            zIndex: mod?.zIndex ?? 30 + index,
            rotation: mod?.rotation ?? 0,
            ...(mod?.group ? { group: mod.group } : {}),
          });
        });
        return descriptors;
      },

      workspaces: (): WorkspaceRef[] => {
        const s = stateRef.current;
        const conversations = s.conversations
          .filter((c) => !c.archived)
          .sort((a, b) => (a.id === s.activeConversationId ? -1 : b.id === s.activeConversationId ? 1 : Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt))
          .map<WorkspaceRef>((c) => ({ kind: "conversation", id: c.id, title: c.title || "Conversation", active: c.id === s.activeConversationId }));
        let projects: WorkspaceRef[] = [];
        try {
          projects = ProjectStore.getInstance()
            .list()
            .filter((p) => p.status === "active")
            .map((p) => ({ kind: "project", id: p.id, title: p.name }));
        } catch {
          projects = [];
        }
        return [...conversations, ...projects];
      },

      applyWindows: (layout: Record<string, WindowLayout>) => {
        const modules: Record<string, ModuleLayoutTarget> = {};
        for (const [id, l] of Object.entries(layout)) {
          if (id === "chat") continue;
          const existing = stateRef.current.modules[id];
          // Leave untouched windows alone (closed and still closed).
          if (!existing && l.presentation === "closed") continue;
          modules[id] = {
            presentation: l.presentation,
            position: { x: l.x, y: l.y },
            size: { width: l.width, height: l.height },
            zIndex: l.zIndex,
            rotation: l.rotation,
            ...(l.group ? { group: l.group } : {}),
          };
        }
        const chat = layout.chat;
        const anyModuleOpen = Object.values(modules).some((m) => m.presentation !== "closed" && m.presentation !== "minimized");
        if (chat && chat.presentation !== "closed" && !document.querySelector('[data-lelu-window="chat"]') && !anyModuleOpen) {
          actionsRef.current.openPanel("chat");
        }
        if (Object.keys(modules).length) actionsRef.current.applyModuleLayout(modules);
        if (chat) {
          // After the chat has (re)mounted.
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("lelu-interface-chat-layout", { detail: { x: chat.x, y: chat.y, width: chat.width, height: chat.height, presentation: chat.presentation } }));
          }, 60);
        }
      },

      applyCamera: (camera) => {
        window.dispatchEvent(
          new CustomEvent("cosmos-navigate", {
            detail: {
              pos: { x: camera.position[0], y: camera.position[1], z: camera.position[2] },
              lookAt: { x: camera.target[0], y: camera.target[1], z: camera.target[2] },
            },
          }),
        );
      },
    });
  }, [windowIds, labelOf]);

  /* ------------------- restore the workspace on reload ---------------- */

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const observed = InterfaceOrchestrator.getInstance().observedWindows();
    const entries = Object.entries(observed).filter(([id, l]) => windowIds.includes(id) && l.presentation !== "closed");
    if (!entries.length) return;
    const timer = window.setTimeout(() => {
      if (Object.keys(stateRef.current.modules).length) return; // something else already opened windows
      // Re-fit to THIS viewport (a phone after a desktop session gets the
      // one-sheet phone layout, never off-screen windows).
      const descriptors: WindowDescriptor[] = entries.map(([id, l]) => ({
        id,
        kind: "module",
        label: labelOf(id),
        presentation: l.presentation,
        rect: { x: l.x, y: l.y, width: l.width, height: l.height },
        zIndex: l.zIndex,
        rotation: l.rotation,
        ...(l.group ? { group: l.group } : {}),
      }));
      const plan = planWindows(descriptors, [], currentViewport());
      const modules: Record<string, ModuleLayoutTarget> = {};
      for (const [id, l] of Object.entries(plan.layout)) {
        modules[id] = { presentation: l.presentation, position: { x: l.x, y: l.y }, size: { width: l.width, height: l.height }, zIndex: l.zIndex, rotation: l.rotation, ...(l.group ? { group: l.group } : {}) };
      }
      actionsRef.current.applyModuleLayout(modules);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [windowIds, labelOf]);

  /* --------------- remember where windows actually are ---------------- */

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const layout: Record<string, WindowLayout> = {};
      for (const [id, mod] of Object.entries(state.modules)) {
        if (!windowIds.includes(id)) continue;
        if (!mod.position || !mod.size) {
          // Never moved: remember where the window manager actually put it.
          const rect = rectOf(document.querySelector(`[data-lelu-window="${CSS.escape(id)}"]`)) ?? { x: 88, y: 76, width: 620, height: 480 };
          layout[id] = { presentation: mod.presentation, ...rect, zIndex: mod.zIndex ?? 30, rotation: mod.rotation ?? 0 };
          continue;
        }
        layout[id] = {
          presentation: mod.presentation,
          x: mod.position.x,
          y: mod.position.y,
          width: mod.size.width,
          height: mod.size.height,
          zIndex: mod.zIndex ?? 30,
          rotation: mod.rotation ?? 0,
          ...(mod.group ? { group: mod.group } : {}),
        };
      }
      InterfaceOrchestrator.getInstance().recordObservedWindows(layout);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [state.modules, windowIds]);

  /* -------------------- design tokens → the live DOM ------------------ */

  const appliedKeysRef = useRef<string[]>([]);
  useEffect(() => {
    const root = document.documentElement;
    const config = view.effective;

    const apply = () => {
      for (const key of appliedKeysRef.current) root.style.removeProperty(key);
      appliedKeysRef.current = [];
      for (const attr of ["data-lelu-theme", "data-lelu-text-animation", "data-lelu-motion", "data-lelu-window-shape"]) root.removeAttribute(attr);
      if (view.previewing) root.setAttribute("data-lelu-previewing", "");
      else root.removeAttribute("data-lelu-previewing");

      document.getElementById(FONT_LINK_ID)?.remove();
      document.getElementById(CUSTOM_FONT_STYLE_ID)?.remove();

      // The original look sets nothing: the Cosmos is exactly as it was.
      if (isDefaultLook(config)) return;

      const compiled = tokensToCssVariables(config.tokens, InterfaceOrchestrator.customFamilies(config), {
        mobile: currentViewport().mobile,
        reducedMotion: prefersReducedMotion(),
      });
      for (const [key, value] of Object.entries(compiled.variables)) root.style.setProperty(key, value);
      appliedKeysRef.current = Object.keys(compiled.variables);
      for (const [attr, value] of Object.entries(compiled.attributes)) root.setAttribute(attr, value);

      const url = googleFontsUrl(compiled.fonts.filter(isKnownFont));
      if (url) {
        const link = document.createElement("link");
        link.id = FONT_LINK_ID;
        link.rel = "stylesheet";
        link.href = url;
        document.head.appendChild(link);
      }
      if (config.customFonts.length) {
        const style = document.createElement("style");
        style.id = CUSTOM_FONT_STYLE_ID;
        style.textContent = config.customFonts.map(fontFaceCss).join("\n");
        document.head.appendChild(style);
      }
    };

    apply();
    // Responsive typography: recompile when crossing the phone breakpoint.
    let wasMobile = currentViewport().mobile;
    const onResize = () => {
      const mobile = currentViewport().mobile;
      if (mobile !== wasMobile) {
        wasMobile = mobile;
        apply();
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [view.effective, view.previewing]);

  /* --------------- Cosmos objects open what they link to -------------- */

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { kind?: string; id?: string } | undefined;
      if (!detail?.id) return;
      const actions = actionsRef.current;
      if (detail.kind === "conversation") {
        actions.switchConversation(detail.id);
        actions.openPanel("chat");
      } else if (detail.kind === "module") {
        actions.openModule(detail.id);
      } else if (detail.kind === "project") {
        actions.openPanel("projects" as GenesisPanel);
      }
    }
    window.addEventListener("lelu-interface-open-link", onOpen);
    return () => window.removeEventListener("lelu-interface-open-link", onOpen);
  }, []);

  return null;
}
