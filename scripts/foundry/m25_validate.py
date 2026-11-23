"""
LÉLU M25 — automated validation: technical metrics and perceptual metrics, kept apart.

    python3 scripts/foundry/m25_validate.py [--skip-blender]

Writes:
  artifacts/foundry/m25/topology/audit-v0005.json     (lelu_m25_audit.py on v0005)
  artifacts/foundry/m25/rig/rig-regression.json        (skinning + shape keys, v0004 → v0005)
  artifacts/foundry/m25/hair/curl-validation.json      (curl radius, pitch, continuity, intersections)
  artifacts/foundry/m25/verification/coverage/*.png     (hair coverage masks)
  artifacts/foundry/m25/verification/validation.json   (every metric with PASS / FAIL / NOT MEASURABLE)

A technical PASS does not imply a perceptual PASS: the two sections are scored
separately and the summary reports both.
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts/foundry"))
import m25_color  # noqa: E402

M25 = os.path.join(ROOT, "artifacts/foundry/m25")
BLENDER = os.environ.get("LELU_BLENDER_BIN", os.path.expanduser("~/lelu-tools/blender-4.5.9-linux-x64/blender"))
LANDMARKER = os.environ.get("LELU_LANDMARKER", os.path.expanduser("~/lelu-tools/models/face_landmarker.task"))
V = {"v0003": "leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb",
     "v0004": "artifacts/foundry/m24/assets/lelu-m24-hair-split.glb",
     "v0005": "artifacts/foundry/m25/assets/lelu-m25-visual-fidelity.glb"}
PHOTOS = ["artifacts/lelu2/m231/reference/face-front.png",
          "leluverse/assets/characters/lelu_character/references/face-front-closeup.png",
          "leluverse/assets/characters/lelu_character/references/face-front-closeup-alt.png",
          "leluverse/assets/characters/lelu_character/references/ref17_head_front_unhooded.png",
          "artifacts/lelu2/m231/reference/landmark-sheet.png"]
SKIP = "--skip-blender" in sys.argv


def p(*a):
    return os.path.join(ROOT, *a)


def blender(script, *args):
    r = subprocess.run([BLENDER, "-b", "--factory-startup", "--python", p("scripts/blender", script), "--", *args],
                       capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit(r.stdout[-2000:] + r.stderr[-2000:])
    return r.stdout


def sha(path):
    return hashlib.sha256(open(p(path), "rb").read()).hexdigest()


def verdict(ok, measurable=True):
    return "NOT MEASURABLE" if not measurable else ("PASS" if ok else "FAIL")


os.makedirs(p("artifacts/foundry/m25/verification/coverage"), exist_ok=True)
tmp = p("artifacts/foundry/m25/verification/.tmp")
os.makedirs(tmp, exist_ok=True)

# ------------------------------------------------------------- audits + rig dumps
if not SKIP:
    for v in ("v0003", "v0005"):
        job = os.path.join(tmp, f"audit-{v}.json")
        json.dump({"input": V[v], "out": p(f"artifacts/foundry/m25/topology/audit-{v}.json"), "label": v}, open(job, "w"))
        blender("lelu_m25_audit.py", job)
    for v in ("v0004", "v0005"):
        blender("lelu_m25_rigdump.py", V[v], os.path.join(tmp, f"rig-{v}.npz"), os.path.join(tmp, f"rig-{v}.json"))
    # coverage masks: scalp (lelu_scalp) red, hair green, everything else black
    for v in ("v0004", "v0005"):
        hair = ["lelu_hair", "lelu_hair_ringlets", "lelu_hair_strands"]
        for view, cam in (("back-top", {"center": [0, 0.0, 1.62], "radius": 0.16, "lens": 85}),
                          ("back", {"center": [0, 0, 1.40], "radius": 0.36, "lens": 85}),
                          ("front", {"center": [0, 0, 1.40], "radius": 0.36, "lens": 85})):
            out = p(f"artifacts/foundry/m25/verification/coverage/{v}-{view}.png")
            job = os.path.join(tmp, f"mask-{v}-{view}.json")
            json.dump({"input": V[v], "output": out, "view": view, "camera": cam, "resolution": [512, 512],
                       "mask": {"emit": ["lelu_scalp"], "green": hair}}, open(job, "w"))
            blender("lelu_m25_render.py", job)

A = {v: json.load(open(p(f"artifacts/foundry/m25/topology/audit-{v}.json"))) for v in ("v0003", "v0005")}
A["v0004"] = json.load(open(p("artifacts/foundry/m25/topology/audit-v0004.json")))
objs = lambda v: {o["name"]: o for o in A[v]["objects"] if o["name"] != "Icosphere"}

technical, perceptual = [], []


def add(lst, metric, value, threshold, ok, measurable=True, note=None):
    lst.append({"metric": metric, "value": value, "threshold": threshold, "verdict": verdict(ok, measurable), **({"note": note} if note else {})})


# ------------------------------------------------------------------ geometry
o4, o5 = objs("v0004"), objs("v0005")
deg = {n: o5[n]["degenerate"]["zeroArea"] + o5[n]["degenerate"]["collapsedAfterWeld"] for n in o5}
add(technical, "degenerate triangles (zero-area + collapsed), all objects", deg, "0", sum(deg.values()) == 0)
dup = {n: o5[n]["duplicateFaces"] for n in o5}
add(technical, "duplicate faces", dup, "0", sum(dup.values()) == 0)
inv = {n: o5[n]["normals"]["invertedLoopNormals"] for n in o5}
add(technical, "loop normals inverted against their face", inv, "0", sum(inv.values()) == 0)
flat = {n: {"v0004": o4[n]["normals"]["flatShadedShare"], "v0005": o5[n]["normals"]["flatShadedShare"]} for n in ("char1", "lelu_hair", "lelu_scalp") if n in o4}
add(technical, "flat-shaded triangle share (faceted shading) on soup meshes", flat, "v0005 < v0004 on every soup mesh",
    all(f["v0005"] < f["v0004"] for f in flat.values()))
hard = {n: {"v0004": o4[n]["normals"]["hardShareOfShared"], "v0005": o5[n]["normals"]["hardShareOfShared"]} for n in ("char1", "lelu_hair", "lelu_scalp")}
add(technical, "share of shared positions with >30° normal spread (shading creases)", hard, "v0005 < v0004",
    all(h["v0005"] < h["v0004"] for h in hard.values()))
dih = {n: {"v0004": o4[n]["weldedGraph"]["dihedralDeg"]["p50"], "v0005": o5[n]["weldedGraph"]["dihedralDeg"]["p50"]} for n in ("char1", "lelu_hair")}
add(technical, "median dihedral on the welded graph (surface crumple), degrees", dih, "v0005 < v0004",
    all(d["v0005"] < d["v0004"] for d in dih.values()))
crum = {r: {"v0004": o4["char1"]["regions"][r]["dihedralOver45Share"], "v0005": o5["char1"]["regions"][r]["dihedralOver45Share"]} for r in ("shoulders", "upperBack", "upperChest")}
add(technical, "shoulder/back/chest crumple residual: share of char1 triangles bending > 45°", crum, "every region < 0.30",
    all(c["v0005"] < 0.30 for c in crum.values()), note="the folds are real low-resolution geometry pinned by UV seams; the localised repair reduces them, a retopology is required to remove them")
ring = o5.get("lelu_hair_ringlets")
if ring:
    add(technical, "ringlet mesh: boundary edges per triangle (open tubes only at root/tip)",
        round(ring["weldedGraph"]["boundaryEdges"] / ring["triangles"], 4), "< 0.05", ring["weldedGraph"]["boundaryEdges"] / ring["triangles"] < 0.05)
    add(technical, "ringlet mesh: non-manifold edges", ring["weldedGraph"]["nonManifoldEdges"], "0", ring["weldedGraph"]["nonManifoldEdges"] == 0)

# --------------------------------------------------------------------- rig
r4 = json.load(open(os.path.join(tmp, "rig-v0004.json")))
r5 = json.load(open(os.path.join(tmp, "rig-v0005.json")))
z4 = np.load(os.path.join(tmp, "rig-v0004.npz"))
z5 = np.load(os.path.join(tmp, "rig-v0005.npz"))
rig = {"bones": {"v0004": len(r4["bones"]), "v0005": len(r5["bones"]), "identical": r4["bones"] == r5["bones"]}, "objects": {}}
for name, m5 in r5["objects"].items():
    m4 = r4["objects"].get(name)
    entry = {"v0005": {k: m5[k] for k in ("vertices", "triangles", "unweighted", "maxInfluences", "weightSumRange", "armatureModifier")},
             "vertexGroups": len(m5["vertexGroups"])}
    if m4:
        entry["v0004"] = {k: m4[k] for k in ("vertices", "triangles", "unweighted", "maxInfluences", "weightSumRange")}
        entry["shapeKeysIdentical"] = m4["shapeKeys"] == m5["shapeKeys"]
        b4, b5 = z4[name + "|basis"], z5[name + "|basis"]
        tree = cKDTree(b4)
        d, idx = tree.query(b5)
        if name + "|uv" in z4.files and name + "|uv" in z5.files:
            # match on UV first (weight 1000), position second: a vertex the repair
            # moved keeps its UV, and the glTF export may split a vertex by normal
            f4 = np.hstack([z4[name + "|uv"] * 1000.0, b4])
            f5 = np.hstack([z5[name + "|uv"] * 1000.0, b5])
            _, idx = cKDTree(f4).query(f5)
            d = np.linalg.norm(b4[idx] - b5, axis=1)
            entry["matching"] = {"method": "uv x1000 + position", "exactUvShare": round(float(np.mean(np.all(np.abs(z4[name + "|uv"][idx] - z5[name + "|uv"]) < 1e-6, axis=1))), 6)}
        entry["basisMatch"] = {"medianMm": round(float(np.median(d) * 1000), 4), "p99Mm": round(float(np.percentile(d, 99) * 1000), 4),
                               "maxMm": round(float(d.max() * 1000), 4)}
        keys = {}
        for k in m5["shapeKeys"]:
            if name + "|" + k in z4.files:
                dl4, dl5 = z4[name + "|" + k][idx], z5[name + "|" + k]
                err = np.linalg.norm(dl4 - dl5, axis=1) * 1000
                mag = np.linalg.norm(dl4, axis=1) * 1000
                keys[k] = {"movingVertices": int((mag > 0.01).sum()), "maxDeltaMm": round(float(mag.max()), 3),
                           "deltaErrorMaxMm": round(float(err.max()), 4), "deltaErrorP99Mm": round(float(np.percentile(err, 99)), 4)}
        entry["shapeKeyDeltas"] = keys
    rig["objects"][name] = entry
rig["walkClip"] = None
walk = sorted(glob.glob(p("artifacts/foundry/m25/rig/renders/walk-f*.png.json")))
if walk:
    rig["walkClip"] = [{"frame": json.load(open(w))["animation"]["frame"], "bonesMoved": json.load(open(w))["animation"]["bonesMoved"],
                        "action": json.load(open(w))["animation"]["action"], "frameRange": json.load(open(w))["animation"]["frameRange"],
                        "render": os.path.relpath(w[:-5], ROOT)} for w in walk]
shape = sorted(glob.glob(p("artifacts/foundry/m25/rig/renders/shape-*.png")))
rig["shapeKeyRenders"] = [os.path.relpath(s, ROOT) for s in shape]
if len(shape) >= 2:
    base = np.asarray(Image.open(p("artifacts/foundry/m25/rig/renders/shape-neutral.png")).convert("RGB")).astype(float)
    rig["shapeKeyRenderDiffRms"] = {os.path.basename(s): round(float(np.sqrt(np.mean((np.asarray(Image.open(s).convert("RGB")).astype(float) - base) ** 2))), 3) for s in shape}
json.dump(rig, open(p("artifacts/foundry/m25/rig/rig-regression.json"), "w"), indent=1)
old_names = [n for n in r4["objects"] if n in r5["objects"]]
key_err = max((k["deltaErrorMaxMm"] for n in old_names for k in rig["objects"][n].get("shapeKeyDeltas", {}).values()), default=0)
add(technical, "bones identical v0004 → v0005", rig["bones"], "identical", rig["bones"]["identical"])
add(technical, "unweighted vertices, every skinned mesh", {n: r5["objects"][n]["unweighted"] for n in r5["objects"]}, "0",
    all(r5["objects"][n]["unweighted"] == 0 for n in r5["objects"]))
add(technical, "max influences per vertex", {n: r5["objects"][n]["maxInfluences"] for n in r5["objects"]}, "≤ 4",
    all(r5["objects"][n]["maxInfluences"] <= 4 for n in r5["objects"]))
add(technical, "vertex groups on char1", len(r5["objects"]["char1"]["vertexGroups"]), "24", len(r5["objects"]["char1"]["vertexGroups"]) == 24)
add(technical, "shape-key names preserved", {n: rig["objects"][n].get("shapeKeysIdentical") for n in old_names}, "identical",
    all(rig["objects"][n].get("shapeKeysIdentical", True) for n in old_names))
add(technical, "shape-key delta error after repair (max over all keys, matched vertices)", key_err, "< 0.05 mm", key_err < 0.05)
if rig["walkClip"]:
    moved = [w["bonesMoved"] for w in rig["walkClip"]]
    add(technical, "walk clip (v021 motion.glb) loaded and played on v0005; bones moved per frame", moved, "> 0 on every frame", all(m > 0 for m in moved))
else:
    add(technical, "walk clip playback", None, "rendered frames", False, measurable=False, note="rig renders not present")

# --------------------------------------------------------------------- curls
G = json.load(open(p("artifacts/foundry/m25/hair/ringlet-guides.json")))["ringlets"]
radii, pitches, kinks, lens, clump = [], [], [], [], []
centres = []
for i, g in enumerate(G):
    ax, ce = np.array(g["axis"]), np.array(g["centre"])
    if len(ax) < 2 or len(ce) < 3:
        continue
    t = cKDTree(ax)
    d, _ = t.query(ce)
    radii.append(float(np.median(d[len(d) // 5:])) * 1000)  # skip the relaxed root
    # continuity is judged on the fall axis (≈ 12 mm segments): the helix itself turns
    # ~70° per 6.6 mm sample by construction, so its sampled turn measures pitch, not kinks
    seg = np.diff(ax, axis=0)
    seg /= np.maximum(np.linalg.norm(seg, axis=1, keepdims=True), 1e-12)
    ang = np.degrees(np.arccos(np.clip(np.sum(seg[1:] * seg[:-1], 1), -1, 1)))
    kinks.append(float(ang.max()) if ang.size else 0)
    lens.append(g["axisLengthMm"])
    pitches.append(g["pitchMm"])
    clump.append(g["clumpRadiusMm"])
    centres.append((ce, i, g["clumpRadiusMm"] / 1000))
allc = np.concatenate([c for c, _, _ in centres])
owner = np.concatenate([np.full(len(c), i) for c, i, _ in centres])
rad = np.concatenate([np.full(len(c), r) for c, _, r in centres])
tree = cKDTree(allc)
pairs = tree.query_pairs(r=0.004, output_type="ndarray")
pairs = pairs[owner[pairs[:, 0]] != owner[pairs[:, 1]]]
dd = np.linalg.norm(allc[pairs[:, 0]] - allc[pairs[:, 1]], axis=1)
hit = dd < (rad[pairs[:, 0]] + rad[pairs[:, 1]])
pts_hit = np.unique(np.r_[pairs[hit, 0], pairs[hit, 1]])
skin = np.concatenate([z5["lelu_scalp|basis"], z5["char1|basis"]])
ds, _ = cKDTree(skin).query(allc)
pen = float(np.mean(ds < rad * 0.5))


def dist(a):
    a = np.asarray(a)
    return {"n": int(a.size), "p10": round(float(np.percentile(a, 10)), 3), "p50": round(float(np.median(a)), 3), "p90": round(float(np.percentile(a, 90)), 3),
            "min": round(float(a.min()), 3), "max": round(float(a.max()), 3)}


curl = {
    "method": "measured on the ringlet centre lines written by the build (the polylines that were meshed): curl radius = median distance of the centre line from its fall axis (root fifth excluded), continuity = largest turn between consecutive ~12 mm segments of the fall axis, strand intersection = centre-line points of different ringlets closer than the sum of their clump radii, skin contact = centre-line points within half a clump radius of a skin/body vertex (vertex proxy, not a surface test)",
    "ringlets": len(G),
    "curlRadiusMm": dist(radii), "curlDiameterMm": dist(np.array(radii) * 2), "pitchMm": dist(pitches), "clumpRadiusMm": dist(clump),
    "axisLengthMm": dist(lens), "maxTurnDeg": dist(kinks),
    "strandIntersectionPointShare": round(float(len(pts_hit) / len(allc)), 4),
    "skinContactPointShare": round(pen, 4),
    "reference": {"source": "hair photographs: defined ringlets roughly 1.5–3 IPD-normalised units; target band 6–14 mm diameter", "targetDiameterMm": [6, 14]},
}
json.dump(curl, open(p("artifacts/foundry/m25/hair/curl-validation.json"), "w"), indent=1)
add(technical, "curl diameter p10–p90 (mm)", [curl["curlDiameterMm"]["p10"], curl["curlDiameterMm"]["p90"]], "inside 6–14 mm",
    6 <= curl["curlDiameterMm"]["p10"] and curl["curlDiameterMm"]["p90"] <= 14)
add(technical, "curl continuity: max turn of the ringlet fall axis, p90 (deg)", curl["maxTurnDeg"]["p90"], "< 60°", curl["maxTurnDeg"]["p90"] < 60)
add(technical, "ringlet–ringlet intersection (point share)", curl["strandIntersectionPointShare"], "< 0.10", curl["strandIntersectionPointShare"] < 0.10,
    note="clumped curls touch in real hair; this bounds interpenetration, it does not forbid contact")
add(technical, "ringlet–skin contact (vertex proxy, point share)", curl["skinContactPointShare"], "< 0.02", curl["skinContactPointShare"] < 0.02)

# ---------------------------------------------------------------- coverage
cov = {}
for v in ("v0004", "v0005"):
    for view in ("back-top", "back", "front"):
        f = p(f"artifacts/foundry/m25/verification/coverage/{v}-{view}.png")
        if not os.path.exists(f):
            continue
        a = np.asarray(Image.open(f).convert("RGB")).astype(int)
        red = (a[..., 0] > 128) & (a[..., 1] < 100)
        green = (a[..., 1] > 128) & (a[..., 0] < 100)
        cov[f"{v}-{view}"] = {"hairPx": int(green.sum()), "skinBodyPx": int(red.sum()),
                              "hairShareOfSubject": round(float(green.sum() / max(1, green.sum() + red.sum())), 4)}
if "v0005-back-top" in cov:
    add(technical, "crown coverage: hair share of hair + visible scalp, back-top view", {k: cov[k]["hairShareOfSubject"] for k in cov if "back-top" in k},
        "v0005 ≥ 0.95 and ≥ v0004", cov["v0005-back-top"]["hairShareOfSubject"] >= 0.95 and cov["v0005-back-top"]["hairShareOfSubject"] >= cov["v0004-back-top"]["hairShareOfSubject"])
    add(technical, "hair silhouette (front/back hair pixels) v0005 vs v0004", {k: cov[k]["hairPx"] for k in cov if "back-top" not in k},
        "v0005 ≥ 0.9 × v0004 (volume preserved)", all(cov[f"v0005-{w}"]["hairPx"] >= 0.9 * cov[f"v0004-{w}"]["hairPx"] for w in ("back", "front")))

# ------------------------------------------------------------- textures
imgs = {i["name"]: i["size"] for i in A["v0005"]["images"]}
add(technical, "texture resolution (v0005)", imgs, "head ≥ 4096², body ≥ 2048²",
    any(s == [4096, 4096] for s in imgs.values()) and any(s == [2048, 2048] for s in imgs.values()))
eye = {k: s for k, s in imgs.items() if "eye" in k}
add(technical, "eye texture resolution", eye, "≥ 256 px wide", all(s[0] >= 256 for s in eye.values()),
    note="not enlarged: no source with more eye detail exists (sockets under the patches are empty; photographs carry ~64–84 px per eye)")
add(technical, "UV stretch", "UVs not written by the M25 build (no UV operation); M24 measurement stands: p99/median 4.0", "unchanged", True,
    measurable=False, note="not re-measured in M25")

# ----------------------------------------------------- render metrics
acc = p("artifacts/foundry/m25/acceptance")
views = sorted(os.path.basename(f)[:-4] for f in glob.glob(os.path.join(acc, "v0005", "*.png")))
pix, times = {}, {}
for name in views:
    a, b = os.path.join(acc, "v0004", name + ".png"), os.path.join(acc, "v0005", name + ".png")
    if os.path.exists(a) and os.path.exists(b):
        x = np.asarray(Image.open(a).convert("RGB")).astype(float)
        y = np.asarray(Image.open(b).convert("RGB")).astype(float)
        pix[name] = round(float(np.sqrt(np.mean((x - y) ** 2))), 2)
    for v in ("v0004", "v0005"):
        j = os.path.join(acc, v, name + ".png.json")
        if os.path.exists(j):
            r = json.load(open(j))
            times.setdefault(name, {})[v] = {"seconds": r["renderSeconds"], "samples": r["samples"], "triangles": r["triangles"]}
add(technical, "views rendered for both versions", len(pix), "15", len(pix) == 15)
add(technical, "samples per acceptance render", sorted({t[v]["samples"] for t in times.values() for v in t}), "≥ 64",
    all(t[v]["samples"] >= 64 for t in times.values() for v in t))
noise_f = [os.path.join(acc, "noise", "01-front-face-seed0.png"), os.path.join(acc, "noise", "01-front-face-seed1.png")]
if all(os.path.exists(f) for f in noise_f):
    x, y = (np.asarray(Image.open(f).convert("RGB")).astype(float) for f in noise_f)
    noise = round(float(np.sqrt(np.mean((x - y) ** 2)) / np.sqrt(2)), 3)
    add(technical, "render noise: per-image RMS between two seeds / √2 (8-bit levels)", noise, "< 3.0", noise < 3.0)
else:
    add(technical, "render noise", None, "< 3.0", False, measurable=False, note="seed pair not rendered")

# ------------------------------------------------------ perceptual metrics
det = m25_color.detector(LANDMARKER)
photo = [m25_color.measure(det, p(f)) for f in PHOTOS]
plab = np.median(np.array([r["lab"] for r in photo if r["detected"]]), 0)
skin = {}
for v in ("v0004", "v0005"):
    f = os.path.join(acc, v, "01-front-face.png")
    if os.path.exists(f):
        r = m25_color.measure(det, f)
        if r["detected"]:
            skin[v] = {"lab": r["lab"], "dE2000": round(m25_color.de2000(plab, r["lab"]), 2)}
m24 = m25_color.measure(det, p("artifacts/foundry/m24/renders/face-close-up.png"))
skin["m24-render"] = {"lab": m24["lab"], "dE2000": round(m25_color.de2000(plab, m24["lab"]), 2)}
light = {}
for f in sorted(glob.glob(os.path.join(acc, "lighting", "*", "front-face-*.png"))):
    r = m25_color.measure(det, f)
    if r["detected"]:
        light[os.path.relpath(f, acc)] = {"lab": r["lab"], "dE2000": round(m25_color.de2000(plab, r["lab"]), 2)}
add(perceptual, "skin colour ΔE2000 vs photograph median, neutral studio front face",
    {"photoMedianLab": [round(float(x), 2) for x in plab], **skin}, "v0005 ≤ 6", skin.get("v0005", {}).get("dE2000", 99) <= 6,
    measurable="v0005" in skin)
ok_light = [v["dE2000"] for k, v in light.items() if k.startswith("lighting/v0005") and "warm" not in k]
add(perceptual, "skin colour ΔE2000 under neutral, soft-frontal and directional lighting (v0005)", light, "each ≤ 10",
    bool(ok_light) and all(x <= 10 for x in ok_light), measurable=bool(ok_light),
    note="warm-environment is reported but not thresholded: a warm light is meant to shift colour")
lm = {}
import m25_landmarks as L  # noqa: E402
for name, f in [("photos", None)] + [(v, os.path.join(acc, v, "01-front-face.png")) for v in ("v0004", "v0005")]:
    if f is None:
        rs = [L.measure(p(x)) for x in PHOTOS]
        rs = [r for r in rs if r["detected"]]
        lm["photos"] = {k: round(float(np.median([r["ratios"][k] for r in rs])), 4) for k in rs[0]["ratios"]}
        lm["photoSpread"] = {k: [round(float(min(r["ratios"][k] for r in rs)), 4), round(float(max(r["ratios"][k] for r in rs)), 4)] for k in rs[0]["ratios"]}
    elif os.path.exists(f):
        r = L.measure(f)
        if r["detected"]:
            lm[name] = r["ratios"]
if "v0005" in lm:
    dev = {k: round(100 * (lm["v0005"][k] - lm["photos"][k]) / lm["photos"][k], 2) for k in lm["photos"]}
    lm["v0005DeviationPct"] = dev
    add(perceptual, "facial landmark ratios vs photograph median (scale-free), max |deviation|", dev, "every ratio within ±8 %",
        all(abs(x) <= 8 for x in dev.values()))
json.dump(lm, open(p("artifacts/foundry/m25/anatomy/landmark-ratios.json"), "w"), indent=1)
add(perceptual, "pixel RMS change v0004 → v0005 per view (8-bit)", pix, "reported, not thresholded", True, measurable=False,
    note="a change is not an improvement; the rendered pairs are the evidence")
add(perceptual, "photographic resemblance (overall)", None, "human judgement on the rendered pairs", False, measurable=False,
    note="no metric decides identity; see M25-VISUAL-FIDELITY-RECONSTRUCTION.md for the reviewed verdict per view")

summary = {
    "technical": {k: sum(1 for m in technical if m["verdict"] == k) for k in ("PASS", "FAIL", "NOT MEASURABLE")},
    "perceptual": {k: sum(1 for m in perceptual if m["verdict"] == k) for k in ("PASS", "FAIL", "NOT MEASURABLE")},
}
out = {"versions": {v: {"file": V[v], "sha256": sha(V[v])} for v in V}, "summary": summary, "technical": technical, "perceptual": perceptual,
       "coverage": cov, "renderTimes": times}
json.dump(out, open(p("artifacts/foundry/m25/verification/validation.json"), "w"), indent=1)
print(json.dumps(summary))
for m in technical + perceptual:
    print(f'{m["verdict"]:15s} {m["metric"]}')
