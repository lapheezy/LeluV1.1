"""
LÉLU M25 — render the per-triangle material classification as a flat colour map.

    blender -b --factory-startup --python lelu_m25_classmap.py -- job.json
    job: {"input": glb, "outDir": dir, "views": ["front", "back"], "stats": "classes.json"}

Each class is drawn in one emission colour so a reader can check, by eye, that
the rules in lelu_m25_common.classify put skin on skin, hair on hair and metal
on metal before any material is changed. This is the visual defect map's base.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_m25_common as C  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
job = json.load(open(argv[0]))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
scene = bpy.context.scene
for o in list(scene.objects):
    if o.name == "Icosphere":
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"

COLORS = {"skin": (0.9, 0.55, 0.3), "hair": (0.02, 0.02, 0.02), "metal": (1.0, 0.85, 0.0), "fabric": (0.1, 0.45, 0.15),
          "flower": (1.0, 0.2, 0.6), "lips": (0.8, 0.0, 0.1), "other": (0.3, 0.3, 1.0), "eye": (1, 1, 1),
          "crumpled": (1.0, 0.0, 0.0)}
mats = {}
for k, c in COLORS.items():
    m = bpy.data.materials.new("cls_" + k)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*c, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    mats[k] = m

stats = {}
for obj in [o for o in scene.objects if o.type == "MESH"]:
    A = C.mesh_arrays(obj)
    if obj.name in ("char1", "lelu_hair", "lelu_scalp") and A["uv"] is not None:
        tex = C.triangle_texture(obj, A)
        dih = C.triangle_dihedral(A["wco"], A["tv"])
        cls = C.classify(obj, A, tex, dih)
        if job.get("crumpled"):
            cls = np.where(dih >= 45, "crumpled", cls)
    elif obj.name.startswith("eye_patch"):
        cls = np.array(["eye"] * len(A["tv"]), dtype=object)
    else:
        cls = np.array(["other"] * len(A["tv"]), dtype=object)
    names, counts = np.unique(cls, return_counts=True)
    stats[obj.name] = {str(n): int(c) for n, c in zip(names, counts)}
    obj.data.materials.clear()
    order = list(COLORS)
    for k in order:
        obj.data.materials.append(mats[k])
    poly_cls = np.empty(len(obj.data.polygons), dtype=object)
    poly_cls[A["tp"]] = cls
    idx = np.array([order.index(c) if c in order else order.index("other") for c in poly_cls], np.int32)
    obj.data.polygons.foreach_set("material_index", idx)

scene.render.engine = "CYCLES"
scene.cycles.samples = 4
scene.cycles.use_denoising = False
scene.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.5, 0.55, 1)
scene.world = w
cam_d = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam_d.lens = 85
os.makedirs(job["outDir"], exist_ok=True)
for shot in job["views"]:
    name, d, center, radius, res = shot["name"], Vector(shot["dir"]).normalized(), Vector(shot["center"]), shot["radius"], shot.get("res", [768, 768])
    fov = 2 * math.atan(cam_d.sensor_width / (2 * cam_d.lens))
    if res[1] > res[0]:
        fov = 2 * math.atan(math.tan(fov / 2) * res[0] / res[1])
    cam.location = center + d * radius / math.sin(fov / 2)
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = os.path.join(job["outDir"], name + ".png")
    bpy.ops.render.render(write_still=True)
json.dump({"input": job["input"], "colors": COLORS, "triangleClasses": stats}, open(job["stats"], "w"), indent=1)
print("M25_CLASSMAP", json.dumps(stats))
