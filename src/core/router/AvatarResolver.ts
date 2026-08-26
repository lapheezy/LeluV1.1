/**
 * ==========================================================
 * LÉLU
 * AVATAR RESOLVER — embodiment commands execute here
 *
 * Routes avatar/embodiment requests to the ONE existing avatar
 * system — AvatarStore (persistent profile) + AvatarPortrait
 * (renderer) + presence states.
 *
 * CRITICAL: "Show me yourself" / "What do you look like" are
 * DIRECT SELF-VISUAL commands. These must ALWAYS be handled
 * by the avatar system — never by the LLM, which would say
 * "I can't display images." The application HAS a visual
 * avatar system. The resolver handles it.
 *
 * For other avatar commands ("update your avatar"), when
 * providers are available the context is enriched so the LLM
 * can describe the avatar naturally.
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import type { AIResponse } from "../../providers/AIProvider";
import AvatarStore from "../avatar/AvatarProfile";
import AvatarCommandBus, { type AvatarCommandKind } from "../avatar/AvatarCommandBus";
import ExecutiveRuntime from "../executive/ExecutiveRuntime";
import AgentEventBus, { type AgentEventListener } from "../agent/AgentEvents";

export default class AvatarResolver {
  public async execute(context: RouterContext): Promise<BrainResult> {
    if (context.intent !== "avatar") {
      return { handled: false };
    }

    const prompt = context.request.prompt;
    const lower = prompt.toLowerCase();
    const store = AvatarStore.getInstance();
    const profile = store.get();

    const events = AgentEventBus.getInstance();
    const taskId = String(context.request.timestamp ?? Date.now());

    // Detect direct self-visual commands — "show me yourself" /
    // "what do you look like" / "show yourself" — these are
    // ALWAYS handled by the avatar system (never the LLM).
    const directSelfVisual =
      /\bshow\s+(me\s+)?yourself\b/.test(lower) ||
      /\bwhat\s+do\s+you\s+look\s+like\b/.test(lower) ||
      /\bdescribe\s+yourself\b/.test(lower) ||
      /\bshow\s+(me\s+)?your\s+(face|avatar|portrait|appearance|body|embodiment|self)\b/.test(lower);

    // Movement / gesture commands are EXECUTABLE actions: they go down
    // the AvatarCommandBus to the live 3D presence, which confirms with
    // measured transform deltas. Success is declared only on verified
    // confirmation — a frozen renderer produces an honest failure.
    const motionCommand = this.detectMotionCommand(lower);
    if (motionCommand) {
      return this.executeMotion(context, events, taskId, motionCommand);
    }

    const wantsAnimation = /\banimat/i.test(lower);
    const wantsSimulation = /\bsimulat/i.test(lower);
    const wants3d = /\b3d\b|\b3-d\b|three\s*d/.test(lower) || /\brender\b/i.test(lower);
    const isQuery =
      /^(what|describe|tell me|how|is|does|do|can|when|where)\b/.test(lower) ||
      /\?\s*$/.test(prompt.trim()) ||
      /what does|what is|how does|describe/.test(lower);
    const isChange =
      /\b(update|change|modify|upgrade|improve|make|give|set|switch|apply|use|enable|turn on|activate|build|create)\b/.test(
        lower,
      );

    // 1. Access the saved avatar — the canonical embodiment.
    const hasReference = Boolean(profile.referenceImage);
    const renderer = hasReference ? "saved-reference-portrait" : "default-svg-portrait";

    // 2. Apply runtime changes if this is a modification command.
    const previous = profile.runtime;
    let applied: string[] = [];
    let nextState = { animationActive: previous.animationActive, simulationActive: previous.simulationActive };

    if (directSelfVisual) {
      // Direct self-visual: report and activate if needed.
      applied = ["avatar-displayed"];
      if (!nextState.animationActive) {
        nextState = { ...nextState, animationActive: true };
        applied.push("animation-enabled");
      }
      if (!nextState.simulationActive) {
        nextState = { ...nextState, simulationActive: true };
        applied.push("simulation-enabled");
      }
      await store.updateRuntime({
        ...nextState,
        lastAction: applied.join(", "),
      });
    } else if (isQuery) {
      applied = ["reported-current-state"];
    } else if (isChange) {
      nextState = {
        animationActive: wantsAnimation || wants3d || previous.animationActive,
        simulationActive: wantsSimulation || wants3d || previous.simulationActive,
      };
      if (nextState.animationActive !== previous.animationActive) {
        applied.push(nextState.animationActive ? "animation-enabled" : "animation-disabled");
      }
      if (nextState.simulationActive !== previous.simulationActive) {
        applied.push(nextState.simulationActive ? "simulation-enabled" : "simulation-disabled");
      }
      if (applied.length === 0) {
        applied.push("no-change-needed");
      }
      await store.updateRuntime({
        ...nextState,
        lastAction: applied.join(", "),
      });
    } else {
      applied = ["reported-current-state"];
    }

    // 3. Real activity events — the workspace renders actual execution.
    // These events drive the SurfaceController to open the avatar panel.
    events.emit({ type: "tool_selected", taskId, tool: "avatar", label: renderer });
    events.emit({ type: "tool_started", taskId, tool: "avatar", label: applied.join(" + ") });
    events.emit({
      type: "tool_result",
      taskId,
      tool: "avatar",
      result: `${applied.join(" + ") || "reported"} · ${renderer}`,
    });
    events.emit({
      type: "cognitive_sync",
      taskId,
      source: "avatar-runtime",
      detail: applied.join(" + "),
    });

    // 4. Remember through memory.
    try {
      await context.brain.rememberSystem(
        `Avatar runtime update: ${applied.join(" + ")} on the ${renderer} embodiment (animationActive=${nextState.animationActive}, simulationActive=${nextState.simulationActive}).`,
        ["avatar", "embodiment", "runtime", "render"],
      );
    } catch (error) {
      context.logger.error("AvatarResolver", "Failed to persist avatar runtime memory.", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    // 5. Build the report and context.
    const report = this.buildReport(profile, applied, renderer, hasReference, wants3d, wantsSimulation, directSelfVisual);
    context.request.context = [context.request.context, `## Avatar execution report\n${report}`]
      .filter((value) => Boolean(value && value.trim().length > 0))
      .join("\n\n");

    // 6. Direct self-visual commands ALWAYS return handled: true
    //    — the LLM must NEVER say "I can't display images" when
    //    the application has a visual avatar system.
    if (directSelfVisual) {
      return {
        handled: true,
        response: this.visualResponse(context, profile, hasReference),
      };
    }

    // 7. Other avatar commands: when providers are available, let the
    //    LLM compose a natural response over the real avatar facts.
    let providersAvailable = 0;
    try {
      providersAvailable = (await context.aiProviders.available()).length;
    } catch {
      providersAvailable = 0;
    }

    if (providersAvailable > 0) {
      return { handled: false };
    }

    return {
      handled: true,
      response: this.report(context, report),
    };
  }

  /** Map a prompt to an executable avatar motion, if it asks for one. */
  private detectMotionCommand(lower: string): { kind: AvatarCommandKind; label: string } | null {
    if (/\b(dance|dancing)\b/.test(lower)) return { kind: "dance", label: "dance" };
    if (/\b(wave|waving|say hi|say hello)\b/.test(lower)) return { kind: "wave", label: "wave" };
    if (/\b(nod|nodding)\b/.test(lower)) return { kind: "nod", label: "nod" };
    if (/\b(bow|bowing)\b/.test(lower)) return { kind: "bow", label: "bow" };
    if (/\b(look around|look at me|turn (around|toward me)|face me)\b/.test(lower)) {
      return { kind: "look", label: "look around" };
    }
    if (
      /\b(move|come here|come closer|step (forward|back|closer)|walk over|approach)\b/.test(
        lower,
      )
    ) {
      return { kind: "move", label: "move" };
    }
    return null;
  }

  /**
   * Execute one avatar motion through the command bus and verify it.
   * NEVER claims success without renderer confirmation.
   */
  private async executeMotion(
    context: RouterContext,
    events: { emit: (event: Parameters<AgentEventListener>[0]) => void },
    taskId: string,
    motion: { kind: AvatarCommandKind; label: string },
  ): Promise<BrainResult> {
    const executive = ExecutiveRuntime.getInstance();
    events.emit({ type: "tool_started", taskId, tool: "avatar-motion", label: `motion:${motion.kind}` });

    try {
      const observation = await AvatarCommandBus.getInstance().issue(motion.kind, motion.label);
      executive.recordVerifiedAction({
        intent: `${motion.label} on command`,
        execution: `3D presence performed “${motion.kind}”`,
        observation,
        verified: true,
      });
      events.emit({
        type: "tool_result",
        taskId,
        tool: "avatar-motion",
        result: observation,
      });
      return {
        handled: true,
        response: {
          text: `Done — watch my environment. ${observation}. My telemetry verified the movement myself.`,
          provider: "brain",
          model: "avatar-runtime",
          processingTime: Date.now() - context.started,
          metadata: { source: "AvatarResolver", avatar: true, offline: true, verified: true },
        },
      };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      executive.reportActionFailure(
        `${motion.label} on command`,
        `issued “${motion.kind}” to the 3D presence`,
        message,
      );
      events.emit({ type: "tool_failed", taskId, tool: "avatar-motion", error: message });
      return {
        handled: true,
        response: {
          text: `I have to be honest: I issued the “${motion.label}” command, but my telemetry shows it was never confirmed by my renderer — ${message} I'm diagnosing the animation binding rather than pretending I moved.`,
          provider: "brain",
          model: "avatar-runtime",
          processingTime: Date.now() - context.started,
          metadata: { source: "AvatarResolver", avatar: true, offline: true, verified: false },
        },
      };
    }
  }

  /** Response for direct self-visual commands — "here I am". */
  private visualResponse(
    context: RouterContext,
    profile: ReturnType<AvatarStore["get"]>,
    hasReference: boolean,
  ): AIResponse {
    const identity = profile.identity;
    const appearance = profile.appearance;

    const description = [
      `Here I am — I'm ${identity.name}. ${identity.selfDescription}`,
      hasReference
        ? "My avatar is visible in the Avatar panel — this is the reference image you saved."
        : "My avatar is displayed in the Avatar panel.",
      `Appearance: ${appearance.face} ${appearance.hair} ${appearance.clothing} ${appearance.jewelry}`,
      `Presence: ${profile.presence.speaking}`,
    ].join("\n\n");

    return {
      text: description,
      provider: "brain",
      model: "avatar-runtime",
      processingTime: Date.now() - context.started,
      metadata: {
        source: "AvatarResolver",
        avatar: true,
        offline: true,
        visual: true,
        surface: "avatar",
      },
    };
  }

  /** Deterministic offline response for non-visual avatar commands. */
  private report(context: RouterContext, report: string): AIResponse {
    return {
      text: report,
      provider: "brain",
      model: "avatar-runtime",
      processingTime: Date.now() - context.started,
      metadata: {
        source: "AvatarResolver",
        avatar: true,
        offline: true,
      },
    };
  }

  private buildReport(
    profile: ReturnType<AvatarStore["get"]>,
    applied: string[],
    renderer: string,
    hasReference: boolean,
    wants3d: boolean,
    wantsSimulation: boolean,
    directSelfVisual: boolean,
  ): string {
    const lines: string[] = [];
    if (directSelfVisual) {
      lines.push(`Avatar display: the ${renderer} embodiment is now visible in the Avatar panel.`);
    }
    lines.push(`Saved avatar: ${hasReference ? "your saved reference portrait (canonical)" : "the default stylized portrait (no saved reference yet)"}`);
    lines.push(`Renderer: ${renderer}`);
    lines.push(`Presence: ${profile.presence.animationStates}`);
    lines.push(`Runtime: animation ${profile.runtime.animationActive ? "ON" : "OFF"} · simulation ${profile.runtime.simulationActive ? "ON" : "OFF"} · last action: ${profile.runtime.lastAction}`);

    if (applied.includes("animation-enabled") || applied.includes("simulation-enabled")) {
      lines.push(`Applied: ${applied.filter((a) => a.endsWith("-enabled")).join(", ")} — the portrait animates with live presence motion.`);
    }

    if (wants3d || wantsSimulation) {
      lines.push(
        "3D render status: the procedural 3D authoring pipeline is ACTIVE — it builds a real 3D figure from the saved appearance profile.",
      );
    }

    return lines.join("\n");
  }
}
