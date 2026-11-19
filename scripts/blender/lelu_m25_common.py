"""
LÉLU M25 — shared measurement helpers (numpy, inside Blender).

Imported by lelu_m25_build.py and lelu_m25_classmap.py. Everything here reads
the mesh; nothing writes it.
"""
import colorsys

import bpy
import numpy as np


def mesh_arrays(obj):
    """World-space positions, triangle vertex/loop indices, loop normals, UVs."""
    me = obj.data
    me.calc_loop_triangles()
    nv = len(me.vertices)
    co = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    m = np.array(obj.matrix_world, dtype=np.float64)
    wco = co @ m[:3, :3].T + m[:3, 3]
    nt = len(me.loop_triangles)
    tv = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", tv)
    tl = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("loops", tl)
    tp = np.empty(nt, np.int32)
    me.loop_triangles.foreach_get("polygon_index", tp)
    uv = None
    if me.uv_layers.active:
        uvd = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers.active.data.foreach_get("uv", uvd)
        uv = uvd.reshape(-1, 2).astype(np.float64)
    return {"co": co, "wco": wco, "tv": tv.reshape(-1, 3), "tl": tl.reshape(-1, 3), "tp": tp, "uv": uv, "m": m}


def weld_ids(points, tol=1e-6):
    q = np.round(points / tol).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    return inv.reshape(-1)


def face_normals(wco, tv):
    a, b, c = wco[tv[:, 0]], wco[tv[:, 1]], wco[tv[:, 2]]
    cr = np.cross(b - a, c - a)
    ar = np.linalg.norm(cr, axis=1)
    return cr / np.maximum(ar[:, None], 1e-20), ar / 2


def triangle_dihedral(wco, tv):
    """Mean unsigned bend (degrees) between each triangle and its position-adjacent neighbours."""
    fn, _ = face_normals(wco, tv)
    wid = weld_ids(wco)
    wt = wid[tv]
    e = np.concatenate([wt[:, [0, 1]], wt[:, [1, 2]], wt[:, [2, 0]]], 0)
    tri = np.concatenate([np.arange(len(tv))] * 3)
    key = np.sort(e, 1)
    k = key[:, 0].astype(np.int64) * (int(wid.max()) + 1) + key[:, 1]
    o = np.argsort(k, kind="stable")
    ks, ts = k[o], tri[o]
    same = np.nonzero(ks[1:] == ks[:-1])[0]
    t1, t2 = ts[same], ts[same + 1]
    d = np.degrees(np.arccos(np.clip(np.abs(np.sum(fn[t1] * fn[t2], 1)), -1, 1)))
    d = np.minimum(d, 180 - d) if False else d
    tot = np.zeros(len(tv))
    cnt = np.zeros(len(tv))
    np.add.at(tot, t1, d)
    np.add.at(tot, t2, d)
    np.add.at(cnt, t1, 1)
    np.add.at(cnt, t2, 1)
    return np.where(cnt > 0, tot / np.maximum(cnt, 1), 0.0)


def find_image(mat, socket):
    node = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if node is None:
        return None
    s = node.inputs.get(socket)
    if s is None or not s.is_linked:
        return None
    n = s.links[0].from_node
    for _ in range(4):
        if n.type == "TEX_IMAGE":
            return n
        ins = [i for i in n.inputs if i.is_linked]
        if not ins:
            return None
        n = ins[0].links[0].from_node
    return None


_cache = {}


def image_array(img):
    if img.name not in _cache:
        w, h = img.size
        px = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(px)
        _cache[img.name] = px.reshape(h, w, 4)
    return _cache[img.name]


def sample(arr, uv):
    h, w = arr.shape[:2]
    x = np.clip((uv[:, 0] % 1.0) * w, 0, w - 1).astype(np.int64)
    y = np.clip((uv[:, 1] % 1.0) * h, 0, h - 1).astype(np.int64)
    return arr[y, x]


def triangle_texture(obj, A):
    """Per-triangle albedo (sRGB), metallic (B), roughness (G) sampled at the UV centroid
    and at the three corners pulled 1/3 towards it (median of four, robust to seams)."""
    mat = obj.material_slots[0].material
    uv = A["uv"][A["tl"]]  # (nt,3,2)
    cen = uv.mean(1)
    pts = [cen] + [uv[:, i] * 0.5 + cen * 0.5 for i in range(3)]
    out = {}
    for socket, key in (("Base Color", "albedo"), ("Metallic", "mr")):
        n = find_image(mat, socket)
        if n is None or n.image is None:
            continue
        arr = image_array(n.image)
        out[key] = np.median(np.stack([sample(arr, p) for p in pts]), axis=0)
        out[key + "_image"] = n.image
    return out


def hsv(rgb):
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    mx = np.max(rgb[:, :3], 1)
    mn = np.min(rgb[:, :3], 1)
    d = mx - mn
    h = np.zeros(len(rgb))
    nz = d > 1e-6
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = ((g[rm] - b[rm]) / d[rm]) % 6
    h[gm] = (b[gm] - r[gm]) / d[gm] + 2
    h[bm] = (r[bm] - g[bm]) / d[bm] + 4
    h = h * 60.0
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


FACE_BOX = dict(x=0.062, y=-0.055, z0=1.50, z1=1.665)


def in_face(c):
    return (np.abs(c[:, 0]) < FACE_BOX["x"]) & (c[:, 1] < FACE_BOX["y"]) & (c[:, 2] > FACE_BOX["z0"]) & (c[:, 2] < FACE_BOX["z1"])


def classify(obj, A, tex, dihedral=None):
    """Material class per triangle. Returns an array of class names.

    Classes and the measured evidence behind each rule:
      metal      metallic ≥ 0.5 in the asset's own metallicRoughness map
      skin       hue 4–42°, saturation 0.18–0.80, value ≥ 0.22, not metal
      lips       skin-like red/berry hue (≥ 340° or ≤ 12°) inside the mouth band of the face
      flower     pink/rose hue (300–360°, 0–10°), sat ≥ 0.22, value ≥ 0.30, outside the face
      hair       value < 0.20 on the head objects; on char1, value < 0.17 above 1.12 m with a
                 crumpled surface (mean dihedral ≥ 28°) — the hair Meshy fused into the body
      fabric     everything else on char1 (camo, straps, boots)
    """
    nt = len(A["tv"])
    cen = A["wco"][A["tv"]].mean(1)
    alb = tex.get("albedo")
    mr = tex.get("mr")
    cls = np.array(["other"] * nt, dtype=object)
    if alb is None:
        return cls
    h, s, v = hsv(alb[:, :3])
    metal = mr[:, 2] >= 0.5 if mr is not None else np.zeros(nt, bool)
    skin = (h >= 4) & (h <= 42) & (s >= 0.18) & (s <= 0.80) & (v >= 0.22) & ~metal
    pink = ((h >= 300) | (h <= 10)) & (s >= 0.22) & (v >= 0.30) & ~metal
    face = in_face(cen)
    mouth_band = face & (np.abs(cen[:, 0]) < 0.03) & (cen[:, 2] > 1.53) & (cen[:, 2] < 1.565)
    name = obj.name
    if name in ("lelu_hair", "lelu_scalp"):
        hair = (v < 0.20) & ~metal
        cls[:] = "skin" if name == "lelu_scalp" else "hair"
        cls[hair] = "hair"
        cls[skin & (name == "lelu_scalp")] = "skin"
        cls[pink & ~face] = "flower"
        cls[pink & mouth_band] = "lips"
        cls[metal] = "metal"
        if name == "lelu_scalp":
            other = ~(hair | skin | pink | metal)
            cls[other & face] = "skin"
            cls[other & ~face] = "skin"
    elif name == "char1":
        cls[:] = "fabric"
        cls[skin] = "skin"
        if dihedral is not None:
            cape = (v < 0.17) & (cen[:, 2] > 1.12) & (dihedral >= 28) & ~metal
            cls[cape] = "hair"
        cls[metal] = "metal"
    return cls
