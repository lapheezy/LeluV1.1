"""
LÉLU — PROCEDURAL RENDER (PCI-FR 1.0, WP03/WP04)

A small, dependency-free software renderer (numpy) plus the procedural
primitives LÉLU's feature replication needs: tubes along measured curves
(hair strands, baby hairs, piping, chains), spheres (beads, cabochons), tori
(hoops, twisted frames) and bipyramids (kite drops). Orthographic camera with
a z-buffer, per-vertex colour or an image texture, Lambert shading.

Everything here is geometry, not pixels: a feature is rebuilt as a surface that
can be moved, re-posed and re-rendered. `export_glb` writes the same meshes as
a GLB for the app's three.js viewer.

World units are face widths, so a constraint measured on a reference in pixels
can be fed to the solver directly: metres = pixels / face_width_px.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field

import numpy as np


# ------------------------------------------------------------------- meshes --

@dataclass
class Mesh:
    verts: np.ndarray          # (N, 3) float64, +z towards the camera
    faces: np.ndarray          # (M, 3) int32, counter-clockwise from the front
    colors: np.ndarray | None = None   # (N, 3) float 0..1
    uv: np.ndarray | None = None       # (N, 2) texture pixel coords
    tex: np.ndarray | None = None      # (H, W, 3) float 0..1
    shades: bool = True                # apply Lambert shading
    name: str = "mesh"
    meta: dict = field(default_factory=dict)
    #: Triangulations built from image coordinates wind the other way once y is
    #: flipped to world space; two-sided surfaces are shaded from the side that
    #: faces the camera instead of vanishing.
    double_sided: bool = True

    def transformed(self, matrix: np.ndarray) -> "Mesh":
        v = np.c_[self.verts, np.ones(len(self.verts))] @ matrix.T
        return Mesh(v[:, :3], self.faces, self.colors, self.uv, self.tex, self.shades, self.name, self.meta, self.double_sided)


def merge(meshes: list[Mesh]) -> Mesh:
    verts, faces, colors, uvs = [], [], [], []
    base = 0
    for m in meshes:
        verts.append(m.verts)
        faces.append(m.faces + base)
        base += len(m.verts)
        colors.append(m.colors if m.colors is not None else np.full((len(m.verts), 3), 0.8))
        if m.uv is not None:
            uvs.append(m.uv)
    return Mesh(np.vstack(verts), np.vstack(faces), np.vstack(colors), np.vstack(uvs) if len(uvs) == len(meshes) else None, meshes[0].tex if meshes else None, True, "merged")


def translation(x: float, y: float, z: float = 0.0) -> np.ndarray:
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def rotation_y(deg: float) -> np.ndarray:
    a = np.radians(deg)
    m = np.eye(4)
    m[0, 0], m[0, 2], m[2, 0], m[2, 2] = np.cos(a), np.sin(a), -np.sin(a), np.cos(a)
    return m


def rotation_x(deg: float) -> np.ndarray:
    a = np.radians(deg)
    m = np.eye(4)
    m[1, 1], m[1, 2], m[2, 1], m[2, 2] = np.cos(a), -np.sin(a), np.sin(a), np.cos(a)
    return m


def rotation_z(deg: float) -> np.ndarray:
    a = np.radians(deg)
    m = np.eye(4)
    m[0, 0], m[0, 1], m[1, 0], m[1, 1] = np.cos(a), -np.sin(a), np.sin(a), np.cos(a)
    return m


# --------------------------------------------------------------- primitives --

def tube(points: np.ndarray, radius, sides: int = 6, colors=None, name: str = "tube", taper: bool = True) -> Mesh:
    """
    A tube swept along a polyline — a hair strand, a baby hair, a chain, piping.
    `radius` is a scalar or one value per point. Frames use a reference up
    vector that flips only when the tangent comes close to it, so strands do
    not twist.
    """
    pts = np.asarray(points, dtype=np.float64)
    n = len(pts)
    if n < 2:
        return Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32), name=name)
    radii = np.broadcast_to(np.asarray(radius, dtype=np.float64), (n,))
    tangents = np.gradient(pts, axis=0)
    tangents /= np.maximum(np.linalg.norm(tangents, axis=1, keepdims=True), 1e-9)
    ref = np.array([0.0, 0.0, 1.0])
    verts = np.zeros((n * sides, 3))
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    for i in range(n):
        t = tangents[i]
        up = ref if abs(np.dot(t, ref)) < 0.95 else np.array([0.0, 1.0, 0.0])
        a = np.cross(t, up)
        a /= max(np.linalg.norm(a), 1e-9)
        b = np.cross(t, a)
        ring = np.cos(ang)[:, None] * a + np.sin(ang)[:, None] * b
        verts[i * sides : (i + 1) * sides] = pts[i] + ring * radii[i]
    faces = []
    for i in range(n - 1):
        for j in range(sides):
            a0 = i * sides + j
            a1 = i * sides + (j + 1) % sides
            b0 = a0 + sides
            b1 = a1 + sides
            faces.append((a0, a1, b1))
            faces.append((a0, b1, b0))
    if taper:
        # Close the tip with a fan to a point, so a strand ends in hair, not a hole.
        tip = len(verts)
        verts = np.vstack([verts, pts[-1] + tangents[-1] * radii[-1] * 1.4])
        for j in range(sides):
            faces.append(((n - 1) * sides + j, (n - 1) * sides + (j + 1) % sides, tip))
    col = np.asarray(colors, dtype=np.float64) if colors is not None else np.full((len(verts), 3), 0.15)
    if len(col) != len(verts):
        if len(col) < len(verts):
            col = np.vstack([col, np.repeat(col[-1:], len(verts) - len(col), axis=0)])
        else:
            col = col[: len(verts)]
    return Mesh(verts, np.array(faces, np.int32), col, name=name)


def sphere(center, radius: float, lat: int = 10, lon: int = 14, color=(0.8, 0.55, 0.45), name: str = "sphere") -> Mesh:
    """UV sphere — beads, cabochons, pearls."""
    verts = [np.array(center, dtype=np.float64) + np.array([0, 0, radius])]
    for i in range(1, lat):
        phi = np.pi * i / lat
        for j in range(lon):
            th = 2 * np.pi * j / lon
            verts.append(np.array(center) + radius * np.array([np.sin(phi) * np.cos(th), np.sin(phi) * np.sin(th), np.cos(phi)]))
    verts.append(np.array(center, dtype=np.float64) - np.array([0, 0, radius]))
    verts = np.array(verts)
    faces = []
    for j in range(lon):
        faces.append((0, 1 + j, 1 + (j + 1) % lon))
    for i in range(lat - 2):
        for j in range(lon):
            a = 1 + i * lon + j
            b = 1 + i * lon + (j + 1) % lon
            c = b + lon
            d = a + lon
            faces.append((a, b, c))
            faces.append((a, c, d))
    last = len(verts) - 1
    base = 1 + (lat - 2) * lon
    for j in range(lon):
        faces.append((last, base + (j + 1) % lon, base + j))
    return Mesh(verts, np.array(faces, np.int32), np.tile(np.array(color, dtype=np.float64), (len(verts), 1)), name=name)


def torus(center, R: float, r: float, major: int = 16, minor: int = 8, color=(0.85, 0.55, 0.42), name: str = "torus", squash: float = 1.0) -> Mesh:
    """Torus — hoop earrings, the pendant's twisted frame, chain links."""
    verts = []
    for i in range(major):
        a = 2 * np.pi * i / major
        for j in range(minor):
            b = 2 * np.pi * j / minor
            x = (R + r * np.cos(b)) * np.cos(a)
            y = (R + r * np.cos(b)) * np.sin(a) * squash
            z = r * np.sin(b)
            verts.append(np.array(center) + np.array([x, y, z]))
    verts = np.array(verts)
    faces = []
    for i in range(major):
        for j in range(minor):
            a = i * minor + j
            b = i * minor + (j + 1) % minor
            c = ((i + 1) % major) * minor + (j + 1) % minor
            d = ((i + 1) % major) * minor + j
            faces.append((a, b, c))
            faces.append((a, c, d))
    return Mesh(verts, np.array(faces, np.int32), np.tile(np.array(color, dtype=np.float64), (len(verts), 1)), name=name)


def bipyramid(center, half_width: float, half_height: float, depth: float, color=(0.95, 0.75, 0.78), name: str = "kite") -> Mesh:
    """Faceted kite drop — the pendant gems and the spike drops on the chains."""
    c = np.array(center, dtype=np.float64)
    ring = np.array([[half_width, 0, 0], [0, 0, depth], [-half_width, 0, 0], [0, 0, -depth]], dtype=np.float64) * np.array([1, 1, 1])
    verts = np.vstack([c + np.array([0, half_height, 0]), c + ring, c - np.array([0, half_height, 0])])
    faces = [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 1), (5, 2, 1), (5, 3, 2), (5, 4, 3), (5, 1, 4)]
    return Mesh(verts, np.array(faces, np.int32), np.tile(np.array(color, dtype=np.float64), (8, 1)), name=name)


def band(points_xy: np.ndarray, width: float, z: float = 0.0, color=(0.2, 0.16, 0.14), name: str = "band") -> Mesh:
    """A flat ribbon along a 2-D polyline — straps, seams, hems."""
    pts = np.asarray(points_xy, dtype=np.float64)
    n = len(pts)
    tangents = np.gradient(pts, axis=0)
    tangents /= np.maximum(np.linalg.norm(tangents, axis=1, keepdims=True), 1e-9)
    normals = np.c_[-tangents[:, 1], tangents[:, 0]]
    left = np.c_[pts + normals * width / 2, np.full(n, z)]
    right = np.c_[pts - normals * width / 2, np.full(n, z)]
    verts = np.vstack([left, right])
    faces = []
    for i in range(n - 1):
        faces.append((i, i + 1, n + i + 1))
        faces.append((i, n + i + 1, n + i))
    return Mesh(verts, np.array(faces, np.int32), np.tile(np.array(color, dtype=np.float64), (len(verts), 1)), name=name)


# ------------------------------------------------------------------ renderer --

def project(verts: np.ndarray, W: int, H: int, scale: float, center: tuple[float, float]) -> np.ndarray:
    """World (face widths) → canvas pixels. +y is up, +z towards the camera."""
    out = np.empty((len(verts), 2))
    out[:, 0] = W / 2 + (verts[:, 0] - center[0]) * scale
    out[:, 1] = H / 2 - (verts[:, 1] - center[1]) * scale
    return out


def camera_from_landmarks(landmarks_px: np.ndarray, W: int, H: int, frame: dict) -> tuple[float, tuple[float, float]]:
    """The reference's own camera: the face keeps the pixel size it has in the photo."""
    fw = float(np.linalg.norm(landmarks_px[234] - landmarks_px[454]))
    scale = fw / frame["face_width"]
    center = (
        float((landmarks_px[234, 0] + landmarks_px[454, 0]) / 2),
        H / 2 - (float((landmarks_px[10, 1] + landmarks_px[152, 1]) / 2) - H / 2),
    )
    return scale, center


def render(meshes: list[Mesh], W: int, H: int, scale: float, center=(0.0, 0.0), background=(0.11, 0.11, 0.12), light=(-0.35, 0.5, 0.8), ambient: float = 0.72, return_depth: bool = False):
    """
    Orthographic z-buffered rasteriser. Later meshes win where their depth is
    nearer the camera. Shading is Lambert plus a high ambient term: a front
    view of a textured face then keeps the reference's own colours.
    """
    img = np.zeros((H, W, 3), dtype=np.float64)
    img[:] = np.array(background, dtype=np.float64)
    zbuf = np.full((H, W), -1e9)
    L = np.array(light, dtype=np.float64)
    L /= np.linalg.norm(L)
    for mesh in meshes:
        if len(mesh.faces) == 0:
            continue
        p = project(mesh.verts, W, H, scale, center)
        v = mesh.verts
        v0, v1, v2 = v[mesh.faces[:, 0]], v[mesh.faces[:, 1]], v[mesh.faces[:, 2]]
        normals = np.cross(v1 - v0, v2 - v0)
        ln = np.linalg.norm(normals, axis=1)
        good = ln > 1e-12
        normals[good] /= ln[good, None]
        facing = normals[:, 2] > 0
        front = facing | mesh.double_sided
        base_colors = mesh.colors if mesh.colors is not None else np.full((len(v), 3), 0.8)
        oriented = np.where(facing[:, None], normals, -normals)
        shade = ambient + (1 - ambient) * np.clip(oriented @ L, 0, 1) if mesh.shades else np.ones(len(mesh.faces))
        for f in np.nonzero(good & front)[0]:
            ia, ib, ic = mesh.faces[f]
            tri = p[[ia, ib, ic]]
            zs = v[[ia, ib, ic], 2]
            x0, y0 = np.floor(tri.min(0)).astype(int)
            x1, y1 = np.ceil(tri.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, W - 1), min(y1, H - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs = np.arange(x0, x1 + 1) + 0.5
            ys = np.arange(y0, y1 + 1) + 0.5
            gx, gy = np.meshgrid(xs, ys)
            ax, ay = tri[0]
            bx, by = tri[1]
            cx, cy = tri[2]
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-12:
                continue
            l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
            l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
            l3 = 1 - l1 - l2
            mask = (l1 >= -0.0005) & (l2 >= -0.0005) & (l3 >= -0.0005)
            if not mask.any():
                continue
            z = l1[mask] * zs[0] + l2[mask] * zs[1] + l3[mask] * zs[2]
            yy, xx = gy[mask].astype(int), gx[mask].astype(int)
            closer = z > zbuf[yy, xx]
            if not closer.any():
                continue
            yy, xx, z = yy[closer], xx[closer], z[closer]
            if mesh.tex is not None and mesh.uv is not None:
                th, tw = mesh.tex.shape[:2]
                u = (l1[mask][closer] * mesh.uv[ia, 0] + l2[mask][closer] * mesh.uv[ib, 0] + l3[mask][closer] * mesh.uv[ic, 0]) / tw
                vv = (l1[mask][closer] * mesh.uv[ia, 1] + l2[mask][closer] * mesh.uv[ib, 1] + l3[mask][closer] * mesh.uv[ic, 1]) / th
                px = np.clip((u * tw).astype(int), 0, tw - 1)
                py = np.clip((vv * th).astype(int), 0, th - 1)
                col = mesh.tex[py, px]
            else:
                col = (l1[mask][closer, None] * base_colors[ia] + l2[mask][closer, None] * base_colors[ib] + l3[mask][closer, None] * base_colors[ic])
            img[yy, xx] = np.clip(col * shade[f], 0, 1)
            zbuf[yy, xx] = z
    out = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    return (out, zbuf) if return_depth else out


# ------------------------------------------------------------------- export --

def export_glb(meshes: list[Mesh], path: str, name: str = "lelu_features") -> str:
    """
    Write the procedural meshes as a GLB with per-vertex colour — directly
    loadable by the app's three.js GLTFLoader. Face texture is omitted by
    design: the colour layer is what the replication engine produces.
    """
    verts, faces, colors = [], [], []
    base = 0
    for m in meshes:
        if len(m.faces) == 0:
            continue
        verts.append(m.verts.astype(np.float32))
        faces.append(m.faces.astype(np.uint32) + base)
        base += len(m.verts)
        c = m.colors if m.colors is not None else np.full((len(m.verts), 3), 0.8)
        colors.append(np.clip(c, 0, 1).astype(np.float32))
    V = np.vstack(verts)
    F = np.vstack(faces)
    C = np.vstack(colors)
    # glTF is +Y up, three.js reads it that way; our world is +Z up (portrait).
    V = V[:, [0, 2, 1]]
    pos = V.astype(np.float32).tobytes()
    nrm = np.zeros_like(V, dtype=np.float32)
    col = C.astype(np.float32).tobytes()
    idx = F.astype(np.uint32).tobytes()
    # Vertex normals from area-weighted face normals.
    v0, v1, v2 = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(v1 - v0, v2 - v0)
    for k in range(3):
        np.add.at(nrm, F[:, k], n)
    ln = np.linalg.norm(nrm, axis=1, keepdims=True)
    nrm = np.divide(nrm, np.maximum(ln, 1e-9)).astype(np.float32)

    blob = b""
    views = []
    for data, target in ((pos, 34962), (nrm.tobytes(), 34962), (col, 34962), (idx, 34963)):
        pad = (-len(blob)) % 4
        blob += b"\x00" * pad
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target})
        blob += data
    pad = (-len(blob)) % 4
    blob += b"\x00" * pad
    gltf = {
        "asset": {"version": "2.0", "generator": "lelu-perception/replication"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [{
            "attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2},
            "indices": 3, "material": 0, "mode": 4,
        }]}],
        "materials": [{"name": "lelu_feature", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.15, "roughnessFactor": 0.8}, "doubleSided": True}],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(V), "type": "VEC3", "min": V.min(0).tolist(), "max": V.max(0).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(V), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": len(V), "type": "VEC3"},
            {"bufferView": 3, "componentType": 5125, "count": int(F.size), "type": "SCALAR"},
        ],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A))
        fh.write(js)
        fh.write(struct.pack("<II", len(blob), 0x004E4942))
        fh.write(blob)
    return path
