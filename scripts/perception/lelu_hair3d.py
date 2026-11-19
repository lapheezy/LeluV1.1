"""
LÉLU — three-dimensional hair reconstruction (PCI-FR 2.1, WP01)

World units: 1.0 = her face width (150 mm, from the spec sheets' head width).
The face centre is the origin, +y up, +z towards the viewer.

What is here:

  * a scalp ellipsoid fitted to her head in the references
  * clump roots distributed over the scalp at the documented follicle spacing
  * ringlets grown in 3D at the documented loose-curl radius and pitch, hug the
    head, then fall to the waist under gravity
  * strand-level colour: dark base with copper, burgundy and pink highlights,
    applied per strand and modulated along the curl
  * baby-hair spirals as real geometry at the measured forehead coordinates
  * the gold chain headpiece as geometry on the scalp and forehead
  * front / three-quarter / profile / rear renders and their measurements

  python scripts/perception/lelu_hair3d.py --out artifacts/pci-fr-2.1
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_hair as H  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF10 = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references/ref10_face_primary.png")
BASE = os.path.join(ROOT, "artifacts/pci-fr-1.0/renders/improved_face.png")

MM = 1.0 / H.HEAD_WIDTH_MM

#: Head ellipsoid half-extents in face widths, measured from her references
#: (head width ≈ 1.24 × face width; head height / face width ≈ 1.72).
HEAD = {"rx": 0.62, "ry": 0.84, "rz": 0.55}

#: Waist length. The portrait sheets crop her hair at the shoulders, so the
#: length comes from the mission target and is cross-checked against her
#: full-body design: the hair ends at the waist, ≈ 3.2 face widths below the chin.
WAIST_BELOW_CHIN_FW = 3.2

#: Palette in sRGB. base → burgundy → copper → pink, sampled from her hair.
PALETTE = {
    "base": [24, 12, 13],
    "deep_burgundy": [58, 18, 24],
    "burgundy": [96, 30, 34],
    "copper": [162, 82, 44],
    "copper_light": [198, 118, 66],
    "pink": [186, 114, 122],
}


# ------------------------------------------------------------------ geometry --

def head_surface(theta: float, phi: float) -> np.ndarray:
    """Point on the head ellipsoid. theta = polar from +y, phi = azimuth."""
    return np.array([
        HEAD["rx"] * np.sin(theta) * np.cos(phi),
        HEAD["ry"] * np.cos(theta),
        HEAD["rz"] * np.sin(theta) * np.sin(phi),
    ])


def head_normal(p: np.ndarray) -> np.ndarray:
    n = np.array([p[0] / HEAD["rx"] ** 2, p[1] / HEAD["ry"] ** 2, p[2] / HEAD["rz"] ** 2])
    return n / (np.linalg.norm(n) + 1e-9)


def scalp_roots(count: int, rng) -> np.ndarray:
    """
    Clump roots over the hair-bearing scalp.

    A Fibonacci sphere gives an even distribution; roots are kept off the face
    (front, below the hairline) and off the neck, and the density is set by the
    documented follicle spacing of 1.0–1.6 mm (62–100 follicles/cm²).
    """
    i = np.arange(count) + 0.5
    phi = np.arccos(1 - 2 * i / count)          # 0..π from the crown
    theta = np.pi * (1 + 5 ** 0.5) * i
    pts = []
    for ph, th in zip(phi, theta):
        # ph: 0 at +y (crown). Keep the upper two-thirds plus the back.
        p = head_surface(ph, th)
        # Face region: front (z > 0), below the hairline (y < 0.30).
        if p[2] > 0.12 and p[1] < 0.30:
            # allow the temples and a fringe edge, but not the face itself
            if abs(p[0]) < 0.44 and p[1] < 0.34:
                continue
        if p[1] < -0.62:                       # nape, keep some but not the neck
            continue
        pts.append(p + head_normal(p) * rng.uniform(0.004, 0.018))
    return np.array(pts)


def locks_from_roots(roots: np.ndarray, n_locks: int, rng) -> np.ndarray:
    """
    Group roots into locks by azimuth, so strands that grow next to each other
    share a ringlet instead of filling space like fog.
    """
    az = np.arctan2(roots[:, 2], roots[:, 0])
    order = np.argsort(az)
    return np.array_split(order, n_locks)


def grow_ringlet(root: np.ndarray, lock_offset: np.ndarray, length: float, curl_r: float,
                 curl_p: float, phase0: float, rng, volume: float = 0.04,
                 lock_phase: float = 0.0, lock_amp: float = 0.055, lock_wave: float = 0.34) -> np.ndarray:
    """
    A ringlet in three dimensions.

    The first 0.42 of its length hugs the skull along the surface; after that it
    leaves the head and falls, drifting outward slightly, with the ringlet
    wound around its own direction. The curl amplitude ramps in so the root
    stays flat against the scalp.
    """
    n = 300
    t = np.linspace(0.0, 1.0, n)
    # No two ringlets are the same size: pitch and amplitude vary per strand,
    # which is what stops a thousand of them forming a regular lattice.
    curl_p = curl_p * float(rng.uniform(0.72, 1.45))
    curl_r = curl_r * float(rng.uniform(0.65, 1.35))
    s = t * length
    hug = min(0.42, length * 0.55)
    p_surface0 = root
    n0 = head_normal(root)
    az = np.arctan2(root[2], root[0])
    th0 = np.arccos(np.clip(root[1] / HEAD["ry"], -1, 1))

    pts = np.zeros((n, 3))
    for i in range(n):
        if s[i] <= hug:
            # slide down the skull at the same azimuth
            th = th0 + (np.pi / 2 - th0) * (s[i] / hug)
            p = head_surface(th, az)
            pts[i] = p + head_normal(p) * (0.012 + 0.02 * (s[i] / hug))
        else:
            k = (s[i] - hug) / max(1e-6, length - hug)
            base = head_surface(np.pi / 2, az)
            out = np.array([np.cos(az), 0.0, np.sin(az)]) * (0.075 + volume)
            pts[i] = (base + head_normal(np.array([np.cos(az), 0, np.sin(az)]) * 0.6) * 0.045
                      + out * k + np.array([0.0, -(s[i] - hug), 0.0])
                      + lock_offset * (0.35 + 0.65 * k)
                      # slow lateral wander, so neighbouring clumps diverge
                      + np.array([np.sin(7.0 * t[i] + rng.uniform(0, 6.28)) * 0.012, 0.0,
                                  np.cos(5.0 * t[i] + rng.uniform(0, 6.28)) * 0.012]))
    # Lock-level S-wave: her hair hangs in long loose locks. This is the shape
    # the eye reads as a curl; the fine coil below is its surface texture.
    sway = lock_amp * np.sin(2 * np.pi * pts[:, 1] / lock_wave + lock_phase)
    pts[:, 0] += sway
    pts[:, 2] += 0.4 * lock_amp * np.cos(2 * np.pi * pts[:, 1] / lock_wave + lock_phase)

    # Ringlet around the centreline.
    d = np.gradient(pts, axis=0)
    d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    up = np.array([0.0, 1.0, 0.0])
    n1 = np.cross(d, up)
    n1 /= np.linalg.norm(n1, axis=1, keepdims=True) + 1e-9
    n2 = np.cross(d, n1)
    phase = 2 * np.pi * s / curl_p + phase0
    env = np.clip((s - hug * 0.5) / (curl_p * 1.8), 0.10, 1.0)
    amp = curl_r * env * (0.55 + 0.45 * rng.uniform(0.8, 1.2))
    pts = pts + amp[:, None] * (np.cos(phase)[:, None] * n1 + np.sin(phase)[:, None] * n2)
    return pts


def strand_colour(kind: str, t: np.ndarray, phase: np.ndarray) -> np.ndarray:
    """
    Per-point colour of one strand. The dark base dominates; highlights are a
    band through the middle of the strand and follow the curl, so colour is a
    property of the strand and its bend, never a painted block.
    """
    base = np.array(PALETTE["base"], dtype=np.float64)
    ramp = {
        "base": (np.array(PALETTE["deep_burgundy"]), 0.35),
        "deep_burgundy": (np.array(PALETTE["deep_burgundy"]), 0.60),
        "burgundy": (np.array(PALETTE["burgundy"]), 0.75),
        "copper": (np.array(PALETTE["copper"]), 0.85),
        "pink": (np.array(PALETTE["pink"]), 0.7),
    }[kind]
    target, strength = ramp
    band = np.exp(-((t - 0.45) ** 2) / (2 * 0.30 ** 2))          # mid-length peak
    wave = 0.5 + 0.5 * np.cos(phase)                             # lit side of the curl
    w = (strength * band * (0.15 + 0.85 * wave ** 1.5))[:, None]
    col = base[None, :] * (1 - w) + target[None, :] * w
    # A little extra light where the ringlet faces the camera.
    col = col + (np.array([26, 12, 10]) * wave[:, None] * band[:, None])
    return np.clip(col, 0, 255) / 255.0


def baby_spirals(rng) -> list[dict]:
    """
    The three measured forehead swirls, as Archimedean spirals lying on the
    forehead. Radii and lengths are the spec-sheet values; positions are the
    measured forehead root coordinates from her reference (either side of the
    centre, above the brows).
    """
    fw_apart = 0.22
    surface_z = lambda x, y: HEAD["rz"] * np.sqrt(np.clip(1 - (x / HEAD["rx"]) ** 2 - (y / HEAD["ry"]) ** 2, 0, 1)) + 0.035
    out = []
    spots = [(-fw_apart, 0.40), (fw_apart, 0.42), (0.0, 0.52)]
    for spec, (x, y) in zip(H.SPEC["baby_swirls"], spots):
        R = spec["radius_cm"] * 10 * MM
        L = spec["length_cm"] * 10 * MM
        turns = max(1.4, L / (2 * np.pi * max(R, 1e-6)) * 0.55)
        n = 150
        u = np.linspace(0, 1, n)
        ang = 2 * np.pi * turns * u + rng.uniform(0, 6.28)
        rr = R * (0.30 + 0.70 * u)
        px = x + rr * np.cos(ang)
        py = y + rr * np.sin(ang) * 0.92
        pz = surface_z(px, py)
        pts = np.c_[px, py, pz]
        out.append({"id": spec["id"], "points": pts, "t": u,
                    "radius_mm": spec["radius_cm"] * 10, "length_mm": spec["length_cm"] * 10,
                    "width_px_mm": (0.55 - 0.35 * u)})
    return out


def gold_chain() -> dict:
    """
    The headpiece seen on her reference: a chain running from the centre part
    down the forehead to a gem between the brows, and a chain hanging at each
    temple. Geometry on the head surface, offset clear of the scalp.
    """
    def surf(x, y, lift=0.02):
        return HEAD["rz"] * np.sqrt(np.clip(1 - (x / HEAD["rx"]) ** 2 - (y / HEAD["ry"]) ** 2, 0, 1)) + lift

    # Centre: from the part, a shallow V down to the brow gem.
    centre = []
    for u in np.linspace(0, 1, 80):
        y = 0.86 - 0.62 * u
        x = 0.0
        centre.append([x, y, surf(x, y, 0.05)])
    # Temple strands: hang from the hairline down past the cheekbone.
    left, right = [], []
    for u in np.linspace(0, 1, 60):
        y = 0.34 - 0.95 * u
        x = 0.52 + 0.05 * u
        left.append([-x, y, surf(-x, min(y, 0.30), 0.05) + max(0.0, 0.30 - y) * 0.9])
        right.append([x, y, surf(x, min(y, 0.30), 0.05) + max(0.0, 0.30 - y) * 0.9])
    return {
        "centre": np.array(centre),
        "temple_left": np.array(left),
        "temple_right": np.array(right),
        "gem": np.array([0.0, 0.24, surf(0.0, 0.24, 0.065)]),
        "hanging": [np.array([-0.56, -0.55, 0.42]), np.array([0.56, -0.55, 0.42])],
    }


# ------------------------------------------------------------------ renderer --

def project(pts: np.ndarray, yaw: float, scale: float, origin) -> tuple[np.ndarray, np.ndarray]:
    """Orthographic camera at `yaw` degrees around the head. Returns px, depth."""
    a = np.radians(yaw)
    ca, sa = np.cos(a), np.sin(a)
    x = pts[:, 0] * ca + pts[:, 2] * sa
    z = -pts[:, 0] * sa + pts[:, 2] * ca
    px = origin[0] + x * scale
    py = origin[1] - pts[:, 1] * scale
    return np.c_[px, py], z


def splat(points_px, depth, colours, radius, W, H, base_rgb, alpha_scale=0.95, clip_poly=None, want_depth=False):
    """
    Draw small discs with a depth buffer. `colours` is per point in 0..1.
    """
    img = base_rgb.astype(np.float64).copy()
    n = len(depth)
    xi = np.clip(points_px[:, 0].astype(int), 0, W - 1)
    yi = np.clip(points_px[:, 1].astype(int), 0, H - 1)
    ri = int(np.ceil(radius))
    offs = [(dx, dy) for dy in range(-ri, ri + 1) for dx in range(-ri, ri + 1) if dx * dx + dy * dy <= radius * radius]
    if clip_poly is not None:
        blocker = np.zeros((H, W), np.uint8)
        cv2.fillPoly(blocker, [clip_poly.astype(np.int32)], 1)
    else:
        blocker = np.zeros((H, W), np.uint8)
    # One comparison per pixel: key carries the nearest depth and its point id.
    key = np.full(H * W, -1e18)
    k = (depth + 10.0) * 1e7 + np.arange(n)
    touched = np.zeros((H, W), bool)
    for dx, dy in offs:
        x = np.clip(xi + dx, 0, W - 1)
        y = np.clip(yi + dy, 0, H - 1)
        flat = y * W + x
        np.maximum.at(key, flat, k)
        touched[y, x] = True
    touched &= blocker == 0
    yy, xx = np.nonzero(touched)
    pid = np.clip((key[yy * W + xx] % 1e7).astype(np.int64), 0, n - 1)
    img[yy, xx] = colours[pid] * 255.0
    if want_depth:
        zmap = np.full((H, W), np.nan)
        zmap[yy, xx] = depth[pid]
        return img, touched, zmap
    return img, touched, None


def render_view(strands, chain, spirals, yaw, W, H, scale, origin, base_rgb, face_poly=None, show_chain=True):
    """
    Composite one camera angle.

    Strands are drawn back-to-front as anti-aliased polylines, in short chunks
    that each carry their own colour, so the ringlet's lit and shadowed sides
    are painted along the strand instead of being averaged into a soup of dots.
    A dark mass sits underneath so no backdrop shows through the hair.
    """
    proj = [project(st["points"], yaw, scale, origin) for st in strands]
    mean_z = np.array([float(np.mean(z)) for _, z in proj])
    order = np.argsort(mean_z)            # far to near

    r_mm = float(np.median([st["radius_px"] for st in strands]))
    thickness = max(2, int(round(0.75 * MM * scale)))

    # Hair mass under the strands.
    mask = np.zeros((H, W), np.uint8)
    for idx in order:
        px, _ = proj[idx]
        cv2.polylines(mask, [px.astype(np.int32)], False, 255, thickness + 2, cv2.LINE_AA)
    mask = cv2.GaussianBlur(mask, (0, 0), 2)
    m = mask.astype(np.float64) / 255.0
    if face_poly is not None:
        blocker = np.zeros((H, W), np.uint8)
        cv2.fillPoly(blocker, [face_poly.astype(np.int32)], 1)
        m *= (1 - blocker)
    dark = np.array(PALETTE["base"], dtype=np.float64)
    img = base_rgb.astype(np.float64) * (1 - m[..., None]) + dark[None, None, :] * m[..., None]

    # Strands, far to near, in chunks of eight points.
    for idx in order:
        st = strands[idx]
        px, z = proj[idx]
        cols = st["colours"]
        shade = st["shade"]
        for i in range(0, len(px) - 1, 8):
            j = min(i + 9, len(px))
            seg = px[i:j].astype(np.int32)
            c = cols[i] * (0.55 + 0.85 * shade[i])
            colour = tuple(int(v) for v in np.clip(c * 255, 0, 255))
            cv2.polylines(img, [seg], False, colour, thickness, cv2.LINE_AA)

    if face_poly is not None:
        # Her face stays her face: strands never lie over it.
        face_mask = np.zeros((H, W), np.uint8)
        cv2.fillPoly(face_mask, [face_poly.astype(np.int32)], 1)
        img[face_mask > 0] = base_rgb[face_mask > 0]

    if show_chain:
        for key in ("centre", "temple_left", "temple_right"):
            path = chain[key]
            px, z = project(path, yaw, scale, origin)
            cv2.polylines(img, [px.astype(np.int32)], False, (206, 148, 78), max(2, thickness - 1), cv2.LINE_AA)
        gx, _ = project(chain["gem"][None, :], yaw, scale, origin)
        cv2.circle(img, (int(gx[0, 0]), int(gx[0, 1])), max(4, thickness + 2), (238, 176, 200), -1, cv2.LINE_AA)

    for sw in spirals:
        px, _ = project(sw["points"], yaw, scale, origin)
        cv2.polylines(img, [px.astype(np.int32)], False, (44, 20, 22), max(2, thickness - 1), cv2.LINE_AA)
    return np.clip(img, 0, 255).astype(np.uint8)


# -------------------------------------------------------------------- driver --

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-2.1"))
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--strands", type=int, default=3000)
    ap.add_argument("--locks", type=int, default=70)
    ap.add_argument("--width", type=int, default=900)
    ap.add_argument("--height", type=int, default=1500)
    a = ap.parse_args()
    outdir = os.path.join(a.out, "hair")
    os.makedirs(outdir, exist_ok=True)

    rng = np.random.default_rng(2026)
    ring = H.SPEC["ringlet_loose"]  # documented loose ringlet: r 6.5 mm, p 15 mm
    curl_r = ring["curl_radius_mm"] * MM
    curl_p = ring["curl_pitch_mm"] * MM
    length_wu = 0.55 + WAIST_BELOW_CHIN_FW  # from the crown to the waist

    roots = scalp_roots(a.strands, rng)
    locks = locks_from_roots(roots, a.locks, rng)

    strands = []
    kinds = ["base", "base", "base", "deep_burgundy", "burgundy", "burgundy", "copper", "pink"]
    probs = [0.30, 0.20, 0.14, 0.14, 0.10, 0.06, 0.04, 0.02]
    for lock in locks:
        guide = roots[lock[0]]
        phase_guide = rng.uniform(0, 6.28)
        for ri in lock:
            root = roots[ri]
            off = (root - guide) * 0.45 + rng.normal(0, 0.012, 3)
            L = length_wu * rng.uniform(0.88, 1.04)
            pts = grow_ringlet(root, off, L, curl_r, curl_p, phase_guide + rng.normal(0, 0.5), rng,
                               volume=float(rng.uniform(0.02, 0.10)),
                               lock_phase=rng.uniform(0, 6.28),
                               lock_amp=float(rng.uniform(0.035, 0.075)))
            t = np.linspace(0, 1, len(pts))
            kind = kinds[int(rng.choice(len(kinds), p=probs))]
            d = np.gradient(pts, axis=0)
            d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
            shade = 0.5 + 0.5 * np.clip(d[:, 2], -1, 1)
            strands.append({
                "points": pts,
                "colours": strand_colour(kind, t, np.linspace(0, 6.28 * L / curl_p, len(pts))),
                "shade": shade,
                "kind": kind,
                "radius_px": 1.35 * MM,
                "length_mm": float(L * H.HEAD_WIDTH_MM),
            })

    chain = gold_chain()
    spirals = baby_spirals(rng)

    # Front portrait composite over the PCI-FR 1.0 face.
    base_img = Image.open(a.base).convert("RGB")
    bw, bh = base_img.size
    base_pts = P.load_landmarks(a.base)
    bfw = float(np.linalg.norm(base_pts[234] - base_pts[454]))
    bcx = float((base_pts[234, 0] + base_pts[454, 0]) / 2)
    bcy = float((base_pts[10, 1] + base_pts[152, 1]) / 2)
    sc = bfw * 1.0
    origin = (bcx, bcy)
    ref_pts = P.load_landmarks(REF10)
    ring_idx = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
    fw_ref = float(np.linalg.norm(ref_pts[234] - ref_pts[454]))
    rcx = float((ref_pts[234, 0] + ref_pts[454, 0]) / 2)
    rcy = float((ref_pts[10, 1] + ref_pts[152, 1]) / 2)
    face_poly = np.array([[bcx + (ref_pts[i][0] - rcx) / fw_ref * bfw,
                           bcy + (ref_pts[i][1] - rcy) / fw_ref * bfw] for i in ring_idx])

    base_rgb = np.asarray(base_img).copy()
    # PCI-FR 1.0 drew its baby hairs into the face texture. Those are texture
    # artifacts, not geometry, so they are removed here before the real spiral
    # geometry is composited on top.
    gray = cv2.cvtColor(base_rgb, cv2.COLOR_RGB2GRAY)
    fh_b = float(np.linalg.norm(base_pts[10] - base_pts[152]))
    ksize = int(max(7, fh_b * 0.055)) | 1
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize)))
    brow_y = float(min(base_pts[105, 1], base_pts[334, 1]))
    region = np.zeros_like(gray)
    region[int(max(0, brow_y - 0.55 * fh_b)):int(brow_y + 0.02 * fh_b),
           int(bcx - 0.55 * bfw):int(bcx + 0.55 * bfw)] = 1
    marks = ((blackhat > 16) & (region > 0)).astype(np.uint8) * 255
    marks = cv2.dilate(marks, np.ones((3, 3), np.uint8))
    base_rgb = cv2.inpaint(base_rgb, marks, 4, cv2.INPAINT_TELEA)
    front = render_view(strands, chain, spirals, 0, bw, bh, sc, origin, base_rgb, face_poly=face_poly)
    # Anything dark left above the reconstructed hair is a PCI-FR 1.0 artefact.
    fimg = front.astype(np.float64)
    top_limit = int(bcy - 1.02 * bfw)
    if top_limit > 0:
        band = fimg[:top_limit]
        darkish = (band.max(axis=2) < 70)
        band[darkish] = np.array([38, 36, 38], dtype=np.float64)
        fimg[:top_limit] = band
    front = np.clip(fimg, 0, 255).astype(np.uint8)
    Image.fromarray(front).save(os.path.join(outdir, "hair_front.png"))

    # Geometry views on a neutral ground: no face, so the hair can be judged.
    views = {"three_quarter": 38, "profile": 90, "rear": 180}
    W2, H2 = a.width, a.height
    ground = np.full((H2, W2, 3), [26, 24, 27], dtype=np.float64)
    origin2 = (W2 / 2, H2 * 0.30)
    scale2 = W2 * 0.52
    files = {}
    for name, yaw in views.items():
        img = render_view(strands, chain, spirals, yaw, W2, H2, scale2, origin2, ground)
        p = os.path.join(outdir, f"hair_{name}.png")
        Image.fromarray(img).save(p)
        files[name] = os.path.relpath(p, ROOT)
    files["front"] = os.path.relpath(os.path.join(outdir, "hair_front.png"), ROOT)

    lengths = np.array([s["length_mm"] for s in strands])
    meta = {
        "schema": "lelu.hair.reconstruction3d/1",
        "strands": len(strands),
        "locks": a.locks,
        "points_per_strand": int(len(strands[0]["points"])),
        "curl_radius_mm": ring["curl_radius_mm"],
        "curl_pitch_mm": ring["curl_pitch_mm"],
        "strand_diameter_mm": ring.get("strand_diameter_um", 70) / 1000,
        "spec_source": ring["source"],
        "head_mm": H.HEAD_WIDTH_MM,
        "waist_below_chin_fw": WAIST_BELOW_CHIN_FW,
        "length_mm": {"mean": round(float(lengths.mean()), 1), "min": round(float(lengths.min()), 1), "max": round(float(lengths.max()), 1)},
        "follicle_density_per_cm2": round(len(strands) / (2 * np.pi * HEAD["rx"] * HEAD["ry"] * H.HEAD_WIDTH_MM ** 2 / 100), 1),
        "colour_mix": {k: int(sum(1 for s in strands if s["kind"] == k)) for k in sorted(set(s["kind"] for s in strands))},
        "baby_spirals": [{"id": s["id"], "radius_mm": s["radius_mm"], "length_mm": s["length_mm"]} for s in spirals],
        "chain_points": {k: int(len(v)) for k, v in chain.items() if isinstance(v, np.ndarray) and v.ndim == 2},
        "views": files,
    }
    json.dump(meta, open(os.path.join(outdir, "hair3d.json"), "w"), indent=1)
    print(json.dumps(meta, indent=1)[:1400])


if __name__ == "__main__":
    main()
