"""
LÉLU M25 Complete — unfold the crumpled shoulder / chest / upper-back shell of char1.

    blender -b --factory-startup --python lelu_m25c_shoulders.py -- job.json
    job: {"input", "output", "report", "iterations": 24, "clampMm": 14,
          "zone": {"z": [1.06, 1.50], "fadeMm": 60}, "metalWeight": 0.25}

Cause (M25 audit): Meshy fused the hair that falls over her shoulders, the
shoulder armour and the top into one 39k-triangle shell whose surface is
folded (61 % of shoulder triangles bend > 45° against a neighbour). M25's pass
pinned every vertex touching an unfolded triangle and so moved almost nothing.

Here every position-welded vertex in the zone is smoothed with Taubin
(λ 0.5 / μ −0.53, volume preserving), weighted by
    zone falloff (1 inside, fading to 0 over `fadeMm` outside the band)
  × fold factor (mean dihedral of its triangles: 20° → 0.25, 55° → 1)
  × class factor (`metalWeight` on jewellery so pendants and rings keep shape).
Nothing is hard-pinned; coincident copies move together so no crack opens.
Positions only: UVs, skin weights and materials are untouched, so texture and
rig follow. Displacement is clamped. char1 has no shape keys.
"""
import hashlib
import json
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_m25_common as C  # noqa: E402

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
it = int(job.get("iterations", 24))
clamp = float(job.get("clampMm", 14)) / 1000
z0, z1 = job.get("zone", {}).get("z", [1.06, 1.50])
fade = float(job.get("zone", {}).get("fadeMm", 60)) / 1000
metal_w = float(job.get("metalWeight", 0.25))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
for o in list(bpy.data.objects):
    if o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()

body = bpy.data.objects[job.get("object", "char1")]
A = C.mesh_arrays(body)
dih = C.triangle_dihedral(A["wco"], A["tv"])
if job.get("classify", True):
    tex = C.triangle_texture(body, A)
    cls = C.classify(body, A, tex, dih)
else:
    cls = np.array(["fabric"] * len(A["tv"]), dtype=object)
wid = C.weld_ids(A["wco"])
nw = int(wid.max()) + 1
wt = wid[A["tv"]]
pos = np.zeros((nw, 3))
np.add.at(pos, wid, A["wco"])
pos /= np.bincount(wid, minlength=nw)[:, None]

# per-position fold and class factors (mean over incident triangles)
tri_fold = np.clip((dih - 20.0) / 35.0, 0, 1) * 0.75 + 0.25
tri_cls = np.where(cls == "metal", metal_w, 1.0)
acc_f = np.zeros(nw)
acc_c = np.zeros(nw)
cnt = np.zeros(nw)
for k in range(3):
    np.add.at(acc_f, wt[:, k], tri_fold)
    np.add.at(acc_c, wt[:, k], tri_cls)
    np.add.at(cnt, wt[:, k], 1)
fold = acc_f / np.maximum(cnt, 1)
clsf = acc_c / np.maximum(cnt, 1)
z = pos[:, 2]
dz = np.maximum(z0 - z, z - z1)
zone = np.where(dz <= 0, 1.0, np.clip(1 - dz / fade, 0, 1))
zone = zone * zone * (3 - 2 * zone)
w = zone * fold * clsf

e = np.concatenate([wt[:, [0, 1]], wt[:, [1, 2]], wt[:, [2, 0]]])
e = np.unique(np.sort(e, 1), axis=0)
e = e[e[:, 0] != e[:, 1]]
deg = np.bincount(e.reshape(-1), minlength=nw)[:, None].astype(float)
p0 = pos.copy()
for _ in range(it):
    for f in (0.5, -0.53):
        acc = np.zeros_like(pos)
        np.add.at(acc, e[:, 0], pos[e[:, 1]])
        np.add.at(acc, e[:, 1], pos[e[:, 0]])
        pos += f * w[:, None] * (acc / np.maximum(deg, 1) - pos)
disp = pos - p0
mag = np.linalg.norm(disp, axis=1)
over = mag > clamp
disp[over] *= (clamp / mag[over])[:, None]

M = A["m"]
dv = disp[wid] @ np.linalg.inv(M[:3, :3]).T
new = A["co"] + dv
body.data.vertices.foreach_set("co", new.astype(np.float32).reshape(-1))
body.data.update()
neww = new @ M[:3, :3].T + M[:3, 3]
dih2 = C.triangle_dihedral(neww, A["tv"])

cen = A["wco"][A["tv"]].mean(1)
regions = job.get("regionsOverride") and {k: (cen[:, 2] > v[0]) & (cen[:, 2] < v[1]) for k, v in job["regionsOverride"].items()} or {"shoulders": (cen[:, 2] > 1.30) & (cen[:, 2] < 1.47) & (np.abs(cen[:, 0]) > 0.08),
           "upperChest": (cen[:, 2] > 1.22) & (cen[:, 2] < 1.40) & (np.abs(cen[:, 0]) <= 0.12) & (cen[:, 1] < 0),
           "upperBack": (cen[:, 2] > 1.20) & (cen[:, 2] < 1.47) & (cen[:, 1] > 0.02),
           "arms": (np.abs(cen[:, 0]) > 0.2) & (cen[:, 2] > 0.95) & (cen[:, 2] < 1.40)}
report = {"iterations": it, "clampMm": clamp * 1000, "zone": [z0, z1], "fadeMm": fade * 1000, "metalWeight": metal_w,
          "movedPositions": int((np.linalg.norm(disp, axis=1) > 1e-5).sum()),
          "displacementMm": {"p50": round(float(np.median(mag[w > 0.05])) * 1000, 2), "p90": round(float(np.percentile(mag[w > 0.05], 90)) * 1000, 2),
                             "max": round(float(np.linalg.norm(disp, axis=1).max()) * 1000, 2), "clamped": int(over.sum())},
          "regions": {k: {"triangles": int(m.sum()), "over45Before": round(float(np.mean(dih[m] > 45)), 4), "over45After": round(float(np.mean(dih2[m] > 45)), 4),
                          "medianDihedralBefore": round(float(np.median(dih[m])), 2), "medianDihedralAfter": round(float(np.median(dih2[m])), 2)}
                      for k, m in regions.items()}}

# normals for char1 rebuilt on the new surface (class limits as in M25)
fn, area = C.face_normals(neww, A["tv"])
lim = np.select([cls == "hair", cls == "skin", cls == "metal"], [80.0, 55.0, 30.0], 45.0)
cw = wid[A["tv"]].reshape(-1)
ct = np.repeat(np.arange(len(fn)), 3)
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
ok = np.sum(fn[ti] * fn[tj], 1) >= np.cos(np.radians(np.minimum(lim[ti], lim[tj])))
accn = np.zeros((len(cw_s), 3))
np.add.at(accn, i_idx[ok], fn[tj[ok]] * area[tj[ok], None])
nrm = np.empty_like(accn)
nrm[order] = accn / np.maximum(np.linalg.norm(accn, axis=1, keepdims=True), 1e-20)
nrm = nrm @ M[:3, :3]
nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-20)
loop_n = np.zeros((len(body.data.loops), 3))
loop_n[A["tl"].reshape(-1)] = nrm
body.data.normals_split_custom_set(loop_n.tolist())

bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
report["output"] = job["output"]
report["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
json.dump(report, open(job["report"], "w"), indent=1)
print("M25C_SHOULDERS", json.dumps(report["regions"]), json.dumps(report["displacementMm"]))
