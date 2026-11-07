/**
 * ==========================================================
 * LÉLU — INTERFACE TOOLS
 *
 * LÉLU's native interface-control capabilities, registered in
 * the same ToolRegistry / ToolDispatcher / AutonomyGate /
 * ToolStats as every other tool, so they are discoverable via
 * capability.discover, plannable in tasks, and offered to the
 * model in an ordinary chat turn:
 *
 *   interface.inspect    risk 0  see the environment, windows,
 *                                relationships, design system,
 *                                Cosmos scene, history, and what
 *                                she can do
 *   interface.propose    risk 1  construct + preview a change to
 *                                layout / typography / theme /
 *                                materials / environment / 3D
 *                                scene. NEVER applies it.
 *   interface.revert     risk 1  propose returning to an earlier
 *                                version (also needs consent)
 *   interface.themes     risk 1  list / save (additive) / apply
 *                                (a proposal) / delete (a
 *                                destructive proposal)
 *   interface.recommend  risk 0  which environment suits a task
 *
 * There is deliberately NO approving tool. The user approves.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import InterfaceOrchestrator, { type ChangeSet, type Proposal } from "./InterfaceOrchestrator";
import { ENVIRONMENT_PRESETS, TYPOGRAPHY_SYSTEMS } from "./EnvironmentLibrary";
import { FONT_LIBRARY } from "./FontLibrary";
import { SCENE_KINDS } from "./SceneModel";
import { SPATIAL_DESTINATIONS } from "../../app/scene/spatial/SpatialScenes";

interface InterfaceExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

const tool = (id: string, name: string, description: string, riskLevel: number, permissions: string[]): ToolDefinition =>
  ({ id, name, description, category: "Interface", permissions, riskLevel, available: true, executionRoute: "front-end:InterfaceOrchestrator", verificationMethod: "interface.inspect" }) as ToolDefinition;

export const INTERFACE_TOOLS: ToolDefinition[] = [
  tool(
    "interface.inspect",
    "See My Interface",
    "Inspect LÉLU's own live interface: the Cosmos environment, every window (chat and tool windows) with position/size/z-order/rotation/group, how windows relate (left of, above, overlapping), the design system (fonts, type scale, palette, materials, lighting, motion, backdrop), the 3D objects she composed in the Cosmos, active workspaces, version history, and the full list of what she can change",
    0,
    ["READ"],
  ),
  tool(
    "interface.propose",
    "Propose an Interface Change",
    "Design a change to LÉLU's own interface — move/resize/rotate/group/arrange windows to fit the screen, change typography and fonts, palette, glass/materials/textures/window shape, lighting, motion, the backdrop environment, or create/animate 3D objects (planets, nebulae, flora, crystals, artboards, glTF models) in the Cosmos. It builds the full result in isolation and shows the user a live PREVIEW; it does NOT apply anything. The user approves or rejects it. Use for any 'change my workspace/theme/fonts/layout/environment' request. Change ONLY what the user asked for: a layout request gets window operations, not a new theme or preset. For relative placement ('X beside Y, Z above X') use one arrange op with strategy 'relations' rather than guessing coordinates. Describe the result using the Changes list this tool returns",
    1,
    ["WRITE"],
  ),
  tool("interface.revert", "Propose Restoring a Version", "Propose returning the interface to an earlier saved version (see interface.inspect history). The user approves it like any change", 1, ["WRITE"]),
  tool("interface.themes", "Interface Themes", "List saved themes and environment presets, save the current (or previewed) design as a reusable theme, propose applying a saved theme, or propose deleting one (destructive — the user must confirm)", 1, ["WRITE"]),
  tool("interface.recommend", "Recommend an Environment", "Suggest which interface environment and window arrangement suits a kind of work (research, coding, creative, project management, casual conversation). Advisory only", 0, ["READ"]),
  tool(
    "spatial.portal.create",
    "Create a Spatial Portal",
    "Create a named portal in LÉLU's spatial ring that leads to one real environment. It is stored in the canonical portal registry, appears in the ring immediately and can be removed later. Only destinations that exist in the scene graph are accepted; an unknown one is refused with a reason rather than creating a portal that opens nothing",
    1,
    ["WRITE"],
  ),
  tool(
    "spatial.portal.remove",
    "Remove a Spatial Portal",
    "Remove a portal from LÉLU's spatial ring by its id (the id returned by spatial.portal.create). Built-in destinations are not portals a person created, so removing one is refused; the ring keeps its identity",
    1,
    ["WRITE"],
  ),
];

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const str = (args: Record<string, unknown>, key: string) => (typeof args[key] === "string" ? (args[key] as string).trim() : "");

interface PortalReply {
  ok: boolean;
  reason?: string;
  portal?: { id: string; label: string; destination: string };
}

/**
 * Ask the mounted spatial interface to do something and wait for ITS answer.
 *
 * This is the same domain-event surface `genesis-show-surface` already uses, so
 * an agent reaches the one portal registry through the one scene rather than
 * importing it and acting on state the interface is also rendering. The answer
 * carries the registry's real result: a refusal stays a refusal.
 */
function askSpatial(requestEvent: string, replyEvent: string, detail: Record<string, unknown>): Promise<PortalReply> {
  return new Promise<PortalReply>((resolve) => {
    if (typeof window === "undefined") {
      resolve({ ok: false, reason: "there is no spatial interface in this context" });
      return;
    }
    const requestId = `portal_req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const onReply = (event: Event) => {
      const reply = (event as CustomEvent).detail as (PortalReply & { requestId?: string }) | undefined;
      if (!reply || reply.requestId !== requestId) return;
      window.removeEventListener(replyEvent, onReply);
      clearTimeout(timer);
      resolve(reply);
    };
    const timer = setTimeout(() => {
      window.removeEventListener(replyEvent, onReply);
      resolve({ ok: false, reason: "the spatial interface did not answer in time" });
    }, 4000);
    window.addEventListener(replyEvent, onReply);
    window.dispatchEvent(new CustomEvent(requestEvent, { detail: { ...detail, requestId } }));
  });
}

function proposalReport(proposal: Proposal, issues: string[]): string {
  const lines = [
    `PROPOSED, NOT APPLIED — proposal ${proposal.id}: "${proposal.description}".`,
    `The user now sees a live preview${proposal.windowsChanged ? " (new window positions shown as outlines)" : ""} with Approve / Reject. Nothing changes until they approve${proposal.destructive ? ", and because it is destructive they must also confirm separately" : ""}. Do not say it has been applied; tell them what you prepared and ask for their decision.`,
    `Scopes: ${proposal.scopes.join(", ")}.`,
    `Changes:\n- ${proposal.changes.join("\n- ")}`,
  ];
  if (proposal.destructive) lines.push(`Destructive: ${proposal.destructiveReasons.join("; ")}.`);
  if (proposal.notes.length) lines.push(`Notes:\n- ${proposal.notes.join("\n- ")}`);
  if (proposal.warnings.some((w) => w.includes("planned layout does not place it there"))) {
    lines.push("⚠ Your description and the planned layout disagree (see warnings). Re-propose with an arrange op using strategy 'relations' before telling the user it matches.");
  }
  if (proposal.warnings.length || issues.length) lines.push(`Warnings / adjustments:\n- ${[...new Set([...proposal.warnings, ...issues])].join("\n- ")}`);
  return lines.join("\n");
}

const WINDOW_OP_SCHEMA = {
  type: "object",
  description:
    "One window operation. ids are window ids from interface.inspect (e.g. chat, browser, projects, render, engineering) — loose names like 'my browser' are resolved. Coordinates are CSS px from the top-left of the screen.",
  properties: {
    op: { type: "string", enum: ["move", "resize", "transform", "open", "minimize", "maximize", "restore", "close", "raise", "group", "ungroup", "arrange"] },
    id: { type: "string" },
    ids: { type: "array", items: { type: "string" } },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    rotation: { type: "number", description: "degrees, ±12" },
    group: { type: "string" },
    strategy: { type: "string", enum: ["relations", "grid", "columns", "focus", "cascade", "organic", "fit"], description: "arrange: 'relations' uses the relations list; 'fit' makes everything fit on screen without overlap" },
    primary: { type: "string", description: "arrange focus: the window that gets most space" },
    relations: {
      type: "array",
      items: OBJ({ id: { type: "string" }, relation: { type: "string", enum: ["beside", "left-of", "right-of", "above", "below"] }, of: { type: "string" } }, ["id", "relation", "of"]),
      description: "e.g. [{id:'browser',relation:'beside',of:'chat'},{id:'projects',relation:'above',of:'browser'}]",
    },
  },
  required: ["op"],
};

const SCENE_OP_SCHEMA = {
  type: "object",
  description: "One Cosmos scene operation. Positions are [x,y,z] in scene units: the camera sits near [0,0,6.8] looking at the origin; keep objects within about ±4 x, ±2.5 y, z between -8 and 1.",
  properties: {
    op: { type: "string", enum: ["add", "update", "remove", "clear", "camera", "populate"] },
    id: { type: "string" },
    object: OBJ(
      {
        kind: { type: "string", enum: [...SCENE_KINDS] },
        label: { type: "string" },
        position: { type: "array", items: { type: "number" } },
        rotation: { type: "array", items: { type: "number" } },
        scale: { type: "number" },
        color: { type: "string", description: "#rrggbb" },
        secondaryColor: { type: "string" },
        material: OBJ({ roughness: { type: "number" }, metalness: { type: "number" }, emissiveIntensity: { type: "number" }, opacity: { type: "number" }, wireframe: { type: "boolean" } }),
        animation: OBJ({ type: { type: "string", enum: ["none", "spin", "orbit", "bob", "pulse", "sway", "drift"] }, speed: { type: "number" } }),
        features: OBJ({ rings: { type: "boolean" }, atmosphere: { type: "boolean" }, moons: { type: "number" }, petals: { type: "number" }, count: { type: "number" } }),
        link: OBJ({ kind: { type: "string", enum: ["conversation", "module", "project"] }, id: { type: "string" }, label: { type: "string" } }),
        url: { type: "string", description: "kind model: https .glb/.gltf" },
      },
      ["kind"],
    ),
    changes: { type: "object", description: "update: fields to change" },
    position: { type: "array", items: { type: "number" }, description: "camera position" },
    target: { type: "array", items: { type: "number" }, description: "camera look-at" },
    from: { type: "string", enum: ["workspaces"], description: "populate: one object per active workspace, each linked so selecting it opens that workspace" },
    kind: { type: "string", enum: [...SCENE_KINDS] },
    limit: { type: "number" },
    radius: { type: "number" },
  },
  required: ["op"],
};

export const INTERFACE_EXECUTORS: InterfaceExecutor[] = [
  {
    id: "interface.inspect",
    parameters: OBJ({ section: { type: "string", enum: ["all", "environment", "windows", "design", "scene", "history", "capabilities"], description: "default all" } }),
    run: async (args) => {
      const section = (str(args, "section") || "all") as Parameters<InterfaceOrchestrator["inspect"]>[0];
      const result = InterfaceOrchestrator.getInstance().inspect(section);
      return { ok: true, content: result.text, data: result.data };
    },
  },
  {
    id: "interface.propose",
    parameters: OBJ(
      {
        description: { type: "string", description: "One sentence the user reads on the consent bar: what this changes." },
        rationale: { type: "string", description: "Why this design works (typography/colour/layout reasoning)." },
        preset: {
          type: "string",
          description: `ONLY when the user asks for a whole new environment that matches one (replaces palette, typography, materials, backdrop and decorations): ${ENVIRONMENT_PRESETS.map((p) => p.id).join(", ")}, or a saved theme id. Omit it for anything else — layout, typography or object requests must not carry a preset.`,
        },
        resetTokens: { type: "boolean", description: "Start from the original Genesis design instead of the current one." },
        typographySystem: { type: "string", enum: Object.keys(TYPOGRAPHY_SYSTEMS) },
        tokens: {
          type: "object",
          description:
            "Partial design tokens. palette{background,surface,surfaceAlt,text,textMuted,accent,accentSoft,border,glow,success,warning,danger as #rrggbb}; " +
            `typography{bodyFont,headingFont,monoFont (ids: ${FONT_LIBRARY.map((f) => f.id).join(", ")} or a custom font id),baseSize px,scaleRatio,bodyWeight,headingWeight,letterSpacing em,headingLetterSpacing em,lineHeight,headingLineHeight,textAlign left|center|justify,headingCase none|uppercase|lowercase|capitalize,textAnimation none|fade|rise|shimmer|typewriter,mobileScale}; ` +
            "materials{surfaceOpacity 0-1,blur px,borderWidth,borderOpacity,radius px,windowShape rect|rounded|pill|organic,shadowDepth 0-1,glowStrength 0-1,texture none|grain|paper|silk|stars|leaf|water,gradientAngle,density 0.8-1.25}; " +
            "lighting{ambient,keyIntensity,keyColor,rimColor,fogColor,fogDensity 0-0.12}; motion{profile still|calm|fluid|lively,durationMs,easing standard|gentle|spring|linear,floatAmplitude px}; " +
            "environment{backdrop cosmos|gradient|nebula|garden|river|studio|plain,gradientStops[#hex],nebulaColors[#hex],particleColor,particleDensity 0-1,vignette 0-1}",
        },
        customFonts: { type: "array", items: OBJ({ family: { type: "string" }, url: { type: "string" }, licence: { type: "string" }, weight: { type: "string" } }, ["family", "url", "licence"]) },
        windows: { type: "array", items: WINDOW_OP_SCHEMA },
        scene: {
          type: "array",
          items: SCENE_OP_SCHEMA,
          description:
            "Cosmos objects. To represent the user's workspaces use [{op:'populate', from:'workspaces', kind:'planet', limit:N}] — it builds one object per real workspace and LINKS each so selecting it opens that workspace (hand-made objects are not linked unless you set link). Typical scales: planet 0.25–0.45, moon 0.1–0.2, flora 0.3–0.6, nebula 4–7.",
        },
        environment: OBJ({ name: { type: "string" }, description: { type: "string" } }),
      },
      ["description"],
    ),
    run: async (args) => {
      const change = args as unknown as ChangeSet;
      const result = InterfaceOrchestrator.getInstance().propose(change, { origin: "lelu" });
      if (!result.ok || !result.proposal) {
        return { ok: false, content: `Nothing was proposed: ${result.reason}.${result.issues.length ? ` Problems: ${result.issues.join("; ")}` : ""}` };
      }
      return { ok: true, content: proposalReport(result.proposal, result.issues), data: { proposalId: result.proposal.id, changes: result.proposal.changes, scopes: result.proposal.scopes, destructive: result.proposal.destructive } };
    },
  },
  {
    id: "interface.revert",
    parameters: OBJ({ version: { type: "number", description: "Version number from interface.inspect history (e.g. 0 = original Genesis)." } }, ["version"]),
    run: async (args) => {
      const version = typeof args.version === "number" ? args.version : Number(args.version);
      if (!Number.isFinite(version)) return { ok: false, content: "Give the version number to restore (see interface.inspect history)." };
      const result = InterfaceOrchestrator.getInstance().proposeRestore(version, { origin: "lelu" });
      if (!result.ok || !result.proposal) return { ok: false, content: `Nothing was proposed: ${result.reason}.` };
      return { ok: true, content: proposalReport(result.proposal, []), data: { proposalId: result.proposal.id } };
    },
  },
  {
    id: "interface.themes",
    parameters: OBJ(
      {
        action: { type: "string", enum: ["list", "save", "apply", "delete"] },
        name: { type: "string", description: "save: theme name" },
        description: { type: "string" },
        id: { type: "string", description: "apply/delete: saved theme or preset id" },
        source: { type: "string", enum: ["live", "preview"], description: "save: the applied design (default) or the one being previewed" },
      },
      ["action"],
    ),
    run: async (args) => {
      const orchestrator = InterfaceOrchestrator.getInstance();
      const action = str(args, "action");
      if (action === "list") {
        const saved = orchestrator.view().themes;
        return {
          ok: true,
          content: `Saved themes: ${saved.length ? saved.map((t) => `${t.id} "${t.name}"`).join(", ") : "none yet"}.\nPresets: ${ENVIRONMENT_PRESETS.map((p) => `${p.id} "${p.name}" — ${p.description}`).join("\n")}`,
          data: { saved: saved.map(({ id, name, description }) => ({ id, name, description })), presets: ENVIRONMENT_PRESETS.map(({ id, name }) => ({ id, name })) },
        };
      }
      if (action === "save") {
        const name = str(args, "name");
        if (!name) return { ok: false, content: "A theme needs a name." };
        const theme = orchestrator.saveTheme(name, str(args, "description"), str(args, "source") === "preview" ? "preview" : "live");
        return { ok: true, content: `Saved the ${str(args, "source") === "preview" ? "previewed" : "current"} design as "${theme.name}" (${theme.id}). Nothing on screen changed.`, data: { id: theme.id } };
      }
      if (action === "apply") {
        const id = str(args, "id");
        const result = orchestrator.propose({ description: `Apply the "${id}" theme`, preset: id }, { origin: "lelu" });
        if (!result.ok || !result.proposal) return { ok: false, content: `Nothing was proposed: ${result.reason}.` };
        return { ok: true, content: proposalReport(result.proposal, result.issues), data: { proposalId: result.proposal.id } };
      }
      if (action === "delete") {
        const result = orchestrator.proposeDeleteTheme(str(args, "id"), { origin: "lelu" });
        if (!result.ok || !result.proposal) return { ok: false, content: `Nothing was proposed: ${result.reason}.` };
        return { ok: true, content: proposalReport(result.proposal, []), data: { proposalId: result.proposal.id } };
      }
      return { ok: false, content: `Unknown action "${action}" (list, save, apply, delete).` };
    },
  },
  {
    id: "interface.recommend",
    parameters: OBJ({ request: { type: "string", description: "What the user is about to do." } }, ["request"]),
    run: async (args) => {
      const rec = InterfaceOrchestrator.getInstance().recommend(str(args, "request"));
      return {
        ok: true,
        content: `For ${rec.task}: ${rec.why} Suggested windows: ${rec.windows.join(", ")}; arrangement ${JSON.stringify(rec.arrangement)}; typography system ${rec.typography}${rec.presetId ? `; environment preset ${rec.presetId}` : ""}. This is a recommendation only — offer it, and use interface.propose if the user wants it.`,
        data: rec,
      };
    },
  },
  {
    id: "spatial.portal.create",
    parameters: OBJ(
      {
        destination: {
          type: "string",
          enum: SPATIAL_DESTINATIONS.map((destination) => destination.id),
          description: "The environment the portal leads to. Use the environment's own id, not a made-up name.",
        },
        label: { type: "string", description: "What to call the portal, e.g. 'Client files'. Defaults to the destination's name." },
        workspace: { type: "string", description: "Workspace the portal belongs to (default: the current one)." },
      },
      ["destination"],
    ),
    run: async (args) => {
      const reply = await askSpatial("lelu-portal-create", "lelu-portal-created", {
        destination: str(args, "destination"),
        label: str(args, "label"),
        workspace: str(args, "workspace") || undefined,
      });
      if (!reply.ok || !reply.portal) {
        return { ok: false, content: `No portal was created: ${reply.reason ?? "the spatial interface refused it"}.` };
      }
      return {
        ok: true,
        content: `Created the portal "${reply.portal.label}" (${reply.portal.id}) to ${reply.portal.destination}. It is in the ring now; selecting it opens that environment.`,
        data: reply.portal,
      };
    },
  },
  {
    id: "spatial.portal.remove",
    parameters: OBJ(
      {
        id: { type: "string", description: "The portal id returned by spatial.portal.create." },
      },
      ["id"],
    ),
    run: async (args) => {
      const id = str(args, "id");
      if (!id) return { ok: false, content: "Give the id of the portal to remove (see spatial.portal.create)." };
      if (id.startsWith("scene:")) {
        return { ok: false, content: `"${id}" is a built-in destination in the ring, not a portal that was created, so it cannot be removed.` };
      }
      const reply = await askSpatial("lelu-portal-remove", "lelu-portal-removed", { id });
      return reply.ok
        ? { ok: true, content: `Removed the portal ${id}. The destination itself is untouched.`, data: { id } }
        : { ok: false, content: `The portal was not removed: ${id} is not in the registry.` };
    },
  },
];

export function registerInterfaceTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const definition of INTERFACE_TOOLS) registry.register(definition);
}
