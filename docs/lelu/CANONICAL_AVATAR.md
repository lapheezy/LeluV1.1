# LÉLU — canonical digital human

Her identity is not a character preset. It is transcribed from her own locked
files, which are the authority for everything below:

- `leluverse/assets/characters/lelu_character/identity/identity.json` (locked)
- `leluverse/assets/characters/lelu_character/references/ref10_face_primary.png`
  (primary), `ref08_face_upper_body`, `ref01_front_fullbody_A`, `ref15_head_turnaround_sheet`
- `leluverse/assets/wardrobe/inventory.json` (looks and their parts)
- `leluverse/assets/characters/lelu_character/manifests/character.json` (rig,
  animation slots, current look)

**The three PDFs named in the brief are not in this workspace.** A full search
(`find . -iname "*.pdf"`, plus name searches for MISSION 16, Style/Hair
Universe and Turnaround/Framebook) returns nothing, so this build works from
the reference sheets, identity file, wardrobe inventory and character manifest
that *are* present. If the PDFs are added, they can be reconciled against this
canon without redoing it.

## What is canonical (`src/core/asre/character/leluIdentity.ts`)

| her | from |
|---|---|
| oval face, high cheekbones, tapered jaw, rounded chin | identity `faceShape`, carried by the CC0 morph |
| almond warm-brown eyes, upturned corners, winged liner, dense lashes | identity `eyes` |
| full dark softly-arched brows with a clean tail | identity `brows`, painted in `leluFaceColour` |
| full lips, defined cupid's bow, glossy deep berry-brown | identity `lips`, painted |
| deep warm brown skin, soft sheen, freckles | identity `skin`, `LELU_COLOURS.skin` |
| star marks high on the cheekbones, dark forehead/temple swirls | identity `markings`, painted |
| septum ring, labret stud with drop, large rose-gold hoops | identity `piercings`, real geometry |
| rose-quartz hairline jewel, crystal drop between the brows | identity `markings`, real geometry |
| filigree tattoos on collarbones/chest and forearms | identity `tattoos`, painted |
| black corkscrew curls, centre part, pink/magenta highlights | identity `hairline`, strand colouring |
| rose gold + copper + rose quartz | wardrobe boards, `LELU_COLOURS` |

`mayChange` (identity.json): outfit, hairstyle, pose, expression, accessories.
`leluDerivative()` produces exactly that — a copy that still carries her
identity, for SELF-MODEL and AVATAR DUPLICATION modes.

## Build

```bash
npx tsx scripts/asre/lelu-canon.ts --out artifacts/lelu/canon
```

Output: `lelu-canon.glb`, `lelu-canon-report.json`, filter-free renders.

## Honest status

Done: her skin, palette, markings, brows, lips, freckles, piercings, hoops,
hairline jewel, choker, chains, waist harness, rose-streaked curls, and her
ancestry/build in the anatomy foundation.

Not yet hers: the outfit is still the CC0 suit recoloured to her palette (her
corset/cargo/platform boots are not modelled yet); the eyes are still spheres
in the reference sockets without a carved lid opening, so the iris reads
poorly; the curls are too fine and too pink; the jewelry placement is
proportional rather than fitted to her ear and nose geometry.

## M5.8 fidelity pass — face, hair, clothing

Three work packages, each built from her own files and measured rather than eyeballed.

| WP | what changed | evidence |
| --- | --- | --- |
| 01 face | one 24 mm globe per eye on the rig's eye joint, iris 30°, limbal ring, shaded sclera, cornea catchlight; almond lid opening cut around the globe; skin raised to the copper-tan of `ref10`; glossy berry lips; arched brows; winged liner and lashes on the lid rim | `lelu-canon-face-front.png`, `scripts/asre/lelu-eye-probe.ts` |
| 02 hair | each lock spirals 5.5 turns over 22 cm on a 1 cm spiral around its own drooping axis (was a random walk = locs); per-lock phase and radius; rose-magenta highlights sampled at 3 cm so whole curls take the hue | `lelu-canon-hair-front.png` |
| 03 clothing | corset, cargo and platform boots as independent closed solids shelled around HER body at 6/20/14 mm stand-offs, in her camo ground with the coral rose motif | `lelu-canon-front.png`, `lelu-canon-side.png` |

Measurements after the pass: build 60 s (was 167 s), 1,438,434 triangles, 45.8 MB GLB,
372,753 occupancy cells, IoU 1.000000 (329,004 cells both paths, zero disagreements),
procedural control 1.000000.

### Still not her, honestly

- The liner is a straight bar rather than a line following the almond; the brows do not
  read at close-up; the lips are not glossy enough.
- Curls read as coils but not yet as her specific density and parting.
- The corset has no lacing, buckles or boning; the cargo has no pockets; the boots have no
  laces. Sleeve and strap construction of her real garments is not modelled.
- Her face is still longer and narrower than the rounder face in `ref10`.
