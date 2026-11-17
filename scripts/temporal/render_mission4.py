"""Render a Mission 4 contact sheet with Blender (Cycles, CPU).

Every panel in a Mission 4 figure is real geometry: a GLB written by the ASRE
numerical pipeline (sparse voxels) or by the TripoSR worker. This script puts a
whole row of them into one scene, normalises each to a shared scale and renders
one image, so all panels are lit and projected identically. Labels are added
afterwards by compose_mission4.py, which keeps text out of the render and lets
the geometry stay the only thing Cycles touches.

    LD_LIBRARY_PATH="$PWD/.foundry/sysroot/usr/lib/x86_64-linux-gnu:$PWD/.foundry/sysroot/usr/lib" \\
      .foundry/blender-4.5.9-linux-x64/blender --background \\
      --python scripts/temporal/render_mission4.py -- \\
      --scene artifacts/mission4/scene_hypotheses.json \\
      --out artifacts/mission4/sheet_hypotheses.png --check

A scene file is the manifest written by scripts/temporal/run-mission4.ts:
{title, subtitle, items:[{glb,label,colour}], columns, view:{azimuth,elevation},
 bars?: [{label,value,colour}]}. When `bars` is present and `items` is empty the
sheet is a bar chart of measured values, drawn as boxes at true proportions.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

# Panels are stacked in a plane; one cell is 1.6 units wide and 2.0 tall, so a
# character fills ~72% of its cell's height and leaves room for a caption band.
CELL_W = 1.6
CELL_H = 2.0
ITEM_HEIGHT = 1.44
BASELINE_PAD = 0.12


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", required=False)
    parser.add_argument("--out", required=False)
    parser.add_argument("--tile", type=int, default=440, help="pixels per cell")
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--check", action="store_true")
    return parser.parse_args(argv)


def load_scene(path: str) -> dict:
    with open(path, "r", encoding="utf8") as handle:
        return json.load(handle)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def bounds_of(objects: list) -> tuple[Vector, Vector]:
    """World-space bounds from evaluated vertices.

    obj.bound_box is stale until the depsgraph runs, which silently framed the
    camera on a zero-radius scene in the Mission 3.5 renderer and produced blank
    images; evaluate instead of trusting the cached box.
    """
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for obj in objects:
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
        raise RuntimeError("no mesh: the GLB imported nothing")
    return lo, hi


def make_material(name: str, colour: tuple[float, float, float]) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (colour[0], colour[1], colour[2], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.52
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def import_item(path: str, colour: tuple[float, float, float], name: str) -> list:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    added = [obj for obj in bpy.context.scene.objects if obj not in before]
    meshes = [obj for obj in added if obj.type == "MESH"]
    if not meshes:
        for obj in added:
            bpy.data.objects.remove(obj, do_unlink=True)
        return []
    mat = make_material(f"{name}_mat", colour)
    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return meshes


def place(objects: list, centre: Vector, height: float) -> float:
    """Scale a group to `height` tall (preserving aspect) and stand it on z=0."""
    lo, hi = bounds_of(objects)
    size = hi - lo
    scale = height / size.z if size.z > 1e-9 else 1.0
    mid = (lo + hi) * 0.5
    for obj in objects:
        obj.location = Vector(
            (
                centre.x + (obj.location.x - mid.x) * scale,
                centre.y + (obj.location.y - mid.y) * scale,
                centre.z + (obj.location.z - lo.z) * scale,
            )
        )
        obj.scale = obj.scale * scale
    bpy.context.view_layer.update()
    return scale


def add_ground(width: float, height: float) -> None:
    bpy.ops.mesh.primitive_plane_add(size=max(width, height) * 3.0, location=(0, 0, -0.002))
    plane = bpy.context.object
    mat = make_material("ground", (0.055, 0.062, 0.082))
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.85
    plane.data.materials.append(mat)


def add_lights(centre: Vector, radius: float) -> None:
    """Key, fill and rim: one source makes a voxel surface read as a silhouette."""
    specs = [
        ("key", (-2.0, -2.2, 3.0), 520.0, 2.4),
        ("fill", (3.0, -1.2, 0.7), 150.0, 3.0),
        ("rim", (0.4, 3.0, 1.9), 380.0, 2.0),
    ]
    for name, offset, energy, size in specs:
        data = bpy.data.lights.new(name, type="AREA")
        data.energy = energy * radius * radius
        data.size = radius * size
        obj = bpy.data.objects.new(name, data)
        obj.location = centre + Vector(offset) * radius
        obj.rotation_euler = (centre - obj.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(obj)


def frame_camera(azimuth: float, elevation: float, aspect: float, margin: float = 1.07) -> None:
    """Orthographic camera framed on the projected bounds of the whole layout.

    Orthographic keeps the grid rectangular no matter the view angle: panels at
    different depths project to the same cell, so captions added later line up
    with geometry. The bounding box is projected into camera axes rather than
    approximated by a bounding sphere, which would waste half the frame on a
    wide five-panel row.
    """
    lo, hi = bounds_of(list(bpy.context.scene.objects))
    centre = (lo + hi) * 0.5

    az, el = math.radians(azimuth), math.radians(elevation)
    direction = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    cam_rot = (-direction).to_track_quat("-Z", "Y")
    right = cam_rot @ Vector((1, 0, 0))
    up = cam_rot @ Vector((0, 1, 0))

    half_w = 0.0
    half_h = 0.0
    for x in (lo.x, hi.x):
        for y in (lo.y, hi.y):
            for z in (lo.z, hi.z):
                p = Vector((x, y, z)) - centre
                half_w = max(half_w, abs(p.dot(right)))
                half_h = max(half_h, abs(p.dot(up)))

    ortho = max(half_h * 2.0, (half_w * 2.0) / max(aspect, 1e-6)) * margin

    data = bpy.data.cameras.new("sheet_camera")
    data.type = "ORTHO"
    data.ortho_scale = ortho
    camera = bpy.data.objects.new("sheet_camera", data)
    camera.location = centre + direction * (ortho * 2.2)
    camera.rotation_euler = cam_rot.to_euler()
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera


def configure_render(out: str, width: int, height: int, samples: int) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"

    world = bpy.data.worlds.new("asre_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.028, 0.034, 0.052, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    scene.world = world
    scene.render.filepath = out


def layout_cells(count: int, columns: int) -> list[tuple[int, int]]:
    columns = max(1, columns)
    cells = []
    for index in range(count):
        cells.append((index % columns, index // columns))
    return cells


def render_geometry_sheet(spec: dict, out: str, tile: int, samples: int) -> dict:
    items = [item for item in spec.get("items", []) if item.get("glb")]
    columns = int(spec.get("columns") or 1)
    rows = max(1, math.ceil(len(items) / max(1, columns)))
    width = columns * tile
    height = rows * tile
    aspect = width / height

    clear_scene()
    view = spec.get("view") or {}
    azimuth = float(view.get("azimuth", 24.0))
    elevation = float(view.get("elevation", 10.0))

    cells = layout_cells(len(items), columns)
    missing: list[str] = []
    placed = 0
    for item, (col, row) in zip(items, cells):
        path = item["glb"]
        if not os.path.exists(path):
            missing.append(path)
            continue
        meshes = import_item(path, tuple(item.get("colour", (0.7, 0.7, 0.72))), f"item{placed}")
        if not meshes:
            missing.append(path)
            continue
        centre = Vector(
            (
                (col - (columns - 1) / 2.0) * CELL_W,
                ((rows - 1) / 2.0 - row) * CELL_H + BASELINE_PAD,
                0.0,
            )
        )
        place(meshes, centre, ITEM_HEIGHT)
        placed += 1

    if placed == 0:
        raise SystemExit(f"scene '{spec.get('title')}' imported no geometry; missing: {missing}")

    bounds_lo, bounds_hi = bounds_of(list(bpy.context.scene.objects))
    centre = (bounds_lo + bounds_hi) * 0.5
    radius = max(1.0, (bounds_hi - bounds_lo).length * 0.5)
    add_ground(width / max(1, columns) * CELL_W, rows * CELL_H)
    add_lights(centre, radius)
    frame_camera(azimuth, elevation, aspect)
    configure_render(out, width, height, samples)
    bpy.ops.render.render(write_still=True)
    return {"ok": True, "mode": "geometry", "out": out, "panels": placed, "missing": missing,
            "width": width, "height": height, "columns": columns, "rows": rows}


def render_bars(spec: dict, out: str, tile: int, samples: int) -> dict:
    """Measured values as boxes: the chart is data, the boxes are geometry."""
    bars = spec.get("bars") or []
    if not bars:
        raise SystemExit("bar scene has no bars")
    clear_scene()
    peak = max(bar["value"] for bar in bars) or 1.0
    gap = 0.55
    bar_width = 0.85
    tallest = 3.2
    span = len(bars) * (bar_width + gap)
    for index, bar in enumerate(bars):
        height = tallest * (bar["value"] / peak)
        x = index * (bar_width + gap) - span * 0.5 + bar_width * 0.5
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x, 0.0, height * 0.5))
        cube = bpy.context.object
        cube.scale = (bar_width * 0.5, bar_width * 0.5, max(height, 1e-3) * 0.5)
        mat = make_material(f"bar{index}", tuple(bar.get("colour", (0.6, 0.6, 0.62))))
        cube.data.materials.append(mat)
        bpy.context.view_layer.update()

    width = max(900, len(bars) * tile)
    height = int(tile * 1.5)
    lo, hi = bounds_of(list(bpy.context.scene.objects))
    centre = (lo + hi) * 0.5
    add_ground(width, height)
    add_lights(centre, max(1.0, (hi - lo).length * 0.6))
    frame_camera(14.0, 12.0, width / height, margin=1.12)
    configure_render(out, width, height, samples)
    bpy.ops.render.render(write_still=True)
    return {"ok": True, "mode": "bars", "out": out, "bars": len(bars),
            "width": width, "height": height, "columns": len(bars), "rows": 1}


def main() -> None:
    args = parse_args()
    if args.check:
        print(json.dumps({"ok": True, "blender": bpy.app.version_string}))
        return
    if not args.scene or not args.out:
        raise SystemExit("--scene and --out are required")

    spec = load_scene(args.scene)
    if spec.get("bars") and not spec.get("items"):
        report = render_bars(spec, args.out, args.tile, args.samples)
    else:
        report = render_geometry_sheet(spec, args.out, args.tile, args.samples)
    report["blender"] = bpy.app.version_string
    report["engine"] = "CYCLES/CPU"
    report["samples"] = args.samples
    print("SHEET " + json.dumps(report))


if __name__ == "__main__":
    main()
