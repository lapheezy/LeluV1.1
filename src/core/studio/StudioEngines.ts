/**
 * ==========================================================
 * LÉLU — SESSION 3C: ENGINE EVALUATION
 *
 * "Which engine?" is answered from the project's real requirements and
 * this runtime's real capabilities — not from a preference. Unity and
 * Unreal are not silently pretended to be usable: their editors,
 * licences and build toolchains are not present in this environment, so
 * they are reported as unavailable with the exact reason. Godot is
 * available only when a real `godot` binary is found.
 *
 * Web technologies are always available here, because the browser is the
 * runtime that actually exists: three.js for 3D, canvas/WebGL for 2D,
 * shipped as static files and previewed in a Cosmos window.
 * ==========================================================
 */

import type {
  EngineCapability,
  EngineRecommendation,
  StudioEngineId,
  StudioRequirements,
} from "./StudioProjectTypes";

export interface EngineProbe {
  /** `godot --version` succeeded on the studio runtime. */
  godotInstalled: boolean;
  /** `unity` editor binary found (never true in a headless runtime). */
  unityInstalled: boolean;
  /** UnrealEditor binary found (never true in a headless runtime). */
  unrealInstalled: boolean;
}

export const DEFAULT_ENGINE_PROBE: EngineProbe = {
  godotInstalled: false,
  unityInstalled: false,
  unrealInstalled: false,
};

/** Capabilities measured against the environment, in one place. */
export function engineCapabilities(probe: EngineProbe = DEFAULT_ENGINE_PROBE): EngineCapability[] {
  return [
    {
      id: "web",
      label: "Web technologies (three.js / WebGL)",
      dimensions: ["2d", "3d"],
      targets: ["web", "pwa", "mobile", "desktop"],
      status: "available",
      requires: ["a browser runtime", "static build output"],
      detail:
        "Always available here: the studio builds static output and previews it inside a Cosmos window. " +
        "Mobile and desktop are reached through the existing Capacitor shell and PWA install, not a game console toolchain.",
      preview: "in-browser",
    },
    {
      id: "godot",
      label: "Godot 4",
      dimensions: ["2d", "3d"],
      targets: ["mobile", "desktop", "web"],
      status: probe.godotInstalled ? "available" : "not-installed",
      requires: ["a godot editor binary on the runtime", "export templates for each target"],
      detail: probe.godotInstalled
        ? "A godot binary is present and can export the project."
        : "Godot is not installed on this runtime, so nothing could be built or previewed here. " +
          "The project scaffold and asset contract are still valid for a runtime that has the editor.",
      preview: "editor",
    },
    {
      id: "unity",
      label: "Unity",
      dimensions: ["2d", "3d"],
      targets: ["mobile", "desktop", "web"],
      status: probe.unityInstalled ? "available" : "not-installed",
      requires: ["Unity Editor + licence", "Unity Hub", "per-platform build modules"],
      detail:
        "Unity's editor is not installed and cannot be driven headlessly here; it also requires a licensed " +
        "editor install per machine. Recommending it would produce a project this studio cannot build.",
      preview: "editor",
    },
    {
      id: "unreal",
      label: "Unreal Engine 5",
      dimensions: ["3d"],
      targets: ["desktop", "mobile"],
      status: probe.unrealInstalled ? "available" : "not-installed",
      requires: ["Unreal Editor + licence", "C++ toolchain", "a GPU workstation for baking"],
      detail:
        "The Unreal editor and toolchain are not present in this runtime. It is the right fit for photoreal, " +
        "large-team titles with a workstation budget — not for a headless studio that has to build and preview now.",
      preview: "editor",
    },
  ];
}

function isNativeTarget(targets: StudioRequirements["targets"]): boolean {
  return targets.some((target) => target === "desktop" || target === "mobile");
}

/**
 * The decision, with its reasoning attached. Every rejected engine carries
 * the real reason it was rejected, so the choice can be reviewed rather
 * than trusted.
 */
export function recommendEngine(
  requirements: StudioRequirements,
  probe: EngineProbe = DEFAULT_ENGINE_PROBE,
): EngineRecommendation {
  const capabilities = engineCapabilities(probe);
  const byId = (id: StudioEngineId): EngineCapability =>
    capabilities.find((capability) => capability.id === id) as EngineCapability;

  if (requirements.kind === "website") {
    const web = byId("web");
    return {
      engine: "web",
      label: web.label,
      supported: web.status === "available",
      confidence: "high",
      stack: "HTML + CSS + modern JavaScript, static build, responsive and accessible",
      rationale: [
        "A website needs no game engine: the deliverable is documents, styles and browser JavaScript.",
        "Static output is buildable and previewable in this runtime without an editor install.",
        "Forms, navigation, dashboards and APIs are all reachable from the same stack and the existing backend runtime.",
      ],
      alternatives: [
        {
          engine: "godot",
          label: "Godot",
          why: "Only if the site is really a 2D interactive experience with its own render loop.",
        },
      ],
      rejected: ["godot", "unity", "unreal"].map((engine) => {
        const capability = byId(engine as StudioEngineId);
        return {
          engine: capability.id,
          label: capability.label,
          reason:
            engine === "godot"
              ? "Adds an editor and an export step to a document deliverable, with no benefit to navigation or forms."
              : `${capability.label} is a game editor; using it for a website adds a build toolchain the runtime does not have.`,
        };
      }),
    };
  }

  if (requirements.kind === "application") {
    const web = byId("web");
    return {
      engine: "web",
      label: web.label,
      supported: web.status === "available",
      confidence: "high",
      stack: "Web application + Node HTTP backend, JSON/file persistence, PWA and Capacitor for installed targets",
      rationale: [
        "The application has to connect to a real backend; the existing Node/Deno runtime already serves APIs next to the app.",
        "Progressive web app and installed mobile/desktop builds are supported by the existing Capacitor shell.",
        "A game engine would not give the forms, routing, API and database integration an application needs.",
      ],
      alternatives: [
        {
          engine: "godot",
          label: "Godot",
          why: "Only for an application whose core is a real-time 2D/3D simulation.",
        },
      ],
      rejected: (["godot", "unity", "unreal"] as StudioEngineId[]).map((engine) => ({
        engine,
        label: byId(engine).label,
        reason:
          "Wrong tool for a data-and-interface application: no benefit for forms, routing, APIs or persistence, " +
          "and the editor is not available on this runtime.",
      })),
    };
  }

  /* Games: the decision depends on dimension, targets and realism. */
  const dimension = requirements.dimension ?? "3d";
  const native = isNativeTarget(requirements.targets);
  const photoreal = requirements.photoreal === true;
  const largeTeam = (requirements.teamSize ?? 1) >= 8;
  let engine: StudioEngineId = "web";
  const rationale: string[] = [];
  const rejected: EngineRecommendation["rejected"] = [];

  if (photoreal && largeTeam && native && requirements.targets.includes("desktop")) {
    engine = "unreal";
    rationale.push(
      "Photoreal rendering, a large team and native desktop delivery are Unreal's own use case.",
    );
    rationale.push(
      "It is the recommendation on requirements, but NOT on this runtime: the editor is absent, so the project " +
        "cannot be built or previewed here until one is installed.",
    );
  } else if (native && (requirements.multiplayer || dimension === "2d" || !requirements.targets.includes("web"))) {
    engine = "godot";
    rationale.push(
      native
        ? "Native desktop/mobile delivery with a small team is what Godot exports well, and it is free of per-seat editor cost."
        : "Godot fits the requested runtime.",
    );
    rationale.push(
      requirements.multiplayer
        ? "Godot's high-level multiplayer API covers the requested multiplayer requirement."
        : "Godot covers 2D and 3D without a second toolchain.",
    );
  } else {
    engine = "web";
    rationale.push(
      dimension === "3d"
        ? "A 3D game that must run in the browser is built on three.js/WebGL: the same output the Cosmos preview runs."
        : "A 2D browser game is built on canvas/WebGL with no editor install.",
    );
    rationale.push(
      "Static build output means LÉLU can build, test and preview the game herself in an isolated studio project.",
    );
  }

  const chosen = byId(engine);
  for (const capability of capabilities) {
    if (capability.id === engine) continue;
    let reason: string;
    if (capability.status !== "available") {
      reason = `${capability.detail}`;
    } else if (capability.id === "web" && engine !== "web") {
      reason = "Web output is still produced as a preview/companion channel unless native-only is required.";
    } else {
      reason = "Does not match the measured requirements (dimension, targets, team size or realism).";
    }
    rejected.push({ engine: capability.id, label: capability.label, reason });
  }

  return {
    engine,
    label: chosen.label,
    supported: chosen.status === "available",
    confidence:
      engine === "web" ? "high" : requirements.teamSize || requirements.photoreal ? "medium" : "low",
    stack:
      engine === "web"
        ? dimension === "3d"
          ? "three.js + WebGL, static build, keyboard/touch controls, pure-logic test suite"
          : "Canvas/WebGL 2D, static build, pure-logic test suite"
        : `${chosen.label} project + export templates; not buildable on this runtime`,
    rationale,
    alternatives:
      engine === "web"
        ? [
            {
              engine: "godot",
              label: "Godot",
              why: "Choose it when the game must ship as a native desktop/mobile binary and a Godot editor is installed.",
            },
          ]
        : [
            {
              engine: "web",
              label: "Web technologies",
              why: "The only engine this runtime can build and preview today; it also gives an instant browser demo.",
            },
          ],
    rejected,
  };
}
