"""
==========================================================
`torchmcubes` CPU shim for TripoSR

TripoSR imports `from torchmcubes import marching_cubes` and calls
`marching_cubes(volume, isovalue)`, expecting:
  * vertices in continuous ARRAY-INDEX space (0 … resolution-1),
  * faces as an int64 tensor,
  * outward-facing winding.

The upstream package is a CUDA extension and cannot be built without
nvcc, which this machine does not have. scikit-image implements the same
algorithm on the CPU, so this module exposes the same two-value signature
on top of it. Triangle winding is checked against the mesh's signed
volume and reversed if it came out inside-out — TripoSR flips axes
afterwards, so an inward-facing mesh would voxelise one cell off and
render as a hollow shell.

Install by putting this file on PYTHONPATH as `torchmcubes.py`; nothing
in TripoSR changes.
"""
from __future__ import annotations

import numpy as np
import torch
from skimage import measure


def marching_cubes(volume: torch.Tensor, isovalue: float = 0.0):
    array = volume.detach().cpu().numpy()
    if array.ndim != 3:
        raise ValueError(f"marching_cubes expects a 3D volume, got shape {array.shape}")

    vertices, faces, _normals, _values = measure.marching_cubes(array, level=float(isovalue))
    vertices = vertices.astype(np.float32)
    faces = faces.astype(np.int64)

    # Axis convention: PyMCubes (which torchmcubes wraps) returns vertices in
    # (axis2, axis1, axis0) order, and TripoSR's MarchingCubeHelper swaps
    # [2,1,0] to undo that. scikit-image returns (axis0, axis1, axis2), so a
    # shim that passes its output through unswapped gets transposed a second
    # time by the caller: the mesh comes out with its axes permuted, which
    # reads as a melted blob rather than a figure.
    vertices = vertices[:, [2, 1, 0]]

    # Signed volume via the divergence theorem; negative means inward normals.
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]
    signed = float(np.einsum("ij,ij->i", v0, np.cross(v1, v2)).sum() / 6.0)
    if signed < 0:
        faces = faces[:, ::-1].copy()

    return torch.from_numpy(vertices), torch.from_numpy(faces)
