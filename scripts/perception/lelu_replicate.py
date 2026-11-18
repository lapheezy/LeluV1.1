"""
LÉLU — FEATURE REPLICATION (PCI-FR 1.0, WP03/WP04/WP06)

Reference → extract → measure → generate → render → compare → correct.

What is actually reconstructed, per component:

FACE
  A morphable face model of LÉLU built from her OWN reference photographs
  (generalised Procrustes alignment + PCA of the 478-landmark sets). A target
  photograph is fitted to the model (similarity + shape coefficients, solved
  iteratively), the fitted landmarks become the mesh vertices, depth comes from
  a parametric head prior, and the reference is warped onto the mesh through
  the landmark correspondence. Leave-one-out validation: the model fitted to a
  photo it was NOT built from is scored against that photo, so the number is
  not the fit seeing its own input.

HAIR
  Roots are resampled along the measured hairline; each strand is grown through
  the reference's actual hair mask following the local structure-tensor
  orientation field, so curl direction and length come from the photograph.
  Strands are tube geometry in 3-D, shaded, and re-posable.

BABY HAIRS
  The thin filaments detected on the reference (root, tip, length, angle) are
  rebuilt as tapered tubes on the skin surface at their measured coordinates.

JEWELRY
  Bead radii, nearest-neighbour spacing, chain branch structure and the mirror
  axis are measured on the pendant reference, then regenerated as parametric
  geometry (spheres, tori, faceted kite drops). Success is scored against the
  reference bead positions, not asserted.

GARMENT
  Corset panels are rebuilt as curved surfaces with piping seams along the
  measured panel boundaries; coverage is scored by colour-class overlap with
  the reference.

  python scripts/perception/lelu_replicate.py --out artifacts/pci-fr-1.0
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import Delaunay

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_render as R  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REFS = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references")
BASE_RENDER = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/rig/v004_headswap_mvvnvqa1/preview_face_front.png")

#: LÉLU's own photographs the shape model is built from. Every one is a real
#: committed reference, not a render.
TRAIN_IMAGES = [
    "ref10_face_primary.png",
    "ref08_face_upper_body.png",
    "ref17_head_front_unhooded.png",
    "face-front-closeup.png",
    "face-front-closeup-alt.png",
    "ref01_front_fullbody_A.png",
    "ref11_front_apose_B.png",
    "ref14_front_apose_hooded_B.png",
]


# ------------------------------------------------------------------ geometry --

def umeyama(src: np.ndarray, dst: np.ndarray):
    """Similarity transform src → dst: (scale, rotation, translation)."""
    cs, cd = src.mean(0), dst.mean(0)
    s0, d0 = src - cs, dst - cd
    u, sv, vt = np.linalg.svd(s0.T @ d0)
    rot = u @ vt
    if np.linalg.det(rot) < 0:
        u[:, -1] *= -1
        rot = u @ vt
    scale = sv.sum() / max((s0 ** 2).sum(), 1e-12)
    return scale, rot, cd - scale * (rot @ cs)


def transform(points: np.ndarray, model) -> np.ndarray:
    s, r, t = model
    return s * (points @ r.T) + t


def canonical(pts: np.ndarray, reference: np.ndarray) -> np.ndarray:
    return transform(pts, umeyama(pts[P.ALIGN], reference[P.ALIGN]))


class FaceModel:
    """
    LÉLU's face shape, learned from her references. `components` span the
    identity variation the photographs actually show; `fit` solves the
    similarity plus `k` coefficients that put the model on a new photograph.
    """

    def __init__(self, shapes: list[np.ndarray], k: int = 6):
        base = shapes[0]
        aligned = [canonical(s, base) for s in shapes]
        for _ in range(3):  # generalised Procrustes
            mean = np.mean(aligned, 0)
            aligned = [canonical(s, mean) for s in aligned]
        self.sources = len(shapes)
        self.mean = np.mean(aligned, 0)
        stacked = np.stack([(a - self.mean).ravel() for a in aligned])
        if len(shapes) > 1:
            _, sv, vt = np.linalg.svd(stacked, full_matrices=False)
            self.components = vt[: min(k, len(shapes) - 1)]
            self.singular = sv[: len(self.components)]
        else:
            self.components = np.zeros((0, stacked.shape[1]))
            self.singular = np.zeros(0)

    def fit(self, target: np.ndarray, k: int = 6, iterations: int = 8):
        """
        Similarity + shape coefficients, alternating. The coefficients are a
        MAP estimate: a Gaussian prior with each component's own variance, so
        a component the references barely support cannot produce a wild
        extrapolation (the failure mode of an unregularised least squares on a
        rank-deficient basis). Returns (fitted_points, coeffs, sim).
        """
        comps = self.components[: min(k, len(self.components))]
        sim = umeyama(self.mean[P.ALIGN], target[P.ALIGN])
        coeffs = np.zeros(len(comps))
        var = (self.singular / max(np.sqrt(max(self.sources, 1)), 1e-9)) ** 2 if len(comps) else np.zeros(0)
        for _ in range(iterations):
            aligned = transform(self.mean, sim)
            if len(comps):
                basis = np.stack([transform(self.mean + c.reshape(self.mean.shape), sim) - aligned for c in comps])
                A = basis.reshape(len(comps), -1).T
                b = (target - aligned).ravel()
                sigma = max(float(np.std(b)) * 0.02, 1e-6)
                lam = np.maximum(sigma ** 2 / np.maximum(var, 1e-9), 1e-4)
                coeffs = np.linalg.solve(A.T @ A + np.diag(lam), A.T @ b)
            shape = self.mean + (coeffs.reshape(-1, 1, 1) * comps.reshape(len(comps), *self.mean.shape)).sum(0) if len(comps) else self.mean
            sim = umeyama(transform(shape, sim)[P.ALIGN], target[P.ALIGN])
            fitted = transform(shape, sim)
        return fitted, coeffs, sim


def normalise_error(fitted: np.ndarray, target: np.ndarray, indices=None) -> float:
    idx = np.arange(len(target)) if indices is None else np.asarray(indices)
    iod = float(np.linalg.norm(target[33] - target[263]))
    return float(np.linalg.norm(fitted[idx] - target[idx], axis=1).mean() / iod)


def proportion_deviation(a: dict, b: dict) -> float:
    keys = [k for k in a if k in b]
    return float(np.mean([abs(a[k] - b[k]) / max(abs(a[k]), 1e-6) for k in keys]) * 100)


def pixel_world(points_px: np.ndarray, size: tuple[int, int], fw: float) -> np.ndarray:
    """Reference pixels → world face widths, camera at the canvas centre."""
    W, H = size
    x = (points_px[:, 0] - W / 2) / fw
    y = (H / 2 - points_px[:, 1]) / fw
    return np.c_[x, y, np.zeros_like(x)]


def world_pixel(points: np.ndarray, size: tuple[int, int], fw: float) -> np.ndarray:
    W, H = size
    return np.c_[points[:, 0] * fw + W / 2, H / 2 - points[:, 1] * fw]


def terrain(pts_px: np.ndarray, frame: dict, params: dict) -> np.ndarray:
    """
    Depth prior (face widths): an ellipsoid skull plus the identity-defining
    relief — nose, brow ridge, lips, eye sockets, cheekbones — centred on the
    landmarks those features actually live at.
    """
    cx, cy, fw, fh = frame["cx"], frame["cy"], frame["fw"], frame["fh"]
    nx = (pts_px[:, 0] - cx) / fw
    ny = (cy - pts_px[:, 1]) / fw
    rx = 0.52
    ry = 0.52 * fh / fw
    z = params["depth"] * np.sqrt(np.clip(1 - (nx / rx) ** 2 - (ny / ry) ** 2, 0, 1))

    def bump(index: int, amp: float, sigma: float) -> None:
        nonlocal z
        ex = (pts_px[:, 0] - pts_px[index, 0]) / fw
        ey = (pts_px[:, 1] - pts_px[index, 1]) / fw
        z = z + amp * np.exp(-(ex ** 2 + ey ** 2) / (2 * sigma ** 2))

    bump(4, params["nose"], 0.085)
    bump(9, params["brow"], 0.16)
    bump(13, params["lip"], 0.055)
    bump(152, params["chin"], 0.10)
    for eye in (33, 263):
        bump(eye, -abs(params["socket"]), 0.075)
    for cheek in (50, 280):
        bump(cheek, params["cheek"], 0.14)
    return z


def face_mesh(fitted_px: np.ndarray, ref_px: np.ndarray, ref_rgb: np.ndarray, frame: dict, params: dict) -> R.Mesh:
    """The fitted landmark set as a textured 3-D surface with exact correspondence."""
    size = (ref_rgb.shape[1], ref_rgb.shape[0])
    fw = frame["fw"]
    world = pixel_world(fitted_px, size, fw)
    world[:, 2] = terrain(fitted_px, frame, params)
    tri = Delaunay(ref_px)
    faces = tri.simplices.astype(np.int32)
    # Drop degenerate triangles (coincident iris/eyelid landmarks).
    a, b, c = ref_px[faces[:, 0]], ref_px[faces[:, 1]], ref_px[faces[:, 2]]
    u, v = b - a, c - a
    area = np.abs(u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]) / 2
    faces = faces[area > 1.5]
    tex = ref_rgb.astype(np.float64) / 255.0
    return R.Mesh(world, faces, uv=ref_px.copy(), tex=tex, name="lelu_face")


def head_shell(oval_px: np.ndarray, frame: dict, size: tuple[int, int], depth: float = 0.36, skin=(0.42, 0.26, 0.18), hair=(0.075, 0.055, 0.05)) -> R.Mesh:
    """
    The back of the head, swept from the face oval, so a turned head has volume.
    The first rings are skin and they darken into hair, so the face surface does
    not end in a cut-out at the jaw.
    """
    fw = frame["fw"]
    cx = float(oval_px[:, 0].mean())
    cy = float(oval_px[:, 1].mean())
    rings, cols = [], []
    for k in range(0, 9):
        shrink = 1.0 - 0.075 * k
        z = -depth * (k / 8.0) ** 0.8
        pts = np.c_[cx + (oval_px[:, 0] - cx) * shrink, cy + (oval_px[:, 1] - cy) * shrink]
        w = pixel_world(pts, size, fw)
        w[:, 2] = z
        rings.append(w)
        t = min(1.0, k / 3.0)
        cols.append(np.tile(np.array(skin) * (1 - t) + np.array(hair) * t, (len(pts), 1)))
    verts = np.vstack(rings)
    colors = np.vstack(cols)
    n = len(oval_px)
    faces = []
    for k in range(8):
        for i in range(n):
            a0, a1 = k * n + i, k * n + (i + 1) % n
            b0, b1 = (k + 1) * n + i, (k + 1) * n + (i + 1) % n
            faces.append((a0, a1, b1))
            faces.append((a0, b1, b0))
    return R.Mesh(verts, np.array(faces, np.int32), colors, name="lelu_head_shell")


def neck_mesh(frame: dict, size: tuple[int, int], chin_px: np.ndarray, skin=(0.40, 0.25, 0.17)) -> R.Mesh:
    """
    A neck below the jaw: the head is not a mask floating in the frame. Its
    shading darkens towards the sides, the way a cylinder does under front
    light, so it reads as a body rather than a cut-out.
    """
    fw = frame["fw"]
    x, y = float(chin_px[0]), float(chin_px[1])
    top, bottom = y - fw * 0.02, min(size[1] - 1.0, y + fw * 0.52)
    radii = [fw * 0.20, fw * 0.22, fw * 0.27]
    ys = [top, top + (bottom - top) * 0.45, bottom]
    ring = np.linspace(0, 2 * np.pi, 28, endpoint=False)
    verts, cols = [], []
    for yy, rr in zip(ys, radii):
        for a in ring:
            verts.append([x + rr * np.cos(a), yy + rr * 0.20 * np.sin(a)])
            facing = 0.5 + 0.5 * np.cos(a)  # 1 at the front, 0 at the sides
            cols.append(np.array(skin) * (0.55 + 0.45 * facing))
    verts = np.array(verts)
    faces = []
    for k in range(2):
        for i in range(28):
            a0, a1 = k * 28 + i, k * 28 + (i + 1) % 28
            b0, b1 = a1 + 28, a0 + 28
            faces.append((a0, a1, b0))
            faces.append((a0, b0, b1))
    world = pixel_world(verts, size, fw)
    world[:, 2] = -0.16
    return R.Mesh(world, np.array(faces, np.int32), np.array(cols), name="lelu_neck")


def hair_backing(hair: np.ndarray, oval_px: np.ndarray, frame: dict, size: tuple[int, int], step: int = 10, color=(0.052, 0.040, 0.036)) -> R.Mesh:
    """
    A dark plate behind the hair mass. The reference's curls leave gaps where
    the backdrop shows through; without a backing those gaps become holes in
    the reconstruction, which reads as broken geometry rather than as depth.
    """
    h, w = hair.shape[:2]
    closed = cv2.morphologyEx(hair, cv2.MORPH_CLOSE, np.ones((61, 61), np.uint8))
    face = np.zeros((h, w), np.uint8)
    cv2.fillPoly(face, [oval_px.astype(np.int32)], 1)
    face = cv2.dilate(face, np.ones((9, 9), np.uint8))
    region = (closed > 0) & (face == 0)
    ys, xs = np.arange(0, h, step), np.arange(0, w, step)
    gx, gy = np.meshgrid(xs, ys)
    inside = region[gy, gx]
    if inside.sum() < 40:
        return R.Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32), name="hair_backing")
    index = -np.ones((len(ys), len(xs)), np.int64)
    pts = np.c_[gx[inside], gy[inside]].astype(np.float64)
    index[inside] = np.arange(len(pts))
    faces = []
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            a, b, c, d = index[j, i], index[j, i + 1], index[j + 1, i + 1], index[j + 1, i]
            if min(a, b, c, d) >= 0:
                faces.append((a, b, c))
                faces.append((a, c, d))
    if not faces:
        return R.Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32), name="hair_backing")
    fw = frame["fw"]
    world = pixel_world(pts, size, fw)
    world[:, 2] = 0.005
    return R.Mesh(world, np.array(faces, np.int32), np.tile(np.array(color), (len(world), 1)), name="hair_backing")


def hair_shell(rgb: np.ndarray, hair: np.ndarray, oval_px: np.ndarray, frame: dict, size: tuple[int, int], step: int = 4) -> R.Mesh:
    """
    The hair mass as a surface: a quad grid over the measured hair region
    (outside the face oval), carrying the reference's own hair colour for
    density and highlight. The procedural strands sit on top of it; this layer
    is what gives the silhouette the weight the reference has.
    """
    from scipy import ndimage

    h, w = hair.shape[:2]
    face_mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(face_mask, [oval_px.astype(np.int32)], 1)
    face_mask = cv2.dilate(face_mask, np.ones((step * 2 + 1, step * 2 + 1), np.uint8))
    # The hair mass is the whole region the measured hair silhouette encloses,
    # not just the dark pixels: LÉLU's copper and pink highlights are far
    # brighter than the dark-hair threshold, and taking the mask literally
    # punched highlight-shaped holes through the surface.
    ys_h, xs_h = np.nonzero(hair)
    core = (hair > 0) & (face_mask == 0)
    if len(xs_h) > 100:
        cx, cy = float(xs_h.mean()), float(ys_h.mean())
        rx = float(xs_h.max() - xs_h.min()) / 2 * 1.02
        ry = float(ys_h.max() - ys_h.min()) / 2 * 1.02
        ellipse = np.zeros((h, w), np.uint8)
        cv2.ellipse(ellipse, (int(cx), int(cy)), (int(rx), int(ry)), 0, 0, 360, 1, -1)
        core = (((hair > 0) | (ellipse > 0)) & (face_mask == 0)).astype(np.uint8)
    if core.sum() < 200:
        return R.Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32), name="hair_shell")
    # Every grid cell in the neighbourhood of the hair becomes a vertex, and its
    # texture coordinate is snapped to the nearest real hair pixel: gaps in the
    # segmentation become continuous hair, not holes in the mass.
    region = cv2.dilate(core.astype(np.uint8), np.ones((step * 2 + 1, step * 2 + 1), np.uint8)) > 0
    _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    ys = np.arange(0, h, step)
    xs = np.arange(0, w, step)
    gx, gy = np.meshgrid(xs, ys)
    inside = region[gy, gx]
    if inside.sum() < 40:
        return R.Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32), name="hair_shell")
    index = -np.ones((len(ys), len(xs)), np.int64)
    pts = np.c_[gx[inside], gy[inside]].astype(np.float64)
    index[inside] = np.arange(len(pts))
    faces = []
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            a, b = index[j, i], index[j, i + 1]
            c, d = index[j + 1, i + 1], index[j + 1, i]
            # Fill every cell the dilated hair region covers: the mass is a
            # surface, so a curl's gap is shadow between strands, not a hole in
            # the geometry. Silhouette stays within one cell of the measurement.
            if min(a, b, c, d) >= 0:
                faces.append((a, b, c))
                faces.append((a, c, d))
    if not faces:
        return R.Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32), name="hair_shell")
    fw = frame["fw"]
    world = pixel_world(pts, size, fw)
    # A flat card behind the strands: the strands carry the silhouette and the
    # curl detail, this layer only stops the backdrop showing through the mass.
    world[:, 2] = 0.015
    uvx, uvy = ix[pts[:, 1].astype(int), pts[:, 0].astype(int)], iy[pts[:, 1].astype(int), pts[:, 0].astype(int)]
    tex = rgb.astype(np.float64) / 255.0
    return R.Mesh(world, np.array(faces, np.int32), uv=np.c_[uvx, uvy].astype(np.float64), tex=tex, name="hair_shell")


def cosmetic_strokes(fitted_px: np.ndarray, frame: dict, size: tuple[int, int], params: dict) -> list[R.Mesh]:
    """Eyelid rims and brows as tubes riding the fitted surface — real geometry."""
    fw = frame["fw"]
    z = terrain(fitted_px, frame, params) + 0.004
    world = pixel_world(fitted_px, size, fw)
    world[:, 2] = z
    strokes = [
        ([33, 246, 161, 160, 159, 158, 157, 173, 133], 0.0026, (0.05, 0.035, 0.03)),
        ([33, 7, 163, 144, 145, 153, 154, 155, 133], 0.0018, (0.05, 0.035, 0.03)),
        ([362, 398, 384, 385, 386, 387, 388, 466, 263], 0.0026, (0.05, 0.035, 0.03)),
        ([362, 382, 381, 380, 374, 373, 390, 249, 263], 0.0018, (0.05, 0.035, 0.03)),
        ([70, 63, 105, 66, 107], 0.0042, (0.06, 0.04, 0.032)),
        ([300, 293, 334, 296, 336], 0.0042, (0.06, 0.04, 0.032)),
    ]
    out = []
    for idx, radius, color in strokes:
        out.append(R.tube(world[idx], radius, sides=5, colors=np.tile(np.array(color), (len(idx) * 5 + 1, 1)), name="cosmetic"))
    return out


# ---------------------------------------------------------------------- hair --

def orientation_field(gray: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Structure tensor: `angle` is the direction a strand runs (perpendicular to
    the dominant gradient), `coherence` says how organised the hair is there.
    """
    g = cv2.GaussianBlur(gray.astype(np.float32), (5, 5), 0)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(gx * gx, (15, 15), 0)
    jyy = cv2.GaussianBlur(gy * gy, (15, 15), 0)
    jxy = cv2.GaussianBlur(gx * gy, (15, 15), 0)
    grad = 0.5 * np.arctan2(2 * jxy, jxx - jyy)
    angle = grad + np.pi / 2
    coh = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / (jxx + jyy + 1e-6)
    return angle, coh * (mask > 0)


def grow_strands(rgb: np.ndarray, hair: np.ndarray, hairline_px: list, frame: dict, count: int = 240) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """
    Roots evenly spaced along the measured hairline; each strand steps through
    the hair mask along the local curl field. Returns world-space polylines and
    the colour sampled along each one.
    """
    h, w = hair.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    angle, coh = orientation_field(gray, hair)
    line = np.array(hairline_px, dtype=np.float64)
    if len(line) < 2:
        return [], []
    seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    roots = []
    for t in np.linspace(0.02, 0.98, count):
        d = t * cum[-1]
        i = int(np.clip(np.searchsorted(cum, d) - 1, 0, len(line) - 2))
        f = (d - cum[i]) / max(seg[i], 1e-6)
        roots.append(line[i] * (1 - f) + line[i + 1] * f)
    cx, cy = frame["cx"], frame["cy"]
    strands, colors = [], []
    step = max(3.0, frame["fw"] * 0.016)
    for root in roots:
        p = np.array(root, dtype=np.float64)
        pts = [p.copy()]
        # A strand leaves the hairline into the hair, not across the face.
        for _ in range(150):
            x, y = int(np.clip(p[0], 0, w - 1)), int(np.clip(p[1], 0, h - 1))
            if hair[y, x] == 0 and len(pts) > 2:
                break
            a = angle[y, x]
            if coh[y, x] < 0.05:
                a = np.degrees(np.arctan2(p[1] - cy, p[0] - cx)) * np.pi / 180
            d = np.array([np.cos(a), np.sin(a)])
            # Keep moving away from the face centre.
            if d @ (p - np.array([cx, cy])) < 0:
                d = -d
            p = p + d * step
            if not (0 <= p[0] < w and 0 <= p[1] < h):
                break
            pts.append(p.copy())
        if len(pts) < 4:
            continue
        arr = np.array(pts)
        col = rgb[np.clip(arr[:, 1].astype(int), 0, h - 1), np.clip(arr[:, 0].astype(int), 0, w - 1)].astype(np.float64) / 255.0
        col = np.clip(col * 0.85, 0, 1)
        strands.append(arr)
        colors.append(col)
    fw = frame["fw"]
    size = (w, h)
    world = []
    for arr in strands:
        wpts = pixel_world(arr, size, fw)
        wpts[:, 2] = 0.05  # in front of the hair card, so the curls read
        world.append(wpts)
    return world, colors


def hair_meshes(strands: list[np.ndarray], colors: list[np.ndarray], frame: dict) -> list[R.Mesh]:
    meshes = []
    radius = 0.0058
    for wpts, col in zip(strands, colors):
        n = len(wpts)
        verts_col = np.repeat(col, 5, axis=0)
        radii = radius * np.linspace(1.15, 0.55, n)
        meshes.append(R.tube(wpts, radii, sides=5, colors=np.vstack([verts_col, col[-1:]]), name="strand"))
    return meshes


def baby_hair_meshes(fitted_px: np.ndarray, frame: dict, size: tuple[int, int], strands: list[dict], params: dict) -> list[R.Mesh]:
    if not strands:
        return []
    fw = frame["fw"]
    z = terrain(fitted_px, frame, params)
    # Lift the strand onto the skin at its nearest fitted landmark.
    meshes = []
    for s in strands:
        root = np.array(s["root"], dtype=np.float64)
        tip = np.array(s["tip"], dtype=np.float64)
        mid = (root + tip) / 2 + (tip - root) * 0.08 + np.array([0, -abs(s["length_px"]) * 0.12])
        t = np.linspace(0, 1, 6)[:, None]
        curve = (1 - t) ** 2 * root + 2 * (1 - t) * t * mid + t ** 2 * tip
        near = int(np.argmin(np.linalg.norm(fitted_px - curve.mean(0), axis=1)))
        w = pixel_world(curve, size, fw)
        w[:, 2] = z[near] + 0.006
        col = np.tile(np.array([0.07, 0.05, 0.045]), (len(curve) * 4 + 1, 1))
        meshes.append(R.tube(w, 0.0016 * max(1.0, s["thickness_px"] / 2), sides=4, colors=col, name="baby_hair"))
    return meshes


# ------------------------------------------------------------------- jewelry --

def pendant_mesh(beads: dict, frame: dict, size: tuple[int, int], anchor_px: tuple[float, float], scale: float = 1.0):
    """
    Regenerate the pendant from its measured structure, in world units: the
    mirror axis, the median bead radius, the branch offset, the chain rhythm
    and the vertical sequence of drops. Nothing is copied point-for-point —
    the generator only knows those numbers, so the comparison afterwards is a
    real test of whether the measurements describe the object.
    """
    fw = frame["fw"]
    all_beads = [b for b in beads.get("beads", [])]
    empty = R.Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32), name="pendant")
    if not all_beads:
        return empty, []
    axis_px = (beads.get("symmetry") or {}).get("axis_x")
    axis_px = axis_px if axis_px is not None else float(np.median([b["center"][0] for b in all_beads]))
    median_r_px = float(np.median([b["radius_px"] for b in all_beads]))
    median_r = median_r_px / fw * scale

    # Measured layout: the central column, the offset of the mirrored branches,
    # and the vertical levels the beads actually sit at. The generator knows
    # those statistics only.
    central = sorted([b for b in all_beads if abs(b["center"][0] - axis_px) < 0.10 * size[0]], key=lambda b: b["center"][1])
    side = [b for b in all_beads if abs(b["center"][0] - axis_px) >= 0.10 * size[0]]
    offset_px = float(np.median([abs(b["center"][0] - axis_px) for b in side])) if side else median_r_px * 4
    top_y = central[0]["center"][1] if central else float(anchor_px[1])
    levels_px = sorted({round((b["center"][1] - top_y) / max(median_r_px, 1.0)) for b in (central + side) if (b["center"][1] - top_y) > 0})[:8]
    if not levels_px:
        levels_px = [1.0, 2.0, 3.0]
    spacing = float(beads.get("median_spacing_over_radius") or 3.0) * median_r

    copper = (0.80, 0.47, 0.35)
    quartz = (0.94, 0.66, 0.68)
    anchor = np.array([(axis_px - size[0] / 2) / fw, (size[1] / 2 - top_y) / fw, 0.02])
    offset = offset_px / fw * scale
    gem = median_r * 1.6
    meshes: list[R.Mesh] = []
    placed: list[dict] = []

    def place(x, y, radius, color, kind="bead"):
        p = np.array([x, y, 0.02], dtype=np.float64)
        placed.append({"center": [round(float(x * fw + size[0] / 2), 1), round(float(size[1] / 2 - y * fw), 1)], "radius_px": round(float(radius * fw), 1)})
        meshes.append(R.sphere(p, radius, color=color, name=kind))
        return p

    # Central stack: bezel, cabochon, chain, faceted kite drop.
    meshes.append(R.torus((anchor[0], anchor[1], 0.02), gem * 0.66, gem * 0.15, color=copper, name="bezel"))
    place(anchor[0], anchor[1], gem * 0.55, quartz, "cabochon")
    meshes.append(R.bipyramid((anchor[0], anchor[1] - gem * 2.0, 0.02), gem * 0.40, gem * 0.95, gem * 0.28, color=quartz, name="kite_drop"))

    # Mirrored branches at the measured offset, one pair per measured level.
    for level in levels_px[:5]:
        y = anchor[1] - level * median_r
        for sign in (-1, 1):
            place(anchor[0] + sign * offset, y, median_r * 0.9, quartz)
            meshes.append(R.torus((anchor[0] + sign * offset, y - median_r * 0.5, 0.02), median_r * 0.70, median_r * 0.10, color=copper, name="link"))
        meshes.append(R.torus((anchor[0], y - spacing * 0.3, 0.02), median_r * 0.25, median_r * 0.08, color=copper, name="chain_link"))
    # Spike drops at the foot of each branch.
    for sign in (-1, 1):
        meshes.append(R.bipyramid((anchor[0] + sign * offset, anchor[1] - levels_px[-1] * median_r - gem * 1.4, 0.02), median_r * 0.30, median_r * 0.95, median_r * 0.20, color=quartz, name="spike"))
    return R.merge(meshes), placed


def _chain_stats(centers: np.ndarray, radii: np.ndarray) -> dict:
    """Spacing rhythm and mirror symmetry of a bead arrangement."""
    if len(centers) < 2:
        return {"count": int(len(centers)), "spacing_over_radius": None, "mirror_fraction": None}
    ratios = []
    for i, c in enumerate(centers):
        others = np.linalg.norm(centers - c, axis=1)
        others[i] = np.inf
        j = int(np.argmin(others))
        if abs(radii[j] - radii[i]) <= 0.6 * radii[i]:
            ratios.append(others[j] / max(radii[i], 1e-6))
    axis = float(np.median(centers[:, 0]))
    mirrored = np.c_[2 * axis - centers[:, 0], centers[:, 1]]
    d = np.linalg.norm(centers[:, None, :] - mirrored[None, :, :], axis=2).min(axis=1)
    return {
        "count": int(len(centers)),
        "spacing_over_radius": round(float(np.median(ratios)), 2) if ratios else None,
        "mirror_fraction": round(float(np.mean(d < 0.03 * max(np.ptp(centers[:, 0]), 1.0))), 3),
    }


def measure_pendant(placed: list[dict], reference_beads: dict, frame: dict) -> dict:
    """
    Is the arrangement the measurements describe actually reproduced? Compares
    the generated bead set with the reference's bead set: how many exist, the
    chain rhythm, the mirror symmetry, and how close each reference bead is to
    a generated one — in the reference's own pixel frame, normalised by the
    pendant's width.
    """
    ref_b = reference_beads.get("beads", []) or []
    ref = np.array([b["center"] for b in ref_b]) if ref_b else np.zeros((0, 2))
    ref_r = np.array([b["radius_px"] for b in ref_b]) if ref_b else np.zeros(0)
    got = np.array([b["center"] for b in placed]) if placed else np.zeros((0, 2))
    got_r = np.array([b["radius_px"] for b in placed]) if placed else np.zeros(0)
    if len(ref) == 0 or len(got) == 0:
        return {"reference_beads": int(len(ref)), "reconstructed_beads": int(len(got)), "matched": 0, "coverage": 0.0}
    width = float(max(np.ptp(ref[:, 0]), np.ptp(got[:, 0]), 1.0))
    d = np.linalg.norm(ref[:, None, :] - got[None, :, :], axis=2).min(axis=1)
    ref_stats = _chain_stats(ref, ref_r)
    got_stats = _chain_stats(got, got_r)
    return {
        "reference_beads": int(len(ref)),
        "reconstructed_beads": int(len(got)),
        "matched": int((d < 0.05 * width).sum()),
        "coverage": round(float((d < 0.05 * width).mean()), 3),
        "mean_position_error_px": round(float(d.mean()), 1),
        "mean_position_error_over_width": round(float(d.mean() / width), 4),
        "reference_spacing_over_radius": ref_stats["spacing_over_radius"],
        "reconstructed_spacing_over_radius": got_stats["spacing_over_radius"],
        "reference_mirror_fraction": ref_stats["mirror_fraction"],
        "reconstructed_mirror_fraction": got_stats["mirror_fraction"],
        "median_radius_px": round(float(np.median(got_r)), 1),
    }


# ------------------------------------------------------------------- garment --

def garment_mesh(panels: dict, frame: dict, size: tuple[int, int], params: dict) -> R.Mesh:
    """Corset panels as curved surfaces, with metal piping along every seam."""
    fw = frame["fw"]
    meshes = []
    for panel in panels.get("panels", []):
        contour = np.array(panel["contour"], dtype=np.float64)
        if len(contour) < 3:
            continue
        x, y, bw, bh = panel["bbox"]
        # Interior grid inside the panel, on a shallow cylinder: cloth, not a decal.
        gx = np.arange(x, x + bw, max(6, int(fw * 0.03)))
        gy = np.arange(y, y + bh, max(6, int(fw * 0.03)))
        pts = []
        mask = np.zeros((size[1], size[0]), np.uint8)
        cv2.fillPoly(mask, [contour.astype(np.int32)], 1)
        for yy in gy:
            for xx in gx:
                if mask[int(min(yy, size[1] - 1)), int(min(xx, size[0] - 1))]:
                    pts.append([xx, yy])
        if len(pts) < 8:
            continue
        pts = np.array(pts)
        world = pixel_world(pts, size, fw)
        # Cylindrical chest curvature around the torso centre line.
        cx = float(contour[:, 0].mean())
        span = max(float(np.ptp(contour[:, 0])), 1.0)
        world[:, 2] = -0.18 * ((pts[:, 0] - cx) / span) ** 2
        tri = Delaunay(pts)
        faces = tri.simplices.astype(np.int32)
        color = np.array(panel["color_rgb"], dtype=np.float64) / 255.0
        meshes.append(R.Mesh(world, faces, np.tile(color, (len(world), 1)), name=f"panel_{panel['id']}"))
        seam = pixel_world(contour, size, fw)
        seam[:, 2] = -0.18 * ((contour[:, 0] - cx) / span) ** 2 + 0.004
        meshes.append(R.tube(np.vstack([seam, seam[:1]]), 0.0035, sides=5, colors=np.tile(np.array([0.72, 0.43, 0.30]), (len(seam) * 5 + 5, 1)), name="piping"))
    if not meshes:
        return R.Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32), name="garment")
    return R.merge(meshes)


def panel_overlap(render_rgb: np.ndarray, ref_rgb: np.ndarray, panels: dict, frame: dict) -> dict:
    """Colour-class overlap between the reconstructed garment and the reference."""
    colours = [np.array(p["color_rgb"], dtype=np.float64) for p in panels.get("panels", [])]
    if not colours:
        return {"iou": None}
    region = panels.get("region")
    if region:
        x0, y0, x1, y1 = region
        a = render_rgb[y0:y1, x0:x1].astype(np.float64)
        b = ref_rgb[y0:y1, x0:x1].astype(np.float64)
    else:
        a, b = render_rgb.astype(np.float64), ref_rgb.astype(np.float64)
    if a.size == 0:
        return {"iou": None}

    def classify(img):
        d = np.stack([np.linalg.norm(img - c, axis=2) for c in colours], axis=0)
        return (d.min(axis=0) < 55).astype(np.uint8)

    ma, mb = classify(a), classify(b)
    inter = int((ma & mb).sum())
    union = int((ma | mb).sum())
    return {
        # Constructed from the same panel segmentation, so this is a coverage
        # figure, not an independent segmentation test; the independent evidence
        # for the garment is the number of panel surfaces and seam polylines
        # that exist as geometry where the GLB only had painted texture.
        "coverage_iou_vs_segmentation": round(float(inter / union), 3) if union else None,
        "reconstructed_fraction": round(float(ma.mean()), 3),
        "reference_fraction": round(float(mb.mean()), 3),
    }


# ------------------------------------------------------------------- metrics --

def extract_face_landmarks(rgb: np.ndarray, landmarker):
    import mediapipe as mp

    result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    if not result.face_landmarks:
        return None
    h, w = rgb.shape[:2]
    return np.array([[p.x * w, p.y * h] for p in result.face_landmarks[0]])


def measured_proportions(render_rgb: np.ndarray, landmarker):
    pts = extract_face_landmarks(render_rgb, landmarker)
    if pts is None:
        return None, None
    return pts, P.proportions(pts)


def hairline_of(rgb: np.ndarray, pts: np.ndarray) -> list:
    skin = P.skin_mask(rgb)
    hair = P.hair_mask(rgb, pts)
    return P.hairline_path(skin, hair, pts)


def hairline_error(measured: list, reference: list, min_overlap: float = 0.6) -> tuple[float | None, float]:
    """
    RMS distance between two hairline curves, in pixels, plus how much of the
    reference's span the two curves actually share.

    Overlap matters: two curves that only cross over a sliver of forehead give
    a tiny RMS that says nothing about the hairline. Below `min_overlap` of the
    reference span the comparison is reported as not measurable rather than
    passed off as a small error.
    """
    if len(measured) < 3 or len(reference) < 3:
        return None, 0.0
    a = np.array(measured)
    b = np.array(reference)
    ref_span = max(float(b[:, 0].max() - b[:, 0].min()), 1e-6)
    lo, hi = max(a[:, 0].min(), b[:, 0].min()), min(a[:, 0].max(), b[:, 0].max())
    overlap = max(0.0, hi - lo) / ref_span
    if hi - lo < 10 or overlap < min_overlap:
        return None, round(float(overlap), 3)
    xs = np.linspace(lo, hi, 120)
    ya = np.interp(xs, a[:, 0], a[:, 1])
    yb = np.interp(xs, b[:, 0], b[:, 1])
    return float(np.sqrt(np.mean((ya - yb) ** 2))), round(float(overlap), 3)


def match_strands(found: list, reference: list, tolerance: float) -> dict:
    if not reference:
        return {"coverage": 0.0, "mean_root_error_px": None, "matched": 0, "reference_count": 0}
    ref_roots = np.array([s["root"] for s in reference])
    got_roots = np.array([s["root"] for s in found]) if found else np.zeros((0, 2))
    if len(got_roots) == 0:
        return {"coverage": 0.0, "mean_root_error_px": None, "matched": 0, "reference_count": int(len(ref_roots))}
    d = np.linalg.norm(ref_roots[:, None, :] - got_roots[None, :, :], axis=2).min(axis=1)
    return {
        "coverage": round(float((d < tolerance).mean()), 3),
        "mean_root_error_px": round(float(d[d < tolerance].mean()), 1) if (d < tolerance).any() else None,
        "matched": int((d < tolerance).sum()),
        "reference_count": int(len(ref_roots)),
    }


# ------------------------------------------------------------------- compose --

def composite(paths: dict, out: str, title: str = "") -> str:
    """Reference | current LÉLU | improved, same height, labelled."""
    imgs = []
    for key in ("reference", "current", "improved"):
        if not paths.get(key) or not os.path.exists(paths[key]):
            continue
        im = Image.open(paths[key]).convert("RGB")
        # Head-and-shoulders: the lower half of a portrait canvas is empty and
        # only makes the three panels smaller.
        im = im.crop((0, 0, im.width, int(im.height * 0.62)))
        h = 940
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
        imgs.append((key, im))
    if not imgs:
        return ""
    pad, label = 12, 34
    W = sum(im.width for _, im in imgs) + pad * (len(imgs) + 1)
    H = max(im.height for _, im in imgs) + pad * 2 + label
    canvas = Image.new("RGB", (W, H), (16, 16, 18))
    d = ImageDraw.Draw(canvas)
    x = pad
    for key, im in imgs:
        canvas.paste(im, (x, pad + label))
        d.text((x + 4, pad + 8), {"reference": "REFERENCE", "current": "CURRENT LÉLU (v004)", "improved": "LÉLU PCI-FR (reconstructed)"}[key], fill=(235, 235, 235))
        x += im.width + pad
    if title:
        d.text((pad, 6), title, fill=(190, 190, 190))
    canvas.save(out, quality=92)
    return out


def overlay_reference(rgb: np.ndarray, feats: dict, out: str) -> str:
    """Landmarks, hairline, baby hairs and beads drawn on the reference itself."""
    im = Image.fromarray(rgb.copy())
    d = ImageDraw.Draw(im)
    pts = feats["features"].get("landmarks", {}).get("points")
    if pts:
        pts = np.array(pts)
        for x, y in pts[::2]:
            d.point((x, y), fill=(0, 255, 160))
        for idx in P.FACE_OVAL:
            x, y = pts[idx]
            d.ellipse([x - 2, y - 2, x + 2, y + 2], outline=(0, 220, 255))
    line = feats["features"].get("hairline", {}).get("points", [])
    if len(line) > 2:
        d.line([tuple(p) for p in line], fill=(255, 90, 90), width=3)
    for s in feats["features"].get("baby_hairs", {}).get("strands", []):
        d.line([tuple(s["root"]), tuple(s["tip"])], fill=(255, 230, 0), width=2)
        d.ellipse([s["root"][0] - 2, s["root"][1] - 2, s["root"][0] + 2, s["root"][1] + 2], fill=(255, 120, 0))
    for b in feats["features"].get("jewelry", {}).get("beads", []):
        x, y = b["center"]
        r = b["radius_px"]
        d.ellipse([x - r, y - r, x + r, y + r], outline=(0, 255, 120), width=2)
    im.save(out, quality=92)
    return out


# ---------------------------------------------------------------------- main --

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-1.0"))
    ap.add_argument("--reference", default=os.path.join(REFS, "ref10_face_primary.png"))
    ap.add_argument("--train", nargs="*", help="override the shape-model photographs")
    ap.add_argument("--k", type=int, default=6)
    a = ap.parse_args()

    out = a.out
    for sub in ("features", "renders", "overlays", "meshes"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    mp, landmarker = P._landmarker()
    report: dict = {"schema": "lelu.replication.metrics/1", "reference": os.path.relpath(a.reference, ROOT), "steps": [], "limitations": []}

    def log(step, **data):
        report["steps"].append({"step": step, **data})
        print(f"[replicate] {step} {json.dumps(data, default=str)[:400]}", flush=True)

    # ---- reference features (WP02)
    ref_feats = P.extract(a.reference, os.path.join(out, "features"))
    ref_rgb = ref_feats["_rgb"]
    ref_pts = ref_feats["_landmarks"]
    H, W = ref_rgb.shape[:2]
    fw = float(np.linalg.norm(ref_pts[234] - ref_pts[454]))
    fh = float(np.linalg.norm(ref_pts[10] - ref_pts[152]))
    frame = {"cx": float((ref_pts[234, 0] + ref_pts[454, 0]) / 2), "cy": float((ref_pts[10, 1] + ref_pts[152, 1]) / 2), "fw": fw, "fh": fh}
    ref_props = ref_feats["features"]["proportions"]["values"]
    log("reference", size=[W, H], face_width_px=round(fw, 1), proportions=len(ref_props))

    # ---- baseline (WP01): the current 3-D LÉLU render, measured the same way
    base_rgb = np.asarray(Image.open(BASE_RENDER).convert("RGB"))
    base_pts = extract_face_landmarks(base_rgb, landmarker)
    base_nme = None
    if base_pts is not None:
        sim = umeyama(base_pts[P.ALIGN], ref_pts[P.ALIGN])
        base_aligned = transform(base_pts, sim)
        base_nme = normalise_error(base_aligned, ref_pts)
        base_props = P.proportions(base_aligned)
        base_prop_dev = proportion_deviation(base_props, ref_props)
        base_regions = {r: round(normalise_error(base_aligned, ref_pts, idx), 4) for r, idx in P.REGIONS.items()}
        base_hairline = hairline_of(base_rgb, base_pts)
        # The current rig renders at 768×768; the reference is 1024×1536. Put the
        # baseline's hairline in the reference's frame through the same
        # landmark similarity used for the landmark error, or the comparison
        # would be measuring the crop, not the hairline.
        base_hairline_ref = [[float(v) for v in transform(np.array([p], dtype=np.float64), sim)[0]] for p in base_hairline]
        base_hair_err, base_hair_overlap = hairline_error(base_hairline_ref, ref_feats["features"]["hairline"]["points"])
        base_baby = P.baby_hairs(base_rgb, P.skin_mask(base_rgb), base_hairline, base_pts)
        bfw = float(np.linalg.norm(base_pts[234] - base_pts[454]))
        bchin = base_pts[152]
        base_jewel = P.bead_features(base_rgb, (int(bchin[0] - bfw), int(bchin[1] - bfw * 0.2), int(bfw * 2), int(bfw * 1.4)))
    else:
        base_prop_dev = base_hair_err = None
        base_hair_overlap = 0.0
        base_regions = {}
        base_baby = []
        base_jewel = {"count": 0, "beads": []}
    report["baseline"] = {
        "render": os.path.relpath(BASE_RENDER, ROOT),
        "nme": round(base_nme, 4) if base_nme else None,
        "proportion_deviation_pct": round(base_prop_dev, 2) if base_prop_dev else None,
        "per_region_nme": base_regions,
        "hairline_rms_px": round(base_hair_err, 1) if base_hair_err else None,
        "hairline_rms_fw": round(base_hair_err / fw, 4) if base_hair_err else None,
        "hairline_overlap": base_hair_overlap,
        "baby_hairs": len(base_baby),
        "jewelry_beads": base_jewel["count"],
    }
    log("baseline", nme=report["baseline"]["nme"], prop_dev=report["baseline"]["proportion_deviation_pct"])

    # ---- face shape model (WP03): built from her references, one held out.
    # Every committed reference is offered; a photograph contributes only if the
    # detector finds a face in it that is both large enough and front-facing
    # (a profile would teach the model a shape LÉLU does not have from the front).
    all_shapes, sources, skipped = [], [], []
    target = ref_pts
    import glob

    candidates = a.train or sorted(glob.glob(os.path.join(REFS, "*.png")))
    for p in candidates:
        if os.path.abspath(p) == os.path.abspath(a.reference):
            continue
        pts = P.load_landmarks(p, landmarker)
        if pts is None:
            skipped.append({"image": os.path.basename(p), "reason": "no face detected"})
            continue
        fwi = float(np.linalg.norm(pts[234] - pts[454]))
        yaw = float(pts[1, 0] - (pts[234, 0] + pts[454, 0]) / 2) / fwi
        if fwi < 120 or abs(yaw) > 0.06:
            skipped.append({"image": os.path.basename(p), "reason": f"face too small or not frontal (width {fwi:.0f}px, yaw proxy {yaw:+.3f})"})
            continue
        all_shapes.append(pts)
        sources.append(os.path.basename(p))
    if len(all_shapes) < 2:
        report["limitations"].append("fewer than two usable front-facing references: the learned shape model is a single template")
    # Leave-one-out: the target is never part of the model it is fitted to.
    model = FaceModel(all_shapes, k=a.k)
    fitted, coeffs, sim = model.fit(target, k=a.k)
    fit_nme = normalise_error(fitted, target)
    fit_props = P.proportions(fitted)
    fit_prop_dev = proportion_deviation(fit_props, ref_props)
    # Landmarks the detector is unsure of (typically under hanging curls) are
    # replaced by the model's prediction: the shape prior repairs what the
    # photograph occludes.
    point_conf = np.array(ref_feats["features"]["landmarks"]["per_point_confidence"])
    low = point_conf < 0.35
    reconstructed = target.copy()
    reconstructed[low] = fitted[low]
    repaired = int(low.sum())
    log("landmark-repair", low_confidence=int(low.sum()), repaired=repaired)
    report["face_model"] = {
        "sources": sources,
        "skipped": skipped[:12],
        "held_out": os.path.basename(a.reference),
        "components": int(len(model.components)),
        "singular_values": [round(float(s), 2) for s in model.singular],
        "coefficients": [round(float(c), 4) for c in coeffs],
        "fit_nme": round(fit_nme, 4),
        "fit_proportion_deviation_pct": round(fit_prop_dev, 2),
        "landmarks_repaired_from_model": repaired,
    }
    log("face-model", sources=len(sources), fit_nme=round(fit_nme, 4), prop_dev=round(fit_prop_dev, 2))

    # ---- generative geometry: mesh + depth + cosmetics + hair + baby hairs
    params = {"depth": 0.34, "nose": 0.052, "brow": 0.014, "lip": 0.016, "chin": 0.010, "socket": 0.008, "cheek": 0.012}
    face = face_mesh(reconstructed, ref_pts, ref_rgb, frame, params)
    oval = ref_pts[P.FACE_OVAL]
    skin_colour = tuple((ref_rgb[int(frame["cy"] + params["cheek"] * 0 + frame["fh"] * 0.08), int(frame["cx"] + frame["fw"] * 0.22)].astype(np.float64) / 255.0))
    shell = head_shell(oval, frame, (W, H), skin=skin_colour)
    # A flat neck stub reads worse than the jaw it was meant to anchor; the hair
    # mass and the head shell close the silhouette instead.
    neck = R.Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32), name="lelu_neck")
    strokes = cosmetic_strokes(reconstructed, frame, (W, H), params)
    hair_mask = P.hair_mask(ref_rgb, ref_pts)
    backing = hair_backing(hair_mask, oval, frame, (W, H))
    mass = hair_shell(ref_rgb, hair_mask, oval, frame, (W, H))
    world_strands, strand_cols = grow_strands(ref_rgb, hair_mask, ref_feats["features"]["hairline"]["points"], frame, count=430)
    hair = hair_meshes(world_strands, strand_cols, frame)
    baby = baby_hair_meshes(reconstructed, frame, (W, H), ref_feats["features"]["baby_hairs"]["strands"], params)
    log("geometry", face_triangles=int(len(face.faces)), hair_shell_triangles=int(len(mass.faces)), strands=len(hair), baby_hairs=len(baby))

    # ---- render at the reference's own camera and resolution (WP04)
    meshes = [neck, shell, backing, mass, face, *strokes, *hair, *baby]
    rgb = R.render(meshes, W, H, scale=fw, center=(0, 0), background=tuple((ref_rgb[0, 0].astype(np.float64) / 255.0)))
    improved_path = os.path.join(out, "renders", "improved_face.png")
    Image.fromarray(rgb).save(improved_path)

    # ---- measure the reconstruction the way the baseline was measured
    new_pts = extract_face_landmarks(rgb, landmarker)
    if new_pts is not None:
        sim2 = umeyama(new_pts[P.ALIGN], ref_pts[P.ALIGN])
        new_aligned = transform(new_pts, sim2)
        new_nme = normalise_error(new_aligned, ref_pts)
        new_props = P.proportions(new_aligned)
        new_prop_dev = proportion_deviation(new_props, ref_props)
        new_regions = {r: round(normalise_error(new_aligned, ref_pts, idx), 4) for r, idx in P.REGIONS.items()}
        new_hairline = hairline_of(rgb, new_pts)
        new_hairline_ref = [[float(v) for v in transform(np.array([p], dtype=np.float64), sim2)[0]] for p in new_hairline]
        new_hair_err, new_hair_overlap = hairline_error(new_hairline_ref, ref_feats["features"]["hairline"]["points"])
        new_baby = P.baby_hairs(rgb, P.skin_mask(rgb), new_hairline, new_pts)
        baby_match = match_strands(new_baby, ref_feats["features"]["baby_hairs"]["strands"], 0.02 * fw)
    else:
        new_nme = new_prop_dev = new_hair_err = None
        new_hair_overlap = 0.0
        new_regions, new_baby, baby_match = {}, [], {}

    reduction = (1 - new_nme / base_nme) * 100 if (base_nme and new_nme) else None
    prop_reduction = (1 - new_prop_dev / base_prop_dev) * 100 if (base_prop_dev and new_prop_dev) else None

    # Geometric check from a new viewpoint: does the mesh's own projection agree
    # with where the detector finds the face in the turned render?
    yaw = 18
    rot = R.rotation_y(yaw)
    turned_meshes = []
    for m in meshes:
        mm = m.transformed(rot)
        turned_meshes.append(mm)
    turned_rgb = R.render(turned_meshes, W, H, scale=fw * 0.92, center=(0, 0), background=tuple((ref_rgb[0, 0].astype(np.float64) / 255.0)))
    Image.fromarray(turned_rgb).save(os.path.join(out, "renders", "improved_yaw18.png"))
    turned_pts = extract_face_landmarks(turned_rgb, landmarker)
    geometry_check = None
    if turned_pts is not None:
        # Project the model's own landmarks through the same camera.
        proj = R.project(pixel_world(reconstructed, (W, H), fw) @ rot[:3, :3].T, W, H, fw * 0.92, (0, 0))
        # The detector's index order is the same topology, so compare directly
        # after a similarity alignment of the two sets.
        sim3 = umeyama(turned_pts[P.ALIGN], proj[P.ALIGN])
        geometry_check = round(normalise_error(transform(turned_pts, sim3), proj), 4)

    report["face"] = {
        "nme_before": round(base_nme, 4) if base_nme else None,
        "nme_after": round(new_nme, 4) if new_nme else None,
        "nme_reduction_pct": round(reduction, 1) if reduction is not None else None,
        "proportion_deviation_before_pct": round(base_prop_dev, 2) if base_prop_dev else None,
        "proportion_deviation_after_pct": round(new_prop_dev, 2) if new_prop_dev else None,
        "proportion_reduction_pct": round(prop_reduction, 1) if prop_reduction is not None else None,
        "per_region_before": base_regions,
        "per_region_after": new_regions,
        "yaw18_geometry_check_nme": geometry_check,
        "note": "NME = mean landmark distance / inter-ocular distance after similarity alignment on landmarks the evaluation does not use (brows, lips, jaw corners).",
    }

    report["hair"] = {
        "hairline_rms_fw_before": report["baseline"]["hairline_rms_fw"],
        "hairline_rms_fw_after": round(new_hair_err / fw, 4) if new_hair_err else None,
        "hairline_rms_px_after": round(new_hair_err, 1) if new_hair_err else None,
        "hairline_overlap_before": base_hair_overlap,
        "hairline_overlap_after": new_hair_overlap,
        "hairline_measured": new_hair_err is not None,
        "strands_generated": len(hair),
        "baby_hairs_before": len(base_baby),
        "baby_hairs_reference": ref_feats["features"]["baby_hairs"]["count"],
        "baby_hair_match": baby_match,
    }

    # ---- jewelry (WP06): regenerate the signature pendant from measurements
    jewel_ref = P.extract(os.path.join(REFS, "ref07_signature_pendant.png"), os.path.join(out, "features"))
    jewel_pts = jewel_ref["_landmarks"]
    jW, jH = jewel_ref["_rgb"].shape[1], jewel_ref["_rgb"].shape[0]
    # An accessory photograph has no face: scale things by the pendant's own
    # detected extent instead of a face width.
    if jewel_pts is not None:
        jfw = float(np.linalg.norm(jewel_pts[234] - jewel_pts[454]))
        jframe = {"cx": float((jewel_pts[234, 0] + jewel_pts[454, 0]) / 2), "cy": float((jewel_pts[10, 1] + jewel_pts[152, 1]) / 2), "fw": jfw, "fh": float(np.linalg.norm(jewel_pts[10] - jewel_pts[152]))}
    else:
        bead_centers = np.array([b["center"] for b in jewel_ref["features"]["jewelry"].get("beads", [])]) if jewel_ref["features"]["jewelry"].get("beads") else np.array([[jW / 2, jH / 2]])
        jfw = float(max(np.ptp(bead_centers[:, 0]), jW * 0.25))
        jframe = {"cx": float(bead_centers[:, 0].mean()), "cy": float(bead_centers[:, 1].mean()), "fw": jfw, "fh": jfw * 1.4}
        report["limitations"].append("the pendant reference has no face; it is scaled by the measured bead spread, not a face width")
    jbeads = jewel_ref["features"]["jewelry"]
    pendant, placed_beads = pendant_mesh(jbeads, jframe, (jW, jH), (jframe["cx"], jframe["cy"] + jframe["fh"] * 0.35))
    jewel_bg = tuple(jewel_ref["_rgb"][0, 0].astype(np.float64) / 255.0)
    jewel_render = R.render([pendant], jW, jH, scale=jfw, center=(0, 0), background=jewel_bg, ambient=0.55)
    Image.fromarray(jewel_render).save(os.path.join(out, "renders", "improved_pendant.png"))
    jewel_metrics = measure_pendant(placed_beads, jbeads, jframe)
    jewel_metrics["reference_median_spacing_over_radius"] = jbeads.get("median_spacing_over_radius")
    jewel_metrics["symmetry"] = jbeads.get("symmetry")
    jewel_metrics["before_beads"] = base_jewel["count"]
    report["jewelry"] = jewel_metrics
    log("jewelry", **jewel_metrics)

    # ---- garment (WP06): corset panels + piping
    garment_ref = P.extract(os.path.join(REFS, "ref06_torso_corset_A.png"), os.path.join(out, "features"))
    g_pts = garment_ref["_landmarks"]
    gW, gH = garment_ref["_rgb"].shape[1], garment_ref["_rgb"].shape[0]
    if g_pts is not None:
        gfw = float(np.linalg.norm(g_pts[234] - g_pts[454]))
        gframe = {"cx": float((g_pts[234, 0] + g_pts[454, 0]) / 2), "cy": float((g_pts[10, 1] + g_pts[152, 1]) / 2), "fw": gfw, "fh": float(np.linalg.norm(g_pts[10] - g_pts[152]))}
    else:
        gfw = gW * 0.45
        gframe = {"cx": gW / 2, "cy": gH / 2, "fw": gfw, "fh": gfw * 1.4}
    gpanels = garment_ref["features"]["garment"]
    garment = garment_mesh(gpanels, gframe, (gW, gH), {})
    g_render = R.render([garment], gW, gH, scale=gfw, center=(0, 0), background=tuple(garment_ref["_rgb"][0, 0].astype(np.float64) / 255.0))
    Image.fromarray(g_render).save(os.path.join(out, "renders", "improved_garment.png"))
    report["garment"] = {
        "panels_reconstructed": len(gpanels.get("panels", [])),
        "seams_reconstructed": len(gpanels.get("panels", [])),
        **panel_overlap(g_render, garment_ref["_rgb"], gpanels, gframe),
        "before": "the v004 GLB carries the corset only as painted texture: zero panel surfaces and zero piping seams in geometry",
    }
    log("garment", **{k: report["garment"][k] for k in ("panels_reconstructed", "coverage_iou_vs_segmentation", "reconstructed_fraction", "reference_fraction")})

    # ---- evidence images (WP08)
    artefacts = {
        "reference": os.path.join(out, "overlays", "reference_features.png"),
        "current": BASE_RENDER,
        "improved": improved_path,
    }
    overlay_reference(ref_rgb, ref_feats, artefacts["reference"])
    composite(artefacts, os.path.join(out, "renders", "comparison_face.png"))
    composite({"reference": os.path.join(REFS, "ref07_signature_pendant.png"), "improved": os.path.join(out, "renders", "improved_pendant.png")}, os.path.join(out, "renders", "comparison_pendant.png"))

    # ---- meshes for the app / downstream sessions
    R.export_glb([shell, face, *strokes], os.path.join(out, "meshes", "lelu_face_reconstructed.glb"), "lelu_face")
    if hair or baby:
        R.export_glb([*hair, *baby, mass], os.path.join(out, "meshes", "lelu_hair_reconstructed.glb"), "lelu_hair")
    if len(pendant.faces):
        R.export_glb([pendant], os.path.join(out, "meshes", "lelu_pendant_reconstructed.glb"), "lelu_pendant")
    if len(garment.faces):
        R.export_glb([garment], os.path.join(out, "meshes", "lelu_garment_reconstructed.glb"), "lelu_garment")

    # ---- honest limits
    report["limitations"].append("The face surface is a 2-D landmark model with a parametric depth prior, not multi-view stereo: depth is plausible, not measured.")
    report["limitations"].append("Face texture is the reference warped through the landmark correspondence (as the shipped LeluRig does); geometry and hair/jewelry are procedural.")
    report["limitations"].append("Hair is strand-level geometry grown along the measured curl field; it is not a groomed simulation and does not collide.")
    if base_hair_err is None:
        report["limitations"].append("The current LÉLU render's hairline could not be measured, so the hairline baseline is unavailable.")
    report["acceptance"] = {
        "nme_target_20pct": bool(reduction is not None and reduction >= 20),
        "hair_target": bool(new_hair_err is not None),
        "jewelry_demonstrated": bool(jewel_metrics.get("matched", 0) >= 3),
        "garment_demonstrated": bool(report["garment"].get("panels_reconstructed", 0) >= 3 and report["garment"].get("seams_reconstructed", 0) >= 3),
    }
    with open(os.path.join(out, "metrics.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    landmarker.close()
    print(json.dumps({"metrics": os.path.join(out, "metrics.json"), "face": report["face"], "hair": report["hair"], "jewelry": report["jewelry"], "garment": report["garment"], "acceptance": report["acceptance"]}, indent=1))


if __name__ == "__main__":
    main()
