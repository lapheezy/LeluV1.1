#!/usr/bin/env python
"""
LÉLU — true volumetric hair (PCI-FR 2.2)

Replaces the PCI-FR 2.1 displaced shell with hair that is made of hair:
clump roots on the scalp, independently generated locks, a curled centreline per
strand, layered shells for depth, and a strand renderer that shades each lock
along its own tangent (Kajiya–Kay), so highlights follow the curl instead of
being painted onto a surface.

Geometry model
--------------
World units: 1.0 = her face width (landmark 234↔454), 150 mm. +y up, +z towards
the camera, face centre at the origin.

  * head      ellipsoid fitted to the references (width 1.24 fw, chin at -0.56)
  * hairline  the measured hairline from lelu-hair-03/20, arch R = 62 mm
  * roots     uniform-area sampling of the scalp above the hairline, at the
              documented follicle spacing; split by the 8.5 mm centre part
  * locks     roots clustered into ~450 locks; each lock owns its growth
              direction, shell depth, curl radius/pitch/phase, sway and length
  * strands   each root grows one continuous strand: scalp-hug → fall → curl,
              with an anti-penetration clamp so no strand enters the skull
  * shell     each lock is drawn over a dark under-stroke, so the mass is
              opaque while the silhouette is made of separate locks
  * baby hair the three measured forehead spirals, as real geometry
  * headpiece the existing gold chain, re-seated on the reconstructed head

Strand rendering
----------------
Each strand is projected and drawn in short chunks, each chunk shaded from its
own tangent: diffuse from the cylinder term sqrt(1-(T·L)^2), a narrow copper
specular lobe and a warm rim lobe. Colour therefore lives on the strand and its
bend, never on a shell.

Outputs (artifacts/pci-fr-2.2/hair/):
  hair_front.png             portrait, face + hair
  hair_three_quarter.png     yaw 42
  hair_profile.png           yaw 90
  hair_rear.png              yaw 180
  hair_full_length.png       full body, waist termination
  hair_crown.png             top-down, centre part
  hair_curl_closeup.png      one curl cluster at 8 px/mm
  hair_babyhairs.png         forehead spirals, close-up
  lelu_hair_volume.glb       lock geometry (LOD) for the app viewer
  hair-volume.json           geometry measurements

  python scripts/perception/lelu_hair_volume.py --out artifacts/pci-fr-2.2
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy.cluster.vq import kmeans2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_hair as H  # noqa: E402
import lelu_hair3d as H3  # noqa: E402
import lelu_render as R  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE = os.path.join(ROOT, "artifacts/pci-fr-1.0/renders/improved_face.png")
REF_FRONT = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references/lelu-hair/lelu-hair-03.png")

MM = 1.0 / H.HEAD_WIDTH_MM          # world units per millimetre
CURL_PX_PER_MM = 1200.0 / H.HEAD_WIDTH_MM   # the curl close-up camera (8 px/mm)

#: Head ellipsoid. Half-width / half-height in face widths, centre of the
#: ellipsoid above the face centre, so the chin lands at -0.56 and the crown at
#: +1.04 — the proportions measured on her references (chin -0.54 … -0.62).
HEAD = {"rx": 0.62, "ry": 0.80, "rz": 0.56, "yc": 0.24}
CHIN_Y = -0.56
WAIST_BELOW_CHIN_FW = 3.2
WAIST_Y = CHIN_Y - WAIST_BELOW_CHIN_FW

#: Measured hairline from lelu-hair-03 and lelu-hair-20 (arc R = 62 mm printed on
#: the sheet): peaks over the temples at |x| 0.28-0.34, dips at the part, then
#: falls in front of the ears.
HAIRLINE_X = [0.00, 0.10, 0.20, 0.28, 0.34, 0.40, 0.46, 0.52, 0.57, 0.62]
HAIRLINE_Y = [0.74, 0.79, 0.86, 0.90, 0.89, 0.84, 0.74, 0.58, 0.42, 0.28]

#: Hair silhouette half-width by height, read off the frontal hair references
#: (lelu-hair-03/12/20) and carried to the waist at 3.2 fw below the chin.
#: This is the outer envelope; each lock sits at a fraction of it.
SIL_Y = [1.50, 1.36, 1.20, 1.06, 0.90, 0.60, 0.30, 0.00, -0.40, -0.80,
         -1.10, -1.60, -2.20, -3.00, -3.80]
SIL_W = [0.10, 0.34, 0.60, 0.80, 0.90, 0.92, 0.89, 0.90, 0.93, 0.96,
         1.00, 0.96, 0.90, 0.82, 0.74]

#: sRGB palette sampled from the references (lelu-hair-01 palette: #1e0c09,
#: #481f17, #843720, #bb5f41) plus the pink streaks seen in lelu-hair-03/20.
PAL = {
    "base": (26, 12, 11),
    "deep": (52, 19, 15),
    "mid": (94, 33, 24),
    "copper": (152, 63, 36),
    "bright": (206, 108, 66),
    "pink": (178, 86, 104),
}

#: Samples along each path. The documented ringlet pitch is 11.8–50 mm over a
#: 690 mm fall, so a path holds 14–25 turns; 360 samples give 15–25 per turn and
#: stop the coil from aliasing into a zigzag.
N_POINTS = 1080


# ------------------------------------------------------------------ helpers --

def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def hairline_y(x):
    return np.interp(np.abs(x), HAIRLINE_X, HAIRLINE_Y)


def sil_w(y):
    return np.interp(y, SIL_Y[::-1], SIL_W[::-1])


def head_rx(y):
    s = 1.0 - ((np.asarray(y) - HEAD["yc"]) / HEAD["ry"]) ** 2
    return HEAD["rx"] * np.sqrt(np.clip(s, 0.0, 1.0))


def head_rz(y):
    s = 1.0 - ((np.asarray(y) - HEAD["yc"]) / HEAD["ry"]) ** 2
    return HEAD["rz"] * np.sqrt(np.clip(s, 0.0, 1.0))


def head_surface(theta, az):
    return np.array([HEAD["rx"] * np.sin(theta) * np.sin(az),
                     HEAD["yc"] + HEAD["ry"] * np.cos(theta),
                     HEAD["rz"] * np.sin(theta) * np.cos(az)])


def head_normal(p):
    n = np.array([p[0] / HEAD["rx"] ** 2,
                  (p[1] - HEAD["yc"]) / HEAD["ry"] ** 2,
                  p[2] / HEAD["rz"] ** 2])
    return n / (np.linalg.norm(n) + 1e-9)


# ----------------------------------------------------------------- rotation --

def rotate(pts: np.ndarray, yaw_deg: float, pitch_deg: float = 0.0) -> np.ndarray:
    """Camera rotation: pitch about x (down the head), then yaw about y."""
    p = np.asarray(pts, dtype=np.float64)
    if pitch_deg:
        a = np.radians(pitch_deg)
        ca, sa = np.cos(a), np.sin(a)
        y = p[:, 1] * ca - p[:, 2] * sa
        z = p[:, 1] * sa + p[:, 2] * ca
        p = np.c_[p[:, 0], y, z]
    if yaw_deg:
        b = np.radians(yaw_deg)
        cb, sb = np.cos(b), np.sin(b)
        x = p[:, 0] * cb + p[:, 2] * sb
        z = -p[:, 0] * sb + p[:, 2] * cb
        p = np.c_[x, p[:, 1], z]
    return p


def project(pts: np.ndarray, frame: dict) -> tuple[np.ndarray, np.ndarray]:
    """World → canvas pixels. frame = {W,H,scale,cx,cy}; larger z is nearer."""
    px = frame["W"] / 2 + (pts[:, 0] - frame["cx"]) * frame["scale"]
    py = frame["H"] / 2 - (pts[:, 1] - frame["cy"]) * frame["scale"]
    return np.c_[px, py], pts[:, 2]


# -------------------------------------------------------------------- roots --

def scalp_roots(count: int, rng) -> np.ndarray:
    """
    Uniform-area roots on the hair-bearing scalp: above the measured hairline in
    front, down to the nape behind, split by the 8.5 mm centre part.
    """
    n = int(count * 2.4)
    i = np.arange(n) + 0.5
    cos_t = 1.0 - 2.0 * i / n
    theta = np.arccos(np.clip(cos_t, -1, 1))
    az = np.mod(np.pi * (1 + 5 ** 0.5) * i, 2 * np.pi) - np.pi
    sin_t = np.sin(theta)
    p = np.c_[HEAD["rx"] * sin_t * np.sin(az),
              HEAD["yc"] + HEAD["ry"] * np.cos(theta),
              HEAD["rz"] * sin_t * np.cos(az)]
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    front = np.abs(x) > 0.045
    scalp = np.where(z > 0.02,
                     y > hairline_y(x),
                     y > -0.30)
    # the centre part: an 8.5 mm split from the hairline back over the crown.
    # Only the scalp is bare at the parting; the locks on both sides cross it.
    part = ~((np.abs(x) < 0.016) & (y > 0.86) & (z > 0.0))
    keep = scalp & part
    if front is not None:
        pass
    roots = p[keep]
    if len(roots) > count:
        idx = rng.choice(len(roots), size=count, replace=False)
        roots = roots[idx]
    # every root stands 0.6 mm proud of the scalp so it is attached, not sunk
    normals = np.array([head_normal(r) for r in roots])
    roots = roots + normals * 0.6 * MM
    return roots


# -------------------------------------------------------------------- locks --

#: Curl families, (radius mm, pitch mm). Families 0-2 are the printed panel's
#: visible curl (diameter 14-28 mm, pitch 30-50 mm) at three sizes; family 3 is
#: the loose ringlet panel (13 mm / 15 mm); family 4 the tight ringlet panel
#: (8.4 mm / 11.8 mm). Neighbouring locks share a family so the curls read as
#: sheets of wave rather than independent springs.
CURL_FAMILIES = [(8.0, 26.0), (11.0, 34.0), (14.0, 44.0), (6.5, 15.0), (4.2, 11.8)]


def curl_choice(rng, s: float, y0: float, az: float) -> tuple[float, float, int]:
    """Curl radius, pitch and family for a lock, in world units."""
    # A coarse cell over the scalp picks the family, so locks that grow next to
    # each other curl together.
    cell = int(np.floor((az + np.pi) / 0.9)) + 3 * int(np.floor((y0 + 0.4) / 0.42))
    fam = int((cell * 2654435761) % 5)
    if fam == 4 and (s > 0.62 or len(CURL_FAMILIES) < 5):
        fam = 2
    r_mm, p_mm = CURL_FAMILIES[fam]
    return r_mm * MM * float(rng.uniform(0.9, 1.1)), p_mm * MM * float(rng.uniform(0.9, 1.1)), fam


def make_locks(roots: np.ndarray, per_lock: int, rng) -> list[dict]:
    """Cluster neighbouring roots so each lock is a bundle, not a lone hair."""
    k = max(40, len(roots) // per_lock)
    cent, lab = kmeans2(roots, k, minit="++", seed=2202, iter=15)
    az_all = np.arctan2(roots[:, 0], roots[:, 2])
    locks = []
    for li in range(k):
        idx = np.nonzero(lab == li)[0]
        if len(idx) < 2:
            continue
        az = float(np.median(az_all[idx]))
        s = float(rng.choice([0.60, 0.72, 0.84, 0.94, 1.02],
                             p=[0.20, 0.24, 0.26, 0.20, 0.10])) * float(rng.uniform(0.97, 1.03))
        # A lock rooted at the front of the head sweeps out around the face; a
        # side lock keeps its azimuth; a back lock falls behind the shoulders.
        if abs(az) < 0.95:
            side = -1.0 if az < 0 else 1.0
            # Fall far enough around the head that this shell clears the face:
            # x = R·sin(az) must stay outside the face at face height. Solving it
            # here (rather than clamping the path later) is what keeps the hair
            # off the cheeks without deforming the curls.
            need = float(np.arcsin(np.clip(0.57 / max(0.08, sil_w(0.0) * s), 0.0, 0.995)))
            az_fall = side * max(need + 0.10 + float(rng.uniform(-0.06, 0.16)),
                                 float(rng.uniform(0.95, 1.30)))
        elif abs(az) < 2.25:
            az_fall = az * float(rng.uniform(0.96, 1.10))
        else:
            az_fall = az + float(rng.uniform(-0.16, 0.16))
        y0 = float(np.mean(roots[idx, 1]))
        curl_r, curl_p, curl_fam = curl_choice(rng, s, y0, az)
        # Phase locked to the root height, so locks at the same height bulge the
        # same way: the whole sheet waves together, with a diagonal drift.
        locks.append({
            "idx": idx,
            "az0": az,
            "az_fall": az_fall,
            "s": s,
            "curl_r": curl_r,
            "curl_p": curl_p,
            "curl_fam": curl_fam,
            "curl_phase": float(2 * np.pi * (y0 / max(curl_p, 1e-6) * 0.5 + az * 0.35)
                                + rng.uniform(-0.7, 0.7)),
            "sway_amp": float(rng.uniform(0.018, 0.055)),
            "sway_len": float(rng.uniform(0.26, 0.58)),
            "sway_phase": float(rng.uniform(0, 2 * np.pi)),
            "length_factor": float(np.clip(rng.normal(0.965, 0.055), 0.80, 1.0)),
            "crown_lift": float(rng.uniform(0.12, 0.26)) if y0 > 0.55 else 0.0,
            "gloss": float(rng.uniform(0.30, 1.0)),
            # front locks leave the scalp at the hairline and sweep out to the
            # temple; side and back locks comb down the skull for longer
            "hug": float(rng.uniform(0.05, 0.13)) if abs(az) < 0.95 else float(rng.uniform(0.14, 0.42)),
            "z_bias": float(rng.normal(0.0, 0.035)),
            "tint": str(rng.choice(["base", "deep", "mid", "copper", "pink"],
                                  p=[0.46, 0.24, 0.18, 0.08, 0.04])),
            "shade": float(rng.uniform(0.82, 1.16)),
        })
    return locks


# ------------------------------------------------------------------ strands --

def frames(pts: np.ndarray):
    """Unit tangent and a stable normal pair along a polyline."""
    d = np.gradient(pts, axis=0)
    d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    up = np.array([0.0, 1.0, 0.0])
    n1 = np.cross(d, up)
    ln = np.linalg.norm(n1, axis=1, keepdims=True)
    n1 = np.where(ln > 1e-6, n1 / np.maximum(ln, 1e-9), np.array([1.0, 0.0, 0.0]))
    n2 = np.cross(d, n1)
    return d, n1, n2


def lock_guide(root: np.ndarray, lock: dict, rng) -> np.ndarray:
    """
    The centreline of one lock: attached at its root, over the scalp, falling to
    the waist under the lock's own sway, with its ringlet wound around that
    falling line. Every strand of the lock follows this path, offset around its
    cross-section, so the lock is a bundle and not a lone fibre.
    """
    n = N_POINTS
    t = np.linspace(0.0, 1.0, n)
    y0 = float(root[1])
    tip_y = WAIST_Y + (1.0 - lock["length_factor"]) * 0.55

    # ---- phase 1: combed over the skull ---------------------------------
    # The lock follows the head's own surface: from its root it sweeps round to
    # the azimuth where it will hang and descends the skull to the temple (or
    # the nape). Because the point is on the skull during the sweep, the hair
    # can never lie across the forehead or float in front of the head.
    th0 = float(np.arccos(np.clip((y0 - HEAD["yc"]) / HEAD["ry"], -1, 1)))
    back = abs(lock["az0"]) > 1.9
    th_exit = min(th0 + (0.55 + 0.35 * rng.random() if back else 0.30 + 0.55 * rng.random()),
                  2.05 if back else 1.45)
    split = float(np.clip(lock["hug"], 0.04, 0.42))
    u = smoothstep(np.clip(t / split, 0, 1))
    theta = th0 + (th_exit - th0) * u
    az = lock["az0"] + (lock["az_fall"] - lock["az0"]) * u
    off = 0.012 + 0.016 * u
    s_th = np.sin(theta)
    base = np.c_[HEAD["rx"] * s_th * np.sin(az),
                 HEAD["yc"] + HEAD["ry"] * np.cos(theta),
                 HEAD["rz"] * s_th * np.cos(az)]
    nrm = np.c_[base[:, 0] / HEAD["rx"] ** 2,
                (base[:, 1] - HEAD["yc"]) / HEAD["ry"] ** 2,
                base[:, 2] / HEAD["rz"] ** 2]
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    scalp = base + nrm * off[:, None]

    # ---- phase 2: the fall to the waist --------------------------------
    fall = smoothstep(np.clip((t - split) / (1.0 - split), 0, 1))
    y_f = scalp[:, 1] + (tip_y - scalp[:, 1]) * fall
    w = sil_w(y_f) * lock["s"]
    # The fall's azimuth drift ramps in with the fall: at the exit point it must
    # equal the scalp phase's final azimuth, or the path jumps sideways there
    # (that jump showed up as 20 mm segments in the connectivity check).
    az_f = lock["az_fall"] + 0.08 * fall * np.sin(2 * np.pi * fall + lock["sway_phase"])
    rx_e = np.maximum(w, head_rx(y_f) + 0.02)
    rz_e = np.maximum(0.93 * w, head_rz(y_f) + 0.02)
    blend = smoothstep(np.clip(fall / 0.30, 0, 1))
    x = (1 - blend) * scalp[:, 0] + blend * rx_e * np.sin(az_f)
    z = (1 - blend) * scalp[:, 2] + blend * rz_e * np.cos(az_f) + lock["z_bias"] * blend
    y = y_f
    on_scalp = t < split
    x = np.where(on_scalp, scalp[:, 0], x)
    y = np.where(on_scalp, scalp[:, 1], y)
    z = np.where(on_scalp, scalp[:, 2], z)
    az = np.where(on_scalp, az, az_f)

    # Never inside the skull.
    hrx = head_rx(y)
    hrz = head_rz(y)
    m = (hrx > 0.02) & (hrz > 0.02) & ((x / np.maximum(hrx, 1e-6)) ** 2 +
                                       (z / np.maximum(hrz, 1e-6)) ** 2 < 1.0)
    if m.any():
        ang = np.arctan2(x[m] / np.maximum(hrx[m], 1e-6), z[m] / np.maximum(hrz[m], 1e-6))
        x[m] = hrx[m] * 1.03 * np.sin(ang)
        z[m] = hrz[m] * 1.03 * np.cos(ang)

    # Long S-wave: her hair hangs in slow locks. Perpendicular to the fall.
    wave = lock["sway_amp"] * np.sin(2 * np.pi * (y0 - y) / lock["sway_len"] + lock["sway_phase"])
    wave *= smoothstep((t - 0.10) / 0.26) * (0.55 + 0.45 * np.sin(np.pi * t))
    tang = np.c_[np.cos(az), np.zeros(n), -np.sin(az)]      # horizontal, along the head
    x = x + wave * tang[:, 0]
    z = z + wave * tang[:, 2]
    y = y + 0.22 * lock["sway_amp"] * np.sin(2 * np.pi * (y0 - y) / (0.7 * lock["sway_len"]) + lock["sway_phase"])

    pts = np.c_[x, y, z]

    # Ringlet wound around the falling centreline: a wave in the plane of the
    # fall (horizontal + a little depth), so curls read from the front, stay
    # coherent between neighbouring locks and still have volume in profile.
    s_arc = np.cumsum(np.r_[0.0, np.linalg.norm(np.diff(pts, axis=0), axis=1)])
    phase = 2 * np.pi * s_arc / max(lock["curl_p"], 1e-6) + lock["curl_phase"]
    env = smoothstep((t - 0.06) / 0.16) * (0.55 + 0.45 * smoothstep((t - 0.42) / 0.45))
    # Locks that fall beside the face carry a slightly tighter curl, so the coil
    # cannot swing onto the cheek. No clamping is needed — the amplitude is
    # chosen so the path never reaches the face in the first place.
    curl_r = lock["curl_r"] * (0.70 if abs(lock["az_fall"]) < 1.25 else 1.0)
    hdir = np.c_[np.cos(az), np.zeros(n), -np.sin(az)]
    zdir = np.tile(np.array([0.0, 0.0, 1.0]), (n, 1))
    disp = (np.cos(phase)[:, None] * hdir + 0.55 * np.sin(phase)[:, None] * zdir)
    pts = pts + (curl_r * env)[:, None] * disp
    return pts


def build_hair(roots: np.ndarray, locks: list[dict], rng):
    """
    Guides and strands. A lock owns a bundle radius; its strands sit at evenly
    spaced angles around that bundle and join the guide at the scalp.
    """
    guides, strands = [], []
    tt = np.linspace(0.0, 1.0, N_POINTS)
    join = smoothstep((tt - 0.02) / 0.22)
    sub = np.arange(0, N_POINTS, 3)          # fibre geometry: every third sample
    tt_s, join_s = tt[sub], join[sub]
    for lk in locks:
        pts0 = roots[lk["idx"]]
        centre = pts0.mean(axis=0)
        root = pts0[int(np.argmin(((pts0 - centre) ** 2).sum(axis=1)))]
        guide = lock_guide(root, lk, rng)
        d, n1, n2 = frames(guide)
        # Inner shells are built from wide, dark locks that close the gaps
        # between the outer curls; the outer shell carries the visible curl.
        tube_mm = float(rng.uniform(2.6, 5.0)) if lk["s"] > 0.80 else float(rng.uniform(5.5, 9.5))
        lk["tube_mm"] = tube_mm
        guides.append({"pts": guide, "lock": lk, "frames": (d, n1, n2), "root": root})
        m = len(lk["idx"])
        for i, ri in enumerate(lk["idx"]):
            base_theta = 2 * np.pi * (i + 0.5) / m + float(rng.uniform(-0.40, 0.40))
            rad = tube_mm * MM * float(rng.uniform(0.10, 0.85))
            # strands wander around the bundle instead of running as parallel
            # ribs: this is what stops the lock reading as a twisted rope
            theta = base_theta + float(rng.uniform(0.5, 1.3)) * np.sin(
                2 * np.pi * tt_s * float(rng.uniform(1.0, 3.0)) + float(rng.uniform(0, 6.28)))
            off = (rad * join_s)[:, None] * (np.cos(theta)[:, None] * n1[sub] + np.sin(theta)[:, None] * n2[sub])
            pts = guide[sub] + off + (1 - join_s)[:, None] * (roots[ri] - root)[None, :]
            strands.append({"pts": pts, "lock": lk, "root": roots[ri],
                            "tube_mm": float(rng.uniform(0.14, 0.30))})
    return guides, strands


# ------------------------------------------------------------- baby hairs --

def baby_spirals(rng) -> list[dict]:
    """The three measured swirls (r 8 / 11 / 5 mm, L 42 / 56 / 31 mm)."""
    def surf_z(x, y):
        s = 1.0 - (x / HEAD["rx"]) ** 2 - ((y - HEAD["yc"]) / HEAD["ry"]) ** 2
        return HEAD["rz"] * np.sqrt(np.clip(s, 0.0, 1.0))

    out = []
    spots = [(-0.20, 0.46), (0.21, 0.47), (0.0, 0.56)]
    for spec, (x, y) in zip(H.SPEC["baby_swirls"], spots):
        R_mm = spec["radius_cm"] * 10 * MM
        L = spec["length_cm"] * 10 * MM
        turns = max(1.5, L / (2 * np.pi * max(R_mm, 1e-6)) * 0.62)
        n = 220
        u = np.linspace(0, 1, n)
        ang = 2 * np.pi * turns * u + rng.uniform(0, 6.28)
        rr = R_mm * (0.22 + 0.78 * u)
        px = x + rr * np.cos(ang) * 1.05
        py = y + rr * np.sin(ang) * 0.86
        pts = np.c_[px, py, surf_z(px, py) + 0.004]
        out.append({"id": spec["id"], "points": pts, "t": u,
                    "radius_mm": spec["radius_cm"] * 10,
                    "length_mm": spec["length_cm"] * 10,
                    "width_mm": 1.6 - 0.5 * u})
    return out


def headpiece() -> dict:
    """
    The existing gold chain (PCI-FR 2.1 geometry, same path concept) re-seated
    on the reconstructed head: centre chain from the part to the brow gem, and a
    chain at each temple. Kept because it is part of the hairstyle, not new
    jewellery work.
    """
    def surf(x, y, lift=0.02):
        s = 1.0 - (x / HEAD["rx"]) ** 2 - ((y - HEAD["yc"]) / HEAD["ry"]) ** 2
        return HEAD["rz"] * np.sqrt(np.clip(s, 0.0, 1.0)) + lift

    centre = np.array([[0.0, 0.96 - 0.60 * u, surf(0.0, 0.96 - 0.60 * u, 0.030)]
                       for u in np.linspace(0, 1, 60)])
    left, right = [], []
    for u in np.linspace(0, 1, 50):
        y = 0.42 - 0.92 * u
        x = 0.50 + 0.06 * u
        z = surf(-x, min(y, 0.36), 0.030) + max(0.0, 0.36 - y) * 0.85
        left.append([-x, y, z])
        right.append([x, y, z])
    return {"centre": centre, "temple_left": np.array(left), "temple_right": np.array(right),
            "gem": np.array([0.0, 0.30, surf(0.0, 0.30, 0.04)])}


# ------------------------------------------------------------------- shading --

TINT_MIX = {"base": 0.0, "deep": 0.45, "mid": 0.60, "copper": 0.72, "pink": 0.72}
LOCK_SHEEN = {"base": 0.55, "deep": 0.65, "mid": 0.80, "copper": 1.0, "pink": 1.0}


def shade(pts: np.ndarray, lock: dict, light: np.ndarray, rim: np.ndarray,
          lo: float, hi: float):
    """
    Hair shading for one polyline.

    `form` is the shading of the mass (radial normal against the key light), so
    the hair has a lit and a shadowed side instead of a uniform glow. `spec` is
    the Kajiya–Kay lobe on the strand tangent — narrow, and gated by the lock's
    own sheen, so only some locks glint copper. `rim` is the warm backlight that
    picks out the silhouette in her references.
    """
    d, _, _ = frames(pts)
    V = np.array([0.0, 0.0, 1.0])
    n = np.c_[pts[:, 0], np.full(len(pts), 0.30), pts[:, 2]]
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    form = np.clip(n @ light, 0, 1) * 0.55 + 0.45 * np.sqrt(
        np.clip(1 - np.clip(d @ light, -1, 1) ** 2, 0, 1))
    Hh = (light + V) / np.linalg.norm(light + V)
    spec = np.clip(1 - np.clip(d @ Hh, -1, 1) ** 2, 0, 1) ** 30 * LOCK_SHEEN[lock["tint"]]
    Hr = (rim + V) / np.linalg.norm(rim + V)
    rimt = np.clip(1 - np.clip(d @ Hr, -1, 1) ** 2, 0, 1) ** 6 * LOCK_SHEEN[lock["tint"]]
    depth = np.clip((pts[:, 2] - lo) / max(1e-6, hi - lo), 0, 1)
    lum = (0.30 + 0.70 * form) * (0.55 + 0.45 * depth) * lock["shade"]
    base = np.array(PAL[lock["tint"]], dtype=np.float64) * (1 - TINT_MIX[lock["tint"]]) \
        + np.array(PAL["base"], dtype=np.float64) * TINT_MIX[lock["tint"]]
    return base, lum, spec, rimt


def draw_fibres(canvas, strands: list[dict], zbuf, frame, yaw, pitch, per_lock: int = 2):
    if per_lock <= 0:
        return
    """
    Fibre pass: individual strands drawn over the lock bodies.

    The ribbon gives the lock its body and its specular ridge; these strands are
    the actual hair inside it — 20 roots per lock, of which a few are drawn over
    the surface. They are depth-tested with a bias, so they sit on their own lock
    and never bleed through the head.
    """
    by_lock: dict[int, list[dict]] = {}
    for st in strands:
        by_lock.setdefault(id(st["lock"]), []).append(st)
    light = np.array([-0.42, 0.50, 0.76])
    light /= np.linalg.norm(light)
    rim = np.array([0.58, 0.14, -0.80])
    rim /= np.linalg.norm(rim)
    for lock_id, group in by_lock.items():
        step = max(1, len(group) // per_lock)
        for st in group[::step]:
            p = rotate(st["pts"], yaw, pitch)
            px, z = project(p, frame)
            lk = st["lock"]
            col = strand_colour(p, lk, light, rim, -1.0, 1.0,
                                rng_scale=float(0.55 + 0.55 * (hash((lock_id, id(st))) % 100) / 100.0))
            draw_strand(canvas, px, z, col, max(1.0, st["tube_mm"] * MM * frame["scale"] * 1.4),
                        zbuf, chunk=10, bias=0.015)


def smooth1d(a: np.ndarray, k: int) -> np.ndarray:
    """Moving average with edge padding — kills per-section flicker."""
    if k <= 1 or len(a) < k:
        return a
    ker = np.ones(k) / k
    pad = k // 2
    return np.convolve(np.pad(a, pad, mode="edge"), ker, mode="valid")


def lock_colours(p, lock, light, rim, lo, hi):
    """
    Six tones across the lock's width, approximating a round cross-section:
    a shadowed edge, a mid body, a lit ridge and its specular. Drawn as nested
    strokes, so the lock reads as a cylinder of hair rather than a ribbon.
    """
    base, lum, spec, rimt = shade(p, lock, light, rim, lo, hi)
    levels = [0.42, 0.60, 0.78, 0.95, 1.10, 1.24]
    weights = [(0.12, 0.0, 0.0), (0.30, 0.0, 0.0), (0.55, 0.10, 0.0),
               (0.80, 0.35, 0.10), (1.00, 0.65, 0.20), (1.15, 1.00, 0.35)]
    out = []
    for lv, (w_spec, w_spec2, w_rim) in zip(levels, weights):
        col = base[None, :] * (lum * lv)[:, None] \
            + np.array(PAL["copper"])[None, :] * (spec * w_spec)[:, None] \
            + np.array(PAL["bright"])[None, :] * (spec * w_spec2)[:, None] * 0.55 \
            + np.array(PAL["pink"])[None, :] * (rimt * w_rim)[:, None] * 0.6
        out.append(np.clip(col, 0, 255))
    return out


def strand_colour(p, lock, light, rim, lo, hi, rng_scale=1.0):
    base, lum, spec, rimt = shade(p, lock, light, rim, lo, hi)
    col = base[None, :] * (lum * 0.92 * rng_scale)[:, None] \
        + np.array(PAL["copper"])[None, :] * (spec * 0.40)[:, None] \
        + np.array(PAL["pink"])[None, :] * (rimt * 0.18)[:, None]
    return np.clip(col, 0, 255)


# ------------------------------------------------------------------ drawing --

def draw_strand(canvas, px, z, col, thickness, zbuf, chunk=9, bias=0.004):
    """Draw one strand in shaded chunks, skipping chunks hidden by the head."""
    n = len(px)
    th = int(max(1, round(thickness)))
    for i in range(0, n - 1, chunk):
        j = min(i + chunk + 1, n)
        seg = px[i:j]
        if not np.isfinite(seg).all():
            continue
        xs = seg[:, 0]
        ys = seg[:, 1]
        if xs.max() < 0 or xs.min() > canvas.shape[1] - 1 or ys.max() < 0 or ys.min() > canvas.shape[0] - 1:
            continue
        gi = (i + j) // 2
        xi = int(np.clip(seg[len(seg) // 2, 0], 0, canvas.shape[1] - 1))
        yi = int(np.clip(seg[len(seg) // 2, 1], 0, canvas.shape[0] - 1))
        if zbuf is not None and z[gi] < zbuf[yi, xi] - bias:
            continue
        c = col[gi]
        colour = (int(c[0]), int(c[1]), int(c[2]))
        cv2.polylines(canvas, [seg.astype(np.int32)], False, colour, th, cv2.LINE_AA)


VIEW = np.array([0.0, 0.0, 1.0])


def ribbon_mesh(guides: list[dict], yaw: float, pitch: float, frame: dict) -> R.Mesh:
    """
    Every lock as a camera-facing ribbon with three vertices across its width.

    The three vertices carry the normals of a cylinder (side, facing camera,
    side), so the rasteriser interpolates a rounded cross-section: dark edges, a
    lit ridge and a specular line along the lock. The ribbon is billboarded to
    the camera, so a lock never disappears edge-on in any of the four views,
    and the centre vertex bulges towards the camera so overlapping locks occlude
    each other correctly through the shared depth buffer.
    """
    light = np.array([-0.42, 0.50, 0.76])
    light /= np.linalg.norm(light)
    rim = np.array([0.58, 0.14, -0.80])
    rim /= np.linalg.norm(rim)
    Hh = (light + VIEW) / np.linalg.norm(light + VIEW)
    u = np.array([0.0, 0.5, 1.0])
    theta = (u - 0.5) * np.pi

    # depth range for near/far shading, from the lock centrelines of this view
    zmean = np.array([float(rotate(g["pts"], yaw, pitch)[:, 2].mean()) for g in guides])
    zlo, zhi = float(np.percentile(zmean, 5)), float(np.percentile(zmean, 95))

    S = frame["scale"]
    verts, cols, faces = [], [], []
    base_idx = 0
    for gi, g in enumerate(guides):
        C = rotate(g["pts"], yaw, pitch)
        px, z = project(C, frame)
        C, px, z = C[::2], px[::2], z[::2]
        lk = g["lock"]
        n = len(C)
        if n < 6:
            continue
        T = np.gradient(C, axis=0)
        T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
        # The ribbon is built in *screen* space: its width is perpendicular to
        # the lock's projected direction, so the lock keeps a constant apparent
        # width through every bend and never twists like a flat tape.
        dpx = np.gradient(px, axis=0)
        dpx /= np.linalg.norm(dpx, axis=1, keepdims=True) + 1e-9
        nrm2 = np.c_[-dpx[:, 1], dpx[:, 0]]

        t = np.linspace(0.0, 1.0, n)
        taper = (0.55 + 0.45 * smoothstep(t / 0.20)) * (1.0 - 0.62 * smoothstep((t - 0.80) / 0.20))
        # fibre-level variation along the lock: locks are not perfectly smooth
        mod = 0.94 + 0.06 * np.sin(2 * np.pi * (t * (2.0 + lk["curl_p"] / MM / 14.0)) + lk["sway_phase"])
        half_px = lk["tube_mm"] * MM * S * taper
        Wd = np.c_[nrm2[:, 0], -nrm2[:, 1], np.zeros(n)]
        N0 = np.tile(VIEW, (n, 1))

        base = np.array(PAL[lk["tint"]], dtype=np.float64) * (1 - TINT_MIX[lk["tint"]]) \
            + np.array(PAL["base"], dtype=np.float64) * TINT_MIX[lk["tint"]]
        atten = 0.55 + 0.45 * float(np.clip((zmean[gi] - zlo) / max(1e-6, zhi - zlo), 0, 1))
        # Inner shells sit in the shadow of the outer ones: dark, almost matte.
        inner = 1.0 - 0.62 * (1.0 - smoothstep((lk["s"] - 0.62) / 0.26))
        sheen = LOCK_SHEEN[lk["tint"]] * inner

        # Anisotropic sheen, evaluated on the lock's own tangent: the highlight
        # runs *along* the lock, so it follows the curl the way hair does. The
        # lobes are smoothed along the path — an unsmoothed lobe flickers section
        # to section and turns the lock into a row of facets.
        tl = np.clip(T @ light, -1, 1)
        diff = np.sqrt(np.clip(1 - tl ** 2, 0, 1))
        th = np.clip(T @ Hh, -1, 1)
        spec_kk = smooth1d(np.sqrt(np.clip(1 - th ** 2, 0, 1)) ** 24, 7) * sheen
        tr = np.clip(T @ rim, -1, 1)
        rim_kk = smooth1d(np.sqrt(np.clip(1 - tr ** 2, 0, 1)) ** 5, 13) * sheen

        for k, (th_, uu) in enumerate(zip(theta, u)):
            N = N0 if k == 1 else np.sin(th_) * Wd
            N = N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-9)
            lam = np.clip(N @ light, 0, 1)
            lam = (lam + 0.22) / 1.22
            sp_n = np.clip(N @ Hh, 0, 1) ** 14 * 0.16 * sheen
            sp = np.clip(spec_kk * (0.55 + 0.45 * lam) * lk["gloss"] + sp_n, 0, 1.0)
            rt = rim_kk * np.clip(1 - np.clip(N @ VIEW, 0, 1), 0, 1) * 0.34
            lum_v = (0.17 + 0.34 * lam + 0.15 * diff) * atten * inner * lk["shade"] * mod
            col = base[None, :] * lum_v[:, None] \
                + np.array(PAL["copper"], dtype=np.float64)[None, :] * (sp * 1.15)[:, None] \
                + np.array(PAL["bright"], dtype=np.float64)[None, :] * (sp ** 2 * 0.75)[:, None] \
                + np.array(PAL["pink"], dtype=np.float64)[None, :] * (rt * 0.22)[:, None]
            pxk = px + nrm2 * (half_px * (uu - 0.5))[:, None]
            wx = (pxk[:, 0] - frame["W"] / 2) / S + frame["cx"]
            wy = -(pxk[:, 1] - frame["H"] / 2) / S + frame["cy"]
            wz = z + (0.30 * half_px / S if k == 1 else 0.0)
            verts.append(np.c_[wx, wy, wz])
            cols.append(np.clip(col, 0, 255) / 255.0)

        for i in range(n - 1):
            v0 = base_idx + i * 3
            v1 = base_idx + (i + 1) * 3
            faces.append([v0, v0 + 1, v1 + 1])
            faces.append([v0, v1 + 1, v1])
            faces.append([v0 + 1, v0 + 2, v1 + 2])
            faces.append([v0 + 1, v1 + 2, v1 + 1])
        base_idx += n * 3

    if not faces:
        return None
    return R.Mesh(np.vstack(verts), np.array(faces, np.int32), colors=np.vstack(cols),
                  shades=False, name="hair", double_sided=True)


# ---------------------------------------------------------------- meshes ----

def face_atlas(base_rgb: np.ndarray, pts: np.ndarray) -> tuple[np.ndarray, dict]:
    """
    The PCI-FR 1.0 face render on a skin-tone field, so the head is textured on
    the face and plain skin everywhere the texture ends. The 1.0 painted baby
    hairs are inpainted away — geometry replaces them.
    """
    h, w = base_rgb.shape[:2]
    oval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
            379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
            234, 127, 162, 21, 54, 103, 67, 109]
    poly = np.array([pts[i] for i in oval], np.int32)
    m = np.zeros((h, w), np.uint8)
    cv2.fillPoly(m, [poly], 255)
    m = cv2.erode(m, np.ones((5, 5), np.uint8))
    m = cv2.GaussianBlur(m, (0, 0), max(2.0, w * 0.006)).astype(np.float64) / 255.0

    # skin tone from the cheeks
    cheek = []
    for idx in (50, 280, 205, 425):
        x, y = int(pts[idx][0]), int(pts[idx][1])
        cheek.append(base_rgb[max(0, y - 4):y + 5, max(0, x - 4):x + 5].reshape(-1, 3))
    skin = np.median(np.vstack(cheek), axis=0)

    # remove the 1.0 painted baby hairs from the forehead before texturing
    gray = cv2.cvtColor(base_rgb, cv2.COLOR_RGB2GRAY)
    fh = float(np.linalg.norm(pts[10] - pts[152]))
    k = int(max(7, fh * 0.05)) | 1
    bh = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    brows = float(min(pts[105, 1], pts[334, 1]))
    region = np.zeros_like(gray)
    region[int(max(0, brows - 0.55 * fh)):int(brows + 0.02 * fh),
           int(pts[234, 0]):int(pts[454, 0])] = 1
    marks = ((bh > 16) & (region > 0)).astype(np.uint8) * 255
    marks = cv2.dilate(marks, np.ones((3, 3), np.uint8))
    face = cv2.inpaint(base_rgb, marks, 4, cv2.INPAINT_TELEA).astype(np.float64)

    atlas = np.empty_like(face)
    atlas[:] = skin
    atlas = atlas * (1 - m[..., None]) + face * m[..., None]
    return np.clip(atlas, 0, 255).astype(np.uint8), {"skin": skin.tolist(), "size": [w, h]}


def head_mesh(atlas: np.ndarray, pts: np.ndarray, nlat=44, nlon=64) -> R.Mesh:
    """Head ellipsoid, textured with the face on the front, skin everywhere else."""
    fw = float(np.linalg.norm(pts[234] - pts[454]))
    bcx = float((pts[234, 0] + pts[454, 0]) / 2)
    bcy = float((pts[10, 1] + pts[152, 1]) / 2)
    verts, uvs, faces = [], [], []
    for i in range(nlat + 1):
        th = np.pi * i / nlat
        for j in range(nlon):
            az = 2 * np.pi * j / nlon
            p = head_surface(th, az)
            verts.append(p)
            uvs.append([bcx + p[0] * fw, bcy - p[1] * fw])
    for i in range(nlat):
        for j in range(nlon):
            a = i * nlon + j
            b = i * nlon + (j + 1) % nlon
            c = (i + 1) * nlon + (j + 1) % nlon
            d = (i + 1) * nlon + j
            faces.append([a, b, c])
            faces.append([a, c, d])
    return R.Mesh(np.array(verts), np.array(faces, np.int32),
                  colors=np.array([[0.72, 0.52, 0.42]] * len(verts)),
                  uv=np.array(uvs), tex=atlas.astype(np.float64) / 255.0,
                  name="head", double_sided=True)


def body_mesh(skin_rgb) -> R.Mesh:
    """
    Neck and shoulders: the spatial context the hair hangs against. Not an
    anatomy reconstruction — a simple lofted bust so the four views are not
    floating hair capsules.
    """
    levels = [(-0.30, 0.19, 0.19), (-0.55, 0.21, 0.20), (-0.74, 0.23, 0.22),
              (-0.92, 0.40, 0.27), (-1.06, 0.82, 0.32), (-1.24, 0.98, 0.34),
              (-1.55, 1.02, 0.35), (-2.00, 1.00, 0.34), (-2.50, 0.94, 0.33)]
    nlon = 48
    skin = np.array(skin_rgb, dtype=np.float64) / 255.0
    cloth = np.array([112, 100, 96], dtype=np.float64) / 255.0
    verts, cols, faces = [], [], []
    for (y, wx, wz) in levels:
        for j in range(nlon):
            a = 2 * np.pi * j / nlon
            verts.append([wx * np.sin(a), y, wz * np.cos(a)])
            w = np.clip((-1.06 - y) / 0.16, 0, 1)
            cols.append(skin * (1 - w) + cloth * w)
    for i in range(len(levels) - 1):
        for j in range(nlon):
            a = i * nlon + j
            b = i * nlon + (j + 1) % nlon
            c = (i + 1) * nlon + (j + 1) % nlon
            d = (i + 1) * nlon + j
            faces.append([a, b, c])
            faces.append([a, c, d])
    return R.Mesh(np.array(verts), np.array(faces, np.int32), colors=np.array(cols),
                  name="body", double_sided=True)


# ------------------------------------------------------------------- render --

def render_view(guides, strands, head, body, spirals, chain, yaw, pitch, frame, ss,
                background=(30, 28, 30), draw_chain=True, draw_spirals=True):
    """One camera: opaque head/shoulders first, hair depth-tested over them."""
    W, H = frame["W"], frame["H"]
    cx, cy = frame["cx"], frame["cy"]
    S = frame["scale"]

    hs = R.Mesh(rotate(head.verts, yaw, pitch), head.faces, head.colors,
                uv=head.uv, tex=head.tex, name="head", double_sided=True)
    bs = R.Mesh(rotate(body.verts, yaw, pitch), body.faces, body.colors,
                name="body", double_sided=True)
    bg = np.array(background, dtype=np.float64) / 255.0
    hair = ribbon_mesh(guides, yaw, pitch, frame)
    meshes = [bs, hs] + ([hair] if hair is not None else [])
    img, zbuf = R.render(meshes, W, H, S, center=(cx, cy), background=bg,
                         ambient=0.78, light=(-0.30, 0.42, 0.86), return_depth=True)
    canvas = img.copy()
    draw_fibres(canvas, strands, zbuf, frame, yaw, pitch)

    if draw_spirals:
        for sw in spirals:
            p = rotate(sw["points"], yaw, pitch)
            px, z = project(p, frame)
            depth_ok = np.array([z[k] >= zbuf[int(np.clip(px[k, 1], 0, H - 1)),
                                             int(np.clip(px[k, 0], 0, W - 1))] - 0.003
                                 for k in range(len(px))])
            if depth_ok.mean() < 0.5:
                continue
            wdt = float(np.mean(sw["width_mm"]))
            cv2.polylines(canvas, [px.astype(np.int32)], False, (28, 13, 12),
                          int(max(2, wdt * MM * S * 2)), cv2.LINE_AA)
            cv2.polylines(canvas, [px.astype(np.int32)], False, (96, 44, 30),
                          int(max(1, wdt * MM * S * 0.7)), cv2.LINE_AA)

    if draw_chain:
        for key, colour in (("centre", (214, 158, 88)), ("temple_left", (206, 150, 82)),
                            ("temple_right", (206, 150, 82))):
            p = rotate(chain[key], yaw, pitch)
            px, z = project(p, frame)
            vis = np.array([z[k] >= zbuf[int(np.clip(px[k, 1], 0, H - 1)),
                                        int(np.clip(px[k, 0], 0, W - 1))] - 0.01
                            for k in range(len(px))])
            pts = px[vis]
            if len(pts) > 3:
                cv2.polylines(canvas, [pts.astype(np.int32)], False, colour,
                              int(max(2, 2.0 * MM * S)), cv2.LINE_AA)
        g = rotate(chain["gem"][None, :], yaw, pitch)
        gpx, _ = project(g, frame)
        cv2.circle(canvas, (int(gpx[0, 0]), int(gpx[0, 1])), int(max(4, 4.6 * MM * S)),
                   (232, 150, 186), -1, cv2.LINE_AA)
    return canvas


def downsample(img: np.ndarray, ss: int) -> np.ndarray:
    if ss <= 1:
        return np.clip(img, 0, 255).astype(np.uint8)
    h, w = img.shape[:2]
    out = cv2.resize(img, (w // ss, h // ss), interpolation=cv2.INTER_AREA)
    return np.clip(out, 0, 255).astype(np.uint8)


def frame_for(y_top, y_bottom, out_w, out_h, ss, cx=0.0):
    S = (out_h * ss) / (y_top - y_bottom)
    return {"W": out_w * ss, "H": out_h * ss, "scale": S, "cx": cx,
            "cy": (y_top + y_bottom) / 2}


# -------------------------------------------------------------------- driver --

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-2.2"))
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--strands", type=int, default=7800)
    ap.add_argument("--per-lock", type=int, default=17)
    ap.add_argument("--ss", type=int, default=2)
    ap.add_argument("--only", default="", help="comma list: front,views,full,crown,curl,baby")
    a = ap.parse_args()
    outdir = os.path.join(a.out, "hair")
    os.makedirs(outdir, exist_ok=True)
    want = set(x.strip() for x in a.only.split(",") if x.strip()) or {
        "front", "views", "full", "crown", "curl", "baby"}

    rng = np.random.default_rng(2027)
    roots = scalp_roots(a.strands, rng)
    locks = make_locks(roots, a.per_lock, rng)
    guides, strands = build_hair(roots, locks, rng)
    spirals = baby_spirals(np.random.default_rng(7))
    chain = headpiece()

    base_img = Image.open(a.base).convert("RGB")
    base_rgb = np.asarray(base_img)
    lm_mod, lm = P._landmarker()
    base_pts = P.load_landmarks(a.base, lm)
    lm.close()
    atlas, atlas_meta = face_atlas(base_rgb, base_pts)
    head = head_mesh(atlas, base_pts)
    body = body_mesh(atlas_meta["skin"])

    ss = a.ss
    written = {}

    def save(name, img, ss_used):
        p = os.path.join(outdir, name)
        Image.fromarray(downsample(img, ss_used)).save(p)
        written[name] = os.path.relpath(p, ROOT)

    # portrait: head + shoulders, her face, hair framing it
    if "front" in want or "views" in want:
        f = frame_for(1.52, -1.62, 900, 1200, ss)
        if "front" in want:
            img = render_view(guides, strands, head, body, spirals, chain, 0, 0, f, ss)
            save("hair_front.png", img, ss)
            front_frame = f

    if "views" in want:
        for name, yaw in (("three_quarter", 42), ("profile", 90), ("rear", 180)):
            f = frame_for(1.52, -1.62, 760, 1150, ss)
            img = render_view(guides, strands, head, body, spirals, chain, yaw, 0, f, ss,
                              draw_chain=(yaw == 0), draw_spirals=(yaw == 0))
            save(f"hair_{name}.png", img, ss)

    # full length: the whole hairstyle down to the waist
    if "full" in want:
        f = frame_for(1.55, -3.95, 880, 1500, ss)
        img = render_view(guides, strands, head, body, spirals, chain, 0, 0, f, ss,
                          background=(28, 26, 28))
        save("hair_full_length.png", img, ss)

    # crown and parting, looking straight down
    if "crown" in want:
        f = frame_for(1.55, -0.85, 900, 900, ss)
        img = render_view(guides, strands, head, body, spirals, chain, 0, 88, f, ss,
                          background=(30, 28, 30), draw_chain=False, draw_spirals=False)
        save("hair_crown.png", img, ss)

    # curl close-up at 8 px/mm
    if "curl" in want:
        f = {"W": 900 * ss, "H": 700 * ss, "scale": 1200 * ss, "cx": 0.58, "cy": -0.98}
        img = render_view(guides, strands, head, body, spirals, chain, 0, 0, f, ss,
                          background=(26, 24, 26), draw_chain=False, draw_spirals=False)
        save("hair_curl_closeup.png", img, ss)

    # baby hairs close-up
    if "baby" in want:
        f = {"W": 900 * ss, "H": 620 * ss, "scale": 1500 * ss, "cx": 0.0, "cy": 0.58}
        img = render_view(guides, strands, head, body, spirals, chain, 0, 0, f, ss,
                          background=(30, 28, 30), draw_chain=True, draw_spirals=True)
        save("hair_babyhairs.png", img, ss)

    # ---- geometry measurements (independent of any rendering) --------------
    all_pts = np.vstack([s["pts"] for s in strands])
    lengths = np.array([np.linalg.norm(np.diff(s["pts"], axis=0), axis=1).sum() for s in strands])
    tips = np.array([s["pts"][-1] for s in strands])
    chin_mm = (CHIN_Y - tips[:, 1]) * H.HEAD_WIDTH_MM
    root_err = []
    for s in strands:
        p = s["root"]
        q = np.array([p[0] / HEAD["rx"], (p[1] - HEAD["yc"]) / HEAD["ry"], p[2] / HEAD["rz"]])
        root_err.append(abs(np.linalg.norm(q) - 1.0) * H.HEAD_WIDTH_MM)
    seg = np.linalg.norm(np.diff(all_pts[: min(len(all_pts), 200000)], axis=0), axis=1) * H.HEAD_WIDTH_MM
    meta = {
        "schema": "lelu.hair.volume/2",
        "strands": len(strands),
        "locks": len(locks),
        "points_per_strand": N_POINTS,
        "head": HEAD,
        "chin_y_fw": CHIN_Y,
        "waist_y_fw": WAIST_Y,
        "waist_below_chin_fw": WAIST_BELOW_CHIN_FW,
        "waist_below_chin_mm": round(WAIST_BELOW_CHIN_FW * H.HEAD_WIDTH_MM, 1),
        "geometry_length_mm": {
            "below_chin_mean": round(float(chin_mm.mean()), 1),
            "below_chin_max": round(float(chin_mm.max()), 1),
            "below_chin_p05": round(float(np.percentile(chin_mm, 5)), 1),
            "strand_arc_mean": round(float(lengths.mean()), 1),
            "strand_arc_max": round(float(lengths.max()), 1),
        },
        "silhouette_half_width_fw": {
            "shoulder_y_-1.1": round(float(sil_w(-1.10)), 3),
            "widest": round(float(max(SIL_W)), 3),
        },
        "curl": {
            "radius_mm": [round(float(l["curl_r"] / MM), 2) for l in locks[:8]],
            "pitch_mm": [round(float(l["curl_p"] / MM), 2) for l in locks[:8]],
            "radius_mm_range": [round(min(l["curl_r"] for l in locks) / MM, 2),
                                round(max(l["curl_r"] for l in locks) / MM, 2)],
            "pitch_mm_range": [round(min(l["curl_p"] for l in locks) / MM, 2),
                               round(max(l["curl_p"] for l in locks) / MM, 2)],
        },
        "strand_diameter_mm": [round(min(s["tube_mm"] for s in strands), 2),
                               round(max(s["tube_mm"] for s in strands), 2)],
        "lock_diameter_mm": [round(2 * min(l["tube_mm"] for l in locks), 2),
                             round(2 * max(l["tube_mm"] for l in locks), 2)],
        "root_on_scalp_mm_error": {"max": round(float(max(root_err)), 3),
                                   "mean": round(float(np.mean(root_err)), 3)},
        "segment_length_mm_max": round(float(seg.max()), 3),
        "density": {"roots_per_cm2": round(len(roots) / (4 * np.pi * 0.62 * 0.80 * H.HEAD_WIDTH_MM ** 2 / 100), 1)},
        "babyspiral_ids": [s["id"] for s in spirals],
        "views": written,
    }

    # LOD geometry for the app viewer: the lock guides as tubes
    lod = []
    for g in guides[:280]:
        lk = g["lock"]
        pts = g["pts"][::3]
        cols = np.tile(np.array(PAL[lk["tint"]], dtype=np.float64) / 255.0, (len(pts), 1))
        lod.append(R.tube(pts, lk["tube_mm"] * MM, sides=5, colors=cols, name="lock"))
    R.export_glb(lod, os.path.join(outdir, "lelu_hair_volume.glb"), name="lelu_hair_volume")
    meta["glb"] = os.path.relpath(os.path.join(outdir, "lelu_hair_volume.glb"), ROOT)
    meta["glb_lock_count"] = len(lod)

    json.dump(meta, open(os.path.join(outdir, "hair-volume.json"), "w"), indent=1)
    print(json.dumps({k: meta[k] for k in ("strands", "locks", "geometry_length_mm", "curl",
                                           "root_on_scalp_mm_error")}, indent=1))


if __name__ == "__main__":
    main()
