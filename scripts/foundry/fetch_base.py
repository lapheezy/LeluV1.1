"""Fetch the CC0 MakeHuman base mesh: public URL, no credentials, checksum verified."""
import hashlib, json, os, sys, urllib.request

URL = "https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/3dobjs/base.obj"
HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.abspath(os.path.join(HERE, "..", "..", "leluverse", "assets", "characters",
                                    "lelu_character", "foundry", "base"))
EXPECTED = ""

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    os.makedirs(DEST, exist_ok=True)
    out = os.path.join(DEST, "base.obj")
    manifest = {}
    mpath = os.path.join(DEST, "manifest.json")
    if os.path.exists(mpath):
        manifest = json.load(open(mpath))
    expected = manifest.get("sha256") or EXPECTED
    if os.path.exists(out) and (not expected or sha256(out) == expected):
        print(f"[base] present and verified: {out}")
        return 0
    print(f"[base] downloading {URL}")
    with urllib.request.urlopen(URL, timeout=120) as r, open(out + ".part", "wb") as f:
        f.write(r.read())
    os.replace(out + ".part", out)
    got = sha256(out)
    if expected and got != expected:
        print(f"[base] checksum mismatch: {got} != {expected}")
        return 1
    print(f"[base] ok {got}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
