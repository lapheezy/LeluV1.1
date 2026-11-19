"""
LÉLU M25 Complete — attach a separately generated handbag to a look's hand.

    blender -b --factory-startup --python lelu_m25c_bagattach.py -- job.json
    job: {"look": glb, "bag": glb, "output": glb, "report": json, "name": "bronze_lotus_bag",
          "heightM": 0.24, "hand": "RightHand", "handleDrop": 0.02}

The bag (Meshy image-to-3d of the bag cropped from the user's photograph) is
scaled to `heightM` overall (handle included), turned to face forward, and
hung so the top of its handle sits `handleDrop` below the hand bone. It is
skinned 100 % to the hand: it travels with her hand, and as its own node it can
be hidden or swapped without touching the outfit.
"""
import hashlib
import json
import sys

import bpy
from mathutils import Matrix, Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["look"])
for o in list(bpy.data.objects):
    if o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in [o for o in bpy.data.objects if o.name == job["name"]]:
    bpy.data.objects.remove(o, do_unlink=True)  # re-running replaces the bag

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=job["bag"])
new = [o for o in bpy.data.objects if o not in before]
meshes = [o for o in new if o.type == "MESH"]
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
bag = bpy.context.view_layer.objects.active
for o in new:
    if o is not bag and o.name in bpy.data.objects:
        bpy.data.objects.remove(o, do_unlink=True)
bag.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
frac = job.get("keepTopFraction")
if frac:
    # the photo crop can include what hangs behind the bag (the coat skirt); keep the top part
    import bmesh
    zs = [v.co.z for v in bag.data.vertices]
    zcut = max(zs) - float(frac) * (max(zs) - min(zs))
    bm = bmesh.new()
    bm.from_mesh(bag.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < zcut], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(bag.data)
    bm.free()
pts = [v.co.copy() for v in bag.data.vertices]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
s = float(job.get("heightM", 0.24)) / max(hi.z - lo.z, 1e-6)
hand = rig.matrix_world @ rig.data.bones[job.get("hand", "RightHand")].head_local
top_centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z))
for v in bag.data.vertices:
    v.co = (v.co - top_centre) * s
bag.data.update()
bag.location = hand - Vector((0, 0, float(job.get("handleDrop", 0.02))))
bag.name = job["name"]
bag.data.name = job["name"]
bag.parent = rig
bag.matrix_parent_inverse = rig.matrix_world.inverted()
for g in list(bag.vertex_groups):
    bag.vertex_groups.remove(g)
g = bag.vertex_groups.new(name=job.get("hand", "RightHand"))
g.add([v.index for v in bag.data.vertices], 1.0, "REPLACE")
m = bag.modifiers.new("Armature", "ARMATURE")
m.object = rig

report = {"bag": job["name"], "sourceSizeM": [round(x, 4) for x in (hi - lo)], "scale": round(s, 4),
          "triangles": sum(len(p.vertices) - 2 for p in bag.data.polygons), "hand": job.get("hand", "RightHand"),
          "handWorld": [round(x, 4) for x in hand]}
bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
report["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
json.dump(report, open(job["report"], "w"), indent=1)
print("M25C_BAGATTACH", json.dumps(report))
