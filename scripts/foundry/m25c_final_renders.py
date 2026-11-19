"""
LÉLU M25 Complete — final individual renders for every look (calibrated renderer, neutral studio).

    python3 scripts/foundry/m25c_final_renders.py [--samples 48] [--only look,look]

Writes artifacts/foundry/m25c/final/<look>/<view>.png (+ .json report each).
Animation frames load her own Meshy clips by joint name (walk v021, sit_idle v024,
idle_look_around v004) and record which bones moved.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLENDER = os.environ.get("LELU_BLENDER_BIN", os.path.expanduser("~/lelu-tools/blender-4.5.9-linux-x64/blender"))
A = "leluverse/assets/characters/lelu_character/"
LOOKS = {
    "camo_repaired": A + "meshes/v014_look_camo_repaired/lelu.glb",
    "bronze_velocity": A + "meshes/v015_look_bronze_velocity/lelu.glb",
    "rose_gold_sovereign": A + "meshes/v016_look_rose_gold_sovereign/lelu.glb",
}
CLIP = {"walk": A + "animations/v021_animation_01a193c7/motion.glb", "sit": A + "animations/v024_animation_01a193c7/motion.glb",
        "arms": A + "animations/v004_animation_01a193c7/motion.glb"}
FULL = {"center": [0, 0, 0.88], "radius": 0.92, "lens": 70}
SHOTS = [
    ("front", "front", FULL, [1024, 1536], None, None),
    ("three-quarter", "three-quarter", FULL, [1024, 1536], None, None),
    ("side", "left", FULL, [1024, 1536], None, None),
    ("rear", "back", FULL, [1024, 1536], None, None),
    ("walk", "three-quarter", {"center": [0, -0.05, 0.9], "radius": 0.95, "lens": 70}, [1024, 1536], ("walk", 12), None),
    # sit_idle carries root motion: her hips measure (0.227, 0.725, 0.729) m at frame 20
    ("sit", "three-quarter", {"center": [0.227, 0.62, 0.68], "radius": 0.85, "lens": 70}, [1024, 1536], ("sit", 20), None),
    ("arms", "front", FULL, [1024, 1536], ("arms", 40), None),
    ("face-neutral", "front", {"center": [0, -0.09, 1.565], "radius": 0.135, "lens": 105}, [1024, 1024], None, {}),
    ("face-smile", "front", {"center": [0, -0.09, 1.565], "radius": 0.135, "lens": 105}, [1024, 1024], None, {"mouthSmileLeft": 0.8, "mouthSmileRight": 0.8}),
    ("face-jaw-open", "front", {"center": [0, -0.09, 1.565], "radius": 0.135, "lens": 105}, [1024, 1024], None, {"jawOpen": 0.8}),
]


def main():
    args = sys.argv[1:]
    samples = int(args[args.index("--samples") + 1]) if "--samples" in args else 48
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else set(LOOKS)
    shots = set(args[args.index("--shots") + 1].split(",")) if "--shots" in args else None
    for look, glb in LOOKS.items():
        if look not in only:
            continue
        for name, view, cam, res, anim, keys in SHOTS:
            if shots and name not in shots:
                continue
            out = os.path.join(ROOT, "artifacts/foundry/m25c/final", look, name + ".png")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            job = {"input": glb, "output": out, "view": view, "camera": cam, "resolution": res, "samples": samples, "lighting": "neutral-studio", "seed": 0}
            if anim:
                job["animation"] = {"clip": CLIP[anim[0]], "frame": anim[1]}
            if keys:
                job["shape_keys"] = keys
            jp = out + ".job.json"
            json.dump(job, open(jp, "w"), indent=1)
            p = subprocess.run([BLENDER, "-b", "--factory-startup", "--python", os.path.join(ROOT, "scripts/blender/lelu_m25_render.py"), "--", jp],
                               capture_output=True, text=True, cwd=ROOT)
            ok = p.returncode == 0 and os.path.exists(out)
            print(("OK  " if ok else "FAIL"), look, name, flush=True)
            if not ok:
                print(p.stdout[-1500:], p.stderr[-1500:])


if __name__ == "__main__":
    main()
