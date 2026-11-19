"""
LÉLU M25 Complete — authorised Meshy jobs for the two new looks (user approved in-session).

    python3 scripts/foundry/m25c_meshy.py submit <look> <outDir> <img> [<img> ...]   # multi-image-to-3d
    python3 scripts/foundry/m25c_meshy.py i2i    <look> <outDir> <prompt> <model> <img> [...]  # image-to-image
    python3 scripts/foundry/m25c_meshy.py rig    <look> <outDir> <task_id>            # rigging of that task
    python3 scripts/foundry/m25c_meshy.py wait   <outDir> <kind> <task_id>            # poll + download

Request settings are the wardrobe planner's own (plugins/wardrobeInventory.ts
requestFor): meshy-7.1, PBR, 2k textures, remeshed triangles, 90k polycount for a
look; plus pose_mode "a-pose" so the rigger can bind it. Images are sent as JPEG
data URIs (long side 1024). Every request, response, task record and downloaded
file is written to <outDir>/provenance.json with sha256 sums. The key is read from
MESHY_API_KEY and never written anywhere.
"""
import base64
import hashlib
import io
import json
import os
import sys
import time
import urllib.request

from PIL import Image

API = os.environ.get("MESHY_API_URL", "https://api.meshy.ai").rstrip("/")
KEY = os.environ["MESHY_API_KEY"].strip()
PATHS = {"multi-image-to-3d": "/openapi/v1/multi-image-to-3d", "rigging": "/openapi/v1/rigging",
         "image-to-image": "/openapi/v1/image-to-image"}


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def data_uri(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((1024, 1024))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def prov(out):
    p = os.path.join(out, "provenance.json")
    return (json.load(open(p)) if os.path.exists(p) else {"jobs": []}), p


def save(out, record):
    data, p = prov(out)
    data["jobs"].append(record)
    json.dump(data, open(p, "w"), indent=1)


def submit(look, out, images):
    os.makedirs(out, exist_ok=True)
    body = {"ai_model": "meshy-7.1", "should_texture": True, "enable_pbr": True, "texture_resolution": "2k", "should_remesh": True,
            "topology": "triangle", "target_polycount": int(os.environ.get("M25C_POLY", 90000)), "image_enhancement": False,
            "image_urls": [data_uri(i) for i in images]}
    if os.environ.get("M25C_PROP") != "1":
        body["pose_mode"] = "a-pose"  # characters only; props keep their own shape
    res = call("POST", PATHS["multi-image-to-3d"], body)
    rec = {"look": look, "kind": "multi-image-to-3d", "task": res.get("result"), "submittedAt": time.time(),
           "request": {k: v for k, v in body.items() if k != "image_urls"},
           "images": [{"file": i, "sha256": sha(i)} for i in images], "authorisation": "user approved paid Meshy for the two new looks in-session"}
    save(out, rec)
    print("TASK", res.get("result"))


def i2i(look, out, prompt, images, model="nano-banana-pro", multi=False):
    os.makedirs(out, exist_ok=True)
    body = {"ai_model": model, "prompt": prompt, "reference_image_urls": [data_uri(i) for i in images],
            "generate_multi_view": multi, "remove_background": True}
    res = call("POST", PATHS["image-to-image"], body)
    save(out, {"look": look, "kind": "image-to-image", "task": res.get("result"), "submittedAt": time.time(),
               "request": {k: v for k, v in body.items() if k != "reference_image_urls"},
               "images": [{"file": i, "sha256": sha(i)} for i in images]})
    print("TASK", res.get("result"))


def rig(look, out, task):
    res = call("POST", PATHS["rigging"], {"input_task_id": task, "height_meters": 1.72})
    save(out, {"look": look, "kind": "rigging", "task": res.get("result"), "input_task_id": task, "submittedAt": time.time(),
               "request": {"input_task_id": task, "height_meters": 1.72}})
    print("TASK", res.get("result"))


def wait(out, kind, task):
    while True:
        t = call("GET", f"{PATHS[kind]}/{task}")
        st = t.get("status")
        print("STATUS", st, t.get("progress"), flush=True)
        if st in ("SUCCEEDED", "FAILED", "CANCELED"):
            break
        time.sleep(20)
    files = []
    if st == "SUCCEEDED":
        urls = {}
        if kind == "multi-image-to-3d":
            urls = {f"model.{k}": v for k, v in (t.get("model_urls") or {}).items() if k in ("glb", "fbx")}
            for i, tex in enumerate(t.get("texture_urls") or []):
                for k, v in tex.items():
                    urls[f"texture_{i}_{k}.png"] = v
            if t.get("thumbnail_url"):
                urls["preview.png"] = t["thumbnail_url"]
        elif kind == "image-to-image":
            for i, u in enumerate(t.get("image_urls") or []):
                urls[f"view_{task[:8]}_{i}.png"] = u
        else:
            r = t.get("result") or {}
            for k, v in (r.get("rigged_character_glb_url") and {"rigged.glb": r["rigged_character_glb_url"]} or {}).items():
                urls[k] = v
            for k, v in (r.get("basic_animations") or {}).items():
                if isinstance(v, str) and v.endswith(".glb") or "glb" in k:
                    urls[f"anim_{k}.glb"] = v
        for name, url in urls.items():
            dst = os.path.join(out, name)
            urllib.request.urlretrieve(url, dst)
            files.append({"file": name, "bytes": os.path.getsize(dst), "sha256": sha(dst)})
    keep = {k: v for k, v in t.items() if k not in ("model_urls", "texture_urls", "thumbnail_url", "result", "video_url")}
    save(out, {"kind": kind, "task": task, "finished": time.time(), "status": st, "record": keep, "files": files})
    print("DONE", st, json.dumps(files))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "submit":
        submit(sys.argv[2], sys.argv[3], sys.argv[4:])
    elif cmd == "i2i":
        i2i(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[6:], model=sys.argv[5])
    elif cmd == "rig":
        rig(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "wait":
        wait(sys.argv[2], sys.argv[3], sys.argv[4])
