/**
 * ==========================================================
 * LÉLU — REFERENCE LABELS (metadata only, no images)
 *
 * What each recovered reference ACTUALLY shows (labelled by looking at the
 * downloaded file, not by trusting the link), its categories, and which
 * visual objects it informs. The images themselves stay in reference/
 * (Git-ignored, local only); this file is safe to commit.
 *
 * content:
 *   artwork | photo | still | key-art | interface   usable visual reference
 *   logo | placeholder                               the link's preview was a site logo or blank
 *
 * informs targets:
 *   family:<id>            a built theme family (ThemeFamilies.ts)
 *   layer:<kind>           a built renderer kind (WorldSchema LAYER_KINDS)
 *   place:<id>[:<era>]     a built Time & Place world (Places.ts)
 *   feature:<id>           an existing feature outside the world engine
 *   planned:<id>           NOT built yet: recorded so nothing is silently substituted
 *   character-style:<id>   a character-builder style; planned until a style exists
 * ==========================================================
 */

export const CATEGORIES = ["franchise", "character", "environment", "vehicle", "architecture", "animation", "clothing", "visual-style", "interface", "device", "aerial", "wildlife"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Content = "artwork" | "photo" | "still" | "key-art" | "interface" | "logo" | "placeholder";

export interface ReferenceLabel {
  shows: string;
  content: Content;
  categories: Category[];
  franchise?: string;
  informs: string[];
  /** The file does not show what the atlas entry describes. */
  mismatch?: string;
}

const L = (shows: string, content: Content, categories: Category[], informs: string[] = [], extra: Partial<ReferenceLabel> = {}): ReferenceLabel => ({ shows, content, categories, informs, ...extra });
const logo = (shows: string) => L(shows, "logo", []);

/** Labels for the files recovered from the 167 atlas links (codes I-xx, II-xx, III-xx). */
export const ATLAS_LABELS: Record<string, ReferenceLabel> = {
  "I-01": L("Holographic data centre: hexagonal pedestal, floating neon panels", "artwork", ["environment", "interface", "visual-style"], ["family:holo-hud", "layer:hud-rings", "layer:neural-sphere"]),
  "I-06": L("Person wearing a mixed-reality headset at home", "photo", ["device"], ["planned:mixed-reality-workspace"]),
  "I-11": L("Dark dashboard with a central glowing orb and side panels", "interface", ["interface", "visual-style"], ["family:holo-hud", "layer:neural-sphere"]),
  "I-22": L("3D brain tractography: colour-coded fibre bundles", "artwork", ["visual-style"], ["feature:neural-map-connectome", "family:quantum"]),
  "I-26": L("Mixed-reality workspace: floating windows in a real room", "interface", ["interface", "architecture"], ["planned:mixed-reality-workspace", "feature:thread-workspace"]),
  "I-27": L("Astrology interface collage: zodiac rings, constellations, panels", "artwork", ["interface", "visual-style"], ["family:celestial", "layer:zodiac-wheel", "layer:constellations"]),
  "I-28": L("Zodiac wheel illustration with sun face, navy and peach", "artwork", ["visual-style"], ["family:celestial", "layer:zodiac-wheel"]),
  "I-31": L("Symmetric fractal mandala in jewel tones", "artwork", ["visual-style"], ["family:sacred-geometry", "layer:kaleidoscope"]),
  "I-33": logo("Tool card for a kaleidoscope app (no artwork)"),
  "I-35": L("Lava river flowing at night under an eruption", "photo", ["environment"], ["family:volcano", "layer:lava-field", "layer:embers"]),
  "I-37": L("Aerial view of fissure vents and lava flows", "photo", ["environment", "aerial"], ["family:volcano", "layer:lava-field"]),
  "I-39": L("Obsidian spires over glowing lava channels", "artwork", ["environment"], ["family:volcano", "layer:volcano", "layer:lava-field"]),
  "I-41": L("Satellite view of a hurricane eye", "photo", ["environment", "aerial"], ["family:hurricane", "layer:storm-spiral"]),
  "I-42": L("Satellite view of a hurricane over open ocean", "photo", ["environment", "aerial"], ["family:hurricane", "layer:storm-spiral", "layer:ocean"]),
  "I-43": L("False-colour infrared hurricane over a coastline map", "photo", ["visual-style", "aerial"], ["family:hurricane", "layer:isobars"]),
  "I-44": L("Tornado under a rotating supercell over grassland", "photo", ["environment"], ["layer:tornado", "layer:clouds"]),
  "I-46": L("Purple lightning strikes from a storm cloud", "photo", ["environment"], ["layer:lightning", "family:hurricane"]),
  "I-47": L("Shelf cloud with lightning over plains", "photo", ["environment"], ["layer:lightning", "layer:clouds"]),
  "I-49": L("Cartoon fox in a scarf", "artwork", ["character", "animation"], [], { mismatch: "Atlas I·49 describes a bioluminescent coral forest; the page's preview image is an unrelated cartoon fox." }),
  "I-50": L("Underwater city of glowing domes", "artwork", ["environment", "architecture"], ["family:underwater"]),
  "I-52": L("Rainforest waterfall with ferns", "photo", ["environment"], ["family:valley", "family:summer"]),
  "I-53": L("River winding through a green mountain valley", "photo", ["environment"], ["family:valley", "layer:terrain"]),
  "I-55": L("Green blank graphic", "placeholder", []),
  "I-56": L("Frozen mirror lake between snowy mountains", "photo", ["environment"], ["family:winter"]),
  "I-57": L("Aurora over a snowy pine forest", "artwork", ["environment"], ["family:aurora", "family:winter", "layer:aurora"]),
  "I-58": L("One forest across four seasons", "artwork", ["environment"], ["family:spring", "family:summer", "family:autumn", "family:winter"]),
  "I-59": L("Tropical island beach with palms", "artwork", ["environment"], ["planned:tropical-island"]),
  "I-61": L("Neon-lit rainy alley with a motorbike", "artwork", ["environment", "vehicle"], ["family:urban-neon", "layer:rain"]),
  "I-62": L("Painterly character studies in the McGruder style", "artwork", ["character", "animation", "clothing", "visual-style"], ["character-style:cel-shaded-american-anime", "planned:toon-suburb"]),
  "I-63": logo("Freelancer logo (no portfolio art)"),
  "I-65": L("Street-pop comic: two friends at a neon bus stop in the rain", "artwork", ["character", "clothing", "visual-style", "environment"], ["family:street-comic", "layer:halftone", "layer:rain"]),
  "I-66": L("Doodle-art site showing dense hand-drawn line art", "interface", ["visual-style"], ["family:doodle", "layer:doodle"]),
  "I-67": L("Ink comic cover: bold contour, flat colour", "artwork", ["visual-style", "character"], ["family:street-comic"]),
  "I-70": L("Fractal mandala, dense mirrored detail", "artwork", ["visual-style"], ["family:sacred-geometry", "layer:kaleidoscope"]),
  "I-71": L("Psychedelic kaleidoscopic fractal", "artwork", ["visual-style"], ["family:liquid-prism", "layer:kaleidoscope"]),
  "I-72": L("Stone-textured organic kaleidoscopes", "artwork", ["visual-style"], ["layer:kaleidoscope"]),
  "I-75": L("Holographic presentation: glass cube with floating panels", "artwork", ["interface", "visual-style"], ["family:holo-hud", "family:liquid-prism"]),
  "II-04": L("Snow White animation cels", "photo", ["animation", "character", "franchise"], ["planned:painted-animation"], { franchise: "Disney" }),
  "II-07": logo("Cartoon Network logo"),
  "II-08": L("Collage of cartoon-channel characters and logos", "key-art", ["franchise", "animation"], ["planned:cartoon-era"], { franchise: "Cartoon Network / Jetix / Disney / Nickelodeon" }),
  "II-09": L("Static Shock key art: hero on a disc, blue electric arcs", "key-art", ["franchise", "character", "animation"], ["planned:electric-hero-style", "layer:lightning"], { franchise: "Static Shock (DC)" }),
  "II-12": L("GTA V screenshot page banner with the three leads", "key-art", ["franchise", "character"], ["planned:open-world-city"], { franchise: "Grand Theft Auto V" }),
  "II-13": logo("Star Wars logo (the concept-art gallery itself did not come through)"),
  "II-14": logo("Star Wars logo (the concept-art gallery itself did not come through)"),
  "II-15": L("Treasure Planet concept board: solar-sail ships, painted planets", "artwork", ["franchise", "environment", "vehicle"], ["planned:space-opera"], { franchise: "Treasure Planet (Disney)" }),
  "II-18": logo("WePresent logo (no Wakanda art)"),
  "II-20": L("Film still: Dora Milaje in a canyon", "still", ["franchise", "character", "clothing"], ["planned:afrofuturist"], { franchise: "Black Panther (Marvel)" }),
  "II-22": L("Film still: Paris street folding overhead", "still", ["franchise", "architecture", "environment"], ["planned:folding-city"], { franchise: "Inception" }),
  "II-24": L("The Matrix poster", "key-art", ["franchise", "character", "clothing"], ["family:digital-rain"], { franchise: "The Matrix" }),
  "II-35": L("Jaguar portrait, rosette coat", "photo", ["wildlife"], ["planned:biomimicry-materials"]),
  "II-41": L("Tokyo skyline at dusk", "photo", ["environment", "architecture"], ["place:tokyo:present", "family:urban-neon"]),
  "II-42": L("Aerial of Tokyo government district", "photo", ["architecture", "aerial"], ["place:tokyo:present"]),
  "II-43": L("Shibuya crossing by day", "photo", ["architecture", "environment"], ["place:tokyo:present"]),
  "II-44": L("Downtown Lakeland logo over a photo", "logo", ["environment"]),
  "II-46": L("Tampa skyline over the river at golden hour", "photo", ["environment", "architecture"], ["place:tampa:present"]),
  "III-01": L("Closed Blockbuster store exterior", "photo", ["architecture"], ["planned:retro-video-store"], { franchise: "Blockbuster" }),
  "III-02": L("The last Blockbuster storefront", "photo", ["architecture", "franchise"], ["planned:retro-video-store"], { franchise: "Blockbuster" }),
  "III-05": L("Kash n' Karry supermarket front", "photo", ["architecture", "franchise"], ["planned:retro-grocery"], { franchise: "Kash n' Karry" }),
  "III-07": logo("Sprouts promotional logo"),
  "III-10": L("Twitter homepage, 2006", "interface", ["interface"], ["planned:early-web"]),
  "III-11": L("Twitter homepage 2006 beside 2026", "interface", ["interface"], ["planned:early-web"]),
  "III-13": logo("Bandai Namco logo"),
  "III-14": L("Collage of popular toys across decades", "photo", ["device", "franchise"], ["planned:retro-bedroom"]),
  "III-15": L("Original PlayStation console", "photo", ["device"], ["planned:retro-bedroom"], { franchise: "PlayStation" }),
  "III-16": L("PlayStation 2 console", "photo", ["device"], ["planned:retro-bedroom"], { franchise: "PlayStation" }),
  "III-21": logo("Rockstar Games logo (no Midnight Club art)"),
  "III-22": logo("Museum of Everything logo (no concept cars)"),
  "III-23": logo("Audrain Automobile Museum logo (no cars)"),
  "III-24": L("PlayStation console line-up", "key-art", ["device"], ["planned:retro-bedroom"], { franchise: "PlayStation" }),
  "III-27": L("Black-and-white aerial of Tampa streets, 1957–60", "photo", ["aerial", "architecture"], ["place:tampa:1958"]),
  "III-28": L("Aerial of Davis Islands area before development", "photo", ["aerial"], ["place:tampa:c1920"]),
  "III-32": logo("Motown Museum logo over the building"),
  "III-37": logo("Pixar logo"),
  "III-38": logo("Nickelodeon logo"),
  "III-39": logo("Nickelodeon logo"),
  "III-40": logo("Nickelodeon logo"),
  "III-42": L("Vogue Runway banner with models", "key-art", ["clothing"], ["planned:copper-atelier"]),
  "III-44": L("Copper-coloured blank with a 'Cu' mark", "placeholder", []),
};

/** The owner's own uploads (phone screenshots), codes U-xx. */
export const USER_LABELS: Record<string, ReferenceLabel> = {
  "U-01": L("Blockbuster storefront at night in the rain, neon and palms, a car parked out front", "artwork", ["architecture", "franchise", "vehicle", "environment", "visual-style"], ["planned:retro-video-store", "layer:rain", "family:urban-neon"], { franchise: "Blockbuster" }),
  "U-02": L("Blockbuster 'new release' wall: VHS and DVD racks, yellow wall", "photo", ["architecture", "franchise"], ["planned:retro-video-store"], { franchise: "Blockbuster" }),
  "U-03": L("Wall of VHS tapes around a CRT showing a Blockbuster Video ad", "artwork", ["device", "franchise"], ["planned:retro-video-store", "planned:retro-bedroom"], { franchise: "Blockbuster" }),
  "U-04": L("Lightsaber duel above a lava sea under an eclipsed sun", "artwork", ["franchise", "character", "environment"], ["family:volcano", "layer:lava-field", "layer:embers", "planned:space-opera"], { franchise: "Star Wars" }),
  "U-05": L("Hooded figure with a blue blade under twin suns in a hazy desert", "artwork", ["franchise", "character", "environment"], ["planned:binary-desert", "layer:sky"], { franchise: "Star Wars" }),
  "U-06": L("Two-tone splash silhouette of a small sage with a green blade", "artwork", ["franchise", "character", "visual-style"], ["planned:two-tone-silhouette-style"], { franchise: "Star Wars" }),
  "U-07": L("White silhouette of a boy with a tall afro beside a serif title", "key-art", ["franchise", "character", "visual-style"], ["character-style:cel-shaded-american-anime"], { franchise: "The Boondocks" }),
  "U-08": L("Two brothers looking down into frame against cloudy sky, cel-shaded", "still", ["franchise", "character", "animation", "clothing"], ["character-style:cel-shaded-american-anime", "planned:toon-suburb"], { franchise: "The Boondocks" }),
};
