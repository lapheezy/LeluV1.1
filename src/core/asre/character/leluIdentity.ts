/**
 * ==========================================================
 * LÉLU — CANONICAL DIGITAL-HUMAN IDENTITY
 *
 * This is not a character preset. It is LÉLU, transcribed from her own locked
 * identity file and her design references:
 *
 *   leluverse/assets/characters/lelu_character/identity/identity.json
 *   leluverse/assets/characters/lelu_character/references/ref10_face_primary.png
 *   leluverse/assets/wardrobe/inventory.json
 *
 * Everything here comes from those files, and only an explicit relock changes
 * it (see `identity.json` → `rule`). Hair, outfit, pose, expression and
 * accessories are the things she may vary around it — those live in the
 * CharacterSpec, not here.
 *
 * Colours are sRGB (the build converts to linear for the GLB), sampled from her
 * primary reference.
 * ==========================================================
 */
import type { Rgb } from "./shape.ts";
import { BASE_CHARACTER, withChanges, type CharacterSpec } from "./CharacterSpec.ts";
/**
 * The CC0 morph targets that carry her ancestry and build. Paths, not imports:
 * the character layer must not depend on the Node asset loader.
 */
const TARGETS = {
  africanFemale: "targets/macrodetails/universal-female-young-african-average-1.target",
  femaleYoung: "targets/macrodetails/universal-female-young-average-1.target",
};

/**
 * Her FACE as anatomy, transcribed from identity.json with CC0 morph targets
 * (`path@weight`). These used to be faked in paint on a generic face — a
 * painted lid line on a lid of the wrong shape is what read as artificial.
 *
 *   faceShape "oval, high defined cheekbones … rounded chin" (ref10 is rounder
 *             than the base head)            → head-round, cheek-bones
 *   eyes      "almond … slightly upturned outer corners"
 *                                            → eye-height2 (opening), corner1-up
 *                                              (outer), corner2-down (inner)
 *   lips      "full lips, defined cupid's bow, fuller lower lip"
 *                                            → lower/upper-lip volume, cupid's bow
 *   nose      "softly rounded tip, moderately full alae"
 *                                            → nose-flaring, nose-point-width
 */
/*
 * FITTED (WP04): these weights were solved, not chosen. scripts/asre/lelu-fit-face.py
 * measured 25 landmark metrics on orthographic renders of her head and fitted
 * signed CC0 morph parameters to the mean of her six independent frontal
 * references (Gauss-Newton, Tikhonov to the start, bounds +-1).
 *   pass 1, all parameters:                              RMS z 4.60 -> 1.45
 *   pass 2, brows/lips painted in her landmark units:    RMS z 1.20 -> 0.81
 *   pass 3, + skull crown (2.05 +- 0.08 IOD over the
 *           pupils, from her hair crown less sleek hair):  crown 2.39 -> 2.13 IOD
 *   pass 4, temples/cheeks/eyes/jaw/vault with the crown: RMS z 0.95 -> 0.88
 * Parameters: {"eye_spacing": 0.835, "eye_scale": -0.351, "eye_open": 0.565, "eye_tilt": 0.482, "brow_height": 0.589, "nose_width": -0.862, "nose_length": -1.0, "nose_flare": -0.164, "mouth_width": 0.603, "upper_lip": 1.0, "lower_lip": 0.143, "head_width": -1.0, "head_height": -1.0, "head_round": 0.384, "cheek_bones": 0.958, "chin_width": -0.931, "jaw_width": 0.765, "chin_height": 0.197, "forehead_height": 0.602}
 */
export const LELU_FACE_TARGETS = [
  "targets/eyes/l-eye-corner2-down.target@0.2",
  "targets/eyes/r-eye-corner2-down.target@0.2",
  "targets/mouth/mouth-lowerlip-volume-incr.target@0.7",
  "targets/mouth/mouth-upperlip-volume-incr.target@0.5",
  "targets/mouth/mouth-cupidsbow-incr.target@0.6",
  "targets/nose/nose-point-width-incr.target@0.25",
  "targets/eyes/l-eye-trans-out.target@0.8345",
  "targets/eyes/r-eye-trans-out.target@0.8345",
  "targets/eyes/l-eye-scale-decr.target@0.3509",
  "targets/eyes/r-eye-scale-decr.target@0.3509",
  "targets/eyes/l-eye-height2-incr.target@0.5649",
  "targets/eyes/r-eye-height2-incr.target@0.5649",
  "targets/eyes/l-eye-corner1-up.target@0.4820",
  "targets/eyes/r-eye-corner1-up.target@0.4820",
  "targets/eyebrows/eyebrows-trans-up.target@0.5894",
  "targets/nose/nose-scale-horiz-decr.target@0.8621",
  "targets/nose/nose-scale-vert-decr.target@1.0000",
  "targets/nose/nose-flaring-decr.target@0.1638",
  "targets/mouth/mouth-scale-horiz-incr.target@0.6030",
  "targets/mouth/mouth-upperlip-height-incr.target@1.0000",
  "targets/mouth/mouth-lowerlip-height-incr.target@0.1434",
  "targets/head/head-scale-horiz-decr.target@1.0000",
  "targets/head/head-scale-vert-decr.target@1.0000",
  "targets/head/head-round.target@0.3839",
  "targets/cheek/l-cheek-bones-incr.target@0.9576",
  "targets/cheek/r-cheek-bones-incr.target@0.9576",
  "targets/chin/chin-width-decr.target@0.9310",
  "targets/chin/chin-bones-incr.target@0.7651",
  "targets/chin/chin-height-incr.target@0.1975",
  "targets/forehead/forehead-scale-vert-incr.target@0.6020",
];

/**
 * Expressions (identity.mayChange includes "expression"): weighted CC0
 * facial expression units for an African face (MakeHuman expression/units),
 * applied as real deformation of her face. Her lid margins, liner and lashes
 * are measured on every build, so they follow the expression.
 */
const EXPR = (unit: string, w: number) => `targets/expression/units/african/${unit}.target@${w}`;
export const LELU_EXPRESSIONS: Record<string, string[]> = {
  neutral: [],
  // her canonical, ref10: composed, a hint of a smile, softly lowered lids
  composed: [EXPR("mouth-corner-puller", 0.14), EXPR("eye-left-slit", 0.12), EXPR("eye-right-slit", 0.12)],
  smile: [EXPR("mouth-corner-puller", 0.6), EXPR("mouth-elevation", 0.12), EXPR("eye-left-slit", 0.3), EXPR("eye-right-slit", 0.3), EXPR("eyebrows-left-extern-up", 0.15), EXPR("eyebrows-right-extern-up", 0.15)],
  sultry: [EXPR("eye-left-slit", 0.42), EXPR("eye-right-slit", 0.42), EXPR("mouth-parling", 0.25), EXPR("eyebrows-left-extern-up", 0.2), EXPR("eyebrows-right-extern-up", 0.2)],
  surprise: [EXPR("eyebrows-left-up", 0.65), EXPR("eyebrows-right-up", 0.65), EXPR("eye-left-opened-up", 0.5), EXPR("eye-right-opened-up", 0.5), EXPR("mouth-open", 0.3)],
};

/** Her anatomy targets with an expression applied. */
export function leluTargets(expression = "composed"): string[] {
  return [TARGETS.africanFemale, TARGETS.femaleYoung, ...LELU_FACE_TARGETS, ...(LELU_EXPRESSIONS[expression] ?? [])];
}

/** Her locked face and body, quoted from identity.json → preserve. */
export const LELU_IDENTITY = {
  id: "lelu-canonical",
  name: "LÉLU",
  primaryReference: "ref10_face_primary",
  faceShape: "Oval face, high defined cheekbones, softly tapered jaw and rounded chin.",
  eyes: "Almond-shaped warm brown eyes, slightly upturned outer corners, winged liner, long dense lashes, moderate spacing.",
  brows: "Full, dark, softly arched brows with a clean tail.",
  nose: "Straight bridge, softly rounded tip, moderately full alae.",
  lips: "Full lips, defined cupid's bow, fuller lower lip, glossy deep berry-brown colour.",
  skin: "Deep warm brown complexion with a soft sheen; light freckles across cheeks and nose.",
  markings: "Small star marks high on the cheekbones; dark swirl/curl markings at the forehead and temples; rose-quartz jewel at the hairline centre with a small crystal drop between the brows.",
  piercings: "Septum ring; centred lower-lip (labret) stud with small drop; large rose-gold hoop earrings.",
  tattoos: "Ornamental filigree across collarbones and chest; rose and filigree tattoos on hands and forearms.",
  hairline: "Centre part; dense black corkscrew curls framing the face, pink/magenta highlights.",
  mayChange: ["outfit", "hairstyle", "pose", "expression", "accessories"],
} as const;

/** Her palette, sampled from ref10 / ref01 and the wardrobe boards. */
export const LELU_COLOURS = {
  /**
   * Warm copper-tan, measured off ref10: the reference is a light-to-medium
   * brown with strong copper warmth, not a deep brown. At 0.30/0.16/0.10 the
   * render read almost black under her lighting, which is what stopped her
   * reading as herself.
   */
  skin: [0.44, 0.26, 0.165] as Rgb,
  /** Shadow and crease tone, used for freckles and lid shading. */
  skinShade: [0.3, 0.165, 0.105] as Rgb,
  /** Glossy deep berry lips: redder and juicier than a brown-plum. */
  lip: [0.33, 0.085, 0.1] as Rgb,
  lipHighlight: [0.5, 0.16, 0.17] as Rgb,
  /** Warm brown iris with a darker limbal ring. */
  iris: [0.25, 0.135, 0.06] as Rgb,
  irisRing: [0.13, 0.065, 0.035] as Rgb,
  /** Warm off-white, never pure white: a white sclera is what made her eyes
   * read as two bright slits. */
  sclera: [0.66, 0.6, 0.555] as Rgb,
  /** Upper-lid shadow over the top of the eyeball: what stops eyes reading
   * as two white balls. */
  lidShadow: [0.28, 0.2, 0.16] as Rgb,
  pupil: [0.02, 0.02, 0.03] as Rgb,
  /** Black curls with rose-magenta highlights. */
  hair: [0.055, 0.045, 0.05] as Rgb,
  hairRose: [0.55, 0.16, 0.3] as Rgb,
  /** Rose gold and copper: her metal, used for every jewel. */
  roseGold: [0.86, 0.53, 0.43] as Rgb,
  copper: [0.66, 0.34, 0.22] as Rgb,
  roseQuartz: [0.93, 0.64, 0.68] as Rgb,
  /** Ink for tattoos and her forehead swirls. */
  ink: [0.12, 0.09, 0.12] as Rgb,
  /** Star marks: pale gold on deep skin. */
  star: [0.93, 0.78, 0.56] as Rgb,
  /** Corset: dark camo ground with coral roses. */
  corset: [0.17, 0.19, 0.14] as Rgb,
  corsetRose: [0.66, 0.32, 0.3] as Rgb,
  /** Cargo trousers and platform boots. */
  cargo: [0.16, 0.15, 0.13] as Rgb,
  boot: [0.09, 0.085, 0.08] as Rgb,
} as const;

/** Proportions read off her full-body boards: slender, long-legged. */
export const LELU_BODY = {
  height: 1.7,
  shoulderWidth: 0.375,
  hipWidth: 0.335,
  build: 0.97,
  legRatio: 0.5,
  armRatio: 1,
};

/**
 * Her canonical spec: LÉLU at rest, with her identity locked and her hair in
 * its documented centre-part curl state. Outfit and pose here are the base
 * look from ref01; the wardrobe swaps them without touching identity.
 */
export function leluCanon(): CharacterSpec {
  const spec = withChanges(BASE_CHARACTER, {
    body: LELU_BODY,
    face: { headScale: 1, eyeSize: 1, eyeSpacing: 1, noseSize: 1 },
    hair: { style: "long-wavy", length: 1, volume: 1.05 },
    clothing: { top: "jacket", bottom: "pants", shoes: true },
    materials: {
      skin: LELU_COLOURS.skin,
      hair: LELU_COLOURS.hair,
      top: LELU_COLOURS.corset,
      bottom: LELU_COLOURS.cargo,
      shoes: LELU_COLOURS.boot,
      accessory: LELU_COLOURS.roseGold,
      eyes: LELU_COLOURS.iris,
    },
    hands: { curl: 0.3, spread: 0.4, opposition: 0.55 },
    feet: { toeCurl: 0 },
    anatomy: { source: "reference", targets: leluTargets("composed") },
  });
  // The identity is the lock: every identity-driven branch (her marks, her
  // jewelry, her hair colour) reads it, and only an approved relock changes it.
  return { ...spec, identity: { id: LELU_IDENTITY.id, name: LELU_IDENTITY.name, leluLook: "canonical" } };
}

/** True when this spec is LÉLU herself (as opposed to a generated variation). */
export function isLelu(spec: CharacterSpec): boolean {
  return spec.identity.id === LELU_IDENTITY.id;
}

/**
 * A derivative of LÉLU: any variation of look, pose, outfit or hairstyle that
 * still carries her canonical identity. This is AVATAR DUPLICATION MODE — a
 * copy she can dress and animate, never a new identity.
 */
export function leluDerivative(patch: Parameters<typeof withChanges>[1]): CharacterSpec {
  return { ...withChanges(leluCanon(), patch), identity: { id: LELU_IDENTITY.id, name: LELU_IDENTITY.name, leluLook: patch.hair?.style ?? "canonical" } };
}
