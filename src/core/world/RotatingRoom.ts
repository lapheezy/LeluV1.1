/**
 * ==========================================================
 * LÉLUVERSE — HER ROTATING ROOM (state and layout)
 *
 * One circular room that turns. Around its rim sit six sections,
 * from the owner's pictures (artifacts/foundry/m25c/references/room):
 *
 *   lounge · theater · kitchen & dining · bedroom · bathroom · studio
 *
 * Choosing a section turns the whole ring until that section stands
 * at the back of the room, facing whoever is looking in (the front of
 * the room stays open so nothing ever stands between the viewer and
 * LÉLU). While it turns, the furniture TRANSFORMS: what leaves the back
 * sinks into the floor, what arrives rises out of it. Two more modes:
 *
 *   stage  every piece retracts; the turntable's rings glow — the bare
 *          platform of the owner's stage picture
 *   plan   the camera rises overhead and every section stands at once —
 *          the owner's floor-plan picture
 *
 * The furniture is hers: Meshy built each piece from the owner's
 * pictures (scripts/foundry/m25c_room_meshy.py), sized in metres for the
 * app (scripts/blender/lelu_room_pieces.py → public/lelu-room/*.glb).
 *
 * Pure: no three.js and no DOM beyond an optional localStorage, so the
 * layout, the turning and the obstacles are testable.
 * ==========================================================
 */

export type RoomSectionId = "lounge" | "theater" | "kitchen" | "bedroom" | "bathroom" | "studio";
export type RoomMode = RoomSectionId | "stage" | "plan";
export type RoomPieceId =
  | "bed" | "tub" | "dining" | "island" | "desk" | "theater_sofa" | "lounge_ring"
  | "crystal" | "chandelier" | "planter" | "vanity" | "fridge";

/** One piece of furniture in a section, in metres, in the section's own frame. */
export interface RoomPiece {
  piece: RoomPieceId;
  /** Distance from the room's centre (m). */
  r: number;
  /** Angle from the section's centre line (degrees, + = clockwise seen from above). */
  a: number;
  /** Turn of the piece (degrees): 0 = its front faces the room's centre. */
  yaw?: number;
  /** Height above the floor (m), for hanging pieces. */
  y?: number;
  /** Footprint radius she walks around (m); 0 = she may walk under/through (hanging pieces). */
  footprint: number;
}

export interface RoomSection {
  id: RoomSectionId;
  label: string;
  glyph: string;
  /** Where it was photographed (the owner's reference). */
  reference: string;
  pieces: RoomPiece[];
}

/** Clockwise around the rim, as in the owner's floor plan (lounge at the top). */
export const ROOM_SECTIONS: readonly RoomSection[] = [
  {
    id: "lounge", label: "Lounge", glyph: "◎", reference: "references/room/01-lounge.png",
    pieces: [
      { piece: "lounge_ring", r: 2.55, a: 0, footprint: 1.75 },
      { piece: "crystal", r: 3.95, a: -16, footprint: 0.2 },
      { piece: "crystal", r: 3.95, a: 16, footprint: 0.2 },
      { piece: "planter", r: 4.05, a: -26, footprint: 0.45 },
      { piece: "planter", r: 4.05, a: 26, footprint: 0.45 },
    ],
  },
  {
    id: "theater", label: "Theater", glyph: "▭", reference: "references/room/08-theater.png",
    pieces: [
      // the sofa faces the screen on the wall, its back to the room
      { piece: "theater_sofa", r: 2.35, a: 0, yaw: 180, footprint: 1.5 },
      { piece: "crystal", r: 3.4, a: -24, footprint: 0.2 },
      { piece: "planter", r: 4.05, a: 30, footprint: 0.45 },
    ],
  },
  {
    id: "kitchen", label: "Kitchen & dining", glyph: "◍", reference: "references/room/06-kitchen.png",
    pieces: [
      { piece: "dining", r: 2.35, a: 0, footprint: 1.3 },
      { piece: "island", r: 3.7, a: -22, yaw: 0, footprint: 0.9 },
      { piece: "fridge", r: 4.2, a: 22, footprint: 0.6 },
      { piece: "chandelier", r: 2.35, a: 0, y: 2.0, footprint: 0 },
    ],
  },
  {
    id: "bedroom", label: "Bedroom", glyph: "◐", reference: "references/room/05-bedroom.png",
    pieces: [
      { piece: "bed", r: 2.75, a: 0, footprint: 1.2 },
      { piece: "vanity", r: 4.0, a: -26, footprint: 0.45 },
      { piece: "crystal", r: 3.6, a: 17, footprint: 0.2 },
      { piece: "planter", r: 4.05, a: 27, footprint: 0.45 },
    ],
  },
  {
    id: "bathroom", label: "Bathroom", glyph: "◌", reference: "references/room/04-bathroom.png",
    pieces: [
      { piece: "tub", r: 2.7, a: 0, footprint: 1.05 },
      { piece: "crystal", r: 3.7, a: -14, footprint: 0.2 },
      { piece: "crystal", r: 3.7, a: 14, footprint: 0.2 },
      { piece: "vanity", r: 4.0, a: 27, footprint: 0.45 },
      { piece: "planter", r: 4.05, a: -27, footprint: 0.45 },
      { piece: "chandelier", r: 2.7, a: 0, y: 2.0, footprint: 0 },
    ],
  },
  {
    id: "studio", label: "Creator studio", glyph: "▣", reference: "references/room/07-studio.png",
    pieces: [
      // the desk faces the room: she works facing whoever is looking in
      { piece: "desk", r: 3.05, a: 0, footprint: 1.2 },
      { piece: "crystal", r: 3.3, a: -24, footprint: 0.2 },
      { piece: "crystal", r: 3.3, a: 24, footprint: 0.2 },
      { piece: "planter", r: 4.05, a: -30, footprint: 0.45 },
    ],
  },
];

export const ROOM_MODES: readonly RoomMode[] = [...ROOM_SECTIONS.map((s) => s.id), "stage", "plan"];

/** Degrees between neighbouring sections. */
export const SECTION_SPAN = 360 / ROOM_SECTIONS.length;
/** The back of the room (the side facing the viewer), as a world angle: -Z. */
export const BACK_ANGLE = 180;
/** How long a turn of one section takes (s); longer turns take proportionally longer, capped. */
export const TURN_SECONDS_PER_SECTION = 1.1;
export const MAX_TURN_SECONDS = 3.2;
/**
 * A section stands while its centre line is within STANDING_HALF_ARC degrees of the back; it has
 * sunk into the floor RISE_ARC degrees further on. Its neighbours (one section span away) are
 * sunk, so at rest only the chosen section stands; while the ring turns, the arriving section
 * rises as it comes round and the leaving one sinks.
 */
export const STANDING_HALF_ARC = 18;
/** Over how many degrees it rises / sinks. */
export const RISE_ARC = 28;

export function sectionIndex(id: RoomSectionId): number {
  return ROOM_SECTIONS.findIndex((s) => s.id === id);
}

/** The ring rotation (degrees) that brings a section to the back. */
export function ringAngleFor(id: RoomSectionId): number {
  return -sectionIndex(id) * SECTION_SPAN;
}

/** Shortest signed difference b - a in degrees, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/** A section's centre line as a world angle (degrees, 0 = +Z toward the viewer), for a ring rotation. */
export function sectionWorldAngle(index: number, ring: number): number {
  return BACK_ANGLE + index * SECTION_SPAN + ring;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * How far a piece at world angle `angle` stands out of the floor (0 = sunk, 1 = standing):
 * standing at the back, sinking as it turns toward the open front. In `plan` everything stands;
 * on the bare `stage` nothing does.
 */
export function standing(angle: number, mode: RoomMode): number {
  if (mode === "plan") return 1;
  if (mode === "stage") return 0;
  const off = Math.abs(angleDelta(BACK_ANGLE, angle));
  return 1 - smooth((off - STANDING_HALF_ARC) / RISE_ARC);
}

/** Easing for a turn: slow out, slow in. */
export function easeTurn(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export interface PlacedRoomPiece extends RoomPiece {
  section: RoomSectionId;
  key: string;
  /** Floor position relative to the room's centre (m): x right, z toward the viewer. */
  x: number;
  z: number;
  /** Turn about the vertical (radians, three.js Y): the piece's front faces the centre at yaw 0. */
  rotationY: number;
  /** 0..1 how far it stands out of the floor. */
  rise: number;
}

/**
 * Every piece of every section where it is for a ring rotation: positions on the floor relative
 * to the centre, the turn that keeps each front toward the centre, and how far it has risen.
 */
export function layout(ring: number, mode: RoomMode): PlacedRoomPiece[] {
  const out: PlacedRoomPiece[] = [];
  ROOM_SECTIONS.forEach((section, index) => {
    // the whole section rises and sinks together, by where its centre line is
    const rise = standing(sectionWorldAngle(index, ring), mode);
    section.pieces.forEach((p, k) => {
      const deg = sectionWorldAngle(index, ring) + p.a;
      const rad = (deg * Math.PI) / 180;
      const x = Math.sin(rad) * p.r;
      const z = Math.cos(rad) * p.r;
      // a piece's model front is +Z; facing the centre from angle `rad` means turning by rad + PI
      const rotationY = rad + Math.PI + ((p.yaw ?? 0) * Math.PI) / 180;
      out.push({ ...p, section: section.id, key: `${section.id}:${k}:${p.piece}`, x, z, rotationY, rise });
    });
  });
  return out;
}

/** Furniture she walks around (only what is standing), in metres relative to the centre. */
export function roomObstacles(ring: number, mode: RoomMode): Array<{ id: string; x: number; z: number; radius: number }> {
  return layout(ring, mode)
    .filter((p) => p.footprint > 0 && p.rise > 0.5)
    .map((p) => ({ id: `room:${p.key}`, x: p.x, z: p.z, radius: p.footprint }));
}

/** Which mode a sentence asks for ("take me to the kitchen", "show me the floor plan"), or null. */
export function modeFromText(text: string): RoomMode | null {
  const t = text.toLowerCase();
  const table: Array<[RegExp, RoomMode]> = [
    [/\b(floor ?plan|plan view|overhead|from above|top[- ]down|bird'?s[- ]eye)\b/, "plan"],
    [/\b(stage|platform|empty (the )?room|clear the room|bare room)\b/, "stage"],
    [/\b(theat(er|re)|cinema|movie|screen|gaming|games?)\b/, "theater"],
    [/\b(kitchen|dining|dinner|eat|cook(ing)?|breakfast)\b/, "kitchen"],
    [/\b(bed ?room|bed|sleep|nap)\b/, "bedroom"],
    [/\b(bath ?room|bath|tub|shower|spa)\b/, "bathroom"],
    [/\b(studio|desk|creator|workstation|design)\b/, "studio"],
    [/\b(lounge|living room|sofa|couch|sitting room|conversation pit)\b/, "lounge"],
  ];
  for (const [re, mode] of table) if (re.test(t)) return mode;
  return null;
}

/* ------------------------------- the state ------------------------------- */

export interface RoomState {
  /** What was asked for last. */
  mode: RoomMode;
  /** The section standing at the back (the last section asked for; kept through stage/plan). */
  section: RoomSectionId;
  /** Ring rotation in degrees (animated toward ringAngleFor(section)). */
  ring: number;
  /** A turn in progress: from → to over `seconds`, started at `startedAt` (ms). */
  turn: { from: number; to: number; seconds: number; startedAt: number } | null;
}

const STORAGE_KEY = "lelu.room.v1";
export const ROOM_CHANGED_EVENT = "lelu:room";

type Listener = (state: RoomState) => void;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function initial(): RoomState {
  const saved = storage()?.getItem(STORAGE_KEY);
  let mode: RoomMode = "lounge";
  let section: RoomSectionId = "lounge";
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as { mode?: string; section?: string };
      if (ROOM_MODES.includes(parsed.mode as RoomMode)) mode = parsed.mode as RoomMode;
      if (ROOM_SECTIONS.some((s) => s.id === parsed.section)) section = parsed.section as RoomSectionId;
    } catch {
      /* a damaged entry: start in the lounge */
    }
  }
  // "plan" moves the camera; a reload starts standing in the room instead
  if (mode === "plan") mode = section;
  return { mode, section, ring: ringAngleFor(section), turn: null };
}

class RoomStoreImpl {
  private state: RoomState = initial();
  private listeners = new Set<Listener>();

  get(): RoomState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The ring's rotation now (degrees), following the turn in progress. */
  ringAt(now: number): number {
    const t = this.state.turn;
    if (!t) return this.state.ring;
    const k = easeTurn((now - t.startedAt) / 1000 / t.seconds);
    if (k >= 1) {
      this.state = { ...this.state, ring: t.to, turn: null };
      return t.to;
    }
    return t.from + (t.to - t.from) * k;
  }

  /** Turn to a section, or switch to the bare stage or the floor plan. Returns the new state. */
  goTo(mode: RoomMode, now: number = Date.now()): RoomState {
    if (!ROOM_MODES.includes(mode)) throw new Error(`"${mode}" is not a part of her room. Choose one of: ${ROOM_MODES.join(", ")}.`);
    const current = this.ringAt(now);
    let section = this.state.section;
    let turn = this.state.turn;
    if (mode !== "stage" && mode !== "plan") {
      section = mode;
      // the shortest way round, from wherever the ring is right now
      const to = current + angleDelta(current, ringAngleFor(section));
      const steps = Math.abs(to - current) / SECTION_SPAN;
      turn = steps < 1e-6 ? null : { from: current, to, seconds: Math.min(MAX_TURN_SECONDS, Math.max(0.6, steps * TURN_SECONDS_PER_SECTION)), startedAt: now };
    }
    this.state = { mode, section, ring: current, turn };
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ mode, section }));
    for (const l of this.listeners) l(this.state);
    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
      window.dispatchEvent(new CustomEvent(ROOM_CHANGED_EVENT, { detail: { mode, section } }));
    }
    return this.state;
  }

  /** Test seam: forget everything. */
  reset(): void {
    this.state = { mode: "lounge", section: "lounge", ring: ringAngleFor("lounge"), turn: null };
    this.listeners.clear();
  }
}

export const RoomStore = new RoomStoreImpl();
export default RoomStore;
