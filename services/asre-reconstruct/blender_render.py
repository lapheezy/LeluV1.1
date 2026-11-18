"""
LÉLU ASRE — headless Blender render of one or more GLB files.

    blender --background --factory-startup --python blender_render.py -- job.json

job.json:
    {"inputs": ["a.glb", ...], "output": "out.png", "resolution": [640, 640],
     "samples": 16, "view": "three-quarter" | "front" | "side" | "back",
     "background": [0.06, 0.06, 0.08], "wireframe": false,
     "focus": ["head", "face", "hair"],   # frame only these GLB nodes
     "camera": {"center": [x, y, z], "radius": r},  # explicit framing (Z-up)
     "ground": true, "view_transform": "Standard" | "AgX" | "Filmic"}

wireframe=true replaces each surface with its mesh edges, so a render shows the
actual triangulation (used by Mission 5 WP07 for geometry inspection evidence).

focus/camera exist so a before/after pair can be shot from the SAME camera:
the framing is a number in the job file, not something the geometry decides.

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


def bbox(objects):
    a = Vector((math.inf,) * 3)
    b = Vector((-math.inf,) * 3)
    for o in objects:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            a = Vector(map(min, a, w))
            b = Vector(map(max, b, w))
    return a, b


lo, hi = bbox(meshes)
focused = None
focus = job.get("focus")
if focus:
    names = focus if isinstance(focus, list) else focus.get("objects", [])
    focused = [o for o in meshes if o.name in names or o.name.split(".")[0] in names]
    if not focused:
        raise SystemExit("focus objects not found: %r (have %r)" % (names, [o.name for o in meshes]))
    lo, hi = bbox(focused)
center = (lo + hi) / 2
size = hi - lo
radius = max(size.length / 2, 1e-4)
override = job.get("camera")
if override:
    center = Vector(override["center"])
    radius = max(float(override["radius"]), 1e-4)

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

if job.get("ground"):
    mesh = bpy.data.meshes.new("ground")
    s = radius * 6
    mesh.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    mesh.update()
    plane = bpy.data.objects.new("ground", mesh)
    plane.location = (center.x, center.y, lo.z - radius * 0.004)
    mat = bpy.data.materials.new("ground-mat")
    mat.use_nodes = True
    bsdf_m = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf_m is not None:
        bsdf_m.inputs["Base Color"].default_value = (0.32, 0.32, 0.36, 1.0)
        bsdf_m.inputs["Roughness"].default_value = 0.55
    mesh.materials.append(mat)
    scene.collection.objects.link(plane)

if job.get("wireframe"):
    wire_mat = bpy.data.materials.new("wire-mat")
    wire_mat.use_nodes = True
    bsdf_w = wire_mat.node_tree.nodes.get("Principled BSDF")
    if bsdf_w is not None:
        bsdf_w.inputs["Base Color"].default_value = (0.45, 0.8, 1.0, 1.0)
        if "Emission Color" in bsdf_w.inputs:
            bsdf_w.inputs["Emission Color"].default_value = (0.35, 0.75, 1.0, 1.0)
            bsdf_w.inputs["Emission Strength"].default_value = 1.5
    for o in meshes:
        mod = o.modifiers.new("wireframe", "WIREFRAME")
        mod.thickness = max(size.length * 0.0018, 1e-4)
        mod.use_replace = True
        o.data.materials.clear()
        o.data.materials.append(wire_mat)

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
scene.view_settings.view_transform = job.get("view_transform", "Standard")
bpy.ops.render.render(write_still=True)

tris = 0
for o in meshes:
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
json.dump({
    "output": job["output"],
    "wireframe": bool(job.get("wireframe")),
    "objects": [o.name for o in meshes],
    "focused": [o.name for o in focused] if focused else None,
    "camera_blender_zup": {"center": list(center), "radius": radius},
    "triangles": tris,
    "bounds_blender_zup": {"min": list(lo), "max": list(hi)},
    "render_seconds": round(time.time() - t0, 2),
    "blender": bpy.app.version_string,
}, open(job["output"] + ".json", "w"), indent=1)
