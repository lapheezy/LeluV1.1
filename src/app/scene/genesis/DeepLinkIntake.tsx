/**
 * ==========================================================
 * LÉLUVERSE
 * DEEP LINK INTAKE
 *
 * Reads the app's own URL for an in-app intent (?ask=… or
 * #ask=… — the URL equivalent of "Siri, ask LÉLU …"), then
 * feeds the prompt into the SAME path every other chat entry
 * uses: addMessage (user) → AIService.chat() → bridge → LÉLU.
 *
 * No new chat system. The intent lands in the existing
 * conversation, memory and cognition pipeline.
 *
 * This is the web-side half of the deeplink.intake capability;
 * registering a custom scheme remains native-only (reported as
 * such in the Device panel).
 * ==========================================================
 */

import { useEffect, useRef } from "react";
import { useGenesis } from "./GenesisCore";
import AIService from "../../../core/AIService";
import { extractDeepLinkPrompt } from "../../../core/native/capabilities/deeplinks";

const ai = AIService.getInstance();

export default function DeepLinkIntake() {
  const { openPanel, addMessage, notify } = useGenesis();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) {
      return;
    }
    const prompt = extractDeepLinkPrompt();
    if (!prompt) {
      return;
    }
    handledRef.current = true;

    // Clean the intent out of the URL so a reload doesn't re-fire it.
    const url = new URL(window.location.href);
    url.searchParams.delete("ask");
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);

    // Route into the existing pipeline: user message → LÉLU.
    openPanel("chat");
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      text: prompt,
      timestamp: Date.now(),
      source: "local",
    });
    notify("Deep link received", prompt.slice(0, 80) + (prompt.length > 80 ? "…" : ""));
    void ai.chat(prompt).catch((error) => {
      console.error("[DeepLinkIntake] chat failed", error);
      notify("Deep link failed", error instanceof Error ? error.message : String(error));
    });
  }, [addMessage, notify, openPanel]);

  return null;
}
