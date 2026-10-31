"""
LÉLU 3D FORGE — POSE CHECK (headless review renders)

Applies a clip from another GLB made for the same rig (e.g. Meshy's
walking_armature_glb.glb) to a character GLB, and renders it from the
front, three-quarter and back at a frame mid-clip — so a head swap or
any re-skinning can be seen deforming with the body before it goes live.

  python lelu_posecheck.py -- '{"model": ".../lelu.glb", "clip": ".../walking_armature_glb.glb",
                                "outDir": "...", "frameFraction": 0.35}'
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

A = json.loads(sys.argv[sys.argv.index("--") + 1])
os.makedirs(A["outDir"], exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


model = import_glb(A["model"])
armature = next(o for o in model if o.type == "ARMATURE")
action = None
if A.get("clip"):
    clip_objs = import_glb(A["clip"])
    clip_arm = next(o for o in clip_objs if o.type == "ARMATURE")
    action = clip_arm.animation_data.action if clip_arm.animation_data else None
    for o in clip_objs:
        bpy.data.objects.remove(o, do_unlink=True)
if action:
    armature.animation_data_create()
    armature.animation_data.action = action
    if hasattr(armature.animation_data, "action_slot") and action.slots:
        armature.animation_data.action_slot = action.slots[0]
    start, end = action.frame_range
    frame = int(start + (end - start) * float(A.get("frameFraction", 0.35)))
    bpy.context.scene.frame_set(frame)
    print("[lelu-posecheck]", json.dumps({"action": action.name, "frame": frame, "range": [start, end]}))
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.parent is None and len(o.vertex_groups) == 0:
        bpy.data.objects.remove(o, do_unlink=True)

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 32
sc.render.resolution_x = 640
sc.render.resolution_y = 800
sc.world = bpy.data.worlds.new("w")
sc.world.color = (0.32, 0.3, 0.34)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
for e, rz, en in ((50, -25, 2.2), (65, 30, 1.0), (30, 180, 1.2)):
    light = bpy.data.objects.new("l", bpy.data.lights.new("l", "SUN"))
    light.data.energy = en
    light.rotation_euler = (math.radians(e), 0, math.radians(rz))
    sc.collection.objects.link(light)
target = Vector((0, 0, 1.25))
for name, direction in {"front": (0, -1, 0), "three_quarter": (-0.7, -0.7, 0), "back": (0, 1, 0)}.items():
    cam.data.lens = 50
    cam.location = target + Vector(direction).normalized() * 3.2
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(A["outDir"], f"pose_{name}.png")
    bpy.ops.render.render(write_still=True)
print("[lelu-posecheck] done")
