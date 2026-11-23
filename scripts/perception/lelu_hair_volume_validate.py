#!/usr/bin/env python
"""
LÉLU — validation for the volumetric hair (PCI-FR 2.2)

Measures the reconstruction; it does not assert that it looks right.

  length      below-chin extent of the reconstructed tips, in mm and face widths,
              from the geometry and (independently) from the full-length render
  curl        autocorrelation spacing on the curl close-up, against the printed
              ringlet dimensions
  silhouette  IoU of the reconstructed hair silhouette (projected geometry)
              against lelu-hair-20's hair mask, in face-relative coordinates,
              restricted to the rows the reference actually shows
  width       half-width profile error, same coordinates
  hairline    RMS distance to the reference hairline, with the overlap guard —
              not-measurable stays a failure
  colour      hue / saturation / value against the reference hair
  baby hairs  re-detection on the render (geometry alone does not count)
  structure   every strand rooted on the scalp, no segment longer than 12 mm,
              hair present in all four views

  python scripts/perception/lelu_hair_volume_validate.py --out artifacts/pci-fr-2.2
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_hair as H  # noqa: E402
import lelu_hair_volume as V  # noqa: E402
import lelu_replicate as Rp  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF_FRONT = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references/lelu-hair/lelu-hair-20.png")
BASE = os.path.join(ROOT, "artifacts/pci-fr-1.0/renders/improved_face.png")

FRONT_FRAME = {"W": 900, "H": 1200, "scale": 1200 / (1.52 + 1.62), "cx": 0.0,
               "cy": (1.52 - 1.62) / 2}


def hair_colour_stats(rgb: np.ndarray, mask: np.ndarray) -> dict:
    pix = rgb[mask > 0].astype(np.float32)
    if len(pix) < 100:
        return {}
    hsv = cv2.cvtColor((pix[None, :, :]).astype(np.uint8), cv2.COLOR_RGB2HSV)[0].astype(np.float32)
    return {"mean_rgb": [round(float(v), 1) for v in pix.mean(axis=0)],
            "mean_hue": round(float(hsv[:, 0].mean()), 1),
            "mean_sat": round(float(hsv[:, 1].mean() / 255), 3),
            "mean_val": round(float(hsv[:, 2].mean() / 255), 3),
            "sat_p90": round(float(np.percentile(hsv[:, 1], 90) / 255), 3)}


def project_mask(guides: list[dict], frame: dict) -> np.ndarray:
    """Silhouette of the reconstruction: every lock drawn at its own width."""
    m = np.zeros((frame["H"], frame["W"]), np.uint8)
    for g in guides:
        px, z = V.project(g["pts"], frame)
        wpx = max(1, int(round(2 * g["lock"]["tube_mm"] * V.MM * frame["scale"])))
        cv2.polylines(m, [px.astype(np.int32)], False, 255, wpx, cv2.LINE_AA)
    return (m > 100).astype(np.uint8)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-2.2"))
    a = ap.parse_args()
    hd = os.path.join(a.out, "hair")

    vol = json.load(open(os.path.join(hd, "hair-volume.json")))
    rgb = np.asarray(Image.open(os.path.join(hd, "hair_front.png")).convert("RGB"))
    Hh, Ww = rgb.shape[:2]

    # ---- rebuild the geometry (deterministic seed) ----------------------
    rng = np.random.default_rng(2027)
    roots = V.scalp_roots(7800, rng)
    locks = V.make_locks(roots, 17, rng)
    guides, strands = V.build_hair(roots, locks, rng)

    frame = dict(FRONT_FRAME)
    frame["W"], frame["H"] = Ww, Hh
    frame["scale"] = Hh / (1.52 + 1.62)
    geom_mask = project_mask(guides, frame)

    # ---- landmarks ------------------------------------------------------
    lm_mod, lm = P._landmarker()
    pts = P.load_landmarks(os.path.join(hd, "hair_front.png"), lm)
    ref_pts = P.load_landmarks(REF_FRONT, lm)
    lm.close()
    fw = float(np.linalg.norm(pts[234] - pts[454]))
    cx = float((pts[234, 0] + pts[454, 0]) / 2)
    cy = float((pts[10, 1] + pts[152, 1]) / 2)
    px_per_mm = fw / H.HEAD_WIDTH_MM
    chin_y = float(pts[152, 1])

    # ---- length ---------------------------------------------------------
    # The portrait is framed head-and-shoulders, so the render length must be
    # measured on the full-length view, whose camera is known exactly.
    full_p = os.path.join(hd, "hair_full_length.png")
    full_mm = None
    if os.path.exists(full_p):
        fim = np.asarray(Image.open(full_p).convert("RGB"))
        fh, fwn = fim.shape[:2]
        S_full = fh / (1.55 + 3.95)
        cy_full = (1.55 - 3.95) / 2
        bg = np.median(fim[:6, :6].reshape(-1, 3), axis=0)
        fg = np.abs(fim.astype(np.int16) - bg[None, None, :]).sum(axis=2) > 30
        rows = np.nonzero(fg.any(axis=1))[0]
        chin_px = fh / 2 - (V.CHIN_Y - cy_full) * S_full
        if len(rows):
            full_mm = (rows.max() - chin_px) / S_full * H.HEAD_WIDTH_MM
    length = {
        "geometry_below_chin_mm": vol["geometry_length_mm"]["below_chin_max"],
        "geometry_below_chin_mean_mm": vol["geometry_length_mm"]["below_chin_mean"],
        "render_full_length_below_chin_mm": round(float(full_mm), 1) if full_mm else None,
        "target_mm": vol["waist_below_chin_mm"],
        "target_fw": vol["waist_below_chin_fw"],
        "render_full_length_below_chin_fw": round(float(full_mm / H.HEAD_WIDTH_MM), 2) if full_mm else None,
    }
    length["pass"] = bool(abs(float(length["geometry_below_chin_mm"]) - length["target_mm"]) <= 20
                          and (full_mm is None or full_mm >= length["target_mm"] - 40))

    # ---- curl spacing on the close-up -----------------------------------
    cu_path = os.path.join(hd, "hair_curl_closeup.png")
    curl = {"spacing_mm": None, "spacing_px": None, "confidence": None}
    if os.path.exists(cu_path):
        cu = np.asarray(Image.open(cu_path).convert("RGB"))
        bg = np.median(cu[:8, :8].reshape(-1, 3), axis=0)
        mask = (np.abs(cu.astype(np.int16) - bg[None, None, :]).sum(axis=2) > 24).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        res = H.curl_scale(cu, mask)
        # The close-up camera is 8 px/mm in the original render frame; state it
        # rather than assuming 1 px/mm.
        ppm = float(V.CURL_PX_PER_MM)
        conf = float(res.get("confidence") or 0.0)
        curl = {"spacing_px": res.get("spacing_px"),
                "px_per_mm": ppm,
                "spacing_mm": round(float(res["spacing_px"]) / ppm, 1) if res.get("spacing_px") else None,
                "confidence": round(conf, 3),
                "measurable": bool(conf >= 0.35),
                "spec_loose_diameter_mm": H.SPEC["ringlet_loose"]["curl_diameter_mm"],
                "spec_panel_curl_diameter_mm": [18.0, 28.0]}
        curl["pass"] = bool(curl["measurable"] and curl["spacing_mm"]
                            and 8.0 <= curl["spacing_mm"] <= 30.0)

    # ---- silhouette against lelu-hair-20 --------------------------------
    ref_rgb = np.asarray(Image.open(REF_FRONT).convert("RGB"))
    ref_hair = P.hair_mask(ref_rgb, ref_pts)
    rfw = float(np.linalg.norm(ref_pts[234] - ref_pts[454]))
    rcx = float((ref_pts[234, 0] + ref_pts[454, 0]) / 2)
    rcy = float((ref_pts[10, 1] + ref_pts[152, 1]) / 2)

    grid = 160
    xs = np.linspace(-1.6, 1.6, grid)
    yy = np.linspace(1.1, -1.45, grid)

    def sample(mask, cx_, cy_, fwp, img_shape, want="mask"):
        px = (cx_ + xs * fwp).astype(int)
        py = (cy_ - yy * fwp).astype(int)
        px = np.clip(px, 0, img_shape[1] - 1)
        py = np.clip(py, 0, img_shape[0] - 1)
        return mask[np.ix_(py, px)]

    ref_g = sample(ref_hair, rcx, rcy, rfw, ref_hair.shape[:2])
    # rows the reference actually shows: above its lowest hair pixel
    rys = np.nonzero(ref_hair.any(axis=1))[0]
    if len(rys):
        bottom_fw = (rcy - rys.max()) / rfw
        rows = yy >= bottom_fw + 0.02
    else:
        rows = np.ones_like(yy, bool)
    ren_g = sample(geom_mask, cx, cy, fw, geom_mask.shape[:2])
    inter = np.logical_and(ref_g[rows], ren_g[rows]).sum()
    union = np.logical_or(ref_g[rows], ren_g[rows]).sum()
    # A cropped reference cannot score a full silhouette: lelu-hair-20's hair runs
    # off the sides of the sheet, so its mask is clipped by the frame and any IoU
    # against it measures the crop, not the hair. That is recorded as
    # not-measurable, and therefore a failure, rather than a number.
    clipped = bool(ref_hair[:, :max(2, int(0.02 * ref_hair.shape[1]))].any() or
                   ref_hair[:, -max(2, int(0.02 * ref_hair.shape[1])):].any())
    sil = {"iou": round(float(inter / max(union, 1)), 3),
           "recall": round(float(inter / max(ref_g[rows].sum(), 1)), 3),
           "precision": round(float(inter / max(ren_g[rows].sum(), 1)), 3),
           "rows_compared": int(rows.sum()),
           "reference_bottom_fw": round(float(bottom_fw), 2) if len(rys) else None,
           "reference_clipped_by_frame": clipped,
           "measurable": not clipped}
    sil["pass"] = bool(sil["measurable"] and sil["iou"] >= 0.55)

    # width profile error at fixed heights
    prof = []
    for y0 in np.arange(0.9, -1.35, -0.15):
        r = np.nonzero(ref_g[np.argmin(np.abs(yy - y0))])[0]
        g = np.nonzero(ren_g[np.argmin(np.abs(yy - y0))])[0]
        if len(r) > 4 and len(g) > 4:
            rw = (xs[r.max()] - xs[r.min()]) / 2
            gw = (xs[g.max()] - xs[g.min()]) / 2
            prof.append((round(float(y0), 2), round(float(rw), 2), round(float(gw), 2)))
    width = {"rows": prof,
             "rms_fw": round(float(np.sqrt(np.mean([(p[1] - p[2]) ** 2 for p in prof]))), 3) if prof else None}

    # ---- hairline -------------------------------------------------------
    skin = P.skin_mask(rgb)
    hair_like = P.hair_mask(rgb, pts)
    ren_line = P.hairline_path(skin, hair_like, pts)
    ref_skin = P.skin_mask(ref_rgb)
    ref_line = P.hairline_path(ref_skin, ref_hair, ref_pts)

    def normalise(line, pts_):
        w = float(np.linalg.norm(pts_[234] - pts_[454]))
        c0 = float((pts_[234, 0] + pts_[454, 0]) / 2)
        c1 = float((pts_[10, 1] + pts_[152, 1]) / 2)
        return [[(x - c0) / w, (y - c1) / w] for x, y in line]

    hl_rms, hl_overlap = (None, 0.0)
    if ren_line and ref_line:
        hl_rms, hl_overlap = Rp.hairline_error(normalise(ren_line, pts), normalise(ref_line, ref_pts))
    hairline = {"rms_fw": round(float(hl_rms), 4) if hl_rms is not None else None,
                "overlap": hl_overlap, "measurable": hl_rms is not None,
                "points_measured": len(ren_line), "points_reference": len(ref_line)}
    hairline["pass"] = bool(hl_rms is not None and hl_rms <= 0.06)

    # ---- colour ---------------------------------------------------------
    skin_m = P.skin_mask(rgb)
    hair_img = ((geom_mask > 0) & (skin_m == 0)).astype(np.uint8)
    colour = {"render": hair_colour_stats(rgb, hair_img),
              "reference": hair_colour_stats(ref_rgb, ref_hair)}
    dv = colour["render"].get("mean_val", 0) - colour["reference"].get("mean_val", 0)
    ds = colour["render"].get("mean_sat", 0) - colour["reference"].get("mean_sat", 0)
    colour["delta_val"] = round(float(dv), 3)
    colour["delta_sat"] = round(float(ds), 3)
    colour["pass"] = bool(abs(dv) <= 0.06 and abs(ds) <= 0.08)

    # ---- baby hairs -----------------------------------------------------
    baby = H.forehead_filaments(rgb, pts, ren_line) if ren_line else []
    bh = {"detected_on_render": len(baby), "spirals_expected": len(H.SPEC["baby_swirls"]),
          "spiral_count": sum(1 for b in baby if b.get("is_spiral")),
          "roots": [b["root"] for b in baby[:8]]}
    bh["pass"] = bool(bh["spiral_count"] >= 2)

    # ---- structure ------------------------------------------------------
    seg_max = 0.0
    root_err = 0.0
    floats = 0
    for st in strands:
        p = st["pts"]
        d = np.linalg.norm(np.diff(p, axis=0), axis=1)
        seg_max = max(seg_max, float(d.max()))
        r = st["root"]
        q = np.array([r[0] / V.HEAD["rx"], (r[1] - V.HEAD["yc"]) / V.HEAD["ry"], r[2] / V.HEAD["rz"]])
        root_err = max(root_err, abs(np.linalg.norm(q) - 1.0) * H.HEAD_WIDTH_MM - 0.6)
        if not np.isfinite(p).all():
            floats += 1
    structure = {
        "strands": len(strands),
        "locks": len(guides),
        "roots_on_scalp_max_error_mm": round(float(root_err), 2),
        "max_segment_mm": round(seg_max / V.MM, 2),
        "non_finite_paths": floats,
        "views_present": {k: os.path.exists(os.path.join(hd, os.path.basename(v)))
                          for k, v in vol["views"].items()},
    }
    structure["pass"] = bool(root_err < 2.0 and seg_max / V.MM < 12.0 and floats == 0)

    # hair coverage in every view (so no view is a bare capsule)
    view_area = {}
    for name in ("three_quarter", "profile", "rear"):
        p = os.path.join(hd, f"hair_{name}.png")
        if not os.path.exists(p):
            continue
        im = np.asarray(Image.open(p).convert("RGB"))
        bg = np.median(im[:6, :6].reshape(-1, 3), axis=0)
        diff = np.abs(im.astype(np.int16) - bg[None, None, :]).sum(axis=2)
        view_area[name] = round(float((diff > 30).mean()), 3)
    structure["view_non_background_fraction"] = view_area
    structure["four_views_pass"] = bool(len(view_area) == 3 and all(v > 0.10 for v in view_area.values()))

    metrics = {
        "schema": "lelu.hair.metrics/2",
        "render": os.path.relpath(os.path.join(hd, "hair_front.png"), ROOT),
        "px_per_mm": round(px_per_mm, 3),
        "length": length,
        "curl": curl,
        "silhouette": sil,
        "width": width,
        "hairline": hairline,
        "colour": colour,
        "baby_hairs": bh,
        "structure": structure,
        "verdict": {
            "pass": bool(length.get("pass") and curl.get("pass") and sil["pass"] and
                         hairline["pass"] and colour["pass"] and bh["pass"] and
                         structure["pass"] and structure["four_views_pass"]),
            "failing": [k for k, v in (("length", length), ("curl", curl), ("silhouette", sil),
                                       ("hairline", hairline), ("colour", colour),
                                       ("baby_hairs", bh), ("structure", structure)) if not v.get("pass")],
        },
    }
    json.dump(metrics, open(os.path.join(hd, "hair-metrics.json"), "w"), indent=1)
    print(json.dumps(metrics["verdict"], indent=1))
    for k in ("length", "curl", "silhouette", "hairline", "colour", "baby_hairs", "structure"):
        m = metrics[k]
        print(k, {kk: vv for kk, vv in m.items() if kk in ("pass", "ios", "iou", "rms_fw", "spacing_mm",
                                                           "detected_on_render", "spiral_count",
                                                           "below_chin_mm", "delta_sat", "delta_val")})


if __name__ == "__main__":
    main()
