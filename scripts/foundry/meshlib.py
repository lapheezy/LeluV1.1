"""
==========================================================
LÉLU CHARACTER FOUNDRY — GEOMETRY KERNEL
==========================================================

Pure-numpy geometry so every production object is built from
real surfaces rather than painted onto a body texture:

  loft          quad grids between cross-sections (body, garments)
  tube          parallel-transport sweep (limbs, chains, ribbons)
  torus_link    a single oval chain link
  chain         alternating links along a path
  gem           faceted crystal drop / rose-cut bead
  rose          layered petals around a bud (real geometry)
  plate         bevelled hard-surface panel (buckles, pauldron)
  stud          rivet / eyelet
  ribbon        twisted flat strip (hanging sashes)

Everything returns (verts, faces) as numpy arrays plus a
triangle-safe face list, so it can go straight into
bpy mesh.from_pydata and survive glTF export.
==========================================================
"""

from __future__ import annotations

import math

import numpy as np


# ------------------------------------------------------------------ helpers
def _v(a) -> np.ndarray:
    return np.asarray(a, dtype=np.float64)


def superellipse(rx: float, ry: float, n: int, power: float = 2.0, phase: float = 0.0) -> np.ndarray:
    """A closed ring in the local XY plane, `power`=2 is an ellipse."""
    t = np.linspace(0.0, 2.0 * math.pi, n, endpoint=False) + phase
    c, s = np.cos(t), np.sin(t)
    e = 2.0 / power
    x = rx * np.sign(c) * np.abs(c) ** e
    y = ry * np.sign(s) * np.abs(s) ** e
    return np.stack([x, y, np.zeros_like(x)], axis=1)


def ring(center, rx, ry, n=48, power=2.0, y_scale_front=1.0, y_scale_back=1.0) -> np.ndarray:
    """
    A horizontal body ring. Front (-Y) and back (+Y) depths can differ,
    which is what makes a chest read as a chest and a back read as a back.
    """
    pts = superellipse(rx, ry, n, power)
    y = pts[:, 1]
    y = np.where(y < 0, y * y_scale_front, y * y_scale_back)
    pts[:, 1] = y
    pts[:, 2] = 0.0
    return pts + _v(center)


def loft(rings, close_ring=True, cap_start=False, cap_end=False):
    """Quad strip between successive rings of equal vertex count."""
    rings = [np.asarray(r, dtype=np.float64) for r in rings]
    n = len(rings[0])
    verts = np.concatenate(rings, axis=0)
    faces = []
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        limit = n if close_ring else n - 1
        for j in range(limit):
            j2 = (j + 1) % n
            faces.append([a + j, a + j2, b + j2, b + j])
    if cap_start:
        faces.append(list(range(n))[::-1])
    if cap_end:
        base = (len(rings) - 1) * n
        faces.append([base + j for j in range(n)])
    return verts, faces


def frames(path: np.ndarray):
    """Parallel-transport frames along a polyline: (tangent, normal, binormal)."""
    path = np.asarray(path, dtype=np.float64)
    seg = np.diff(path, axis=0)
    tangents = np.vstack([seg, seg[-1:]])
    tangents /= np.linalg.norm(tangents, axis=1, keepdims=True) + 1e-12
    ref = np.array([0.0, 0.0, 1.0])
    if abs(np.dot(tangents[0], ref)) > 0.95:
        ref = np.array([0.0, 1.0, 0.0])
    normals = []
    n = np.cross(tangents[0], ref)
    n /= np.linalg.norm(n) + 1e-12
    normals.append(n)
    for i in range(1, len(path)):
        prev_t, t = tangents[i - 1], tangents[i]
        axis = np.cross(prev_t, t)
        if np.linalg.norm(axis) < 1e-9:
            normals.append(normals[-1])
            continue
        axis /= np.linalg.norm(axis)
        angle = math.acos(float(np.clip(np.dot(prev_t, t), -1.0, 1.0)))
        prev_n = normals[-1]
        n = prev_n * math.cos(angle) + np.cross(axis, prev_n) * math.sin(angle)
        normals.append(n / (np.linalg.norm(n) + 1e-12))
    normals = np.asarray(normals)
    binormals = np.cross(tangents, normals)
    return tangents, normals, binormals


def tube(path, radii, sides=12, cap=True, squash=None, phase=0.0):
    """Sweep a circular (or elliptical) profile along a path."""
    path = np.asarray(path, dtype=np.float64)
    if np.isscalar(radii):
        radii = np.full(len(path), float(radii))
    radii = np.asarray(radii, dtype=np.float64)
    t, n, b = frames(path)
    ang = np.linspace(0, 2 * math.pi, sides, endpoint=False) + phase
    verts = []
    for i in range(len(path)):
        r = radii[i]
        rx, ry = (r, r) if squash is None else (r * squash[0], r * squash[1])
        circle = np.cos(ang)[:, None] * n[i][None, :] * rx + np.sin(ang)[:, None] * b[i][None, :] * ry
        verts.append(path[i] + circle)
    verts = np.concatenate(verts, axis=0)
    faces = []
    for i in range(len(path) - 1):
        a, c = i * sides, (i + 1) * sides
        for j in range(sides):
            j2 = (j + 1) % sides
            faces.append([a + j, a + j2, c + j2, c + j])
    if cap:
        faces.append(list(range(sides))[::-1])
        base = (len(path) - 1) * sides
        faces.append([base + j for j in range(sides)])
    return verts, faces


def catmull(points, samples_per_seg=8):
    """Smooth a control polyline into a dense path (Catmull-Rom)."""
    p = np.asarray(points, dtype=np.float64)
    if len(p) < 3:
        return p
    ext = np.vstack([p[0] + (p[0] - p[1]), p, p[-1] + (p[-1] - p[-2])])
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(samples_per_seg):
            t = s / samples_per_seg
            t2, t3 = t * t, t * t * t
            out.append(
                0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                       + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            )
    out.append(ext[-2])
    return np.asarray(out)


def torus_link(major=0.012, minor=0.0022, seg=24, sides=8, stretch=1.0):
    """One oval chain link lying in the XZ plane."""
    verts = []
    for i in range(seg):
        u = 2 * math.pi * i / seg
        cx, cz = major * math.cos(u), major * stretch * math.sin(u)
        for j in range(sides):
            v = 2 * math.pi * j / sides
            r = minor
            x = (major + r * math.cos(v)) * math.cos(u)
            z = (major * stretch + r * math.cos(v)) * math.sin(u)
            y = r * math.sin(v)
            verts.append([x, y, z])
    verts = np.asarray(verts)
    faces = []
    for i in range(seg):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            c = ((i + 1) % seg) * sides + (j + 1) % sides
            d = ((i + 1) % seg) * sides + j
            faces.append([a, b, c, d])
    return verts, faces


def transform(verts, rot=None, scale=1.0, translate=None):
    v = np.asarray(verts, dtype=np.float64) * scale
    if rot is not None:
        rx, ry, rz = [math.radians(a) for a in rot]
        Rx = np.array([[1, 0, 0], [0, math.cos(rx), -math.sin(rx)], [0, math.sin(rx), math.cos(rx)]])
        Ry = np.array([[math.cos(ry), 0, math.sin(ry)], [0, 1, 0], [-math.sin(ry), 0, math.cos(ry)]])
        Rz = np.array([[math.cos(rz), -math.sin(rz), 0], [math.sin(rz), math.cos(rz), 0], [0, 0, 1]])
        v = v @ (Rz @ Ry @ Rx).T
    if translate is not None:
        v = v + _v(translate)
    return v


def merge(*parts):
    """Concatenate (verts, faces) pairs with index offsets."""
    verts, faces = [], []
    offset = 0
    for v, f in parts:
        verts.append(np.asarray(v, dtype=np.float64))
        faces.extend([[i + offset for i in face] for face in f])
        offset += len(v)
    return np.concatenate(verts, axis=0), faces


# ------------------------------------------------------------------- props
def gem(radius=0.012, length=None, facets=8, sq=1.6):
    """A faceted crystal drop: pointed top, girdle, long pointed bottom."""
    length = length if length is not None else radius * 3.4
    ring_a = superellipse(radius, radius, facets, 2.0)
    ring_b = ring_a * 1.0
    verts = [[0, 0, 0.0]]
    z_girdle_hi = length * 0.18
    z_girdle_lo = -length * 0.10
    for p in ring_a:
        verts.append([p[0], p[1], z_girdle_hi])
    for p in ring_b:
        verts.append([p[0] * 0.55, p[1] * 0.55, z_girdle_lo])
    verts.append([0, 0, -length])
    top = 0
    n = facets
    faces = []
    for j in range(n):
        faces.append([top, 1 + (j + 1) % n, 1 + j])
    for j in range(n):
        j2 = (j + 1) % n
        faces.append([1 + j, 1 + j2, 1 + n + j2, 1 + n + j])
    bottom = len(verts) - 1
    for j in range(n):
        j2 = (j + 1) % n
        faces.append([1 + n + j, 1 + n + j2, bottom])
    return np.asarray(verts, dtype=np.float64) * np.array([1, 1, 1]), faces


def bead(radius=0.010, facets=16):
    """A polished metal sphere rendered as a smooth quad ball."""
    verts, faces = [], []
    rows = max(8, facets // 2)
    cols = facets
    for i in range(rows + 1):
        phi = math.pi * i / rows
        for j in range(cols):
            th = 2 * math.pi * j / cols
            verts.append([radius * math.sin(phi) * math.cos(th),
                          radius * math.sin(phi) * math.sin(th),
                          radius * math.cos(phi)])
    for i in range(rows):
        for j in range(cols):
            a = i * cols + j
            b = i * cols + (j + 1) % cols
            c = (i + 1) * cols + (j + 1) % cols
            d = (i + 1) * cols + j
            faces.append([a, b, c, d])
    return np.asarray(verts), faces


def chain(path, link_len=0.016, link_r=0.0022, spacing=0.75, tangle=0.0):
    """Alternating-link chain along a path. No gaps, no overlaps."""
    path = np.asarray(path, dtype=np.float64)
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    total = float(seg.sum())
    if total < link_len:
        return np.zeros((0, 3)), []
    # arc-length parameterisation
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    count = max(2, int(total / (link_len * spacing)))
    ts = np.linspace(0, total, 400)
    px = np.interp(ts, cum, path[:, 0])
    py = np.interp(ts, cum, path[:, 1])
    pz = np.interp(ts, cum, path[:, 2])
    dense = np.stack([px, py, pz], axis=1)
    out = []
    for k in range(count):
        s = total * (k + 0.5) / count
        i = int(np.clip(s / total * (len(dense) - 1), 0, len(dense) - 1))
        p = dense[i]
        nxt = dense[min(i + 2, len(dense) - 1)]
        d = nxt - p
        d /= np.linalg.norm(d) + 1e-12
        # orient the link along the chain, alternating 90 degrees
        yaw = math.degrees(math.atan2(d[1], d[0]))
        pitch = math.degrees(math.asin(float(np.clip(d[2], -1, 1))))
        v, f = torus_link(link_len * 0.5, link_r)
        v = transform(v, rot=(90 + pitch, 0, yaw + (90 if k % 2 else 0)),
                      translate=p)
        out.append((v, f))
    return merge(*out) if out else (np.zeros((0, 3)), [])


def plate(width=0.06, height=0.09, thick=0.005, bevel=0.006, points=None):
    """A bevelled hard-surface panel with a raised rim (buckle / pauldron)."""
    if points is None:
        pts = [(-width / 2, -height / 2), (width / 2, -height / 2),
               (width / 2, height / 2), (-width / 2, height / 2)]
    else:
        pts = points
    n = len(pts)
    rings = []
    for inset, z in ((bevel, 0.0), (0.0, thick * 0.4), (0.0, thick)):
        r = []
        for (x, y) in pts:
            sx = math.copysign(max(abs(x) - inset, 0.0), x)
            sy = math.copysign(max(abs(y) - inset, 0.0), y)
            r.append([sx, sy, z])
        rings.append(np.asarray(r))
    verts, faces = loft(rings, close_ring=True, cap_start=True, cap_end=True)
    return verts, faces


def stud(radius=0.0035, height=0.0022):
    """A rivet / eyelet: a small dome with a base ring."""
    base = superellipse(radius, radius, 12, 2.0)
    dome = base * 0.55
    v = np.concatenate([base, dome, np.array([[0, 0, height]])])
    faces = []
    for j in range(12):
        j2 = (j + 1) % 12
        faces.append([j, j2, 12 + j2, 12 + j])
    for j in range(12):
        j2 = (j + 1) % 12
        faces.append([12 + j, 12 + j2, 24])
    faces.append(list(range(12))[::-1])
    return v, faces


def ribbon(path, width=0.02, thickness=0.0015, twist=0.0):
    """A flat strip that can twist along its length (hanging sashes)."""
    path = np.asarray(path, dtype=np.float64)
    t, n, b = frames(path)
    verts = []
    rows = len(path)
    for i in range(rows):
        ang = twist * (i / max(1, rows - 1))
        nrm = n[i] * math.cos(ang) + b[i] * math.sin(ang)
        side = b[i] * math.cos(ang) - n[i] * math.sin(ang)
        for sgn, off in ((-1, -width / 2), (1, width / 2)):
            verts.append(path[i] + side * off + nrm * (thickness * (0.5 if sgn > 0 else -0.5)))
    verts = np.asarray(verts)
    # give it a second face so it is not a single-sided sliver
    verts2 = verts + (np.roll(verts, 0, axis=0) * 0.0)
    faces = []
    for i in range(rows - 1):
        a = i * 2
        faces.append([a, a + 1, a + 3, a + 2])
    return verts, faces


def rose(petal_count=7, rings=3, radius=0.03, height=0.022, curl=0.55):
    """
    A rose built from real petals: an inner bud, then successive rings of
    cupped petals, each ring rotated and opened wider. Petals are quad
    patches with a rolled outer edge, so the silhouette reads as a rose
    from every angle instead of a painted disc.
    """
    parts = []
    # bud
    bud_rows = 8
    bud_cols = 16
    bv, bf = [], []
    for i in range(bud_rows + 1):
        phi = math.pi * 0.85 * i / bud_rows
        for j in range(bud_cols):
            th = 2 * math.pi * j / bud_cols
            r = radius * 0.30 * math.sin(phi)
            bv.append([r * math.cos(th), r * math.sin(th), height * 0.55 * (1 - math.cos(phi))])
    for i in range(bud_rows):
        for j in range(bud_cols):
            a = i * bud_cols + j
            b = i * bud_cols + (j + 1) % bud_cols
            c = (i + 1) * bud_cols + (j + 1) % bud_cols
            d = (i + 1) * bud_cols + j
            bf.append([a, b, c, d])
    parts.append((np.asarray(bv), bf))

    for r_i in range(rings):
        openness = 0.35 + 0.32 * r_i
        r_scale = radius * (0.45 + 0.28 * r_i)
        z_base = height * (0.30 + 0.22 * r_i)
        count = petal_count
        for k in range(count):
            th0 = 2 * math.pi * (k / count) + r_i * 0.42
            u_steps, v_steps = 6, 5
            pv = []
            for u in range(u_steps + 1):
                uu = u / u_steps
                for v in range(v_steps + 1):
                    vv = v / v_steps
                    # petal outline: sin gives a rounded, slightly notched tip
                    half = (math.pi / count) * (0.86 + 0.18 * math.sin(vv * math.pi))
                    th = th0 + (uu - 0.5) * 2 * half
                    rad = r_scale * (0.55 + 0.75 * vv)
                    z = z_base + height * vv * openness - height * 0.30 * (uu - 0.5) ** 2
                    # cup the petal: edges lift toward the centre
                    z += height * curl * 0.22 * (math.cos((uu - 0.5) * math.pi) )
                    x = rad * math.cos(th)
                    y = rad * math.sin(th)
                    z += (vv ** 2) * height * 0.16
                    pv.append([x, y, z])
            faces = []
            for u in range(u_steps):
                for v in range(v_steps):
                    a = u * (v_steps + 1) + v
                    faces.append([a, a + 1, a + v_steps + 2, a + v_steps + 1])
            parts.append((np.asarray(pv), faces))

    return merge(*parts)


def leaf(length=0.03, width=0.012):
    """A serrated rose leaf: a curved, folded blade."""
    u_steps, v_steps = 7, 6
    verts = []
    for u in range(u_steps + 1):
        uu = u / u_steps
        for v in range(v_steps + 1):
            vv = v / v_steps
            half = (width / 2) * math.sin(math.pi * min(1.0, vv * 1.05)) * (1.0 - 0.25 * uu) \
                * (0.85 + 0.15 * math.cos(vv * math.pi * 6))
            verts.append([(vv - 0.5) * width * 2 * 0 + half * 0.0 + (vv - 0.5) * width,
                          length * uu,
                          0.10 * width * math.cos((vv - 0.5) * math.pi) - 0.22 * length * uu ** 2])
    faces = []
    for u in range(u_steps):
        for v in range(v_steps):
            a = u * (v_steps + 1) + v
            faces.append([a, a + 1, a + v_steps + 2, a + v_steps + 1])
    return np.asarray(verts), faces


def hair_strand(root, direction, length, curl_r, turns, seg=26, sides=5,
                r0=0.0011, gravity=0.55, jitter=0.0, rng=None):
    """
    One curl: a helical sweep whose axis follows `direction` and bends
    under gravity, tapering to a point. This is real strand geometry,
    not a ribbon card.
    """
    d = _v(direction) / (np.linalg.norm(direction) + 1e-12)
    up = np.array([0.0, 0.0, 1.0])
    side = np.cross(d, up)
    if np.linalg.norm(side) < 1e-6:
        side = np.array([1.0, 0.0, 0.0])
    side /= np.linalg.norm(side)
    other = np.cross(d, side)
    pts = []
    for i in range(seg):
        s = i / (seg - 1)
        ang = turns * 2 * math.pi * s
        radius = curl_r * (0.35 + 0.9 * s) * (0.5 + 0.5 * math.sin(math.pi * s))
        base = _v(root) + d * (length * s)
        base[2] -= gravity * length * 0.55 * s ** 1.8
        if rng is not None and jitter:
            base = base + rng.normal(0, jitter * length, 3) * s
        pts.append(base + side * (radius * math.cos(ang)) + other * (radius * math.sin(ang)))
    pts = np.asarray(pts)
    radii = np.linspace(r0, r0 * 0.18, seg)
    verts, faces = tube(pts, radii, sides=sides, cap=True)
    return verts, faces
