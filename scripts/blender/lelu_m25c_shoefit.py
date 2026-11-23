"""
LÉLU M25 Complete — the coat look's open-toe copper spiral stilettos (pause 2, step 4).

    blender -b --factory-startup --python lelu_m25c_shoefit.py -- job.json
    job: {"look": glb, "leg": Meshy GLB of one worn right lower leg + shoe, "output": glb, "report": json,
          "body": "look_rose_gold_sovereign", "cutZ": 0.30, "legRadius": 0.085, "lengthScale": 1.0}

1. Her boots go: dark (leather) outfit-body triangles below `cutZ`, one cluster per foot. The rig's
   foot bones are a few cm off this outfit's boots, so geometry and colour decide, not the bones.
2. The worn leg (bare foot with her skin tone, the shoe on it — Meshy, from the owner's heel
   reference) is fitted to each boot: its sole on the floor, its toe forward, its foot as long as
   the boot's, centred on the boot. The model is a right leg; the left is its mirror (the medallion
   stays on the outside of each ankle).
3. Skinned to Foot/ToeBase below the ankle and Leg above it, as two objects in the look
   (`lelu_heel_l`, `lelu_heel_r`), so they walk with her.
"""
import hashlib
import json
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_m25_common as C  # noqa: E402

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
R = {"job": {k: v for k, v in job.items() if k != "report"}}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["look"])
for o in list(bpy.data.objects):
    if o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()
bpy.context.view_layer.update()
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = bpy.data.objects[job["body"]]
for nm in ("lelu_heel_l", "lelu_heel_r"):
    if nm in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[nm], do_unlink=True)


def bone_head(name):
    return np.array(rig.matrix_world @ rig.data.bones[name].head_local)


def seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


# ------------------------------------------------ 1. the boots
A = C.mesh_arrays(body)
cen = A["wco"][A["tv"]].mean(1)
cutz = float(job.get("cutZ", 0.27))
# The rig's foot bones do not sit inside this outfit's boots (they are 3-7 cm off), and the boots
# share the coat's texture, so neither bones nor colour find them. Their place does: a column
# around each boot's centre (job "boots", her floor plan x/y), up to `cutZ`; the coat's panels
# hang further out.
boot = {}
drop = np.zeros(len(cen), bool)
for side, pre in (("l", "Left"), ("r", "Right")):
    bx, by = job["boots"][side]
    sel = (cen[:, 2] < cutz) & (np.hypot(cen[:, 0] - bx, cen[:, 1] - by) < float(job.get("bootRadius", 0.07)))
    pts = cen[sel]
    lowp = pts[pts[:, 2] < 0.05]
    boot[side] = {"floor": float(np.percentile(pts[:, 2], 0.5)), "toeY": float(np.percentile(lowp[:, 1], 1)),
                  "heelY": float(np.percentile(lowp[:, 1], 99)), "x": float(np.median(lowp[:, 0])),
                  "ankle": bone_head(pre + "Foot").tolist(), "knee": bone_head(pre + "Leg").tolist()}
    drop |= sel
bm = bmesh.new()
bm.from_mesh(body.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in set(A["tp"][drop].tolist())], context="FACES")
bm.to_mesh(body.data)
bm.free()
R["bootTrianglesRemoved"] = int(drop.sum())
R["boot"] = {k: {kk: (round(vv, 4) if isinstance(vv, float) else [round(x, 4) for x in vv]) for kk, vv in v.items()} for k, v in boot.items()}

# ------------------------------------------------ 2. the worn leg
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=job["leg"])
new = [o for o in bpy.data.objects if o not in before]
legs = [o for o in new if o.type == "MESH"]
for o in new:
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
src = legs[0]
src.parent = None
src.data.transform(src.matrix_world)
src.matrix_world.identity()
V = np.array([v.co[:] for v in src.data.vertices])
zmin, zmax = V[:, 2].min(), V[:, 2].max()
h = zmax - zmin
# the foot: the lowest 6% of the model. The stiletto tip is a thin point at the back, the platform
# under the toes the wide part: the toe direction runs from the narrow cluster to the wide one.
foot = V[V[:, 2] < zmin + 0.06 * h]
yc = np.median(foot[:, 1])
a_side, b_side = foot[foot[:, 1] < yc], foot[foot[:, 1] >= yc]
wid = lambda q: np.ptp(q[:, 0]) if len(q) else 0
toe_neg_y = wid(a_side) > wid(b_side)  # the wider end is the toe
flip = Matrix.Identity(4) if toe_neg_y else Matrix.Rotation(np.pi, 4, "Z")
src.data.transform(flip)
V = np.array([v.co[:] for v in src.data.vertices])
low = V[V[:, 2] < zmin + 0.12 * h]
m_len = float(np.percentile(low[:, 1], 99) - np.percentile(low[:, 1], 1))
m_x = float(np.median(V[V[:, 2] < zmin + 0.3 * h][:, 0]))
m_toe = float(np.percentile(low[:, 1], 1))
R["legModel"] = {"heightUnits": round(float(h), 4), "footLengthUnits": round(m_len, 4), "toeWasNegY": bool(toe_neg_y)}

objs = {}
for side, pre in (("r", "Right"), ("l", "Left")):
    b = boot[side]
    o = src.copy()
    o.data = src.data.copy()
    bpy.context.scene.collection.objects.link(o)
    s = (b["heelY"] - b["toeY"]) / m_len * float(job.get("lengthScale", 1.0))
    M = Matrix.Translation((-m_x, -m_toe, -zmin))
    M = Matrix.Diagonal((s * (-1 if side == "l" else 1), s, s, 1)) @ M
    M = Matrix.Translation((b["x"], b["toeY"], b["floor"])) @ M
    o.data.transform(M)
    if side == "l":
        o.data.flip_normals()
    o.name = o.data.name = f"lelu_heel_{side}"
    # skin: foot below the ankle (toes to ToeBase), leg above
    W = np.array([v.co[:] for v in o.data.vertices])
    az = b["ankle"][2]
    w_leg = np.clip((W[:, 2] - (az - 0.02)) / 0.06, 0, 1)
    w_toe = (1 - w_leg) * np.clip((b["toeY"] + 0.06 - W[:, 1]) / 0.04, 0, 1)
    w_foot = 1 - w_leg - w_toe
    for bn, w in ((pre + "Leg", w_leg), (pre + "Foot", w_foot), (pre + "ToeBase", w_toe)):
        g = o.vertex_groups.new(name=bn)
        for i in np.nonzero(w > 1e-4)[0]:
            g.add([int(i)], float(w[i]), "REPLACE")
    o.parent = rig
    o.matrix_parent_inverse = rig.matrix_world.inverted()
    o.modifiers.new("Armature", "ARMATURE").object = rig
    dec = float(job.get("decimate", 0.6))
    if dec < 1:
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.ratio = dec
        bpy.context.view_layer.objects.active = o
        o.modifiers.move(len(o.modifiers) - 1, 0)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    objs[side] = {"scale": round(s, 5), "triangles": sum(len(p.vertices) - 2 for p in o.data.polygons)}
bpy.data.objects.remove(src, do_unlink=True)
size = int(job.get("textureSize", 1024))
for m in bpy.data.materials:
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image and n.image.name.startswith(("texture", "Image")) and max(n.image.size) > size:
                n.image.scale(size, size)
R["heels"] = objs

bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
R["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
R["outputBytes"] = os.path.getsize(job["output"])
json.dump(R, open(job["report"], "w"), indent=1)
print("M25C_SHOEFIT", json.dumps({k: R.get(k) for k in ("bootTrianglesRemoved", "boot", "legModel", "heels", "outputBytes")}))
