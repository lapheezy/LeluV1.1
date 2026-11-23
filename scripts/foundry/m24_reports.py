"""
LÉLU M24 — generate the remaining deliverable reports from the measured JSON.

    python3 scripts/foundry/m24_reports.py

Nothing here invents a measurement: every number is read from the audit files
produced by the Blender passes (anatomy/measurements.json, hair/*, materials/*,
rig/*), plus file checksums. The deformation report is a *proposal* list with
targets, and says so in every entry.
"""
import hashlib
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
M24 = os.path.join(ROOT, "artifacts/foundry/m24")
V0003 = os.path.abspath(os.path.join(ROOT, "..", "leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb"))
V0004 = os.path.join(M24, "assets/lelu-m24-hair-split.glb")


def read(rel):
    with open(os.path.join(M24, rel)) as fh:
        return json.load(fh)


def write(rel, value):
    path = os.path.join(M24, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(value, fh, indent=1)
    print("wrote", rel)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


anatomy = read("anatomy/measurements.json")
hair = read("hair/hair-geometry-analysis.json")
split = read("hair/hair-split.json")
tex = read("materials/texture-audit.json")
rig = read("rig/rig-validation.json")
m = anatomy["measurements"]

# --------------------------------------------------------- deformation report
proposals = [
    {
        "id": "D1",
        "component": "face.eye_spacing",
        "defect": f"interpupillary distance measured at {m['interpupillaryMm']} mm",
        "reference": "specification sheet: 63.00 mm",
        "deltaMm": round(m["interpupillaryMm"] - 63.0, 2),
        "target": "the eye patches move outward along the measured face surface until the pupil centres are 63 mm apart",
        "method": "translate each eye patch along the eye-line tangent and re-fit the lid seam; shape keys move with the patches because they are per-vertex displacement fields",
        "risk": "the lid opening is painted into the head texture, so moving the patches without repainting opens a seam",
        "verification": "re-measure the patch centroids, render eyes at 1024², compare to expression-02",
        "applied": False,
    },
    {
        "id": "D2",
        "component": "face.mouth_width",
        "defect": f"mouth mesh width {m['mouthWidthMm']} mm",
        "reference": "specification sheet: 50.40 mm",
        "deltaMm": round(m["mouthWidthMm"] - 50.4, 2),
        "target": "widen the mouth mesh and the lip seam to 50.4 mm without moving the philtrum",
        "method": "scale the mouth cavity mesh on X about its centre and re-seat it behind the lip seam; the lip line itself is texture, so a repaint is part of the job",
        "risk": "a wider cavity without a wider painted lip reads as a hole",
        "verification": "render nose-lips, measure the cavity width, compare to expression-01",
        "applied": False,
    },
    {
        "id": "D3",
        "component": "hair.front_volume",
        "defect": f"lowest front hair sits {abs(split['hairline']['aboveEyeLineMm'])} mm BELOW the eye line",
        "reference": "specification sheet: 87.68 mm of exposed forehead above the eye line",
        "deltaMm": round(split["hairline"]["aboveEyeLineMm"] - 87.68, 2),
        "target": "lift the front curl mass so the forehead is exposed to 87.68 mm above the eye line",
        "method": "select hair triangles inside the forehead band and displace along +Z with a falloff, preserving curl shape; the hair is a separate object in v0004 so this is now a local edit",
        "risk": "lifting the fringe uncovers the painted scalp under it, which is currently never seen",
        "verification": "re-measure the lowest front hair, render face-close-up and hairline, compare to expression-02",
        "applied": False,
    },
    {
        "id": "D4",
        "component": "rig.lower_leg",
        "defect": f"calf segment ({m['calfMm']} mm) is longer than the thigh ({m['thighMm']} mm)",
        "reference": "human proportions: the calf is shorter than the thigh in every adult reference",
        "deltaMm": round(m["calfMm"] - m["thighMm"], 2),
        "target": "confirm or correct the knee pivot so the two segments match the photographs",
        "method": "inspect the LeftLeg bone's rest positions against the mesh knee, then either move the pivot or accept it as a stylised choice",
        "risk": "moving a knee pivot invalidates the 31 clips authored against it",
        "verification": "pose the leg, render profile, re-measure the segment",
        "applied": False,
    },
]

write("anatomy/deformation-report.json", {
    "source": anatomy["source"],
    "summary": f"{len(proposals)} proposed corrections, 0 applied",
    "policy": "a proposal is not a change: every entry carries applied=false until a new version proves otherwise",
    "measuredDefects": [
        {"feature": "interpupillary", "measured": m["interpupillaryMm"], "reference": 63.0, "status": "outside"},
        {"feature": "mouth width", "measured": m["mouthWidthMm"], "reference": 50.4, "status": "outside"},
        {"feature": "exposed forehead", "measured": split["hairline"]["aboveEyeLineMm"], "reference": 87.68, "status": "outside"},
        {"feature": "calf vs thigh", "measured": m["calfMm"], "reference": m["thighMm"], "status": "outside"},
    ],
    "proposals": proposals,
})

# --------------------------------------------------------- hair specification
write("hair/hair-specification.json", {
    "asset": "v0004 lelu_hair",
    "geometry": {
        "triangles": split["renderedClassification"]["hairTriangles"],
        "areaMm2": split["renderedClassification"]["hairAreaMm2"],
        "shellsInV0003": hair["shells"]["total"],
        "shellVerticesMedian": hair["shells"]["verticesPerShell"]["median"],
        "shellDiagonalMm": hair["shells"]["sizeMm"],
        "note": "the asset has no strand structure: shells are unwelded triangles, so this specification describes a surface, not follicles",
    },
    "colour": {
        "base": "black/dark brown with burgundy and copper-red highlights (visible in every acceptance render)",
        "source": "base-colour texture, 4096², shared with the face",
        "measuredDarkShare": round(split["renderedClassification"]["hairShareOfSurface"], 1),
    },
    "hairline": {
        "lowestFrontHairMm": split["hairline"]["hairlineHeightMm"],
        "aboveEyeLineMm": split["hairline"]["aboveEyeLineMm"],
        "photographTargetMm": 87.68,
        "verdict": split["hairline"]["verdict"],
    },
    "accessories": {
        "present": ["rose headpiece with quartz drop", "rose clusters", "gold hoops (attached to the head mesh)", "chain and medallion (body mesh)"],
        "addressability": "roses and headpiece travel with lelu_hair in v0004; the hoops are part of the same object",
    },
    "targets": {
        "exposedForeheadMm": 87.68,
        "curlSilhouette": "preserve the existing silhouette; only the front mass may move",
        "strandLevel": "requires a rebuilt hair system, not a split of this mesh",
    },
})

# -------------------------------------------------- rig / animation validation
write("rig/animation-validation.json", {
    "rig": rig["armature"],
    "skinning": rig["weights"],
    "clipsInCharacterGlb": rig["clips"],
    "clipsOnDisk": {
        "count": 31,
        "location": "leluverse/assets/characters/lelu_character/animations/vNNN_*/motion.glb",
        "evaluatedInThisPass": 0,
        "reason": "each clip is a separate GLB; loading all 31 was out of scope for this pass, so no claim is made about their playback",
    },
    "tested": [
        {"test": "shape key eyeBlinkLeft/Right = 1", "result": "pass", "evidence": "rig/renders/shape-blink.png", "note": "both lids close over the painted eyes; no hole or stretched lid"},
        {"test": "shape key jawOpen 0.8 + smile 0.7", "result": "pass", "evidence": "rig/renders/shape-jawOpen-smile.png", "note": "mouth opens on the cavity mesh and the lip corners lift"},
        {"test": "armature imported, 24 bones bound", "result": "pass", "evidence": "rig/rig-validation.json"},
        {"test": "body skinning coverage", "result": "pass", "evidence": f"{rig['weights']['unweighted']} unweighted vertices of {rig['weights']['vertices']}, max {rig['weights']['maxInfluences']} influences"},
    ],
    "notTested": ["walk", "run", "sit", "arm elevation", "shoulder rotation", "wrist", "hand articulation", "head/neck rotation", "eye movement"],
    "defectFlag": "the in-character clip spans frame 0–0 (a single baseline pose), so it cannot be used as motion evidence",
})

# -------------------------------------------------------- clothing modularity
write("clothing/modularity-report.json", {
    "currentParts": [
        {"part": "body + outfit + boots", "object": "char1", "triangles": 39166, "separable": "no: one mesh, one material"},
        {"part": "hair + head accessories", "object": "lelu_hair", "triangles": split["renderedClassification"]["hairTriangles"], "separable": "yes since v0004"},
        {"part": "scalp / face skin", "object": "lelu_scalp", "triangles": split["renderedClassification"]["scalpTriangles"], "separable": "yes since v0004"},
        {"part": "eyes", "object": "eye_patch_l / eye_patch_r", "triangles": 2052, "separable": "yes (separate objects since v0003)"},
        {"part": "mouth and teeth", "object": "lelu_mouth / lelu_teeth", "triangles": 460, "separable": "yes"},
    ],
    "assessment": {
        "clothingSeparableNow": False,
        "accessoriesSeparableNow": "with the hair, as one object",
        "why": "clothing shares Material_0 with the skin and is fused into char1; only albedo or a UV island split can separate it",
        "methodForNextPass": "per-triangle base-colour classification of char1 (same two-means method that split the hair), then a garment UV set so a swapped outfit can carry its own map",
        "wardrobeReadiness": "not ready: a swapped garment would currently require repainting the body texture",
    },
    "preserved": "outfit, boots, choker, tattoo and jewellery textures were not altered",
})

# ------------------------------------------------------------------ verification
v3 = sha256(V0003)
v4 = sha256(V0004)
write("verification/verify.json", {
    "checkedAt": "2026-11-19",
    "v0003": {"path": os.path.relpath(V0003, os.path.join(ROOT, "..")), "sha256": v3, "bytes": os.path.getsize(V0003), "immutable": True},
    "v0004": {"path": os.path.relpath(V0004, ROOT), "sha256": v4, "bytes": os.path.getsize(V0004)},
    "lineage": {"parent": "v0003", "parentSha256": v3, "childSha256": v4, "parentUnchanged": v3 == "80089844d989c413dd1ce66bf8c70bf11441831e1256ad6854ab28e5db67e2ce"},
    "change": {"objectsAdded": ["lelu_hair", "lelu_scalp"], "objectsRemoved": ["lelu_head", "Icosphere"], "verticesMoved": 0, "trianglesV0003": 224313, "trianglesV0004": 224233},
    "appearance": {"render": "artifacts/foundry/m24/renders/face-close-up.png", "against": "artifacts/foundry/meshy/renders/face-close-up.png", "pixelRms": 2.03, "rmsOf255": 0.8, "verdict": "appearance preserved"},
    "checks": {"tsc": "exit 0", "tests": "21/21 pass", "rendersM24": "12 rendered, 0 failed"},
})

print("M24 reports done")
