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

import { useEffect } from "react";
import AIService from "../../../core/AIService";
import ProactiveCore from "../../../core/proactive/ProactiveCore";
import PersistentRuntime from "../../../core/proactive/PersistentRuntime";
import UIStateStore from "../../../core/cognition/UIStateStore";
import PersistenceStateStore from "../../../core/persistence/PersistenceState";
import { useGenesis } from "./GenesisCore";
import BriefingStore from "../../../core/proactive/BriefingStore";

const ai = AIService.getInstance();
const proactive = ProactiveCore.getInstance();

export default function ProactiveBridge() {
  const { notify } = useGenesis();


  useEffect(() => {
    return proactive.subscribeQuestions((question) => {
      UIStateStore.getInstance().update({ activeQuestion: question });
    });
  }, []);

  /**
   * SESSION LIFECYCLE ONLY.
   *
   * This effect used to build a briefing from a string template and
   * write it into the active conversation as an assistant ChatMessage,
   * on mount — so the trigger was "a React component rendered", not
   * anything that had happened, and the result was indistinguishable
   * from a reply: permanent in the transcript, undismissable, with no
   * read state, landing on top of whatever the user had just asked.
   *
   * Briefings are now their own entity (core/proactive/BriefingStore)
   * created from real transitions in the autonomous runtime — work
   * finishing, work stopping — and shown in the Briefings panel and the
   * notification centre. Nothing is generated because the app opened.
   *
   * The session bookkeeping below is kept: ProactiveCore uses it for
   * routine detection and continuity, and it was never the problem.
   */
  useEffect(() => {
    (async () => {
      try {
        await ai.initialize();
      } catch {
        // AIService already guards its own init; nothing to do here.
      }
      proactive.beginSession();
    })();

    return () => {
      proactive.endSession();
    };
  }, []);

  /**
   * A new briefing shows transiently, then lives in the Briefings panel.
   *
   * This is the existing notification centre — the same `notify()` every
   * other transient surface uses — rather than a second one. The toast
   * is the "something happened" and the panel is the record; neither is
   * a chat message, which is what a briefing used to be.
   *
   * Only briefings created AFTER this mounted are announced. Replaying
   * history as toasts on every boot is how the old session briefing
   * behaved, and it is the thing being removed.
   */
  useEffect(() => {
    const store = BriefingStore.getInstance();
    const seen = new Set(store.list().map((briefing) => briefing.id));
    return store.subscribe((briefings) => {
      for (const briefing of briefings) {
        if (seen.has(briefing.id)) continue;
        seen.add(briefing.id);
        if (briefing.dismissedAt || briefing.readAt) continue;
        notify(briefing.title, briefing.summary);
      }
    });
    // `notify` is stable for the lifetime of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /* Persistence state is INFRASTRUCTURE, so it is followed from the
     runtime rather than from the settings panel that used to be its only
     home. Nothing here opens a connection or holds a client —
     SupabasePersistence stays the single Supabase client; this republishes
     what it already knows so any surface can show it. */
  useEffect(() => {
    PersistenceStateStore.getInstance().attach();
  }, []);

  return null;
}
