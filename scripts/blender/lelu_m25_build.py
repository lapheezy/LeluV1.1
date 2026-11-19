"""
LÉLU M25 — build the v0005 visual-fidelity derivative from v0004.

    blender -b --factory-startup --python lelu_m25_build.py -- job.json

job.json:
    {
      "input":  ".../lelu-m24-hair-split.glb",      # v0004, read only
      "output": ".../lelu-m25-visual-fidelity.glb",  # v0005
      "report": ".../m25/build-report.json",
      "skin": {"L": 0.88, "a": 1.89, "b": 1.41},     # CIELAB transform for skin texels
      "seed": 25,
      "ringlets": 520, "flyaways": 1100, "babyHairs": 48
    }

What this does, in order, and why each step is local rather than global:

1. Texel-level material repair. The asset's own metallicRoughness maps put
   metallic up to 0.92 and roughness down to 0.09 on skin and hair texels —
   that is the "metallic" hair and the plastic sheen on her face. Texels are
   classified from the asset's own maps (metal where the map says metal) and
   only skin and hair texels are changed: metallic → 0, roughness raised to a
   floor. Metal texels keep their values.
2. Skin albedo. Skin texels — inside the UV footprint of triangles classified as
   skin, and passing a per-texel skin test — get a CIELAB transform measured
   against the photographs: L* is only ever scaled DOWN (never lightened), a*/b*
   are scaled by the ratio of photographed to rendered chroma.
3. Normals. The head and body are unwelded triangle soup whose exported normals
   are essentially per-face. Custom split normals are rebuilt from area-weighted
   face normals at coincident positions with an object-specific angle limit, so a
   real crease stays a crease. No vertex moves in this step.
4. Geometry. The crumpled shell Meshy fused onto her shoulders/back (dark hair
   albedo, mean dihedral ≥ 28°) is Taubin-smoothed on the position-welded graph
   with every vertex that touches a non-hair triangle pinned. Same for the hair
   foundation, more gently. Shape-key deltas are preserved exactly by moving every
   key block by the same displacement as the basis.
5. Hybrid hair. New geometry, skinned to Head/Spine02: rounded helical ringlets
   grown along the existing hair surface (primary), thin curled flyaways and
   baby hairs (secondary). The existing hair becomes the opaque foundation.

v0004 is never written. Every change is recorded in the report with counts and
magnitudes, and v0004 remains the one-step undo.
"""
import hashlib
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_m25_common as C  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
job = json.load(open(argv[0]))
T0 = time.time()


def tick(msg):
    print(f"M25_STEP {time.time() - T0:7.1f}s {msg}", flush=True)


rng = np.random.default_rng(int(job.get("seed", 25)))
R = {"input": job["input"], "inputSha256": hashlib.sha256(open(job["input"], "rb").read()).hexdigest(), "steps": {}}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
scene = bpy.context.scene
for o in list(scene.objects):
    if o.name == "Icosphere" and o.type == "MESH" and o.parent is None:
        # Blender's glTF importer creates this as a bone display shape; it is not in the file.
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()
rig = next(o for o in scene.objects if o.type == "ARMATURE")
obj = {o.name: o for o in scene.objects if o.type == "MESH"}
body, hair, scalp = obj["char1"], obj["lelu_hair"], obj["lelu_scalp"]

tick("import done")
# ------------------------------------------------------------ classification
A = {n: C.mesh_arrays(obj[n]) for n in ("char1", "lelu_hair", "lelu_scalp")}
TEX = {n: C.triangle_texture(obj[n], A[n]) for n in A}
DIH = {n: C.triangle_dihedral(A[n]["wco"], A[n]["tv"]) for n in A}
CLS = {n: C.classify(obj[n], A[n], TEX[n], DIH[n]) for n in A}
R["steps"]["classification"] = {n: {str(k): int(v) for k, v in zip(*np.unique(CLS[n], return_counts=True))} for n in CLS}

tick("classified")
# --------------------------------------------------------- 1+2. textures


def to_lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], -1)


def from_lab(lab):
    fy = (lab[:, 0] + 16) / 116
    fx = fy + lab[:, 1] / 500
    fz = fy - lab[:, 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * np.array([0.95047, 1.0, 1.08883])
    Mi = np.array([[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]])
    c = np.clip(xyz @ Mi.T, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def uv_mask(size, objs_and_masks):
    """Rasterise the UV footprint of selected triangles into a bottom-up boolean mask."""
    w, h = size
    im = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(im)
    for name, sel in objs_and_masks:
        uv = A[name]["uv"][A[name]["tl"][sel]]  # (k,3,2)
        px = np.stack([uv[..., 0] % 1.0 * w, (1 - uv[..., 1] % 1.0) * h], -1)
        for tri in px:
            dr.polygon([tuple(p) for p in tri], fill=255)
    arr = np.asarray(im)[::-1] > 0  # flip to Blender's bottom-up row order
    return arr


skin_cfg = job.get("skin", {"L": 1.0, "a": 1.0, "b": 1.0})
tex_report = {}


def repair_textures(label, albedo_img, mr_img, skin_tris, hair_tris, limit_hair_to_tris):
    w, h = albedo_img.size
    alb = C.image_array(albedo_img).copy()
    mr = C.image_array(mr_img).copy()
    if mr.shape[:2] != alb.shape[:2]:
        raise SystemExit(f"{label}: albedo and metallicRoughness sizes differ")
    flat_a = alb.reshape(-1, 4)
    flat_m = mr.reshape(-1, 4)
    hh, ss, vv = C.hsv(flat_a[:, :3])
    metal = flat_m[:, 2] >= 0.5
    skin_px = (hh >= 4) & (hh <= 42) & (ss >= 0.18) & (ss <= 0.85) & (vv >= 0.12) & ~metal
    skin_area = uv_mask((w, h), skin_tris).reshape(-1)
    skin_sel = skin_px & skin_area
    hair_px = (vv < 0.22) & ~metal
    if limit_hair_to_tris:
        hair_px &= uv_mask((w, h), hair_tris).reshape(-1)
    before = {"skinMetallicMean": float(flat_m[skin_sel, 2].mean()) if skin_sel.any() else None,
              "skinRoughnessP10": float(np.percentile(flat_m[skin_sel, 1], 10)) if skin_sel.any() else None,
              "hairMetallicMean": float(flat_m[hair_px, 2].mean()) if hair_px.any() else None,
              "hairRoughnessP10": float(np.percentile(flat_m[hair_px, 1], 10)) if hair_px.any() else None}
    # metallic / roughness
    flat_m[skin_sel, 2] = 0.0
    flat_m[skin_sel, 1] = np.clip(flat_m[skin_sel, 1], 0.48, 0.85)
    flat_m[hair_px, 2] = 0.0
    flat_m[hair_px, 1] = np.clip(flat_m[hair_px, 1], 0.55, 0.9)
    # skin colour
    lab = to_lab(flat_a[skin_sel, :3].astype(np.float64))
    lab0 = lab.copy()
    lab[:, 0] *= min(1.0, float(skin_cfg["L"]))  # never lighten
    # chroma: an additive shift plus an optional gain. A pure gain multiplies the
    # painted blush along with the complexion and turns cheeks into red blotches.
    lab[:, 1] = lab[:, 1] * float(skin_cfg.get("a", 1.0)) + float(skin_cfg.get("da", 0.0))
    lab[:, 2] = lab[:, 2] * float(skin_cfg.get("b", 1.0)) + float(skin_cfg.get("db", 0.0))
    flat_a[skin_sel, :3] = from_lab(lab).astype(np.float32)
    after = {"skinMetallicMean": float(flat_m[skin_sel, 2].mean()) if skin_sel.any() else None,
             "skinRoughnessP10": float(np.percentile(flat_m[skin_sel, 1], 10)) if skin_sel.any() else None,
             "hairMetallicMean": float(flat_m[hair_px, 2].mean()) if hair_px.any() else None}
    tex_report[label] = {
        "size": [w, h], "skinTexels": int(skin_sel.sum()), "hairTexels": int(hair_px.sum()), "metalTexelsUntouched": int(metal.sum()),
        "skinLabMedianBefore": [round(float(x), 2) for x in np.median(lab0, 0)] if skin_sel.any() else None,
        "skinLabMedianAfter": [round(float(x), 2) for x in np.median(lab, 0)] if skin_sel.any() else None,
        "before": before, "after": after,
    }
    na = bpy.data.images.new(f"m25_{label}_basecolor", w, h, alpha=True)
    na.pixels.foreach_set(flat_a.reshape(-1))
    na.file_format = "JPEG"
    na.pack()
    nm = bpy.data.images.new(f"m25_{label}_metalrough", w, h, alpha=False)
    nm.colorspace_settings.name = "Non-Color"
    nm.pixels.foreach_set(flat_m.reshape(-1))
    nm.file_format = "JPEG"
    nm.pack()
    return na, nm


tick("texture fns")
head_mat = hair.material_slots[0].material
body_mat = body.material_slots[0].material
ha, hm = repair_textures(
    "head", C.find_image(head_mat, "Base Color").image, C.find_image(head_mat, "Metallic").image,
    [("lelu_scalp", np.isin(CLS["lelu_scalp"], ["skin", "lips"])), ("lelu_hair", CLS["lelu_hair"] == "lips")],
    None, False)
ba, bm = repair_textures(
    "body", C.find_image(body_mat, "Base Color").image, C.find_image(body_mat, "Metallic").image,
    [("char1", CLS["char1"] == "skin")], [("char1", CLS["char1"] == "hair")], True)
R["steps"]["textures"] = tex_report


tick("textures repaired")
def clone_material(src, name, albedo, mr, normal_scale=None, rough_factor=None):
    m = src.copy()
    m.name = name
    nt = m.node_tree
    for socket, img in (("Base Color", albedo), ("Metallic", mr)):
        n = C.find_image(m, socket)
        if n is not None:
            n.image = img
    if normal_scale is not None:
        for n in nt.nodes:
            if n.type == "NORMAL_MAP":
                n.inputs["Strength"].default_value = normal_scale
    return m


MAT = {
    "skin_head": clone_material(head_mat, "m25_skin_head", ha, hm),
    "head_detail": clone_material(head_mat, "m25_head_detail", ha, hm),
    "hair_foundation": clone_material(head_mat, "m25_hair_foundation", ha, hm, normal_scale=0.6),
    "body": clone_material(body_mat, "m25_body", ba, bm),
    "skin_body": clone_material(body_mat, "m25_skin_body", ba, bm),
    "hair_body": clone_material(body_mat, "m25_hair_body", ba, bm, normal_scale=0.6),
}
for m in MAT.values():
    m.blend_method = "OPAQUE" if hasattr(m, "blend_method") else None
    try:
        m.surface_render_method = "DITHERED"
    except Exception:
        pass


def assign(o, slots, cls_of_tri):
    me = o.data
    me.materials.clear()
    for s in slots:
        me.materials.append(MAT[s[0]])
    idx = np.zeros(len(me.polygons), np.int32)
    tp = A[o.name]["tp"]
    for i, (_, classes) in enumerate(slots):
        if classes:
            sel = np.isin(cls_of_tri, classes)
            idx[tp[sel]] = i
    me.polygons.foreach_set("material_index", idx)


assign(scalp, [("head_detail", None), ("skin_head", ["skin", "lips"])], CLS["lelu_scalp"])
assign(hair, [("hair_foundation", None), ("head_detail", ["metal", "flower", "lips"])], CLS["lelu_hair"])
assign(body, [("body", None), ("skin_body", ["skin"]), ("hair_body", ["hair"])], CLS["char1"])

tick("materials")
# ------------------------------------------------------------- 4. geometry


def taubin(o, movable_tris, iters, lam=0.5, mu=-0.53, clamp_m=None):
    """Taubin smoothing on the position-welded graph. Only vertices whose every
    incident triangle is in `movable_tris` move; all coincident copies move together;
    every shape key block receives the same displacement as the basis."""
    a = A[o.name]
    wid = C.weld_ids(a["wco"])
    nw = int(wid.max()) + 1
    wt = wid[a["tv"]]
    pos = np.zeros((nw, 3))
    np.add.at(pos, wid, a["co"])
    cnt = np.bincount(wid, minlength=nw)[:, None]
    pos /= cnt
    pinned = np.zeros(nw, bool)
    pinned[np.unique(wt[~movable_tris])] = True
    used = np.zeros(nw, bool)
    used[np.unique(wt[movable_tris])] = True
    free = used & ~pinned
    e = np.concatenate([wt[:, [0, 1]], wt[:, [1, 2]], wt[:, [2, 0]]], 0)
    e = np.unique(np.sort(e, 1), axis=0)
    e = e[e[:, 0] != e[:, 1]]
    deg = np.bincount(e.reshape(-1), minlength=nw)[:, None].astype(np.float64)
    p0 = pos.copy()
    for _ in range(iters):
        for f in (lam, mu):
            acc = np.zeros_like(pos)
            np.add.at(acc, e[:, 0], pos[e[:, 1]])
            np.add.at(acc, e[:, 1], pos[e[:, 0]])
            lap = acc / np.maximum(deg, 1) - pos
            pos[free] += f * lap[free]
    disp_w = pos - p0
    scale0 = float(np.linalg.norm(a["m"][:3, 0]))
    clamped = 0
    if clamp_m is not None:
        mag = np.linalg.norm(disp_w, axis=1) * scale0
        over = mag > clamp_m
        clamped = int(over.sum())
        disp_w[over] *= (clamp_m / mag[over])[:, None]
    disp = disp_w[wid]  # per original vertex, local units
    me = o.data
    co = a["co"] + disp
    me.vertices.foreach_set("co", co.astype(np.float32).reshape(-1))
    if me.shape_keys:
        for kb in me.shape_keys.key_blocks:
            k = np.empty(len(me.vertices) * 3, np.float32)
            kb.data.foreach_get("co", k)
            kb.data.foreach_set("co", (k.reshape(-1, 3) + disp).astype(np.float32).reshape(-1))
    me.update()
    scale = float(np.linalg.norm(a["m"][:3, 0]))
    moved = np.linalg.norm(disp_w[free], axis=1) * scale * 1000
    a["co"] = co
    a["wco"] = co @ a["m"][:3, :3].T + a["m"][:3, 3]
    return {"iterations": iters, "lambda": lam, "mu": mu, "movableTriangles": int(movable_tris.sum()),
            "clampMm": clamp_m * 1000 if clamp_m else None, "clampedPositions": clamped,
            "movedPositions": int(free.sum()), "pinnedPositions": int((used & pinned).sum()),
            "displacementMm": {"mean": round(float(moved.mean()), 3) if moved.size else 0, "p90": round(float(np.percentile(moved, 90)), 3) if moved.size else 0,
                               "max": round(float(moved.max()), 3) if moved.size else 0}}


geo = {}
cape = CLS["char1"] == "hair"
d0 = DIH["char1"][cape]
geo["char1.hairCape"] = taubin(body, cape, int(job.get("capeIterations", 12)), clamp_m=0.015)
# the same crumple outside the hair class: shoulders, upper back and upper arms (any
# material), only where the surface is folded (mean dihedral >= 35 deg)
cen1 = A["char1"]["wco"][A["char1"]["tv"]].mean(1)
shoulder_zone = (cen1[:, 2] > 1.15) & (cen1[:, 2] < 1.47) & ((np.abs(cen1[:, 0]) > 0.07) | (cen1[:, 1] > 0.02))
crumple = shoulder_zone & (DIH["char1"] >= 35) & ~cape
d1 = DIH["char1"][crumple]
geo["char1.shoulderCrumple"] = taubin(body, crumple, int(job.get("shoulderIterations", 6)), clamp_m=0.008)
DIH["char1"] = C.triangle_dihedral(A["char1"]["wco"], A["char1"]["tv"])
geo["char1.shoulderCrumple"]["meanDihedralDeg"] = {"before": round(float(np.median(d1)), 2), "after": round(float(np.median(DIH["char1"][crumple])), 2)}
geo["char1.hairCape"]["meanDihedralDeg"] = {"before": round(float(np.median(d0)), 2), "after": round(float(np.median(DIH["char1"][cape])), 2)}
hf = CLS["lelu_hair"] == "hair"
# lashes, brows and the fringe in front of the face carry hair albedo too; they are
# fine features, not crumple, so everything inside the face zone stays where it is
face_hair = C.in_face(A["lelu_hair"]["wco"][A["lelu_hair"]["tv"]].mean(1))
hf_move = hf & ~face_hair
d0 = DIH["lelu_hair"][hf_move]
geo["lelu_hair.foundation"] = taubin(hair, hf_move, int(job.get("foundationIterations", 4)), clamp_m=0.006)
DIH["lelu_hair"] = C.triangle_dihedral(A["lelu_hair"]["wco"], A["lelu_hair"]["tv"])
geo["lelu_hair.foundation"]["faceZoneTrianglesPinned"] = int((hf & face_hair).sum())
geo["lelu_hair.foundation"]["meanDihedralDeg"] = {"before": round(float(np.median(d0)), 2), "after": round(float(np.median(DIH["lelu_hair"][hf_move])), 2)}
R["steps"]["geometry"] = geo

tick("geometry")
# --------------------------------------------------------------- 3. normals


def rebuild_normals(o, limit_deg_by_class):
    a = A[o.name]
    me = o.data
    fn, area = C.face_normals(a["wco"], a["tv"])
    nt = len(fn)
    wid = C.weld_ids(a["wco"])
    lim = np.full(nt, 45.0)
    cls = CLS.get(o.name)
    if cls is not None:
        for k, v in limit_deg_by_class.items():
            lim[cls == k] = v
        if "face" in limit_deg_by_class:
            lim[C.in_face(a["wco"][a["tv"]].mean(1))] = limit_deg_by_class["face"]
    else:
        lim[:] = limit_deg_by_class.get("default", 45.0)
    # corner list: (position id, triangle)
    cw = wid[a["tv"]].reshape(-1)
    ct = np.repeat(np.arange(nt), 3)
    order = np.argsort(cw, kind="stable")
    cw_s, ct_s = cw[order], ct[order]
    starts = np.r_[0, np.nonzero(np.diff(cw_s))[0] + 1]
    sizes = np.diff(np.r_[starts, len(cw_s)])
    # pairs within each group: for corner i in a group, all corners j in the same group
    gid = np.repeat(np.arange(len(starts)), sizes)
    rep = sizes[gid]
    i_idx = np.repeat(np.arange(len(cw_s)), rep)
    off = np.arange(len(i_idx)) - np.repeat(np.cumsum(rep) - rep, rep)
    j_idx = starts[gid[i_idx]] + off
    ti, tj = ct_s[i_idx], ct_s[j_idx]
    cosv = np.sum(fn[ti] * fn[tj], 1)
    ok = cosv >= np.cos(np.radians(np.minimum(lim[ti], lim[tj])))
    acc = np.zeros((len(cw_s), 3))
    np.add.at(acc, i_idx[ok], fn[tj[ok]] * area[tj[ok], None])
    nrm = acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-20)
    corner_n = np.empty((len(cw_s), 3))
    corner_n[order] = nrm
    # back to object space, then to loops
    inv = np.linalg.inv(a["m"][:3, :3]).T
    corner_n = corner_n @ inv.T
    corner_n /= np.maximum(np.linalg.norm(corner_n, axis=1, keepdims=True), 1e-20)
    loop_n = np.zeros((len(me.loops), 3))
    loop_n[a["tl"].reshape(-1)] = corner_n
    me.normals_split_custom_set(loop_n.tolist())
    dev = np.degrees(np.arccos(np.clip(np.sum(nrm * fn[ct_s], 1), -1, 1)))
    return {"limitDegByClass": limit_deg_by_class, "corners": int(len(cw_s)),
            "cornerVsFaceDeviationDegMedian": round(float(np.median(dev)), 3),
            "flatCornersShare": round(float(np.mean(dev < 0.5)), 4)}


nrep = {}
nrep["char1"] = rebuild_normals(body, {"skin": 50, "fabric": 40, "metal": 30, "hair": 80})
nrep["lelu_scalp"] = rebuild_normals(scalp, {"skin": 50, "lips": 45, "metal": 30, "flower": 55, "hair": 75})
nrep["lelu_hair"] = rebuild_normals(hair, {"hair": 80, "metal": 30, "flower": 55, "lips": 45, "face": 45})
R["steps"]["normals"] = nrep

tick("normals")
# ----------------------------------------------------------------- 5. hair
head_wco = A["lelu_hair"]["wco"]
hair_tris_w = head_wco[A["lelu_hair"]["tv"][hf]]
cape_tris_w = A["char1"]["wco"][A["char1"]["tv"][cape]]
surf = np.concatenate([hair_tris_w, cape_tris_w], 0)
bvh = BVHTree.FromPolygons(surf.reshape(-1, 3).tolist(), np.arange(len(surf) * 3).reshape(-1, 3).tolist(), epsilon=0.0)
skin_tris = np.concatenate([A["lelu_scalp"]["wco"][A["lelu_scalp"]["tv"]], A["char1"]["wco"][A["char1"]["tv"][CLS["char1"] != "hair"]]], 0)
skin_bvh = BVHTree.FromPolygons(skin_tris.reshape(-1, 3).tolist(), np.arange(len(skin_tris) * 3).reshape(-1, 3).tolist(), epsilon=0.0)
head_c = np.array([0.0, -0.012, 1.585])
area_w = np.linalg.norm(np.cross(surf[:, 1] - surf[:, 0], surf[:, 2] - surf[:, 0]), axis=1) / 2


def outward(p):
    q = np.array([head_c[0], head_c[1], np.clip(p[2], 1.20, head_c[2])])
    d = p - q
    if p[2] > head_c[2]:
        d = p - head_c
    n = np.linalg.norm(d)
    return d / n if n > 1e-9 else np.array([0, 0, 1.0])


def in_face_zone(p, margin=0.0):
    return abs(p[0]) < 0.060 + margin and p[1] < -0.050 and 1.50 - margin < p[2] < 1.668


def is_outer(p, o):
    hit = bvh.ray_cast(Vector(p + o * 0.003), Vector(o), 0.05)
    return hit[0] is None


def sample_surface(n):
    tri = rng.choice(len(surf), size=n * 6, p=area_w / area_w.sum())
    r1, r2 = rng.random(n * 6), rng.random(n * 6)
    s = np.sqrt(r1)
    pts = surf[tri, 0] * (1 - s)[:, None] + surf[tri, 1] * (s * (1 - r2))[:, None] + surf[tri, 2] * (s * r2)[:, None]
    return pts


def grow(root, R_c, step=0.004, max_len=0.30):
    """March a ringlet axis down the outer hair surface, offset by the curl envelope."""
    pts = [root]
    d = np.array([0, 0, -1.0])
    length = 0.0
    off = R_c + 0.002
    stalled = 0
    for _ in range(int(max_len / step * 3)):
        if length >= max_len:
            break
        o = outward(pts[-1])
        grav = np.array([0, 0, -1.0])
        d = 0.55 * grav + 0.45 * d + 0.15 * o
        d /= np.linalg.norm(d)
        p = pts[-1] + d * step
        loc, nrm, idx, dist = bvh.find_nearest(Vector(p), 0.06)
        if loc is None or dist > 0.030:
            break
        q = np.array(loc) + outward(np.array(loc)) * off
        p = 0.45 * p + 0.55 * q
        if in_face_zone(p, 0.004):
            p[0] += math.copysign(0.004, p[0] if p[0] != 0 else 1.0)
            p[1] += 0.002
        sl, sn, si, sd = skin_bvh.find_nearest(Vector(p), 0.05)
        if sl is not None and sd < R_c + 0.0015:
            push = (np.array(p) - np.array(sl))
            nn = np.linalg.norm(push)
            if nn > 1e-9:
                p = np.array(sl) + push / nn * (R_c + 0.0015)
        moved = np.linalg.norm(p - pts[-1])
        if moved < step * 0.25:
            stalled += 1
            if stalled > 3:
                break
        length += moved
        pts.append(p)
        if p[2] < 1.02:
            break
    return np.array(pts)


def resample(poly, spacing):
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    if s[-1] < spacing * 2:
        return None
    t = np.arange(0, s[-1], spacing)
    return np.stack([np.interp(t, s, poly[:, i]) for i in range(3)], 1)


def smooth_poly(p, it=6):
    p = p.copy()
    for _ in range(it):
        p[1:-1] = 0.5 * p[1:-1] + 0.25 * (p[:-2] + p[2:])
    return p


def frames(c):
    t = np.gradient(c, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
    n = np.zeros_like(c)
    ref = np.array([1.0, 0, 0]) if abs(t[0, 0]) < 0.9 else np.array([0, 1.0, 0])
    n0 = np.cross(t[0], ref)
    n[0] = n0 / np.linalg.norm(n0)
    for i in range(1, len(c)):
        v = n[i - 1] - np.dot(n[i - 1], t[i]) * t[i]
        ln = np.linalg.norm(v)
        n[i] = v / ln if ln > 1e-12 else n[i - 1]
    b = np.cross(t, n)
    return t, n, b


def helix(axis, R_c, pitch, phase, root_relax=0.015, ds=0.0011):
    """Centre line of a ringlet: a helix of radius R_c and given pitch around `axis`.
    The first `root_relax` metres open from 35 % of the radius (a curl falls from a
    straighter root), and the last 10 % tighten by 15 %."""
    ax = resample(axis, ds)
    if ax is None:
        return None
    _, n, b = frames(ax)
    s = np.arange(len(ax)) * ds
    L = s[-1]
    r = R_c * np.clip(0.35 + 0.65 * s / root_relax, 0.35, 1.0)
    r *= np.where(s > 0.9 * L, 1 - 0.15 * (s - 0.9 * L) / (0.1 * L + 1e-9), 1.0)
    ang = phase + 2 * np.pi * s / pitch
    return ax + (np.cos(ang) * r)[:, None] * n + (np.sin(ang) * r)[:, None] * b


def tube(center, radius, sides, taper=0.35):
    """Rounded tube: `sides` vertices per ring, smooth shading gives a round profile."""
    center = resample(center, float(job.get("ringSpacing", 0.0028)))
    if center is None or len(center) < 3:
        return None, None
    _, n, b = frames(center)
    k = len(center)
    rr = radius * np.r_[np.linspace(0.6, 1.0, min(3, k)), np.ones(max(0, k - 3))][:k]
    tip = max(2, k // 8)
    rr[-tip:] *= np.linspace(1.0, taper, tip)
    th = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    ring = np.cos(th)[None, :, None] * n[:, None, :] + np.sin(th)[None, :, None] * b[:, None, :]
    verts = (center[:, None, :] + rr[:, None, None] * ring).reshape(-1, 3)
    i = np.arange(k - 1)[:, None] * sides
    j = np.arange(sides)[None, :]
    a0, a1 = i + j, i + (j + 1) % sides
    b0, b1 = a0 + sides, a1 + sides
    quads = np.stack([a0, b0, b1, a1], -1).reshape(-1, 4)
    return verts, quads


strands = {"primary": [], "secondary": [], "baby": []}
ringlet_params = []
n_ring = int(job.get("ringlets", 520))
cand = sample_surface(n_ring)
accepted = []
min_sep = float(job.get("rootSpacing", 0.011))
from mathutils.kdtree import KDTree  # noqa: E402

tries = 0
kd_pts = []
for p in cand:
    if len(accepted) >= n_ring:
        break
    tries += 1
    o = outward(p)
    if in_face_zone(p, 0.006) or p[2] < 1.10:
        continue
    if not is_outer(p, o):
        continue
    if kd_pts:
        kd = KDTree(len(kd_pts))
        for i_, q in enumerate(kd_pts):
            kd.insert(q, i_)
        kd.balance()
        if kd.find(Vector(p))[2] < min_sep:
            continue
    kd_pts.append(Vector(p))
    accepted.append(p)
rejected_roots = int(tries - len(accepted))

tick("roots")
for k, p in enumerate(accepted):
    R_c = float(rng.uniform(0.0034, 0.0062))         # curl radius 3.4–6.2 mm (diameter 7–12 mm)
    pitch = float(rng.uniform(0.010, 0.016))         # one turn per 10–16 mm of fall
    r_t = float(rng.uniform(0.0013, 0.0020))         # ringlet clump radius 1.3–2.0 mm
    max_len = float(rng.uniform(0.12, 0.36))
    axis = grow(p + outward(p) * (R_c + 0.002), R_c, max_len=max_len)
    if len(axis) < 6:
        continue
    axis = smooth_poly(resample(axis, 0.003) if resample(axis, 0.003) is not None else axis, 8)
    phase = float(rng.uniform(0, 2 * np.pi))
    cen = helix(axis, R_c, pitch, phase)
    if cen is None:
        continue
    hi_light = bool(rng.random() < 0.10)
    strands["primary"].append((cen, r_t, "highlight" if hi_light else "curl"))
    ringlet_params.append({"curlRadiusMm": round(R_c * 1000, 3), "pitchMm": round(pitch * 1000, 3), "clumpRadiusMm": round(r_t * 1000, 3),
                           "axisLengthMm": round(float(np.sum(np.linalg.norm(np.diff(axis, axis=0), axis=1))) * 1000, 1),
                           "root": [round(float(x), 4) for x in p], "highlight": hi_light, "axis": axis[::4].round(5).tolist(), "centre": cen[::6].round(5).tolist()})

tick("ringlets grown")
# secondary: flyaways leaving the outer surface, finer and looser
for p in sample_surface(int(job.get("flyaways", 1100)))[: int(job.get("flyaways", 1100))]:
    o = outward(p)
    if in_face_zone(p, 0.004) or p[2] < 1.10 or not is_outer(p, o):
        continue
    L = rng.uniform(0.015, 0.045)
    d = o * 0.25 + np.array([0, 0, -1.0]) * 0.75 + rng.normal(0, 0.18, 3)
    d /= np.linalg.norm(d)
    ax = np.array([p + d * L * t + np.array([0, 0, -0.5]) * (L * t) ** 2 * 3 for t in np.linspace(0, 1, 12)])
    cen = helix(ax, rng.uniform(0.0015, 0.0035), rng.uniform(0.006, 0.011), rng.uniform(0, 6.28), root_relax=0.004, ds=0.0008)
    if cen is not None:
        strands["secondary"].append((cen, float(rng.uniform(0.00016, 0.00028)), "strand"))

# baby hairs and forehead spirals: on the hairline, lying on the skin
sc = A["lelu_scalp"]
sc_cen = sc["wco"][sc["tv"]].mean(1)
skin_c = np.isin(CLS["lelu_scalp"], ["skin"])
hairline = []
for p in sc_cen[(~skin_c) & (np.abs(sc_cen[:, 0]) < 0.065) & (sc_cen[:, 1] < -0.04) & (sc_cen[:, 2] > 1.625) & (sc_cen[:, 2] < 1.70)]:
    hairline.append(p)
hairline = np.array(hairline) if hairline else np.zeros((0, 3))
if len(hairline):
    pick = hairline[rng.choice(len(hairline), size=min(int(job.get("babyHairs", 48)), len(hairline)), replace=False)]
    for p in pick:
        loc, nrm, _, _ = skin_bvh.find_nearest(Vector(p), 0.03)
        if loc is None:
            continue
        nrm = np.array(nrm)
        nrm = nrm if np.dot(nrm, outward(np.array(loc))) > 0 else -nrm
        tdir = np.cross(nrm, np.array([0, 0, 1.0]))
        tdir = tdir / (np.linalg.norm(tdir) + 1e-9) * (1 if np.array(loc)[0] < 0 else -1)
        down = np.cross(tdir, nrm)
        L = rng.uniform(0.008, 0.02)
        turns = rng.uniform(0.6, 1.4)
        t = np.linspace(0, 1, 40)
        rad = L * 0.35 * (1 - 0.7 * t)
        ang = turns * 2 * np.pi * t
        pts = np.array(loc) + nrm * 0.0004 + (tdir[None] * (np.cos(ang) * rad)[:, None] + down[None] * (np.sin(ang) * rad + 0.4 * L * t)[:, None])
        strands["baby"].append((pts, 0.00012, "strand"))


tick("strands")
def truncate_face(c, margin):
    """Cut a centre line where it first enters the face zone: her face stays uncovered."""
    inside = (np.abs(c[:, 0]) < 0.060 + margin) & (c[:, 1] < -0.050) & (c[:, 2] > 1.50 - margin) & (c[:, 2] < 1.668)
    if not inside.any():
        return c, False
    k = int(np.argmax(inside))
    return (c[:k] if k >= 8 else None), True


# Accessories (jewellery and flowers, classified from the asset's own maps) must stay
# visible: a ringlet or fibre is cut where its centre line first comes within
# `accessoryClearance` (+ its own radius) of an accessory triangle. 0 disables.
acc_clear = float(job.get("accessoryClearance", 0.0))
acc_tree = None
if acc_clear > 0:
    acc_pts = []
    for nm in ("lelu_hair", "lelu_scalp", "char1"):
        cen_ = A[nm]["wco"][A[nm]["tv"]].mean(1)
        sel_ = np.isin(CLS[nm], ["metal", "flower"])
        if nm == "char1":
            sel_ &= cen_[:, 2] > 1.10
        acc_pts.append(cen_[sel_])
    acc_pts = np.concatenate(acc_pts)
    acc_tree = KDTree(len(acc_pts))
    for i_, q_ in enumerate(acc_pts):
        acc_tree.insert(Vector(q_), i_)
    acc_tree.balance()


def truncate_accessory(c, margin):
    if acc_tree is None:
        return c, False
    for k_, q_ in enumerate(c):
        if acc_tree.find(Vector(q_))[2] < margin:
            return (c[:k_] if k_ >= 8 else None), True
    return c, False


truncated = 0
truncated_acc = 0
for key in ("primary", "secondary"):
    kept = []
    for c, r, kind in strands[key]:
        c2, cut = truncate_face(c, r + 0.001)
        truncated += int(cut)
        if c2 is not None:
            c2, cut2 = truncate_accessory(c2, r + acc_clear)
            truncated_acc += int(cut2)
        if c2 is not None:
            kept.append((c2, r, kind))
    strands[key] = kept


def build_object(name, items, sides, mats):
    allv, allq, mi = [], [], []
    base = 0
    lengths = []
    for (c, r, kind) in items:
        v, q = tube(c, r, sides)
        if v is None:
            continue
        allv.append(v)
        allq.append(q + base)
        mi.append(np.full(len(q), list(mats).index(kind), np.int32))
        base += len(v)
        lengths.append(float(np.sum(np.linalg.norm(np.diff(c, axis=0), axis=1))))
    V = np.concatenate(allv)
    Q = np.concatenate(allq)
    M_ = np.concatenate(mi)
    ref = hair.matrix_world.copy()
    inv = np.array(ref.inverted())
    Vl = V @ inv[:3, :3].T + inv[:3, 3]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(Vl))
    me.vertices.foreach_set("co", Vl.astype(np.float32).reshape(-1))
    me.loops.add(len(Q) * 4)
    me.loops.foreach_set("vertex_index", Q.reshape(-1).astype(np.int32))
    me.polygons.add(len(Q))
    me.polygons.foreach_set("loop_start", (np.arange(len(Q)) * 4).astype(np.int32))
    me.polygons.foreach_set("material_index", M_)
    me.polygons.foreach_set("use_smooth", np.ones(len(Q), bool))
    me.update(calc_edges=True)
    me.validate()
    for k in mats:
        me.materials.append(mats[k])
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.parent = rig
    ob.matrix_world = ref
    # skin: Head above 1.50 m, blended to Spine02 by 1.30 m (long hair rides the back)
    z = V[:, 2]
    wh = np.clip((z - 1.30) / 0.20, 0, 1)
    gh = ob.vertex_groups.new(name="Head")
    gs = ob.vertex_groups.new(name="Spine02")
    for i_, w_ in enumerate(wh.tolist()):
        if w_ > 0:
            gh.add([i_], w_, "REPLACE")
        if w_ < 1:
            gs.add([i_], 1 - w_, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    return ob, {"strands": len(lengths), "vertices": int(len(V)), "triangles": int(len(Q) * 2),
                "strandLengthMm": {"p10": round(float(np.percentile(lengths, 10)) * 1000, 1), "p50": round(float(np.median(lengths)) * 1000, 1),
                                   "p90": round(float(np.percentile(lengths, 90)) * 1000, 1)} if lengths else None}


def hair_mat(name, color, rough, spec=0.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = 0.0
    p.inputs["Specular IOR Level"].default_value = spec
    return m


# near-black brown with a burgundy highlight family, sampled from the hair photographs'
# darkest and highlight clusters (linear values)
curl_mats = {"curl": hair_mat("m25_hair_curl", (0.010, 0.0055, 0.0048), 0.42),
             "highlight": hair_mat("m25_hair_highlight", (0.040, 0.009, 0.014), 0.40)}
strand_mats = {"strand": hair_mat("m25_hair_strand", (0.014, 0.0075, 0.0065), 0.45)}
hair_out = {}
_, hair_out["primary"] = build_object("lelu_hair_ringlets", strands["primary"], int(job.get("sides", 6)), curl_mats)
_, hair_out["secondary"] = build_object("lelu_hair_strands", strands["secondary"] + strands["baby"], 3, strand_mats)
hair_out["babyHairs"] = len(strands["baby"])
hair_out["flyaways"] = len(strands["secondary"])
hair_out["ringlets"] = len(ringlet_params)
hair_out["rootsRejected"] = rejected_roots
hair_out["truncatedAtFace"] = truncated
hair_out["truncatedAtAccessory"] = truncated_acc
hair_out["accessoryClearanceMm"] = acc_clear * 1000
R["steps"]["hair"] = hair_out
json.dump({"ringlets": ringlet_params}, open(os.path.join(os.path.dirname(job["report"]), "ringlet-guides.json"), "w"))

tick("hair objects")
# ------------------------------------------------------------------ export
for o in scene.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True, use_selection=False,
                          export_image_format="JPEG", export_jpeg_quality=int(job.get("jpegQuality", 90)))
R["output"] = job["output"]
R["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
R["outputBytes"] = os.path.getsize(job["output"])
R["seconds"] = round(time.time() - T0, 1)
R["blender"] = bpy.app.version_string
R["job"] = {k: v for k, v in job.items() if k not in ("input", "output", "report")}
json.dump(R, open(job["report"], "w"), indent=1)
print("M25_BUILD", json.dumps({"bytes": R["outputBytes"], "s": R["seconds"], "hair": hair_out}))
