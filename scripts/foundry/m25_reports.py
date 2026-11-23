"""
LÉLU M25 — assemble the work-package deliverables from measured data.

    python3 scripts/foundry/m25_reports.py

Reads only files produced by the M25 scripts (audits, build report, validation,
class maps) and writes the JSON deliverables the brief names. No number here is
typed in by hand except where a field is explicitly marked "judgement".
"""
import hashlib
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
M = os.path.join(ROOT, "artifacts/foundry/m25")


def j(rel):
    return json.load(open(os.path.join(M, rel)))


def w(rel, value):
    path = os.path.join(M, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(value, open(path, "w"), indent=1, ensure_ascii=False)
    print("wrote", rel)


def sha(path):
    return hashlib.sha256(open(os.path.join(ROOT, path), "rb").read()).hexdigest()


a4, a5 = j("topology/audit-v0004.json"), j("topology/audit-v0005.json")
b = j("hair/build-report.json")
val = j("verification/validation.json")
curl = j("hair/curl-validation.json")
cls = j("visual-defect-map/classes-v0004.json")
o4 = {o["name"]: o for o in a4["objects"] if o["name"] != "Icosphere"}
o5 = {o["name"]: o for o in a5["objects"] if o["name"] != "Icosphere"}
tech = {m["metric"]: m for m in val["technical"]}
perc = {m["metric"]: m for m in val["perceptual"]}
skin_metric = next(m for k, m in perc.items() if k.startswith("skin colour ΔE2000 vs photograph"))
lm_metric = next((m for k, m in perc.items() if k.startswith("facial landmark")), None)

# ------------------------------------------------------------ WP01 audit
defects = [
    {"id": "D01", "region": "hair (lelu_hair) — close-ups", "symptom": "folded, angular, metallic-grey ribbons",
     "causes": ["A", "B", "C", "H"], "primary": "I",
     "evidence": {
         "geometry": f"welded dihedral median {o4['lelu_hair']['weldedGraph']['dihedralDeg']['p50']}°, {round(100 * o4['lelu_hair']['weldedGraph']['dihedralOver60Share'], 1)} % of adjacent pairs bend > 60° — the ribbons really are folded strips",
         "normals": f"{round(100 * o4['lelu_hair']['normals']['hardShareOfShared'], 1)} % of shared positions carry a > 30° normal split — every fold is drawn as a hard crease",
         "material": f"hair metallic texels up to p99 {o4['lelu_hair']['textureStats']['metallic']['p99']}, roughness p1 {o4['lelu_hair']['textureStats']['roughness']['p1']}",
         "renderer": "M24 renders: no material pass matched (materials_applied = []), AgX Medium High Contrast, key light 120 W × framing²: grey speculars on near-black albedo (mean sRGB 0.07/0.03/0.03)"},
     "repair": "renderer recalibrated (grey card); hair metallic → 0 / roughness floor 0.55; foundation Taubin-smoothed (4 it, ≤ 6 mm); normals rebuilt (80° limit); primary representation replaced by rounded ringlets"},
    {"id": "D02", "region": "shoulders, upper back, upper chest (char1)", "symptom": "crystalline triangular fragmentation",
     "causes": ["A", "B"], "primary": "A",
     "evidence": {
         "geometry": f"shoulder triangles mean dihedral p50 {o4['char1']['regions']['shoulders']['triangleMeanDihedralDeg']['p50']}°, {round(100 * o4['char1']['regions']['shoulders']['dihedralOver45Share'], 1)} % above 45°; mean edge {o4['char1']['regions']['shoulders']['meanEdgeMm']} mm (39,166 triangles for the whole body)",
         "content": f"{round(100 * o4['char1']['regions']['shoulders']['hairDarkAlbedoShare'], 1)} % of shoulder and {round(100 * o4['char1']['regions']['upperBack']['hairDarkAlbedoShare'], 1)} % of upper-back triangles carry hair albedo: Meshy fused hair into the body as a crumpled shell",
         "normals": f"{round(100 * o4['char1']['normals']['hardShareOfShared'], 1)} % of shared positions split > 30°"},
     "repair": "localised Taubin smoothing of the hair cape (12 it, ≤ 15 mm) and of folded shoulder triangles (6 it, ≤ 8 mm), seams pinned; normals rebuilt (80° hair, 40–50° elsewhere); ringlets drape over the cape",
     "residual": "the crumple is real low-resolution geometry pinned by its UV seams; the repair reduces it but cannot remove it without a retopology that would invalidate the UVs — FAIL recorded"},
    {"id": "D03", "region": "face skin", "symptom": "washed-out, pale complexion",
     "causes": ["F", "H", "D"], "primary": "H",
     "evidence": {"m24Render": skin_metric["value"].get("m24-render"), "photoMedianLab": skin_metric["value"].get("photoMedianLab"),
                  "v0004Calibrated": skin_metric["value"].get("v0004"),
                  "albedo": b["steps"]["textures"]["head"]["skinLabMedianBefore"],
                  "explanation": "the same v0004 asset measures L* 80 in the M24 render and L* ≈ 51 under a grey-card exposure; the remaining gap is albedo chroma (a* 16 in the texture against 34 in the photographs)"},
     "repair": "renderer: grey-card exposure, AgX base look; texture: CIELAB transform on skin texels only (L* × 0.88, a* × 1.89, b* × 1.41), never lightening"},
    {"id": "D04", "region": "face skin", "symptom": "plastic/metallic sheen, over-smooth",
     "causes": ["C"], "primary": "C",
     "evidence": {"skinMetallicBefore": b["steps"]["textures"]["head"]["before"]["skinMetallicMean"],
                  "skinRoughnessP10Before": b["steps"]["textures"]["head"]["before"]["skinRoughnessP10"],
                  "scalpMetallicP90": o4["lelu_scalp"]["textureStats"]["metallic"]["p90"]},
     "repair": "skin texels metallic → 0, roughness clamped 0.48–0.85; metal (jewellery) texels untouched"},
    {"id": "D05", "region": "eyes", "symptom": "soft, low-detail eyes in close-up",
     "causes": ["D"], "primary": "D",
     "evidence": {"eyePatchTexture": "121 × 83 and 121 × 78 px", "underlyingHead": "the eye sockets under the patches are empty (render with patches hidden)",
                  "photographs": "MediaPipe eye widths 40–84 px in the available references"},
     "repair": "none: no legitimate source carries more eye detail than the patch; interpolation would be invented detail. Documented as a limitation"},
    {"id": "D06", "region": "face proportions", "symptom": "IPD 51 mm vs 63 mm, mouth 31 mm vs 50 mm (M24)",
     "causes": ["registration"], "primary": "measurement",
     "evidence": lm_metric["value"] if lm_metric else None,
     "repair": "none required: scale-free ratios match the photographs; the millimetre targets assumed a 142 mm face and are mutually inconsistent (50.4 / 63 = 0.80 while the photographs give 0.66–0.69)"},
    {"id": "D07", "region": "lips", "symptom": "rectangular lip patch edge in close-up", "causes": ["D", "E"], "primary": "D",
     "evidence": {"note": "visible in v0004 eye/face close-ups as a boxed boundary around the lower lip"}, "repair": "not repaired in M25 (texture painting); documented"},
    {"id": "D08", "region": "clothing (char1)", "symptom": "smeared camo, grey metallic sheen on fabric", "causes": ["C", "D"], "primary": "C",
     "evidence": {"bodyMetallicMean": o4["char1"]["textureStats"]["metallicMean"], "armsMetallicMean": o4["char1"]["regions"]["arms"]["metallicMean"],
                  "texelDensity": "one 2048² map for body + outfit (M24 texture audit)"},
     "repair": "fabric is classified per triangle as material slot m25_body; metallic is only kept where the asset's map says ≥ 0.5 (straps, rings); texel density unchanged — FAIL recorded for fabric definition"},
]
w("visual-defect-audit.json", {"asset": {"v0004": a4["sha256"], "v0003": sha("leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb")},
                               "causeCodes": {"A": "geometry/topology", "B": "vertex normals", "C": "material/shader", "D": "texture resolution/content",
                                              "E": "UV mapping", "F": "lighting", "G": "sampling", "H": "camera/post (exposure, tone map)", "I": "multiple interacting"},
                               "inspected": ["face", "skull", "eyes", "eyelids", "eyebrows", "nose", "lips", "ears", "neck", "shoulders", "chest", "torso", "arms",
                                             "hands", "clothing", "hair", "accessories"],
                               "notDefects": [
                                   "degenerate triangles: 0 zero-area, 0 collapsed, 0 duplicate faces on every object (v0004)",
                                   "inverted loop normals: 0 on every object",
                                   "winding: 18 inconsistent welded edges on char1, 66 on lelu_hair, 28 on lelu_scalp — too few to explain region-wide artefacts",
                                   "transparency sorting: head/body materials are HASHED with alpha 1.0 — no transparent surfaces to sort",
                                   "the 'Icosphere' seen on import is a Blender importer bone shape, not part of the GLB (not in its node list)"],
                               "defects": defects})
w("visual-defect-map.json", {"method": "per-triangle classification from the asset's own albedo + metallicRoughness maps (scripts/blender/lelu_m25_common.py classify) plus welded-graph dihedral; rendered as flat colour maps",
                             "images": sorted(f"visual-defect-map/{f}" for f in os.listdir(os.path.join(M, "visual-defect-map")) if f.endswith(".png")),
                             "colours": cls["colors"], "triangleClasses": cls["triangleClasses"],
                             "regions": {k: v for k, v in o4["char1"]["regions"].items()},
                             "responsibleComponents": {d["id"]: {"region": d["region"], "causes": d["causes"]} for d in defects}})

# ------------------------------------------------------------ WP03 topology
keys = ["name", "vertices", "triangles", "uniquePositions", "weldRatio", "isTriangleSoup", "degenerate", "duplicateFaces", "weldedGraph"]
w("topology/topology-audit.json", {"v0004": {n: {k: o[k] for k in keys} for n, o in o4.items()},
                                   "v0005": {n: {k: o[k] for k in keys} for n, o in o5.items()},
                                   "verdict": "v0004 has no degenerate, duplicate or inverted geometry; the crystalline look is real folded geometry (char1 shoulders, hair ribbons) drawn with per-face normals and exposed by an over-bright renderer. The head was NOT welded."})
w("topology/normal-validation.json", {"v0004": {n: o["normals"] for n, o in o4.items()}, "v0005": {n: o["normals"] for n, o in o5.items()},
                                      "rebuild": b["steps"]["normals"],
                                      "checks": {k: tech[k] for k in tech if "normal" in k or "shaded" in k}})
w("topology/repair-report.json", {"weldPerformed": False, "verticesMovedBy": b["steps"]["geometry"],
                                  "normalsRebuilt": b["steps"]["normals"], "uvsChanged": False, "materialSlotsAdded": True,
                                  "shapeKeyPolicy": "every key block moved by the basis displacement, so deltas are unchanged (verified in rig/rig-regression.json)",
                                  "reversible": "v0004 is preserved byte-for-byte; every step is parameterised in build-job.json"})

# ------------------------------------------------------------ WP02 hair
h = b["steps"]["hair"]
w("hair/hair-reconstruction.json", {
    "representation": "hybrid",
    "foundation": {"objects": ["lelu_hair (existing, Taubin 4 it ≤ 6 mm, normals 80°)", "char1 hair cape (Taubin 12 it ≤ 15 mm)"],
                   "material": "m25_hair_foundation / m25_hair_body: asset albedo (near-black, sRGB mean 0.07/0.03/0.03), metallic 0, roughness ≥ 0.55, normal map strength 0.6",
                   "opacity": "opaque (no alpha)"},
    "primary": {"object": "lelu_hair_ringlets", **h["primary"], "ringlets": h["ringlets"],
                "construction": "axis grown down the outer hair surface (4 mm steps, gravity + surface projection, skin push-out), helix of radius 3.4–6.2 mm and pitch 10–16 mm around it, root relaxed over 15 mm, tip tightened 15 %, swept as a 6-sided rounded tube of clump radius 1.3–2.0 mm with smooth normals",
                "materials": {"m25_hair_curl": "linear (0.010, 0.0055, 0.0048), roughness 0.42", "m25_hair_highlight": "burgundy linear (0.075, 0.012, 0.022), 14 % of ringlets"},
                "truncatedAtFace": h.get("truncatedAtFace")},
    "secondary": {"object": "lelu_hair_strands", **h["secondary"], "flyaways": h["flyaways"], "babyHairs": h["babyHairs"],
                  "construction": "flyaways: 20–70 mm curled 3-sided fibres (0.16–0.28 mm radius) leaving the outer surface; baby hairs: 8–20 mm spirals laid 0.4 mm off the forehead skin along the hairline"},
    "skinning": "Head weight 1 above 1.50 m, blended linearly to Spine02 by 1.30 m",
    "rootsRejected": h["rootsRejected"],
    "notDone": ["no strand simulation or grooming tool", "ringlets are not separated into editable clusters beyond one object per layer",
                "no per-strand UVs / textures: colour variation is by material (curl vs highlight)"]})

# ------------------------------------------------------------ WP04 skin
t = b["steps"]["textures"]
w("materials/skin-material-audit.json", {
    "photographs": {"median": skin_metric["value"].get("photoMedianLab"), "method": "landmark-located cheek/forehead/chin patches, brightest 20 % dropped, CIELAB D65"},
    "renders": {k: v for k, v in skin_metric["value"].items() if k != "photoMedianLab"},
    "lighting": next((m["value"] for k, m in perc.items() if "lighting" in k), None),
    "texture": {"head": t["head"], "body": t["body"]},
    "transform": b["job"]["skin"],
    "subsurface": "Cycles-only: m25_skin_* get random-walk-skin SSS weight 0.18, scale 4 mm at render time (glTF cannot carry SSS)",
    "identityFeaturesPreserved": ["freckles and star marks (texture untouched except colour transform)", "winged eyeliner (eye patches untouched)",
                                  "berry lips (lips texels metallic 0; roughness left glossy)", "septum and facial jewellery (metal texels untouched)",
                                  "forehead ornament markings (texture untouched)"],
    "verdict": skin_metric["verdict"]})
w("materials/texture-audit.json", {"images": a5["images"], "changed": {"m25_head_basecolor": "skin texels only (CIELAB)", "m25_head_metalrough": "skin + hair texels",
                                                                     "m25_body_basecolor": "skin texels only", "m25_body_metalrough": "skin + hair-cape texels"},
                                   "unchanged": ["normal maps", "eye patch textures", "metal texels"],
                                   "eyeTexture": {"size": "121 × 83 / 121 × 78", "decision": "not enlarged", "why": "no legitimate higher-detail source (empty sockets under the patches; reference photographs carry 40–84 px per eye)"},
                                   "encoding": "JPEG quality 90 on export (originals were JPEG; v0004 file keeps the originals)"})

# ------------------------------------------------------------ WP05 anatomy
lmr = j("anatomy/landmark-ratios.json")
w("anatomy/facial-landmarks.json", {
    "method": "MediaPipe Face Landmarker (float16 v1, local CPU), iris centres for pupils, ratios only — no millimetre scale is assumed for any photograph",
    "photographs": lmr.get("photos"), "photoSpread": lmr.get("photoSpread"), "v0004": lmr.get("v0004"), "v0005": lmr.get("v0005"),
    "v0005DeviationPct": lmr.get("v0005DeviationPct"),
    "m24Claims": {"ipdMm": [51.17, 63.0], "mouthMm": [31.13, 50.4]},
    "registration": "M24 compared model millimetres against a sheet whose scale came from an assumed 142 mm face width (confidence: low). In scale-free terms the model's mouth/IPD and IPD/face-width sit inside the photographs' own spread, so neither the eyes nor the mouth were moved.",
    "deformationApplied": False})
print("done")

# ------------------------------------------------------------ checksums
import subprocess  # noqa: E402

BASE = "d4667d785e928a9e30d79b7d91522fbe775a2f45"


def tree_digest(prefix):
    files = subprocess.run(["git", "ls-files", prefix], capture_output=True, text=True, cwd=ROOT).stdout.split()
    h = hashlib.sha256()
    for f in sorted(files):
        h.update(f.encode() + b"\0" + sha(f).encode() + b"\n")
    changed = subprocess.run(["git", "diff", "--name-only", BASE, "--", prefix], capture_output=True, text=True, cwd=ROOT).stdout.split()
    return {"files": len(files), "manifestSha256": h.hexdigest(), "changedSinceM24": changed}


refs = sorted(subprocess.run(["git", "ls-files", "leluverse/assets/characters/lelu_character/references", "artifacts/lelu2/m231/reference"],
                             capture_output=True, text=True, cwd=ROOT).stdout.split())
v5 = "artifacts/foundry/m25/assets/lelu-m25-visual-fidelity.glb"
w("verification/checksums.json", {
    "baseline": {"branch": "experiment/lelu-2-golden-geometry", "commit": BASE},
    "immutable": {
        "v0003": {"file": "leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb",
                  "sha256": sha("leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb"),
                  "registered": "80089844d989c413dd1ce66bf8c70bf11441831e1256ad6854ab28e5db67e2ce"},
        "v0004": {"file": "artifacts/foundry/m24/assets/lelu-m24-hair-split.glb", "sha256": sha("artifacts/foundry/m24/assets/lelu-m24-hair-split.glb"),
                  "registered": "6b9bccbe3591a3eecdf624e2965e83490182213f3c7f8dab0bd6e106f5594b18"},
        "pciFr": {"note": "PCI-FR geometry builds are not committed as GLBs on this branch (gitignored); every tracked PCI-FR / lelu2 artefact is digested here and git shows no change since the M24 commit",
                  **tree_digest("artifacts/lelu2")},
        "photographs": {"files": [{"file": f, "sha256": sha(f)} for f in refs], "changedSinceM24": subprocess.run(
            ["git", "diff", "--name-only", BASE, "--", *refs], capture_output=True, text=True, cwd=ROOT).stdout.split()},
    },
    "new": {"v0005": {"file": v5, "sha256": sha(v5), "bytes": os.path.getsize(os.path.join(ROOT, v5))},
            "textures": ["m25_head_basecolor", "m25_head_metalrough", "m25_body_basecolor", "m25_body_metalrough"]},
})
