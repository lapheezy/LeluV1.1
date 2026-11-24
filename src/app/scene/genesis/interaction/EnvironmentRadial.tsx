/**
 * ==========================================================
 * LÉLU — ENVIRONMENT RADIAL
 *
 * One persistent circular control, mounted once above every scene, for
 * moving between LÉLU's environments without a navigation list.
 *
 * It is the same CircularControl / RadialMenu / InteractionStateManager
 * every other surface uses. Cosmos, CORE, the Genesis Scene, the Chat
 * Universe, the studios and the executive surfaces are all one hold
 * away, and the menu is edge-aware so it cannot be clipped on a phone.
 * ==========================================================
 */

import { useGenesis, type GenesisPanel } from "../GenesisCore";
import HomeStore from "../home/homeStore";
import { goHome } from "../home/homeActions";
import { setUniverseOpen } from "../chat/universe/universeOpen";
import { HomeIcon } from "../home/CosmosHome";
import { CircularControl, type RadialMenuDefinition, type RadialMenuItemSpec } from "../../../../core/interaction";
import "./environmentRadial.css";

export default function EnvironmentRadial({ hidden = false }: { hidden?: boolean }) {
  const genesis = useGenesis();
  const { state } = genesis;

  const icon = (name: string, size = 20) => <HomeIcon name={name} size={size} />;

  const open = (id: GenesisPanel) => {
    HomeStore.setImmersive(false);
    genesis.openPanel(id);
  };

  const openChat = () => {
    HomeStore.setImmersive(false);
    setUniverseOpen(true);
    window.dispatchEvent(new CustomEvent("lelu-open-universe"));
  };

  const enterCosmos = () => {
    goHome(genesis);
    HomeStore.setImmersive(true);
  };

  const environments: RadialMenuItemSpec[] = [
    { id: "core", label: "LÉLU CORE", icon: icon("Sparkles"), onSelect: () => { goHome(genesis); HomeStore.setImmersive(false); } },
    { id: "cosmos", label: "Cosmos", icon: icon("Orbit"), active: HomeStore.get().immersive, onSelect: enterCosmos },
    { id: "genesis", label: "Genesis Scene", icon: icon("Layers"), active: state.activeScene === "genesisv2", onSelect: () => open("genesisv2") },
    { id: "chat", label: "Chat Universe", icon: icon("MessagesSquare"), onSelect: openChat },
  ];

  const work: RadialMenuItemSpec[] = [
    { id: "ui", label: "UI Universe", icon: icon("Box"), onSelect: () => open("visualstudio") },
    { id: "workspace", label: "Workspace", icon: icon("Folder"), onSelect: () => open("projects") },
    { id: "create", label: "Creation Studio", icon: icon("PenLine"), onSelect: () => open("creation") },
    { id: "voice", label: "Voice Studio", icon: icon("AudioLines"), onSelect: () => open("voice-studio") },
    { id: "engineering", label: "Engineering Studio", icon: icon("Code2"), onSelect: () => open("eng-studio") },
  ];

  const intelligence: RadialMenuItemSpec[] = [
    { id: "agents", label: "Agent Universe", icon: icon("Workflow"), onSelect: () => open("agents") },
    { id: "executive", label: "Executive Board", icon: icon("Crown"), onSelect: () => open("executive") },
    {
      id: "galaxies",
      label: "Executive Galaxies",
      icon: icon("Orbit"),
      // The galaxies are the Cosmos' own structure; opening the Cosmos is
      // the honest way to see them, not a second dashboard.
      onSelect: enterCosmos,
    },
    { id: "reasoning", label: "Reasoning", icon: icon("Lightbulb"), onSelect: () => open("reasoning") },
    { id: "memory", label: "Memory", icon: icon("Brain"), onSelect: () => open("memory") },
  ];

  const menu: RadialMenuDefinition = {
    id: "environment-radial",
    label: "Environments",
    items: [
      ...environments,
      { id: "work", label: "Work", icon: icon("LayoutGrid"), children: work },
      { id: "intelligence", label: "Intelligence", icon: icon("Brain"), children: intelligence },
    ],
  };

  /*
   * One navigation at a time.
   *
   * The workspace owns this radial. When another surface owns the screen —
   * a conversation window, a panel sheet on a phone, the immersive Cosmos —
   * that surface already has its own circular navigation, and this control
   * would otherwise be painted UNDER it: present in the DOM, impossible to
   * press. On a 390px phone the floating chat window covered it completely.
   * So it steps aside with the Spatial Bar instead of pretending to be
   * reachable.
   */
  if (state.minimized || hidden) return null;

  return (
    <div className="lelu-environment-radial" data-testid="environment-radial">
      <CircularControl
        label="Environments — hold for LÉLU's spaces"
        icon={icon("Compass", 22)}
        menu={menu}
        size={46}
        tone="accent"
        testId="environment-radial-control"
      />
    </div>
  );
}
