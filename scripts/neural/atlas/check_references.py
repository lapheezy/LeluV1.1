import json, re, sys, ssl, os, urllib.request, urllib.parse, concurrent.futures, hashlib, html
D = sys.argv[1]
refs = json.load(open(os.path.join(D, "refs.json")))
ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept": "*/*"}
def get(url, limit):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
            body = r.read(limit)
            return {"status": r.status, "final": r.geturl(), "type": r.headers.get("content-type", ""), "length": r.headers.get("content-length"), "body": body}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "final": url, "type": e.headers.get("content-type", "") if e.headers else "", "error": f"HTTP {e.code}", "body": b""}
    except Exception as e:
        return {"status": 0, "final": url, "type": "", "error": str(e)[:160], "body": b""}
LIC = [
    (r'creativecommons\.org/(licenses/[a-z\-]+/[0-9.]+|publicdomain/(zero|mark)/[0-9.]+)', "cc"),
    (r'rel=["\']license["\'][^>]*href=["\']([^"\']+)', "rel-license"),
    (r'\b(CC[- ]BY(?:[- ](?:SA|NC|ND))*(?:[- ]\d\.\d)?|CC0)\b', "cc-text"),
    (r'\bpublic domain\b', "public-domain"),
    (r'all rights reserved', "all-rights-reserved"),
    (r'(?:©|&copy;|copyright)\s*(?:\d{4})?[^<]{0,60}', "copyright"),
]
def evidence(text):
    found = []
    for pat, kind in LIC:
        for m in re.finditer(pat, text, re.I):
            snippet = re.sub(r"\s+", " ", html.unescape(text[max(0, m.start()-60): m.end()+60]))
            snippet = re.sub(r"<[^>]+>", " ", snippet)
            found.append({"kind": kind, "match": m.group(0)[:80], "context": snippet[:200]})
            break
    return found
def one(i, ref):
    src = next((l for l in ref["links"] if l != ref["img"]), None)
    page = get(src, 3_000_000) if src else {"status": None, "body": b""}
    text = page["body"].decode("utf-8", "replace")
    img = get(ref["img"], 15_000_000)
    blob = img["body"]
    key = urllib.parse.unquote(ref["img"])
    tokens = [t for t in re.split(r"[/?&=%,]", key) if len(t) > 10][-3:]
    linked = ref["img"] in text or any(t in text for t in tokens)
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg"}.get(img["type"].split(";")[0].strip(), "")
    path = None
    if img["status"] == 200 and blob and ext:
        path = f"img/{i+1:02d}.{ext}"
        os.makedirs(os.path.join(D, "img"), exist_ok=True)
        open(os.path.join(D, path), "wb").write(blob)
    return {"n": i+1, "title": ref["title"], "source": src, "sourceStatus": page.get("status"), "sourceFinal": page.get("final"), "sourceError": page.get("error"), "image": ref["img"], "imageStatus": img.get("status"), "imageType": img["type"], "imageBytes": len(blob), "imageSha256": hashlib.sha256(blob).hexdigest() if blob else None, "imageError": img.get("error"), "imageReferencedBySource": linked, "licenseEvidence": evidence(text), "file": path}
with concurrent.futures.ThreadPoolExecutor(8) as ex:
    res = list(ex.map(lambda a: one(*a), enumerate(refs)))
json.dump(res, open(os.path.join(D, "check.json"), "w"), indent=1)
for r in res:
    print(r["n"], r["sourceStatus"], r["imageStatus"], r["imageType"][:12], r["imageBytes"], "linked" if r["imageReferencedBySource"] else "-", ",".join(e["kind"] for e in r["licenseEvidence"]), r["title"][:40])
