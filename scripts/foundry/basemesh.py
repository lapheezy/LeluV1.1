"""
==========================================================
LÉLU CHARACTER FOUNDRY — CC0 BASE MESH FOUNDATION
==========================================================

The head and body are not hand-lofted any more. They are built on
MakeHuman's base mesh, released CC0 in September 2020 (provenance
and sha256 in base/manifest.json). It gives the character what a
loft cannot: real craniofacial planes, a proper mouth and eyelid
topology, ten fingers, feet, an eye helper pair, teeth, lashes and
130 joint targets that the rig is derived from.

Coordinates
-----------
The OBJ is Y-up with the nose toward +Z. It is transformed once,
here, into the Foundry's space: Z-up, character facing -Y, soles on
z = 0, and the eye line landing on the design authority's eye height
so every garment and accessory measured in lelu_design.py still
lands where it belongs.

Design sculpt
-------------
The base is a neutral body. LÉLU's own form is added as smooth
vertex fields (bust, waist, hips, glutes, jaw taper, cheekbones,
orbital depth, brow, lip volume), and the arms are rotated out of
the base's A-pose into the reference's hanging pose.
==========================================================
"""

from __future__ import annotations

import collections
import math
import os

import numpy as np

SIDES = {"l": 1.0, "r": -1.0}

# groups that are helper geometry we either use or drop
KEEP_GROUPS = {
    "body": "body",
    "helper-l-eye": "eye_l",
    "helper-r-eye": "eye_r",
    "helper-l-lash": "lashes",
    "helper-l-eyelashes-1": "lashes",
    "helper-l-eyelashes-2": "lashes",
    "helper-r-eyelashes-1": "lashes",
    "helper-r-eyelashes-2": "lashes",
    "helper-upper-teeth": "teeth",
    "helper-lower-teeth": "teeth",
    "helper-tongue": "tongue",
    "helper-tights": "tights",
}


def parse_obj(path):
    """Vertices, per-group face lists (with the OBJ's own UV indices)."""
    verts, uvs = [], []
    groups = collections.defaultdict(list)
    current = "body"
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith("v "):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                uvs.append([float(x) for x in line.split()[1:3]])
            elif line.startswith("g "):
                current = line.split()[1].strip()
            elif line.startswith("f "):
                idx, uv_idx = [], []
                for token in line.split()[1:]:
                    parts = token.split("/")
                    idx.append(int(parts[0]) - 1)
                    uv_idx.append(int(parts[1]) - 1 if len(parts) > 1 and parts[1] else -1)
                groups[current].append((idx, uv_idx))
    return np.asarray(verts, dtype=np.float64), np.asarray(uvs, dtype=np.float64), groups


def transform(verts, eye_height, sole_y=None):
    """OBJ (Y-up, nose +Z) -> Foundry space (Z-up, facing -Y, soles on 0)."""
    v = np.asarray(verts, dtype=np.float64).copy()
    y0 = sole_y if sole_y is not None else float(v[:, 1].min())
    # scale so the eye line lands where the design authority puts it
    eye_y = 7.28
    scale = float(eye_height) / (eye_y - y0)
    out = np.empty_like(v)
    out[:, 0] = v[:, 0] * scale
    out[:, 1] = -v[:, 2] * scale
    out[:, 2] = (v[:, 1] - y0) * scale
    return out, scale


def joint_positions(verts_obj, groups, scale, sole_y, eye_height):
    """Joint target centres in Foundry space, keyed by their OBJ names."""
    out = {}
    for name, faces in groups.items():
        if not name.startswith("joint-"):
            continue
        ids = sorted({i for face in faces for i in face[0]})
        if not ids:
            continue
        centre = verts_obj[ids].mean(axis=0)
        out[name] = centre
    raw = {k: v for k, v in out.items()}
    # transform each centre with the same mapping
    eye_y = 7.28
    s = float(eye_height) / (eye_y - sole_y)
    mapped = {}
    for k, v in raw.items():
        mapped[k] = np.array([v[0] * s, -v[2] * s, (v[1] - sole_y) * s])
    return mapped


# ------------------------------------------------------------------ sculpt
def _gauss(p, centre, sigma):
    d = (p - centre) / sigma
    return math.exp(-0.5 * float(d @ d))


def sculpt_body(verts, groups, landmarks):
    """LÉLU's own anatomy added to the neutral base, in metres."""
    v = np.asarray(verts, dtype=np.float64).copy()
    eye_z = landmarks["eye_z"]
    shoulder_z = landmarks["shoulder_z"]
    hip_z = landmarks["hip_z"]
    out = v.copy()
    n = len(v)

    bust_z = eye_z - 0.286
    waist_z = eye_z - 0.418
    hip_centre_z = eye_z - 0.570

    # per-vertex group masks, so we only push skin where skin is
    body_ids = np.array(sorted({i for face in groups.get("body", []) for i in face[0]}))
    is_body = np.zeros(n, dtype=bool)
    is_body[body_ids] = True

    for i in range(n):
        if not is_body[i]:
            continue
        p = v[i]
        x, y, z = float(p[0]), float(p[1]), float(p[2])
        target = out[i]
        # bust: two forward lobes (the reference's full chest)
        for side in (-1.0, 1.0):
            t = _gauss(np.array([abs(x) - 0.070, y + 0.075, z - bust_z]),
                       np.zeros(3), np.array([0.055, 0.055, 0.050]))
            if t > 0.02:
                target[1] -= 0.048 * t
                target[0] += side * 0.006 * t
                target[2] -= 0.004 * t * np.sign(x)
        # hips and glutes
        t = _gauss(np.array([x, y + 0.02, z - hip_centre_z]),
                   np.zeros(3), np.array([0.135, 0.12, 0.075]))
        if t > 0.02:
            target[0] *= 1.0 + 0.075 * t
            target[1] += 0.012 * t * (1.0 if y > 0 else -1.0)
        for side in (-1.0, 1.0):
            t = _gauss(np.array([abs(x) - 0.075, y - 0.085, z - (hip_centre_z - 0.012)]),
                       np.zeros(3), np.array([0.070, 0.055, 0.062]))
            if t > 0.02:
                target[1] += 0.030 * t
        # waist
        t = _gauss(np.array([x, y, z - waist_z]), np.zeros(3), np.array([0.10, 0.10, 0.055]))
        if t > 0.02:
            target[0] *= 1.0 - 0.055 * t
            target[1] *= 1.0 - 0.045 * t
        # shoulders: squared deltoid shelf
        t = _gauss(np.array([abs(x) - 0.185, y, z - (shoulder_z + 0.010)]),
                   np.zeros(3), np.array([0.060, 0.070, 0.045]))
        if t > 0.02:
            target[0] += np.sign(x) * 0.012 * t
            target[1] *= 1.0 - 0.05 * t
        # face
        if z > eye_z - 0.115 and y < 0:
            # jaw taper to the reference's V line
            t = _gauss(np.array([abs(x), y, z - (eye_z - 0.088)]),
                       np.zeros(3), np.array([0.055, 0.060, 0.045]))
            if t > 0.02:
                target[0] *= 1.0 - 0.16 * t
            # cheekbone push
            for side in (-1.0, 1.0):
                t = _gauss(np.array([abs(x) - 0.052, y + 0.070, z - (eye_z - 0.024)]),
                           np.zeros(3), np.array([0.028, 0.040, 0.022]))
                if t > 0.02:
                    target[1] -= 0.006 * t
                    target[0] += side * 0.004 * t
            # orbital depth
            for side in (-1.0, 1.0):
                t = _gauss(np.array([abs(x) - 0.033, y + 0.085, z - eye_z]),
                           np.zeros(3), np.array([0.026, 0.035, 0.018]))
                if t > 0.02:
                    target[1] += 0.0045 * t
            # brow ridge
            for side in (-1.0, 1.0):
                t = _gauss(np.array([abs(x) - 0.034, y + 0.090, z - (eye_z + 0.021)]),
                           np.zeros(3), np.array([0.034, 0.035, 0.009]))
                if t > 0.02:
                    target[1] -= 0.0035 * t
            # fuller lips: push the vermilion band forward
            t = _gauss(np.array([x, y + 0.086, z - (eye_z - 0.052)]),
                       np.zeros(3), np.array([0.030, 0.030, 0.020]))
            if t > 0.02:
                target[1] -= 0.0075 * t
            # chin
            t = _gauss(np.array([x, y + 0.082, z - (eye_z - 0.080)]),
                       np.zeros(3), np.array([0.030, 0.035, 0.022]))
            if t > 0.02:
                target[1] -= 0.0060 * t
    return out


def pose_arms_down(verts, joints, target_hand_x):
    """Rotate each arm about its shoulder into the reference's hanging pose.

    The angle is solved numerically against the actual joint positions (a
    closed-form guess put the arm through the torso), and only the vertices
    outboard of the shoulder are moved, so the chest is untouched.
    """
    v = np.asarray(verts, dtype=np.float64).copy()
    rotations = {}
    moved = dict(joints)
    for side, sgn in (("l", 1.0), ("r", -1.0)):
        S = joints[f"joint-{side}-shoulder"].copy()
        H = joints[f"joint-{side}-hand"].copy()
        vec = H - S
        best_theta, best_cost = 0.0, None
        for theta in np.linspace(-1.15, 1.15, 231):
            ca, sa = math.cos(theta), math.sin(theta)
            x = vec[0] * ca - vec[2] * sa
            z = vec[0] * sa + vec[2] * ca
            cost = abs(x) + (2.0 if z > -0.05 else 0.0) + 0.25 * abs(theta)
            if best_cost is None or cost < best_cost:
                best_theta, best_cost = float(theta), float(cost)
        ca, sa = math.cos(best_theta), math.sin(best_theta)
        mask = (v[:, 0] * sgn > S[0] * sgn - 0.018) & (v[:, 2] > S[2] - 0.80) \
            & (v[:, 2] < S[2] + 0.16)
        rel = v[mask] - S
        v[mask, 0] = rel[:, 0] * ca - rel[:, 2] * sa + S[0]
        v[mask, 2] = rel[:, 0] * sa + rel[:, 2] * ca + S[2]
        for key in list(moved):
            if not key.startswith(f"joint-{side}-"):
                continue
            if key.split("-")[2] in ("shoulder", "clavicle", "scapula"):
                continue
            p = moved[key]
            r = p - S
            moved[key] = np.array([r[0] * ca - r[2] * sa + S[0], p[1],
                                   r[0] * sa + r[2] * ca + S[2]])
        rotations[side] = (best_theta, S)
    return v, moved, rotations


def triangulate(faces):
    """OBJ faces are quads/tris; split to triangles for clean Blender meshes."""
    tris = []
    for face, _uv in faces:
        for k in range(1, len(face) - 1):
            tris.append([face[0], face[k], face[k + 1]])
    return tris


def load(path, eye_height):
    """Everything the builder needs, in Foundry space."""
    verts, uvs, groups = parse_obj(path)
    sole_y = float(verts[:, 1].min())
    v, scale = transform(verts, eye_height, sole_y)
    joints = joint_positions(verts, groups, scale, sole_y, eye_height)
    return {"verts": v, "uvs": uvs, "groups": groups, "joints": joints, "scale": scale}
