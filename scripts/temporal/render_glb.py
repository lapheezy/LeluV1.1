"""Render a GLB to PNG with Blender (Cycles, CPU).

The isometric rasteriser in render-mission3.ts is a diagnostic tool; this is
the production path: real geometry, real lights, a real renderer. It also
supports a cutaway, which is the only honest way to show that a solid has an
interior rather than a boundary that happens to look solid.

    LD_LIBRARY_PATH="$PWD/.foundry/sysroot/usr/lib/x86_64-linux-gnu:$PWD/.foundry/sysroot/usr/lib" \\
      .foundry/blender-4.5.9-linux-x64/blender --background --python scripts/temporal/render_glb.py -- \\
      --glb artifacts/mission35/lelu_apose_recon.glb --out artifacts/mission35/recon_iso.png
"""

from __future__ import annotations

import argparse
import json
import math
import sys

import bpy
from mathutils import Vector

VIEWS = {
    "iso": (38.0, 22.0),
    "front": (0.0, 4.0),
    "side": (90.0, 4.0),
    "back": (180.0, 4.0),
    "top": (0.0, 84.0),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=False)
    parser.add_argument("--out", required=False)
    parser.add_argument("--resolution", type=int, default=800)
    parser.add_argument("--samples", type=int, default=48)
    parser.add_argument("--view", default="iso")
    parser.add_argument("--azimuth", type=float, default=None)
    parser.add_argument("--elevation", type=float, default=None)
    parser.add_argument("--cut", choices=["none", "x", "y", "z"], default="none")
    parser.add_argument("--cut-fraction", type=float, default=0.5)
    parser.add_argument("--color", default="steel")
    parser.add_argument("--check", action="store_true")
    return parser.parse_args(argv)


PALETTE = {
    "steel": (0.42, 0.55, 0.78, 1.0),
    "teal": (0.28, 0.78, 0.70, 1.0),
    "clay": (0.78, 0.58, 0.44, 1.0),
    "signal": (0.95, 0.63, 0.28, 1.0),
    "violet": (0.55, 0.45, 0.92, 1.0),
}


def scene_bounds() -> tuple[Vector, float]:
    """Bounds from evaluated vertices, not obj.bound_box.

    bound_box is stale until the depsgraph runs, which silently framed the
    camera on a zero-radius scene and produced blank renders.
    """
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        for vertex in mesh.vertices:
            world = evaluated.matrix_world @ vertex.co
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
        evaluated.to_mesh_clear()
    if not math.isfinite(lo[0]):
        raise RuntimeError("no mesh in scene: the GLB imported nothing")
    return (lo + hi) * 0.5, (hi - lo).length * 0.5


def apply_cutaway(axis: str, fraction: float, center: Vector, radius: float) -> None:
    """Clip away everything on the +axis side of a plane.

    A boolean modifier is the obvious tool and the wrong one here: a voxel
    export is a soup of thousands of separate closed cubes, and the EXACT
    solver collapses it (measured: 34,464 triangles in, 43 out). Deleting
    the faces whose centroid is past the plane is exact for any soup, does
    not touch geometry it keeps, and is deterministic.
    """
    import bmesh

    index = {"x": 0, "y": 1, "z": 2}[axis]
    plane = center[index] + (fraction - 0.5) * radius * 2.0
    for obj in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        doomed = [f for f in bm.faces if (obj.matrix_world @ f.calc_center_median())[index] > plane]
        if doomed:
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()


def material(name: str) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = PALETTE.get(name, PALETTE["steel"])
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def main() -> None:
    args = parse_args()
    if args.check:
        print(json.dumps({"ok": True, "blender": bpy.app.version_string}))
        return

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.glb)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"GLB contained no meshes: {args.glb}")

    center, radius = scene_bounds()
    if args.cut != "none":
        apply_cutaway(args.cut, args.cut_fraction, center, radius)
        center, radius = scene_bounds()

    skin = material(args.color)
    triangles = 0
    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(skin)
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    bpy.context.view_layer.update()

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"

    world = bpy.data.worlds.new("nre_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.035, 0.045, 0.07, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.4
    scene.world = world

    azimuth, elevation = VIEWS.get(args.view, VIEWS["iso"])
    if args.azimuth is not None:
        azimuth = args.azimuth
    if args.elevation is not None:
        elevation = args.elevation

    distance = radius * 3.1
    az, el = math.radians(azimuth), math.radians(elevation)
    location = center + Vector(
        (math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))
    ) * distance

    camera_data = bpy.data.cameras.new("nre_camera")
    camera_data.lens = 60.0
    camera = bpy.data.objects.new("nre_camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = location
    camera.rotation_euler = (center - location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    # Key, fill and rim: without three sources a voxel surface reads as a flat
    # silhouette and the cutaway face is indistinguishable from the outside.
    key_data = bpy.data.lights.new("key", type="AREA")
    key_data.energy = 420.0 * radius * radius
    key_data.size = radius * 2.5
    key = bpy.data.objects.new("key", key_data)
    key.location = center + Vector((-radius * 2.0, -radius * 2.2, radius * 3.0))
    key.rotation_euler = (center - key.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(key)

    fill_data = bpy.data.lights.new("fill", type="AREA")
    fill_data.energy = 130.0 * radius * radius
    fill_data.size = radius * 3.0
    fill = bpy.data.objects.new("fill", fill_data)
    fill.location = center + Vector((radius * 3.0, -radius * 1.2, radius * 0.6))
    fill.rotation_euler = (center - fill.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(fill)

    rim_data = bpy.data.lights.new("rim", type="AREA")
    rim_data.energy = 320.0 * radius * radius
    rim_data.size = radius * 2.0
    rim = bpy.data.objects.new("rim", rim_data)
    rim.location = center + Vector((radius * 0.4, radius * 3.0, radius * 1.8))
    rim.rotation_euler = (center - rim.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(rim)

    # A cutaway opens a cavity whose walls face the viewer, and the shell
    # around that opening shadows every studio light placed behind it: an
    # unwalled cross-section renders as a black void. This light sits beside
    # the camera so the exposed interior is actually lit.
    head_data = bpy.data.lights.new("head", type="AREA")
    head_data.energy = 95.0 * radius * radius
    head_data.size = radius * 1.6
    head = bpy.data.objects.new("head", head_data)
    head.location = location + (center - location).normalized() * radius * 0.8
    head.rotation_euler = (center - head.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(head)

    scene.render.filepath = args.out
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)

    print(
        json.dumps(
            {
                "ok": True,
                "out": args.out,
                "blender": bpy.app.version_string,
                "engine": "CYCLES/CPU",
                "samples": args.samples,
                "resolution": args.resolution,
                "view": args.view,
                "cut": args.cut,
                "triangles": triangles,
                "meshes": len(meshes),
                "radius": round(radius, 4),
            }
        )
    )


if __name__ == "__main__":
    main()
