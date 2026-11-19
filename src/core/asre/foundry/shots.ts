/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — THE THIRTEEN BENCHMARK SHOTS
 *
 * Part VIII asks for thirteen individual technical renders, each proving a
 * different thing. They are declared here as data so the renderer, the CLI, the
 * API and the test all agree on what "the benchmark" means, and so each image
 * carries the reference it is compared against and the question it answers.
 *
 * Framing numbers come from the mesh's own measurements (`metrics-youth.json`),
 * converted to Blender's Z-up metres. Where a shot needs no surgical framing the
 * camera is left to the renderer's measured bounds — a full-body shot that
 * hard-codes a radius is a shot that breaks the moment the body grows.
 * ==========================================================
 */

export type ViewName = "front" | "three-quarter" | "side" | "back";

export interface CameraFrame {
  /** Blender Z-up metres. */
  center: [number, number, number];
  radius: number;
}

export interface FoundryShot {
  id: string;
  index: number;
  title: string;
  /** The part of the character the shot is about. */
  proves: string;
  view: ViewName;
  focus: string[];
  camera: CameraFrame | null;
  resolution: [number, number];
  samples: number;
  /** Focal length. Tight shots use a long lens so the camera clears the hair:
   *  a short lens at the same framing has to sit inside the hairstyle. */
  lens?: number;
  ground: boolean;
  /** Lit world for metals; technical shots keep the dark studio. */
  environment?: boolean;
  /** Reference file this shot is compared against (relative to the reference root). */
  reference: string | null;
  /** The mission's numbered benchmark item. */
  benchmark: number;
}

interface MetricsLike {
  eyes?: { centresMm?: Array<{ x: number; y: number; z: number }> };
  face?: { faceZ?: number };
  youth?: { landmarks?: { eyeY?: number; chinY?: number; mouthY?: number; faceZ?: number } };
  hair?: { hairlineFrontY?: number };
  head?: { heightMm?: number };
}

/** Landmarks arrive in metres from the build; older manifests used millimetres. */
const asMetres = (v: number) => Number((v > 100 ? v / 1000 : v).toFixed(4));

/**
 * Plan the shots from measured landmarks. The only numbers that are not read
 * from the build are the lens-relative radii, which are framing choices and are
 * named as such in the report.
 */
export function planShots(metrics: MetricsLike): FoundryShot[] {
  const eyeY = asMetres(metrics.youth?.landmarks?.eyeY ?? metrics.eyes?.centresMm?.[0]?.y ?? 1.5784);
  const chinY = asMetres(metrics.youth?.landmarks?.chinY ?? 1.4691);
  const mouthY = asMetres(metrics.youth?.landmarks?.mouthY ?? 1.5383);
  // The PHOTOGRAPHIC hairline: 92.7 mm above the eye line (0.848 × eye→chin).
  // metrics.hair.hairlineFrontY is already in metres and is the scalp cloud's
  // own hairline, which is the defect being photographed, not the target.
  const hairlineY = eyeY + 0.092672;
  const front = -0.10;
  const eye = eyeY;
  const headCenter = (eyeY + chinY) / 2;

  return [
    {
      id: "face-close-up",
      index: 1,
      title: "Face close-up",
      proves: "the face's own proportions at portrait scale",
      view: "front",
      focus: ["head", "face", "hair"],
      camera: { center: [0, front, Number((headCenter + 0.005).toFixed(4))], radius: 0.145 },
      resolution: [1024, 1024],
      samples: 64,
      lens: 135,
      ground: false,
      reference: "lelu-facial-expressions/lelu-facial-expression-01.png",
      benchmark: 1,
    },
    {
      id: "eyes",
      index: 2,
      title: "Eyes and eyelids",
      proves: "eye placement, aperture and iris colour",
      view: "front",
      focus: ["head", "face"],
      camera: { center: [0, front, Number(eye.toFixed(4))], radius: 0.07 },
      resolution: [768, 768],
      samples: 64,
      lens: 200,
      ground: false,
      reference: "lelu-facial-expressions/lelu-facial-expression-02.png",
      benchmark: 2,
    },
    {
      id: "nose-lips",
      index: 3,
      title: "Nose and lips",
      proves: "alar width, philtrum and lip construction",
      view: "front",
      focus: ["head", "face"],
      camera: { center: [0, front, Number(((eyeY + mouthY) / 2).toFixed(4))], radius: 0.07 },
      resolution: [768, 768],
      samples: 64,
      lens: 180,
      ground: false,
      reference: "lelu-facial-expressions/lelu-facial-expression-01.png",
      benchmark: 3,
    },
    {
      id: "hairline",
      index: 4,
      title: "Hairline and baby hairs",
      proves: "where hair actually meets the forehead, and the front strand roots",
      view: "front",
      focus: ["head", "face", "hair"],
      camera: { center: [0, front, Number(((hairlineY + eyeY) / 2).toFixed(4))], radius: 0.095 },
      resolution: [1024, 1024],
      samples: 64,
      lens: 150,
      ground: false,
      reference: "lelu-facial-expressions/lelu-facial-expression-02.png",
      benchmark: 4,
    },
    {
      id: "curl-detail",
      index: 5,
      title: "Individual curl structure",
      proves: "ringlet geometry at strand scale",
      view: "three-quarter",
      focus: ["hair"],
      camera: { center: [0.09, -0.06, Number(((eyeY + chinY) / 2).toFixed(4))], radius: 0.075 },
      resolution: [768, 768],
      samples: 64,
      lens: 135,
      ground: false,
      reference: "lelu-hair/lelu-hair-07.png",
      benchmark: 5,
    },
    {
      id: "hair-full",
      index: 6,
      title: "Full hairstyle",
      proves: "the whole mass: length, silhouette, fall",
      view: "three-quarter",
      focus: ["head", "hair"],
      camera: null,
      resolution: [1024, 1024],
      samples: 48,
      ground: false,
      reference: "lelu-hair/lelu-hair-07.png",
      benchmark: 6,
    },
    {
      id: "jewelry",
      index: 7,
      title: "Jewelry close-up",
      proves: "the headpiece and ornaments are geometry with metallic materials",
      view: "front",
      focus: ["accessories.head"],
      camera: null,
      resolution: [768, 768],
      samples: 64,
      ground: false,
      environment: true,
      reference: "lelu-hair/lelu-hair-04.png",
      benchmark: 7,
    },
    {
      id: "portrait-front",
      index: 8,
      title: "Front portrait",
      proves: "the complete head as seen head-on",
      view: "front",
      focus: ["head", "face", "hair", "neck"],
      camera: null,
      resolution: [1024, 1024],
      samples: 48,
      ground: false,
      reference: "lelu-facial-expressions/lelu-facial-expression-01.png",
      benchmark: 8,
    },
    {
      id: "portrait-three-quarter",
      index: 9,
      title: "Three-quarter portrait",
      proves: "the same head from the angle a viewer actually sees",
      view: "three-quarter",
      focus: ["head", "face", "hair", "neck"],
      camera: null,
      resolution: [1024, 1024],
      samples: 48,
      ground: false,
      reference: "lelu-facial-expressions/lelu-facial-expression-03.png",
      benchmark: 9,
    },
    {
      id: "profile",
      index: 10,
      title: "Side profile",
      proves: "nose projection, chin, jaw angle and skull depth",
      view: "side",
      focus: ["head", "face", "hair"],
      camera: null,
      resolution: [1024, 1024],
      samples: 48,
      ground: false,
      reference: "lelu-anatomy/lelu-anatomy-01.png",
      benchmark: 10,
    },
    {
      id: "rear",
      index: 11,
      title: "Rear view",
      proves: "the back of the hairstyle and the skull's coverage",
      view: "back",
      focus: ["head", "hair"],
      camera: null,
      resolution: [1024, 1024],
      samples: 48,
      ground: false,
      reference: "lelu-hair/lelu-hair-07.png",
      benchmark: 11,
    },
    {
      id: "upper-body",
      index: 12,
      title: "Full upper body",
      proves: "neck, shoulders and the head-to-body transition",
      view: "front",
      focus: ["head", "face", "hair", "neck", "torso", "arms"],
      camera: null,
      resolution: [1024, 1024],
      samples: 48,
      ground: true,
      reference: "lelu-anatomy/lelu-anatomy-05.png",
      benchmark: 12,
    },
    {
      id: "full-body",
      index: 13,
      title: "Full-body character",
      proves: "the complete figure, head to feet",
      view: "front",
      focus: ["head", "face", "hair", "neck", "torso", "pelvis", "arms", "hands", "legs", "feet", "clothing.top", "clothing.bottom", "clothing.shoes", "accessories.head", "accessories.body"],
      camera: null,
      resolution: [1024, 1024],
      samples: 48,
      ground: true,
      reference: "lelu-anatomy/lelu-anatomy-07.png",
      benchmark: 13,
    },
  ];
}

export function shotById(shots: FoundryShot[], id: string): FoundryShot | undefined {
  return shots.find((s) => s.id === id || String(s.index) === id);
}
