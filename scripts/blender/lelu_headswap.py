"""
==========================================================
LÉLU 3D FORGE — BLENDER HEAD SWAP (headless)

A full-body Meshy model spends its polygon and texture budget
on the whole figure, so the face gets a few dozen triangles
and ~100 px of texture. A head-and-shoulders model generated
from the face references gets all of it. This puts that head
on the rigged body:

  fit     scale + translation (kept upright, facing forward)
          of the new head's face onto the body's face: nose
          tips together, the scale whose face surfaces match
          best, then translation-only ICP on the front of the
          face only
  cut     the body loses everything of its own head above the
          choker line; the new head loses everything below it
          (hair hanging beside the neck is kept)
  bind    the new head is skinned to the body's armature:
          Head above the jaw, blending into neck at the cut,
          so it follows the rig's animation
  export  one GLB (body + head, skin and clips kept), textures
          limited to textureSize (JPEG)

  python lelu_headswap.py -- '{"body": ".../rigged.glb",
     "head": ".../model.glb", "out": ".../lelu_headswap.glb",
     "textureSize": 4096, "previewDir": "..."}'

Writes <out>.report.json with the fit error and what was cut.
==========================================================
"""

import json
import math
import os
import sys

import bpy  # noqa: I001 — must load before bmesh/mathutils outside Blender
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

A = json.loads(sys.argv[sys.argv.index("--") + 1])
REPORT = {"steps": [], "warnings": []}


def log(step, **data):
    REPORT["steps"].append({"step": step, **data})
    print(f"[lelu-headswap] {step} {json.dumps(data)}", flush=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def wverts(obj):
    mw = obj.matrix_world
    return np.array([tuple(mw @ v.co) for v in obj.data.vertices])


def profile(points, cx, z_lo, z_hi, width, step=0.002):
    """Frontmost point (min y; the character faces -y) per z slice of a centre column."""
    col = points[(np.abs(points[:, 0] - cx) < width) & (points[:, 2] > z_lo) & (points[:, 2] < z_hi)]
    out = {}
    for p in col:
        k = int((p[2] - z_lo) / step)
        if k not in out or p[1] < out[k][1]:
            out[k] = p
    return np.array([out[k] for k in sorted(out)])


def face_nose(points, z_lo, z_hi, cx, width):
    """The nose tip: the frontmost point of the face's centre column."""
    prof = profile(points, cx, z_lo, z_hi, width)
    if len(prof) < 20:
        raise RuntimeError("face profile too sparse")
    return prof[np.argmin(prof[:, 1])]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body_objs = import_glb(A["body"])
    armature = next(o for o in body_objs if o.type == "ARMATURE")
    for o in list(body_objs):
        if o.type == "MESH" and o.parent is None and len(o.vertex_groups) == 0:
            bpy.data.objects.remove(o, do_unlink=True)
    body = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()

    bones = {b.name.lower(): armature.matrix_world @ b.head_local for b in armature.data.bones}
    head_z, neck_z = bones["head"].z, bones["neck"].z
    top_z = bones.get("head_end", bones["head"] + Vector((0, 0, 0.25))).z
    bp = wverts(body)
    b_cx = float(bones["head"].x)
    b_nose = face_nose(bp, neck_z + 0.6 * (head_z - neck_z), top_z, b_cx, 0.012)
    log("body", nose=b_nose.round(4).tolist(), neckZ=round(neck_z, 4), headZ=round(head_z, 4), topZ=round(top_z, 4))

    head_objs = import_glb(A["head"])
    head_meshes = [o for o in head_objs if o.type == "MESH"]
    # Join the head's meshes into one object with transforms applied.
    for o in bpy.data.objects:
        o.select_set(False)
    for o in head_meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = head_meshes[0]
    if len(head_meshes) > 1:
        bpy.ops.object.join()
    head = bpy.context.view_layer.objects.active
    for o in head_objs:
        if o is not head and o.name in bpy.data.objects and o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    head.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    hp = wverts(head)
    lo, hi = hp.min(0), hp.max(0)
    h_cx = float((lo[0] + hi[0]) / 2)
    h_span = hi[2] - lo[2]
    # The face is in the top of a bust (the chest would otherwise be "frontmost").
    h_nose = face_nose(hp, hi[2] - 0.35 * h_span, hi[2], h_cx, 0.012 * h_span / 0.8)
    log("head", vertices=len(hp), triangles=sum(len(p.vertices) - 2 for p in head.data.polygons), bbox=[lo.round(3).tolist(), hi.round(3).tolist()],
        nose=h_nose.round(4).tolist())

    # Fit: nose tips coincide; the scale is the one where the two face surfaces
    # match best (symmetric nearest-point distance over the face, so neither can
    # "win" by shrinking); position refined by translation-only ICP so the head
    # stays upright and facing forward.
    s_est = (top_z - b_nose[2]) / max(1e-6, hi[2] - h_nose[2])
    R_FACE = 0.08
    rng = np.random.default_rng(7)

    def sample(points, n):
        return points if len(points) <= n else points[rng.choice(len(points), n, replace=False)]

    bface = sample(bp[(np.linalg.norm(bp - b_nose, axis=1) < R_FACE) & (bp[:, 1] < b_nose[1] + 0.05)], 3000)
    kd_b = KDTree(len(bface))
    for i, p in enumerate(bface):
        kd_b.insert(Vector(p), i)
    kd_b.balance()
    best = None
    for s in np.linspace(0.7 * s_est, 1.4 * s_est, 36):
        hface = sample(hp[(np.linalg.norm(hp - h_nose, axis=1) < R_FACE / s) & (hp[:, 1] < h_nose[1] + 0.05 / s)], 3000)
        t = b_nose - s * h_nose
        for _ in range(10):
            moved = s * hface + t
            near = np.array([tuple(kd_b.find(Vector(p))[0]) for p in moved])
            d = np.linalg.norm(near - moved, axis=1)
            keep = d < np.percentile(d, 80)
            t = t + (near[keep] - moved[keep]).mean(0)
        moved = s * hface + t
        fwd = np.array([kd_b.find(Vector(p))[2] for p in moved])
        kd_h = KDTree(len(moved))
        for i, p in enumerate(moved):
            kd_h.insert(Vector(p), i)
        kd_h.balance()
        back = np.array([kd_h.find(Vector(p))[2] for p in bface])
        err = float((np.sqrt((np.sort(fwd)[: int(0.8 * len(fwd))] ** 2).mean()) + np.sqrt((np.sort(back)[: int(0.8 * len(back))] ** 2).mean())) / 2)
        if best is None or err < best[0]:
            best = (err, float(s), t)
    err, s, t = best
    if abs(s - 0.7 * s_est) < 1e-9 or abs(s - 1.4 * s_est) < 1e-9:
        REPORT["warnings"].append(f"Best scale {s:.4f} is at the edge of the search ({s_est:.4f} ±); check the previews.")
    log("fit", scale=round(s, 5), estimate=round(float(s_est), 5), rmsMetres=round(err, 5), offset=np.round(t, 4).tolist())

    M = Matrix(((s, 0, 0, t[0]), (0, s, 0, t[1]), (0, 0, s, t[2]), (0, 0, 0, 1)))
    head.data.transform(M)
    head.data.update()
    hp = wverts(head)

    # Cut line: in the choker, which both models wear, between the neck and Head bones.
    cut_z = float(neck_z + 0.85 * (head_z - neck_z))
    neck_r = 0.075

    # Body: drop its own head (anything above the cut within the head's footprint).
    bm = bmesh.new()
    bm.from_mesh(body.data)
    head_kd = KDTree(len(hp))
    for i, p in enumerate(hp[:: max(1, len(hp) // 60000)]):
        head_kd.insert(Vector(p), i)
    head_kd.balance()
    # The old head's hair hangs below the cut; in a Meshy rig it is skinned mostly to Head.
    head_gi = next(g.index for g in body.vertex_groups if g.name.lower() == "head")
    deform = bm.verts.layers.deform.verify()
    doomed = []
    old_hair = 0
    for v in bm.verts:
        w = body.matrix_world @ v.co
        if w.z <= cut_z and v[deform].get(head_gi, 0.0) > 0.5 and math.hypot(w.x - b_cx, w.y - bones["head"].y) > neck_r * 1.25:
            doomed.append(v)
            old_hair += 1
            continue
        if w.z > cut_z:
            near = head_kd.find(w)[2]
            inside_neck = math.hypot(w.x - b_cx, w.y - bones["head"].y) < neck_r * 1.6
            if inside_neck or near < 0.03 or w.z > head_z:
                doomed.append(v)
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    log("cut-body", removedVertices=len(doomed), oldHairBelowCut=old_hair, cutZ=round(cut_z, 4))

    # Head: below the cut, keep only what hangs away from the body (her long hair);
    # drop what lies on the torso (the bust's own shoulders, chest and outfit).
    body_w = wverts(body)
    body_kd = KDTree(len(body_w))
    for i, p in enumerate(body_w):
        body_kd.insert(Vector(p), i)
    body_kd.balance()
    hair_gap = float(A.get("hairGap", 0.02))
    bm = bmesh.new()
    bm.from_mesh(head.data)
    hx, hy = b_cx, float(bones["head"].y)
    doomed = [v for v in bm.verts if v.co.z < cut_z - 0.004 and (v.co.z < cut_z - 0.55 or body_kd.find(v.co)[2] < hair_gap)]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(head.data)
    bm.free()
    hanging = sum(1 for v in head.data.vertices if v.co.z < cut_z - 0.004)
    log("cut-head", removedVertices=len(doomed), keptVertices=len(head.data.vertices), hangingHairVertices=hanging, hairGap=hair_gap)

    # Bind to the rig: the head blends from neck to Head across the choker; hair
    # hanging below the cut copies the weights of the nearest body point, so it
    # moves with her shoulders and back.
    head.name = "lelu_head"
    head.parent = armature
    head.matrix_parent_inverse = armature.matrix_world.inverted()
    bone_name = {b.name.lower(): b.name for b in armature.data.bones}
    groups = {}

    def group(name):
        if name not in groups:
            groups[name] = head.vertex_groups.get(name) or head.vertex_groups.new(name=name)
        return groups[name]

    body_groups = {g.index: g.name for g in body.vertex_groups}
    for v in head.data.vertices:
        z = v.co.z
        if z < cut_z - 0.004:
            _, j, _ = body_kd.find(v.co)
            for g in body.data.vertices[j].groups:
                if g.weight > 0:
                    group(body_groups[g.group]).add([v.index], g.weight, "REPLACE")
            continue
        t_ = min(1.0, max(0.0, (z - cut_z) / max(1e-6, head_z + 0.02 - cut_z)))
        t_ = t_ * t_ * (3 - 2 * t_)
        if math.hypot(v.co.x - hx, v.co.y - hy) > neck_r * 1.25:
            t_ = 1.0  # hair beside the head follows the head
        if t_ > 0:
            group(bone_name["head"]).add([v.index], t_, "REPLACE")
        if t_ < 1:
            group(bone_name["neck"]).add([v.index], 1 - t_, "REPLACE")
    mod = head.modifiers.new("Armature", "ARMATURE")
    mod.object = armature
    armature.data.pose_position = "POSE"

    size = int(A.get("textureSize", 4096))
    scaled = []
    for img in bpy.data.images:
        if max(img.size) > size:
            f = size / max(img.size)
            scaled.append([img.name, list(img.size)])
            img.scale(int(img.size[0] * f), int(img.size[1] * f))
    log("textures", scaled=scaled, limit=size)

    bpy.ops.export_scene.gltf(
        filepath=A["out"], export_format="GLB", export_skins=True, export_animations=True, export_yup=True,
        export_image_format="JPEG", export_jpeg_quality=int(A.get("jpegQuality", 90)),
    )
    log("export", file=os.path.basename(A["out"]), bytes=os.path.getsize(A["out"]))

    if A.get("previewDir"):
        os.makedirs(A["previewDir"], exist_ok=True)
        armature.data.pose_position = "REST"
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = 48
        sc.render.resolution_x = 768
        sc.render.resolution_y = 768
        sc.world = bpy.data.worlds.new("w")
        sc.world.color = (0.32, 0.3, 0.34)
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
        sc.camera = cam
        for e, rz, en in ((50, -25, 2.2), (65, 30, 1.0), (20, 180, 0.8)):
            light = bpy.data.objects.new("l", bpy.data.lights.new("l", "SUN"))
            light.data.energy = en
            light.rotation_euler = (math.radians(e), 0, math.radians(rz))
            sc.collection.objects.link(light)
        shots = {
            "face_front": (Vector((b_cx, b_nose[1], b_nose[2] + 0.015)), Vector((0, -1, 0)), 0.9, 85),
            "face_three_quarter": (Vector((b_cx, b_nose[1], b_nose[2] + 0.015)), Vector((-0.6, -0.8, 0)), 0.9, 85),
            "bust": (Vector((b_cx, b_nose[1], b_nose[2] - 0.12)), Vector((0, -1, 0)), 1.6, 70),
            "body": (Vector((0, 0, 0.88)), Vector((0, -1, 0)), 6.0, 50),
        }
        for name, (target, direction, dist, lens) in shots.items():
            cam.data.lens = lens
            cam.location = target + direction.normalized() * dist
            cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(A["previewDir"], f"preview_{name}.png")
            bpy.ops.render.render(write_still=True)
        log("previews", dir=A["previewDir"])

    with open(A["out"] + ".report.json", "w") as fh:
        json.dump(REPORT, fh, indent=2)


main()
