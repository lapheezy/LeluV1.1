"""
LÉLU's rotating room — her Meshy furniture made fit for the app.

    blender -b --factory-startup --python lelu_room_pieces.py -- <job.json>
    job: {"source": "leluverse/assets/room/meshy", "output": "public/lelu-room", "report": "...json",
          "sheet": "...png" (optional orientation check, top + front),
          "pieces": {"bed": {"size": 2.4, "measure": "width", "yawDeg": 0, "tris": 30000, "texture": 1024}, ...}}

Each piece is joined, turned by `yawDeg` so its front faces +Z in three.js (-Y in Blender), scaled so
its `measure` (width | height | depth) is `size` metres, set with its base on the floor and centred,
decimated to about `tris` triangles, its textures resized to `texture` px, and exported as GLB (JPEG).
The room code places them; the sizes here are real metres.
"""
import hashlib
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
os.makedirs(job["output"], exist_ok=True)
report = {}
sheet_jobs = []
for name, spec in job["pieces"].items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(job["source"], name, "model.glb"))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for o in bpy.data.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for o in list(bpy.data.objects):
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    ob.data.transform(ob.matrix_world)
    ob.matrix_world.identity()
    ob.data.transform(Matrix.Rotation(math.radians(float(spec.get("yawDeg", 0))), 4, "Z"))
    vs = [v.co for v in ob.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    ext = hi - lo
    measure = spec.get("measure", "width")
    current = {"width": ext.x, "depth": ext.y, "height": ext.z}[measure]
    s = float(spec["size"]) / current
    ob.data.transform(Matrix.Diagonal((s, s, s, 1)) @ Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    tris0 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    target = int(spec.get("tris", 25000))
    if tris0 > target:
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.ratio = target / tris0
        bpy.ops.object.modifier_apply(modifier=mod.name)
    tex = int(spec.get("texture", 1024))
    for m in ob.data.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and max(n.image.size) > tex:
                    n.image.scale(tex, tex)
    ob.name = ob.data.name = f"room_{name}"
    out = os.path.join(job["output"], f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85,
                              export_animations=False, export_skins=False, export_morph=False)
    vs = [v.co for v in ob.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    report[name] = {"sizeM": [round(x, 3) for x in (hi - lo)], "triangles": sum(len(p.vertices) - 2 for p in ob.data.polygons),
                    "sourceTriangles": tris0, "bytes": os.path.getsize(out), "sha256": hashlib.sha256(open(out, "rb").read()).hexdigest()}
    print("ROOM_PIECE", name, json.dumps(report[name]))

json.dump(report, open(job["report"], "w"), indent=1)

if job.get("sheet"):
    # orientation check: every piece from the top (front = down in the image) and from the front
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    names = list(job["pieces"])
    for i, name in enumerate(names):
        bpy.ops.import_scene.gltf(filepath=os.path.join(job["output"], f"{name}.glb"))
        for o in bpy.context.selected_objects:
            o.location.x += (i % 6) * 5.0
            o.location.y += (i // 6) * -5.0
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 6
    sc.cycles.use_denoising = False
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.2
    cam = bpy.data.objects.new("c", bpy.data.cameras.new("c"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 31
    sc.render.resolution_x, sc.render.resolution_y = 1200, 420
    cam.location = (12.5, -2.5 - 40, 1.5)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.render.filepath = job["sheet"].replace(".png", "-front.png")
    bpy.ops.render.render(write_still=True)
    sc.render.resolution_x, sc.render.resolution_y = 1200, 420
    cam.location = (12.5, -2.5, 40)
    cam.rotation_euler = (0, 0, 0)
    sc.render.filepath = job["sheet"].replace(".png", "-top.png")
    bpy.ops.render.render(write_still=True)
