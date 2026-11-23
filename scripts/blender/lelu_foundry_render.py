"""
LÉLU CHARACTER FOUNDRY — production Cycles render of one shot.

    blender --background --factory-startup --python lelu_foundry_render.py -- job.json

job.json:
    {
      "inputs": ["character.glb"],
      "output": "…/face-close-up.png",
      "shot": "face-close-up",
      "view": "front" | "three-quarter" | "side" | "back",
      "focus": ["head", "face", "hair"],          # frame only these GLB nodes
      "camera": {"center": [x, y, z], "radius": r} | null,   # Blender Z-up metres
      "resolution": [1024, 1024],
      "samples": 64,
      "threads": 7,
      "ground": false,
      "lens": 85,
      "materials": true,        # apply the skin/hair/metal material pass
      "exposure": 0.0,
      "view_transform": "AgX"
    }

Why this scene exists rather than a longer version of blender_render.py: the
mission asks for physically based skin, subsurface scattering, metallic jewelry
and a studio rig, and a render that proves them. It also asks for shot framing
decided by measurement, so `camera` is explicit for the close-ups and the
renderer's own measured bounds are used everywhere else.

Every material is a modification of the imported glTF material, never a
replacement: the GLB's vertex colours ARE her skin, hair and gold, and throwing
them away to apply a flat shader would be a downgrade dressed as production.

Writes <output>.json with the real geometry, the shaders applied, the camera and
the render time. Cycles runs on the CPU: no GPU, no display, no network.
"""
import json
import math
import sys
import time

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: blender -b --factory-startup --python lelu_foundry_render.py -- job.json")
job = json.load(open(argv[0]))

t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

for path in job["inputs"]:
    bpy.ops.import_scene.gltf(filepath=path)

# A Meshy asset ships with its auto-rig's clip bound to the armature. Benchmark
# cameras are framed on the rest pose, so clear the animation and put every
# armature in REST position; otherwise frame 0 of a walk clip is what renders.
if job.get("rest_pose"):
    for o in scene.objects:
        if o.type == "ARMATURE":
            o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

# A stray object (the Meshy asset carries a 1-metre icosphere at the origin)
# must not decide the framing of a character shot. It is removed from the scene,
# not hidden, so it cannot be rendered either.
for name in job.get("exclude") or []:
    obj = scene.objects.get(name)
    if obj is not None:
        bpy.data.objects.remove(obj, do_unlink=True)

meshes = [o for o in scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no mesh objects imported")

# ---------------------------------------------------------------- materials

SKIN = {"head", "face", "neck", "torso", "pelvis", "arms", "hands", "legs", "feet"}
HAIR = {"hair"}
METAL = {"accessories.head", "accessories.body"}
CLOTH = {"clothing.top", "clothing.bottom", "clothing.shoes"}


def base_name(obj):
    return obj.name.split(".")[0]


def principled_of(mat):
    if not mat or not mat.use_nodes:
        return None
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def set_input(node, name, value):
    """Set a Principled input by name, ignoring versions that renamed it."""
    socket = node.inputs.get(name)
    if socket is None:
        return False
    try:
        socket.default_value = value
        return True
    except Exception:
        return False


def ensure_noise_bump(mat, node, scale, strength, detail=2.0):
    """Procedural micro-surface: no image textures, no external assets."""
    tree = mat.node_tree
    if any(n.type == "BUMP" for n in tree.nodes):
        return False
    tex = tree.nodes.new("ShaderNodeTexNoise")
    tex.location = (-600, -300)
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = detail
    bump = tree.nodes.new("ShaderNodeBump")
    bump.location = (-350, -300)
    bump.inputs["Strength"].default_value = strength
    tree.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    normal = node.inputs.get("Normal")
    if normal is not None:
        tree.links.new(bump.outputs["Normal"], normal)
        return True
    return False


applied = []
warning = []

if job.get("materials", True):
    for obj in meshes:
        kind = base_name(obj)
        for slot in obj.material_slots:
            mat = slot.material
            node = principled_of(mat)
            if node is None:
                warning.append(f"{obj.name}: no Principled BSDF to modify")
                continue
            if kind in SKIN:
                # Thin, light-scattering skin: her face is 100–150 µm of it.
                set_input(node, "Subsurface Weight", 0.14)
                set_input(node, "Subsurface Radius", (1.0, 0.34, 0.19))
                set_input(node, "Subsurface Scale", 0.012)
                set_input(node, "Roughness", 0.46)
                set_input(node, "Specular IOR Level", 0.52)
                set_input(node, "Coat Weight", 0.06)
                set_input(node, "Coat Roughness", 0.35)
                ensure_noise_bump(mat, node, 900.0, 0.06)
                applied.append(f"{obj.name}: skin SSS (scale 12 mm)")
            elif kind in HAIR:
                set_input(node, "Roughness", 0.52)
                set_input(node, "Specular IOR Level", 0.28)
                set_input(node, "Coat Weight", 0.05)
                set_input(node, "Coat Roughness", 0.35)
                set_input(node, "Anisotropic", 0.45)
                applied.append(f"{obj.name}: hair gloss + anisotropy")
            elif kind in METAL:
                set_input(node, "Metallic", 1.0)
                set_input(node, "Roughness", 0.22)
                set_input(node, "Coat Weight", 0.25)
                applied.append(f"{obj.name}: metal")
            elif kind in CLOTH:
                set_input(node, "Roughness", 0.82)
                set_input(node, "Sheen Weight", 0.35)
                set_input(node, "Sheen Roughness", 0.6)
                applied.append(f"{obj.name}: fabric sheen")

# ------------------------------------------------- animation and shape keys
# A rig test is only evidence if the rig is actually evaluated. `pose_frame`
# leaves the clip bound and jumps to that frame; `shape_keys` sets key values.
if job.get("pose_frame") is not None:
    scene.frame_set(int(job["pose_frame"]))
if job.get("shape_keys"):
    for name, value in job["shape_keys"].items():
        for obj in meshes:
            keys = obj.data.shape_keys
            if keys and name in keys.key_blocks:
                keys.key_blocks[name].value = float(value)

# ------------------------------------------------------------------ framing

def bbox(objects):
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in objects:
        for corner in o.bound_box:
            world = o.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, world))
            hi = Vector(map(max, hi, world))
    return lo, hi


focus_names = job.get("focus") or []
focused = [o for o in meshes if o.name in focus_names or base_name(o) in focus_names]
focus_missing = [n for n in focus_names if n not in {base_name(o) for o in meshes} and n not in {o.name for o in meshes}]
if not focused:
    focused = meshes
    warning.append("focus objects not found; framing the whole model: " + ", ".join(focus_missing))
lo, hi = bbox(focused)
center = (lo + hi) / 2
size = hi - lo
radius = max(size.length / 2, 1e-4)

override = job.get("camera")
if override:
    center = Vector(override["center"])
    radius = max(float(override["radius"]), 1e-4)

views = {
    "front": (0, -1, 0.15),
    "side": (1, 0, 0.15),
    "back": (0, 1, 0.15),
    "three-quarter": (0.75, -1, 0.35),
}
direction = Vector(views.get(job.get("view", "three-quarter"), views["three-quarter"])).normalized()

lens = float(job.get("lens", 85 if job.get("shot") in {"face-close-up", "eyes", "nose-lips", "hairline"} else 70))
cam_data = bpy.data.cameras.new("foundry-cam")
cam_data.lens = lens
cam = bpy.data.objects.new("foundry-cam", cam_data)
scene.collection.objects.link(cam)
fov = 2 * math.atan(cam_data.sensor_width / (2 * cam_data.lens))
distance = radius / math.sin(fov / 2) * 1.06
cam.location = center + direction * distance
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.clip_start = max(distance / 60.0, 0.001)
cam_data.clip_end = distance * 12 + 10
scene.camera = cam

# ------------------------------------------------------------------- lights

def area(name, energy, location, size, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.shape = "DISK"
    data.color = color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


# Light power follows the framing distance squared, so a face close-up and a
# full-body shot are exposed the SAME. A fixed wattage is why a close-up blows
# out to white and hides the vertex colours that carry her skin and hair.
distance_key = max(radius * 3.0, 0.35)
exposure_scale = distance_key * distance_key
area("key", 120 * exposure_scale, center + Vector((radius * 2.2, -radius * 3.0, radius * 2.0)), max(radius * 2.2, 0.12), (1.0, 0.96, 0.92))
area("fill", 35 * exposure_scale, center + Vector((-radius * 3.0, -radius * 2.0, radius * 0.6)), max(radius * 3.0, 0.2), (0.90, 0.94, 1.0))
area("rim", 70 * exposure_scale, center + Vector((radius * 0.6, radius * 3.0, radius * 2.4)), max(radius * 1.2, 0.1), (1.0, 0.92, 0.94))

world = bpy.data.worlds.new("foundry-world")
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    # A metal needs something to reflect. Technical shots use a dark studio
    # world; the jewellery shot asks for a lit environment (job.environment).
    env = bool(job.get("environment"))
    bg.inputs["Color"].default_value = (0.28, 0.26, 0.25, 1) if env else (0.05, 0.05, 0.06, 1)
    bg.inputs["Strength"].default_value = 1.1 if env else 0.45
scene.world = world

if job.get("ground"):
    plane_mesh = bpy.data.meshes.new("ground")
    plane = bpy.data.objects.new("ground", plane_mesh)
    scene.collection.objects.link(plane)
    size_ = max(size.length * 4, 2.0)
    verts = [(-size_, -size_, lo.z), (size_, -size_, lo.z), (size_, size_, lo.z), (-size_, size_, lo.z)]
    plane_mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    plane_mesh.update()
    mat = bpy.data.materials.new("ground-mat")
    mat.use_nodes = True
    node = principled_of(mat)
    if node:
        set_input(node, "Base Color", (0.09, 0.09, 0.10, 1))
        set_input(node, "Roughness", 0.65)
    plane.data.materials.append(mat)

# ------------------------------------------------------------------- render

samples = int(job.get("samples", 64))
threads = int(job.get("threads", 0) or 0)
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.cycles.max_bounces = 8
scene.cycles.diffuse_bounces = 4
scene.cycles.glossy_bounces = 4
scene.cycles.transmission_bounces = 4
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception:
    warning.append("OpenImageDenoise not available; rendering without denoise")
if threads > 0:
    scene.render.threads_mode = "FIXED"
    scene.render.threads = threads

width, height = job.get("resolution", [1024, 1024])
scene.render.resolution_x = int(width)
scene.render.resolution_y = int(height)
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.filepath = job["output"]

if "exposure" in job:
    scene.view_settings.exposure = float(job["exposure"])
transform = job.get("view_transform", "AgX")
try:
    scene.view_settings.view_transform = transform
except Exception:
    warning.append(f"view transform {transform!r} unavailable; using Standard")
    scene.view_settings.view_transform = "Standard"
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass

triangles = 0
for obj in meshes:
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)

bpy.ops.render.render(write_still=True)
seconds = time.time() - t0

report = {
    "shot": job.get("shot"),
    "output": job["output"],
    "view": job.get("view"),
    "objects": [o.name for o in meshes],
    "focused": [o.name for o in focused],
    "focus_missing": focus_missing,
    "triangles": triangles,
    "materials_applied": applied,
    "warnings": warning,
    "camera_blender_zup": {"center": list(center), "radius": radius, "lens_mm": lens, "distance_m": distance},
    "framing": "explicit" if override else "measured-bounds",
    "bounds_blender_zup": {"min": list(lo), "max": list(hi)},
    "render": {
        "engine": "CYCLES",
        "device": "CPU",
        "samples": samples,
        "threads": threads,
        "resolution": [int(width), int(height)],
        "denoise": bool(scene.cycles.use_denoising),
        "view_transform": scene.view_settings.view_transform,
    },
    "render_seconds": round(seconds, 2),
    "blender": bpy.app.version_string,
    "job": {k: job[k] for k in ("shot", "view", "ground") if k in job},
}

with open(job["output"] + ".json", "w") as fh:
    json.dump(report, fh, indent=1)
print("FOUNDRY_RENDER " + json.dumps({k: report[k] for k in ("shot", "triangles", "render_seconds", "warnings")}))
