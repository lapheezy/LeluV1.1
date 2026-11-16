"""
==========================================================
LÉLU 3D FORGE — BLENDER EXPORT (headless)

The format + source step. Takes a GLB the Forge downloaded and
inspected and produces, from it:

  editable.blend   the editable source project, untouched
                   geometry — this is what a person opens in
                   Blender to keep working
  source.*         OBJ (+MTL + texture), FBX, STL — interchange
                   and 3D-print/CNC formats
  runtime.glb      an optimized copy for the Cosmos: decimated
                   to a triangle budget, textures kept
  render.png       a Cycles CPU render of the asset as framed

  blender --background --python lelu_export.py -- '<json>'
  json: { "input": ".../model.glb", "outDir": "...",
          "formats": ["blend","glb","obj","stl","fbx"],
          "targetTris": 30000, "render": {"size": 640,
          "samples": 24} }

Why the source and the runtime copy are separate files: the
Cosmos needs something light enough to hold at 60 fps, and the
asset library needs something a person can still edit. Doing
that by overwriting one file loses whichever came second.

Nothing is uploaded; nothing spends credits.
==========================================================
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

ARGS = json.loads(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else {}
INPUT = ARGS["input"]
OUT = ARGS["outDir"]
FORMATS = [f.lower() for f in ARGS.get("formats", ["blend", "glb", "obj", "stl", "fbx"])]
TARGET_TRIS = int(ARGS.get("targetTris", 30000))
RENDER = ARGS.get("render", {"size": 640, "samples": 24})

os.makedirs(OUT, exist_ok=True)
REPORT = {
    "input": os.path.basename(INPUT),
    "formats": {},
    "render": None,
    "runtime": None,
    "source": {},
    "steps": [],
    "warnings": [],
}


def log(step, **data):
    REPORT["steps"].append({"step": step, **data})
    print(f"[lelu-export] {step} {json.dumps(data, default=str)}", flush=True)


def mesh_objects():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def triangles():
    total = 0
    for obj in mesh_objects():
        mesh = obj.data
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
    return total


def bounds():
    """World-space bounds of every mesh in the scene."""
    low = Vector((math.inf, math.inf, math.inf))
    high = Vector((-math.inf, -math.inf, -math.inf))
    found = False
    for obj in mesh_objects():
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            low = Vector((min(low.x, world.x), min(low.y, world.y), min(low.z, world.z)))
            high = Vector((max(high.x, world.x), max(high.y, world.y), max(high.z, world.z)))
            found = True
    if not found:
        return None, None
    return low, high


def load():
    """Import the GLB into an empty scene; return what it contains."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if not os.path.exists(INPUT):
        raise SystemExit(f"input does not exist: {INPUT}")
    bpy.ops.import_scene.gltf(filepath=INPUT)
    objects = list(bpy.data.objects)
    armatures = [o for o in objects if o.type == "ARMATURE"]
    low, high = bounds()
    info = {
        "objects": len(objects),
        "meshes": len(mesh_objects()),
        "armatures": len(armatures),
        "bones": sum(len(a.data.bones) for a in armatures),
        "materials": len(bpy.data.materials),
        "images": len(bpy.data.images),
        "triangles": triangles(),
        "actions": len(bpy.data.actions),
        "height": round((high.z - low.z), 4) if low else None,
        "min": [round(v, 4) for v in low] if low else None,
        "max": [round(v, 4) for v in high] if high else None,
    }
    log("loaded", **info)
    return info


def export_blend():
    file = os.path.join(OUT, "editable.blend")
    bpy.ops.wm.save_as_mainfile(filepath=file)
    # Keep the session pointed at a scratch path so later saves cannot
    # overwrite the source project we just wrote.
    return file


def export_glb(file_name, decimate_ratio=None):
    """Export a GLB, optionally through a decimate modifier set to a ratio."""
    modifiers = []
    if decimate_ratio is not None and decimate_ratio < 1.0:
        for obj in mesh_objects():
            modifier = obj.modifiers.new(name="lelu_runtime_decimate", type="DECIMATE")
            modifier.ratio = decimate_ratio
            modifier.use_collapse_triangulate = True
            modifiers.append((obj, modifier))
    file = os.path.join(OUT, file_name)
    try:
        bpy.ops.export_scene.gltf(
            filepath=file,
            export_format="GLB",
            export_apply=True,
            export_yup=True,
            export_animations=True,
            export_skins=True,
            export_morph=True,
            export_materials="EXPORT",
        )
    finally:
        for obj, modifier in modifiers:
            obj.modifiers.remove(modifier)
    return file


def export_obj():
    file = os.path.join(OUT, "source.obj")
    bpy.ops.wm.obj_export(
        filepath=file,
        export_materials=True,
        export_selected_objects=False,
        export_uv=True,
        export_normals=True,
        export_triangulated_mesh=True,
        forward_axis="Y",
        up_axis="Z",
    )
    return file


def export_stl():
    file = os.path.join(OUT, "source.stl")
    # Blender 4.2+ moved STL to bpy.ops.wm.stl_export; older builds keep
    # the mesh operator. Try the current one first, then fall back.
    if hasattr(bpy.ops.wm, "stl_export"):
        bpy.ops.wm.stl_export(filepath=file, export_selected_objects=False, ascii_format=False)
    else:  # pragma: no cover - older Blender only
        bpy.ops.export_mesh.stl(filepath=file)
    return file


def export_fbx():
    file = os.path.join(OUT, "source.fbx")
    bpy.ops.export_scene.fbx(
        filepath=file,
        use_selection=False,
        apply_scale_options="FBX_SCALE_ALL",
        bake_anim=True,
        add_leaf_bones=False,
        path_mode="COPY",
        embed_textures=True,
    )
    return file


def frame_camera(low, high):
    """A 3/4 front camera that fits the asset, plus three-point light."""
    centre = (low + high) / 2
    size = max((high - low).x, (high - low).y, (high - low).z, 0.001)
    direction = Vector((0.55, -1.0, 0.22)).normalized()
    distance = size * 1.35
    location = centre + direction * distance

    camera_data = bpy.data.cameras.new("lelu_camera")
    camera_data.lens = 55
    camera = bpy.data.objects.new("lelu_camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = location
    # Point it at the centre of the asset.
    look = centre - location
    camera.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    for name, offset, energy, size_light in (
        ("key", Vector((1.0, -1.2, 1.1)), 900, size * 1.4),
        ("fill", Vector((-1.2, -0.6, 0.4)), 350, size * 1.8),
        ("rim", Vector((-0.3, 1.2, 0.9)), 600, size * 1.2),
    ):
        light_data = bpy.data.lights.new(f"lelu_{name}", type="AREA")
        light_data.energy = energy * max(size, 0.5)
        light_data.size = max(size_light, 0.2)
        light = bpy.data.objects.new(f"lelu_{name}", light_data)
        bpy.context.scene.collection.objects.link(light)
        light.location = centre + offset * size * 1.6
        light.rotation_euler = (centre - light.location).to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("lelu_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.035, 0.045, 0.075, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    bpy.context.scene.world = world


def render_preview(low, high):
    if not RENDER:
        return None
    frame_camera(low, high)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(RENDER.get("samples", 24))
    scene.cycles.use_denoising = True
    scene.render.film_transparent = False
    size = int(RENDER.get("size", 640))
    scene.render.resolution_x = size
    scene.render.resolution_y = int(size * 1.25)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    file = os.path.join(OUT, "render.png")
    scene.render.filepath = file
    bpy.ops.render.render(write_still=True)
    return file


def main():
    source = load()
    REPORT["source"] = source

    if "blend" in FORMATS:
        try:
            path = export_blend()
            REPORT["formats"]["blend"] = {"file": os.path.basename(path), "bytes": os.path.getsize(path)}
            log("exported", format="blend")
        except Exception as error:  # noqa: BLE001 - reported, not hidden
            REPORT["warnings"].append(f"blend export failed: {error}")

    for name, function in (("obj", export_obj), ("stl", export_stl), ("fbx", export_fbx)):
        if name not in FORMATS:
            continue
        try:
            path = function()
            REPORT["formats"][name] = {"file": os.path.basename(path), "bytes": os.path.getsize(path)}
            log("exported", format=name, bytes=os.path.getsize(path))
        except Exception as error:  # noqa: BLE001
            REPORT["warnings"].append(f"{name} export failed: {error}")
            log("export_failed", format=name, error=str(error))

    low, high = bounds()
    if RENDER:
        try:
            path = render_preview(low, high)
            REPORT["render"] = {"file": os.path.basename(path), "bytes": os.path.getsize(path)} if path else None
            log("rendered", file=os.path.basename(path) if path else None)
        except Exception as error:  # noqa: BLE001
            REPORT["warnings"].append(f"render failed: {error}")
            log("render_failed", error=str(error))

    # Runtime copy: decimated, materials kept, re-exported as its own GLB.
    # Done after the source formats so those keep the full-resolution mesh.
    if "glb" in FORMATS:
        before = triangles()
        ratio = 1.0
        if TARGET_TRIS > 0 and before > TARGET_TRIS:
            ratio = max(0.05, TARGET_TRIS / before)
        try:
            path = export_glb("runtime.glb", decimate_ratio=ratio)
            REPORT["runtime"] = {
                "file": os.path.basename(path),
                "bytes": os.path.getsize(path),
                "sourceTriangles": before,
                "decimateRatio": round(ratio, 4),
            }
            log("exported_runtime", bytes=os.path.getsize(path), ratio=round(ratio, 4))
        except Exception as error:  # noqa: BLE001
            REPORT["warnings"].append(f"runtime glb export failed: {error}")
            log("runtime_failed", error=str(error))

    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as handle:
        json.dump(REPORT, handle, indent=2)
    print(f"[lelu-export] done {json.dumps(REPORT['formats'])}", flush=True)


main()
