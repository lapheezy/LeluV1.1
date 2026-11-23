"""Minimal glTF 2.0 / GLB writer.

Why this exists: trimesh 4.0.5 calls ``ndarray.ptp()`` while exporting, and
numpy 2 removed that method from an immutable type we cannot monkeypatch.
Writing the container ourselves needs nothing beyond struct and json, keeps
the export deterministic, and produces a file any glTF viewer can open.

Only what a single static mesh needs is emitted: POSITION, NORMAL, indices.
"""

from __future__ import annotations

import json
import struct
from typing import Any

import numpy as np

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

FLOAT = 5126
UNSIGNED_SHORT = 5123
UNSIGNED_INT = 5125
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963


def vertex_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Area-weighted vertex normals, normalised; degenerate faces contribute nothing."""
    normals = np.zeros_like(vertices, dtype=np.float64)
    if faces.size:
        tri = vertices[faces]
        face_normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        for corner in range(3):
            np.add.at(normals, faces[:, corner], face_normals)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    length[length == 0.0] = 1.0
    return normals / length


def _pad(blob: bytes, fill: bytes) -> bytes:
    return blob + fill * ((4 - len(blob) % 4) % 4)


def z_up_to_y_up(vertices: np.ndarray) -> np.ndarray:
    """Rotate z-up geometry (OBJ, TripoSR, Blender) into glTF's y-up frame.

    glTF is y-up. Writing z-up vertices straight out leaves the model lying
    on its back in every viewer: a standing figure then renders end-on and
    reads as a lumpy mass rather than a body.
    """
    return np.stack([vertices[:, 0], vertices[:, 2], -vertices[:, 1]], axis=1)


def build_glb(vertices: np.ndarray, faces: np.ndarray, source_up: str = "z") -> bytes:
    if source_up == "z":
        vertices = z_up_to_y_up(np.asarray(vertices, dtype=np.float64))
    vertices = np.ascontiguousarray(vertices, dtype="<f4")
    faces = np.ascontiguousarray(faces, dtype=np.int64)
    normals = np.ascontiguousarray(vertex_normals(vertices.astype(np.float64), faces), dtype="<f4")

    use_short = vertices.shape[0] <= 0xFFFF
    indices = np.ascontiguousarray(faces.reshape(-1), dtype="<u2" if use_short else "<u4")

    position_bytes = vertices.tobytes()
    normal_bytes = normals.tobytes()
    index_bytes = indices.tobytes()

    bin_parts: list[bytes] = []
    views: list[dict[str, Any]] = []
    offset = 0
    for payload, target in (
        (position_bytes, ARRAY_BUFFER),
        (normal_bytes, ARRAY_BUFFER),
        (index_bytes, ELEMENT_ARRAY_BUFFER),
    ):
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(payload), "target": target})
        bin_parts.append(payload)
        offset += len(payload)
        pad = (4 - offset % 4) % 4
        if pad:
            bin_parts.append(b"\x00" * pad)
            offset += pad
    binary = b"".join(bin_parts)

    accessors = [
        {
            "bufferView": 0,
            "componentType": FLOAT,
            "count": int(vertices.shape[0]),
            "type": "VEC3",
            "min": [float(v) for v in vertices.min(axis=0)],
            "max": [float(v) for v in vertices.max(axis=0)],
        },
        {"bufferView": 1, "componentType": FLOAT, "count": int(normals.shape[0]), "type": "VEC3"},
        {
            "bufferView": 2,
            "componentType": UNSIGNED_SHORT if use_short else UNSIGNED_INT,
            "count": int(indices.shape[0]),
            "type": "SCALAR",
        },
    ]

    document = {
        "asset": {"version": "2.0", "generator": "lelu-nre-glb-writer"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "nre-reconstruction"}],
        "meshes": [
            {
                "name": "nre-reconstruction",
                "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "mode": 4}],
            }
        ],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": accessors,
    }

    json_bytes = _pad(json.dumps(document, separators=(",", ":")).encode("utf-8"), b" ")
    bin_bytes = _pad(binary, b"\x00")
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)

    out = bytearray()
    out += struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(json_bytes), CHUNK_JSON) + json_bytes
    out += struct.pack("<II", len(bin_bytes), CHUNK_BIN) + bin_bytes
    return bytes(out)


def write_glb(path: str, vertices: np.ndarray, faces: np.ndarray, source_up: str = "z") -> dict[str, Any]:
    blob = build_glb(vertices, faces, source_up)
    with open(path, "wb") as handle:
        handle.write(blob)
    return {
        "path": path,
        "bytes": len(blob),
        "vertices": int(np.asarray(vertices).shape[0]),
        "triangles": int(np.asarray(faces).shape[0]),
    }
