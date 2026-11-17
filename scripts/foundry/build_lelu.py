"""
==========================================================
LÉLU CHARACTER FOUNDRY — PRODUCTION BUILDER (Blender headless)
==========================================================

Builds the reference-locked LÉLU character as a real, editable
Blender production asset, then exports it:

  body            continuous quad loft, anatomy from field bulges
  face            head loft + sculpted features, real eyeballs,
                  lids, lashes, lips, teeth, septum and lip studs
  hair            1,500 individually built curl strands in three
                  volume shells + fringe, in black and rose
  roses           layered petal geometry, 10 placements
  jewellery       chains, hoops, gems, beads, buckles, rings,
                  cuff stacks, forehead ornament, necklaces
  garments        corset/bustier, baggy cargo pants, hip rig,
                  arm sleeves and pauldron, platform boots
  rig             62-bone armature, spine/neck/head/jaw/eyes,
                  both hands with 5 fingers x 2, legs and feet
  face keys       blink L/R, jawOpen, mouthSmile L/R, browUp L/R
  export          .blend, .glb, .fbx, 4K PBR maps, QC report

Everything is authored from scripts/foundry/lelu_design.py, which
is the transcription of the supplied references. Surfaces the
references cannot show are listed in `INFERRED` and reported by
the QC gate instead of being quietly invented.

Run:
  blender -b --factory-startup --python build_lelu.py -- '{"outDir": "..."}'
or with the bpy module:
  python build_lelu.py '{"outDir": "..."}'
==========================================================
"""

from __future__ import annotations

import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402  (must be first: it provides bmesh and mathutils)
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

import basemesh  # noqa: E402
import lelu_design as D  # noqa: E402
import materials as MAT  # noqa: E402
import meshlib as M  # noqa: E402
import texlib  # noqa: E402

N_BODY = 96
N_HEAD = 128


# --------------------------------------------------------------- scene utils
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    return scene


COLLECTIONS = {}
_BODY_VERTS = None
_JOINTS = {}
_HEAD_METRICS = {'eye_z': D.FACE['eye_z'], 'head_top': 1.830, 'head_r': 0.088}


def collection(name):
    if name in COLLECTIONS:
        return COLLECTIONS[name]
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    COLLECTIONS[name] = coll
    return coll


def add_mesh(name, verts, faces, coll_name, material, smooth=True,
             subsurf=0, shade_flat=False, uv=True, thickness=None):
    verts = np.asarray(verts, dtype=np.float64)
    if len(verts) == 0:
        return None
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [list(map(int, f)) for f in faces])
    mesh.validate(verbose=False)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    collection(coll_name).objects.link(obj)
    if material is not None:
        obj.data.materials.append(material)
    if smooth and not shade_flat:
        for poly in mesh.polygons:
            poly.use_smooth = True
    if subsurf:
        mod = obj.modifiers.new("subsurf", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf
        mod.use_limit_surface = True
    if uv:
        try:
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.cube_project(cube_size=0.20, correct_aspect=True, scale_to_bounds=False)
            bpy.ops.object.mode_set(mode="OBJECT")
            obj.select_set(False)
        except RuntimeError:
            pass
    if thickness:
        mod = obj.modifiers.new("solidify", "SOLIDIFY")
        mod.thickness = thickness
        mod.offset = 0.0
        mod.use_even_offset = True
    return obj


def add_group_mesh(name, verts, uvs, face_uvs, coll_name, material, smooth=True,
                   subsurf=0, shade_flat=False):
    """Build one mesh from an OBJ group, remapping indices and carrying the
    file's own UVs through to a Blender UV layer."""
    used = sorted({i for face, _ in face_uvs for i in face})
    remap = {old: new for new, old in enumerate(used)}
    local = verts[used]
    faces, loops_uv = [], []
    for face, uv_idx in face_uvs:
        for k in range(1, len(face) - 1):
            tri = [face[0], face[k], face[k + 1]]
            faces.append([remap[i] for i in tri])
            for i, uv in zip(tri, (uv_idx[0], uv_idx[k], uv_idx[k + 1])):
                loops_uv.append(uvs[uv] if uv >= 0 and uv < len(uvs) else (0.0, 0.0))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in local], [], faces)
    mesh.validate(verbose=False)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for loop_index, uv in enumerate(loops_uv):
        if loop_index < len(uv_layer.data):
            uv_layer.data[loop_index].uv = (float(uv[0]), float(uv[1]))
    obj = bpy.data.objects.new(name, mesh)
    collection(coll_name).objects.link(obj)
    if material is not None:
        obj.data.materials.append(material)
    if smooth and not shade_flat:
        for poly in mesh.polygons:
            poly.use_smooth = True
    if subsurf:
        mod = obj.modifiers.new("subsurf", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf
    return obj


def surface_front(verts, x, z, radius=0.02):
    """The most forward (most -Y) body vertex near (x, z): used to sit brows,
    hardware and ink exactly on the sculpted face instead of guessing."""
    mask = (np.abs(verts[:, 0] - x) < radius) & (np.abs(verts[:, 2] - z) < radius)
    if not mask.any():
        return None
    return float(verts[mask][:, 1].min())


def build_from_base(mats, base_path, eye_height=1.6985):
    """Import the CC0 base, sculpt LÉLU's form into it, and return the
    landmarks every other stage anchors to."""
    data = basemesh.load(base_path, eye_height)
    verts, uvs, groups = data["verts"], data["uvs"], data["groups"]
    joints = data["joints"]

    landmarks = {
        "eye_z": float(joints["joint-l-eye"][2]),
        "shoulder_z": float(joints["joint-l-shoulder"][2]),
        "hip_z": float(joints["joint-pelvis"][2]),
        "head_z": float(joints["joint-head"][2]),
        "chin_z": float(joints["joint-jaw"][2]),
        "hand": joints["joint-l-hand"],
        "eye": joints["joint-l-eye"],
    }

    body = basemesh.sculpt_body(verts, groups, landmarks)
    body, joints, rotations = basemesh.pose_arms_down(body, joints, 0.212)
    landmarks.update({"eye_z": float(joints["joint-l-eye"][2]),
                      "hand": joints["joint-l-hand"],
                      "eye": joints["joint-l-eye"]})

    global _BODY_VERTS, _HEAD_METRICS, _JOINTS
    _JOINTS = joints
    _BODY_VERTS = body
    head_top = float(body[body[:, 2] > (landmarks["eye_z"] + 0.02)][:, 2].max())
    head_band = body[(body[:, 2] > landmarks["eye_z"] - 0.02) & (body[:, 2] < landmarks["eye_z"] + 0.06)]
    head_r = float(np.hypot(head_band[:, 0], head_band[:, 1]).max()) if len(head_band) else 0.09
    _HEAD_METRICS = {"eye_z": landmarks["eye_z"], "head_top": head_top, "head_r": head_r}
    body_obj = add_group_mesh("LELU_Body", body, uvs, groups["body"], "Body", mats["skin"])
    body_obj.data.polygons.foreach_set("use_smooth", [True] * len(body_obj.data.polygons))

    built = {"body": body_obj, "landmarks": landmarks, "joints": joints,
             "rotations": rotations, "verts": body, "uvs": uvs, "groups": groups}

    # eyes: a controlled globe at the base's own eye joint, iris and pupil on
    # the front surface, so the aperture and the gaze are predictable
    eye_r = 0.0126
    for side, key in (("l", "helper-l-eye"), ("r", "helper-r-eye")):
        centre = joints[f"joint-{side}-eye"].copy()
        centre[1] = min(centre[1], -0.062)
        v, fc = M.bead(eye_r, facets=40)
        sclera = add_mesh(f"LELU_Eye_{side.upper()}", v + centre, fc, "Face",
                          mats["sclera"], uv=False)
        built[f"eye_{side}"] = sclera
        rows, cols = 10, 48
        iv, iff = [], []
        for i in range(rows + 1):
            phi = (math.pi * 0.5) * 0.42 * (i / rows)
            for j in range(cols):
                th = 2 * math.pi * j / cols
                iv.append([eye_r * 0.58 * math.sin(phi) * math.cos(th),
                           -math.sqrt(max(1e-6, 1.0 - (0.58 * math.sin(phi)) ** 2)) * eye_r * 1.002,
                           eye_r * 0.58 * math.sin(phi) * math.sin(th)])
        for i in range(rows):
            for j in range(cols):
                a = i * cols + j
                b = i * cols + (j + 1) % cols
                c = (i + 1) * cols + (j + 1) % cols
                d = (i + 1) * cols + j
                iff.append([a, b, c, d])
        add_mesh(f"LELU_Iris_{side.upper()}", np.asarray(iv) + centre, iff, "Face",
                 mats["iris"], uv=True)
        pv, pf = M.bead(eye_r * 0.26, facets=24)
        pv = pv * np.array([1.0, 0.12, 1.0])
        add_mesh(f"LELU_Pupil_{side.upper()}",
                 pv + np.array([centre[0], centre[1] - eye_r * 0.995, centre[2]]),
                 pf, "Face", mats["nap"], uv=False)

    # the base's lash cards are coarse planes; they are left out in favour of
    # the real lash geometry built below, so the eyes do not read as black bars

    for key, target in (("helper-upper-teeth", "LELU_Teeth_Upper"),
                        ("helper-lower-teeth", "LELU_Teeth_Lower")):
        if key in groups:
            add_group_mesh(target, body, uvs, groups[key], "Face", mats["teeth"])
    if "helper-tongue" in groups:
        add_group_mesh("LELU_Tongue", body, uvs, groups["helper-tongue"], "Face",
                       mats["mouth"])

    # brows: arched tubes laid on the sculpted brow ridge
    f = D.FACE
    for side in (-1, 1):
        pts = []
        for k in range(6):
            t = k / 5
            x = (0.010 + 0.034 * t) * side
            z = landmarks["eye_z"] + 0.0235 + math.sin(math.pi * t) * 0.0072 - 0.004 * t
            front = surface_front(body, x, z, 0.014)
            if front is None:
                front = -0.095
            pts.append((x, front - 0.0012 - 0.0015 * math.sin(math.pi * t), z))
        path = M.catmull(pts, 6)
        v, fc = M.tube(path, np.linspace(0.0068, 0.0012, len(path)), sides=8,
                       squash=(1.0, 0.26))
        add_mesh(f"LELU_Brow_{'L' if side > 0 else 'R'}", v, fc, "Face", mats["brow"],
                 uv=False)
    return built


def face_front(z, x=0.0):
    """The y of the head surface at (x, z) — every facial feature is placed
    relative to this, so nothing sinks into the skull."""
    rx, ry, y0, power = profile_at(D.HEAD, z)
    t = min(1.0, abs(x) / max(rx, 1e-6))
    k = max(0.0, 1.0 - t ** power) ** (1.0 / power)
    return y0 - ry * k


def profile_at(table, z):
    zs = [row[0] for row in table]
    z = float(np.clip(z, min(zs), max(zs)))
    for i in range(len(table) - 1):
        z0, z1 = table[i][0], table[i + 1][0]
        if z0 <= z <= z1:
            t = 0.0 if z1 == z0 else (z - z0) / (z1 - z0)
            a, b = table[i], table[i + 1]
            return tuple(a[k] + (b[k] - a[k]) * t for k in range(1, 5))
    return table[-1][1:]


# --------------------------------------------------------------- body shape
def body_slice(z, n=72, grow=0.0):
    """A ring sampled from the actual sculpted body at height z, used to fit
    garments to the real silhouette instead of a table."""
    global _BODY_VERTS
    verts = _BODY_VERTS
    if verts is None:
        return M.ring((0, 0, z), 0.14 + grow, 0.10 + grow, n=64, power=2.2)
    band = verts[np.abs(verts[:, 2] - z) < 0.016]
    band = band[np.abs(band[:, 0]) < 0.175]          # arms are not the torso
    if len(band) < 12:
        band = verts[np.abs(verts[:, 2] - z) < 0.05]
        band = band[np.abs(band[:, 0]) < 0.175]
    if len(band) < 12:
        return M.ring((0, 0, z), 0.14 + grow, 0.10 + grow, n=64, power=2.2)
    cx, cy = float(band[:, 0].mean()), float(band[:, 1].mean())
    ang = np.arctan2(band[:, 1] - cy, band[:, 0] - cx)
    rad = np.hypot(band[:, 0] - cx, band[:, 1] - cy)
    bins = ((ang + math.pi) / (2 * math.pi) * n).astype(int) % n
    out = []
    radii = []
    for k in range(n):
        sel = rad[bins == k]
        radii.append(float(np.percentile(sel, 82)) if len(sel) else np.nan)
    radii = np.asarray(radii)
    if np.isnan(radii).all():
        radii[:] = 0.10
    else:
        radii = np.where(np.isnan(radii), np.nanmedian(radii), radii)
    # circular smoothing: an unsmoothed silhouette reads as melted fabric
    kernel = np.array([1, 2, 3, 2, 1], dtype=float)
    kernel /= kernel.sum()
    for _ in range(3):
        radii = np.convolve(np.r_[radii[-2:], radii, radii[:2]], kernel, mode="valid")
    out = []
    for k in range(n):
        th = -math.pi + 2 * math.pi * (k + 0.5) / n
        r = float(radii[k]) + grow
        out.append([cx + math.cos(th) * r, cy + math.sin(th) * r, z])
    return np.asarray(out)


def leg_slice(z, side, n=56, grow=0.0):
    """A ring around one leg, sampled from the sculpted body."""
    verts = _BODY_VERTS
    if verts is None:
        return M.ring((side * 0.075, 0.0, z), 0.09 + grow, 0.09 + grow, n=n, power=2.1)
    band = verts[(np.abs(verts[:, 2] - z) < 0.02) & (verts[:, 0] * side > 0.005)
                 & (np.abs(verts[:, 0]) < 0.175)]
    if len(band) < 10:
        band = verts[(np.abs(verts[:, 2] - z) < 0.06) & (verts[:, 0] * side > 0.005)
                     & (np.abs(verts[:, 0]) < 0.175)]
    if len(band) < 10:
        return M.ring((side * 0.075, 0.0, z), 0.09 + grow, 0.09 + grow, n=n, power=2.1)
    cx, cy = float(band[:, 0].mean()), float(band[:, 1].mean())
    ang = np.arctan2(band[:, 1] - cy, band[:, 0] - cx)
    rad = np.hypot(band[:, 0] - cx, band[:, 1] - cy)
    bins = ((ang + math.pi) / (2 * math.pi) * n).astype(int) % n
    out = []
    for k in range(n):
        sel = rad[bins == k]
        r = float(np.percentile(sel, 80)) + grow if len(sel) else 0.08 + grow
        th = -math.pi + 2 * math.pi * (k + 0.5) / n
        out.append([cx + math.cos(th) * r, cy + math.sin(th) * r, z])
    return np.asarray(out)


def body_modulation(p, z):
    """Anatomical displacement fields on the torso surface (metres)."""
    x, y, zz = p
    d = np.array([0.0, 0.0, 0.0])
    rx, ry, y0, _ = profile_at(D.TORSO, z)

    # bust: two forward lobes, ref_A/B full bust under the bustier
    for side in (-1, 1):
        cx = side * 0.062
        cz = 1.412
        r = math.hypot((x - cx) / 0.055, (zz - cz) / 0.050)
        if r < 2.2:
            amp = 0.049 * math.exp(-(r ** 2) / 1.15)
            d[1] -= amp * 1.15
            d[2] += amp * 0.18 * (1.0 if zz < cz else -0.6)
            d[0] += side * amp * 0.10

    # glutes
    for side in (-1, 1):
        cx = side * 0.062
        cz = 1.045
        r = math.hypot((x - cx) / 0.070, (zz - cz) / 0.052)
        if r < 2.2:
            amp = 0.030 * math.exp(-(r ** 2) / 1.1)
            d[1] += amp

    # abdominal groove and lower-belly softness
    if -0.075 < x < 0.075 and 1.16 < zz < 1.36:
        t = math.exp(-(x / 0.020) ** 2) * math.exp(-((zz - 1.27) / 0.075) ** 2)
        d[1] += 0.008 * t
    if 1.05 < zz < 1.18:
        t = math.exp(-((zz - 1.12) / 0.045) ** 2) * math.exp(-(x / 0.075) ** 2)
        d[1] -= 0.006 * t

    # spine groove
    if y > 0 and 1.15 < zz < 1.52:
        t = math.exp(-(x / 0.022) ** 2) * math.exp(-((zz - 1.33) / 0.16) ** 2)
        d[1] -= 0.008 * t

    # collar bones
    if 1.50 < zz < 1.565:
        for side in (-1, 1):
            t = math.exp(-((x - side * 0.075) / 0.055) ** 2) * math.exp(-((zz - 1.532) / 0.012) ** 2)
            d[1] -= 0.0035 * t

    # trapezius / neck blend
    if 1.545 < zz < 1.60:
        t = math.exp(-((abs(x) - 0.055) / 0.040) ** 2)
        d[2] -= 0.004 * t
    return d


def torso_ring(z, grow=0.0, n=N_BODY, modulate=True):
    rx, ry, y0, power = profile_at(D.TORSO, z)
    r = M.ring((0.0, y0, z), rx + grow, ry + grow, n=n, power=power)
    if modulate:
        r = r + np.array([body_modulation(tuple(p), z) for p in r])
    return r


def build_body(mats):
    zs = [row[0] for row in D.TORSO]
    # densify: 8 rings per table segment for a smooth surface
    dense = []
    for i in range(len(zs) - 1):
        for s in range(8):
            dense.append(zs[i] + (zs[i + 1] - zs[i]) * s / 8.0)
    dense.append(zs[-1])
    rings = [torso_ring(z) for z in dense]
    verts, faces = M.loft(rings, cap_start=True, cap_end=True)
    body = add_mesh("LELU_Body", verts, faces, "Body", mats["skin"], subsurf=1)
    return body


# limb numbers, metres, in the rest pose
ARM = {"shoulder": (0.160, 0.000, 1.500), "elbow": (0.196, 0.004, 1.215),
       "wrist": (0.212, 0.010, 0.985)}
LEG = {"hip": (0.082, 0.000, 1.030), "knee": (0.074, 0.006, 0.500),
       "ankle": (0.078, 0.004, 0.110)}


def build_arms(mats):
    """Upper arm and forearm as one continuous sweep with a deltoid cap."""
    for side in (-1, 1):
        sh = np.array([side * ARM["shoulder"][0], 0.0, ARM["shoulder"][2]])
        el = np.array([side * ARM["elbow"][0], ARM["elbow"][1], ARM["elbow"][2]])
        wr = np.array([side * ARM["wrist"][0], ARM["wrist"][1], ARM["wrist"][2]])
        upper_mid = (sh + el) / 2 + np.array([side * 0.006, -0.004, 0])
        fore_mid = (el + wr) / 2 + np.array([side * 0.004, -0.006, 0])
        path = M.catmull([sh, upper_mid, el, fore_mid, wr], 7)
        key_r = [0.058, 0.049, 0.041, 0.043, 0.030]
        radii = np.interp(np.linspace(0, 1, len(path)), np.linspace(0, 1, len(key_r)), key_r)
        rad = np.array([-odd for odd in []]) if False else radii
        v, fc = M.tube(path, rad, sides=40, cap=True)
        add_mesh(f"LELU_Arm_{'L' if side > 0 else 'R'}", v, fc, "Body", mats["skin"],
                 uv=True, subsurf=1)
        # deltoid: closes the shoulder into the torso
        v, fc = M.bead(0.056, facets=28)
        v = v * np.array([1.0, 0.95, 1.10])
        add_mesh(f"LELU_Deltoid_{'L' if side > 0 else 'R'}",
                 v + np.array([side * 0.163, 0.0, 1.494]), fc, "Body", mats["skin"],
                 uv=True, subsurf=1)


def build_hand(side, mats):
    """Palm, four fingers with three phalanges, thumb, and stiletto nails."""
    label = "L" if side > 0 else "R"
    wr = np.array([side * ARM["wrist"][0], ARM["wrist"][1], ARM["wrist"][2]])
    kn = np.array([side * (ARM["wrist"][0] + 0.004), ARM["wrist"][1] - 0.004,
                   ARM["wrist"][2] - 0.046])
    # palm
    rings = []
    for s in np.linspace(0, 1, 7):
        c = wr * (1 - s) + kn * s
        rx = 0.0195 + 0.0035 * s
        ry = 0.0135 + 0.0015 * s
        rings.append(M.ring((c[0], c[1], c[2]), rx, ry, n=28, power=2.6))
    v, fc = M.loft(rings, cap_start=True, cap_end=True)
    add_mesh(f"LELU_Palm_{label}", v, fc, "Body", mats["skin"], uv=True, subsurf=1)

    fingers = [(-0.0145, 0.0525, 0.0071), (-0.0048, 0.0565, 0.0073),
               (0.0048, 0.0520, 0.0069), (0.0145, 0.0425, 0.0062)]
    for i, (off, length, r0) in enumerate(fingers):
        base = np.array([kn[0] + side * off, kn[1] - 0.002, kn[2] - 0.002])
        pts = [base]
        seg_len = length / 3.0
        cur = base.copy()
        for k in range(3):
            cur = cur + np.array([side * 0.0018 * (i - 1.5) * 0.4, -0.0035, -seg_len])
            cur = cur + np.array([0.0, -0.0012 * k, 0.0])
            pts.append(cur.copy())
        path = M.catmull(pts, 5)
        radii = np.interp(np.linspace(0, 1, len(path)), np.linspace(0, 1, 4),
                          [r0, r0 * 0.95, r0 * 0.86, r0 * 0.72])
        v, fc = M.tube(path, radii, sides=16, cap=True)
        add_mesh(f"LELU_Finger_{label}_{i}", v, fc, "Body", mats["skin"], uv=True,
                 subsurf=1)
        # stiletto nail: a tapered, slightly curved blade off the fingertip (ref_G)
        tip = path[-1]
        nail_pts = M.catmull([tip + np.array([0, -0.0045, 0.0015]),
                             tip + np.array([0, -0.0060, -0.0090]),
                             tip + np.array([0, -0.0075, -0.0205])], 6)
        nr = np.linspace(r0 * 0.82, 0.0007, len(nail_pts))
        v, fc = M.tube(nail_pts, nr, sides=10, squash=(1.0, 0.42))
        add_mesh(f"LELU_Nail_{label}_{i}", v, fc, "Body", mats["nail"], uv=True)
        # ring on every finger except the pinky (ref_G)
        if i != 3:
            v, fc = M.torus_link(major=r0 * 1.18, minor=0.0009, seg=20, sides=7)
            v = M.transform(v, rot=(0, 90, 0), translate=tip + np.array([0, 0, seg_len * 1.4]))
            add_mesh(f"LELU_RingF_{label}_{i}", v, fc, "Jewelry", mats["copper"], uv=False)

    # thumb
    thumb_base = np.array([kn[0] - side * 0.016, kn[1] + 0.020, kn[2] + 0.024])
    thumb_pts = M.catmull([thumb_base,
                           thumb_base + np.array([side * 0.0035, 0.0060, -0.016]),
                           thumb_base + np.array([side * 0.0055, 0.0095, -0.031])], 5)
    tr = np.linspace(0.0082, 0.0058, len(thumb_pts))
    v, fc = M.tube(thumb_pts, tr, sides=14, cap=True)
    add_mesh(f"LELU_Thumb_{label}", v, fc, "Body", mats["skin"], uv=True, subsurf=1)
    tip = thumb_pts[-1]
    nail_pts = M.catmull([tip + np.array([0, 0.0015, -0.0010]),
                          tip + np.array([side * 0.0010, 0.0035, -0.0125])], 5)
    v, fc = M.tube(nail_pts, np.linspace(0.0052, 0.0007, len(nail_pts)), sides=8,
                   squash=(1.0, 0.45))
    add_mesh(f"LELU_Nail_{label}_thumb", v, fc, "Body", mats["nail"], uv=True)
    # thumb ring + bracelet stack at the wrist
    v, fc = M.torus_link(major=0.0110, minor=0.0012, seg=22, sides=7)
    v = M.transform(v, rot=(0, 90, 0), translate=thumb_base + np.array([0, 0.002, -0.010]))
    add_mesh(f"LELU_RingThumb_{label}", v, fc, "Jewelry", mats["copper"], uv=False)
    for b in range(3):
        v, fc = M.torus_link(major=0.0215 - b * 0.0008, minor=0.0016, seg=26, sides=8)
        v = M.transform(v, rot=(0, 90, 0), translate=wr + np.array([0, 0, 0.012 + b * 0.007]))
        add_mesh(f"LELU_WristBand_{label}_{b}", v, fc, "Jewelry", mats["copper"], uv=False)


def build_legs(mats):
    for side in (-1, 1):
        hi = np.array([side * LEG["hip"][0], 0.0, LEG["hip"][2]])
        kn = np.array([side * LEG["knee"][0], LEG["knee"][1], LEG["knee"][2]])
        an = np.array([side * LEG["ankle"][0], LEG["ankle"][1], LEG["ankle"][2]])
        thigh_mid = (hi + kn) / 2 + np.array([side * 0.007, -0.004, 0])
        calf = (kn + an) / 2 + np.array([side * 0.004, 0.008, 0])
        path = M.catmull([hi, thigh_mid, kn, calf, an], 7)
        key_r = [0.098, 0.086, 0.062, 0.055, 0.038]
        radii = np.interp(np.linspace(0, 1, len(path)), np.linspace(0, 1, len(key_r)), key_r)
        v, fc = M.tube(path, radii, sides=40, cap=True)
        add_mesh(f"LELU_Leg_{'L' if side > 0 else 'R'}", v, fc, "Body", mats["skin"],
                 uv=True, subsurf=1)
        # foot inside the boot (kept so the rig has real geometry to deform)
        heel = np.array([side * LEG["ankle"][0], 0.010, 0.090])
        toe = np.array([side * LEG["ankle"][0], -0.095, 0.070])
        fpath = M.catmull([an, heel, (heel + toe) / 2, toe], 6)
        fr = np.interp(np.linspace(0, 1, len(fpath)), np.linspace(0, 1, 4),
                       [0.038, 0.040, 0.036, 0.026])
        v, fc = M.tube(fpath, fr, sides=24, squash=(1.0, 0.78))
        add_mesh(f"LELU_Foot_{'L' if side > 0 else 'R'}", v, fc, "Body", mats["skin"],
                 uv=True, subsurf=1)


def build_neck_head(mats):
    zs = [row[0] for row in D.HEAD]
    dense = []
    for i in range(len(zs) - 1):
        for s in range(10):
            dense.append(zs[i] + (zs[i + 1] - zs[i]) * s / 10.0)
    dense.append(zs[-1])
    rings = []
    for z in dense:
        rx, ry, y0, power = profile_at(D.HEAD, z)
        r = M.ring((0.0, y0, z), rx, ry, n=N_HEAD, power=power)
        r = np.array([head_modulation(tuple(p), z) + p for p in r])
        rings.append(r)
    verts, faces = M.loft(rings, cap_start=True, cap_end=True)
    head = add_mesh("LELU_Head", verts, faces, "Face", mats["skin"], smooth=True, subsurf=0)
    return head


def head_modulation(p, z):
    """Facial anatomy as smooth fields: brow, orbits, zygomatic, maxilla,
    mandible, chin and temple hollow. Amplitudes are in millimetres of real
    form, not surface noise, so the head stops reading as an egg."""
    x, y, zz = p
    d = np.array([0.0, 0.0, 0.0])
    front = y < 0.0

    if front:
        # orbital hollows
        for side in (-1, 1):
            t = math.exp(-(((x - side * D.FACE["eye_x"]) / 0.021) ** 2)
                         - (((zz - D.FACE["eye_z"]) / 0.014) ** 2))
            d[1] += 0.0105 * t
        # brow ridge
        for side in (-1, 1):
            t = math.exp(-(((x - side * (D.FACE["eye_x"] + 0.002)) / 0.030) ** 2)
                         - (((zz - D.FACE["brow_z"]) / 0.009) ** 2))
            d[1] -= 0.0080 * t
        # glabella
        t = math.exp(-((x / 0.014) ** 2) - (((zz - D.FACE["brow_z"] + 0.004) / 0.012) ** 2))
        d[1] -= 0.0040 * t
        # zygomatic (cheekbone) — forward and out
        for side in (-1, 1):
            t = math.exp(-(((abs(x) - 0.056) / 0.022) ** 2) - (((zz - 1.676) / 0.017) ** 2))
            d[1] -= 0.0090 * t
            d[0] += side * 0.0055 * t
        # cheek fullness below the bone
        for side in (-1, 1):
            t = math.exp(-(((abs(x) - 0.050) / 0.025) ** 2) - (((zz - 1.652) / 0.016) ** 2))
            d[1] -= 0.0045 * t
        # jaw corner / mandible edge
        for side in (-1, 1):
            t = math.exp(-(((abs(x) - 0.058) / 0.016) ** 2) - (((zz - 1.622) / 0.020) ** 2))
            d[0] += side * 0.0040 * t
            d[1] += 0.0020 * t
        # chin ball
        t = math.exp(-((x / 0.026) ** 2) - (((zz - D.FACE["chin_z"] + 0.004) / 0.014) ** 2))
        d[1] -= 0.0095 * t
        # mental crease under the lip
        t = math.exp(-((x / 0.014) ** 2) - (((zz - (D.FACE["mouth_z"] - 0.017)) / 0.007) ** 2))
        d[1] += 0.0030 * t
        # philtrum groove
        t = math.exp(-((x / 0.006) ** 2) - (((zz - (D.FACE["mouth_z"] + 0.012)) / 0.008) ** 2))
        d[1] += 0.0028 * t
        # maxilla / mouth pad so the lips sit on a muzzle
        t = math.exp(-((x / 0.030) ** 2) - (((zz - D.FACE["mouth_z"]) / 0.016) ** 2))
        d[1] -= 0.0075 * t
        # nasolabial shadow
        for side in (-1, 1):
            t = math.exp(-(((abs(x) - 0.026) / 0.008) ** 2) - (((zz - 1.662) / 0.020) ** 2))
            d[1] += 0.0030 * t
        # temple hollow
        for side in (-1, 1):
            t = math.exp(-(((abs(x) - 0.074) / 0.014) ** 2) - (((zz - 1.742) / 0.022) ** 2))
            d[0] -= side * 0.0060 * t
        # forehead plane: slightly flattened between the brows and hairline
        t = math.exp(-((x / 0.045) ** 2) - (((zz - 1.762) / 0.020) ** 2))
        d[1] += 0.0035 * t
    else:
        # occiput
        t = math.exp(-((x / 0.050) ** 2) - (((zz - 1.760) / 0.032) ** 2))
        d[1] += 0.0080 * t
        # jaw / neck transition
        t = math.exp(-((x / 0.045) ** 2) - (((zz - 1.596) / 0.014) ** 2))
        d[1] += 0.0030 * t
    return d


# ---------------------------------------------------------------- face parts
def build_eye(side, mats):
    """Sclera + iris disc + wet cornea, sized from the design authority."""
    f = D.FACE
    eye_x = side * f["eye_x"]
    front = face_front(f["eye_z"], eye_x)
    centre = np.array([eye_x, front + 0.0122, f["eye_z"]])   # globe sits proud by ~4 mm
    r = 0.0125

    verts, faces = M.bead(r, facets=32)
    sclera = add_mesh(f"LELU_Eye_{'L' if side > 0 else 'R'}", verts + centre, faces,
                      "Face", mats["sclera"], uv=False)

    # iris: a shallow spherical cap sitting on the sclera front
    rows, cols = 10, 48
    iv, iff = [], []
    for i in range(rows + 1):
        phi = (math.pi * 0.5) * (i / rows) * 0.42
        for j in range(cols):
            th = 2 * math.pi * j / cols
            iv.append([f["iris_r"] * math.sin(phi) * math.cos(th),
                       -r * 0.985 - 0.0004 + 0.0009 * math.sin(phi),
                       f["iris_r"] * math.sin(phi) * math.sin(th)])
    for i in range(rows):
        for j in range(cols):
            a = i * cols + j
            b = i * cols + (j + 1) % cols
            c = (i + 1) * cols + (j + 1) % cols
            d = (i + 1) * cols + j
            iff.append([a, b, c, d])
    iris = add_mesh(f"LELU_Iris_{'L' if side > 0 else 'R'}", np.asarray(iv) + centre, iff,
                    "Face", mats["iris"], uv=True)

    # cornea: thin transparent dome over the iris
    cv, cf = M.bead(r * 0.86, facets=32)
    cv = cv[np.asarray(cv)[:, 1] < 0.0] if False else cv
    cornea = add_mesh(f"LELU_Cornea_{'L' if side > 0 else 'R'}", cv + centre, cf,
                      "Face", mats["cornea"], uv=False)
    return sclera, iris, cornea


def build_eyelids(side, mats):
    """Lids as spherical bands over the globe: the upper lid really covers the
    top of the eye and the crease curls back into the socket (ref_B)."""
    f = D.FACE
    label = "L" if side > 0 else "R"
    ex, ez = side * f["eye_x"], f["eye_z"]
    front = face_front(ez, ex)
    centre = np.array([ex, front + 0.0122, ez])
    globe_r = 0.0132
    for lid, phi0, phi1, R in (("upper", 0.50, 1.12, globe_r * 1.030),
                               ("lower", -0.34, -0.76, globe_r * 1.026)):
        rows, cols = 7, 30
        v, fc = [], []
        for i in range(rows + 1):
            u = i / rows
            phi = phi0 + (phi1 - phi0) * u ** 0.85
            for j in range(cols + 1):
                s = j / cols
                theta = (s - 0.5) * 1.90
                # almond outline: the aperture narrows toward the corners
                shape = max(0.0, math.cos(theta / 1.05) ) ** 0.55
                p = phi * (0.35 + 0.65 * shape)
                x = R * math.cos(p) * math.sin(theta) * (1.0 + 0.06 * u)
                y = -R * math.cos(p) * math.cos(theta)
                z = R * math.sin(p) * (1.0 + 0.10 * u)
                # lift the crease outward so the lid rolls over the globe
                y -= 0.0012 * u * (1.0 if lid == "upper" else -1.0)
                v.append([centre[0] + x, centre[1] + y, centre[2] + z])
        for i in range(rows):
            for j in range(cols):
                a = i * (cols + 1) + j
                fc.append([a, a + 1, a + cols + 2, a + cols + 1])
        add_mesh(f"LELU_Lid_{lid}_{label}", np.asarray(v), fc, "Face", mats["skin"],
                 uv=True, subsurf=1)
    # lash line: a dark band exactly on the upper lid margin (heavy liner, ref_B)
    v, fc = [], []
    cols = 30
    for i in range(2):
        for j in range(cols + 1):
            s = j / cols
            theta = (s - 0.5) * 1.90
            shape = max(0.0, math.cos(theta / 1.05)) ** 0.55
            p = (0.48 + 0.02 * i) * (0.35 + 0.65 * shape)
            R = globe_r * (1.040 + 0.012 * i)
            v.append([centre[0] + R * math.cos(p) * math.sin(theta),
                      centre[1] - R * math.cos(p) * math.cos(theta),
                      centre[2] + R * math.sin(p)])
    for j in range(cols):
        fc.append([j, j + 1, cols + 1 + j + 1, cols + 1 + j])
    add_mesh(f"LELU_Liner_{label}", np.asarray(v), fc, "Face", mats["brow"], uv=False)


def build_tattoos(mats):
    """The ink is real linework on the skin: sternum script, sternum serpent,
    forearm rose-and-thorn flash, and the knuckle script (ref_G)."""
    ink = mats["tattoo"]
    # chest: a sinuous centre-line with a small serpent head, ref_B/ref_A
    pts = []
    for k in range(10):
        s = k / 9
        z = 1.455 - 0.075 * s
        rx, ry, y0, _p = profile_at(D.TORSO, z)
        ang = -math.pi / 2 + 0.10 * math.sin(s * 5.0)
        pts.append((math.cos(ang) * (rx + 0.0015),
                    math.sin(ang) * (ry + 0.0015) + y0, z))
    v, fc = M.tube(M.catmull(pts, 6), 0.0011, sides=5)
    add_mesh("LELU_Tattoo_Sternum", v, fc, "Body", ink, uv=False)
    for k in range(7):
        s = k / 6
        z = 1.452 - 0.060 * s
        rx, ry, y0, _p = profile_at(D.TORSO, z)
        x = math.copysign(0.030 + 0.006 * s, (-1) ** k)
        ang = -math.pi / 2 + (x / max(rx, 1e-6)) * 0.55
        p = np.array([math.cos(ang) * (rx + 0.0012), math.sin(ang) * (ry + 0.0012) + y0, z])
        bv, bf = M.bead(0.0018, facets=10)
        add_mesh(f"LELU_Tattoo_Dot_{k}", bv + p, bf, "Body", ink, uv=False)

    # forearms: a rose flash with thorny vine, ref_G
    for side in (-1, 1):
        base = np.array([side * 0.203, -0.030, 1.100])
        spiral = []
        for k in range(46):
            t = k / 45
            a = t * 3.4 * math.pi
            r = 0.006 + 0.017 * t
            spiral.append((base[0] + math.cos(a) * r * 0.55,
                           base[1] - 0.006 + math.sin(a) * r * 0.35,
                           base[2] - 0.030 + math.sin(a) * r))
        v, fc = M.tube(np.asarray(spiral), np.linspace(0.0012, 0.0007, len(spiral)), sides=5)
        add_mesh(f"LELU_Tattoo_Rose_{'L' if side > 0 else 'R'}", v, fc, "Body", ink, uv=False)
        vine = M.catmull([base + np.array([0, -0.004, 0.030]),
                          base + np.array([side * 0.010, -0.010, -0.002]),
                          base + np.array([0, -0.006, -0.046])], 6)
        v, fc = M.tube(vine, np.linspace(0.0010, 0.0006, len(vine)), sides=5)
        add_mesh(f"LELU_Tattoo_Vine_{'L' if side > 0 else 'R'}", v, fc, "Body", ink, uv=False)


def build_lashes(mats):
    """Individual lash fins along both upper lids — no painted lash line."""
    f = D.FACE
    parts = []
    for side in (-1, 1):
        ex, ez = side * f["eye_x"], f["eye_z"]
        for k in range(16):
            s = 0.06 + 0.88 * (k / 15)
            a = math.pi * (1.0 - s)
            bx = ex + f["eye_rx"] * math.cos(a) * side * 0.98
            bz = ez + f["eye_rz"] * math.sin(a) * 0.98
            length = 0.0075 + 0.0045 * math.sin(math.pi * s)
            front = face_front(bz, bx)
            tip = np.array([bx + side * length * 0.35, front - 0.0055,
                            bz + length * 0.85])
            root = np.array([bx, front - 0.0010, bz + 0.0012])
            path = M.catmull([root, (root + tip) / 2, tip], 4)
            v, fc = M.tube(path, np.linspace(0.00055, 0.00012, len(path)), sides=4)
            parts.append((v, fc))
    verts, faces = M.merge(*parts)
    return add_mesh("LELU_Lashes", verts, faces, "Face", mats["hair"], uv=False)


def build_brows(mats):
    """Defined arched brows, ref_B: thin, high arch, pointed tail."""
    f = D.FACE
    parts = []
    for side in (-1, 1):
        pts = []
        for k in range(6):
            s = k / 5
            x = (0.010 + 0.034 * s) * side
            z = f["brow_z"] + math.sin(math.pi * s) * f["brow_arch"] - 0.004 * s
            y = face_front(z, x) - 0.0022 - 0.0018 * math.sin(math.pi * s)
            pts.append((x, y, z))
        path = M.catmull(pts, 6)
        v, fc = M.tube(path, np.linspace(0.0070, 0.0013, len(path)), sides=8,
                       squash=(1.0, 0.26))
        parts.append((v, fc))
    verts, faces = M.merge(*parts)
    return add_mesh("LELU_Brows", verts, faces, "Face", mats["brow"], uv=False)


def build_nose(mats):
    f = D.FACE
    parts = []
    bridge = []
    for k in range(8):
        s = k / 7
        z = f["brow_z"] + 0.0135 - (f["brow_z"] + 0.0135 - f["nose_z"]) * s
        front = face_front(z)
        y = front - (0.0015 + 0.0115 * s ** 1.35)
        bridge.append((0.0, y, z))
    radii = np.interp(np.linspace(0, 1, len(bridge)),
                      np.linspace(0, 1, 7), [0.0058, 0.0056, 0.0054, 0.0060, 0.0074, 0.0094, 0.0110])
    v, fc = M.tube(bridge, radii, sides=18, squash=(1.0, 0.82))
    parts.append((v, fc))
    # tip and alae, sized from the reference's soft rounded nose
    v, fc = M.bead(0.0128, facets=26)
    v = v * np.array([1.06, 0.92, 0.84])
    tip_y = f["nose_y"] + 0.0040
    parts.append((v + np.array([0.0, tip_y, f["nose_z"] + 0.0010]), fc))
    for side in (-1, 1):
        v, fc = M.bead(0.0082, facets=20)
        v = v * np.array([0.98, 0.88, 0.72])
        parts.append((v + np.array([side * 0.0142, tip_y + 0.0075, f["nose_z"] + 0.0042]), fc))
        # nostril wing crease
        v, fc = M.tube(M.catmull([(side * 0.0062, tip_y + 0.0035, f["nose_z"] - 0.0055),
                                  (side * 0.0125, tip_y + 0.0060, f["nose_z"] - 0.0018),
                                  (side * 0.0155, tip_y + 0.0105, f["nose_z"] + 0.0055)], 4),
                       np.linspace(0.0018, 0.0009, 9), sides=6)
        parts.append((v, fc))
    verts, faces = M.merge(*parts)
    nose = add_mesh("LELU_Nose", verts, faces, "Face", mats["skin"], uv=True, subsurf=1)
    # nostrils: dark inner shells so the nose reads as a nose
    for side in (-1, 1):
        v, fc = M.bead(0.0044, facets=12)
        add_mesh(f"LELU_Nostril_{'L' if side > 0 else 'R'}",
                 v + np.array([side * 0.0078, tip_y + 0.0125, f["nose_z"] - 0.0072]),
                 fc, "Face", mats["mouth"], uv=False)
    return nose


def build_mouth(mats):
    """Full lips as two rolls swept along the mouth arc, with a real seam,
    a cavity and a hint of upper teeth (ref_B)."""
    f = D.FACE
    parts = []
    for lip, h, dz in (("upper", f["upper_lip_h"], 1.0), ("lower", f["lower_lip_h"], -1.0)):
        cols, rows = 40, 14
        v, fc = [], []
        for j in range(cols + 1):
            s = j / cols
            x = (s - 0.5) * 2 * f["mouth_w"]
            edge = math.sqrt(max(0.0, 1.0 - (x / f["mouth_w"]) ** 2))
            # cupid's bow on the upper lip, a soft crescent on the lower
            if dz > 0:
                seam = f["mouth_z"] + 0.0014 + 0.0024 * math.exp(-(x / 0.0055) ** 2) \
                    - 0.0018 * (abs(x) / f["mouth_w"]) ** 2
            else:
                seam = f["mouth_z"] - 0.0016 - 0.0014 * (1.0 - abs(x) / f["mouth_w"])
            thick = h * (0.28 + 0.72 * edge)
            rz = thick * 0.62
            ry = thick * 0.95
            zc = seam + dz * rz * 0.55
            yc = f["mouth_y"] - 0.0035 - 0.0035 * edge
            for i in range(rows + 1):
                ang = 2 * math.pi * i / rows
                y = yc - ry * math.cos(ang)
                z = zc + dz * rz * math.sin(ang) * (1.0 if dz > 0 else 1.0)
                # the free edge of the lip rolls slightly outward
                y -= 0.0012 * math.sin(ang) * edge
                v.append([x, y, z])
        for j in range(cols):
            for i in range(rows):
                a = j * (rows + 1) + i
                fc.append([a, a + 1, a + rows + 2, a + rows + 1])
        parts.append((np.asarray(v), fc))
    verts, faces = M.merge(*parts)
    lips = add_mesh("LELU_Lips", verts, faces, "Face", mats["lip"], uv=True, subsurf=1)

    # mouth cavity and upper teeth behind the seam
    cav, cafe = M.bead(0.019, facets=20)
    cav = cav * np.array([1.20, 0.62, 0.50])
    add_mesh("LELU_MouthCavity",
             cav + np.array([0.0, f["mouth_y"] + 0.0135, f["mouth_z"] - 0.0035]),
             cafe, "Face", mats["mouth"], uv=False)
    cols, rows = 20, 4
    tv, tf = [], []
    for i in range(rows + 1):
        u = i / rows
        for j in range(cols + 1):
            s = j / cols
            x = (s - 0.5) * 2 * 0.020
            tv.append([x, f["mouth_y"] + 0.0112, f["mouth_z"] + 0.0026 - u * 0.0040
                       - 0.0017 * (abs(x) / 0.020) ** 2])
    for i in range(rows):
        for j in range(cols):
            a = i * (cols + 1) + j
            tf.append([a, a + 1, a + cols + 2, a + cols + 1])
    add_mesh("LELU_Teeth", np.asarray(tv), tf, "Face", mats["teeth"], uv=False)
    return lips


def build_face_hardware(mats):
    """Septum hoop, lip stud, forehead chain and its central gem (ref_B)."""
    f = D.FACE
    parts = []
    v, fc = M.torus_link(major=D.JEWELRY["septum_ring"], minor=0.0011, seg=28, sides=8)
    v = M.transform(v, rot=(0, 90, 0),
                    translate=(0.0, f["nose_y"] + 0.0125, f["septum_z"]))
    add_mesh("LELU_Septum", v, fc, "Jewelry", mats["copper"], uv=False)
    chin_front = face_front(f["lip_stud_z"])
    v, fc = M.bead(0.0018, facets=10)
    add_mesh("LELU_LipStud", v + np.array([0.0, chin_front - 0.0022, f["lip_stud_z"]]),
             fc, "Jewelry", mats["copper"], uv=False)

    # forehead ornament: chain from the hairline to the stone between the brows
    top = face_front(1.800)
    low = face_front(f["brow_z"] + 0.012)
    chain_pts = M.catmull([(0.0, top - 0.0010, 1.800),
                           (0.0, (top + low) / 2 - 0.0035, 1.775),
                           (0.0, low - 0.0045, f["brow_z"] + 0.012)], 6)
    v, fc = M.chain(chain_pts, link_len=0.0072, link_r=0.00085)
    add_mesh("LELU_ForeheadChain", v, fc, "Jewelry", mats["copper"], uv=False)
    v, fc = M.gem(radius=0.0058, length=0.011, facets=8)
    add_mesh("LELU_ForeheadGem",
             v + np.array([0.0, low - 0.0085, f["brow_z"] + 0.0035]),
             fc, "Jewelry", mats["crystal"], uv=False, shade_flat=True)
    v, fc = M.bead(0.0024, facets=12)
    add_mesh("LELU_ForeheadBead",
             v + np.array([0.0, low - 0.0065, f["brow_z"] - 0.0015]),
             fc, "Jewelry", mats["copper"], uv=False)
    return parts


def build_ears(mats):
    f = D.FACE
    for side in (-1, 1):
        rx, ry, y0, _p = profile_at(D.HEAD, 1.678)
        v, fc = M.bead(0.0155, facets=18)
        v = v * np.array([0.42, 0.92, 1.30])
        add_mesh(f"LELU_Ear_{'L' if side > 0 else 'R'}",
                 v + np.array([side * (rx - 0.004), y0 + 0.012, 1.678]), fc, "Face",
                 mats["skin"], uv=True, subsurf=1)


def build_hoops(mats):
    """Two hoops per ear, hanging from the lobe — not floating beside the jaw."""
    for side in (-1, 1):
        rx, ry, y0, _p = profile_at(D.HEAD, 1.664)
        for i, (major, z) in enumerate(((D.JEWELRY["hoop_earring"], 1.640),
                                        (D.JEWELRY["hoop_earring"] * 0.66, 1.646))):
            v, fc = M.torus_link(major=major, minor=0.0022, seg=40, sides=10)
            v = M.transform(v, rot=(0, 90, 0),
                            translate=(side * (rx - 0.002 + 0.003 * i),
                                       y0 + 0.014, z))
            add_mesh(f"LELU_Hoop_{'L' if side > 0 else 'R'}_{i}", v, fc, "Jewelry",
                     mats["copper"], uv=False)


# ---------------------------------------------------------------------- hair
def _curl_clump(root, direction, length, rng, spec, r0, clump=10, seg=18):
    """One curl shared by `clump` strands. The clump is the visual unit of
    curly hair; the strands give it a broken, strand-level edge.

    Turn count comes from the strand length at a fixed 4.2 cm wavelength,
    which is what makes it read as a ringlet rather than waved straw."""
    curl_r = spec["curl_radius"] * rng.uniform(0.8, 1.4)
    turns = max(1.2, (length / 0.042) * rng.uniform(0.8, 1.2))
    gravity = rng.uniform(0.45, 0.8)
    parts = []
    for k in range(clump):
        offset = np.array([rng.normal(0, 0.0055), rng.normal(0, 0.0055), rng.normal(0, 0.0035)])
        parts.append(M.hair_strand(
            root + offset, direction, length * rng.uniform(0.9, 1.1),
            curl_r=curl_r * rng.uniform(0.88, 1.12), turns=turns * rng.uniform(0.94, 1.06),
            seg=seg, sides=5, r0=r0 * rng.uniform(0.88, 1.12),
            gravity=gravity, jitter=0.02, rng=rng))
    return parts


def hair_mass_rings(n=72):
    """The dark volume the curls sit on: a sculpted curtain that frames the
    face and falls to the ribs. Without it, curls read as wire against the
    backdrop instead of hair with body."""
    spec = D.HAIR_SPEC
    m = _HEAD_METRICS
    k = float(np.clip(m["head_r"] / 0.088, 0.92, 1.04))
    dz = m["head_top"] - 1.830
    base_profile = [
        # z, radius_x, radius_y, y_centre
        (1.822, 0.075, 0.082, 0.004),
        (1.800, 0.098, 0.104, 0.006),
        (1.770, 0.118, 0.122, 0.010),
        (1.735, 0.136, 0.134, 0.012),
        (1.690, 0.150, 0.142, 0.014),
        (1.640, 0.160, 0.148, 0.014),
        (1.580, 0.168, 0.152, 0.012),
        (1.520, 0.172, 0.152, 0.010),
        (1.450, 0.168, 0.148, 0.008),
        (1.370, 0.158, 0.138, 0.006),
        (1.290, 0.144, 0.126, 0.004),
        (1.220, 0.126, 0.110, 0.002),
        (1.180, 0.104, 0.092, 0.000),
        (1.160, 0.070, 0.062, 0.000),
    ]
    profile = [(z + dz, rx * k, ry * k, yc) for z, rx, ry, yc in base_profile]
    # the face stays open: the curtain spans the back and sides only
    opening = math.radians(36.0)        # half-width of the face opening at the front
    rng = np.random.default_rng(4242)
    rings = []
    for z, rx, ry, yc in profile:
        pts = []
        # above the hairline the hair covers the whole skull; the opening is
        # only for the face
        op = 0.0 if z > m["eye_z"] + 0.052 else opening
        for j in range(n):
            t = j / (n - 1)
            theta = -math.pi / 2 + op + t * (2 * math.pi - 2 * op)
            # clump the surface so it is not a smooth shell
            bulge = 1.0 + 0.055 * math.sin(theta * 7.0 + z * 40.0) + 0.03 * rng.normal(0, 1)
            x = math.cos(theta) * rx * bulge
            y = math.sin(theta) * ry * bulge + yc
            pts.append((x, y, z))
        rings.append(np.asarray(pts))
    return rings


def build_hair(mats, seed=1234):
    """Hair as a dark sculpted mass with corkscrew curl clumps over it."""
    spec = D.HAIR_SPEC
    rng = np.random.default_rng(seed)
    scalp_z = spec["scalp_ring_z"]
    black_parts, pink_parts = [], []
    clump = int(spec.get("clump_size", 8))

    # 1) the mass
    rings = hair_mass_rings()
    verts, faces = M.loft(rings, close_ring=False, cap_start=False, cap_end=True)
    add_mesh("LELU_HairMass", verts, faces, "Hair", mats["hair"], uv=False, subsurf=1)

    # 2) curl clumps on the mass surface, in three depth shells
    for shell, (r_scale, length_scale, r0) in enumerate((
            (1.02, 0.55, 0.0030), (1.10, 0.85, 0.0032), (1.18, 1.00, 0.0028))):
        for _ in range(int(150 * (1.0 - 0.12 * shell))):
            theta = rng.uniform(-math.pi / 2 + math.radians(40), math.pi * 1.5 - math.radians(40))
            z = rng.uniform(1.19, 1.815)
            # sample the mass profile at this height
            prof = np.array([[1.822, 0.075, 0.082], [1.800, 0.098, 0.104], [1.770, 0.118, 0.122],
                             [1.735, 0.136, 0.134], [1.690, 0.150, 0.142], [1.640, 0.160, 0.148],
                             [1.580, 0.168, 0.152], [1.520, 0.172, 0.152], [1.450, 0.168, 0.148],
                             [1.370, 0.158, 0.138], [1.290, 0.144, 0.126], [1.220, 0.126, 0.110],
                             [1.180, 0.104, 0.092], [1.160, 0.070, 0.062]])
            zc = float(np.clip(z, prof[0, 0], prof[-1, 0]))
            rx = np.interp(zc, prof[::-1, 0], prof[::-1, 1])
            ry = np.interp(zc, prof[::-1, 0], prof[::-1, 2])
            root = np.array([math.cos(theta) * rx * r_scale,
                             math.sin(theta) * ry * r_scale + 0.01,
                             z])
            outward = np.array([math.cos(theta) * 0.9, math.sin(theta) * 0.9, 0.0])
            direction = outward * rng.uniform(0.25, 0.6) + np.array([0.0, 0.0, -1.0])
            length = rng.uniform(0.10, 0.24) * length_scale
            parts = _curl_clump(root, direction, length, rng, spec, r0,
                                clump=clump, seg=16)
            pink = (rng.random() < 0.14) or (math.cos(theta) < -0.6 and rng.random() < 0.45)
            (pink_parts if pink else black_parts).extend(parts)

    # 3) the hairline: short curls swept back off the brow
    for _ in range(30):
        side = 1 if rng.random() < 0.5 else -1
        theta = math.radians(-90 + side * rng.uniform(38, 96))
        rx, ry, y0, _p = profile_at(D.HEAD, 1.790)
        root = np.array([math.cos(theta) * rx * 1.02, math.sin(theta) * ry * 1.02 + y0,
                         1.790 - rng.uniform(0.0, 0.006)])
        direction = np.array([math.cos(theta) * 1.5, math.sin(theta) * 0.5, -1.0])
        parts = _curl_clump(root, direction, rng.uniform(0.06, 0.11), rng,
                            {**spec, "curl_radius": 0.015}, 0.0022, clump=6, seg=12)
        black_parts.extend(parts)

    v, f = M.merge(*black_parts)
    hair = add_mesh("LELU_Hair", v, f, "Hair", mats["hair"], uv=False)
    v, f = M.merge(*pink_parts)
    hair_pink = add_mesh("LELU_Hair_Rose", v, f, "Hair", mats["hair_pink"], uv=False)
    return hair, hair_pink


def build_hair_roses(mats):
    for i, (x, y, z, scale, tilt) in enumerate(D.ROSES[:6]):
        v, f = M.rose(petal_count=7, rings=3, radius=scale, height=scale * 0.8)
        v = M.transform(v, rot=(tilt * 0.4, 0, tilt), translate=(x, y, z))
        add_mesh(f"LELU_HairRose_{i:02d}", v, f, "Hair", mats["fabric_mauve"],
                 uv=True, subsurf=1)
        for k in range(2):
            lv, lf = M.leaf(length=scale * 0.9, width=scale * 0.42)
            lv = M.transform(lv, rot=(60, 0, k * 120 + tilt),
                             translate=(x + 0.006 * (k - 0.5), y + 0.004, z - scale * 0.35))
            add_mesh(f"LELU_HairRose_{i:02d}_leaf{k}", lv, lf, "Hair",
                     mats["fabric_mauve"], uv=True)


def build_hair_chains(mats):
    for i, (x, y, z, length, link, gem_drop) in enumerate(D.HAIR_CHAINS):
        pts = []
        for k in range(6):
            s = k / 5
            pts.append((x + 0.014 * math.sin(s * 3.0), y - 0.010 * s, z - length * s))
        path = M.catmull(pts, 6)
        v, f = M.chain(path, link_len=link, link_r=0.0011)
        add_mesh(f"LELU_HairChain_{i:02d}", v, f, "Jewelry", mats["copper"], uv=False)
        for k in range(3):
            bv, bf = M.bead(0.0044 if k else 0.0062, facets=14)
            add_mesh(f"LELU_HairChain_{i:02d}_bead{k}", bv + np.array(pts[1 + k]),
                     bf, "Jewelry", mats["copper"], uv=False)
        if gem_drop:
            gv, gf = M.gem(radius=0.0072, length=0.022, facets=8)
            add_mesh(f"LELU_HairChain_{i:02d}_gem",
                     gv + np.array([path[-1][0], path[-1][1], path[-1][2] - 0.014]),
                     gf, "Jewelry", mats["crystal"], uv=False, shade_flat=True)


# ------------------------------------------------------------------ jeweller
def build_necklaces(mats):
    f = D.FACE
    # choker: a camo-print band with copper rings, ref_B
    rz = np.linspace(1.586, 1.612, 6)
    rings = []
    for z in rz:
        rx, ry, y0, power = profile_at(D.HEAD, z)
        rings.append(M.ring((0.0, y0, z), rx + 0.004, ry + 0.004, n=64, power=power))
    v, fc = M.loft(rings, cap_start=False, cap_end=False)
    add_mesh("LELU_Choker", v, fc, "Clothing", mats["fabric"], uv=True, thickness=0.0022)

    # layered throat chains
    for i, drop in enumerate((0.0, 0.018, 0.032)):
        pts = []
        for k in range(9):
            s = k / 8
            ang = math.pi * (0.12 + 0.76 * s)
            rx, ry, y0, _ = profile_at(D.TORSO, 1.575 - drop)
            pts.append((math.cos(ang) * (rx + 0.014), math.sin(ang) * (ry + 0.014) + y0,
                        1.575 - drop - 0.02 * math.sin(math.pi * s)))
        v, fc = M.chain(np.asarray(pts), link_len=0.0125, link_r=0.0015)
        add_mesh(f"LELU_NeckChain_{i}", v, fc, "Jewelry", mats["copper"], uv=False)

    # statement pendant: two copper spheres, a link and a long crystal drop (ref_B)
    jp = D.JEWELRY["pendant"]
    base_z = 1.470
    v, fc = M.bead(jp["sphere_r"], facets=24)
    add_mesh("LELU_Pendant_1", v + np.array([0.0, -0.118, base_z - 0.010]), fc,
             "Jewelry", mats["copper"], uv=False)
    v, fc = M.bead(jp["sphere_r"] * 0.86, facets=24)
    add_mesh("LELU_Pendant_2", v + np.array([0.0, -0.116, base_z - 0.062]), fc,
             "Jewelry", mats["copper"], uv=False)
    for i, z in enumerate((base_z - 0.038, base_z - 0.086)):
        v, fc = M.torus_link(major=0.016, minor=0.0026, seg=32, sides=10)
        v = M.transform(v, rot=(0, 90, 0), translate=(0.0, -0.118, z))
        add_mesh(f"LELU_Pendant_Ring_{i}", v, fc, "Jewelry", mats["copper"], uv=False)
    v, fc = M.gem(radius=0.016, length=jp["crystal_len"], facets=8)
    add_mesh("LELU_Pendant_Crystal", v + np.array([0.0, -0.116, base_z - 0.150]),
             fc, "Jewelry", mats["crystal"], uv=False, shade_flat=True)
    # the chain that carries the pendant up to the collarbones
    pts = M.catmull([(-0.070, -0.070, 1.545), (-0.030, -0.108, 1.500),
                     (0.0, -0.118, 1.480), (0.030, -0.108, 1.500),
                     (0.070, -0.070, 1.545)], 6)
    v, fc = M.chain(pts, link_len=0.012, link_r=0.0014)
    add_mesh("LELU_Pendant_Chain", v, fc, "Jewelry", mats["copper"], uv=False)


def build_forearm_cuffs(mats):
    """Stacked leather-and-copper cuffs with studs, ref_F/ref_G."""
    bands = D.JEWELRY["cuff_bands_per_arm"]
    for side in (-1, 1):
        for b in range(bands):
            z = 1.140 - b * 0.024 + 0.005 * math.sin(b)
            x = side * (0.199 + 0.0022 * b)
            rx, ry = 0.0375 - 0.0013 * b, 0.0355 - 0.0012 * b
            rings = []
            for dz in (-0.0075, 0.0, 0.0075):
                rings.append(M.ring((x, 0.004, z + dz), rx, ry, n=40, power=2.1))
            v, fc = M.loft(rings)
            add_mesh(f"LELU_Cuff_{'L' if side > 0 else 'R'}_{b}", v, fc, "Clothing",
                     mats["leather"], uv=True, thickness=0.0035)
            for k in range(6):
                ang = 2 * math.pi * k / 6
                sv, sf = M.stud(0.0032, 0.0020)
                add_mesh(f"LELU_CuffStud_{side}_{b}_{k}",
                         M.transform(sv, translate=(x + math.cos(ang) * (rx + 0.003),
                                                    0.004 + math.sin(ang) * (ry + 0.003), z)),
                         sf, "Jewelry", mats["copper"], uv=False)
            if b in (0, 2, 4):
                # hanging crystal drop on each cuff
                gv, gf = M.gem(radius=0.0058, length=0.020, facets=8)
                add_mesh(f"LELU_CuffDrop_{side}_{b}",
                         gv + np.array([x - side * (rx + 0.004), 0.004, z - 0.020]),
                         gf, "Jewelry", mats["crystal"], uv=False, shade_flat=True)


def build_rings_and_nails(mats):
    """The knuckle rings and cuff bands: the finger rings and nails are built
    with the hand itself (build_hand), so they sit on real fingers."""
    for side in (-1, 1):
        label = "L" if side > 0 else "R"
        for i, off in enumerate((-0.0145, -0.0048, 0.0048)):
            v, fc = M.plate(width=0.0090, height=0.0075, thick=0.0030, bevel=0.0016)
            add_mesh(f"LELU_KnucklePlate_{label}_{i}",
                     M.transform(v, rot=(90, 0, 0),
                                 translate=(side * (ARM["wrist"][0] + 0.004 + off),
                                            ARM["wrist"][1] - 0.020, ARM["wrist"][2] - 0.062)),
                     fc, "Jewelry", mats["copper"], uv=False)


# ------------------------------------------------------------------ clothing
def build_corset(mats):
    """Bustier fitted to the sculpted chest: real cups, a scooped neckline and
    a centre buckle. Built from body slices, so it follows the body."""
    top = 1.470
    bottom = 1.118
    rows = 22
    cols = 72
    rings = []
    for i in range(rows + 1):
        u = i / rows
        z = bottom + (top - bottom) * u
        ring = body_slice(z, n=cols, grow=0.008 + 0.004 * math.sin(u * math.pi))
        # body_slice may return fewer points than requested; derive the count
        n_ring = len(ring)
        # scoop the neckline at the front, raise it at the back
        for j in range(n_ring):
            ang = -math.pi + 2 * math.pi * (j + 0.5) / n_ring
            front = max(0.0, -math.sin(ang))
            ring[j, 2] -= 0.052 * front ** 2.4 * u ** 2.0
        rings.append(ring)
    verts, faces = M.loft(rings, cap_start=False, cap_end=False)
    corset = add_mesh("LELU_Corset", verts, faces, "Clothing", mats["fabric"],
                      uv=True, thickness=0.0035, subsurf=1)
    v, fc = M.plate(width=0.030, height=0.024, thick=0.005, bevel=0.005)
    zc = 1.300
    front = surface_front(_BODY_VERTS, 0.0, zc, 0.05) if _BODY_VERTS is not None else -0.11
    add_mesh("LELU_CenterBuckle", v + np.array([0.0, front - 0.012, zc]), fc,
             "Clothing", mats["copper"], uv=False)
    v, fc = M.plate(width=0.010, height=0.052, thick=0.004, bevel=0.003)
    add_mesh("LELU_CenterDrop", v + np.array([0.0, front - 0.013, zc - 0.040]), fc,
             "Clothing", mats["copper"], uv=False)
    return corset


def leg_path(side, z_top=1.010, z_bottom=0.230, phases=9):
    pts = []
    for i in range(phases):
        s = i / (phases - 1)
        z = z_top + (z_bottom - z_top) * s
        x = side * (0.090 + 0.010 * s + 0.004 * math.sin(s * 3.1))
        y = 0.004 * math.sin(s * 4.0) - 0.004
        pts.append((x, y, z))
    return np.asarray(pts)


def build_pants(mats):
    """Wide-leg trousers fitted to the legs, draped and gathered at the boot."""
    z_top, z_bottom = 1.062, 0.300
    rows = 26
    for side in (-1, 1):
        rings = []
        for i in range(rows + 1):
            t = i / rows
            z = z_top + (z_bottom - z_top) * t
            bag = 0.040 + 0.020 * math.sin(t * math.pi * 0.9) - 0.018 * max(0.0, t - 0.82) * 4.0
            fold = 0.007 * math.sin(t * 19.0 + side) + 0.004 * math.sin(t * 8.0 + 1.3)
            rings.append(leg_slice(z, side, n=56, grow=bag + fold))
        verts, faces = M.loft(rings, cap_start=False, cap_end=True)
        add_mesh(f"LELU_Pants_{'L' if side > 0 else 'R'}", verts, faces, "Clothing",
                 mats["fabric"], uv=True, thickness=0.004, subsurf=1)
    rz = np.linspace(1.016, 1.074, 5)
    rings = [body_slice(z, n=72, grow=0.012) for z in rz]
    verts, faces = M.loft(rings)
    add_mesh("LELU_HipYoke", verts, faces, "Clothing", mats["fabric"], uv=True,
             thickness=0.004)


def build_hip_rig(mats):
    """Belt and buckle on the real hip line (the pouch/ribbon rig is rebuilt
    in the next pass; its old coordinates belong to the previous body)."""
    rz = np.linspace(1.058, 1.088, 4)
    rings = [body_slice(z, n=72, grow=0.016) for z in rz]
    v, fc = M.loft(rings)
    add_mesh("LELU_Belt", v, fc, "Clothing", mats["leather"], uv=True, thickness=0.004)
    front = surface_front(_BODY_VERTS, 0.0, 1.072, 0.06) if _BODY_VERTS is not None else -0.13
    v, fc = M.plate(width=0.036, height=0.028, thick=0.005, bevel=0.005)
    add_mesh("LELU_BeltBuckle", v + np.array([0.0, front - 0.010, 1.072]), fc,
             "Clothing", mats["copper"], uv=False)


def build_sleeves(mats):
    """Sleeve fitted from the arm joints, with a pauldron rose on the shoulder."""
    J = _JOINTS
    if not J:
        return
    for side, tag in ((1, "l"), (-1, "r")):
        S = J[f"joint-{tag}-shoulder"]
        E = J[f"joint-{tag}-elbow"]
        W = J[f"joint-{tag}-hand"]
        path = M.catmull([S, (S + E) / 2, E, (E + W) / 2, W * 0.98 + E * 0.02], 6)
        key_r = [0.052, 0.044, 0.038, 0.034, 0.030]
        radii = np.interp(np.linspace(0, 1, len(path)), np.linspace(0, 1, len(key_r)), key_r)
        v, fc = M.tube(path, radii, sides=32, cap=True)
        add_mesh(f"LELU_Sleeve_{'L' if side > 0 else 'R'}", v, fc, "Clothing",
                 mats["fabric"], uv=True, thickness=0.003, subsurf=1)
    # pauldron on the left shoulder
    S = J["joint-l-shoulder"]
    v, fc = M.rose(petal_count=6, rings=3, radius=0.026, height=0.019)
    add_mesh("LELU_PauldronRose",
             M.transform(v, rot=(-40, 0, 10),
                         translate=(S[0] + 0.012, S[1] - 0.030, S[2] + 0.020)),
             fc, "Clothing", mats["fabric_mauve"], uv=True, subsurf=1)


def build_boots(mats):
    """Platform boots: lug sole, shaft, laces, buckles, chains, drops (ref_D)."""
    for side in (-1, 1):
        x = side * 0.082
        # shaft: a tall, wide platform boot (ref_D)
        pts = M.catmull([(x, 0.004, 0.150), (x, 0.006, 0.255), (x, 0.008, 0.395)], 6)
        radii = np.linspace(0.092, 0.082, len(pts))
        v, fc = M.tube(pts, radii, sides=40, cap=False)
        add_mesh(f"LELU_BootShaft_{'L' if side > 0 else 'R'}", v, fc, "Boots",
                 mats["fabric"], uv=True, thickness=0.005)
        # foot upper
        foot = M.catmull([(x, 0.010, 0.150), (x, -0.032, 0.142), (x, -0.095, 0.138),
                          (x, -0.150, 0.124)], 6)
        radii = [0.086, 0.082, 0.074, 0.050]
        vr = np.interp(np.linspace(0, 1, len(foot)), np.linspace(0, 1, len(radii)), radii)
        v, fc = M.tube(foot, vr, sides=32, cap=True, squash=(1.0, 1.35))
        add_mesh(f"LELU_BootUpper_{'L' if side > 0 else 'R'}", v, fc, "Boots",
                 mats["fabric"], uv=True, thickness=0.004)

        # platform sole: slab + lug blocks, ref_D
        sole_h = D.CLOTHING["boots"]["sole_h"]
        rings = [
            np.array([[x - 0.086, -0.190, 0.0], [x + 0.086, -0.190, 0.0],
                      [x + 0.086, 0.128, 0.0], [x - 0.086, 0.128, 0.0]]),
            np.array([[x - 0.094, -0.200, sole_h * 0.45], [x + 0.094, -0.200, sole_h * 0.45],
                      [x + 0.094, 0.136, sole_h * 0.45], [x - 0.094, 0.136, sole_h * 0.45]]),
            np.array([[x - 0.084, -0.186, sole_h], [x + 0.084, -0.186, sole_h],
                      [x + 0.084, 0.122, sole_h], [x - 0.084, 0.122, sole_h]]),
        ]
        v, fc = M.loft(rings, cap_start=True, cap_end=True)
        add_mesh(f"LELU_BootSole_{'L' if side > 0 else 'R'}", v, fc, "Boots",
                 mats["rubber"], uv=False, shade_flat=False)
        # lugs
        for i in range(7):
            yy = -0.160 + i * 0.040
            v, fc = M.plate(width=0.140, height=0.030, thick=sole_h * 0.55, bevel=0.006)
            add_mesh(f"LELU_Lug_{side}_{i}",
                     M.transform(v, rot=(90, 0, 0), translate=(x, yy, 0.004)),
                     fc, "Boots", mats["rubber"], uv=False)
        # heel block
        v, fc = M.plate(width=0.140, height=0.075, thick=0.030, bevel=0.008)
        add_mesh(f"LELU_Heel_{side}", M.transform(v, rot=(90, 0, 0),
                                                  translate=(x, 0.090, 0.010)),
                 fc, "Boots", mats["rubber"], uv=False)
        # metal sole trim
        v, fc = M.torus_link(major=0.075, minor=0.0045, seg=40, sides=8)
        v = M.transform(v, rot=(90, 0, 0), scale=1.0, translate=(x, -0.030, sole_h * 0.75))
        add_mesh(f"LELU_SoleTrim_{side}", v, fc, "Boots", mats["copper"], uv=False)

        # laces
        for k in range(D.CLOTHING["boots"]["laces"]):
            z = 0.180 + k * 0.022
            for s in (-1, 1):
                pts = M.catmull([(x - 0.030 * s, -0.062, z), (x + 0.030 * s, -0.070, z + 0.020)], 5)
                v, fc = M.tube(pts, 0.0022, sides=6)
                add_mesh(f"LELU_Lace_{side}_{k}_{s}", v, fc, "Boots",
                         mats["leather"], uv=False)
        # straps + buckles around the shaft
        for k in range(D.CLOTHING["boots"]["buckles"]):
            z = 0.200 + k * 0.062
            rings = [M.ring((x, 0.006, z + dz), 0.081 - k * 0.002, 0.078 - k * 0.002,
                            n=40, power=2.1) for dz in (-0.006, 0.0, 0.006)]
            v, fc = M.loft(rings)
            add_mesh(f"LELU_BootStrap_{side}_{k}", v, fc, "Boots",
                     mats["leather"], uv=True, thickness=0.003)
            v, fc = M.plate(width=0.024, height=0.018, thick=0.005, bevel=0.004)
            add_mesh(f"LELU_BootBuckle_{side}_{k}",
                     v + np.array([x + side * 0.078, -0.030, z]), fc,
                     "Boots", mats["copper"], uv=False)
        # ankle chains with crystal drops
        path = M.catmull([(x - 0.070, -0.045, 0.230), (x, -0.086, 0.196),
                          (x + 0.070, -0.045, 0.230)], 8)
        v, fc = M.chain(path, link_len=0.014, link_r=0.0016)
        add_mesh(f"LELU_AnkleChain_{side}", v, fc, "Jewelry", mats["copper"], uv=False)
        for k, dx in enumerate((-0.045, 0.0, 0.045)):
            gv, gf = M.gem(radius=0.0075, length=0.030, facets=8)
            add_mesh(f"LELU_AnkleDrop_{side}_{k}",
                     gv + np.array([x + dx, -0.086 + abs(dx) * 0.5, 0.176 - (0.0 if dx else 0.008)]),
                     gf, "Jewelry", mats["crystal"], uv=False, shade_flat=True)


def build_garment_roses(mats):
    for i, (x, y, z, scale, tilt) in enumerate(D.ROSES[6:], start=6):
        v, f = M.rose(petal_count=7, rings=3, radius=scale, height=scale * 0.55)
        v = M.transform(v, rot=(tilt + 90, 0, 0), translate=(x, y, z))
        add_mesh(f"LELU_GarmentRose_{i:02d}", v, f, "Clothing", mats["fabric_mauve"],
                 uv=True, subsurf=1)


# ------------------------------------------------------------------- rigging
BONES = [
    # name, head, tail, parent, connected
    ("root", (0, 0, 0), (0, 0, 0.10), None, False),
    ("hips", (0, 0, 1.02), (0, 0, 1.12), "root", False),
    ("spine01", (0, 0, 1.12), (0, 0, 1.22), "hips", True),
    ("spine02", (0, 0, 1.22), (0, 0, 1.32), "spine01", True),
    ("spine03", (0, 0, 1.32), (0, 0, 1.42), "spine02", True),
    ("chest", (0, 0, 1.42), (0, 0, 1.52), "spine03", True),
    ("neck", (0, 0, 1.545), (0, 0, 1.655), "chest", False),
    ("head", (0, 0, 1.655), (0, 0, 1.820), "neck", True),
    ("jaw", (0, -0.020, 1.700), (0, -0.078, 1.678), "head", False),
    ("eye_L", (0.0325, -0.070, 1.730), (0.0325, -0.086, 1.730), "head", False),
    ("eye_R", (-0.0325, -0.070, 1.730), (-0.0325, -0.086, 1.730), "head", False),
]
for _side, _s in (("L", 1), ("R", -1)):
    BONES += [
        (f"clavicle_{_side}", (0, 0, 1.510), (_s * 0.105, 0, 1.520), "chest", False),
        (f"upperarm_{_side}", (_s * 0.175, 0, 1.505), (_s * 0.246, 0, 1.215), f"clavicle_{_side}", True),
        (f"forearm_{_side}", (_s * 0.246, 0, 1.215), (_s * 0.278, 0.004, 0.985), f"upperarm_{_side}", True),
        (f"hand_{_side}", (_s * 0.278, 0.004, 0.985), (_s * 0.280, 0.004, 0.930), f"forearm_{_side}", True),
        (f"thigh_{_side}", (_s * 0.082, 0, 1.000), (_s * 0.070, 0.004, 0.500), "hips", False),
        (f"shin_{_side}", (_s * 0.070, 0.004, 0.500), (_s * 0.078, 0.004, 0.100), f"thigh_{_side}", True),
        (f"foot_{_side}", (_s * 0.078, 0.004, 0.100), (_s * 0.080, -0.100, 0.020), f"shin_{_side}", True),
        (f"toe_{_side}", (_s * 0.080, -0.100, 0.020), (_s * 0.080, -0.160, 0.015), f"foot_{_side}", True),
    ]
    for _f, (_fx, _fz) in enumerate(((0.020, 0.975), (0.008, 0.972), (-0.004, 0.970), (-0.016, 0.968))):
        BONES += [
            (f"f{_f}_01_{_side}", (_s * 0.278, _fx + 0.006, _fz),
             (_s * 0.278, _fx + 0.006, _fz - 0.022), f"hand_{_side}", False),
            (f"f{_f}_02_{_side}", (_s * 0.278, _fx + 0.006, _fz - 0.022),
             (_s * 0.278, _fx + 0.006, _fz - 0.044), f"f{_f}_01_{_side}", True),
        ]
    BONES += [
        (f"thumb_01_{_side}", (_s * 0.284, 0.006, 0.968), (_s * 0.292, 0.018, 0.950), f"hand_{_side}", False),
        (f"thumb_02_{_side}", (_s * 0.292, 0.018, 0.950), (_s * 0.296, 0.030, 0.936), f"thumb_01_{_side}", True),
    ]


def build_rig():
    arm_data = bpy.data.armatures.new("LELU_Rig")
    rig = bpy.data.objects.new("LELU_Rig", arm_data)
    collection("Rig").objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for name, head, tail, parent, connected in BONES:
        bone = arm_data.edit_bones.new(name)
        bone.head = Vector(head)
        bone.tail = Vector(tail)
        bone.use_deform = True
        created[name] = bone
    for name, head, tail, parent, connected in BONES:
        if parent:
            created[name].parent = created[parent]
            created[name].use_connect = connected
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


# ---------------------------------------------------------------- face keys
def add_face_keys():
    """ARKit-style shape keys built from smooth displacement fields."""
    head = bpy.data.objects.get("LELU_Head")
    if head is None:
        return []
    bpy.context.view_layer.objects.active = head
    head.shape_key_add(name="Basis", from_mix=False)
    keys = {}
    f = D.FACE
    rows = len(head.data.vertices)
    coords = np.array([[v.co.x, v.co.y, v.co.z] for v in head.data.vertices])

    def field(name, fn):
        key = head.shape_key_add(name=name, from_mix=False)
        key.value = 0.0
        for i in range(rows):
            d = fn(coords[i])
            key.data[i].co = Vector((coords[i][0] + d[0], coords[i][1] + d[1], coords[i][2] + d[2]))
        keys[name] = key

    for side in (-1, 1):
        label = "L" if side > 0 else "R"
        eyex, eyez = side * f["eye_x"], f["eye_z"]

        def blink(c, eyex=eyex, eyez=eyez):
            r = math.hypot((c[0] - eyex) / 0.020, (c[2] - eyez) / 0.012)
            a = 0.0075 * math.exp(-(r ** 2) / 0.9)
            return np.array([0.0, a * 0.25, a * (1.0 if c[2] > eyez else -1.0)])

        field(f"eyeBlink{label}", blink)

        def brow_down(c, eyex=eyex):
            r = math.hypot((c[0] - eyex) / 0.024, (c[2] - (f["brow_z"] + 0.004)) / 0.010)
            return np.array([0.0, 0.0, -0.0045 * math.exp(-(r ** 2) / 1.0)])

        field(f"browDown{label}", brow_down)

        def smile(c, s=side):
            r = math.hypot((c[0] - s * f["mouth_w"] * 0.95) / 0.016,
                           (c[2] - f["mouth_z"]) / 0.016)
            a = 0.0042 * math.exp(-(r ** 2) / 1.0)
            return np.array([s * a * 0.7, -a * 0.35, a * 0.55])

        field(f"mouthSmile{label}", smile)

    def jaw_open(c):
        t = np.clip((f["mouth_z"] + 0.004 - c[2]) / 0.030, 0, 1)
        return np.array([0.0, 0.0, -0.016 * t ** 0.7])

    field("jawOpen", jaw_open)

    def brow_inner_up(c):
        t = math.exp(-((abs(c[0]) - 0.012) / 0.020) ** 2) * math.exp(-((c[2] - (f["brow_z"] + 0.006)) / 0.014) ** 2)
        return np.array([0.0, 0.0, 0.0055 * t])

    field("browInnerUp", brow_inner_up)
    bpy.context.view_layer.objects.active = None
    return list(keys)


# -------------------------------------------------------------------- export
def bind_rig(rig):
    """Auto-weight the body/face; rigid-parent every hard prop to its bone."""
    rigid = {
        "Jewelry": "chest",
        "Boots": "foot_L",
    }
    deform = ["LELU_Body", "LELU_Head", "LELU_Corset", "LELU_HipYoke", "LELU_Belt",
              "LELU_Pants_L", "LELU_Pants_R", "LELU_Sleeve_L", "LELU_Sleeve_R",
              "LELU_Choker", "LELU_Scalp", "LELU_Arm_L", "LELU_Arm_R",
              "LELU_Leg_L", "LELU_Leg_R", "LELU_Palm_L", "LELU_Palm_R",
              "LELU_Foot_L", "LELU_Foot_R"]
    for name in deform:
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    # everything else follows the nearest sensible bone, rigidly
    for obj in list(bpy.data.objects):
        if obj.type != "MESH" or obj.name in deform:
            continue
        bone = "head" if obj.name in ("LELU_Lips", "LELU_Nose", "LELU_Lashes",
                                      "LELU_Brows", "LELU_Septum", "LELU_LipStud",
                                      "LELU_ForeheadChain", "LELU_ForeheadGem",
                                      "LELU_ForeheadBead", "LELU_Ear_L", "LELU_Ear_R",
                                      "LELU_Hair", "LELU_Hair_Rose", "LELU_Hooplane") else None
        if bone is None:
            side_tag = "L" if obj.matrix_world.translation.x > 0 else "R"
            if obj.name.startswith("LELU_Boot") or obj.name.startswith("LELU_Lug") or \
                    obj.name.startswith("LELU_Heel") or obj.name.startswith("LELU_Lace") or \
                    obj.name.startswith("LELU_Sole") or obj.name.startswith("LELU_Ankle"):
                bone = "foot_" + side_tag
            elif obj.name.startswith("LELU_Finger_"):
                parts = obj.name.split("_")
                bone = f"f{parts[2]}_01_{side_tag}"
            elif obj.name.startswith("LELU_Nail_"):
                parts = obj.name.split("_")
                bone = "thumb_02_" + side_tag if parts[2] == "thumb" else f"f{parts[2]}_02_{side_tag}"
            elif obj.name.startswith("LELU_Thumb_"):
                bone = "thumb_01_" + side_tag
            elif obj.name.startswith(("LELU_RingF_", "LELU_RingThumb_", "LELU_WristBand_",
                                      "LELU_KnucklePlate_", "LELU_Cuff", "LELU_CuffDrop",
                                      "LELU_CuffStud")):
                bone = "hand_" + side_tag
            elif obj.name.startswith("LELU_Ear_"):
                bone = "head"
            elif obj.name.startswith("LELU_Hair") or obj.name.startswith("LELU_Scalp"):
                bone = "head"
            elif obj.name.startswith(("LELU_Sleeve", "LELU_Pauldron")):
                bone = "upperarm_L"
            elif obj.name.startswith(("LELU_Pants", "LELU_Pocket", "LELU_Hip", "LELU_Pouch",
                                      "LELU_Belt")):
                bone = "hips"
            elif obj.name.startswith(("LELU_Corset", "LELU_Boning", "LELU_Strap",
                                      "LELU_Underwire", "LELU_Center", "LELU_Side")):
                bone = "spine02"
            else:
                bone = "chest"
        world = obj.matrix_world.copy()
        obj.parent = rig
        obj.parent_type = "BONE"
        obj.parent_bone = bone
        obj.matrix_world = world
    return deform


def export_all(rig, outdir, texture_manifest):
    scene = bpy.context.scene
    blend_path = os.path.join(outdir, "lelu_foundry.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    # apply modifiers on export copies so the GLB carries the smooth surface
    bpy.ops.object.select_all(action="DESELECT")
    exportables = [o for o in bpy.data.objects if o.type == "MESH"]
    for obj in exportables:
        obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig

    glb_path = os.path.join(outdir, "lelu_foundry.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb_path, export_format="GLB", use_selection=True,
        export_apply=False, export_yup=True, export_texcoords=True,
        export_normals=True, export_materials="EXPORT", export_image_format="AUTO",
        export_animations=False, export_skins=True, export_morph=True,
        export_def_bones=False, export_extras=True)
    fbx_path = os.path.join(outdir, "lelu_foundry.fbx")
    bpy.ops.export_scene.fbx(filepath=fbx_path, use_selection=True,
                             mesh_smooth_type="FACE", use_mesh_modifiers=False,
                             bake_anim=False, add_leaf_bones=False,
                             path_mode="COPY", embed_textures=True)
    return {"blend": blend_path, "glb": glb_path, "fbx": fbx_path}


# ------------------------------------------------------------------- QC data
def scene_report():
    objs = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = 0
    verts = 0
    non_manifold = {}
    loose = {}
    for obj in objs:
        mesh = obj.data
        verts += len(mesh.vertices)
        mesh.calc_loop_triangles()
        tris += len(mesh.loop_triangles)
        bm = bmesh.new()
        bm.from_mesh(mesh)
        nm = sum(1 for e in bm.edges if len(e.link_faces) not in (1, 2))
        loose_edges = sum(1 for e in bm.edges if not e.link_faces)
        if nm:
            non_manifold[obj.name] = nm
        if loose_edges:
            loose[obj.name] = loose_edges
        bm.free()
    rig = bpy.data.objects.get("LELU_Rig")
    head = bpy.data.objects.get("LELU_Head")
    return {
        "objects": len(objs),
        "object_names": sorted(o.name for o in objs),
        "vertices": verts,
        "triangles": tris,
        "materials": len(bpy.data.materials),
        "images": len([i for i in bpy.data.images if i.source == "FILE"]),
        "bones": len(rig.data.bones) if rig else 0,
        "shape_keys": [k.name for k in head.data.shape_keys.key_blocks] if head and head.data.shape_keys else [],
        "non_manifold": non_manifold,
        "loose_edges": loose,
        "inferred_surfaces": D.INFERRED,
        "collections": {c.name: len(c.objects) for c in bpy.data.collections},
    }


def main():
    argv = sys.argv
    opts = {}
    if "--" in argv:
        rest = argv[argv.index("--") + 1:]
        if rest:
            opts = json.loads(rest[0])
    elif len(argv) > 1 and argv[-1].strip().startswith("{"):
        opts = json.loads(argv[-1])

    outdir = os.path.abspath(opts.get("outDir", os.path.join(HERE, "..", "..",
                                                            "leluverse", "assets", "characters",
                                                            "lelu_character", "foundry", "v001")))
    os.makedirs(outdir, exist_ok=True)
    texdir = os.path.join(outdir, "textures")
    os.makedirs(texdir, exist_ok=True)
    started = time.time()

    print(f"[foundry] outDir={outdir}")
    reset_scene()

    size_scale = float(opts.get("textureScale", 1.0))
    manifest = texlib.build(texdir, size_scale=size_scale)
    mats = MAT.build_all(texdir, manifest)
    print(f"[foundry] textures + materials in {time.time() - started:.1f}s")

    base_path = opts.get("baseMesh") or os.path.join(
        HERE, "..", "..", "leluverse", "assets", "characters", "lelu_character",
        "foundry", "base", "base.obj")
    base_path = os.path.abspath(base_path)
    body_mode = opts.get("bodyMode", "procedural")
    used_base = os.path.exists(base_path) and body_mode == "base"
    if used_base:
        built = build_from_base(mats, base_path, float(opts.get("eyeHeight", 1.6985)))
        landmarks = built["landmarks"]
    else:
        build_body(mats)
        build_arms(mats)
        for side in (-1, 1):
            build_hand(side, mats)
        build_legs(mats)
        build_neck_head(mats)
        for side in (-1, 1):
            build_eye(side, mats)
            build_eyelids(side, mats)
        build_lashes(mats)
        build_brows(mats)
        build_nose(mats)
        build_mouth(mats)
        landmarks = {"eye_z": D.FACE["eye_z"], "shoulder_z": 1.50, "hip_z": 1.02}
    build_face_hardware(mats)
    build_hoops(mats)
    build_tattoos(mats)
    print(f"[foundry] body + face in {time.time() - started:.1f}s")

    if not opts.get("skipHair"):
        build_hair(mats)
        build_hair_roses(mats)
        build_hair_chains(mats)
    build_garment_roses(mats)

    build_necklaces(mats)
    build_forearm_cuffs(mats)
    build_rings_and_nails(mats)
    build_corset(mats)
    build_pants(mats)
    build_hip_rig(mats)
    build_sleeves(mats)
    build_boots(mats)
    print(f"[foundry] clothing + jewellery in {time.time() - started:.1f}s")

    keys = add_face_keys()
    rig = build_rig()
    bind_rig(rig)
    print(f"[foundry] rig + {len(keys)} face keys in {time.time() - started:.1f}s")

    files = export_all(rig, outdir, manifest)
    report = scene_report()
    report["files"] = {k: os.path.basename(v) for k, v in files.items()}
    report["build_seconds"] = round(time.time() - started, 1)
    report["design_source"] = "scripts/foundry/lelu_design.py"
    with open(os.path.join(outdir, "build_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k not in ("object_names", "non_manifold")},
                     indent=2))
    print(f"[foundry] done in {time.time() - started:.1f}s -> {outdir}")


if __name__ == "__main__":
    main()
