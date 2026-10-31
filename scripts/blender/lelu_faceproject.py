"""
==========================================================
LÉLU 3D FORGE — FACE PROJECTION (headless)

Image-to-3D models approximate a painted face: the eyes come
back heavy-lidded, makeup softened. This paints the identity
reference itself (ref10) onto the model's face texture:

  1. render the model's face straight on (orthographic, so
     every pixel maps to a known x/z in the world)
  2. find the 478 MediaPipe face landmarks in that render
     and in the reference
  3. warp: each face vertex is located in the landmark
     triangulation of the render and carried to the same
     barycentric spot in the reference — eye corners land on
     eye corners, lip line on lip line
  4. rasterise the face triangles in the model's own UV
     layout and blend the reference colour into its base
     colour texture, inside the face oval only, feathered at
     the edge and faded on surfaces turning away from the
     front (no stretching on the sides of the face)
  5. export the GLB unchanged except for that texture, with
     before / after renders

  python lelu_faceproject.py -- '{"model": ".../lelu.glb",
     "reference": ".../ref10_face_primary.png",
     "landmarker": ".../face_landmarker.task",
     "out": ".../lelu_face.glb", "previewDir": "...",
     "object": "lelu_head", "feather": 0.18, "strength": 1.0}'
==========================================================
"""

import json
import math
import os
import sys

import bpy  # noqa: I001 — must load before bmesh/mathutils outside Blender
import numpy as np
from mathutils import Vector
from scipy.spatial import Delaunay

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

A = json.loads(sys.argv[sys.argv.index("--") + 1])
REPORT = {"steps": [], "warnings": []}
os.makedirs(A["previewDir"], exist_ok=True)

# MediaPipe face-oval landmark loop (outline of the face).
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]


def log(step, **data):
    REPORT["steps"].append({"step": step, **data})
    print(f"[lelu-faceproject] {step} {json.dumps(data)}", flush=True)


def landmarks(landmarker, path):
    image = mp.Image.create_from_file(path)
    result = landmarker.detect(image)
    if not result.face_landmarks:
        return None
    return np.array([[p.x * image.width, p.y * image.height] for p in result.face_landmarks[0]])


def setup_render(size):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 32
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


def render(sc, cam, path, centre, width, ortho=True, distance=1.0, direction=(0, -1, 0)):
    cam.data.type = "ORTHO" if ortho else "PERSP"
    cam.data.ortho_scale = width
    cam.data.lens = 85
    cam.location = Vector(centre) + Vector(direction).normalized() * distance
    cam.rotation_euler = (Vector(centre) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


EYES = (((33, 133), "eye_patch_r"), ((362, 263), "eye_patch_l"))


def eye_patches(head, pos, nrm, px, py, src, ref, tri, cx, cz, width, size, mw):
    """
    Image-to-3D sculpts lashes as fins standing off the lid and the eye as a dark
    recessed slit; both hide a painted eye. Over each eye: fit a smooth surface to
    the skin around it, lay a small patch on that surface textured directly with
    the reference's eye (warped through the landmarks, feathered at the edge), and
    delete the fins that stand in front of it. The patch rides the Head bone.
    """
    import bmesh

    ref_img = bpy.data.images.load(A["reference"], check_existing=True)
    RW, RH = ref_img.size
    rpx = np.array(ref_img.pixels[:], dtype=np.float32).reshape(RH, RW, 4)
    removed = 0
    made = []
    head_group = next((g.name for g in head.vertex_groups if g.name.lower() == "head"), None)
    for (a, b), name in EYES:
        c = (src[a] + src[b]) / 2
        ew = float(np.linalg.norm(src[a] - src[b]))
        rx, rz = 0.9 * ew, 0.7 * ew
        e = np.hypot((px - c[0]) / rx, (py - c[1]) / rz)
        front = nrm[:, 1] < 0.2
        near = (e < 1.8) & front
        face_front = np.percentile(pos[near, 1], 2) if near.any() else 0.0
        # Only the outer layer counts: the head shell also has surfaces deeper inside.
        ring = (e > 1.05) & (e < 1.8) & front & (pos[:, 1] < face_front + 0.02)
        if ring.sum() < 30:
            REPORT["warnings"].append(f"{name}: too few skin points around the eye; skipped.")
            continue
        D = lambda X, Z: np.c_[np.ones_like(X), X, Z, X * X, X * Z, Z * Z]
        X, Z, Y = pos[ring, 0], pos[ring, 2], pos[ring, 1]
        coef, *_ = np.linalg.lstsq(D(X, Z), Y, rcond=None)
        for _ in range(3):  # robust: ring points that are fins or hair do not shape the surface
            res = np.abs(D(X, Z) @ coef - Y)
            keep = res < 2.5 * np.median(res) + 1e-5
            coef, *_ = np.linalg.lstsq(D(X[keep], Z[keep]), Y[keep], rcond=None)
        surf = D(pos[:, 0], pos[:, 2]) @ coef

        # Delete what stands in front of that surface inside the eye (the lash fins).
        bm = bmesh.new()
        bm.from_mesh(head.data)
        bm.verts.ensure_lookup_table()
        doomed = [bm.verts[i] for i in np.where((e < 0.8) & (pos[:, 1] < surf - 0.0004) & (pos[:, 1] > surf - 0.025))[0]]
        removed += len(doomed)
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
        bm.to_mesh(head.data)
        bm.free()

        # The patch: a grid over the eye's ellipse, on the fitted surface, just in front of it.
        n_u, n_v = 28, 20
        us = np.linspace(-1.15, 1.15, n_u)
        vs = np.linspace(-1.15, 1.15, n_v)
        gu, gv = np.meshgrid(us, vs)
        gpx = c[0] + gu.ravel() * rx
        gpy = c[1] + gv.ravel() * rz
        gx = (gpx - size / 2) / size * width + cx
        gz = cz - (gpy - size / 2) / size * width
        gy = D(gx, gz) @ coef - 0.0012
        simplex = tri.find_simplex(np.stack([gpx, gpy], 1))
        if (simplex < 0).any():
            REPORT["warnings"].append(f"{name}: patch leaves the landmark mesh; skipped.")
            continue
        T = tri.transform[simplex]
        bb = np.einsum("ijk,ik->ij", T[:, :2], np.stack([gpx, gpy], 1) - T[:, 2])
        bary = np.c_[bb, 1 - bb.sum(1)]
        rxy = np.einsum("ij,ijk->ik", bary, ref[tri.simplices[simplex]])

        # Its texture: the reference's eye, cropped, alpha feathered to an ellipse.
        x0, y0 = np.floor(rxy.min(0)).astype(int)
        x1, y1 = np.ceil(rxy.max(0)).astype(int)
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(RW - 1, x1), min(RH - 1, y1)
        crop = rpx[RH - 1 - y1 : RH - y0, x0 : x1 + 1].copy()  # pixel rows are bottom-up
        ch, cw = crop.shape[:2]
        rc = (ref[a] + ref[b]) / 2
        rew = float(np.linalg.norm(ref[a] - ref[b]))
        yy, xx = np.mgrid[0:ch, 0:cw]
        img_y = y1 - yy  # back to top-down reference rows
        img_x = x0 + xx
        ee = np.hypot((img_x - rc[0]) / (0.9 * rew), (img_y - rc[1]) / (0.7 * rew))
        alpha = np.clip((1.0 - ee) / 0.18, 0, 1)  # solid over the deleted core (e < 0.8), feathered beyond
        crop[..., 3] = alpha * alpha * (3 - 2 * alpha)
        patch_img = bpy.data.images.new(f"{name}_tex", cw, ch, alpha=True)
        patch_img.pixels.foreach_set(crop.ravel())
        patch_img.pack()

        mesh = bpy.data.meshes.new(name)
        verts = [(float(gx[i]), float(gy[i]), float(gz[i])) for i in range(len(gx))]  # world space
        faces = []
        for j in range(n_v - 1):
            for i in range(n_u - 1):
                k = j * n_u + i
                faces.append((k, k + n_u, k + n_u + 1, k + 1))
        mesh.from_pydata(verts, [], faces)
        uv = mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                vi = mesh.loops[li].vertex_index
                uv.data[li].uv = ((rxy[vi, 0] - x0) / cw, (y1 - rxy[vi, 1]) / ch)
        # Faces must point at the viewer (-y).
        mesh.update()
        if mesh.polygons[0].normal.y > 0:
            for poly in mesh.polygons:
                poly.flip()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = head.parent
        if obj.parent is not None:
            obj.matrix_parent_inverse = obj.parent.matrix_world.inverted()  # keep the world-space vertices where they are
        if head_group and head.parent and head.parent.type == "ARMATURE":
            vg = obj.vertex_groups.new(name=head_group)
            vg.add(list(range(len(verts))), 1.0, "REPLACE")
            mod = obj.modifiers.new("Armature", "ARMATURE")
            mod.object = head.parent
        mat = bpy.data.materials.new(f"{name}_mat")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        texn = nt.nodes.new("ShaderNodeTexImage")
        texn.image = patch_img
        texn.extension = "CLIP"
        nt.links.new(texn.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(texn.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 0.85  # matte like the painted skin around it: no "glasses" sheen
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.15
        bsdf.inputs["Metallic"].default_value = 0.0
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
        if hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
        obj.data.materials.append(mat)
        made.append({"patch": name, "cropPx": [int(cw), int(ch)], "surfaceFitPoints": int(ring.sum())})
    log("eye-patches", patches=made, finVerticesRemoved=removed)


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
    head = next((o for o in meshes if o.name.startswith(A.get("object", "lelu_head"))), None) or max(meshes, key=lambda o: len(o.data.vertices))
    bpy.context.view_layer.update()


    em = head.data  # rest pose: the armature leaves it undeformed
    mw = head.matrix_world
    pos = np.array([tuple(mw @ v.co) for v in em.vertices])
    nrm = np.array([tuple((mw.to_3x3() @ v.normal).normalized()) for v in em.vertices])
    top = pos[:, 2].max()
    upper = pos[pos[:, 2] > top - 0.33]
    cx = float(np.median(upper[:, 0]))
    cz = float(top - 0.17)
    width = 0.30
    size = 1024
    sc, cam = setup_render(size)
    front_png = os.path.join(A["previewDir"], "faceproject_front_before.png")
    render(sc, cam, front_png, (cx, float(pos[:, 1].min()), cz), width)

    options = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=A["landmarker"]), num_faces=1, min_face_detection_confidence=0.2, min_face_presence_confidence=0.2)
    lm = vision.FaceLandmarker.create_from_options(options)
    src = landmarks(lm, front_png)
    ref = landmarks(lm, A["reference"])
    if src is None or ref is None:
        raise SystemExit(f"No face found in {'the render' if src is None else 'the reference'}.")
    log("landmarks", render=len(src), reference=len(ref))

    # World x/z → render pixel (orthographic, camera looks along +y).
    px = (pos[:, 0] - cx) / width * size + size / 2
    py = (cz - pos[:, 2]) / width * size + size / 2

    lm.close()
    tri = Delaunay(src)
    simplex = tri.find_simplex(np.stack([px, py], 1))
    inside = simplex >= 0
    # Barycentric warp into the reference.
    T = tri.transform[simplex[inside]]
    b = np.einsum("ijk,ik->ij", T[:, :2], np.stack([px, py], 1)[inside] - T[:, 2])
    bary = np.c_[b, 1 - b.sum(1)]
    corners = ref[tri.simplices[simplex[inside]]]
    ref_xy = np.full((len(pos), 2), np.nan)
    ref_xy[inside] = np.einsum("ij,ijk->ik", bary, corners)

    # Mask: inside the face oval, feathered towards it, faded where the surface turns away.
    oval = src[FACE_OVAL]
    centre = src[FACE_OVAL].mean(0)
    radius = np.linalg.norm(oval - centre, axis=1)
    ang_o = np.arctan2(oval[:, 1] - centre[1], oval[:, 0] - centre[0])
    order = np.argsort(ang_o)
    ang_o, radius = ang_o[order], radius[order]
    ang_v = np.arctan2(py - centre[1], px - centre[0])
    r_edge = np.interp(ang_v, np.r_[ang_o - 2 * np.pi, ang_o, ang_o + 2 * np.pi], np.r_[radius, radius, radius])
    rel = np.hypot(px - centre[0], py - centre[1]) / r_edge
    feather = float(A.get("feather", 0.18))
    m_oval = np.clip((1 - rel) / feather, 0, 1)
    m_oval = m_oval * m_oval * (3 - 2 * m_oval)
    facing = np.clip((-nrm[:, 1] - 0.25) / 0.45, 0, 1)
    mask = m_oval * facing * float(A.get("strength", 1.0))
    mask[~inside] = 0
    log("mask", vertices=int((mask > 0.01).sum()))

    # The base colour texture of the head's material.
    mat = head.active_material
    img = None
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            link = node.inputs["Base Color"].links
            if link and link[0].from_node.type == "TEX_IMAGE":
                img = link[0].from_node.image
    if img is None:
        raise SystemExit("No base colour texture on the head material.")
    W, H = img.size
    tex = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)  # bottom-up rows
    ref_img = bpy.data.images.load(A["reference"])
    RW, RH = ref_img.size
    ref_px = np.array(ref_img.pixels[:], dtype=np.float32).reshape(RH, RW, 4)
    # Blender stores pixels in scene-linear for sRGB images, same as the texture: blend in that space.

    uv_layer = em.uv_layers.active.data
    painted = 0
    acc = np.zeros((H, W, 3), dtype=np.float32)
    wsum = np.zeros((H, W), dtype=np.float32)
    for poly in em.polygons:
        vids = list(poly.vertices)
        if mask[vids].max() <= 0.01:
            continue
        loops = list(poly.loop_indices)
        for k in range(1, len(vids) - 1):
            ia, ib, ic = 0, k, k + 1
            vv = [vids[ia], vids[ib], vids[ic]]
            if np.isnan(ref_xy[vv]).any():
                continue
            uv = np.array([tuple(uv_layer[loops[i]].uv) for i in (ia, ib, ic)]) * [W, H]
            x0, y0 = np.floor(uv.min(0)).astype(int)
            x1, y1 = np.ceil(uv.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, W - 1), min(y1, H - 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            p = np.stack([gx.ravel(), gy.ravel()], 1)
            (ax, ay), (bx, by), (qx, qy) = uv
            den = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy)
            if abs(den) < 1e-12:
                continue
            l1 = ((by - qy) * (p[:, 0] - qx) + (qx - bx) * (p[:, 1] - qy)) / den
            l2 = ((qy - ay) * (p[:, 0] - qx) + (ax - qx) * (p[:, 1] - qy)) / den
            l3 = 1 - l1 - l2
            # Generous edge test so texels on shared edges are covered (no light cracks).
            tol = 1.5 / max(1.0, float(np.abs(den)) ** 0.5)
            ok = (l1 >= -tol) & (l2 >= -tol) & (l3 >= -tol)
            if not ok.any():
                continue
            L = np.clip(np.stack([l1[ok], l2[ok], l3[ok]], 1), 0, None)
            L /= L.sum(1, keepdims=True)
            rx = L @ ref_xy[vv, 0]
            ry = L @ ref_xy[vv, 1]
            mk = L @ mask[vv]
            sx = np.clip(rx, 0, RW - 1).astype(int)
            sy = np.clip(RH - 1 - ry, 0, RH - 1).astype(int)  # reference rows are bottom-up too
            col = ref_px[sy, sx, :3]
            tx = p[ok, 0].astype(int)
            ty = p[ok, 1].astype(int)
            acc[ty, tx] += col * mk[:, None]
            wsum[ty, tx] += mk
            painted += int(ok.sum())
    hit = wsum > 0
    # Texels on shared triangle edges are written more than once: average the
    # colour, and cap the blend weight at 1.
    blend = np.clip(wsum, 0, 1)
    colour = np.where(hit[..., None], acc / np.maximum(wsum, 1e-6)[..., None], 0)
    tex[..., :3] = tex[..., :3] * (1 - blend[..., None]) + colour * blend[..., None]
    img.pixels.foreach_set(tex.ravel())

    # The model's normal map still describes the sculpted lashes and eye slits, and
    # its metallic map is not skin: where the reference is painted, its own painted
    # shading should show, so those maps go flat / non-metallic under the same blend.
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    def source_image(socket):
        for link in socket.links:
            node = link.from_node
            if node.type == "TEX_IMAGE":
                return node.image
            if node.type in ("NORMAL_MAP", "SEPARATE_COLOR", "SEPRGB"):
                for inp in node.inputs:
                    found = source_image(inp)
                    if found:
                        return found
        return None
    flattened = []
    for socket_name, neutral in (("Normal", (0.5, 0.5, 1.0)), ("Metallic", None)):
        im = source_image(bsdf.inputs[socket_name]) if socket_name in bsdf.inputs else None
        if im is None or tuple(im.size) != (W, H):
            continue
        px_ = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)
        if neutral is not None:
            px_[..., :3] = px_[..., :3] * (1 - blend[..., None]) + np.array(neutral, dtype=np.float32) * blend[..., None]
        else:
            px_[..., 2] = px_[..., 2] * (1 - blend)  # glTF metallic lives in the blue channel
        im.pixels.foreach_set(px_.ravel())
        im.update()
        flattened.append([socket_name, im.name])
    log("maps", flattened=flattened)

    if A.get("eyePatches", True):
        eye_patches(head, pos, nrm, px, py, src, ref, tri, cx, cz, width, size, mw)
    img.update()
    log("texture", image=img.name, size=[W, H], texelsWritten=painted, texelsChanged=int(hit.sum()))


    render(sc, cam, os.path.join(A["previewDir"], "faceproject_front_after.png"), (cx, float(pos[:, 1].min()), cz), width)
    render(sc, cam, os.path.join(A["previewDir"], "faceproject_three_quarter_after.png"), (cx, float(pos[:, 1].min()) + 0.08, cz), width, ortho=False, distance=0.9, direction=(-0.6, -0.8, 0))

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
