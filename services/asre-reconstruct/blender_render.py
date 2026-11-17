"""
LÉLU ASRE — headless Blender render of one or more GLB files.

    blender --background --factory-startup --python blender_render.py -- job.json

job.json:
    {"inputs": ["a.glb", ...], "output": "out.png", "resolution": [640, 640],
     "samples": 16, "view": "three-quarter" | "front" | "side" | "back",
     "background": [0.06, 0.06, 0.08]}

Cycles on the CPU: no GPU or display needed. The camera is framed from the
imported geometry's real bounding box, so a render that shows the object
proves the GLB holds geometry where the inspector says it is.
Writes <output>.json with the measured bounds and render time.
"""
import json
import math
import sys
import time

import bpy
from mathutils import Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

for path in job["inputs"]:
    bpy.ops.import_scene.gltf(filepath=path)

meshes = [o for o in scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no mesh objects imported")
lo = Vector((math.inf,) * 3)
hi = Vector((-math.inf,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
center = (lo + hi) / 2
size = hi - lo
radius = max(size.length / 2, 1e-4)

# Blender is Z-up; glTF import converts Y-up → Z-up, so height is on Z here.
views = {"front": (0, -1, 0.15), "side": (1, 0, 0.15), "back": (0, 1, 0.15), "three-quarter": (0.75, -1, 0.35)}
d = Vector(views.get(job.get("view", "three-quarter"), views["three-quarter"])).normalized()
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
fov = 2 * math.atan(cam_data.sensor_width / (2 * cam_data.lens))
dist = radius / math.sin(fov / 2) * 1.08
cam.location = center + d * dist
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.clip_start = dist / 100
cam_data.clip_end = dist * 10
scene.camera = cam

def light(name, kind, energy, loc, size_=1.0):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    if kind == "AREA":
        ld.size = size_
    lo_ = bpy.data.objects.new(name, ld)
    lo_.location = loc
    lo_.rotation_euler = (center - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(lo_)

s = radius
light("key", "AREA", 400 * s * s, center + Vector((2.5, -3, 3)) * s, 2 * s)
light("fill", "AREA", 120 * s * s, center + Vector((-3, -2, 1)) * s, 3 * s)
light("rim", "AREA", 200 * s * s, center + Vector((0, 3, 2.5)) * s, 2 * s)

world = bpy.data.worlds.new("w")
world.use_nodes = True
bg = job.get("background", [0.06, 0.06, 0.08])
world.node_tree.nodes["Background"].inputs[0].default_value = (*bg, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
scene.world = world

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = int(job.get("samples", 16))
scene.cycles.use_denoising = False
scene.render.resolution_x, scene.render.resolution_y = job.get("resolution", [640, 640])
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = job["output"]
scene.view_settings.view_transform = "Standard"
bpy.ops.render.render(write_still=True)

tris = 0
for o in meshes:
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
json.dump({
    "output": job["output"],
    "objects": [o.name for o in meshes],
    "triangles": tris,
    "bounds_blender_zup": {"min": list(lo), "max": list(hi)},
    "render_seconds": round(time.time() - t0, 2),
    "blender": bpy.app.version_string,
}, open(job["output"] + ".json", "w"), indent=1)
