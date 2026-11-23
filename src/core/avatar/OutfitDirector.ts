/**
 * ==========================================================
 * LÉLU — WHO DECIDES WHAT SHE WEARS, AND WHY
 *
 * One path for every outfit change, whoever starts it:
 *
 *   person in chat   "wear the copper coat"  → OutfitDirector.dress(…, "chat")
 *   LÉLU herself     OutfitAutopilot.tick()   → OutfitDirector.dress(…, "self")
 *   a tool call      forge.dress              → the same wardrobe API
 *
 * The director calls the EXISTING wardrobe (Forge /dress — no second
 * wardrobe), then keeps a short record of every change with its reason, so
 * she can answer "why are you wearing that?" from fact, not invention.
 *
 * The autopilot chooses by occasion (chooseLook, pure and tested): late
 * evening and night at home → the home look; formal or presenting → the
 * coat; training, building or exploring → the catsuit; otherwise her
 * original outfit. It never overrides a look a person asked for in the last
 * `respectRequestMs`, changes at most once per `minIntervalMs`, and does
 * nothing when the chosen look is already on or not in her wardrobe.
 * ==========================================================
 */

import { lookName } from "./outfitCommand";

export interface WardrobeClient {
  wardrobe(character: string): Promise<{ currentLook: string | null; looks: Array<{ id: string; file: string | null }> }>;
  dress(character: string, input: { look?: string | null }): Promise<{ manifest?: { currentLook?: string | null } }>;
}

export type OutfitSource = "chat" | "self" | "tool";

export interface OutfitChange {
  at: number;
  from: string | null;
  to: string | null;
  source: OutfitSource;
  reason: string;
}

export interface OccasionSignals {
  /** Local hour 0–23. */
  hour: number;
  /** Where she is in her world (core, studio, lab, home, cosmos, …), if known. */
  place?: string | null;
  /** What she is doing (presenting, meeting, building, training, exploring, resting, …), if known. */
  activity?: string | null;
}

const FORMAL = /\b(present|presenting|meeting|interview|gala|event|formal|pitch|business|executive|ceremony)\b/;
const ACTIVE = /\b(build|building|train|training|explore|exploring|mission|lab|research|run|running|work(?:ing)?out|engineering)\b/;
const REST = /\b(rest|resting|relax|relaxing|sleep|home|lounge|evening|chill)\b/;

/** Pure: the look an occasion calls for, with the reason she will give. */
export function chooseLook(s: OccasionSignals, available: string[]): { look: string; reason: string } | null {
  const what = `${s.activity ?? ""} ${s.place ?? ""}`.toLowerCase();
  const pick = (look: string, reason: string) => (available.includes(look) ? { look, reason } : null);
  if (FORMAL.test(what)) return pick("rose_gold_sovereign", `I'm ${s.activity ?? "on show"}, so the copper-rose coat.`);
  if (ACTIVE.test(what)) return pick("bronze_velocity", `I'm ${s.activity ?? "working"} in the ${s.place ?? "world"}, so the catsuit — I can move in it.`);
  if (REST.test(what) || s.hour >= 21 || s.hour < 6) return pick("home_laidback3", s.hour >= 21 || s.hour < 6 ? "It's late, so something comfortable." : "I'm resting, so something comfortable.");
  return pick("camo_repaired", "Daytime, nothing special on, so my usual outfit.");
}

export default class OutfitDirector {
  private static instance: OutfitDirector | null = null;
  readonly history: OutfitChange[] = [];
  private lastRequestAt = 0;
  private lastChangeAt = 0;

  constructor(
    private readonly client: WardrobeClient,
    private readonly character = "lelu_character",
    private readonly now: () => number = () => Date.now(),
    readonly options = { respectRequestMs: 2 * 60 * 60 * 1000, minIntervalMs: 30 * 60 * 1000 },
  ) {}

  static install(client: WardrobeClient, character?: string): OutfitDirector {
    OutfitDirector.instance = new OutfitDirector(client, character);
    return OutfitDirector.instance;
  }

  static get(): OutfitDirector | null {
    return OutfitDirector.instance;
  }

  async available(): Promise<{ current: string | null; looks: string[] }> {
    const w = await this.client.wardrobe(this.character);
    return { current: w.currentLook, looks: w.looks.filter((l) => l.file).map((l) => l.id) };
  }

  /** Change look. Refused (not guessed) when the look is not in her wardrobe. */
  async dress(look: string | null, source: OutfitSource, reason: string): Promise<OutfitChange> {
    const { current, looks } = await this.available();
    if (look && !looks.includes(look)) throw new Error(`"${look}" is not in my wardrobe. I have: ${looks.join(", ") || "nothing approved"}.`);
    const result = await this.client.dress(this.character, { look });
    const change: OutfitChange = { at: this.now(), from: current, to: result.manifest?.currentLook ?? look, source, reason };
    this.history.push(change);
    if (this.history.length > 50) this.history.shift();
    if (source !== "self") this.lastRequestAt = change.at;
    this.lastChangeAt = change.at;
    return change;
  }

  /** One autonomous decision. Returns the change made, or why none was made. */
  async tick(signals: OccasionSignals): Promise<{ changed: OutfitChange | null; why: string }> {
    const t = this.now();
    if (t - this.lastRequestAt < this.options.respectRequestMs && this.lastRequestAt > 0) return { changed: null, why: "someone chose my outfit recently; I keep it" };
    if (t - this.lastChangeAt < this.options.minIntervalMs && this.lastChangeAt > 0) return { changed: null, why: "I changed recently" };
    const { current, looks } = await this.available();
    const choice = chooseLook(signals, looks);
    if (!choice) return { changed: null, why: "nothing in my wardrobe fits the moment" };
    if (choice.look === current) return { changed: null, why: `already in the ${lookName(current)}` };
    return { changed: await this.dress(choice.look, "self", choice.reason), why: choice.reason };
  }

  /** Plain sentence for her context: what she is wearing and why. */
  describe(): string {
    const last = this.history[this.history.length - 1];
    if (!last) return "";
    const who = last.source === "self" ? "I chose it myself" : last.source === "chat" ? "I was asked to" : "a tool changed it";
    return `I'm wearing the ${last.to ? lookName(last.to) : "base rig"} (${who}: ${last.reason}).`;
  }
}
