"""
==========================================================
LÉLU CHARACTER FOUNDRY — RENDERING PACKAGE (Cycles)
==========================================================

Physically based studio lighting and a fixed camera set, so every
build of the character is inspected the same way:

  face_closeup  85 mm, f/2.0, framed on the eyes and lips
  bust          85 mm, collar to crown
  full_body     65 mm, head to sole
  three_quarter 45 degrees, waist-up and full
  profile       90 degrees
  back          reverse
  rotation      12 frames around the character

Renders are Cycles/CPU with OpenImageDenoise. Preview runs use a
low sample count and small frames for iteration; the final set
uses the high settings in `QUALITY`. Nothing is upscaled: the
inspection package is rendered at the resolution it is shown at.

Run:
  python render_package.py '{"blend":"...","outDir":"...","preset":"preview"}'
==========================================================
"""

from __future__ import annotations

import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

PRESETS = {
    "preview": {"samples": 40, "width": 540, "height": 720, "denoise": True},
    "final": {"samples": 320, "width": 1152, "height": 1536, "denoise": True},
    "hero": {"samples": 512, "width": 1440, "height": 1920, "denoise": True},
}

# colour-managed, dark-neutral studio with copper-friendly rim strips
STUDIO = {
    "backdrop": (0.016, 0.015, 0.014),
    "floor": (0.009, 0.009, 0.009),
    "world": (0.006, 0.007, 0.009),
}


def _aim(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area(name, location, target, size, power, color=(1.0, 1.0, 1.0), shape="RECTANGLE"):
    data = bpy.data.lights.new(name, type="AREA")
    data.shape = shape
    data.size = size
    data.energy = power
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    _aim(obj, target)
    return obj


def build_studio():
    scene = bpy.context.scene
    # floor + curved backdrop (a big arc so shadows fall away naturally)
    bpy.ops.mesh.primitive_plane_add(size=16, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = "Studio_Floor"
    mat = bpy.data.materials.new("Studio_Floor_Mat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*STUDIO["floor"], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.52
    floor.data.materials.append(mat)

    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 2.55, 1.9),
                                     rotation=(math.radians(90), 0, 0))
    cy = bpy.context.active_object
    cy.name = "Studio_Backdrop"
    mat2 = bpy.data.materials.new("Studio_Back_Mat")
    mat2.use_nodes = True
    b2 = mat2.node_tree.nodes["Principled BSDF"]
    b2.inputs["Base Color"].default_value = (*STUDIO["backdrop"], 1.0)
    b2.inputs["Roughness"].default_value = 0.7
    cy.data.materials.append(mat2)

    world = bpy.data.worlds.new("LELU_Studio_World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*STUDIO["world"], 1.0)
    bg.inputs["Strength"].default_value = 1.0
    scene.world = world

    eye = (0.0, -0.02, 1.74)
    chest = (0.0, -0.02, 1.42)
    add_area("Key", (-1.15, -1.60, 1.95), eye, 1.4, 240, (1.0, 0.92, 0.84))
    add_area("Hair_Rim", (0.15, 1.70, 2.45), chest, 1.2, 220, (1.0, 0.68, 0.50))
    add_area("Fill", (1.85, -1.75, 1.45), chest, 2.2, 55, (0.84, 0.89, 1.0))
    add_area("Rim_L", (1.75, 1.85, 2.15), chest, 0.9, 190, (1.0, 0.70, 0.52), shape="RECTANGLE")
    add_area("Rim_R", (-1.85, 1.65, 1.95), chest, 0.9, 160, (1.0, 0.72, 0.55))
    add_area("Top", (0.0, -0.4, 3.20), chest, 2.4, 90, (1.0, 0.97, 0.95))
    add_area("Face_Soft", (0.22, -0.80, 1.78), eye, 0.5, 22, (1.0, 0.91, 0.85))
    return scene


def make_camera(name, location, target, lens=85.0, fstop=2.2, sensor=36.0):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.sensor_width = sensor
    data.dof.use_dof = True
    data.dof.aperture_fstop = fstop
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    _aim(obj, target)
    empty = bpy.data.objects.new(f"{name}_Focus", None)
    empty.location = target
    bpy.context.scene.collection.objects.link(empty)
    data.dof.focus_object = empty
    return obj


def orbit(distance, height, angle_deg, target=(0, 0, 1.55)):
    a = math.radians(angle_deg)
    return (math.sin(a) * distance, -math.cos(a) * distance, height)


VIEWS = [
    # name, distance, height, angle, lens, fstop, target
    ("face_closeup", 0.72, 1.716, 0, 100, 5.6, (0.0, -0.03, 1.706)),
    ("bust", 1.25, 1.52, 0, 85, 2.4, (0.0, -0.02, 1.500)),
    ("full_body", 4.10, 0.98, 0, 65, 4.0, (0.0, 0.0, 0.95)),
    ("three_quarter", 2.30, 1.42, 42, 85, 3.2, (0.0, -0.02, 1.300)),
    ("three_quarter_full", 3.60, 1.05, 38, 65, 4.0, (0.0, 0.0, 0.98)),
    ("profile", 3.60, 1.05, 90, 65, 4.0, (0.0, 0.0, 0.98)),
    ("back", 3.60, 1.05, 180, 65, 4.0, (0.0, 0.0, 0.98)),
]


def setup_render(preset):
    scene = bpy.context.scene
    q = PRESETS[preset]
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = q["samples"]
    scene.cycles.use_denoising = q["denoise"]
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 6
    scene.cycles.transmission_bounces = 12
    scene.cycles.transparent_max_bounces = 8
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.caustics_reflective = True
    scene.cycles.caustics_refractive = True
    scene.render.resolution_x = q["width"]
    scene.render.resolution_y = q["height"]
    scene.render.resolution_percentage = 100
    scene.render.filepath = ""
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
    scene.view_settings.exposure = -0.15
    scene.render.threads_mode = "AUTO"
    scene.cycles.use_fast_gi = False
    scene.cycles.blur_glossy = 1.0
    return q


def render_view(cam, path, samples=None):
    scene = bpy.context.scene
    scene.camera = cam
    if samples:
        scene.cycles.samples = samples
    scene.render.filepath = path
    started = time.time()
    bpy.ops.render.render(write_still=True)
    return round(time.time() - started, 1)


def render_rotation(outdir, preset="preview", frames=12, samples=None):
    q = PRESETS[preset]
    paths = []
    for i in range(frames):
        angle = 360.0 * i / frames
        cam = make_camera(f"Rot_{i:02d}", orbit(3.55, 1.05, angle), (0, 0, 0.98),
                          lens=65, fstop=4.0)
        path = os.path.join(outdir, f"rotation_{i:02d}.png")
        scene = bpy.context.scene
        scene.render.resolution_x = int(q["width"] * 0.7)
        scene.render.resolution_y = int(q["height"] * 0.7)
        render_view(cam, path, samples or max(16, q["samples"] // 2))
        paths.append(path)
    return paths


def main():
    argv = sys.argv
    opts = {}
    if "--" in argv:
        rest = argv[argv.index("--") + 1:]
        if rest:
            opts = json.loads(rest[0])
    elif len(argv) > 1 and argv[-1].strip().startswith("{"):
        opts = json.loads(argv[-1])

    blend = opts.get("blend")
    if blend:
        bpy.ops.wm.open_mainfile(filepath=blend)
    outdir = opts.get("outDir") or os.path.join(os.path.dirname(blend or "."), "renders")
    preset = opts.get("preset", "preview")
    os.makedirs(outdir, exist_ok=True)

    for name in ("Studio_Floor", "Studio_Backdrop"):
        if name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    for obj in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(obj, do_unlink=True)

    build_studio()
    q = setup_render(preset)

    views = opts.get("views") or [v[0] for v in VIEWS]
    report = {"preset": preset, "samples": q["samples"], "renders": {}}
    for name, dist, height, angle, lens, fstop, target in VIEWS:
        if name not in views:
            continue
        cam = make_camera(f"Cam_{name}", orbit(dist, height, angle, target), target,
                          lens=lens, fstop=fstop)
        scene = bpy.context.scene
        scene.render.resolution_x = q["width"]
        scene.render.resolution_y = q["height"]
        path = os.path.join(outdir, f"{name}.png")
        seconds = render_view(cam, path, q["samples"])
        report["renders"][name] = {"file": os.path.basename(path), "seconds": seconds,
                                   "width": q["width"], "height": q["height"]}
        print(f"[render] {name} {seconds}s -> {path}")

    if opts.get("rotation"):
        paths = render_rotation(outdir, preset, frames=int(opts.get("rotationFrames", 12)),
                                samples=opts.get("rotationSamples"))
        report["rotation"] = [os.path.basename(p) for p in paths]

    with open(os.path.join(outdir, "render_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
