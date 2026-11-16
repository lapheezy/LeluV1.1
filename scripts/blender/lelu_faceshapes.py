"""
==========================================================
LÉLU 3D FORGE — FACE SHAPES (headless)

Gives her face the controls a Meshy rig does not have: ARKit-named
shape keys, built on HER head from HER landmarks, so blinking,
expressions and a speaking mouth play on the model itself.

  1. render the face straight on (orthographic: every pixel maps to a
     known world x/z) and find the 478 MediaPipe landmarks in it
  2. read her lid lines, brows, lip lines and lip corners from them
  3. build each shape as a smooth displacement field around those
     features, on the head mesh and on the eye patches:
        eyeBlinkLeft/Right   upper lid down onto the lower lid, eye patch
                             closed onto the lid line
        eyeWideLeft/Right    upper lid lifted
        jawOpen              lower lip and chin drop (speech)
        mouthSmileLeft/Right lip corners up and out, cheek lifted
        mouthFrownLeft/Right lip corners down
        browInnerUp          inner brows raised
        browDownLeft/Right   brows lowered and drawn in
     Left/Right are HER left and right (ARKit convention).
  4. render a preview of every shape at full strength, export the GLB
     with the shape keys as morph targets (sparse: only moved vertices)

  The face is one closed surface, so a jaw that only moves vertices
  stretches the lips into a pout. Before the shapes are built, the lip
  line is opened by a hairline seam (it reads as the line between closed
  lips) and a mouth — dark cavity, a hint of upper teeth — is placed
  behind it on the head bone, so jawOpen shows a real open mouth.

  python lelu_faceshapes.py -- '{"model": ".../lelu.glb", "out": ".../lelu_shapes.glb",
     "previewDir": "...", "landmarker": ".../face_landmarker.task", "object": "lelu_head"}'
==========================================================
"""

import json
import math
import os
import sys

import bpy  # noqa: I001 — must load before mathutils outside Blender
import bmesh
import numpy as np
from mathutils import Vector

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

A = json.loads(sys.argv[sys.argv.index("--") + 1])
REPORT = {"steps": [], "warnings": [], "shapes": {}}
os.makedirs(A["previewDir"], exist_ok=True)

# MediaPipe landmark indices. "R" = her right (image left), "L" = her left.
EYE = {
    "R": {"upper": [33, 246, 161, 160, 159, 158, 157, 173, 133], "lower": [33, 7, 163, 144, 145, 153, 154, 155, 133]},
    "L": {"upper": [263, 466, 388, 387, 386, 385, 384, 398, 362], "lower": [263, 249, 390, 373, 374, 380, 381, 382, 362]},
}
BROW = {"R": [70, 63, 105, 66, 107], "L": [300, 293, 334, 296, 336]}  # outer → inner
INNER_BROW = {"R": 107, "L": 336}
LIP_CORNER = {"R": 61, "L": 291}
UPPER_LIP_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]
LOWER_LIP_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
LOWER_LIP_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
CHIN = 152


def log(step, **data):
    REPORT["steps"].append({"step": step, **data})
    print(f"[lelu-faceshapes] {step} {json.dumps(data)}", flush=True)


def smooth(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def setup_render(size):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 24
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.32, 0.3, 0.34)
    for e, rz, en in ((50, -25, 2.2), (65, 30, 1.0)):
        light = bpy.data.objects.new("l", bpy.data.lights.new("l", "SUN"))
        light.data.energy = en
        light.rotation_euler = (math.radians(e), 0, math.radians(rz))
        sc.collection.objects.link(light)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def render(sc, cam, path, centre, width):
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = width
    cam.location = Vector(centre) + Vector((0, -1, 0))
    cam.rotation_euler = (Vector(centre) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def curve(points):
    """A lid / lip line as z(x): sorted by x, interpolated."""
    p = points[np.argsort(points[:, 0])]
    return lambda x: np.interp(x, p[:, 0], p[:, 1])


def open_mouth(head, W, face_w):
    """Open the lip line and put a mouth behind it (see the module note)."""
    ui, li = curve(W[UPPER_LIP_INNER]), curve(W[LOWER_LIP_INNER])
    xr, xl = W[LIP_CORNER["R"]][0], W[LIP_CORNER["L"]][0]
    inset = 0.06 * (xl - xr)
    mw = head.matrix_world
    bm = bmesh.new()
    bm.from_mesh(head.data)
    bm.faces.ensure_lookup_table()
    front = min((mw @ v.co).y for v in bm.verts)
    # The lips are a few large triangles: refine them first, so the seam
    # follows her lip line instead of zig-zagging across triangles.
    lip_faces = []
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        if xr - 0.1 * face_w < c.x < xl + 0.1 * face_w and c.y < front + 0.05:
            seam = (ui(c.x) + li(c.x)) / 2
            if abs(c.z - seam) < 0.3 * face_w:
                lip_faces.append(f)
    edges = list({e for f in lip_faces for e in f.edges})
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=3, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.faces.ensure_lookup_table()
    cut = []
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        if not (xr + inset < c.x < xl - inset) or c.y > front + 0.05:
            continue
        seam = (ui(c.x) + li(c.x)) / 2
        half = max(0.00035, 0.5 * (ui(c.x) - li(c.x)))
        if abs(c.z - seam) < half:
            cut.append(f)
    bmesh.ops.delete(bm, geom=cut, context="FACES_ONLY")
    bm.to_mesh(head.data)
    bm.free()
    log("lip-seam", facesRemoved=len(cut))

    hverts = np.array([tuple(mw @ v.co) for v in head.data.vertices])

    def surface_y(x, z):
        near = hverts[(np.abs(hverts[:, 0] - x) < 0.002) & (np.abs(hverts[:, 2] - z) < 0.003)]
        return float(near[:, 1].min()) if len(near) else float(hverts[:, 1].min())

    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")

    def plate(name, colour, top, bottom, depth, width_frac, rows=6):
        mx = (xr + xl) / 2
        half_w = (xl - xr) / 2 * width_frac
        cols = np.linspace(mx - half_w, mx + half_w, 24)
        verts, faces = [], []
        for j in range(rows + 1):
            for x in cols:
                seam = (ui(x) + li(x)) / 2
                z = seam + top - (top - bottom) * j / rows
                # Behind the face at THIS height: her lips stand further forward than her chin.
                verts.append((float(x), surface_y(x, z) + depth, float(z)))
        n = len(cols)
        for j in range(rows):
            for i in range(n - 1):
                a = j * n + i
                faces.append((a, a + 1, a + n + 1, a + n))
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*colour, 1)
        bsdf.inputs["Roughness"].default_value = 0.6
        me.materials.append(mat)
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        # Rigid on her head bone, like the face around it.
        obj.parent = arm
        obj.matrix_parent_inverse = arm.matrix_world.inverted()
        group = obj.vertex_groups.new(name="Head")
        group.add(list(range(len(verts))), 1.0, "REPLACE")
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        return obj

    plate("lelu_mouth", (0.07, 0.014, 0.02), 0.18 * face_w, -0.32 * face_w, 0.003, 0.92, rows=8)
    plate("lelu_teeth", (0.66, 0.6, 0.54), -0.005 * face_w, -0.065 * face_w, 0.0016, 0.42, rows=2)
    log("mouth", parts=["lelu_mouth", "lelu_teeth"])


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=A["model"])
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            o.data.pose_position = "REST"
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    head = next((o for o in meshes if o.name.startswith(A.get("object", "lelu_head"))), None)
    if head is None:
        raise SystemExit("No head mesh (lelu_head) in the model.")
    patches = [o for o in meshes if o.name.startswith("eye_patch")]
    targets = [head, *patches]
    log("meshes", head=head.name, patches=[p.name for p in patches])

    hpos = np.array([tuple(head.matrix_world @ v.co) for v in head.data.vertices])
    top = hpos[:, 2].max()
    upper = hpos[hpos[:, 2] > top - 0.33]
    cx = float(np.median(upper[:, 0]))
    cz = float(top - 0.17)
    width = 0.30
    size = 1024
    sc, cam = setup_render(size)
    front = os.path.join(A["previewDir"], "faceshapes_neutral.png")
    front_y = float(hpos[:, 1].min())
    render(sc, cam, front, (cx, front_y, cz), width)

    lm = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=A["landmarker"]), num_faces=1, min_face_detection_confidence=0.2, min_face_presence_confidence=0.2)
    )
    result = lm.detect(mp.Image.create_from_file(front))
    lm.close()
    if not result.face_landmarks:
        raise SystemExit("No face found in the front render.")
    px = np.array([[p.x * size, p.y * size] for p in result.face_landmarks[0]])
    # Pixel → world x/z (orthographic camera looking along +y).
    W = np.c_[cx + (px[:, 0] - size / 2) / size * width, cz - (px[:, 1] - size / 2) / size * width]
    log("landmarks", count=len(W))

    face_w = float(np.linalg.norm(W[LIP_CORNER["L"]] - W[LIP_CORNER["R"]]))  # mouth width, the scale for everything
    log("scale", mouthWidthM=round(face_w, 4))

    def field(name, pos):
        """World-space displacement (n×3) of the given world positions for one shape."""
        x, z = pos[:, 0], pos[:, 2]
        d = np.zeros_like(pos)
        if name.startswith("eyeBlink") or name.startswith("eyeWide"):
            side = "L" if name.endswith("Left") else "R"
            up = W[EYE[side]["upper"]]
            lo = W[EYE[side]["lower"]]
            U, L = curve(up), curve(lo)
            brow = W[BROW[side]]
            B = curve(brow)
            x0, x1 = up[:, 0].min(), up[:, 0].max()
            ew = x1 - x0
            # Horizontal weight: whole eye, fading past the corners.
            tx = smooth(1 - np.maximum(0, np.maximum(x0 - x, x - x1)) / (0.35 * ew))
            u, l_, b = U(np.clip(x, x0, x1)), L(np.clip(x, x0, x1)), B(np.clip(x, brow[:, 0].min(), brow[:, 0].max()))
            gap = np.maximum(u - l_, 1e-4)
            above = (z >= u) & (z <= b)
            s = (z - u) / np.maximum(b - u, 1e-4)
            if name.startswith("eyeBlink"):
                close_to = l_ + 0.12 * gap
                # Lid skin above the lid line slides down; less towards the brow.
                d[:, 2] += np.where(above, -(u - close_to) * (1 - smooth(s / 0.85)), 0) * tx
                # Inside the opening: closed onto the lid line.
                inside = (z < u) & (z >= l_ - 0.35 * gap)
                d[:, 2] += np.where(inside & (z >= l_), (close_to - z) * 0.92, 0) * tx
                # Lower lid rises a little to meet it.
                below = (z < l_) & (z >= l_ - 0.35 * gap)
                d[:, 2] += np.where(below, 0.1 * gap * (1 - (l_ - z) / (0.35 * gap)), 0) * tx
                # What moved into the opening comes forward over the eye patch.
                d[:, 1] += np.where(above | inside, -0.0012 * (1 - smooth(s)), 0) * tx
            else:
                d[:, 2] += np.where(above, 0.28 * gap * (1 - smooth(s / 0.7)), 0) * tx
            return d
        if name == "jawOpen":
            ui, li, lo_ = curve(W[UPPER_LIP_INNER]), curve(W[LOWER_LIP_INNER]), curve(W[LOWER_LIP_OUTER])
            xr, xl = W[LIP_CORNER["R"]][0], W[LIP_CORNER["L"]][0]
            mid = (xr + xl) / 2
            half = (xl - xr) / 2
            chin = W[CHIN][1]
            seam = (ui(np.clip(x, xr, xl)) + li(np.clip(x, xr, xl))) / 2
            # Strongest at the lips' centre, through the corners, gone at the cheeks.
            tx = smooth(1 - np.maximum(0, np.abs(x - mid) - 0.55 * half) / (0.9 * half))
            drop = 0.16 * face_w
            jaw = (z < seam) & (z > chin - 0.6 * face_w)
            tz = np.where(z >= chin, 1.0, smooth(1 - (chin - z) / (0.6 * face_w)))
            d[:, 2] += np.where(jaw, -drop * tz, 0) * tx
            # The upper lip lifts a touch.
            lip_up = (z >= seam) & (z < seam + 0.25 * face_w)
            d[:, 2] += np.where(lip_up, 0.12 * drop * (1 - (z - seam) / (0.25 * face_w)), 0) * tx
            return d
        if name.startswith("mouthSmile") or name.startswith("mouthFrown"):
            side = "L" if name.endswith("Left") else "R"
            c = W[LIP_CORNER[side]]
            outward = 1.0 if side == "L" else -1.0
            r = 0.45 * face_w
            dist = np.hypot(x - c[0], z - c[1])
            f = smooth(1 - dist / r) ** 1.5
            if name.startswith("mouthSmile"):
                d[:, 0] += outward * 0.07 * face_w * f
                d[:, 2] += 0.09 * face_w * f
                # The cheek lifts with it.
                eye_outer = W[EYE[side]["upper"][0]]
                cheek = (c + eye_outer) / 2
                fc = smooth(1 - np.hypot(x - cheek[0], z - cheek[1]) / (0.5 * face_w)) ** 2
                d[:, 2] += 0.035 * face_w * fc
                d[:, 1] += -0.02 * face_w * fc
            else:
                d[:, 2] += -0.08 * face_w * f
                d[:, 0] += -outward * 0.02 * face_w * f
            return d
        if name == "browInnerUp":
            for side in ("L", "R"):
                c = W[INNER_BROW[side]]
                f = smooth(1 - np.hypot(x - c[0], z - c[1]) / (0.4 * face_w)) ** 1.5
                d[:, 2] += 0.07 * face_w * f
            return d
        if name.startswith("browDown"):
            side = "L" if name.endswith("Left") else "R"
            c = W[BROW[side]].mean(0)
            inward = -1.0 if side == "L" else 1.0
            f = smooth(1 - np.hypot(x - c[0], z - c[1]) / (0.5 * face_w)) ** 1.5
            d[:, 2] += -0.06 * face_w * f
            d[:, 0] += inward * 0.025 * face_w * f
            return d
        raise ValueError(name)

    open_mouth(head, W, face_w)

    shapes = [
        "eyeBlinkLeft", "eyeBlinkRight", "eyeWideLeft", "eyeWideRight", "jawOpen",
        "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
        "browInnerUp", "browDownLeft", "browDownRight",
    ]
    for obj in targets:
        if obj.data.shape_keys is None:
            obj.shape_key_add(name="Basis", from_mix=False)
        mw = obj.matrix_world
        inv = mw.inverted().to_3x3()
        pos = np.array([tuple(mw @ v.co) for v in obj.data.vertices])
        for name in shapes:
            disp = field(name, pos)
            moved = int((np.linalg.norm(disp, axis=1) > 1e-5).sum())
            key = obj.shape_key_add(name=name, from_mix=False)
            for i, v in enumerate(obj.data.vertices):
                if moved and np.any(disp[i]):
                    key.data[i].co = v.co + inv @ Vector(disp[i])
            REPORT["shapes"].setdefault(name, {})[obj.name] = {
                "verticesMoved": moved,
                "maxMm": round(float(np.linalg.norm(disp, axis=1).max()) * 1000, 2),
            }
    log("shapes", shapes=REPORT["shapes"])

    # A preview of each shape (and a full blink + smile together), straight on.
    for name in shapes + ["__blink_smile"]:
        for obj in targets:
            for kb in obj.data.shape_keys.key_blocks[1:]:
                kb.value = 1.0 if kb.name == name or (name == "__blink_smile" and kb.name in ("eyeBlinkLeft", "eyeBlinkRight", "mouthSmileLeft", "mouthSmileRight")) else 0.0
        render(sc, cam, os.path.join(A["previewDir"], f"faceshapes_{name.strip('_')}.png"), (cx, front_y, cz), width)
    for obj in targets:
        for kb in obj.data.shape_keys.key_blocks[1:]:
            kb.value = 0.0

    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            o.data.pose_position = "POSE"
    for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.export_scene.gltf(
        filepath=A["out"], export_format="GLB", export_skins=True, export_animations=True, export_morph=True,
        export_morph_normal=False, export_try_sparse_sk=True, export_yup=True, export_image_format="JPEG", export_jpeg_quality=92,
    )
    log("export", file=os.path.basename(A["out"]), bytes=os.path.getsize(A["out"]))
    with open(A["out"] + ".report.json", "w") as fh:
        json.dump(REPORT, fh, indent=2)


main()
