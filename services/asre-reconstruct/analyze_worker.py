"""
LÉLU ASRE — WP1: one image, many analyses, competing hypotheses.

    python -I analyze_worker.py '{"image": ..., "triposr_dir": ..., "out_dir": ...}'

One input image starts a dependency graph of analytical operations that run
concurrently (thread pool; torch and numpy release the GIL for the heavy parts):

    rgb ─────────────────────────────┐
    segment ─▶ silhouette ─▶ landmarks ─▶ components ─▶ measure
    depth (Depth-Anything-V2-Small) ─▶ surface
                                      └─▶ hypotheses (need silhouette + depth)

Three geometry hypotheses on the SAME lattice and conditioning camera as the
TripoSR run (Z-up, camera at +X, d = 1.9, fovy 40°):

    H1 triposr      generative model (SYNTHESIZED) — read from triposr_dir
    H2 ellipse-hull silhouette × elliptical cross-section prior (INFERRED)
    H3 depth-lift   monocular depth front surface, mirrored back (INFERRED)

Each is scored against the image: silhouette IoU of its projection, depth
consistency (rank correlation of its front surface with the depth estimate),
volume, prior confidence and the compute it cost.
"""
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

job = json.loads(sys.argv[1])
sys.path.insert(0, os.environ.get("LELU_TRIPOSR_SRC", "/opt/lelu-tools/TripoSR"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402
from scipy import ndimage  # noqa: E402
from scipy.stats import spearmanr  # noqa: E402
from skimage.measure import marching_cubes  # noqa: E402

from tsr.utils import resize_foreground  # noqa: E402

out = job["out_dir"]
os.makedirs(out, exist_ok=True)
T0 = time.time()
timeline = []
lock = threading.Lock()
K_DEPTH = float(job.get("depth_to_width", 0.75))  # human cross-section depth/width prior


def op(name, fn, *deps):
    def run():
        args = [d.result() for d in deps]
        s = time.time()
        r = fn(*args)
        with lock:
            timeline.append({"op": name, "start_s": round(s - T0, 3), "end_s": round(time.time() - T0, 3), "thread": threading.current_thread().name})
        return r

    return pool.submit(run)


def load_rgba():
    img = Image.open(job["image"])
    if img.mode != "RGBA" or img.getextrema()[3][0] == 255:
        import rembg

        img = rembg.remove(img.convert("RGB"), session=rembg.new_session())
    rgba = resize_foreground(img, float(job.get("foreground_ratio", 0.85))).resize((512, 512), Image.BILINEAR)
    return np.asarray(rgba).astype(np.float32) / 255.0


def rgb_analysis(rgba):
    m = rgba[:, :, 3] > 0.5
    px = rgba[:, :, :3][m]
    rng = np.random.default_rng(0)
    centers = px[rng.choice(len(px), 6, replace=False)]
    for _ in range(15):
        lab = np.argmin(((px[:, None, :] - centers[None]) ** 2).sum(-1), 1)
        centers = np.stack([px[lab == k].mean(0) if (lab == k).any() else centers[k] for k in range(len(centers))])
    frac = np.bincount(lab, minlength=len(centers)) / len(px)
    order = np.argsort(-frac)
    lum = px @ np.array([0.2126, 0.7152, 0.0722])
    return {"palette": [{"rgb": [round(float(c), 3) for c in centers[k]], "fraction": round(float(frac[k]), 3)} for k in order], "mean_luminance": float(lum.mean()), "contrast": float(lum.std())}


def segment(rgba):
    return rgba[:, :, 3] > 0.5


def silhouette(mask):
    mask = ndimage.binary_fill_holes(ndimage.binary_opening(mask, iterations=1))
    rows, cols = np.where(mask)
    return {"mask": mask, "area_px": int(mask.sum()), "bbox": [int(rows.min()), int(cols.min()), int(rows.max()), int(cols.max())], "contour_px": int((mask ^ ndimage.binary_erosion(mask)).sum())}


def depth(rgba):
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    name = "depth-anything/Depth-Anything-V2-Small-hf"
    proc = AutoImageProcessor.from_pretrained(name)
    model = AutoModelForDepthEstimation.from_pretrained(name).eval()
    rgb = Image.fromarray(((rgba[:, :, :3] * rgba[:, :, 3:] + (1 - rgba[:, :, 3:]) * 0.5) * 255).astype(np.uint8))
    with torch.no_grad():
        pred = model(**proc(images=rgb, return_tensors="pt")).predicted_depth
    disp = torch.nn.functional.interpolate(pred[None], size=(512, 512), mode="bicubic", align_corners=False)[0, 0].numpy()
    return disp  # relative inverse depth: larger = nearer


def surface(disp, sil):
    m = sil["mask"]
    gy, gx = np.gradient(ndimage.gaussian_filter(disp, 2))
    n = np.dstack([-gx, -gy, np.full_like(gx, max(1e-6, float(np.percentile(np.abs(disp[m]), 50)) / 50))])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    lap = ndimage.laplace(ndimage.gaussian_filter(disp, 2))
    return {"mean_facing": float(n[:, :, 2][m].mean()), "frac_facing_camera_gt_0_7": float((n[:, :, 2][m] > 0.7).mean()), "curvature_abs_mean": float(np.abs(lap[m]).mean())}


def landmarks(sil):
    m = sil["mask"]
    rows = np.where(m.any(1))[0]
    top, bottom = int(rows.min()), int(rows.max())
    width = m.sum(1).astype(float)
    h = bottom - top
    lo, hi = top + int(0.25 * h), top + int(0.7 * h)
    neck = lo + int(np.argmin(width[lo:hi]))
    wn = width[neck]
    shoulder = next((r for r in range(neck, bottom) if width[r] > 1.6 * wn), bottom)
    head_rows = np.arange(top, neck)
    widest_head = int(head_rows[np.argmax(width[top:neck])])
    cols = np.where(m[widest_head])[0]
    return {
        "method": "silhouette width profile (no pose model)",
        "head_top_row": top,
        "head_widest_row": widest_head,
        "head_center_col": float(cols.mean()),
        "neck_row": int(neck),
        "shoulder_row": int(shoulder),
        "bottom_row": bottom,
        "neck_width_px": float(wn),
        "shoulder_width_px": float(width[min(shoulder + 5, bottom)]),
    }


def components(lm):
    return [
        {"component": "head", "rows": [lm["head_top_row"], lm["neck_row"]], "evidence": "above the silhouette's narrowest row"},
        {"component": "neck", "rows": [lm["neck_row"], lm["shoulder_row"]], "evidence": "narrowest band to shoulder widening (×1.6)"},
        {"component": "torso", "rows": [lm["shoulder_row"], lm["bottom_row"]], "evidence": "below shoulder widening"},
    ]


CAM_D, FOV = 1.9, np.deg2rad(40.0)
F = 256.0 / np.tan(FOV / 2)


def measure(lm, sil):
    px_to_m = CAM_D / F  # at the object centre plane x = 0
    return {
        "units": "TripoSR units at the x=0 plane (camera d=1.9, fovy 40)",
        "height": (lm["bottom_row"] - lm["head_top_row"]) * px_to_m,
        "head_height": (lm["neck_row"] - lm["head_top_row"]) * px_to_m,
        "neck_width": lm["neck_width_px"] * px_to_m,
        "shoulder_width": lm["shoulder_width_px"] * px_to_m,
        "head_to_height_ratio": (lm["neck_row"] - lm["head_top_row"]) / max(1, lm["bottom_row"] - lm["head_top_row"]),
        "silhouette_area": sil["area_px"] * px_to_m**2,
    }


# ------------------------------------------------------------------ hypotheses
tr = json.load(open(os.path.join(job["triposr_dir"], "result.json")))
VS = tr["voxel_size"]
LO = np.array(tr["lattice_origin_cells"])
DIMS = np.array(tr["lattice_dims"])
gi = np.stack(np.meshgrid(*[np.arange(d) for d in DIMS], indexing="ij"), -1).reshape(-1, 3)
W = (gi + LO + 0.5) * VS
DEP = CAM_D - W[:, 0]
COL = np.round(256 + F * W[:, 1] / DEP).astype(int)
ROW = np.round(256 - F * W[:, 2] / DEP).astype(int)
INS = (COL >= 0) & (COL < 512) & (ROW >= 0) & (ROW < 512)
COLc, ROWc = COL.clip(0, 511), ROW.clip(0, 511)


def h_ellipse(sil):
    s = time.time()
    m = sil["mask"]
    inside = INS & m[ROWc, COLc]
    # per-row run containing each pixel → half-width and centre
    left = np.zeros_like(m, dtype=int)
    right = np.zeros_like(m, dtype=int)
    for r in range(512):
        row = m[r]
        if not row.any():
            continue
        lab, n = ndimage.label(row)
        for k in range(1, n + 1):
            idx = np.where(lab == k)[0]
            left[r, idx], right[r, idx] = idx[0], idx[-1]
    lc, rc = left[ROWc, COLc], right[ROWc, COLc]
    half = (rc - lc + 1) / 2.0
    u = (COL - (lc + rc) / 2.0) / np.maximum(half, 1)
    halfw_world = half / F * DEP
    allowed = K_DEPTH * halfw_world * np.sqrt(np.clip(1 - u**2, 0, 1))
    occ = inside & (np.abs(W[:, 0]) <= allowed)
    return {"cells": gi[occ].astype(np.int32), "seconds": time.time() - s}


def h_depthlift(sil, disp):
    s = time.time()
    m = sil["mask"]
    d = disp.copy()
    dm = d[m]
    dn = np.zeros_like(d)
    dn[m] = (dm - dm.min()) / max(1e-9, dm.max() - dm.min())
    width_world = (sil["bbox"][3] - sil["bbox"][1]) / F * CAM_D
    D = K_DEPTH * width_world  # deepest point's full thickness
    x_front = -D / 2 + D * dn  # nearest (dn=1) at +D/2
    c = float(x_front[m].min())
    inside = INS & m[ROWc, COLc]
    xf = x_front[ROWc, COLc]
    occ = inside & (W[:, 0] <= xf) & (W[:, 0] >= 2 * c - xf)
    return {"cells": gi[occ].astype(np.int32), "seconds": time.time() - s, "depth_extent": D}


def score(name, cells, sil, disp, seconds, prior, provenance):
    m = sil["mask"]
    k = cells.astype(np.int64)
    w = (k + LO + 0.5) * VS
    dep = CAM_D - w[:, 0]
    col = np.round(256 + F * w[:, 1] / dep).astype(int)
    row = np.round(256 - F * w[:, 2] / dep).astype(int)
    ok = (col >= 0) & (col < 512) & (row >= 0) & (row < 512)
    zb = np.full((512, 512), np.inf)
    sp = max(1, int(np.ceil(F * VS / dep.min() / 2)))
    for dr in range(-sp, sp + 1):
        for dc in range(-sp, sp + 1):
            rr, cc = (row[ok] + dr).clip(0, 511), (col[ok] + dc).clip(0, 511)
            np.minimum.at(zb, (rr, cc), dep[ok])
    proj = np.isfinite(zb)
    both = proj & m
    rho = float(spearmanr(-zb[both], disp[both]).statistic) if both.sum() > 100 else float("nan")
    return {
        "hypothesis": name,
        "provenance": provenance,
        "cells": int(len(cells)),
        "silhouette_iou": float(both.sum() / max(1, (proj | m).sum())),
        "depth_rank_correlation": rho,
        "prior_confidence": prior,
        "compute_seconds": round(seconds, 3),
    }


def mesh_of(cells, name):
    vol = np.zeros(DIMS + 2, np.float32)
    vol[tuple((cells + 1).T)] = 1
    vol = ndimage.gaussian_filter(vol, 0.8)
    v, f, _, _ = marching_cubes(vol, 0.5, gradient_direction="descent")
    v = ((v - 1 + LO + 0.5) * VS).astype(np.float32)  # lattice index → TripoSR Z-up
    a, b, cc = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    if np.einsum("ij,ij->i", a, np.cross(b, cc)).sum() < 0:
        f = f[:, [0, 2, 1]]
    np.save(os.path.join(out, f"{name}_vertices.npy"), np.ascontiguousarray(v))
    np.save(os.path.join(out, f"{name}_faces.npy"), np.ascontiguousarray(f.astype(np.int32)))


with ThreadPoolExecutor(max_workers=int(job.get("workers", 4)), thread_name_prefix="asre") as pool:
    f_rgba = op("load+crop", load_rgba)
    f_rgb = op("rgb-analysis", rgb_analysis, f_rgba)
    f_seg = op("foreground-segmentation", segment, f_rgba)
    f_sil = op("silhouette", silhouette, f_seg)
    f_depth = op("depth-estimation", depth, f_rgba)
    f_surf = op("surface-analysis", surface, f_depth, f_sil)
    f_lm = op("landmarks", landmarks, f_sil)
    f_comp = op("components", components, f_lm)
    f_meas = op("spatial-measurement", measure, f_lm, f_sil)
    f_h2 = op("hypothesis:ellipse-hull", h_ellipse, f_sil)
    f_h3 = op("hypothesis:depth-lift", h_depthlift, f_sil, f_depth)
    sil, disp = f_sil.result(), f_depth.result()
    h2, h3 = f_h2.result(), f_h3.result()
    h1_cells = np.load(os.path.join(job["triposr_dir"], "cells.npy"))
    h1_seconds = tr["timings"]["inference_s"] + tr["timings"]["lattice_s"]
    f_scores = [
        op("score:triposr", lambda: score("triposr", h1_cells, sil, disp, h1_seconds, 0.5, "SYNTHESIZED")),
        op("score:ellipse-hull", lambda: score("ellipse-hull", h2["cells"], sil, disp, h2["seconds"], 0.5, "INFERRED")),
        op("score:depth-lift", lambda: score("depth-lift", h3["cells"], sil, disp, h3["seconds"], 0.6, "INFERRED")),
    ]
    scores = [f.result() for f in f_scores]
    for name, cells in (("ellipse-hull", h2["cells"]), ("depth-lift", h3["cells"])):
        np.save(os.path.join(out, f"{name}_cells.npy"), np.ascontiguousarray(cells))
        op(f"mesh:{name}", lambda c=cells, n=name: mesh_of(c, n))
    results = {
        "rgb": f_rgb.result(),
        "silhouette": {k: v for k, v in sil.items() if k != "mask"},
        "surface": f_surf.result(),
        "landmarks": f_lm.result(),
        "components": f_comp.result(),
        "measurements": f_meas.result(),
    }

np.save(os.path.join(out, "depth.npy"), np.ascontiguousarray(disp.astype(np.float32)))
Image.fromarray((255 * (disp - disp.min()) / (disp.max() - disp.min())).astype(np.uint8)).save(os.path.join(out, "depth.png"))
wall = time.time() - T0
busy = sum(t["end_s"] - t["start_s"] for t in timeline)
result = {
    "image": os.path.abspath(job["image"]),
    "models": {"depth": "depth-anything/Depth-Anything-V2-Small-hf@5426e4f0 (Apache-2.0)"},
    "depth_to_width_prior": K_DEPTH,
    "analyses": results,
    "hypotheses": scores,
    "timeline": sorted(timeline, key=lambda t: t["start_s"]),
    "wall_s": round(wall, 3),
    "sum_op_s": round(busy, 3),
    "concurrency_gain": round(busy / wall, 2),
}
json.dump(result, open(os.path.join(out, "analysis.json"), "w"), indent=1)
print(json.dumps({k: result[k] for k in ("hypotheses", "wall_s", "sum_op_s", "concurrency_gain")}))
