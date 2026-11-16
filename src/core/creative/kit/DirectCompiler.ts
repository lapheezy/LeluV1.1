/**
 * ==========================================================
 * LÉLU — DIRECT EXECUTION (no model)
 *
 * Turns a request into an executable tool plan with rules, not
 * inference, so ordinary creative and data work runs when every
 * model provider is unavailable (or when the person types an
 * explicit command). The plan runs through the SAME dispatcher
 * as a model's tool call: same gate, same events, same cards.
 *
 *   /art [style] [palette]       /diagram a -> b -> c | <mermaid>
 *   /scene [preset]              /film <subject>
 *   /chart earthquakes           /research <topic>
 *   /data <connector> k=v …      /sketch <subject>
 *   /collection <theme>          /capabilities   /tools [filter]
 *   /export <artifact> <format>
 *
 * Natural language is recognised for the same families
 * ("make me a generative artwork in ocean colours", "build a
 * 3D desert environment", "make a short film about tides").
 * A model, when available, writes richer specs; this path
 * guarantees the work itself never depends on one.
 * ==========================================================
 */

import { GENERATIVE_STYLES, PALETTES, type GenerativeStyle } from "./GenerativeArt";
import { PRESETS } from "./Scene3D";
import { seedFrom } from "./Rng";
import { connectorProfiles } from "../../data/PublicDataConnectors";
import { findBuilder, describeRequest } from "./build";
import { parseSpatialIntent, RELATION_WORDS as SPATIAL_WORDS } from "../../cosmos/objects/spatialIntent";
import CosmosObjectStore from "../../cosmos/objects/CosmosObjectStore";

export interface DirectStep { tool: string; args: Record<string, unknown>; label: string }
export interface DirectPlan { steps: DirectStep[]; summary: string; explicit: boolean }

const has = (re: RegExp, t: string) => re.test(t);
const after = (t: string, re: RegExp) => { const m = re.exec(t); return m ? t.slice(m.index + m[0].length).trim() : ""; };
const titleCase = (s: string) => s.replace(/\s+/g, " ").trim().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).slice(0, 80);

const STYLE_WORDS: Array<[RegExp, GenerativeStyle]> = [
  [/\bflow|stream|wind|current|silk|hair\b/i, "flowfield"], [/\bcircle|bubble|dot|cell|foam\b/i, "circlepack"],
  [/\bmountain|ridge|wave|sound|pulse|landscape\b/i, "ridgelines"], [/\bstar|constellation|network|neural|node\b/i, "constellation"],
  [/\btile|maze|labyrinth|weave|lattice\b/i, "truchet"], [/\btree|branch|root|botanic|plant|coral\b/i, "tree"],
  [/\bmosaic|triangle|stained|shard|crystal|facet\b/i, "mosaic"], [/\borbit|spiro|ring|halo|planet|cosmic\b/i, "orbits"],
];
const PALETTE_WORDS: Array<[RegExp, string]> = [
  [/\bocean|sea|blue|water|tide|marine\b/i, "ocean"], [/\bfire|ember|sunset|warm|autumn|red\b/i, "ember"], [/\bforest|green|moss|nature|leaf\b/i, "forest"],
  [/\bneon|cyber|synth|electric\b/i, "neon"], [/\bpastel|soft|blush|spring\b/i, "pastel"], [/\bnoir|monochrome|black and white|ink|minimal\b/i, "noir"],
  [/\baurora|polar|arctic|ice\b/i, "aurora"], [/\bgold|lelu|luxur|violet|purple\b/i, "lelu"],
];
const PRESET_WORDS: Array<[RegExp, string]> = [
  [/\bforest|woods|pine|trees?\b/i, "forest"], [/\bcity|urban|skyline|metropolis|street\b/i, "city"], [/\bdesert|dune|sahara|canyon\b/i, "desert"],
  [/\bocean|island|sea|beach|tropical\b/i, "ocean"], [/\bspace|planet|galaxy|solar|orbit|star\b/i, "space"], [/\bcrystal|cave|gem|mine\b/i, "crystal-cave"],
  [/\brunway|fashion|catwalk|garment|couture|collection|dress\b/i, "runway"],
];

function pickStyle(t: string): GenerativeStyle { const named = GENERATIVE_STYLES.find((s) => new RegExp(`\\b${s}\\b`, "i").test(t)); return named ?? STYLE_WORDS.find(([re]) => re.test(t))?.[1] ?? GENERATIVE_STYLES[seedFrom(t) % GENERATIVE_STYLES.length]; }
function pickPalette(t: string): string { const named = Object.keys(PALETTES).find((p) => new RegExp(`\\b${p}\\b`, "i").test(t)); return named ?? PALETTE_WORDS.find(([re]) => re.test(t))?.[1] ?? "lelu"; }
function pickPreset(t: string): string { const named = Object.keys(PRESETS).find((p) => t.toLowerCase().includes(p)); return named ?? PRESET_WORDS.find(([re]) => re.test(t))?.[1] ?? "crystal-cave"; }
function subjectOf(t: string): string {
  return t.replace(/^\/\w+\s*/, "").replace(/\b(please|can you|could you|make|create|build|generate|construct|render|draw|give me|show me|me|a|an|the|some|short|quick|new|detailed|interactive|of|about|for|on|with|in|style|colou?rs?|film|movie|video|trailer|reel|montage|sketch|drawing|doodle|concept|fashion|collection|called|named|titled)\b/gi, " ").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "LÉLU";
}

/** "a -> b -> c, b -> d" → a structured flowchart. */
function arrowsToStructure(text: string): Record<string, unknown> | null {
  if (!/->|→/.test(text)) return null;
  const edges: Array<{ from: string; to: string }> = [];
  const names = new Map<string, string>();
  const id = (label: string) => { const key = label.toLowerCase(); if (!names.has(key)) names.set(key, `n${names.size + 1}`); return names.get(key)!; };
  const labels = new Map<string, string>();
  for (const chain of text.split(/[,;\n]/)) {
    const parts = chain.split(/->|→/).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < parts.length - 1; i += 1) { const a = id(parts[i]), b = id(parts[i + 1]); labels.set(a, parts[i]); labels.set(b, parts[i + 1]); edges.push({ from: a, to: b }); }
  }
  if (edges.length === 0) return null;
  return { nodes: [...labels.entries()].map(([nid, label]) => ({ id: nid, label })), edges, direction: "LR" };
}

const LELU_ARCHITECTURE = `flowchart LR
  user(["Person: chat · voice · files"]) --> chat["Chat Universe"]
  chat --> router{"AIRouter stages"}
  router -->|"deterministic"| direct["Direct execution (no model)"]
  router -->|"reasoning"| broker["Model broker · free tiers only"]
  broker --> dispatcher
  direct --> dispatcher["ToolDispatcher + AutonomyGate"]
  subgraph tools["Tool registry"]
    kit["Creative kit: art · Mermaid · charts · three.js → GLB · films → WebM"]
    studio["Creation Studio: docs · decks · sheets · Excalidraw"]
    data["Public data: Wikipedia · Wikidata · Crossref · arXiv · USGS · NWS"]
    web["Page reader: direct → Firecrawl fallback"]
    world["Cosmos world · Forge"]
  end
  dispatcher --> kit & studio & data & web & world
  kit --> files[("Files: SVG · PNG · GLB · WebM · HTML")]
  spend["Spend policy: zero paid use without consent"] -.-> broker`;

function sketchElements(subject: string): Array<Record<string, unknown>> {
  const fashion = /\b(dress|gown|fashion|garment|outfit|couture|look|collection|jacket|coat|skirt)\b/i.test(subject);
  const els: Array<Record<string, unknown>> = [
    { type: "rectangle", x: 0, y: 0, width: 760, height: 520, strokeColor: "#1e1e1e", backgroundColor: "transparent", roughness: 1 },
    { type: "text", x: 24, y: 18, text: titleCase(subject), fontSize: 28, strokeColor: "#1e1e1e" },
  ];
  if (fashion) {
    for (let k = 0; k < 3; k += 1) {
      const x = 90 + k * 230, flare = [70, 110, 50][k];
      els.push(
        { type: "ellipse", x: x + 20, y: 80, width: 28, height: 34, strokeColor: "#1e1e1e" },
        { type: "line", x: x + 34, y: 114, points: [[0, 0], [0, 26]], strokeColor: "#1e1e1e" },
        { type: "line", x: x + 34, y: 140, points: [[-28, 0], [28, 0], [16, 70], [-16, 70], [-28, 0]], strokeColor: "#8a6d3b", backgroundColor: ["#d4a94e", "#b98cff", "#f4acb7"][k], fillStyle: "hachure" },
        { type: "line", x: x + 34, y: 210, points: [[-16, 0], [16, 0], [16 + flare / 2, 200], [-16 - flare / 2, 200], [-16, 0]], strokeColor: "#8a6d3b", backgroundColor: ["#d4a94e", "#b98cff", "#f4acb7"][k], fillStyle: "cross-hatch" },
        { type: "line", x: x + 26, y: 410, points: [[0, 0], [-4, 60]], strokeColor: "#1e1e1e" },
        { type: "line", x: x + 42, y: 410, points: [[0, 0], [4, 60]], strokeColor: "#1e1e1e" },
        { type: "text", x: x - 10, y: 482, text: `Look ${k + 1}: ${["column", "volume", "slip"][k]}`, fontSize: 16, strokeColor: "#1e1e1e" },
      );
    }
    els.push({ type: "arrow", x: 640, y: 120, points: [[0, 0], [-120, 80]], strokeColor: "#c4302b" }, { type: "text", x: 600, y: 90, text: "drape here", fontSize: 14, strokeColor: "#c4302b" });
  } else {
    els.push(
      { type: "ellipse", x: 270, y: 180, width: 220, height: 140, strokeColor: "#1e1e1e", backgroundColor: "#ffec99", fillStyle: "hachure", label: { text: titleCase(subject).slice(0, 24) } },
      ...[["Form", 60, 90], ["Light", 560, 90], ["Texture", 60, 380], ["Story", 560, 380]].flatMap(([t, x, y]) => [
        { type: "rectangle", x, y, width: 150, height: 60, strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "hachure", label: { text: t } },
        { type: "arrow", x: (x as number) < 300 ? (x as number) + 150 : (x as number), y: (y as number) + 30, points: [[0, 0], [(x as number) < 300 ? 110 : -110, (y as number) < 200 ? 80 : -80]], strokeColor: "#1e1e1e" },
      ]),
    );
  }
  return els;
}

function filmScenes(subject: string, palette: string): Array<Record<string, unknown>> {
  const pal = PALETTES[palette] ?? PALETTES.lelu;
  const styles: GenerativeStyle[] = ["flowfield", "ridgelines", "constellation", "orbits"];
  const lines = [`What is ${subject}?`, "A shape in motion", "Connections everywhere", "Returning, changed"];
  return [
    { duration: 3, title: titleCase(subject), subtitle: "a short film by LÉLU", visual: { type: "gradient", colors: [pal.background, pal.colors[3] ?? pal.colors[0]] }, motion: "still" },
    ...styles.map((style, i) => ({ duration: 3, subtitle: lines[i], visual: { type: "generative", style, palette, seed: seedFrom(subject) + i, density: 0.8 }, motion: (["zoom-in", "pan-left", "drift", "zoom-out"] as const)[i] })),
    { duration: 2.5, title: "Fin", visual: { type: "gradient", colors: [pal.colors[0], pal.background] }, motion: "still" },
  ];
}

const CONNECTOR_IDS = () => connectorProfiles().map((p) => p.id);

/** Compile a request. explicit: true for slash commands (run them whatever the providers' state). */
export function compileDirect(prompt: string): DirectPlan | null {
  const t = prompt.trim();
  const slash = /^\/(\w+)\b\s*([\s\S]*)$/.exec(t);
  if (slash) return compileCommand(slash[1].toLowerCase(), slash[2].trim());
  const nl = (cmd: string, rest: string): DirectPlan | null => { const plan = compileCommand(cmd, rest); return plan ? { ...plan, explicit: false } : null; };
  const verb = /\b(make|create|build|generate|construct|render|draw|design|produce|compose|assemble|give me|show me|i want|i'd like)\b/i;
  // Exporting what she built in her world (Job 3/4: world.export, world.gltf).
  const worldFile = /\b(stl|obj|glb|gltf)\b/i.exec(t);
  if (worldFile && has(/\b(export|download|save|give me|turn)\b/i, t) && has(/\b(world|room|environment|objects?)\b/i, t)) return nl("world", worldFile[1]);
  if (/\b(internal[- ]combustion|four[- ]stroke|4[- ]stroke|piston engine|engine assembly)\b/i.test(t) && has(verb, t)) return nl("engine", t);
  /*
   * Construction from words, before any generic scene rule: "build a gear
   * train", "model a water molecule", "a 3-storey cabin with 4 bays".
   * Modification is checked first, because "make the gear bigger" names a
   * subject too and must change the artifact on screen rather than build one.
   */
  /*
   * Cosmos objects, before construction: "put it in the Cosmos", "move the
   * engine next to the cabin", "separate the transmission". These are local
   * operations on objects that already exist, so they run with no model at
   * all — the same rule as a construction, for the same reason.
   */
  const cosmos = cosmosPlan(t);
  if (cosmos) return { ...cosmos, explicit: false };
  const changeWords = /\b(bigger|smaller|larger|taller|wider|deeper|steeper|shallower|flatter|no idler|add an idler|space[- ]filling|ball[- ]and[- ]stick|more bays|one more storey|another floor|faster output|slower output|more torque|fewer storeys)\b/i;
  const wantsChange = /\b(make|change|set|turn|update|increase|decrease|give it|modify|edit|adjust|remove|add)\b/i;
  if (has(changeWords, t) && has(wantsChange, t)) return nl("modify", t);
  if (findBuilder(t) && has(/\b(make|create|build|generate|construct|model|assemble|give me|show me|i want|i'd like|design)\b/i, t)) return nl("build", t);
  if (has(/\b(fashion|couture)\b/i, t) && has(/\bcollection\b/i, t) && has(verb, t)) return nl("collection", subjectOf(t));
  if (has(/\b(film|movie|video|trailer|reel|montage)\b/i, t) && has(verb, t)) return nl("film", subjectOf(t));
  if (has(/\b(3d|3-d)\b|\b(environment|landscape|scene)\b/i, t) && has(verb, t) && !has(/\b(diagram|chart)\b/i, t)) return nl("scene", t);
  if (has(/\b(diagram|flowchart|flow chart|mind ?map|architecture)\b/i, t) && has(verb, t)) return nl("diagram", t.includes(":") ? t.slice(t.indexOf(":") + 1) : t);
  if (has(/\b(generative|procedural|abstract art|artwork|pattern|wallpaper|creative coding)\b/i, t) && has(verb, t)) return nl("art", t);
  if (has(/\b(sketch|drawing|doodle|croquis)\b/i, t) && has(verb, t)) return nl("sketch", subjectOf(t));
  if (has(/\bearthquakes?\b/i, t) && has(/\b(chart|graph|plot|visuali[sz]\w*|map|show)\b/i, t)) return nl("chart", "earthquakes");
  if (has(/\b(research|investigate|look into|find out about|literature on|sources on)\b/i, t)) return nl("research", after(t, /\b(research|investigate|look into|find out about|literature on|sources on)\b/i) || subjectOf(t));
  if (has(/\b(what can you (?:do|run)|your capabilities|device capabilities|webgpu|webcodecs)\b/i, t)) return nl("capabilities", "");
  return null;
}

/**
 * Cosmos object operations, in words.
 *
 * Every branch maps to one local tool call. Nothing here guesses a position
 * the user did not ask for; "next to the cabin" is resolved from the actual
 * object, and an object that does not exist is refused by the tool, not
 * invented here.
 */
function cosmosPlan(t: string): DirectPlan | null {
  const lower = t.toLowerCase();
  // Operations on objects only make sense when there is a Cosmos to act on,
  // unless the sentence says "cosmos" itself. Without this, "remove the idler"
  // would be read as removing an object instead of changing a gearbox.
  const cosmosWords = /\b(cosmos|floating object|in the scene)\b/i.test(t);
  const hasObjects = (() => {
    try {
      return CosmosObjectStore.getInstance().list().length > 0;
    } catch {
      return false;
    }
  })();
  const gated = cosmosWords || hasObjects;
  const one = (tool: string, label: string, args: Record<string, unknown>, summary: string): DirectPlan => ({ explicit: false, summary, steps: [{ tool, label, args }] });
  const objectName = (after: RegExp): string => (after.exec(t)?.[1] ?? "").trim().replace(/[.?!]+$/, "");

  if (/\b(show|list|what('s| is)|every object|my objects)\b/i.test(t) && /\b(cosmos|objects?|scene)\b/i.test(t)) {
    return one("cosmos.object.list", "objects", { trash: /\btrash|removed|deleted\b/i.test(t) }, "every object in the Cosmos");
  }
  if (/\bpause all\b|\bstop (all|everything|them)\b|\bfreeze\b/i.test(t) && /\b(objects?|floating|everything|motion|animation)\b/i.test(t)) {
    return one("cosmos.object.animate", "pause", { all: true, paused: true }, "pause every floating object");
  }
  if (/\bresume all\b|\bunpause\b|\bstart (them|all) (again|moving)\b/i.test(t)) {
    return one("cosmos.object.animate", "resume", { all: true, paused: false }, "resume every floating object");
  }
  if (/\b(return|reset|put)\b.*\b(original|initial|back)\b.*\bpositions?\b|\breset (all )?(the )?(object|positions?)\b/i.test(t)) {
    return one("cosmos.object.select", "reset", { clear: true }, "return the objects to their starting arrangement");
  }

  const spawn = /\b(put|spawn|place|bring|drop|move)\b([\s\S]*)\b(cosmos|scene|space)\b/i.exec(t);
  if (spawn) {
    const named = /\b(?:put|spawn|place|bring|drop)\s+(?:the|my|that)\s+([\w\s-]{3,40}?)\s+(?:into|in|to)\s+(?:the\s+)?cosmos/i.exec(t)?.[1]?.trim();
    return one("cosmos.object.spawn", "spawn", { artifact: named ?? "it" }, `put ${named ? `the ${named}` : "it"} into the Cosmos`);
  }

  const integrate = /\b(connect|attach|integrate|mount)\s+(?:the\s+)?([\w\s-]{2,30})\s+(?:into|to|on|inside|in)\s+(?:the\s+)?([\w\s-]{2,30})$/i.exec(t.trim());
  if (integrate && !/\bcosmos\b/i.test(t)) {
    return one("cosmos.object.integrate", "integrate", { object: integrate[2].trim(), into: integrate[3].trim() }, `put the ${integrate[2].trim()} inside the ${integrate[3].trim()}`);
  }

  const extract = /\b(separate|extract|take|remove|pull|detach)\s+(?:out\s+)?(?:the\s+)?([\w\s-]{2,30}?)(?:\s+(?:out|from|of)\b[\s\S]*)?$/i.exec(t.trim());
  if (extract && /\b(separate|extract|detach|take\s+(?:the\s+)?[\w\s-]{2,24}?\s+out|pull\s+(?:the\s+)?[\w\s-]{2,24}?\s+out|remove from)\b/i.test(t)) {
    const wantsWorkspace = /\bworkspace|studio|open it|edit it\b/i.test(t);
    return one("cosmos.object.extract", "extract", { object: extract[2].trim(), ...(wantsWorkspace ? { open: "workspace" } : {}) }, `take the ${extract[2].trim()} out and keep it as its own object`);
  }

  const duplicate = /\bduplicate|copy\b/i.exec(t);
  if (duplicate) {
    const of = /\b(?:duplicate|copy)\s+(?:the\s+)?([\w\s-]{2,30}?)(?:\s+and\b|\s*$)/i.exec(t)?.[1]?.trim();
    const smaller = /\bsmaller|half the size|scale it down\b/i.test(t);
    return one("cosmos.object.duplicate", "duplicate", { object: of ?? "it", ...(smaller ? { scale: 0.6 } : {}) }, `duplicate ${of ?? "it"}${smaller ? ", smaller" : ""}`);
  }

  // From here the verbs are shared with ordinary language ("remove the idler",
  // "make it smaller"), so they only mean Cosmos operations when there is a
  // Cosmos to act on, or the sentence says so.
  if (!gated) return null;

  if (/\b(isolate|only show|show only)\b/i.test(t) && /\b(object|engine|cabin|one)\b/i.test(t)) {
    const target = /\b(?:isolate|only show|show only)\s+(?:the\s+)?([\w\s-]{2,30})$/i.exec(t.trim())?.[1]?.trim();
    return one("cosmos.object.isolate", "isolate", { object: target ?? "" }, `show ${target ?? "the selected object"} alone`);
  }
  if (/\b(show all|everything back|unhide)\b/i.test(t)) return one("cosmos.object.isolate", "show all", { showAll: true }, "show every object again");

  if (/\b(group|collect|collection)\b/i.test(t) && /\bobjects?|them|into one|together\b/i.test(t)) {
    return one("cosmos.object.group", "group", { objects: [], name: /\bcalled\s+([\w\s-]{2,30})$/i.exec(t)?.[1]?.trim() }, "group the objects into one collection");
  }
  if (/\bungroup|split (them|the group) up\b/i.test(t)) {
    return one("cosmos.object.ungroup", "ungroup", { group: /\b(?:ungroup|split)\s+(?:the\s+)?([\w\s-]{2,30})$/i.exec(t.trim())?.[1]?.trim() ?? "" }, "ungroup them");
  }

  if (/\b(delete|remove|bin|get rid of)\b/i.test(t) && /\b(object|engine|cabin|it)\b/i.test(t)) {
    return one("cosmos.object.remove", "remove", { object: objectName(/\b(?:delete|remove|get rid of)\s+(?:the\s+)?([\w\s-]{2,30})/i) }, "remove it from the Cosmos (it stays in the trash)");
  }

  const motion = /\b(float|spin|rotate|orbit|bob|drift|turn|hover)\b/i.exec(t);
  if (motion && /\b(it|object|engine|cabin|molecule|everything)\b/i.test(t)) {
    const kind = /\borbit\b/i.test(t) ? "orbit" : /\bbob|hover\b/i.test(t) ? "bob" : /\bdrift|float away\b/i.test(t) ? "drift" : "spin";
    const slow = /\bslow(ly)?\b/i.test(t);
    const paused = /\bstop\b/i.test(t) && !/pause all/.test(lower);
    return one("cosmos.object.animate", "animate", { motion: kind, ...(slow ? { speed: 0.05 } : {}), ...(paused ? { paused: true } : {}) }, `make it ${kind}${slow ? " slowly" : ""}`);
  }

  // M17.3: relative placement and directional moves, read by one parser
  // (spatialIntent) and executed by the existing position tool, which
  // resolves both names against the store and asks when one is ambiguous.
  const spatial = parseSpatialIntent(t);
  if (spatial) {
    if (spatial.kind === "relative") {
      const ref = spatial.reference ? ` ${SPATIAL_WORDS[spatial.relation]} the ${spatial.reference}` : spatial.relation === "farther" ? " farther away" : " closer";
      return one(
        "cosmos.object.position",
        "move",
        { object: spatial.target, relation: spatial.relation, ...(spatial.reference ? { near: spatial.reference } : {}), degree: spatial.degree },
        `move ${/^(it|that|this)$/i.test(spatial.target) ? spatial.target : `the ${spatial.target}`}${ref}`,
      );
    }
    return one(
      "cosmos.object.position",
      "move",
      { object: spatial.target, direction: spatial.direction, degree: spatial.degree, ...(spatial.distance !== null ? { distance: spatial.distance } : {}) },
      `move ${/^(it|that|this)$/i.test(spatial.target) ? spatial.target : `the ${spatial.target}`} ${spatial.direction}`,
    );
  }

  const transform = /\b(make (?:it|the \w+) (?:bigger|smaller)|scale (?:it|them) (?:up|down)|rotate (?:it|them)\s+(\d{1,3})|turn (?:it|them)\s+(\d{1,3}))\b/i.exec(t);
  if (transform) {
    const smaller = /\bsmaller|down\b/i.test(t);
    const degrees = transform[2] ?? transform[3];
    return one("cosmos.object.transform", "transform", {
      ...(degrees ? { rotation: [0, Number(degrees), 0] } : { scale: smaller ? 0.6 : 1.6 }),
      relative: false,
    }, degrees ? `turn it ${degrees}°` : `make it ${smaller ? "smaller" : "bigger"}`);
  }

  return null;
}

function compileCommand(cmd: string, rest: string): DirectPlan | null {
  const explicit = true;
  switch (cmd) {
    case "art": {
      const style = pickStyle(rest), palette = pickPalette(rest);
      return { explicit, summary: `generative ${style} artwork (${palette})`, steps: [{ tool: "creative.art", label: "artwork", args: { title: `${titleCase(style)} — ${titleCase(palette)}`, style, palette, seed: seedFrom(rest || style), export: ["svg"] } }] };
    }
    case "diagram": {
      const structure = arrowsToStructure(rest);
      const mermaid = /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/.test(rest) ? rest : null;
      const args = mermaid ? { source: mermaid } : structure ?? { source: LELU_ARCHITECTURE };
      const title = mermaid || structure ? `Diagram — ${subjectOf(rest).slice(0, 40)}` : "LÉLU architecture";
      return { explicit, summary: `diagram (${mermaid ? "Mermaid source" : structure ? "from arrows" : "LÉLU architecture"})`, steps: [{ tool: "creative.diagram", label: "diagram", args: { title, ...args, export: ["mmd"] } }] };
    }
    case "read": {
      // Reading pages directly — one, or several at once so the conversation
      // can hold the research side by side. No model is involved.
      const urls = rest.split(/\s+/).map((v) => v.trim()).filter((v) => /^https?:\/\//i.test(v)).slice(0, 5);
      if (urls.length === 0) return { explicit, summary: "read a page", steps: [{ tool: "browser.read", label: "page", args: { url: rest.trim() } }] };
      return {
        explicit,
        summary: urls.length === 1 ? `read ${urls[0]}` : `read ${urls.length} pages`,
        steps: urls.map((url) => ({ tool: "browser.read", label: "page", args: { url } })),
      };
    }
    case "build": {
      // /build gearbox teethOut=36 | /build "a 2-storey cabin 7 by 5 m" | /build benzene
      // | /build gearbox teethIn=12 teethOut=36 source=https://… (a page is read
      //   and the figures are checked against it before anything is called sourced)
      const pairs: Record<string, string> = {};
      const sourced: string[] = [];
      let subject = rest;
      for (const token of rest.split(/\s+/)) {
        const source = /^source=(https?:\/\/\S+)$/i.exec(token);
        if (source) { sourced.push(source[1]); subject = subject.replace(token, " ").trim(); continue; }
        const m = /^([A-Za-z]\w*)=(.*)$/.exec(token);
        if (!m) continue;
        pairs[m[1]] = m[2];
        subject = subject.replace(token, " ").trim();
      }
      const builder = findBuilder(subject || rest);
      if (!builder && Object.keys(pairs).length === 0) return { explicit, summary: "what can be built", steps: [{ tool: "creative.domains", label: "domains", args: {} }] };
      const fromWords = builder && subject ? describeRequest(builder, subject) : {};
      const params: Record<string, unknown> = { ...fromWords, ...pairs };
      // Values that look numeric are numbers; the builder validates them.
      for (const [k, v] of Object.entries(params)) if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) params[k] = Number(v);
      return {
        explicit,
        summary: `construct ${builder ? builder.label : "an artifact"}${subject ? ` — “${subject.slice(0, 40)}”` : ""}${sourced.length ? ` from ${sourced.length} source${sourced.length === 1 ? "" : "s"}` : ""}`,
        steps: [{ tool: "creative.build", label: "build", args: { ...(builder ? { builder: builder.id } : {}), subject, params, ...(sourced.length ? { sources: sourced.map((url) => ({ url })) } : {}), export: ["glb"] } }],
      };
    }
    case "modify": {
      if (!rest) return { explicit, summary: "change a construction", steps: [{ tool: "creative.modify", label: "modify", args: {} }] };
      const wantsExport = /\bexport|glb|gltf\b/i.test(rest);
      return {
        explicit,
        summary: `change the construction: “${rest.slice(0, 60)}”`,
        steps: [{ tool: "creative.modify", label: "modify", args: { request: rest, ...(wantsExport ? { export: ["glb"] } : {}) } }],
      };
    }
    case "explain": {
      const topic = rest || "the whole thing";
      return { explicit, summary: `explain ${topic}`, steps: [{ tool: "creative.inspect", label: "explain", args: { topic } }] };
    }
    case "domains": {
      return { explicit, summary: "what can be constructed", steps: [{ tool: "creative.domains", label: "domains", args: {} }] };
    }
    case "cosmos": {
      if (!rest) return { explicit, summary: "every object in the Cosmos", steps: [{ tool: "cosmos.object.list", label: "objects", args: {} }] };
      const plan = cosmosPlan(rest);
      return plan ? { ...plan, explicit, summary: `cosmos: ${plan.summary}` } : { explicit, summary: "every object in the Cosmos", steps: [{ tool: "cosmos.object.list", label: "objects", args: {} }] };
    }
    case "engine": {
      return {
        explicit,
        summary: "four-stroke engine — assembly, layers, exploded view, cycle",
        steps: [{ tool: "creative.engine", label: "engine", args: { title: "Four-stroke engine — interactive assembly", export: ["glb"] } }],
      };
    }
    case "scene": {
      const preset = pickPreset(rest);
      return { explicit, summary: `3D ${preset} environment → GLB`, steps: [{ tool: "creative.scene3d", label: "3D scene", args: { title: `${titleCase(preset)} environment`, preset, seed: seedFrom(rest || preset), export: ["glb"] } }] };
    }
    case "film": {
      const subject = rest || "the cosmos", palette = pickPalette(rest);
      const mood = /\b(tense|dark|storm|thriller)\b/i.test(rest) ? "tense" : /\b(bright|happy|joy|summer|upbeat)\b/i.test(rest) ? "bright" : "calm";
      return { explicit, summary: `short film about “${subject}” (WebM, ${mood} soundtrack)`, steps: [{ tool: "creative.film", label: "film", args: { title: `${titleCase(subject)} — short film`, scenes: filmScenes(subject, palette), soundtrack: mood, width: 1280, height: 720, fps: 30 } }] };
    }
    case "chart": {
      if (/earthquake|seismic|usgs/i.test(rest) || !rest) {
        return { explicit, summary: "earthquakes this week (USGS) → interactive chart", steps: [
          { tool: "creative.chart", label: "magnitude vs depth", args: { title: "Earthquakes M4.5+ this week — magnitude vs depth (USGS)", connector: "usgs.earthquakes", query: { magnitude: "4.5", period: "week" }, kind: "scatter", export: ["html"] } },
          { tool: "creative.chart", label: "count per day", args: { title: "Earthquakes M4.5+ per day this week (USGS)", connector: "usgs.earthquakes", query: { magnitude: "4.5", period: "week" }, kind: "column", label: "day", aggregate: "count", export: ["html"] } },
        ] };
      }
      return null;
    }
    case "research": {
      const topic = rest.replace(/[?.!]+$/, "").slice(0, 120);
      return topic ? { explicit, summary: `research board on “${topic}” from public sources`, steps: [{ tool: "research.board", label: "research", args: { topic } }] } : null;
    }
    case "data": {
      const [connector, ...pairs] = rest.split(/\s+/);
      if (!CONNECTOR_IDS().includes(connector)) return { explicit, summary: "public data sources", steps: [{ tool: "data.sources", label: "sources", args: {} }] };
      const query: Record<string, string> = {};
      let free: string[] = [];
      for (const p of pairs) { const m = /^(\w+)=(.*)$/.exec(p); if (m) query[m[1]] = m[2]; else free.push(p); }
      if (free.length && !query.query && !query.title) query[connector === "wikipedia.summary" ? "title" : "query"] = free.join(" ");
      free = [];
      return { explicit, summary: `${connector} query`, steps: [{ tool: "data.query", label: connector, args: { connector, query } }] };
    }
    case "sketch": {
      const subject = rest || "concept";
      return { explicit, summary: `editable Excalidraw sketch of “${subject}”`, steps: [
        { tool: "studio.create", label: "sketch", args: { kind: "drawing", title: `Sketch — ${titleCase(subject)}`, scene: { elements: sketchElements(subject) } } },
      ] };
    }
    case "collection": {
      const theme = rest || "nocturne", palette = pickPalette(rest);
      return { explicit, summary: `fashion collection “${theme}”: moodboard, sketches, concept map, 3D runway`, steps: [
        { tool: "creative.art", label: "moodboard texture", args: { title: `${titleCase(theme)} — moodboard`, style: pickStyle(rest || "silk flow"), palette, seed: seedFrom(theme), caption: titleCase(theme), export: ["svg"] } },
        { tool: "studio.create", label: "editable sketches", args: { kind: "drawing", title: `${titleCase(theme)} — line-up sketches`, scene: { elements: sketchElements(`${theme} collection`) } } },
        { tool: "creative.diagram", label: "concept map", args: { title: `${titleCase(theme)} — concept`, source: `mindmap\n  root((${titleCase(theme)}))\n    Silhouettes\n      Column\n      Volume\n      Slip\n    Materials\n      Silk satin\n      Wool crepe\n      Organza\n    Palette\n      ${palette}\n    Story\n      ${titleCase(theme)} at night`, export: ["mmd"] } },
        { tool: "creative.scene3d", label: "3D runway", args: { title: `${titleCase(theme)} — runway`, preset: "runway", objects: (PALETTES[palette] ?? PALETTES.lelu).colors.slice(0, 3).map((c, i) => ({ id: `look-${i + 1}`, shape: "garment", color: c, position: [0, 0.3, 1 - i * 6], size: { height: 1.72, flare: [1.3, 0.8, 1.8][i] }, metalness: 0.3, roughness: 0.45 })), export: ["glb"] } },
      ] };
    }
    case "capabilities":
      return { explicit, summary: "device capabilities and offline tools", steps: [{ tool: "device.capabilities", label: "device", args: {} }, { tool: "tools.catalog", label: "offline tools", args: { filter: "offline" } }] };
    case "tools":
      return { explicit, summary: "tool catalog", steps: [{ tool: "tools.catalog", label: "catalog", args: { filter: rest } }] };
    case "world": {
      const format = (/\b(stl|obj|glb|gltf)\b/i.exec(rest)?.[1] ?? "stl").toLowerCase();
      // GLB is its own capability (world-export-gltf): the dispatcher refuses
      // it until the user has approved it, exactly as for a model's call.
      return format === "glb" || format === "gltf"
        ? { explicit, summary: "world objects → GLB", steps: [{ tool: "world.gltf", label: "GLB export", args: {} }] }
        : { explicit, summary: `world objects → ${format.toUpperCase()}`, steps: [{ tool: "world.export", label: `${format.toUpperCase()} export`, args: { format } }] };
    }
    case "export": {
      const m = /^(.*\S)\s+(svg|png|json|mmd|html|csv|glb|gltf|webm|excalidraw)$/i.exec(rest);
      return m ? { explicit, summary: `export ${m[1]} as ${m[2]}`, steps: [{ tool: "creative.export", label: "export", args: { artifact: m[1], format: m[2].toLowerCase() } }] } : null;
    }
    default:
      return null;
  }
}

/** Every command the direct path understands (shown when a command is unknown). */
export const DIRECT_COMMANDS = ["/build <subject> [param=value]", "/modify <change>", "/explain <layer or step>", "/domains", "/engine", "/read <url…>", "/world stl|obj|glb", "/art", "/diagram", "/scene", "/film", "/chart earthquakes", "/research", "/data", "/sketch", "/collection", "/capabilities", "/tools", "/export"];
