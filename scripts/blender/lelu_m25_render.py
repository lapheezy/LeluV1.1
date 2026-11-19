"""
LÉLU M25 — calibrated acceptance render.

    blender -b --factory-startup --python lelu_m25_render.py -- job.json

job.json:
    {
      "input": "model.glb",
      "output": ".../front-face.png",
      "view": "front" | "three-quarter" | "left" | "right" | "back" | "top" | [x, y, z],
      "camera": {"center": [x, y, z], "radius": r, "lens": 85},   # Blender Z-up metres
      "resolution": [1024, 1024],
      "samples": 64,
      "lighting": "neutral-studio" | "soft-frontal" | "directional-key" | "warm-environment",
      "view_transform": "AgX",
      "look": "None",
      "seed": 0,
      "exclude": ["Icosphere"],
      "shape_keys": {"eyeBlinkLeft": 1.0},
      "hide": ["object names to hide"],
      "mask": null | {"emit": [red objs], "green": [green objs]}   # coverage mask; others black
    }

Why a second renderer instead of the M24 one: the M24 renders were exposed by a
light wattage tied to framing distance and tone-mapped with AgX Medium High
Contrast. Measured on her cheek, that turned an albedo of about sRGB (155, 105,
85) into (230, 185, 170): the washed-out complexion in the brief is mostly the
renderer. This script exposes every shot against a measured 18 % grey card at
the subject, so a pixel value means the same thing in every view, every
lighting condition and every version. The card is rendered alone, before the
character, with the same lights and camera; exposure is set so the card reads
middle grey. Nothing in the character's materials is changed here except one
Cycles-only extension: materials named m25_skin* get subsurface scattering,
which glTF cannot carry.
"""
import json
import math
import os
import sys
import tempfile
import time

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
job = json.load(open(argv[0]))
t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=job["input"])

for o in list(scene.objects):
    if o.type == "ARMATURE":
        o.data.pose_position = "REST" if not job.get("animation") else "POSE"
    if o.animation_data and not job.get("animation"):
        o.animation_data_clear()
for name in job.get("exclude", ["Icosphere"]):
    o = scene.objects.get(name)
    if o is not None:
        bpy.data.objects.remove(o, do_unlink=True)
for name in job.get("hide", []):
    o = scene.objects.get(name)
    if o is not None:
        o.hide_render = True

meshes = [o for o in scene.objects if o.type == "MESH" and not o.hide_render]

# ---------------------------------------------------------------- animation
anim = job.get("animation")
anim_report = None
if anim:
    # motion.glb carries the clip on bare joint nodes (no skin), so Blender would
    # import it as animated empties. Instead its glTF animation channels are merged
    # into the character GLB by joint name and the merged file is re-imported: the
    # importer then binds the clip to the character's own bones.
    import struct

    def read_glb(path):
        b = open(path, "rb").read()
        jl = struct.unpack_from("<I", b, 12)[0]
        js = json.loads(b[20:20 + jl])
        off = 20 + jl
        bl = struct.unpack_from("<I", b, off)[0]
        return js, bytearray(b[off + 8:off + 8 + bl])

    cj, cbin = read_glb(job["input"])
    mj, mbin = read_glb(anim["clip"])
    by_name = {n.get("name"): i for i, n in enumerate(cj["nodes"])}
    src_anim = mj["animations"][0]
    acc_map = {}

    def copy_accessor(ai):
        if ai in acc_map:
            return acc_map[ai]
        a = dict(mj["accessors"][ai])
        bv = dict(mj["bufferViews"][a["bufferView"]])
        data = mbin[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        while len(cbin) % 4:
            cbin.append(0)
        bv["byteOffset"] = len(cbin)
        bv["buffer"] = 0
        cbin.extend(data)
        cj["bufferViews"].append(bv)
        a["bufferView"] = len(cj["bufferViews"]) - 1
        cj["accessors"].append(a)
        acc_map[ai] = len(cj["accessors"]) - 1
        return acc_map[ai]

    samplers, channels, unmatched = [], [], []
    for ch in src_anim["channels"]:
        name = mj["nodes"][ch["target"]["node"]].get("name")
        if name not in by_name:
            unmatched.append(name)
            continue
        sm = src_anim["samplers"][ch["sampler"]]
        samplers.append({"input": copy_accessor(sm["input"]), "output": copy_accessor(sm["output"]), "interpolation": sm.get("interpolation", "LINEAR")})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": by_name[name], "path": ch["target"]["path"]}})
    cj["animations"] = [{"name": src_anim.get("name", "clip"), "samplers": samplers, "channels": channels}]
    while len(cbin) % 4:
        cbin.append(0)
    cj["buffers"][0]["byteLength"] = len(cbin)
    jb = json.dumps(cj).encode()
    while len(jb) % 4:
        jb += b" "
    merged = os.path.join(tempfile.mkdtemp(), "merged.glb")
    with open(merged, "wb") as fh:
        total = 12 + 8 + len(jb) + 8 + len(cbin)
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(jb), 0x4E4F534A) + jb)
        fh.write(struct.pack("<II", len(cbin), 0x004E4942) + bytes(cbin))
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=merged)
    for name in job.get("exclude", ["Icosphere"]):
        o = scene.objects.get(name)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in scene.objects if o.type == "MESH" and not o.hide_render]
    rig = next(o for o in scene.objects if o.type == "ARMATURE")
    rig.data.pose_position = "POSE"
    action = rig.animation_data.action if rig.animation_data else None
    scene.frame_set(int(anim["frame"]))
    bpy.context.view_layer.update()
    moved = {}
    for pb in rig.pose.bones:
        moved[pb.name] = round(sum(abs(x - (1.0 if i == j else 0.0)) for i, row in enumerate(pb.matrix_basis) for j, x in enumerate(row)), 4)
    hips = rig.matrix_world @ rig.pose.bones["Hips"].head if "Hips" in rig.pose.bones else None
    anim_report = {"clip": anim["clip"], "action": action.name if action else None,
                   "frameRange": list(action.frame_range) if action else None, "frame": int(anim["frame"]),
                   "channelsMerged": len(channels), "unmatchedNodes": unmatched,
                   "bonesMoved": sum(1 for v in moved.values() if v > 1e-3), "boneDelta": moved,
                   "hipsWorld": [round(x, 4) for x in hips] if hips is not None else None}

if job.get("shape_keys"):
    for name, value in job["shape_keys"].items():
        for obj in meshes:
            keys = obj.data.shape_keys
            if keys and name in keys.key_blocks:
                keys.key_blocks[name].value = float(value)

# ---------------------------------------------------------------- materials
applied = []
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    node = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if node is None:
        continue
    if mat.name.startswith("m25_skin"):
        node.inputs["Subsurface Weight"].default_value = 0.18
        node.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
        node.inputs["Subsurface Scale"].default_value = 0.004
        node.subsurface_method = "RANDOM_WALK_SKIN"
        applied.append(mat.name + ": SSS (Cycles extension)")
    if mat.name.startswith("m25_hair"):
        # glTF cannot carry anisotropy; Cycles can. Same base, roughness and IOR.
        node.inputs["Anisotropic"].default_value = 0.4
        applied.append(mat.name + ": anisotropy (Cycles extension)")

mask = job.get("mask")
if mask:
    def flat(name, color):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = color
        nt.links.new(em.outputs[0], out.inputs[0])
        return m
    red, green, black = flat("mask-red", (1, 0, 0, 1)), flat("mask-green", (0, 1, 0, 1)), flat("mask-black", (0, 0, 0, 1))
    for o in meshes:
        m = red if o.name in mask.get("emit", []) else green if o.name in mask.get("green", []) else black
        o.data.materials.clear()
        o.data.materials.append(m)

# ------------------------------------------------------------------ camera
cam_spec = job["camera"]
center = Vector(cam_spec["center"])
radius = float(cam_spec["radius"])
views = {
    "front": (0, -1, 0.08), "three-quarter": (0.72, -1, 0.12), "left": (1, 0, 0.05), "right": (-1, 0, 0.05),
    "back": (0, 1, 0.1), "top": (0, -0.35, 1), "back-top": (0, 0.6, 1),
}
v = job.get("view", "front")
direction = Vector(v if isinstance(v, list) else views[v]).normalized()
cam_data = bpy.data.cameras.new("m25-cam")
cam_data.lens = float(cam_spec.get("lens", 85))
cam = bpy.data.objects.new("m25-cam", cam_data)
scene.collection.objects.link(cam)
width, height = job.get("resolution", [1024, 1024])
# sensor_fit AUTO puts the sensor width along the longer image side, so `fov` is the
# field of view of the longer side; `radius` is framed along that side.
fov = 2 * math.atan(cam_data.sensor_width / (2 * cam_data.lens))
distance = radius / math.sin(fov / 2)
cam.location = center + direction * distance
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.clip_start = max(distance / 100.0, 0.001)
cam_data.clip_end = distance * 20 + 10
scene.camera = cam

# ------------------------------------------------------------------ lights
lighting = job.get("lighting", "neutral-studio")
cam_right = cam.matrix_world.to_3x3() @ Vector((1, 0, 0))
cam_up = cam.matrix_world.to_3x3() @ Vector((0, 1, 0))
fwd = -direction
L = max(radius * 6, 0.6)  # light distance scales with the framing


def area(name, energy, offset, size, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.shape = "DISK"
    data.color = color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = center + offset
    obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def world(color, strength):
    w = bpy.data.worlds.new("m25-world")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*color, 1)
    bg.inputs["Strength"].default_value = strength
    scene.world = w


# Energies are relative: the grey card fixes absolute exposure afterwards.
if lighting == "neutral-studio":
    area("key", 100 * L * L, (cam_right * 0.8 - direction * -1.0 + cam_up * 0.6).normalized() * L, L * 0.5)
    area("fill", 35 * L * L, (-cam_right * 1.0 + direction * 0.8 + cam_up * 0.1).normalized() * L, L * 0.8)
    area("rim", 40 * L * L, (cam_right * 0.4 - direction * 1.0 + cam_up * 0.8).normalized() * L, L * 0.3)
    world((0.5, 0.5, 0.5), 0.15)
elif lighting == "soft-frontal":
    area("front", 100 * L * L, (direction + cam_up * 0.15).normalized() * L, L * 1.4)
    world((0.5, 0.5, 0.5), 0.25)
elif lighting == "directional-key":
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.0
    sun.angle = math.radians(2.0)
    so = bpy.data.objects.new("sun", sun)
    scene.collection.objects.link(so)
    d = (cam_right * 1.0 + direction * 0.6 + cam_up * 0.7).normalized()
    so.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    world((0.5, 0.5, 0.5), 0.06)
elif lighting == "warm-environment":
    warm = (1.0, 0.78, 0.55)
    area("key", 80 * L * L, (cam_right * 0.7 + direction * 0.9 + cam_up * 0.5).normalized() * L, L * 0.9, warm)
    world((0.62, 0.45, 0.3), 0.6)
else:
    raise SystemExit("unknown lighting " + lighting)

background = job.get("background", (0.035, 0.035, 0.04))

# ------------------------------------------------------------------ cycles
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.seed = int(job.get("seed", 0))
scene.cycles.max_bounces = 8
scene.cycles.diffuse_bounces = 3
scene.cycles.glossy_bounces = 3
scene.cycles.transparent_max_bounces = 16
scene.render.film_transparent = False
scene.render.resolution_percentage = 100
scene.render.threads_mode = "FIXED" if job.get("threads") else "AUTO"
if job.get("threads"):
    scene.render.threads = int(job["threads"])


def render_to(path, w, h, samples, denoise):
    scene.render.resolution_x, scene.render.resolution_y = int(w), int(h)
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.01
    scene.cycles.use_denoising = denoise
    if denoise:
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    bpy.ops.render.render(write_still=True)


# ------------------------------------------- grey-card exposure calibration
exposure = 0.0
card_value = None
if not mask:
    hidden = []
    for o in meshes:
        hidden.append((o, o.hide_render))
        o.hide_render = True
    cm = bpy.data.meshes.new("card")
    s = radius * 0.25
    cm.from_pydata([(-s, 0, -s), (s, 0, -s), (s, 0, s), (-s, 0, s)], [], [(0, 1, 2, 3)])
    card = bpy.data.objects.new("card", cm)
    scene.collection.objects.link(card)
    card.location = center
    card.rotation_euler = (-direction).to_track_quat("Y", "Z").to_euler()
    gm = bpy.data.materials.new("grey18")
    gm.use_nodes = True
    p = gm.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.18, 0.18, 0.18, 1)
    p.inputs["Roughness"].default_value = 1.0
    p.inputs["Specular IOR Level"].default_value = 0.0
    cm.materials.append(gm)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.color_management = "FOLLOW_SCENE"
    tmp = os.path.join(tempfile.mkdtemp(), "card.exr")
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.resolution_x = scene.render.resolution_y = 48
    scene.cycles.samples = 64
    scene.cycles.use_denoising = False
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    px = list(img.pixels)
    w_ = img.size[0]
    vals = []
    for y in range(18, 30):
        for x in range(18, 30):
            i = (y * w_ + x) * 4
            vals.append((px[i] + px[i + 1] + px[i + 2]) / 3)
    card_value = sum(vals) / len(vals)
    exposure = math.log2(0.18 / max(card_value, 1e-6)) + float(job.get("exposure_offset", 0.0))
    bpy.data.objects.remove(card, do_unlink=True)
    for o, h in hidden:
        o.hide_render = h

# background stays dark-neutral and does not light the subject: a holdout
# world colour is applied through the camera-ray-only light path.
if scene.world and not mask:
    nt = scene.world.node_tree
    bg = nt.nodes["Background"]
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    bg2 = nt.nodes.new("ShaderNodeBackground")
    bg2.inputs["Color"].default_value = (*background, 1)
    bg2.inputs["Strength"].default_value = 1.0 / (2 ** exposure)
    out = nt.nodes["World Output"]
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(bg2.outputs[0], mix.inputs[2])
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
elif mask:
    world((0, 0, 0), 0)

scene.view_settings.view_transform = "Standard" if mask else job.get("view_transform", "AgX")
scene.view_settings.look = "None" if mask else job.get("look", "None")
scene.view_settings.exposure = 0.0 if mask else exposure
samples = int(job.get("samples", 64))
render_to(job["output"], width, height, samples if not mask else 16, denoise=not mask and job.get("denoise", True))
seconds = time.time() - t0

triangles = 0
for o in meshes:
    o.data.calc_loop_triangles()
    triangles += len(o.data.loop_triangles)
report = {
    "input": job["input"], "output": job["output"], "view": v, "lighting": lighting,
    "camera": {"center": list(center), "radius": radius, "lens": cam_data.lens, "distance": distance,
               "location": list(cam.location)},
    "resolution": [width, height], "samples": samples, "adaptiveThreshold": 0.01,
    "denoise": "OpenImageDenoise" if (not mask and job.get("denoise", True)) else None,
    "seed": scene.cycles.seed,
    "viewTransform": scene.view_settings.view_transform, "look": scene.view_settings.look,
    "greyCard": {"linearValue": card_value, "exposureEV": exposure},
    "objects": [o.name for o in meshes], "triangles": triangles, "materialsApplied": applied,
    "animation": anim_report, "shapeKeys": job.get("shape_keys"), "renderSeconds": round(seconds, 2),
    "blender": bpy.app.version_string, "threads": scene.render.threads,
}
json.dump(report, open(job["output"] + ".json", "w"), indent=1)
print("M25_RENDER " + json.dumps({"out": os.path.basename(job["output"]), "s": report["renderSeconds"], "ev": round(exposure, 3), "tris": triangles}))
