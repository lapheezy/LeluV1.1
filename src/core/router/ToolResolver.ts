/**
 * ==========================================================
 * LÉLU
 * TOOL RESOLVER — the controlled bridge into device capabilities
 *
 * A stage in the EXISTING router chain (after Reasoning, before
 * Engineering). When the user asks LÉLU to use a device
 * capability ("take a photo", "record a note", "share this",
 * "check my storage", "what can you do on this iPhone?"), this
 * stage:
 *
 *   1. detects the intent (curated, conservative patterns),
 *   2. runs the REAL capability through NativeCapabilityRegistry
 *      (availability + permission gating),
 *   3. emits the same AgentEventBus tool events the workspace
 *      and visual layers already render,
 *   4. attaches the real result to RouterContext.native and
 *      appends "## Device State" to the request context so the
 *      EXISTING provider/cognition chain reasons over real
 *      device facts — never a guess,
 *   5. returns unhandled so the provider still answers
 *      conversationally (workspace + response run together).
 *
 * Pure device-status questions ("what can you do on this
 * device?") are answered deterministically from the real
 * capability snapshot, provider "device" — same offline-safe
 * pattern as BrainResolver identity answers.
 *
 * No fake capabilities: a capability that iOS does not expose
 * returns unavailable with a reason, and the provider explains
 * it instead of hallucinating device control.
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import type { AIResponse } from "../../providers/AIProvider";
import AgentEventBus from "../agent/AgentEvents";
import { NativeCapabilityRegistry } from "../native";
import { isIdentityOrProfileQuestion } from "../../brain/LeluIdentity";

interface DeviceCommand {
  kind: "status" | "invoke";
  capability: string;
  payload: Record<string, unknown>;
  label: string;
}

const STATUS_PATTERNS = [
  /(what (can|does) (you|your) (do|have|know)|what are you capable of)\b.*(device|iphone|phone|ios|capabilit)/i,
  /device (capabilit|status|info|overview)/i,
  /(check|show|list|see) (your|the) (device )?capabilit/i,
  /(what|which) (capabilities|things) (does this device|can this device|are available)/i,
  /how (much|many).*(storage|space|memory) (do|left)/i,
];

const INVOKE_PATTERNS: Array<{ pattern: RegExp; capability: string; payload: (prompt: string) => Record<string, unknown>; label: string }> = [
  {
    pattern: /(take|capture|snap|use (the |your )?camera)/i,
    capability: "camera.capture",
    payload: () => ({ facingMode: "environment" }),
    label: "camera capture",
  },
  {
    pattern: /(use (the |your )?front camera|take a selfie)/i,
    capability: "camera.capture",
    payload: () => ({ facingMode: "user" }),
    label: "front camera capture",
  },
  {
    pattern: /(record|take|make) (a |an )?(voice )?note|record audio|record (a )?message/i,
    capability: "microphone.capture",
    payload: () => ({ recordMs: 5000, transcribe: true }),
    label: "voice note recording",
  },
  {
    pattern: /(speak|say|read) (this|that|the (following|text)|aloud|out loud)/i,
    capability: "tts.speak",
    payload: (prompt) => ({
      text: prompt
        .replace(/^(lelu|lélu)[,\s]+/i, "")
        .replace(/(speak|say|read) (this|that|the (following|text)|aloud|out loud)/i, "")
        .trim(),
    }),
    label: "text-to-speech",
  },
  {
    pattern: /(share|open the share sheet)/i,
    capability: "share.sheet",
    payload: (prompt) => ({
      title: "LÉLU",
      text: prompt,
      url: typeof window !== "undefined" ? window.location.href : "",
    }),
    label: "share sheet",
  },
  {
    pattern: /copy (this|that|the (following )?text|to (the )?clipboard)/i,
    capability: "clipboard.write",
    payload: (prompt) => ({
      text: prompt.replace(/(copy|to (the )?clipboard|please|lelu|lélu)[,\s]+/gi, "").trim(),
    }),
    label: "clipboard write",
  },
  {
    pattern: /(read|paste) (the )?clipboard|what('s| is) (on|in) (my |the )?clipboard/i,
    capability: "clipboard.write",
    payload: () => ({ action: "read" }),
    label: "clipboard read",
  },
  {
    pattern: /(notify|remind|alert) me/i,
    capability: "notifications.send",
    payload: (prompt) => ({
      title: "LÉLU reminder",
      body: prompt.replace(/(notify|remind|alert) me[,\s]+/i, "").trim() || "You asked me to remind you.",
    }),
    label: "notification",
  },
  {
    pattern: /(check|how (much|many)) (my )?storage|storage (left|usage|space)/i,
    capability: "storage.estimate",
    payload: () => ({}),
    label: "storage estimate",
  },
  {
    pattern: /are you (online|offline)|check (your )?(network|connection|internet)/i,
    capability: "network.state",
    payload: () => ({}),
    label: "network check",
  },
  {
    pattern: /(which|what) (device|iphone|phone) (am i using|is this)|device info|tell me about (my |this )?device/i,
    capability: "device.info",
    payload: () => ({}),
    label: "device info",
  },
  {
    pattern: /(vibrate|haptic)/i,
    capability: "haptics.vibrate",
    payload: () => ({}),
    label: "haptics",
  },
];

function parseDeviceCommand(prompt: string): DeviceCommand | null {
  const text = prompt.trim();

  if (STATUS_PATTERNS.some((pattern) => pattern.test(text))) {
    return { kind: "status", capability: "device.status", payload: {}, label: "device capability status" };
  }

  for (const entry of INVOKE_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        kind: "invoke",
        capability: entry.capability,
        payload: entry.payload(prompt),
        label: entry.label,
      };
    }
  }

  return null;
}

export default class ToolResolver {
  private readonly registry = NativeCapabilityRegistry.getInstance();

  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt;
    const command = parseDeviceCommand(prompt);

    if (!command) {
      return { handled: false };
    }

    // Identity/profile questions are answered locally first (never
    // routed into device tools).
    if (isIdentityOrProfileQuestion(prompt)) {
      return { handled: false };
    }

    const events = AgentEventBus.getInstance();
    const taskId = String(context.request.timestamp ?? Date.now());

    events.emit({ type: "tool_selected", taskId, tool: "device", label: command.label });
    events.emit({ type: "tool_started", taskId, tool: "device", label: command.label });

    if (command.kind === "status") {
      const statuses = await this.registry.snapshot();
      context.native = { connected: false, statuses };

      const response = this.deviceReport(context, statuses);
      events.emit({
        type: "tool_result",
        taskId,
        tool: "device",
        result: `${statuses.filter((status) => status.available).length} of ${statuses.length} capabilities available`,
      });

      return { handled: true, response };
    }

    const result = await this.registry.invoke(command.capability, command.payload);

    const statuses = await this.registry.snapshot();
    context.native = { connected: false, statuses, lastResult: { capability: command.capability, result } };

    // Attach the REAL device result so the provider reasons over
    // facts, never over claims.
    const deviceSection = this.formatDeviceSection(command, result);
    context.request.context = [context.request.context, `## Device Action\n${deviceSection}`]
      .filter((value) => Boolean(value && value.trim().length > 0))
      .join("\n\n");

    events.emit({
      type: "tool_result",
      taskId,
      tool: "device",
      result: result.ok
        ? `${command.label} completed`
        : `${command.label} failed: ${result.error ?? "unknown error"}`,
    });

    // The provider chain reasons over the result — unhandled keeps
    // the response conversational.
    return { handled: false };
  }

  private formatDeviceSection(
    command: DeviceCommand,
    result: { ok: boolean; result?: unknown; error?: string },
  ): string {
    const summary = result.ok
      ? `- Action: ${command.label}\n- Status: completed`
      : `- Action: ${command.label}\n- Status: failed\n- Reason: ${result.error ?? "unknown"}`;
    const details = result.ok && result.result
      ? `- Result: ${this.compact(JSON.stringify(result.result))}`
      : "";
    return `${summary}${details ? `\n${details}` : ""}`;
  }

  private compact(value: string): string {
    return value.length > 600 ? `${value.slice(0, 599)}…` : value;
  }

  private deviceReport(context: RouterContext, statuses: Awaited<ReturnType<NativeCapabilityRegistry["snapshot"]>>): AIResponse {
    const available = statuses.filter((status) => status.available);
    const permissionNeeded = statuses.filter(
      (status) => status.available && status.requiredPermission && status.permissionState !== "authorized",
    );
    const unavailable = statuses.filter((status) => !status.available);

    const lines = available.map(
      (status) =>
        `- ${status.title}: available${status.requiredPermission && status.permissionState !== "authorized" ? ` (permission: ${status.permissionState})` : ""}`,
    );
    const permissionLines = permissionNeeded.map(
      (status) => `- ${status.title}: permission ${status.permissionState} — ask me to use it and I'll request access`,
    );
    const unavailableLines = unavailable.map(
      (status) => `- ${status.title}: NOT available — ${status.reason ?? "unsupported on this device"}`,
    );

    const text = [
      `Here is my real device capability report (${available.length} available, ${unavailable.length} not available to a web app):`,
      "",
      "## Available now",
      ...(lines.length > 0 ? lines : ["- (none)"]),
      "",
      "## Need permission",
      ...(permissionLines.length > 0 ? permissionLines : ["- none pending"]),
      "",
      "## Not available to this web app",
      ...(unavailableLines.length > 0 ? unavailableLines : ["- none"]),
      "",
      "Everything above is detected live from this device — I never claim a capability the platform doesn't expose.",
    ].join("\n");

    return {
      text,
      provider: "device",
      model: "capability-report",
      processingTime: Date.now() - context.started,
      metadata: {
        source: "ToolResolver",
        device: true,
        statuses: statuses.map((status) => ({
          id: status.id,
          available: status.available,
          permissionState: status.permissionState,
        })),
      },
    };
  }
}
