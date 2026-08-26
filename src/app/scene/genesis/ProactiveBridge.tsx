/**
 * ==========================================================
 * LÉLUVERSE
 * PROACTIVE BRIDGE
 *
 * Bridges the existing AI/memory/project architecture to the
 * ProactiveCore orchestrator, and presents the result through the
 * SAME Genesis state every other bridge uses. It does not create a
 * second brain, a second memory, or a parallel chat path.
 *
 *   AIService (memories) ┐
 *   ProjectStore          ├─→ ProactiveCore.buildBriefing ─→ Genesis state
 *   AvatarStore (name)    ┘        (pattern/priority/feedback)
 *   location/world context         (set by PlanetExplorer)
 *
 * A briefing is presented exactly once per boot, only when the user
 * has enabled it and only when it contains real, traceable content.
 * ==========================================================
 */

import { useEffect, useRef } from "react";
import { useGenesis } from "./GenesisCore";
import AIService from "../../../core/AIService";
import ProactiveCore from "../../../core/proactive/ProactiveCore";
import PersistentRuntime from "../../../core/proactive/PersistentRuntime";
import ProjectStore from "../../../core/projects/ProjectStore";
import AvatarStore from "../../../core/avatar/AvatarProfile";
import UIStateStore from "../../../core/cognition/UIStateStore";

const ai = AIService.getInstance();
const proactive = ProactiveCore.getInstance();

/** Collapse a briefing into a compact, readable assistant message. */
function formatBriefing(briefing: ReturnType<ProactiveCore["buildBriefing"]>): string {
  const lines: string[] = [briefing.greeting];
  for (const section of briefing.sections) {
    lines.push("");
    lines.push(`· ${section.title}`);
    for (const item of section.items) {
      lines.push(`  ${item.text}`);
    }
  }
  return lines.join("\n");
}

export default function ProactiveBridge() {
  const { addMessage, notify } = useGenesis();
  const presentedRef = useRef(false);

  useEffect(() => {
    return proactive.subscribeQuestions((question) => {
      UIStateStore.getInstance().update({ activeQuestion: question });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await ai.initialize();
      } catch {
        // AIService already guards its own init; nothing to do here.
      }

      // Each boot begins a fresh, un-briefed session while preserving
      // the previous session's continuity snapshot.
      proactive.beginSession();

      const settings = proactive.getSettings();

      // Proactive mode is opt-in and defaults OFF, per the "user
      // controlled" rule — nothing is presented until enabled.
      if (!settings.enabled || !settings.sessionBriefing || settings.notificationLevel === "quiet") {
        return;
      }

      // Only one briefing per boot.
      if (proactive.isBriefed() || presentedRef.current) {
        return;
      }

      const memories = await ai.getMemories(400);
      const projects = ProjectStore.getInstance().list();
      const name = AvatarStore.getInstance().get().identity.name;

      const briefing = proactive.buildBriefing({
        memories,
        projects: projects.map((project) => ({
          name: project.name,
          description: project.description,
          status: project.status,
          itemCount: project.items.length,
          updatedAt: project.updatedAt,
        })),
        userName: name && name !== "Lélu" ? name : undefined,
        locationName: proactive.getLocation() || undefined,
        planetaryContext: proactive.getPlanetaryContext() || undefined,
        lastTopic: proactive.getLastTopic() || undefined,
      });

      // Silence is preferable to filler: no content, no message.
      if (briefing.isEmpty || cancelled) {
        proactive.markBriefed();
        return;
      }

      presentedRef.current = true;
      proactive.markBriefed();

      const text = formatBriefing(briefing);
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        text,
        timestamp: Date.now(),
        source: "local",
      });

      notify("Lélu briefing", briefing.sections[0]?.items[0]?.text ?? "You have a few updates.");

      // Traceable record of why LÉLU initiated this.
      proactive.logEvent({
        trigger: "session_open",
        source: "session_briefing",
        priority: briefing.sections[0]?.items[0]?.priority ?? 5,
        confidence: 0.9,
        presented: briefing.sections[0]?.items[0]?.text ?? text.slice(0, 120),
      });
    })();

    return () => {
      cancelled = true;
      proactive.endSession();
    };
  }, [addMessage, notify]);

  useEffect(() => {
    function handleBeforeUnload() {
      proactive.endSession();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  /* Persistent autonomous runtime — the foreground event loop that feeds
     project changes / agent completions / routines through ProactiveCore
     and NotificationProvider. Starts once for the lifetime of the scene. */
  useEffect(() => {
    const runtime = PersistentRuntime.getInstance();
    runtime.start();
    return () => runtime.stop();
  }, []);

  return null;
}
