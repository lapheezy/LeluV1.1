"""Import a reconstructed mesh into Blender 4.5 and validate it against the
reference photographs.

    python import_cloud_mesh.py '{"mesh":"...glb","outDir":"...","height":1.72}'

What it does:
  * imports GLB / OBJ / FBX,
  * drops the mesh onto z=0 and scales it so total height matches the measured
    figure height (1.72 m over the platform soles),
  * reports connected components, triangles, bounding box and aspect ratios
    against the calibrated landmarks (shoulder / waist / hip fractions),
  * renders front, back, profile and three-quarter views through the existing
    render_package studio,
  * writes comparison sheets against PRIMARY_SOURCE with the same framing.

Nothing here invents geometry: it measures what the reconstruction returned.
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_package as RP  # noqa: E402

BASE = os.path.abspath(os.path.join(HERE, "..", "..", "leluverse", "assets",
                                    "characters", "lelu_character"))
REF = os.path.join(BASE, "references", "PRIMARY_SOURCE")


def clear():
    # read_factory_settings resets the render backend and breaks EGL headless;
    # deleting the datablocks is enough and keeps Cycles configured.
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def import_mesh(path: str):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".glb" or ext == ".gltf":
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        raise SystemExit(f"unsupported mesh type {ext}")
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objs:
        raise SystemExit("no mesh objects in file")
    return objs


def world_bounds(objs):
    pts = []
    deps = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        for v in o.evaluated_get(deps).data.vertices:
            pts.append(o.matrix_world @ v.co)
    arr = np.asarray([tuple(p) for p in pts], dtype=np.float64)
    return arr.min(axis=0), arr.max(axis=0)


def normalise(objs, target_height=1.72):
    lo, hi = world_bounds(objs)
    height = float(hi[2] - lo[2])
    if height <= 1e-6:
        raise SystemExit("degenerate mesh")
    s = target_height / height
    empty = bpy.data.objects.new("normalise", None)
    bpy.context.collection.objects.link(empty)
    for o in objs:
        o.parent = empty
    empty.scale = (s, s, s)
    bpy.context.view_layer.update()
    lo2, hi2 = world_bounds(objs)
    empty.location.z -= lo2[2]
    bpy.context.view_layer.update()
    return {"imported_height": round(height, 4), "scale": round(s, 5),
            "final_height": round(float(world_bounds(objs)[1][2] - world_bounds(objs)[0][2]), 4)}


def topology_report(objs):
    tris = 0
    verts = 0
    comps = 0
    for o in objs:
        m = o.data
        m.calc_loop_triangles()
        tris += len(m.loop_triangles)
        verts += len(m.vertices)
        # count loose islands by union-find over edges
        parent = list(range(len(m.vertices)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for e in m.edges:
            a, b = find(e.vertices[0]), find(e.vertices[1])
            if a != b:
                parent[a] = b
        comps += len({find(i) for i in range(len(m.vertices))})
    return {"objects": len(objs), "vertices": verts, "triangles": tris,
            "connected_components": comps}


def silhouette_widths(objs, fractions):
    lo, hi = world_bounds(objs)
    height = hi[2] - lo[2]
    pts = []
    for o in objs:
        for v in o.data.vertices:
            pts.append(o.matrix_world @ v.co)
    arr = np.asarray([tuple(p) for p in pts])
    out = {}
    for name, frac in fractions.items():
        z = hi[2] - frac * height
        band = arr[np.abs(arr[:, 2] - z) < 0.012 * height]
        if len(band) < 10:
            continue
        out[name] = {"z": round(float(z), 4),
                     "width_m": round(float(band[:, 0].max() - band[:, 0].min()), 4),
                     "width_over_height": round(float((band[:, 0].max() - band[:, 0].min()) / height), 4)}
    return out


def render_views(outdir, preset="preview"):
    # setup_render is what switches the scene to Cycles; without it Blender
    # falls back to EEVEE, which needs a GL context and aborts headless.
    RP.setup_render(preset)
    RP.build_studio()
    views = {}
    for name, (loc, target, lens) in {
            "front": ((0.0, -4.2, 1.0), (0, 0, 0.95), 85.0),
            "three_quarter": ((2.9, -3.0, 1.15), (0, 0, 0.95), 85.0),
            "profile": ((4.2, 0.0, 1.0), (0, 0, 0.95), 85.0),
            "back": ((0.0, 4.2, 1.0), (0, 0, 0.95), 85.0)}.items():
        cam = RP.make_camera(f"cam_{name}", loc, target, lens=lens, fstop=4.0)
        bpy.context.scene.camera = cam
        path = os.path.join(outdir, "renders", f"{name}.png")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        RP.render_view(cam, path)
        views[name] = path
        print(f"[import] rendered {name} -> {path}")
    return views


def comparison_sheet(views, out_png):
    from PIL import Image
    pairs = [("front", "01_front_full_body.png"), ("back", "03_back_upper_body.png"),
             ("three_quarter", "02_face_closeup.png")]
    tiles = []
    for view, ref in pairs:
        if view not in views:
            continue
        r = Image.open(os.path.join(REF, ref)).convert("RGB")
        m = Image.open(views[view]).convert("RGB")
        H = 900
        r = r.resize((int(r.width * H / r.height), H), Image.LANCZOS)
        m = m.resize((int(m.width * H / m.height), H), Image.LANCZOS)
        tiles.append((r, m))
    if not tiles:
        return None
    W = sum(r.width + m.width + 8 for r, m in tiles) + 8 * (len(tiles) - 1)
    sheet = Image.new("RGB", (W, 900), (20, 20, 20))
    x = 0
    for r, m in tiles:
        sheet.paste(r, (x, 0)); x += r.width
        sheet.paste(m, (x, 0)); x += m.width + 8
    sheet.save(out_png)
    return out_png


def main():
    opts = {}
    if "--" in sys.argv:
        rest = sys.argv[sys.argv.index("--") + 1:]
        if rest:
            opts = json.loads(rest[0])
    elif len(sys.argv) > 1 and sys.argv[-1].strip().startswith("{"):
        opts = json.loads(sys.argv[-1])
    mesh = os.path.abspath(opts["mesh"])
    outdir = os.path.abspath(opts.get("outDir", os.path.join(BASE, "foundry", "cloud", "imported")))
    os.makedirs(outdir, exist_ok=True)
    target_height = float(opts.get("height", 1.72))

    clear()
    objs = import_mesh(mesh)
    info = {"mesh": mesh, "import": normalise(objs, target_height),
            "topology": topology_report(objs)}
    fractions = {"hairline": 0.0305, "eye": 0.0662, "chin": 0.1492, "shoulder": 0.1754,
                 "bust": 0.2216, "waist": 0.2805, "belt": 0.3277, "crotch": 0.4580,
                 "knee": 0.7350, "ankle": 0.9000}
    info["silhouette"] = silhouette_widths(objs, fractions)

    if not opts.get("noRender"):
        views = render_views(outdir)
        info["renders"] = {k: os.path.relpath(v, BASE) for k, v in views.items()}
        sheet = comparison_sheet(views, os.path.join(outdir, "compare.png"))
        if sheet:
            info["comparison"] = os.path.relpath(sheet, BASE)

    with open(os.path.join(outdir, "import_report.json"), "w") as f:
        json.dump(info, f, indent=2)
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    main()
