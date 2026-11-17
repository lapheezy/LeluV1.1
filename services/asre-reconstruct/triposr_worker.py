"""
LÉLU ASRE — offline TripoSR CPU worker.

    python -I triposr_worker.py '<json job>'

Job:
    image           input image path
    out_dir         where results go
    mc_resolution   marching-cubes grid (default 256, upstream default)
    threshold       density iso-level (default 25.0, upstream default)
    foreground_ratio  (default 0.85, upstream default)
    voxel_size      NRE lattice cell, metres in TripoSR units (default 0.00625)
    upstream_check  also extract with upstream torchmcubes on the SAME scene codes

No paid API, no account, no key: code VAST-AI-Research/TripoSR (MIT, pinned
commit, LELU_TRIPOSR_SRC) and weights stabilityai/TripoSR (MIT) from the
local Hugging Face cache (HF_HUB_OFFLINE=1).

Defects the previous (lost) session documented, each handled explicitly here:
  RGBA/RGB      any mode is normalised; alpha is used when it carries a mask,
                otherwise rembg removes the background (local u2net)
  crop          foreground is cropped and padded exactly as upstream
                resize_foreground(ratio) does, before conditioning
  background    RGBA is composited on 0.5 grey (upstream run.py convention)
                in float, never by dropping the alpha channel
  numpy 2       no np.bool/np.float aliases; arrays converted explicitly
  MC axes       scikit-image marching_cubes on a volume indexed [x, y, z]
                returns (x, y, z) vertices — upstream's [2, 1, 0] swap belongs
                to torchmcubes' (z, y, x) output and must NOT be copied
  Z-up → Y-up   TripoSR space is Z-up; vertices are written Z-up and the GLB
                writer applies the proper rotation (x, z, −y)

Outputs (npy little-endian): mesh_vertices.npy (float32 N×3, Z-up),
mesh_faces.npy (int32 M×3, outward CCW), mesh_colors.npy (float32 N×3),
cells.npy (int32 K×3 lattice indices), cell_density.npy (float32 K),
cell_front_visible.npy (uint8 K), preprocessed.png, silhouette.npy and
result.json. The last stdout line is the JSON result.
"""
import json
import os
import sys
import time

job = json.loads(sys.argv[1])
SRC = os.environ.get("LELU_TRIPOSR_SRC", "/opt/lelu-tools/TripoSR")
sys.path.insert(0, SRC)

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402
from skimage.measure import marching_cubes  # noqa: E402

from tsr.system import TSR  # noqa: E402
from tsr.utils import resize_foreground, scale_tensor  # noqa: E402

torch.set_num_threads(int(job.get("threads", os.cpu_count() or 4)))
out = job["out_dir"]
os.makedirs(out, exist_ok=True)
timings = {}
log = lambda *a: print(*a, file=sys.stderr, flush=True)  # noqa: E731


def model_dir():
    from huggingface_hub import snapshot_download

    # Pinned: the revision setup.sh installs. Offline (HF_HUB_OFFLINE=1) a bare
    # "main" only resolves if a refs/main entry happens to exist in the cache.
    return snapshot_download("stabilityai/TripoSR", revision="5b521936b01fbe1890f6f9baed0254ab6351c04a", allow_patterns=["config.yaml", "model.ckpt"])


# ------------------------------------------------------------------ preprocess
t = time.time()
img = Image.open(job["image"])
mode_in = img.mode
if img.mode in ("P", "LA", "L", "I;16", "CMYK"):
    img = img.convert("RGBA")
used_rembg = False
if img.mode == "RGBA" and img.getextrema()[3][0] < 255:
    rgba = img
else:
    import rembg

    rgba = rembg.remove(img.convert("RGB"), session=rembg.new_session())
    used_rembg = True
rgba = resize_foreground(rgba, float(job.get("foreground_ratio", 0.85)))
a = np.asarray(rgba).astype(np.float32) / 255.0
rgb = a[:, :, :3] * a[:, :, 3:4] + (1.0 - a[:, :, 3:4]) * 0.5
cond = Image.fromarray((rgb * 255.0 + 0.5).clip(0, 255).astype(np.uint8))
cond.save(os.path.join(out, "preprocessed.png"))
silhouette = (np.asarray(rgba.resize((512, 512), Image.BILINEAR))[:, :, 3] > 127).astype(np.uint8)
np.save(os.path.join(out, "silhouette.npy"), np.ascontiguousarray(silhouette))
timings["preprocess_s"] = time.time() - t

# ------------------------------------------------------------------ inference
t = time.time()
mdir = model_dir()
model = TSR.from_pretrained(mdir, config_name="config.yaml", weight_name="model.ckpt")
model.renderer.set_chunk_size(int(job.get("chunk_size", 8192)))
model.to("cpu")
timings["load_s"] = time.time() - t
t = time.time()
with torch.no_grad():
    scene_codes = model([cond], device="cpu")
timings["inference_s"] = time.time() - t
radius = float(model.renderer.cfg.radius)
threshold = float(job.get("threshold", 25.0))


def query_density(points):
    with torch.no_grad():
        return model.renderer.query_triplane(model.decoder, points, scene_codes[0])["density_act"].reshape(-1)


# ------------------------------------------------------------------ mesh (skimage)
t = time.time()
R = int(job.get("mc_resolution", 256))
lin = torch.linspace(0, 1, R)
gx, gy, gz = torch.meshgrid(lin, lin, lin, indexing="ij")
grid01 = torch.stack([gx, gy, gz], -1).reshape(-1, 3)
density = query_density(scale_tensor(grid01, (0, 1), (-radius, radius))).reshape(R, R, R).numpy()
verts, faces, _normals, _ = marching_cubes(density, level=threshold, gradient_direction="descent")
verts = (verts / (R - 1.0)) * (2 * radius) - radius  # (x, y, z) index order: no swap
verts = verts.astype(np.float32)
faces = faces.astype(np.int32)
# outward winding check: signed volume must be positive
v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
signed_volume = float(np.einsum("ij,ij->i", v0, np.cross(v1, v2)).sum() / 6.0)
if signed_volume < 0:
    faces = faces[:, [0, 2, 1]]
    signed_volume = -signed_volume
with torch.no_grad():
    colors = model.renderer.query_triplane(model.decoder, torch.from_numpy(verts), scene_codes[0])["color"].numpy().astype(np.float32)
timings["mesh_s"] = time.time() - t
np.save(os.path.join(out, "mesh_vertices.npy"), np.ascontiguousarray(verts))
np.save(os.path.join(out, "mesh_faces.npy"), np.ascontiguousarray(faces))
np.save(os.path.join(out, "mesh_colors.npy"), np.ascontiguousarray(colors.clip(0, 1)))

# ------------------------------------------------------------------ NRE lattice
t = time.time()
vs = float(job.get("voxel_size", 0.00625))
lo = np.floor(verts.min(0) / vs) - 2
hi = np.ceil(verts.max(0) / vs) + 2
dims = (hi - lo).astype(int)
ii = [np.arange(d) for d in dims]
cx, cy, cz = np.meshgrid(*ii, indexing="ij")
centers = (np.stack([cx, cy, cz], -1).reshape(-1, 3) + lo + 0.5) * vs
dens = np.concatenate([query_density(torch.from_numpy(c.astype(np.float32))).numpy() for c in np.array_split(centers, max(1, len(centers) // 400_000))])
occ = dens > threshold
cells = np.stack([cx, cy, cz], -1).reshape(-1, 3)[occ].astype(np.int32)
cell_density = dens[occ].astype(np.float32)
timings["lattice_s"] = time.time() - t

# ------------------------------------------------------------------ what the image saw
# TripoSR's conditioning camera: azimuth 0, elevation 0, distance 1.9, fovy 40°,
# i.e. at +X looking −X, up +Z, image right = +Y. Verified below by silhouette IoU.
cam_d, fov = 1.9, np.deg2rad(40.0)
world = (cells + lo + 0.5) * vs
depth = cam_d - world[:, 0]
f = 256.0 / np.tan(fov / 2)
col = np.round(256.0 + f * world[:, 1] / depth).astype(int)
row = np.round(256.0 - f * world[:, 2] / depth).astype(int)
inside = (col >= 0) & (col < 512) & (row >= 0) & (row < 512)
zbuf = np.full((512, 512), np.inf)
splat = max(1, int(np.ceil(f * vs / depth.min() / 2)))
order = np.argsort(-depth)  # far first, near overwrite
for k in order[inside[order]]:
    r0, c0 = row[k], col[k]
    zbuf[max(0, r0 - splat):r0 + splat + 1, max(0, c0 - splat):c0 + splat + 1] = np.minimum(zbuf[max(0, r0 - splat):r0 + splat + 1, max(0, c0 - splat):c0 + splat + 1], depth[k])
front = np.zeros(len(cells), np.uint8)
front[inside] = (depth[inside] <= zbuf[row[inside], col[inside]] + vs * 1.5) & (silhouette[row[inside], col[inside]] > 0)
proj = np.isfinite(zbuf)
sil = silhouette > 0
silhouette_iou = float((proj & sil).sum() / max(1, (proj | sil).sum()))
np.save(os.path.join(out, "cells.npy"), np.ascontiguousarray(cells))
np.save(os.path.join(out, "cell_density.npy"), np.ascontiguousarray(cell_density))
np.save(os.path.join(out, "cell_front_visible.npy"), np.ascontiguousarray(front))

result = {
    "image": os.path.abspath(job["image"]),
    "input_mode": mode_in,
    "used_rembg": used_rembg,
    "model_dir": mdir,
    "triposr_src": SRC,
    "torch": torch.__version__,
    "numpy": np.__version__,
    "threads": torch.get_num_threads(),
    "timings": {k: round(v, 3) for k, v in timings.items()},
    "mc_resolution": R,
    "threshold": threshold,
    "radius": radius,
    "vertices": int(len(verts)),
    "triangles": int(len(faces)),
    "signed_volume": signed_volume,
    "bounds_zup": {"min": verts.min(0).tolist(), "max": verts.max(0).tolist()},
    "voxel_size": vs,
    "lattice_origin_cells": lo.astype(int).tolist(),
    "lattice_dims": dims.tolist(),
    "cells": int(len(cells)),
    "front_visible_cells": int(front.sum()),
    "camera_silhouette_iou": silhouette_iou,
}

# ------------------------------------------------------------------ upstream check
if job.get("upstream_check"):
    t = time.time()
    up = model.extract_mesh(scene_codes, has_vertex_color=False, resolution=R, threshold=threshold)[0]
    timings["upstream_mesh_s"] = time.time() - t
    uv = np.asarray(up.vertices, dtype=np.float32)
    uf = np.asarray(up.faces, dtype=np.int32)
    np.save(os.path.join(out, "upstream_vertices.npy"), np.ascontiguousarray(uv))
    np.save(os.path.join(out, "upstream_faces.npy"), np.ascontiguousarray(uf))
    result["upstream"] = {
        "vertices": int(len(uv)),
        "triangles": int(len(uf)),
        "bounds_zup": {"min": uv.min(0).tolist(), "max": uv.max(0).tolist()},
        "max_bounds_delta": float(np.abs(np.concatenate([uv.min(0) - verts.min(0), uv.max(0) - verts.max(0)])).max()),
        "mesh_s": round(timings["upstream_mesh_s"], 3),
    }

json.dump(result, open(os.path.join(out, "result.json"), "w"), indent=1)
print(json.dumps(result))
