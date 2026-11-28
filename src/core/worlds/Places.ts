/**
 * ==========================================================
 * LÉLU — TIME & PLACE WORLDS (WP21 · WP04)
 *
 * A location explored across eras. Each era is data: which families build
 * it, how the city layer is scaled (extent, height, fill), and the facts it
 * rests on, each with its source and how sure it is:
 *
 *   documented    stated by the cited archive or record
 *   approximate   widely reported; check against the cited archive
 *   illustrative  a rendering choice, not a claim about the place
 *   speculative   an imagined future, labelled as such
 *
 * What the renderer draws is MASSING, not a reconstruction of real
 * streets: building count and height follow the era's scale; positions do
 * not follow the real street plan. That is stated on every place world, so
 * nothing invented is presented as history. Adding a city is adding data:
 * the renderer has no city-specific code.
 * ==========================================================
 */

import { composeWorld } from "./ThemeFamilies";
import { validateWorld, type WorldConfig } from "./WorldSchema";

export type Confidence = "documented" | "approximate" | "illustrative" | "speculative";

export interface PlaceFact {
  text: string;
  source: string;
  confidence: Confidence;
}

export interface Era {
  id: string;
  label: string;
  year: number | null;
  speculative?: boolean;
  /** Families composed for this era (first is primary). */
  families: string[];
  city: { blocks: number; height: number; fill: number; front: number; neon?: string; window?: string };
  /** Overrides on the composed palette (time of day). */
  palette?: Partial<{ sky: [string, string, string]; glow: string }>;
  facts: PlaceFact[];
}

export interface Place {
  id: string;
  name: string;
  /** What the place is, for the renderer: coastal city, inland city… */
  setting: "coastal" | "lakes" | "inland";
  researched: boolean;
  eras: Era[];
}

const MASSING: PlaceFact = { text: "Building count and height follow the era's scale; positions are not the real street plan.", source: "LÉLU renderer", confidence: "illustrative" };

const DAY: Era["palette"] = { sky: ["#3b6db0", "#8fb6e0", "#f3d9b0"], glow: "#fff1c4" };
const DUSK: Era["palette"] = { sky: ["#141a3a", "#5b3a6b", "#f29a5a"], glow: "#ffcf8a" };
const NIGHT: Era["palette"] = { sky: ["#03020a", "#120a2a", "#2a1240"], glow: "#fde68a" };

export const PLACES: Place[] = [
  {
    id: "tampa",
    name: "Tampa, Florida",
    setting: "coastal",
    researched: true,
    eras: [
      {
        id: "c1920",
        label: "c. 1920, before Davis Islands",
        year: 1920,
        families: ["urban-neon"],
        city: { blocks: 5, height: 0.16, fill: 0.3, front: -40, window: "#fcd34d" },
        palette: DAY,
        facts: [
          { text: "Aerial view of the bay before the Davis Islands were built.", source: "USF Libraries Digital Commons, 'Predevelopment Davis Islands, Tampa, circa 1920' (atlas III·28)", confidence: "documented" },
          { text: "The Davis Islands were created by dredging in Hillsborough Bay in the mid-1920s.", source: "Widely reported; verify against USF Digital Commons and Tampa Bay History Center records", confidence: "approximate" },
          MASSING,
        ],
      },
      {
        id: "1958",
        label: "1957–1960 aerials",
        year: 1958,
        families: ["urban-neon"],
        city: { blocks: 8, height: 0.28, fill: 0.5, front: -30 },
        palette: DAY,
        facts: [
          { text: "About 140 digitised historic aerial views of Tampa and parts of Hillsborough County, 1957–1960.", source: "Plan Hillsborough, Tampa aerials 1957–1960 (atlas III·27)", confidence: "documented" },
          { text: "Historic land use, roads, coastlines and urban expansion, 1937–1990.", source: "University of Florida Digital Collections, Florida aerial archive (atlas III·30)", confidence: "documented" },
          MASSING,
        ],
      },
      {
        id: "1999",
        label: "1999 street at dusk",
        year: 1999,
        families: ["urban-neon", "street-comic"],
        city: { blocks: 10, height: 0.75, fill: 0.68, front: -22, neon: "#f472b6" },
        palette: DUSK,
        facts: [
          { text: "Downtown's tallest towers by the late 1990s were 100 North Tampa (1992) and the Bank of America Plaza (1986).", source: "Widely reported; verify against Emporis/CTBUH records", confidence: "approximate" },
          { text: "Comic-styled overlay: an original illustrated layer combined with the era, not a period artefact.", source: "LÉLU composition", confidence: "illustrative" },
          MASSING,
        ],
      },
      {
        id: "present",
        label: "Present day, night",
        year: 2026,
        families: ["urban-neon"],
        city: { blocks: 12, height: 1, fill: 0.82, front: -18, neon: "#22d3ee" },
        palette: NIGHT,
        facts: [
          { text: "Waterfront, Riverwalk, downtown, bridges and historic districts.", source: "Visit Tampa Bay (atlas II·46)", confidence: "documented" },
          MASSING,
        ],
      },
      {
        id: "2060",
        label: "2060, imagined",
        year: 2060,
        speculative: true,
        families: ["urban-neon", "quantum"],
        city: { blocks: 14, height: 1.5, fill: 0.92, front: -16, neon: "#a78bfa" },
        palette: NIGHT,
        facts: [{ text: "An imagined future: taller massing and a data layer. Not a forecast.", source: "LÉLU composition", confidence: "speculative" }, MASSING],
      },
    ],
  },
  ...(
    [
      ["lakeland", "Lakeland, Florida", "lakes", "Lake Mirror, Hollis Garden, fountains, public art and downtown character.", "Downtown Lakeland (atlas II·44)", 6, 0.3],
      ["atlanta", "Atlanta, Georgia", "inland", "Skyline, neighbourhoods and parks as a starting point for research.", "Atlanta Convention & Visitors Bureau (atlas II·45)", 12, 1.1],
      ["tokyo", "Tokyo, Japan", "coastal", "Skyline, Shibuya, Tokyo Bay, observation decks and day/night city layers.", "Official Tokyo Travel Guide (atlas II·41)", 16, 1.2],
    ] as const
  ).map(
    ([id, name, setting, text, source, blocks, height]): Place => ({
      id,
      name,
      setting,
      researched: false,
      eras: [
        {
          id: "present",
          label: "Present day, night",
          year: 2026,
          families: ["urban-neon"],
          city: { blocks, height, fill: 0.8, front: setting === "coastal" ? -20 : 2 },
          palette: NIGHT,
          facts: [{ text, source, confidence: "documented" }, { text: "Only the present day is modelled; earlier eras need archive research first.", source: "LÉLU", confidence: "illustrative" }, MASSING],
        },
      ],
    }),
  ),
];

export function place(id: string): Place | undefined {
  return PLACES.find((p) => p.id === id);
}

const label = (c: Confidence) => ({ documented: "documented", approximate: "approximate: check the cited source", illustrative: "illustrative", speculative: "speculative" })[c];

/** The world for one era of a place. */
export function placeWorld(placeId: string, eraId: string, now = 0): WorldConfig | null {
  const p = place(placeId);
  const era = p?.eras.find((e) => e.id === eraId);
  if (!p || !era) return null;
  const w = composeWorld(era.families, { id: `place-${p.id}-${era.id}`, name: `${p.name} · ${era.label}`, now });
  const layers = w.layers.map((l) => {
    if (l.slot === "foundation" && l.kind === "city")
      return { ...l, params: { ...l.params, blocks: era.city.blocks, height: era.city.height, fill: era.city.fill, front: p.setting === "coastal" ? era.city.front : 4, ground: p.setting === "coastal" ? "shore" : "street", ...(era.city.neon ? { neon: era.city.neon } : {}), ...(era.city.window ? { window: era.city.window } : {}) } };
    if (l.kind === "rain" || (l.kind === "traffic" && p.setting === "coastal")) return { ...l, enabled: false };
    if (l.kind === "fog") return { ...l, params: { ...l.params, color: (era.palette?.sky ?? w.palette.sky)[1], density: 0.008 } };
    return l;
  });
  if (p.setting !== "inland") layers.push({ id: "place-water", slot: "foundation", kind: "ocean", label: p.setting === "coastal" ? "Bay" : "Lakes", enabled: true, opacity: 1, depth: -1, params: { color: era.palette === DAY ? "#2a5d8a" : era.palette === DUSK ? "#3a2f5a" : "#16264a", swell: 0.35 }, transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 }, family: "place" });
  const conf = era.speculative ? "speculative" : era.facts.some((f) => f.confidence === "approximate") ? "approximate" : "documented";
  return validateWorld({
    ...w,
    layers,
    palette: { ...w.palette, ...(era.palette ?? {}) },
    place: {
      location: p.name,
      era: era.label,
      confidence: `${label(conf)} · massing illustrative${p.researched ? "" : " · only the present is modelled"}`,
      sources: era.facts.map((f) => `[${f.confidence}] ${f.text} (${f.source})`),
    },
  }).world;
}
