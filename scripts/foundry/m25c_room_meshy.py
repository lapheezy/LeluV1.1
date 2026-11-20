"""
LÉLU M25 Complete — her rotating room's furniture, built by Meshy (owner approved credits, 2026-11-20).

    python3 scripts/foundry/m25c_room_meshy.py <piece> [<piece> ...]     # isolate → 3D, waits, downloads
    python3 scripts/foundry/m25c_room_meshy.py list

For each piece: the crop of the owner's room picture (artifacts/foundry/m25c/room/crops/<piece>.png)
goes to Meshy image-to-image, which isolates exactly that object on white; the isolated view then
goes to multi-image-to-3d as a prop (no A-pose). Every request, task record and file is written to
leluverse/assets/room/meshy/<piece>/provenance.json by scripts/foundry/m25c_meshy.py. The key is
read from MESHY_API_KEY and never written anywhere.
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("M25C_PROP", "1")
os.environ.setdefault("M25C_POLY", "30000")
os.environ.setdefault("M25C_AUTH", "owner approved Meshy credits for her rotating room on 2026-11-20")
import m25c_meshy as meshy  # noqa: E402

CROPS = "artifacts/foundry/m25c/room/crops"
OUT = "leluverse/assets/room/meshy"
TAIL = (" Isolated and complete, seen in three-quarter view from slightly above, centred, on a plain pure white "
        "background. Nothing else: no floor, no walls, no plants, no candles, no people, no other furniture.")
PIECES = {
    "bed": "Exactly this round bed alone: a circular bed on its round stepped black-marble platform with glowing copper-gold trim, dark velvet bedding with a pink throw and pink and black cushions.",
    "tub": "Exactly this round bathtub alone: a circular soaking tub filled with water and pink petals, set in a round black-marble surround with copper-gold trim and a glowing copper symbol on its side.",
    "dining": "Exactly this round dining set alone: a round black-marble dining table on a copper-gold pedestal with six curved blush-pink velvet armchairs with copper frames around it, place settings on the table.",
    "island": "Exactly this kitchen island alone: a long black-marble kitchen island with copper-gold trim and under-glow, a cooktop and sink on top, and four tall copper-legged bar stools along its front.",
    "desk": "Exactly this curved creator desk alone: a curved black desk with copper-gold trim and drawers, a row of five computer monitors and a laptop on it, and a white high-back office chair in front.",
    "theater_sofa": "Exactly this sofa alone: a large curved cream sectional sofa with black and pink cushions and a velvet throw.",
    "lounge_ring": "Exactly this conversation pit alone: a circular ring of cream sofas with pink and black cushions on a round raised black-marble platform with copper-gold trim, low bookshelves at its ends and a round coffee table in the middle.",
    "crystal": "Exactly this glowing pink-violet quartz crystal cluster alone, standing on a small round copper base.",
    "chandelier": "Exactly this chandelier alone: a copper-gold armillary-sphere chandelier with a glowing pink orb in the centre and hanging pink crystal pendants.",
    "planter": "Exactly one tall lush green fern plant in a round black-and-copper planter pot, alone.",
    "vanity": "Exactly this vanity alone: a small black-and-copper vanity table with a round glowing ring mirror and a round cream upholstered stool.",
    "fridge": "Exactly this tall black-and-copper double-door refrigerator cabinet alone, with a glowing copper symbol on one door and a glass door showing fruit shelves.",
}


def last(out, kind):
    data, _ = meshy.prov(out)
    return [j for j in data["jobs"] if j.get("kind") == kind]


def run(piece):
    out = os.path.join(OUT, piece)
    os.makedirs(out, exist_ok=True)
    crop = os.path.join(CROPS, f"{piece}.png")
    # 1 — isolate (skipped when a finished view exists; a rerun never pays twice)
    views = sorted(f for f in os.listdir(out) if f.startswith("view_"))
    if not views:
        done = [j for j in last(out, "image-to-image") if j.get("status") == "SUCCEEDED"]
        sub = [j for j in last(out, "image-to-image") if j.get("task") and "status" not in j]
        task = sub[-1]["task"] if sub and not done else None
        if not task:
            body = {"ai_model": "nano-banana-pro", "prompt": PIECES[piece] + TAIL,
                    "reference_image_urls": [meshy.data_uri(crop)], "generate_multi_view": False, "remove_background": False}
            res = meshy.call("POST", meshy.PATHS["image-to-image"], body)
            task = res.get("result")
            meshy.save(out, {"piece": piece, "kind": "image-to-image", "task": task, "submittedAt": time.time(),
                             "request": {k: v for k, v in body.items() if k != "reference_image_urls"},
                             "images": [{"file": crop, "sha256": meshy.sha(crop)}], "authorisation": os.environ["M25C_AUTH"]})
        meshy.wait(out, "image-to-image", task)
        views = sorted(f for f in os.listdir(out) if f.startswith("view_"))
    if not views:
        return piece, "isolation failed"
    # 2 — 3D
    if not os.path.exists(os.path.join(out, "model.glb")):
        subs = [j for j in last(out, "multi-image-to-3d") if j.get("task") and "status" not in j]
        if subs:
            task = subs[-1]["task"]
        else:
            body = {"ai_model": "meshy-7.1", "should_texture": True, "enable_pbr": True, "texture_resolution": "2k",
                    "should_remesh": True, "topology": "triangle", "target_polycount": int(os.environ["M25C_POLY"]),
                    "image_enhancement": False, "image_urls": [meshy.data_uri(os.path.join(out, views[0]))]}
            res = meshy.call("POST", meshy.PATHS["multi-image-to-3d"], body)
            task = res.get("result")
            meshy.save(out, {"piece": piece, "kind": "multi-image-to-3d", "task": task, "submittedAt": time.time(),
                             "request": {k: v for k, v in body.items() if k != "image_urls"},
                             "images": [{"file": os.path.join(out, views[0]), "sha256": meshy.sha(os.path.join(out, views[0]))}],
                             "authorisation": os.environ["M25C_AUTH"]})
        meshy.wait(out, "multi-image-to-3d", task)
    return piece, "ok" if os.path.exists(os.path.join(out, "model.glb")) else "3d failed"


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "list":
        print("\n".join(PIECES))
        sys.exit(0)
    with ThreadPoolExecutor(max_workers=6) as pool:
        for piece, status in pool.map(run, args):
            print("PIECE", piece, status, flush=True)
