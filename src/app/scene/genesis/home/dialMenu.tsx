/**
 * ==========================================================
 * LÉLU — THE DIAL'S MENU, BUILT ONCE
 *
 * The dial is the interface's only navigation. Its ring is built here, from
 * the ONE destination registry, so every surface that shows the dial shows
 * the SAME ring:
 *
 *   - the bottom-centre dial of the spatial bar (home/SpatialNav),
 *   - the dial in the reserved slot of a phone conversation,
 *   - the dial in the Chat Universe's rail.
 *
 * Before this the Universe rail kept its own eleven-destination list
 * (`RAIL`) and three rings of its own: a second hierarchy that could name
 * places the dial did not have, and open some of them differently. There is
 * one builder now, and a destination that is not in the registry cannot be
 * offered anywhere.
 *
 * Travel is recursive: a group zooms in, a destination travels, and the
 * workspace's own projects and conversations are extra levels of the SAME
 * tree, read from the stores that own them.
 * ==========================================================
 */

import { CHAT_WINDOW_PREFIX, useGenesis, type GenesisPanel } from "../GenesisCore";
import { HomeIcon } from "./CosmosHome";
import HomeStore from "./homeStore";
import { goHome } from "./homeActions";
import { useHomeStore } from "./useHomeLive";
import { useVoice } from "../../../../core/voice/useVoice";
import { setUniverseOpen } from "../chat/universe/universeOpen";
import ProjectStore from "../../../../core/projects/ProjectStore";
import {
  DIAL,
  SPACES,
  type DialEntry,
  type Destination,
  type DestinationGroup,
} from "../interaction/destinations";
import type { RadialMenuDefinition, RadialMenuItemSpec } from "../../../../core/interaction";

type GenesisContext = ReturnType<typeof useGenesis>;
type HomeContext = ReturnType<typeof useHomeStore>;
type VoiceContext = ReturnType<typeof useVoice>;

export interface DialContext {
  genesis: GenesisContext;
  home: HomeContext;
  voice: VoiceContext;
  /** The dial's voice action — the one VoiceEngine, never a second pipeline. */
  onHoldVoice: () => void;
  /** The workspace sheet belongs to the bar; travel closes it. */
  clearSheet?: () => void;
}

/* ---------------------------------------------------------------
 * The four ways out of anywhere. One implementation each.
 * ------------------------------------------------------------- */

/** The Chat Universe — the glass, windowed chat. */
export function openUniverse(genesis: GenesisContext, clearSheet?: () => void): void {
  void genesis;
  clearSheet?.();
  HomeStore.setImmersive(false);
  setUniverseOpen(true);
  window.dispatchEvent(new CustomEvent("lelu-open-universe"));
}

/** A real panel, opened exactly as the palette opens it. */
export function openDestination(genesis: GenesisContext, panel: GenesisPanel, clearSheet?: () => void): void {
  clearSheet?.();
  HomeStore.setImmersive(false);
  genesis.openPanel(panel);
}

/**
 * The Cosmos. Entering it is always explicit — a destination the person
 * chose — never a side effect of opening something else.
 */
export function enterCosmos(genesis: GenesisContext, immersive: boolean, clearSheet?: () => void): void {
  clearSheet?.();
  goHome(genesis);
  HomeStore.setImmersive(immersive);
}

const icon = (name: string, size = 21) => <HomeIcon name={name} size={size} />;

/* ---------------------------------------------------------------
 * Travel
 * ------------------------------------------------------------- */

function travelTo(genesis: GenesisContext, destination: Destination, clearSheet?: () => void): void {
  switch (destination.target.kind) {
    case "home":
      clearSheet?.();
      goHome(genesis);
      HomeStore.setImmersive(false);
      break;
    case "immersive":
      enterCosmos(genesis, true, clearSheet);
      break;
    case "chat":
      openUniverse(genesis, clearSheet);
      break;
    case "panel":
      openDestination(genesis, destination.target.panel, clearSheet);
      break;
    /*
     * Recursive navigation: a workspace's projects and its conversations are
     * levels of this tree, and each one opens the real thing it names — the
     * workspace focused on that project, or that conversation in its own
     * window. No new bar, no second menu.
     */
    case "project":
      clearSheet?.();
      HomeStore.setImmersive(false);
      ProjectStore.getInstance().focus(destination.target.projectId);
      genesis.openPanel("projects");
      break;
    case "conversation":
      clearSheet?.();
      HomeStore.setImmersive(false);
      genesis.openModule(`${CHAT_WINDOW_PREFIX}${destination.target.conversationId}`);
      break;
  }
}

function isActive(
  destination: Destination,
  state: GenesisContext["state"],
  home: HomeContext,
  sheetOpen: boolean,
): boolean {
  switch (destination.target.kind) {
    case "home":
      return state.activePanel === "none" && state.activeScene !== "genesisv2" && !home.immersive && !sheetOpen;
    case "immersive":
      return home.immersive;
    case "chat":
      return state.activePanel === "chat";
    case "panel":
      return state.activePanel === destination.target.panel;
    case "project":
      return state.activePanel === "projects" && ProjectStore.getInstance().focusedProject()?.id === destination.target.projectId;
    case "conversation": {
      const module = state.modules[`${CHAT_WINDOW_PREFIX}${destination.target.conversationId}`];
      return Boolean(module) && module?.presentation !== "closed";
    }
  }
}

/* ---------------------------------------------------------------
 * The workspace's own contents
 * ------------------------------------------------------------- */

const projectDestination = (id: string, label: string): Destination => ({
  kind: "destination",
  id: `project-${id}`,
  label,
  hint: "Open the workspace on this project",
  icon: "Folder",
  target: { kind: "project", projectId: id },
});

/**
 * Work → Projects → one project is three levels of the same tree, and
 * Work → Conversations → one conversation opens that conversation where it
 * lives. The lists are read from the stores that own them when the dial
 * renders, so a new project or a new conversation appears in the navigation
 * without anyone registering a new bar.
 */
function workspaceGroup(conversations: ReadonlyArray<{ id: string; title?: string }>): DestinationGroup {
  const work = DIAL.find((entry): entry is DestinationGroup => entry.kind === "group" && entry.id === "work");
  const projects = ProjectStore.getInstance().list();
  return {
    id: "work",
    label: "Work",
    hint: "The spaces where you make things",
    icon: "LayoutGrid",
    kind: "group",
    items: [
      ...(work?.items ?? []),
      {
        id: "work-projects",
        label: "Projects",
        hint: "What the workspace holds",
        icon: "Folder",
        kind: "group",
        items:
          projects.length === 0
            ? [
                {
                  kind: "destination",
                  id: "workspace",
                  label: "Workspace",
                  hint: "Projects, documents and their files",
                  icon: "Folder",
                  target: { kind: "panel", panel: "projects" },
                },
              ]
            : projects.map((project) => projectDestination(project.id, project.name)),
      },
      {
        id: "work-conversations",
        label: "Conversations",
        hint: "Every thread in the Chat Universe",
        icon: "MessagesSquare",
        kind: "group",
        items:
          conversations.length === 0
            ? [
                {
                  kind: "destination",
                  id: "work-chat-empty",
                  label: "Chat Universe",
                  hint: "Every conversation",
                  icon: "MessagesSquare",
                  target: { kind: "chat" },
                },
              ]
            : conversations.slice(0, 12).map((conversation) => ({
                kind: "destination" as const,
                id: `conversation-${conversation.id}`,
                label: conversation.title || "Untitled conversation",
                hint: "Open this conversation",
                icon: "MessagesSquare",
                target: { kind: "conversation" as const, conversationId: conversation.id },
              })),
      },
    ],
  };
}

/* ---------------------------------------------------------------
 * The menu
 * ------------------------------------------------------------- */

/** The ring. Same registry, same order, same actions, wherever it is shown. */
export function buildDialMenu(context: DialContext & { sheetOpen?: boolean }): RadialMenuDefinition {
  const { genesis, home, voice, onHoldVoice, clearSheet, sheetOpen = false } = context;
  const state = genesis.state;

  const destinationItem = (destination: Destination): RadialMenuItemSpec => ({
    id: destination.id,
    label: destination.label,
    icon: icon(destination.icon),
    active: isActive(destination, state, home, sheetOpen),
    onSelect: () => travelTo(genesis, destination, clearSheet),
  });

  /** An entry at any depth: a group zooms in, a destination travels. */
  const entryItem = (entry: DialEntry): RadialMenuItemSpec =>
    entry.kind === "group" ? groupItem(entry) : destinationItem(entry);

  const groupItem = (group: DestinationGroup): RadialMenuItemSpec => ({
    id: group.id,
    label: group.label,
    icon: icon(group.icon),
    children: group.items.map(entryItem),
  });

  const others = DIAL.filter(
    (entry): entry is DestinationGroup => entry.kind === "group" && entry.id !== "work",
  );

  return {
    id: "environment-radial",
    label: "Environments",
    items: [
      ...SPACES.map(destinationItem),
      groupItem(workspaceGroup(state.conversations ?? [])),
      ...others.map(groupItem),
      {
        id: "voice",
        label: voice.state.active ? "Stop talking" : "Talk to LÉLU",
        icon: icon(voice.state.active ? "MicOff" : "Mic"),
        active: voice.state.active,
        tone: voice.state.active ? "accent" : "default",
        onSelect: onHoldVoice,
      },
      {
        id: "immersion",
        label: home.immersive ? "Back to the workspace" : "Look at the Cosmos",
        icon: icon("Orbit"),
        onSelect: () => HomeStore.setImmersive(!home.immersive),
      },
    ],
  };
}
