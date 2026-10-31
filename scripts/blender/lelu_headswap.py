"""
==========================================================
LÉLU 3D FORGE — BLENDER HEAD SWAP (headless)

A full-body Meshy model spends its polygon and texture budget
on the whole figure, so the face gets a few dozen triangles
and ~100 px of texture. A head-and-shoulders model generated
from the face references gets all of it. This puts that head
on the rigged body:

  fit     similarity transform (scale, rotation, translation)
          of the new head's face onto the body's face: start
          from the nose tips and the throat, then refine with
          ICP (nearest points + Umeyama) on the front of the
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

import bmesh
import bpy
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


def face_landmarks(points, z_lo, z_hi, cx, width):
    prof = profile(points, cx, z_lo, z_hi, width)
    if len(prof) < 20:
        raise RuntimeError("face profile too sparse")
    nose = prof[np.argmin(prof[:, 1])]
    below = prof[prof[:, 2] < nose[2]]
    # Throat: the deepest point of the front profile below the chin (largest y),
    # searched within 1.2 nose-heights of the nose.
    span = (z_hi - z_lo)
    window = below[below[:, 2] > nose[2] - 0.45 * span]
    throat = window[np.argmax(window[:, 1])]
    return nose, throat, prof


def umeyama(src, dst):
    """Similarity transform (s, R, t) minimising |s R src + t - dst|."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    xs, xd = src - mu_s, dst - mu_d
    cov = xd.T @ xs / len(src)
    u, d, vt = np.linalg.svd(cov)
    sgn = np.eye(3)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        sgn[2, 2] = -1
    r = u @ sgn @ vt
    var = (xs ** 2).sum() / len(src)
    s = np.trace(np.diag(d) @ sgn) / var
    t = mu_d - s * r @ mu_s
    return s, r, t


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
    b_nose, b_throat, _ = face_landmarks(bp, neck_z, top_z, b_cx, 0.012)
    log("body", nose=b_nose.round(4).tolist(), throat=b_throat.round(4).tolist(), neckZ=round(neck_z, 4), headZ=round(head_z, 4))

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
    # The face sits in the upper part of a bust; search its upper 70 %.
    h_nose, h_throat, _ = face_landmarks(hp, lo[2] + 0.3 * h_span, hi[2], h_cx, 0.012 * h_span / 0.6)
    log("head", vertices=len(hp), triangles=sum(len(p.vertices) - 2 for p in head.data.polygons), bbox=[lo.round(3).tolist(), hi.round(3).tolist()],
        nose=h_nose.round(4).tolist(), throat=h_throat.round(4).tolist())

    # Initial fit: nose tips coincide, nose-to-throat height matches.
    s0 = (b_nose[2] - b_throat[2]) / max(1e-6, (h_nose[2] - h_throat[2]))
    R = np.eye(3)
    t = b_nose - s0 * h_nose
    s = s0

    # ICP on the front of the face (between throat and brow, facing the camera).
    face_h = (h_nose[2] - h_throat[2])
    hsel = hp[(hp[:, 2] > h_throat[2]) & (hp[:, 2] < h_nose[2] + 1.0 * face_h) & (hp[:, 1] < h_nose[1] + 0.9 * face_h) & (np.abs(hp[:, 0] - h_cx) < 0.9 * face_h)]
    if len(hsel) > 4000:
        hsel = hsel[np.random.default_rng(7).choice(len(hsel), 4000, replace=False)]
    bsel = bp[(bp[:, 2] > b_throat[2] - 0.01) & (bp[:, 2] < top_z) & (bp[:, 1] < b_nose[1] + 0.07)]
    kd = KDTree(len(bsel))
    for i, p in enumerate(bsel):
        kd.insert(Vector(p), i)
    kd.balance()
    err = None
    for it in range(40):
        moved = (s * (R @ hsel.T)).T + t
        pairs = [kd.find(Vector(p)) for p in moved]
        dist = np.array([d for _, _, d in pairs])
        keep = dist < np.percentile(dist, 80)
        tgt = np.array([tuple(c) for c, _, _ in pairs])
        s, R, t = umeyama(hsel[keep], tgt[keep])
        # The head must stay upright and facing forward: reject a fit that rolls it.
        err = float(np.sqrt((dist[keep] ** 2).mean()))
    angle = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(R) - 1) / 2))))
    if angle > 12 or not (0.5 * s0 < s < 2 * s0):
        REPORT["warnings"].append(f"ICP drifted (rotation {angle:.1f}°, scale {s:.3f} vs {s0:.3f}); using the landmark fit.")
        s, R, t = s0, np.eye(3), b_nose - s0 * h_nose
    log("fit", scale=round(float(s), 5), landmarkScale=round(float(s0), 5), rotationDeg=round(angle, 2), rmsMetres=round(err or 0, 5))

    M = Matrix(((*(s * R[0]), t[0]), (*(s * R[1]), t[1]), (*(s * R[2]), t[2]), (0, 0, 0, 1)))
    head.data.transform(M)
    head.data.update()
    hp = wverts(head)

    # Cut line: just under the jaw, above the choker's lower edge.
    cut_z = float(b_throat[2] - 0.012)
    neck_r = 0.075

    # Body: drop its own head (anything above the cut within the head's footprint).
    bm = bmesh.new()
    bm.from_mesh(body.data)
    head_kd = KDTree(len(hp))
    for i, p in enumerate(hp[:: max(1, len(hp) // 60000)]):
        head_kd.insert(Vector(p), i)
    head_kd.balance()
    doomed = []
    for v in bm.verts:
        w = body.matrix_world @ v.co
        if w.z > cut_z:
            near = head_kd.find(w)[2]
            inside_neck = math.hypot(w.x - b_cx, w.y - bones["head"].y) < neck_r * 1.6
            if inside_neck or near < 0.03 or w.z > head_z:
                doomed.append(v)
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    log("cut-body", removedVertices=len(doomed), cutZ=round(cut_z, 4))

    # Head: drop the bust below the cut, except hair hanging beside the neck.
    bm = bmesh.new()
    bm.from_mesh(head.data)
    hx, hy = b_cx, float(bones["head"].y)
    doomed = [v for v in bm.verts if v.co.z < cut_z - 0.004 and (math.hypot(v.co.x - hx, v.co.y - hy) < neck_r * 1.25 or v.co.z < cut_z - 0.18)]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(head.data)
    bm.free()
    log("cut-head", removedVertices=len(doomed), keptVertices=len(head.data.vertices))

    # Bind to the rig.
    head.name = "lelu_head"
    head.parent = armature
    head.matrix_parent_inverse = armature.matrix_world.inverted()
    vg_head = head.vertex_groups.new(name=next(b.name for b in armature.data.bones if b.name.lower() == "head"))
    vg_neck = head.vertex_groups.new(name=next(b.name for b in armature.data.bones if b.name.lower() == "neck"))
    for v in head.data.vertices:
        z = v.co.z
        t_ = min(1.0, max(0.0, (z - cut_z) / max(1e-6, head_z + 0.02 - cut_z)))
        t_ = t_ * t_ * (3 - 2 * t_)
        if math.hypot(v.co.x - hx, v.co.y - hy) > neck_r * 1.25:
            t_ = 1.0  # hair beside the neck follows the head
        if t_ > 0:
            vg_head.add([v.index], t_, "REPLACE")
        if t_ < 1:
            vg_neck.add([v.index], 1 - t_, "REPLACE")
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
