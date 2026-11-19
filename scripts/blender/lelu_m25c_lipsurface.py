"""
LÉLU M25 Complete — smooth the lip surface and the shading around the mouth.

    blender -b --factory-startup --python lelu_m25c_lipsurface.py -- job.json
    job: {"input", "output", "report", "iterations": 4, "clampMm": 0.8, "normalLimitDeg": 70,
          "lip": {"centre": [0, -0.1, 1.546], "radii": [0.021, 0.0115]},
          "face": {"x": 0.05, "z": [1.51, 1.585], "yMax": -0.06}}

Lips and lower face are unwelded triangle soup with per-face folds: in the
matched-framing comparison with the photographs, the lips read faceted where
the photographs are smooth and glossy. Two local operations, nothing global:

1. Taubin smoothing on the position-welded vertices inside the lip ellipse
   (lelu_scalp + lelu_hair), weighted by a smooth falloff so the ellipse edge
   does not move; displacement clamped; every shape key gets the same
   displacement as its basis, so smile/jaw/blink deltas are unchanged.
2. Custom split normals rebuilt (area-weighted at coincident positions, angle
   limit `normalLimitDeg`) for loops whose triangle lies in the lower-face box;
   every other loop keeps its existing custom normal.
"""
import hashlib
import json
import sys

import bpy
import numpy as np

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
lip = job.get("lip", {"centre": [0, -0.1, 1.546], "radii": [0.021, 0.0115]})
face = job.get("face", {"x": 0.05, "z": [1.51, 1.585], "yMax": -0.06})
iters = int(job.get("iterations", 4))
clamp = float(job.get("clampMm", 0.8)) / 1000
limit = float(job.get("normalLimitDeg", 70))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
for o in list(bpy.data.objects):
    if o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()

objs = [bpy.data.objects["lelu_scalp"], bpy.data.objects["lelu_hair"]]
data = []
for o in objs:
    me = o.data
    me.calc_loop_triangles()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    M = np.array(o.matrix_world)
    w = co @ M[:3, :3].T + M[:3, 3]
    tv = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", tv)
    tl = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("loops", tl)
    data.append({"o": o, "co": co, "w": w, "M": M, "tv": tv.reshape(-1, 3), "tl": tl.reshape(-1, 3)})

# joint welded graph across both objects
allw = np.concatenate([d["w"] for d in data])
q = np.round(allw / 1e-6).astype(np.int64)
_, wid = np.unique(q, axis=0, return_inverse=True)
wid = wid.reshape(-1)
offs = np.cumsum([0] + [len(d["w"]) for d in data])
nw = int(wid.max()) + 1
pos = np.zeros((nw, 3))
np.add.at(pos, wid, allw)
pos /= np.bincount(wid, minlength=nw)[:, None]
cx, cy, cz = lip["centre"]
rx, rz = lip["radii"]
r = ((pos[:, 0] - cx) / rx) ** 2 + ((pos[:, 2] - cz) / rz) ** 2
front = pos[:, 1] < cy + 0.02
t = np.clip(1 - r, 0, 1)
wgt = np.where(front, t * t * (3 - 2 * t), 0.0)
edges = []
for k, d in enumerate(data):
    g = wid[offs[k]:offs[k + 1]][d["tv"]]
    edges.append(np.concatenate([g[:, [0, 1]], g[:, [1, 2]], g[:, [2, 0]]]))
e = np.unique(np.sort(np.concatenate(edges), 1), axis=0)
e = e[e[:, 0] != e[:, 1]]
deg = np.bincount(e.reshape(-1), minlength=nw)[:, None].astype(float)
p0 = pos.copy()
for _ in range(iters):
    for f in (0.5, -0.53):
        acc = np.zeros_like(pos)
        np.add.at(acc, e[:, 0], pos[e[:, 1]])
        np.add.at(acc, e[:, 1], pos[e[:, 0]])
        lap = acc / np.maximum(deg, 1) - pos
        pos += f * wgt[:, None] * lap
disp = pos - p0
mag = np.linalg.norm(disp, axis=1)
over = mag > clamp
disp[over] *= (clamp / mag[over])[:, None]
moved = wgt > 0
report = {"iterations": iters, "clampMm": clamp * 1000, "movedPositions": int((mag > 1e-7).sum()),
          "displacementMm": {"p50": round(float(np.median(np.linalg.norm(disp[moved], axis=1))) * 1000, 3) if moved.any() else 0,
                             "max": round(float(np.linalg.norm(disp, axis=1).max()) * 1000, 3)},
          "normalLimitDeg": limit, "objects": {}}

for k, d in enumerate(data):
    o, me = d["o"], d["o"].data
    dv_w = disp[wid[offs[k]:offs[k + 1]]]
    dv = dv_w @ np.linalg.inv(d["M"][:3, :3]).T
    new = d["co"] + dv
    me.vertices.foreach_set("co", new.astype(np.float32).reshape(-1))
    if me.shape_keys:
        for kb in me.shape_keys.key_blocks:
            kk = np.empty(len(me.vertices) * 3, np.float32)
            kb.data.foreach_get("co", kk)
            kb.data.foreach_set("co", (kk.reshape(-1, 3) + dv).astype(np.float32).reshape(-1))
    me.update()
    d["w"] = new @ d["M"][:3, :3].T + d["M"][:3, 3]

# normals in the lower-face box, from both objects' faces together
allw = np.concatenate([d["w"] for d in data])
fn_all, ar_all, cen_all, tri_obj, tri_idx = [], [], [], [], []
for k, d in enumerate(data):
    a, b, c = (d["w"][d["tv"][:, i]] for i in range(3))
    cr = np.cross(b - a, c - a)
    ar = np.linalg.norm(cr, axis=1)
    fn_all.append(cr / np.maximum(ar[:, None], 1e-20))
    ar_all.append(ar / 2)
    cen_all.append((a + b + c) / 3)
fn = np.concatenate(fn_all)
ar = np.concatenate(ar_all)
cen = np.concatenate(cen_all)
tri_off = np.cumsum([0] + [len(d["tv"]) for d in data])
inbox = (np.abs(cen[:, 0]) < face["x"]) & (cen[:, 2] > face["z"][0]) & (cen[:, 2] < face["z"][1]) & (cen[:, 1] < face["yMax"])
corner_w = np.concatenate([wid[offs[k]:offs[k + 1]][d["tv"]].reshape(-1) for k, d in enumerate(data)])
corner_t = np.repeat(np.arange(len(fn)), 3)
sel = inbox[corner_t]
cw, ct = corner_w[sel], corner_t[sel]
order = np.argsort(cw, kind="stable")
cw_s, ct_s = cw[order], ct[order]
starts = np.r_[0, np.nonzero(np.diff(cw_s))[0] + 1]
sizes = np.diff(np.r_[starts, len(cw_s)])
gid = np.repeat(np.arange(len(starts)), sizes)
rep = sizes[gid]
i_idx = np.repeat(np.arange(len(cw_s)), rep)
off = np.arange(len(i_idx)) - np.repeat(np.cumsum(rep) - rep, rep)
j_idx = starts[gid[i_idx]] + off
ti, tj = ct_s[i_idx], ct_s[j_idx]
ok = np.sum(fn[ti] * fn[tj], 1) >= np.cos(np.radians(limit))
acc = np.zeros((len(cw_s), 3))
np.add.at(acc, i_idx[ok], fn[tj[ok]] * ar[tj[ok], None])
nrm_sorted = acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-20)
nrm = np.empty_like(nrm_sorted)
nrm[order] = nrm_sorted
sel_idx = np.nonzero(sel)[0]
for k, d in enumerate(data):
    me = d["o"].data
    cur = np.array([tuple(cn.vector) for cn in me.corner_normals])  # object space
    lo, hi = tri_off[k] * 3, tri_off[k + 1] * 3
    mask = (sel_idx >= lo) & (sel_idx < hi)
    corners = sel_idx[mask] - lo
    loops = d["tl"].reshape(-1)[corners]
    nw_obj = nrm[mask] @ d["M"][:3, :3]  # world -> object for normals (orthogonal scale)
    nw_obj /= np.maximum(np.linalg.norm(nw_obj, axis=1, keepdims=True), 1e-20)
    cur[loops] = nw_obj
    me.normals_split_custom_set(cur.tolist())
    report["objects"][d["o"].name] = {"loopsRebuilt": int(len(loops))}

bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
report["output"] = job["output"]
report["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
json.dump(report, open(job["report"], "w"), indent=1)
print("M25C_LIPSURF", json.dumps(report))
