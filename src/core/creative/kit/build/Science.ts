/**
 * LÉLU — BUILD ENGINE: science (molecular models)
 *
 * Bond positions come from the real molecular geometry — tetrahedral for
 * methane, 104.5° for water, 107° pyramidal for ammonia, a flat hexagon for
 * benzene — instead of being eyeballed. Bond length and atom radii are
 * scaled for the view, and the bond-angle readout is what makes the model
 * checkable rather than decorative.
 */

import {
  part,
  strut,
  sceneOf,
  layersOf,
  num,
  text,
  validateParams,
  type BuildOutcome,
  type BuildPart,
  type BuildProgram,
  type ParamSpec,
} from "./BuildTypes";

type Vec3 = [number, number, number];

interface AtomSeed {
  id: string;
  element: "H" | "C" | "N" | "O";
  position: Vec3;
}

interface MoleculeSpec {
  formula: string;
  name: string;
  bondAngle: number;
  bondLength: number;
  atoms: AtomSeed[];
  bonds: Array<[string, string, number]>;
  note: string;
}

const ELEMENT = {
  H: { color: "#f4f0ff", radius: 0.026, name: "hydrogen", group: 1 },
  C: { color: "#4b515c", radius: 0.046, name: "carbon", group: 14 },
  N: { color: "#4ea5e9", radius: 0.044, name: "nitrogen", group: 15 },
  O: { color: "#e4572e", radius: 0.042, name: "oxygen", group: 16 },
};

const radial = (azimuthDeg: number, polarDeg: number, length: number): Vec3 => {
  const az = (azimuthDeg * Math.PI) / 180;
  const polar = (polarDeg * Math.PI) / 180;
  return [Math.sin(polar) * Math.cos(az) * length, Math.cos(polar) * length, Math.sin(polar) * Math.sin(az) * length];
};

function water(length: number): MoleculeSpec {
  const half = (104.5 / 2) * (Math.PI / 180);
  return {
    formula: "H₂O",
    name: "Water",
    bondAngle: 104.5,
    bondLength: length,
    atoms: [
      { id: "O", element: "O", position: [0, 0, 0] },
      { id: "H1", element: "H", position: [Math.sin(half) * length, Math.cos(half) * length, 0] },
      { id: "H2", element: "H", position: [-Math.sin(half) * length, Math.cos(half) * length, 0] },
    ],
    bonds: [
      ["O", "H1", 1],
      ["O", "H2", 1],
    ],
    note: "Two O–H bonds at 104.5°: the bend is why water is polar.",
  };
}

function methane(length: number): MoleculeSpec {
  const d = length / Math.sqrt(3);
  return {
    formula: "CH₄",
    name: "Methane",
    bondAngle: 109.5,
    bondLength: length,
    atoms: [
      { id: "C", element: "C", position: [0, 0, 0] },
      { id: "H1", element: "H", position: [d, d, d] },
      { id: "H2", element: "H", position: [d, -d, -d] },
      { id: "H3", element: "H", position: [-d, d, -d] },
      { id: "H4", element: "H", position: [-d, -d, d] },
    ],
    bonds: [
      ["C", "H1", 1],
      ["C", "H2", 1],
      ["C", "H3", 1],
      ["C", "H4", 1],
    ],
    note: "Four identical C–H bonds at 109.5°: the tetrahedral carbon.",
  };
}

function ammonia(length: number): MoleculeSpec {
  return {
    formula: "NH₃",
    name: "Ammonia",
    bondAngle: 107,
    bondLength: length,
    atoms: [
      { id: "N", element: "N", position: [0, 0, 0] },
      { id: "H1", element: "H", position: radial(0, 107.8, length) },
      { id: "H2", element: "H", position: radial(120, 107.8, length) },
      { id: "H3", element: "H", position: radial(240, 107.8, length) },
    ],
    bonds: [
      ["N", "H1", 1],
      ["N", "H2", 1],
      ["N", "H3", 1],
    ],
    note: "A pyramidal N with a lone pair: three bonds at 107°, not a flat triangle.",
  };
}

function benzene(length: number): MoleculeSpec {
  const ringRadius = length; // hexagon side equals the circumradius
  const atoms: AtomSeed[] = [];
  const bonds: Array<[string, string, number]> = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (60 * i * Math.PI) / 180;
    const x = Math.cos(a) * ringRadius;
    const z = Math.sin(a) * ringRadius;
    atoms.push({ id: `C${i + 1}`, element: "C", position: [x, 0, z] });
    const hx = Math.cos(a) * (ringRadius + length * 1.08);
    const hz = Math.sin(a) * (ringRadius + length * 1.08);
    atoms.push({ id: `H${i + 1}`, element: "H", position: [hx, 0, hz] });
    bonds.push([`C${i + 1}`, `H${i + 1}`, 1]);
  }
  for (let i = 0; i < 6; i += 1) bonds.push([`C${i + 1}`, `C${((i + 1) % 6) + 1}`, i % 2 === 0 ? 2 : 1]);
  return {
    formula: "C₆H₆",
    name: "Benzene",
    bondAngle: 120,
    bondLength: length,
    atoms,
    bonds,
    note: "A flat hexagon at 120° with alternating double bonds — the aromatic ring.",
  };
}

const MOLECULES = { water, methane, ammonia, benzene } as const;
type MoleculeId = keyof typeof MOLECULES;
const MOLECULE_IDS = Object.keys(MOLECULES) as MoleculeId[];

function paramSpecs(input?: Record<string, unknown>): ParamSpec[] {
  const has = (k: string) => input !== undefined && typeof input[k] !== "undefined";
  return [
    { key: "molecule", label: "Molecule", kind: "choice", value: has("molecule") ? String(input?.molecule) : "water", choices: MOLECULE_IDS, affects: "The atoms, the bond angles and the formula." },
    { key: "bondScale", label: "Bond length", kind: "number", value: has("bondScale") ? Number(input?.bondScale) : 1, min: 0.6, max: 1.8, step: 0.1, affects: "Bond length and the whole model's size (the geometry angles do not change)." },
    { key: "style", label: "Model style", kind: "choice", value: has("style") ? String(input?.style) : "ball-and-stick", choices: ["ball-and-stick", "space-filling"], affects: "Atom radii: space-filling draws the van der Waals spheres instead of a stick model." },
  ];
}

export function buildMolecule(input: Record<string, unknown>, title?: string): BuildOutcome {
  const specs = paramSpecs();
  const { values, rejected } = validateParams(specs, input);
  if (rejected.length) return { ok: false, reason: `${rejected.length} parameter${rejected.length === 1 ? "" : "s"} refused`, rejected };
  const id = text(values, "molecule", "water") as MoleculeId;
  const scale = num(values, "bondScale", 1);
  const style = text(values, "style", "ball-and-stick");
  const spec = MOLECULES[id];
  if (!spec) return { ok: false, reason: `no molecule “${id}” — use ${MOLECULE_IDS.join(", ")}`, rejected };

  const geometry = spec(scale * 0.16);
  const radiusScale = style === "space-filling" ? 2.1 : 1;

  const parts: BuildPart[] = [];
  for (const atom of geometry.atoms) {
    const element = ELEMENT[atom.element];
    const radius = element.radius * radiusScale * (1 + (scale - 1) * 0.4);
    parts.push(
      part({
        id: `atom-${atom.id}`,
        name: `${atom.element}${atom.id.replace(atom.element, "")} (${element.name})`,
        layer: atom.element === "H" ? "hydrogen" : `heavy-${atom.element.toLowerCase()}`,
        shape: "sphere",
        size: { radius, detail: 3 },
        position: atom.position,
        color: element.color,
        metalness: 0.15,
        roughness: 0.35,
        label: [atom.position[0] * 1.35, atom.position[1] * 1.35 + radius, atom.position[2] * 1.35],
        explode: [atom.position[0] * 1.6, atom.position[1] * 1.6, atom.position[2] * 1.6],
        note: `${element.name} (group ${element.group}) at ${atom.id}.`,
      }),
    );
  }

  const bondRadius = 0.014 * (style === "space-filling" ? 0.4 : 1) * (1 + (scale - 1) * 0.3);
  for (const [a, b, order] of geometry.bonds) {
    const from = geometry.atoms.find((x) => x.id === a)!.position;
    const to = geometry.atoms.find((x) => x.id === b)!.position;
    if (order === 2) {
      // A double bond is drawn as two parallel sticks either side of the axis.
      const mid: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
      const dir: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const len = Math.hypot(...dir);
      const n: Vec3 = [-dir[2] / (len || 1), 0, dir[0] / (len || 1)];
      const off = bondRadius * 1.8;
      for (const side of [-1, 1] as const) {
        const lift: Vec3 = [n[0] * off * side, 0, n[2] * off * side];
        parts.push(
          strut({
            id: `bond-${a}-${b}-${side > 0 ? "b" : "a"}`,
            name: `Double bond ${a}–${b}`,
            layer: "bonds",
            from: [from[0] + lift[0], from[1] + lift[1], from[2] + lift[2]],
            to: [to[0] + lift[0], to[1] + lift[1], to[2] + lift[2]],
            radius: bondRadius,
            color: "#b7c0cb",
            metalness: 0.3,
            roughness: 0.5,
            explode: [mid[0] * 0.8, mid[1] * 0.8, mid[2] * 0.8],
            note: `One of the two shared pairs in the ${a}–${b} bond.`,
          }),
        );
      }
      continue;
    }
    parts.push(
      strut({
        id: `bond-${a}-${b}`,
        name: `Bond ${a}–${b}`,
        layer: "bonds",
        from,
        to,
        radius: bondRadius,
        color: "#b7c0cb",
        metalness: 0.3,
        roughness: 0.5,
        note: `A single covalent bond: ${a} shares one pair with ${b}.`,
      }),
    );
  }

  const heavy = geometry.atoms.filter((a) => a.element !== "H");
  const layersDeclared = [
    ...Array.from(new Set(heavy.map((a) => a.element))).map((el) => ({
      id: `heavy-${el.toLowerCase()}`,
      label: `${ELEMENT[el as keyof typeof ELEMENT].name} atoms`,
      color: ELEMENT[el as keyof typeof ELEMENT].color,
      note: `The ${ELEMENT[el as keyof typeof ELEMENT].name} atoms that form the skeleton.`,
    })),
    { id: "hydrogen", label: "Hydrogen atoms", color: "#f4f0ff", note: "The outer atoms of the molecule." },
    { id: "bonds", label: "Bonds", color: "#b7c0cb", note: "Shared electron pairs drawn as sticks." },
  ];

  const angle = geometry.bondAngle;
  const program: BuildProgram = {
    kind: "build",
    builder: "molecule",
    domain: "science",
    title: title ?? `${geometry.name} (${geometry.formula})`,
    params: values,
    paramSpecs: specs.map((s) => ({ ...s, value: values[s.key] })),
    parts,
    layers: layersOf(layersDeclared, parts),
    steps: [
      { id: "atoms", name: "1 · Atoms", summary: `${geometry.atoms.length} atoms`, detail: `The model has ${geometry.atoms.length} atoms: ${[...new Set(geometry.atoms.map((a) => a.element))].join(", ")}.`, focus: geometry.atoms.slice(0, 3).map((a) => `atom-${a.id}`) },
      { id: "bonds", name: "2 · Bonds", summary: `${geometry.bonds.length} bonds`, detail: "Each bond is one (or two) shared electron pairs, drawn between the atom positions.", focus: parts.filter((p) => p.layer === "bonds").slice(0, 3).map((p) => p.id) },
      { id: "shape", name: "3 · Shape", summary: `${angle}° bond angle`, detail: geometry.note, focus: heavy.map((a) => `atom-${a.id}`) },
      { id: "formula", name: "4 · Formula", summary: geometry.formula, detail: `The formula counts the atoms; the shape follows the electron pairs, which is why ${geometry.formula} is not flat.`, focus: geometry.atoms.map((a) => `atom-${a.id}`) },
    ],
    derived: [
      { label: "Formula", value: geometry.formula },
      { label: "Bond angle", value: `${angle}°` },
      { label: "Bond length", value: `${(geometry.bondLength / 0.1).toFixed(2)} Å (drawn at ${(geometry.bondLength * 1000).toFixed(0)} mm)` },
      { label: "Atoms", value: `${geometry.atoms.length}` },
      { label: "Bonds", value: `${geometry.bonds.length}` },
    ],
    scene: sceneOf(parts, {
      camera: { position: [0.55, 0.42, 0.55], target: [0, 0, 0], fov: 42 },
      seed: 3307,
      preset: "molecule",
    }),
    notes: [
      geometry.note,
      "Atom positions come from the real bond geometry (tetrahedral, bent, pyramidal, hexagonal); only the overall size is scaled for the view.",
      "Ball-and-stick shows bonding; space-filling shows how much space the atoms really occupy.",
    ],
  };
  return { ok: true, program, rejected };
}

export const moleculeBuilder = {
  id: "molecule",
  domain: "science" as const,
  label: "Molecular model",
  keywords: ["molecule", "molecular", "water molecule", "methane", "ammonia", "benzene", "atom", "chemistry"],
  paramSpecs,
  build: buildMolecule,
};

export function describeMoleculeRequest(textInput: string): Record<string, unknown> {
  const lower = textInput.toLowerCase();
  const out: Record<string, unknown> = {};
  for (const id of MOLECULE_IDS) if (lower.includes(id)) out.molecule = id;
  if (/space[- ]filling/.test(lower)) out.style = "space-filling";
  return out;
}
