"""
==========================================================
LÉLU 3D FORGE — OLD-HAIR REMOVAL (headless)

After a head swap the body still carries its own, coarse
hair, fused into one piece with the torso and clothes, so it
cannot be cut by geometry or bone weights alone. This finds
it the way a person would — by looking:

  1. render the whole character (new head included, so it
     reads as a person) from several directions,
     orthographically, so each pixel maps to a known place
  2. MediaPipe's hair segmenter marks hair pixels in each
     view
  3. every body vertex visible in a view (nothing between it
     and the camera) takes that view's verdict; a vertex the
     views call hair is old hair
  4. only body vertices are removed, only between hip and
     choker height, never the new head's hair (another mesh)
  5. renders after removal for review

  Models (not committed; download once):
    https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite  (hairIndex 1)
    https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite  (needs a visible face)
  Status: partial — removes some old hair on the back; misses curls over the shoulders.

  python lelu_hairclean.py -- '{"model": ".../lelu.glb",
     "segmenter": ".../hair_segmenter.tflite",
     "out": ".../lelu_clean.glb", "previewDir": "...",
     "zMin": 0.85, "vote": 0.6}'
==========================================================
"""

import json
import math
import os
import sys

import bpy  # noqa: I001 — must load before bmesh/mathutils outside Blender
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

A = json.loads(sys.argv[sys.argv.index("--") + 1])
REPORT = {"steps": [], "warnings": []}
os.makedirs(A["previewDir"], exist_ok=True)


def log(step, **data):
    REPORT["steps"].append({"step": step, **data})
    print(f"[lelu-hairclean] {step} {json.dumps(data)}", flush=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=A["model"])
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.parent is None and len(o.vertex_groups) == 0 and any(x.type == "ARMATURE" for x in bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            o.data.pose_position = "REST"
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    body = max((o for o in meshes if not o.name.startswith(("lelu_head", "eye_patch"))), key=lambda o: len(o.data.vertices))
    bpy.context.view_layer.update()

    # One ray tree over everything visible, in world space.
    all_v, all_f, owner = [], [], []
    for o in meshes:
        base = len(all_v)
        mw = o.matrix_world
        all_v.extend(tuple(mw @ v.co) for v in o.data.vertices)
        all_f.extend(tuple(base + i for i in p.vertices) for p in o.data.polygons)
    bvh = BVHTree.FromPolygons(all_v, all_f)
    mw = body.matrix_world
    pos = np.array([tuple(mw @ v.co) for v in body.data.vertices])
    cut = float(A.get("zMax", pos[:, 2].max()))
    zone = (pos[:, 2] > float(A.get("zMin", 0.85))) & (pos[:, 2] < cut)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 24
    size = 768
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.85, 0.85, 0.85)
    for e, rz, en in ((45, -30, 2.5), (45, 150, 2.0), (80, 0, 1.0)):
        light = bpy.data.objects.new("l", bpy.data.lights.new("l", "SUN"))
        light.data.energy = en
        light.rotation_euler = (math.radians(e), 0, math.radians(rz))
        sc.collection.objects.link(light)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    width = float(A.get("width", 1.15))
    centre = Vector((0.0, 0.0, float(A.get("centreZ", 1.3))))

    seg = vision.ImageSegmenter.create_from_options(
        vision.ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=A["segmenter"]), output_category_mask=True, output_confidence_masks=True)
    )
    votes = np.zeros(len(pos))
    seen = np.zeros(len(pos))
    views = [(math.radians(a), 0.0) for a in range(0, 360, 45)]
    for k, (yaw, _) in enumerate(views):
        d = Vector((math.sin(yaw), -math.cos(yaw), 0.0))  # from the subject towards the camera
        cam.location = centre + d * 3.0
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        cam.data.ortho_scale = width
        path = os.path.join(A["previewDir"], f"hairclean_view{k}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        result = seg.segment(mp.Image.create_from_file(path))
        # Hair category: the last mask of the hair segmenter, index 1 of the multiclass one.
        conf = result.confidence_masks[int(A.get("hairIndex", -1))].numpy_view()
        if conf.ndim == 3:
            conf = conf[..., 0]
        right = d.cross(Vector((0, 0, 1))).normalized() * -1
        up = Vector((0, 0, 1))
        idx = np.where(zone)[0]
        for i in idx:
            p = Vector(pos[i])
            rel = p - centre
            u = rel.dot(right) / width * size + size / 2
            v = size / 2 - rel.dot(up) / width * size
            if not (0 <= u < size and 0 <= v < size):
                continue
            hit = bvh.ray_cast(p + d * 0.002, d, 10.0)
            if hit[0] is not None:
                continue  # something is in front of it in this view
            seen[i] += 1
            votes[i] += float(conf[int(v), int(u)])
        log("view", index=k, yawDeg=round(math.degrees(yaw)), hairPixels=int((conf > 0.5).sum()))
    seg.close()

    share = np.where(seen > 0, votes / np.maximum(seen, 1), 0)
    hair = zone & (seen > 0) & (share > float(A.get("vote", 0.6)))
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    doomed = [bm.verts[i] for i in np.where(hair)[0]]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    log("removed", vertices=len(doomed), zoneVertices=int(zone.sum()), visibleInZone=int((zone & (seen > 0)).sum()))

    for name, yaw in (("front", 0), ("back", 180), ("three_quarter", -40)):
        d = Vector((math.sin(math.radians(yaw)), -math.cos(math.radians(yaw)), 0.0))
        cam.data.type = "PERSP"
        cam.data.lens = 50
        cam.location = centre + d * 2.4
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(A["previewDir"], f"hairclean_after_{name}.png")
        bpy.ops.render.render(write_still=True)

    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            o.data.pose_position = "POSE"
    for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.export_scene.gltf(filepath=A["out"], export_format="GLB", export_skins=True, export_animations=True, export_yup=True, export_image_format="JPEG", export_jpeg_quality=92)
    log("export", file=os.path.basename(A["out"]), bytes=os.path.getsize(A["out"]))
    with open(A["out"] + ".report.json", "w") as fh:
        json.dump(REPORT, fh, indent=2)


main()
