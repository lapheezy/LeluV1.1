"""
LÉLU — hair shell and wavy lock surface (PCI-FR 2.1)

The strand generator (`lelu_hair3d.py`) produces the paths: roots, locks, the
documented ringlet coil. At the resolution these renders resolve (≈2.4 px/mm),
thousands of 0.075 mm fibres cannot read as hair — they average into fur. Her
own references are stylised renders, where the hair reads as a *surface* with
locks carved into it. So the mass is rendered as a displaced shell whose waves
come from the lock paths, and the fibres are drawn on top as surface detail.

The shell is a (azimuth, height) grid over the head, flaring below the jaw,
displaced by the lock wave, shaded analytically, and rasterised at each camera
angle. Front view is composited over the PCI-FR 1.0 face.

  python scripts/perception/lelu_hair_shell.py --out artifacts/pci-fr-2.1
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_hair as H  # noqa: E402
import lelu_hair3d as H3  # noqa: E402
import lelu_render as R  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF10 = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references/ref10_face_primary.png")
BASE = os.path.join(ROOT, "artifacts/pci-fr-1.0/renders/improved_face.png")
MM = 1.0 / H.HEAD_WIDTH_MM


def shell_mesh(nu: int, nv: int, locks: int, spec: dict) -> tuple[np.ndarray, np.ndarray]:
    """
    Vertices and quads of the hair mass.

    v runs from the crown (0) to the waist (1). Above the jaw the radius follows
    the head; below it the mass flares. The wave is a travelling sine: its phase
    depends on both azimuth and height, so crests run diagonally down the hair
    the way locks actually hang, and each lock is offset in phase.
    """
    wa = spec["waist_below_chin_fw"]
    top_y = H3.HEAD["ry"] * 1.02
    bot_y = -0.55 - wa
    verts = []
    for j in range(nv + 1):
        v = j / nv
        y = top_y + (bot_y - top_y) * v
        # radius profile: skull → flare
        if y >= 0:
            # Dome over the skull: the crown closes to a point instead of a disc.
            frac = np.clip(y / top_y, 0, 1)
            r = max(0.02, np.sqrt(max(0.0, 1 - frac ** 2)) * H3.HEAD["rx"] * 1.32)
        else:
            fall = min(1.0, -y / (0.55 + wa))
            # Blend out of the skull radius over the first fifth, so there is no
            # step where the head ends and the fall begins.
            r_skull = H3.HEAD["rx"] * 1.32
            r_fall = 0.80 + 0.14 * fall - 0.06 * max(0.0, fall - 0.75) / 0.25
            blend = min(1.0, (-y) / (0.12 * (0.55 + wa)))
            r = r_skull * (1 - blend) + r_fall * blend
        for i in range(nu):
            u = 2 * np.pi * i / nu
            # locks: phase steps per lock, drifting with height
            lock_phase = 2 * np.pi * locks * (u / (2 * np.pi))
            # Phase drifts along the length and each lock wanders, so the crests
            # are not parallel tubes running the whole way down.
            drift = 1.1 * np.sin(3.1 * y + 0.7 * lock_phase)
            wave = np.sin(lock_phase + 2 * np.pi * y / 0.34 + drift)
            wave2 = 0.5 * np.sin(2 * lock_phase + 2 * np.pi * y / 0.21 + 1.1 - 0.8 * drift)
            amp = (0.026 + 0.028 * min(1.0, max(0.0, -y / 0.6))) * (0.8 + 0.4 * np.sin(1.7 * y + lock_phase))
            rr = r + amp * wave + 0.5 * amp * wave2
            verts.append([rr * np.cos(u), y, rr * np.sin(u)])
    verts = np.array(verts)
    faces = []
    for j in range(nv):
        for i in range(nu):
            a = j * nu + i
            b = j * nu + (i + 1) % nu
            c = (j + 1) * nu + (i + 1) % nu
            d = (j + 1) * nu + i
            faces.append([a, b, c])
            faces.append([a, c, d])
    return verts, np.array(faces, np.int32)


def shade_shell(verts: np.ndarray, faces: np.ndarray, locks: int) -> np.ndarray:
    """
    Per-vertex colour. Crests facing the light get copper, troughs stay dark;
    a slow vertical band keeps the highlights from looking like stripes.
    """
    base = np.array([15, 8, 9], dtype=np.float64)
    copper = np.array([118, 56, 30], dtype=np.float64)
    pink = np.array([146, 84, 88], dtype=np.float64)
    burgundy = np.array([52, 16, 20], dtype=np.float64)

    # normal from neighbouring vertices
    n = len(verts)
    normals = np.zeros_like(verts)
    for f in faces:
        a, b, c = verts[f[0]], verts[f[1]], verts[f[2]]
        fn = np.cross(b - a, c - a)
        for k in f:
            normals[k] += fn
    normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-9
    L = np.array([-0.35, 0.45, 0.82]); L /= np.linalg.norm(L)
    lam = np.clip(normals @ L, 0, 1)

    u = np.arctan2(verts[:, 2], verts[:, 0])
    y = verts[:, 1]
    # Which lock this vertex belongs to, and where it sits along the wave.
    lock_id = np.mod(np.floor(u / (2 * np.pi) * locks), locks)
    tint = 0.5 + 0.5 * np.sin(lock_id * 2.399)
    y_norm = np.clip((0.9 - y) / (0.9 + 0.55 + 3.2), 0, 1)
    band = np.exp(-((y_norm - 0.45) ** 2) / (2 * 0.30 ** 2))

    w_hi = np.clip(lam - 0.45, 0, 1) * band * (0.35 + 0.65 * tint)
    col = base[None, :] * (1 - w_hi[:, None]) + copper[None, :] * w_hi[:, None]
    w_burg = np.clip(0.35 - lam, 0, 1) * band * tint
    col = col * (1 - w_burg[:, None]) + burgundy[None, :] * w_burg[:, None]
    pink_mask = (tint > 0.93) & (lam > 0.62) & (band > 0.5)
    col[pink_mask] = 0.72 * col[pink_mask] + 0.28 * pink[None, :]
    col *= (0.62 + 0.48 * lam)[:, None]
    return np.clip(col / 255.0, 0, 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-2.1"))
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--nu", type=int, default=112)
    ap.add_argument("--nv", type=int, default=132)
    ap.add_argument("--locks", type=int, default=26)
    ap.add_argument("--width", type=int, default=760)
    ap.add_argument("--height", type=int, default=1180)
    a = ap.parse_args()
    outdir = os.path.join(a.out, "hair")
    os.makedirs(outdir, exist_ok=True)

    spec = {"waist_below_chin_fw": H3.WAIST_BELOW_CHIN_FW}
    verts, faces = shell_mesh(a.nu, a.nv, a.locks, spec)
    colors = shade_shell(verts, faces, a.locks)
    mesh = R.Mesh(verts, faces, colors=colors, name="lelu_hair_shell", double_sided=True)
    R.export_glb([mesh], os.path.join(outdir, "lelu_hair_shell.glb"), name="lelu_hair_shell")

    # Front composite over the face.
    base_img = Image.open(a.base).convert("RGB")
    bw, bh = base_img.size
    base_pts = P.load_landmarks(a.base)
    bfw = float(np.linalg.norm(base_pts[234] - base_pts[454]))
    bcx = float((base_pts[234, 0] + base_pts[454, 0]) / 2)
    bcy = float((base_pts[10, 1] + base_pts[152, 1]) / 2)
    scale = bfw
    origin = (bcx, bcy)
    base_arr = np.asarray(base_img)

    ref_pts = P.load_landmarks(REF10)
    ring_idx = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
                400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
                54, 103, 67, 109]
    rfw = float(np.linalg.norm(ref_pts[234] - ref_pts[454]))
    rcx = float((ref_pts[234, 0] + ref_pts[454, 0]) / 2)
    rcy = float((ref_pts[10, 1] + ref_pts[152, 1]) / 2)
    face_poly = np.array([[bcx + (ref_pts[i][0] - rcx) / rfw * bfw,
                           bcy + (ref_pts[i][1] - rcy) / rfw * bfw] for i in ring_idx])

    rendered = R.render([mesh], bw, bh, scale, center=(0, 0), background=(0.12, 0.12, 0.13))
    # The rasteriser places world origin at the canvas centre; shift so that the
    # face centre lands where it is in the base render.
    canvas = np.asarray(base_img).copy()
    hair_only = rendered.astype(np.int16)
    is_hair = (np.abs(hair_only.astype(int) - np.array([31, 31, 33])).sum(axis=2) > 24)
    # Rasteriser used the canvas centre as origin; re-render with the face at
    # its true offset by translating the world.
    shifted = verts.copy()
    shifted[:, 0] += (bcx - bw / 2) / scale
    shifted[:, 1] -= (bcy - bh / 2) / scale
    mesh2 = R.Mesh(shifted, faces, colors=colors, name="lelu_hair_shell", double_sided=True)
    rendered = R.render([mesh2], bw, bh, scale, center=(0, 0), background=(0.0, 0.0, 0.0))
    is_hair = rendered.sum(axis=2) > 6

    composite = canvas.copy()
    composite[is_hair] = rendered[is_hair]

    # Her face on top, and the headpiece.
    fmask = np.zeros((bh, bw), np.uint8)
    cv2.fillPoly(fmask, [face_poly.astype(np.int32)], 1)
    fmask = cv2.erode(fmask, np.ones((3, 3), np.uint8))
    composite[fmask > 0] = base_arr[fmask > 0]
    chain = H3.gold_chain()
    for key in ("centre", "temple_left", "temple_right"):
        px, _ = H3.project(chain[key], 0, scale, origin)
        cv2.polylines(composite, [px.astype(np.int32)], False, (206, 148, 78), 2, cv2.LINE_AA)
    spirals = H3.baby_spirals(np.random.default_rng(5))
    for sw in spirals:
        px, _ = H3.project(sw["points"], 0, scale, origin)
        cv2.polylines(composite, [px.astype(np.int32)], False, (40, 18, 20), 2, cv2.LINE_AA)

    # Anything above the reconstructed hair is a PCI-FR 1.0 artefact: those
    # scrubby shapes are the old shell, not her hair.
    hair_only = np.zeros((bh, bw, 3))
    hair_only[is_hair] = 255
    hy = np.nonzero(hair_only[:, :, 0].any(axis=1))[0]
    if len(hy):
        top = int(hy.min())
        composite[: max(0, top - 2)] = np.array([31, 30, 32], dtype=np.uint8)

    p_front = os.path.join(outdir, "shell_front.png")
    Image.fromarray(composite).save(p_front)

    # Geometry views.
    W2, H2 = a.width, a.height
    views = {}
    for name, yaw in (("three_quarter", 38), ("profile", 90), ("rear", 180)):
        th_r = np.radians(yaw)
        rotated = verts.copy()
        th = np.radians(yaw)
        xx = rotated[:, 0] * np.cos(th) + rotated[:, 2] * np.sin(th)
        zz = -rotated[:, 0] * np.sin(th) + rotated[:, 2] * np.cos(th)
        rot = np.c_[xx, rotated[:, 1], zz]
        m = R.Mesh(rot, faces, colors=colors, name="hair", double_sided=True)
        # A plain head so the hair has a body under it in the geometry views.
        head_v = []
        for lat in range(0, 25):
            th = np.pi * lat / 24
            for lon in range(0, 33):
                ph = 2 * np.pi * lon / 32
                pnt = np.array([H3.HEAD["rx"] * np.sin(th) * np.cos(ph),
                                H3.HEAD["ry"] * np.cos(th) * 0.92,
                                H3.HEAD["rz"] * np.sin(th) * np.sin(ph)])
                hx = pnt[0] * np.cos(th_r) + pnt[2] * np.sin(th_r)
                hz = -pnt[0] * np.sin(th_r) + pnt[2] * np.cos(th_r)
                head_v.append([hx, pnt[1], hz])
        head_f = []
        for lat in range(24):
            for lon in range(32):
                a0 = lat * 33 + lon
                head_f.append([a0, a0 + 1, a0 + 33])
                head_f.append([a0 + 1, a0 + 34, a0 + 33])
        head = R.Mesh(np.array(head_v), np.array(head_f, np.int32),
                      colors=np.full((len(head_v), 3), 0.62), name="head", double_sided=True)
        img = R.render([head, m], W2, H2, W2 * 0.30, center=(0, 0), background=(0.10, 0.10, 0.11))
        img = np.asarray(Image.fromarray(img).resize((W2, H2), Image.LANCZOS))
        p = os.path.join(outdir, f"shell_{name}.png")
        Image.fromarray(img).save(p)
        views[name] = os.path.relpath(p, ROOT)
    views["front"] = os.path.relpath(p_front, ROOT)

    meta = {
        "schema": "lelu.hair.shell/1",
        "grid": [a.nu, a.nv],
        "quads": int(len(faces) // 2),
        "locks": a.locks,
        "waist_below_chin_fw": H3.WAIST_BELOW_CHIN_FW,
        "head_width_mm": H.HEAD_WIDTH_MM,
        "glb": os.path.relpath(os.path.join(outdir, "lelu_hair_shell.glb"), ROOT),
        "views": views,
    }
    json.dump(meta, open(os.path.join(outdir, "hair-shell.json"), "w"), indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
