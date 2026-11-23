"""
LÉLU M25 Complete — make a look's handbag an independent, hand-held accessory.

    blender -b --factory-startup --python lelu_m25c_bagsplit.py -- job.json
    job: {"input", "output", "report", "body": "look_bronze_velocity", "bagName": "bronze_bag",
          "box": {"x": [-0.06, 0.07], "z": [0.51, 0.785], "yMax": -0.125},
          "hand": "RightHand", "drop": 0.035}

Meshy fused the bag to the front of the thighs, so it stretched with every
stride. Faces whose centre lies in `box` and in front of `yMax` (the thighs sit
behind it) are split into their own object, moved so the top of the bag hangs
`drop` metres below the hand bone, and skinned 100 % to that bone: the bag now
travels rigidly with the hand and can be hidden or swapped on its own.
"""
import hashlib
import json
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
for o in list(bpy.data.objects):
    if o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = bpy.data.objects[job["body"]]
box = job["box"]
W = body.matrix_world
inbox = []
gapsel = []
for p in body.data.polygons:
    c = W @ p.center
    front = box["x"][0] <= c.x <= box["x"][1] and box["z"][0] <= c.z <= box["z"][1] and c.y <= box["yMax"]
    g = box.get("gap")  # the bag's back half, hanging in the gap between the thighs
    gap = bool(g) and g["x"][0] <= c.x <= g["x"][1] and g["z"][0] <= c.z <= g["z"][1] and g["y"][0] <= c.y <= g["y"][1]
    if gap:
        # inner thighs face sideways; the bag's back panels face front, back or down
        n = (W.to_3x3() @ p.normal).normalized()
        gap = abs(n.x) < float(g.get("maxAbsNx", 0.6))
    inbox.append(front)
    gapsel.append(gap)
sel = sum(inbox)


def keep_faces(obj, keep):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep[f.index]], context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


bag = body.copy()
bag.data = body.data.copy()
bpy.context.scene.collection.objects.link(bag)
bag.name = job.get("bagName", "bag")
bag.data.name = bag.name
keep_faces(bag, inbox)
keep_faces(body, [not (b or g_) for b, g_ in zip(inbox, gapsel)])

# The thigh surface behind the bag was never modelled: close the holes the
# split exposes, only for boundary loops inside the bag region.
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
hx, hz = job["box"]["x"], [min(job["box"]["z"][0], (job["box"].get("gap") or {"z": [9]})["z"][0]), job["box"]["z"][1]]
edges = [e for e in bm.edges if e.is_boundary and all(hx[0] - 0.03 <= (W @ v.co).x <= hx[1] + 0.03 and hz[0] - 0.03 <= (W @ v.co).z <= hz[1] + 0.03 for v in e.verts)]
filled = bmesh.ops.holes_fill(bm, edges=edges, sides=400)
bmesh.ops.triangulate(bm, faces=filled["faces"])
holes_filled = len(filled["faces"])
bm.to_mesh(body.data)
bm.free()
body.data.update()

def drop_fragments(obj, max_faces, region=None):
    """Delete connected pieces (welded at 0.01 mm) smaller than max_faces, optionally only inside region."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.ensure_lookup_table()
    seen, kill = set(), []
    Wo = obj.matrix_world
    for f in bm.faces:
        if f.index in seen:
            continue
        comp, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if len(comp) < max_faces:
            if region is None or all(region(Wo @ g.calc_center_median()) for g in comp):
                kill += comp
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(kill)


gx = job["box"].get("gap", {"x": job["box"]["x"], "z": job["box"]["z"]})
in_region = lambda c: min(hx[0], gx["x"][0]) - 0.03 <= c.x <= max(hx[1], gx["x"][1]) + 0.03 and min(hz[0], gx["z"][0]) - 0.03 <= c.z <= hz[1] + 0.03
frag_body = drop_fragments(body, 60, in_region)
frag_bag = drop_fragments(bag, 25)

# rest-pose placement under the hand
Wb = bag.matrix_world
pts = [Wb @ v.co for v in bag.data.vertices]
top = max(p.z for p in pts)
cx = sum(p.x for p in pts) / len(pts)
cy = sum(p.y for p in pts) / len(pts)
hand = rig.matrix_world @ rig.data.bones[job.get("hand", "RightHand")].head_local
shift = Vector((hand.x - cx, hand.y - cy, hand.z - float(job.get("drop", 0.035)) - top))
bag.matrix_world = Matrix.Translation(shift) @ bag.matrix_world

# skin 100 % to the hand
for g in list(bag.vertex_groups):
    bag.vertex_groups.remove(g)
g = bag.vertex_groups.new(name=job.get("hand", "RightHand"))
g.add([v.index for v in bag.data.vertices], 1.0, "REPLACE")
if not any(m.type == "ARMATURE" for m in bag.modifiers):
    m = bag.modifiers.new("Armature", "ARMATURE")
    m.object = rig

report = {"fragmentFacesDropped": {"body": frag_body, "bag": frag_bag}, "holeFacesAdded": holes_filled, "gapFacesDeleted": int(sum(gapsel)), "facesMoved": sel, "bag": bag.name, "triangles": sum(len(p.vertices) - 2 for p in bag.data.polygons),
          "shiftMm": [round(x * 1000, 1) for x in shift], "bone": job.get("hand", "RightHand"), "box": box}
bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
report["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
json.dump(report, open(job["report"], "w"), indent=1)
print("M25C_BAG", json.dumps(report))
