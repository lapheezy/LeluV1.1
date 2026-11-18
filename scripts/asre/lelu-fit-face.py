"""
LÉLU — fit her face's CC0 morph-target weights to her measured references.

    python lelu-fit-face.py --model face_landmarker.task --out DIR [--iters 2]

Each evaluation: build only her head with a candidate set of target weights
(lelu-head-preview.ts), render it orthographically with neutral light, detect
the same 478 landmarks, compute the same metrics, and express each as z
against the reference distribution (artifacts/lelu/wp04/reference-landmarks).

The fit is Gauss-Newton with a finite-difference Jacobian and Tikhonov
regularisation toward the starting weights, inside bounds [-1, 1]:

    minimise  sum_i z_i(w)^2  +  lam * sum_j (w_j - w0_j)^2

so a target is moved only as far as the measurements require. Parameters are
SIGNED: +w applies the "incr/up/out" file, -w the "decr/down/in" file.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib

lm = importlib.import_module("lelu-landmarks")

T = "targets/"
# name: (positive file(s), negative file(s), start weight)
PARAMS = {
    "eye_spacing": (["eyes/l-eye-trans-out", "eyes/r-eye-trans-out"], ["eyes/l-eye-trans-in", "eyes/r-eye-trans-in"], 0.0),
    "eye_scale": (["eyes/l-eye-scale-incr", "eyes/r-eye-scale-incr"], ["eyes/l-eye-scale-decr", "eyes/r-eye-scale-decr"], 0.0),
    "eye_open": (["eyes/l-eye-height2-incr", "eyes/r-eye-height2-incr"], ["eyes/l-eye-height2-decr", "eyes/r-eye-height2-decr"], 0.45),
    "eye_tilt": (["eyes/l-eye-corner1-up", "eyes/r-eye-corner1-up"], ["eyes/l-eye-corner1-down", "eyes/r-eye-corner1-down"], 0.6),
    "brow_height": (["eyebrows/eyebrows-trans-up"], ["eyebrows/eyebrows-trans-down"], 0.0),
    "nose_width": (["nose/nose-scale-horiz-incr"], ["nose/nose-scale-horiz-decr"], 0.0),
    "nose_length": (["nose/nose-scale-vert-incr"], ["nose/nose-scale-vert-decr"], 0.0),
    "nose_flare": (["nose/nose-flaring-incr"], ["nose/nose-flaring-decr"], 0.3),
    "mouth_width": (["mouth/mouth-scale-horiz-incr"], ["mouth/mouth-scale-horiz-decr"], 0.0),
    "upper_lip": (["mouth/mouth-upperlip-height-incr"], ["mouth/mouth-upperlip-height-decr"], 0.0),
    "lower_lip": (["mouth/mouth-lowerlip-height-incr"], ["mouth/mouth-lowerlip-height-decr"], 0.0),
    "head_width": (["head/head-scale-horiz-incr"], ["head/head-scale-horiz-decr"], 0.0),
    "head_height": (["head/head-scale-vert-incr"], ["head/head-scale-vert-decr"], 0.0),
    "cheek_bones": (["cheek/l-cheek-bones-incr", "cheek/r-cheek-bones-incr"], ["cheek/l-cheek-bones-decr", "cheek/r-cheek-bones-decr"], 0.5),
    "chin_width": (["chin/chin-width-incr"], ["chin/chin-width-decr"], 0.0),
    "jaw_width": (["chin/chin-bones-incr"], ["chin/chin-bones-decr"], 0.0),
    "chin_height": (["chin/chin-height-incr"], ["chin/chin-height-decr"], 0.0),
    "forehead_height": (["forehead/forehead-scale-vert-incr"], ["forehead/forehead-scale-vert-decr"], 0.0),
}
# identity targets that are not fitted (shape, not proportion): kept as they are
FIXED = [
    "targets/head/head-round.target@0.3",
    "targets/eyes/l-eye-corner2-down.target@0.2",
    "targets/eyes/r-eye-corner2-down.target@0.2",
    "targets/mouth/mouth-lowerlip-volume-incr.target@0.7",
    "targets/mouth/mouth-upperlip-volume-incr.target@0.5",
    "targets/mouth/mouth-cupidsbow-incr.target@0.6",
    "targets/nose/nose-point-width-incr.target@0.25",
]
NAMES = list(PARAMS)


def targets_for(w):
    out = list(FIXED)
    for name, v in zip(NAMES, w):
        pos, neg, _ = PARAMS[name]
        if abs(v) < 1e-4:
            continue
        for f in pos if v > 0 else neg:
            out.append(f"{T}{f}.target@{abs(v):.4f}")
    return out


def evaluate(w, tag, a, ref):
    d = os.path.join(a.out, "evals", tag)
    os.makedirs(d, exist_ok=True)
    tf = os.path.join(d, "targets.json")
    json.dump(targets_for(w), open(tf, "w"), indent=0)
    glb = os.path.join(d, "head.glb")
    env = dict(os.environ, NODE_OPTIONS="--max-old-space-size=8000")
    subprocess.run(["tsx", "scripts/asre/lelu-head-preview.ts", "--targets", tf, "--out", glb], cwd=ROOT, check=True, env=env, capture_output=True)
    js = ("import('./scripts/asre/render.mjs').then(m=>m.renderViews({glb:process.argv[1],outDir:process.argv[2],views:['front'],prefix:'head-ortho-',"
          "resolution:[640,640],samples:16,camera:{center:[0,-0.1,1.555],radius:0.13},ortho:true,hide:['hair','accessories.head'],lighting:'neutral',materials:'classes',denoise:true,viewTransform:'AgX'}))")
    subprocess.run(["node", "-e", js, glb, d], cwd=ROOT, check=True, capture_output=True)
    os.remove(glb)
    res = lm.detect(a.model, os.path.join(d, "head-ortho-front.png"))
    if res is None:
        return None
    pts, _, _ = res
    metrics, _ = lm.measure({k: pts[i] for k, i in lm.LM.items()})
    z = np.array([(metrics[k] - ref[k]["mean"]) / max(ref[k]["std"], abs(ref[k]["mean"]) * 0.01) for k in KEYS])
    json.dump({"weights": dict(zip(NAMES, map(float, w))), "metrics": metrics, "z": dict(zip(KEYS, map(float, z)))}, open(os.path.join(d, "eval.json"), "w"), indent=1)
    return z


def main():
    global KEYS
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--iters", type=int, default=2)
    ap.add_argument("--lam", type=float, default=0.6)
    ap.add_argument("--step", type=float, default=0.35)
    ap.add_argument("--start", help="fit.json whose weights are the starting point (and the regularisation anchor)")
    ap.add_argument("--only", help="comma-separated parameters to fit; the rest are held")
    a = ap.parse_args()
    ref = json.load(open(os.path.join(ROOT, "artifacts/lelu/wp04/reference-landmarks/landmarks.json")))["aggregate"]
    KEYS = list(ref)
    w0 = np.array([PARAMS[n][2] for n in NAMES])
    if a.start:
        st = json.load(open(a.start))["weights"]
        w0 = np.array([st.get(n, PARAMS[n][2]) for n in NAMES])
    active = [j for j, n in enumerate(NAMES) if not a.only or n in a.only.split(",")]
    w = w0.copy()
    log = []
    z = evaluate(w, "it0-base", a, ref)
    print(f"start: rms z {np.sqrt(np.mean(z ** 2)):.3f}", flush=True)
    log.append({"iter": 0, "rms_z": float(np.sqrt(np.mean(z ** 2))), "weights": dict(zip(NAMES, map(float, w)))})
    for it in range(1, a.iters + 1):
        Jcols = []
        for j, n in enumerate(NAMES):
            if j not in active:
                Jcols.append(np.zeros_like(z))
                continue
            h = a.step if w[j] + a.step <= 1 else -a.step
            wj = w.copy()
            wj[j] += h
            zj = evaluate(wj, f"it{it}-d-{n}", a, ref)
            Jcols.append((zj - z) / h if zj is not None else np.zeros_like(z))
            print(f"  it{it} d/d{n}: |dz| {np.linalg.norm(Jcols[-1]):.2f}", flush=True)
        J = np.stack(Jcols, axis=1)
        # damped least squares toward the start, then clipped to bounds;
        # backtrack if the new point is worse
        A = J.T @ J + a.lam * np.eye(len(NAMES)) + 1e6 * np.diag([0.0 if j in active else 1.0 for j in range(len(NAMES))])
        g = J.T @ z + a.lam * (w - w0)
        dw = -np.linalg.solve(A, g)
        best = None
        for t in (1.0, 0.6, 0.35):
            wn = np.clip(w + t * dw, -1, 1)
            zn = evaluate(wn, f"it{it}-try{t}", a, ref)
            if zn is None:
                continue
            r = float(np.sqrt(np.mean(zn ** 2)))
            print(f"  it{it} step {t}: rms z {r:.3f}", flush=True)
            if best is None or r < best[0]:
                best = (r, wn, zn)
            if r < float(np.sqrt(np.mean(z ** 2))):
                break
        if best is None or best[0] >= float(np.sqrt(np.mean(z ** 2))):
            print("  no improvement; stopping", flush=True)
            break
        _, w, z = best
        log.append({"iter": it, "rms_z": best[0], "weights": dict(zip(NAMES, map(float, w)))})
    fit = {"weights": dict(zip(NAMES, map(float, w))), "targets": targets_for(w), "rms_z": float(np.sqrt(np.mean(z ** 2))), "z": dict(zip(KEYS, map(float, z))), "log": log, "lambda": a.lam, "fd_step": a.step}
    json.dump(fit, open(os.path.join(a.out, "fit.json"), "w"), indent=1)
    print(json.dumps({k: round(v, 3) for k, v in fit["weights"].items()}))
    print(f"final rms z {fit['rms_z']:.3f}")


if __name__ == "__main__":
    main()
