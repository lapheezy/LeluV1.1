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

wireframe=true draws each surface's mesh edges (shader wireframe), so a render shows the
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

# Material classes (job "materials": "classes"): LÉLU writes a material class
# into the vertex-colour alpha (skin 1, cloth .5, satin .45, leather .8,
# rubber .7, metal .9, gem .35, hair .25, gloss .6 — reference/wardrobe.ts MAT).
# One shared Principled material reads it and gives each class its own
# response: subsurface skin, sheen cloth, coated leather, metal, wet eyes and
# lips. Without it every surface was the same plastic.
MATERIAL_CLASSES = {
    # alpha: (roughness, metallic, subsurface, coat, sheen, specular level)
    1.00: (0.56, 0.0, 0.30, 0.00, 0.06, 0.42),
    0.50: (0.86, 0.0, 0.00, 0.00, 0.45, 0.35),
    0.45: (0.34, 0.0, 0.00, 0.00, 0.25, 0.60),
    0.80: (0.40, 0.0, 0.00, 0.20, 0.00, 0.55),
    0.70: (0.78, 0.0, 0.00, 0.00, 0.00, 0.35),
    0.90: (0.24, 1.0, 0.00, 0.00, 0.00, 0.50),
    0.35: (0.04, 0.0, 0.00, 1.00, 0.00, 1.00),
    0.25: (0.48, 0.0, 0.00, 0.00, 0.20, 0.28),
    0.60: (0.22, 0.0, 0.00, 0.55, 0.00, 0.50),
}


def class_material():
    mat = bpy.data.materials.new("lelu-classes")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Color"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    inputs = ["Roughness", "Metallic", "Subsurface Weight", "Coat Weight", "Sheen Weight", "Specular IOR Level"]
    sums = [None] * len(inputs)
    for alpha, params in MATERIAL_CLASSES.items():
        cmp = nt.nodes.new("ShaderNodeMath")
        cmp.operation = "COMPARE"
        nt.links.new(vc.outputs["Alpha"], cmp.inputs[0])
        cmp.inputs[1].default_value = alpha
        cmp.inputs[2].default_value = 0.024
        for k, v in enumerate(params):
            if v == 0:
                continue
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            nt.links.new(cmp.outputs[0], mul.inputs[0])
            mul.inputs[1].default_value = v
            if sums[k] is None:
                sums[k] = mul
            else:
                add = nt.nodes.new("ShaderNodeMath")
                add.operation = "ADD"
                nt.links.new(sums[k].outputs[0], add.inputs[0])
                nt.links.new(mul.outputs[0], add.inputs[1])
                sums[k] = add
    for k, name in enumerate(inputs):
        if sums[k] is not None and name in bsdf.inputs:
            nt.links.new(sums[k].outputs[0], bsdf.inputs[name])
    if "Subsurface Radius" in bsdf.inputs:
        bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.32, 0.16)
    if "Subsurface Scale" in bsdf.inputs:
        bsdf.inputs["Subsurface Scale"].default_value = 0.004
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = 0.06
    if "Sheen Roughness" in bsdf.inputs:
        bsdf.inputs["Sheen Roughness"].default_value = 0.4
    return mat


if job.get("materials") == "classes" and not job.get("wireframe"):
    shared = class_material()
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(shared)


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
    # Shader wireframe: the Cycles Wireframe node draws every mesh edge at a
    # fixed pixel width over a flat clay surface. No edge geometry is
    # generated, so a 1.4 M-triangle character costs what its surface costs
    # (the old WIREFRAME modifier built ~16 M triangles of tubes and ran the
    # machine out of memory). Objects whose box misses the framed sphere are
    # dropped first.
    if override:
        keep = []
        for o in meshes:
            a, b = bbox([o])
            near = Vector([min(max(center[i], a[i]), b[i]) for i in range(3)])
            if (near - center).length <= radius * 1.6:
                keep.append(o)
            else:
                bpy.data.objects.remove(o, do_unlink=True)
        meshes = keep
    wire_mat = bpy.data.materials.new("wire-mat")
    wire_mat.use_nodes = True
    nt = wire_mat.node_tree
    bsdf_w = nt.nodes.get("Principled BSDF")
    bsdf_w.inputs["Roughness"].default_value = 0.6
    wn = nt.nodes.new("ShaderNodeWireframe")
    wn.use_pixel_size = True
    wn.inputs["Size"].default_value = float(job.get("wire_px", 1.0))
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs[6].default_value = (0.62, 0.62, 0.66, 1.0)   # clay
    mix.inputs[7].default_value = (0.02, 0.18, 0.55, 1.0)   # edge
    nt.links.new(wn.outputs["Fac"], mix.inputs[0])
    nt.links.new(mix.outputs[2], bsdf_w.inputs["Base Color"])
    for o in meshes:
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
scene.cycles.use_denoising = bool(job.get("denoise", False))
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
