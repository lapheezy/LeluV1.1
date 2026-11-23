/**
 * ==========================================================
 * LÉLU — CHANGING CLOTHES ON HER OWN
 *
 * Installs the one OutfitDirector on the real wardrobe (ForgeClient → Forge
 * /dress) and, every few minutes, lets her choose a look for the moment:
 * the hour, where she is (AvatarCommandBus place) and what she is doing.
 * Every self-made change is announced on the AgentEventBus with its reason,
 * so the conversation and her context both see it.
 *
 * Off with localStorage "lelu.outfit.autopilot" = "off". A look a person asked
 * for is kept for two hours (OutfitDirector.respectRequestMs).
 * ==========================================================
 */
import ForgeClient from "../forge/ForgeClient";
import AgentEventBus from "../agent/AgentEvents";
import AvatarCommandBus from "./AvatarCommandBus";
import OutfitDirector, { type OccasionSignals } from "./OutfitDirector";
import { lookName } from "./outfitCommand";

let timer: ReturnType<typeof setInterval> | null = null;
let activity: string | null = null;

/** Other parts of her runtime say what she is doing ("presenting", "building", "resting"…). */
export function setOutfitActivity(next: string | null): void {
  activity = next;
}

export function currentOccasion(): OccasionSignals {
  const place = AvatarCommandBus.getInstance().current?.target?.place ?? null;
  return { hour: new Date().getHours(), place, activity };
}

export async function outfitTick(): Promise<string> {
  const director = OutfitDirector.get();
  if (!director) return "no wardrobe director";
  const { changed, why } = await director.tick(currentOccasion());
  if (changed) {
    AgentEventBus.getInstance().emit({
      type: "tool_result",
      taskId: `outfit-${changed.at}`,
      tool: "forge.dress",
      result: `I changed into the ${changed.to ? lookName(changed.to) : "base look"} myself — ${why}`,
    });
  }
  return why;
}

export function startOutfitAutopilot(intervalMs = 5 * 60 * 1000): void {
  OutfitDirector.install(ForgeClient);
  const off = typeof localStorage !== "undefined" && localStorage.getItem("lelu.outfit.autopilot") === "off";
  if (off || timer) return;
  timer = setInterval(() => void outfitTick().catch(() => undefined), intervalMs);
  setTimeout(() => void outfitTick().catch(() => undefined), 15_000);
}
