"""
LÉLU M25 — acceptance render orchestration.

    python3 scripts/foundry/m25_acceptance.py <set> [--samples 64] [--only a,b] [--versions v0004,v0005]

Sets:
  views      the fifteen individual acceptance views, for every version, identical
             camera and lighting per view (neutral studio)
  lighting   the front face under all four lighting conditions, for every version
  rig        v0005 shape-key and walk-clip evidence
  noise      v0005 front face at two seeds (render-noise estimate)

Every job is written next to its PNG (<png>.job.json) and Blender writes the
measured report (<png>.json): camera, grey-card exposure, samples, seconds.
"""
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLENDER = os.environ.get("LELU_BLENDER_BIN", os.path.expanduser("~/lelu-tools/blender-4.5.9-linux-x64/blender"))
OUT = os.path.join(ROOT, "artifacts/foundry/m25/acceptance")
VERSIONS = {
    "v0004": "artifacts/foundry/m24/assets/lelu-m24-hair-split.glb",
    "v0005": "artifacts/foundry/m25/assets/lelu-m25-visual-fidelity.glb",
}
WALK = "leluverse/assets/characters/lelu_character/animations/v021_animation_01a193c7/motion.glb"

# Blender Z-up metres. She faces -Y; her left is +X.
VIEWS = [
    ("01-front-face", "front", [0, -0.09, 1.565], 0.135, 105, [1024, 1024]),
    ("02-three-quarter-face", "three-quarter", [0.0, -0.07, 1.57], 0.15, 105, [1024, 1024]),
    ("03-left-profile", "left", [0.0, -0.03, 1.57], 0.16, 105, [1024, 1024]),
    ("04-right-profile", "right", [0.0, -0.03, 1.57], 0.16, 105, [1024, 1024]),
    ("05-full-body-front", "front", [0, 0, 0.865], 0.92, 70, [1024, 1536]),
    ("06-full-body-rear", "back", [0, 0, 0.865], 0.92, 70, [1024, 1536]),
    ("07-hairline", "front", [0, -0.09, 1.655], 0.075, 135, [1024, 1024]),
    ("08-crown", "top", [0, -0.005, 1.66], 0.14, 85, [1024, 1024]),
    ("09-ringlet-close-up", [1, -0.55, 0.05], [0.115, -0.03, 1.47], 0.075, 135, [1024, 1024]),
    ("10-skin-close-up", [0.25, -1, 0.05], [0.028, -0.094, 1.568], 0.032, 135, [1024, 1024]),
    ("11-eye-close-up", "front", [0, -0.095, 1.593], 0.045, 135, [1024, 1024]),
    ("12-lip-close-up", "front", [0, -0.1, 1.546], 0.03, 135, [1024, 1024]),
    ("13-shoulder-chest", "front", [0, -0.04, 1.34], 0.23, 85, [1024, 1024]),
    ("14-clothing-close-up", "front", [0, -0.09, 1.17], 0.16, 85, [1024, 1024]),
    ("15-jewelry-close-up", [0.7, -1, 0.05], [0.04, -0.075, 1.55], 0.07, 135, [1024, 1024]),
]
LIGHTS = ["neutral-studio", "soft-frontal", "directional-key", "warm-environment"]


def run(job, png):
    os.makedirs(os.path.dirname(png), exist_ok=True)
    job["output"] = png
    jp = png + ".job.json"
    json.dump(job, open(jp, "w"), indent=1)
    t = time.time()
    p = subprocess.run([BLENDER, "-b", "--factory-startup", "--python", os.path.join(ROOT, "scripts/blender/lelu_m25_render.py"), "--", jp],
                       capture_output=True, text=True, cwd=ROOT)
    line = next((l for l in p.stdout.splitlines() if l.startswith("M25_RENDER")), None)
    ok = p.returncode == 0 and line is not None and os.path.exists(png)
    print(("OK  " if ok else "FAIL"), os.path.relpath(png, ROOT), round(time.time() - t, 1), "s", flush=True)
    if not ok:
        print(p.stdout[-3000:], p.stderr[-3000:])
    return ok


def main():
    args = sys.argv[1:]
    which = args[0]
    samples = int(args[args.index("--samples") + 1]) if "--samples" in args else 64
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
    versions = args[args.index("--versions") + 1].split(",") if "--versions" in args else list(VERSIONS)
    results = []
    if which == "views":
        for name, view, center, radius, lens, res in VIEWS:
            if only and name not in only:
                continue
            for v in versions:
                job = {"input": VERSIONS[v], "view": view, "camera": {"center": center, "radius": radius, "lens": lens},
                       "resolution": res, "samples": samples, "lighting": "neutral-studio", "seed": 0}
                results.append((v, name, run(job, os.path.join(OUT, v, name + ".png"))))
    elif which == "lighting":
        name, view, center, radius, lens, res = VIEWS[0]
        for lt in LIGHTS:
            for v in versions:
                job = {"input": VERSIONS[v], "view": view, "camera": {"center": center, "radius": radius, "lens": lens},
                       "resolution": [768, 768], "samples": samples, "lighting": lt, "seed": 0}
                results.append((v, lt, run(job, os.path.join(OUT, "lighting", v, f"front-face-{lt}.png"))))
            job = {"input": VERSIONS["v0005"], "view": "three-quarter", "camera": {"center": [0, -0.02, 1.45], "radius": 0.3, "lens": 85},
                   "resolution": [768, 768], "samples": samples, "lighting": lt, "seed": 0}
            results.append(("v0005", lt, run(job, os.path.join(OUT, "lighting", "v0005", f"bust-{lt}.png"))))
    elif which == "noise":
        name, view, center, radius, lens, res = VIEWS[0]
        for seed in (0, 1):
            job = {"input": VERSIONS["v0005"], "view": view, "camera": {"center": center, "radius": radius, "lens": lens},
                   "resolution": res, "samples": samples, "lighting": "neutral-studio", "seed": seed}
            results.append(("v0005", f"seed{seed}", run(job, os.path.join(OUT, "noise", f"01-front-face-seed{seed}.png"))))
    elif which == "rig":
        name, view, center, radius, lens, res = VIEWS[0]
        base = {"input": VERSIONS["v0005"], "view": view, "camera": {"center": center, "radius": radius, "lens": lens},
                "resolution": [768, 768], "samples": samples, "lighting": "neutral-studio", "seed": 0}
        rig_out = os.path.join(ROOT, "artifacts/foundry/m25/rig/renders")
        for tag, keys in [("neutral", {}), ("blink", {"eyeBlinkLeft": 1, "eyeBlinkRight": 1}),
                          ("jawOpen-smile", {"jawOpen": 0.8, "mouthSmileLeft": 0.7, "mouthSmileRight": 0.7}),
                          ("eyeWide-browUp", {"eyeWideLeft": 1, "eyeWideRight": 1, "browInnerUp": 1}),
                          ("frown-browDown", {"mouthFrownLeft": 0.8, "mouthFrownRight": 0.8, "browDownLeft": 0.8, "browDownRight": 0.8})]:
            results.append(("v0005", tag, run(dict(base, shape_keys=keys), os.path.join(rig_out, f"shape-{tag}.png"))))
        for frame in (1, 12, 24):
            job = {"input": VERSIONS["v0005"], "view": "three-quarter", "camera": {"center": [0, -0.05, 0.9], "radius": 0.95, "lens": 70},
                   "resolution": [768, 1152], "samples": max(16, samples // 2), "lighting": "neutral-studio", "seed": 0,
                   "animation": {"clip": WALK, "frame": frame}}
            results.append(("v0005", f"walk-f{frame}", run(job, os.path.join(rig_out, f"walk-f{frame:02d}.png"))))
    print(json.dumps({"set": which, "ok": sum(r[2] for r in results), "total": len(results)}))


if __name__ == "__main__":
    main()
