"""
==========================================================
LÉLU CHARACTER FOUNDRY — PROCEDURAL PBR TEXTURE SETS
==========================================================

Every map here is generated from the design authority
(lelu_design.py) at 4K, deterministically, on the CPU:

  camo_rose   colour + roughness + normal  (garments, ref_A/B/C/E)
  skin        colour + roughness + normal  (ref_B forearm, ref_G hands)
  leather     colour + roughness + normal  (harness, cuffs, boots)
  copper      colour + roughness           (every metal piece)
  hair        colour + roughness           (curl bundles, ref_B)
  eye_iris    colour                        (ref_B)
  nail        colour + roughness            (stiletto nails, ref_G)

Maps are written as PNG next to the .blend so the same images are
what Blender samples and what the glTF carries; nothing is baked
from the renderer (a bake would need GPU-time we do not spend),
and nothing is a solid colour: each set carries grain, wear and
the print's own structure at texel level.
==========================================================
"""

from __future__ import annotations

import hashlib
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import lelu_design as D


# ------------------------------------------------------------------ noise
def value_noise(size: int, cells: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    grid = rng.random((cells + 1, cells + 1)).astype(np.float32)
    img = Image.fromarray((grid * 255).astype(np.uint8), mode="L").resize((size, size), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0


def fbm(size: int, octaves=6, base_cells=4, seed=7, gain=0.5, lacunarity=2.0) -> np.ndarray:
    total = np.zeros((size, size), dtype=np.float32)
    amp = 1.0
    norm = 0.0
    cells = base_cells
    for o in range(octaves):
        total += amp * value_noise(size, max(1, int(cells)), seed + o * 977)
        norm += amp
        amp *= gain
        cells *= lacunarity
    return total / max(norm, 1e-6)


def hex_rgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def mix(a: np.ndarray, b: np.ndarray, t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0, 1)[..., None]
    return a * (1 - t) + b * t


def normal_from_height(height: np.ndarray, strength=2.0) -> np.ndarray:
    gy, gx = np.gradient(height.astype(np.float32))
    nx = -gx * strength * height.shape[1] / 512.0
    ny = -gy * strength * height.shape[0] / 512.0
    nz = np.ones_like(height, dtype=np.float32)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / length, ny / length, nz / length], axis=-1) * 0.5 + 0.5


def save(path: str, rgb: np.ndarray) -> str:
    arr = np.clip(rgb, 0, 1)
    if arr.ndim == 2:
        img = Image.fromarray((arr * 255).astype(np.uint8), mode="L")
    elif arr.shape[2] == 4:
        img = Image.fromarray((arr * 255).astype(np.uint8), mode="RGBA")
    else:
        img = Image.fromarray((arr * 255).astype(np.uint8), mode="RGB")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


def sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------ roses
def draw_rose(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float,
              ink: tuple[int, int, int], light: tuple[int, int, int], layers=5, rot=0.0):
    """A rose motif drawn as nested spiral petals — the print's own flower."""
    for layer in range(layers, 0, -1):
        rr = r * layer / layers
        shade = layer / layers
        col = tuple(int(ink[i] * (0.55 + 0.45 * shade) + light[i] * (1 - shade) * 0.35) for i in range(3))
        petals = 7
        for k in range(petals):
            a0 = rot + 2 * math.pi * (k / petals) + layer * 0.35
            a1 = a0 + 2 * math.pi / petals * 0.92
            box = [cx - rr, cy - rr, cx + rr, cy + rr]
            draw.arc(box, math.degrees(a0), math.degrees(a1), fill=col,
                     width=max(1, int(r / 26)))
        draw.ellipse([cx - rr * 0.18, cy - rr * 0.18, cx + rr * 0.18, cy + rr * 0.18],
                     fill=tuple(min(255, int(c * 1.12)) for c in col))


# ------------------------------------------------------------------ fabric
def camo_rose(size=4096, seed=11) -> dict:
    """Camouflage blobs carrying a dusty rose print — ref_A/B/C/E."""
    nn = value_noise(size, 5, seed)
    n1 = fbm(size, 5, 3, seed + 1)
    n2 = fbm(size, 4, 7, seed + 2)
    palette = [hex_rgb(D.FABRIC["charcoal"]), hex_rgb(D.FABRIC["olive"]),
               hex_rgb(D.FABRIC["bone"]), hex_rgb(D.FABRIC["mauve"])]
    field = n1 * 0.65 + n2 * 0.35
    bands = np.digitize(field, [0.46, 0.68, 0.86]).astype(np.int16)
    ink = np.zeros((size, size, 3), dtype=np.float32)
    for i, col in enumerate(palette):
        ink = np.where((bands == i)[..., None], col, ink)
    # drop shadows between camouflage shapes so the print reads as printed cloth
    edge = np.abs(np.gradient(field)[0]) + np.abs(np.gradient(field)[1])
    ink *= (1.0 - np.clip(edge * 26.0, 0, 0.45))[..., None]

    # rose motifs
    img = Image.fromarray((np.clip(ink, 0, 1) * 255).astype(np.uint8))
    draw = ImageDraw.Draw(img)
    rng = np.random.default_rng(seed + 9)
    rose_ink = tuple(int(c * 255) for c in hex_rgb(D.ROSE["petal_dk"]))
    rose_hi = tuple(int(c * 255) for c in hex_rgb(D.ROSE["petal_hi"]))
    for _ in range(64):
        cx, cy = rng.uniform(0, size), rng.uniform(0, size)
        r = rng.uniform(size * 0.010, size * 0.028)
        draw_rose(draw, cx, cy, r, rose_ink, rose_hi, layers=5, rot=rng.uniform(0, 6.28))
    for _ in range(120):
        cx, cy = rng.uniform(0, size), rng.uniform(0, size)
        r = rng.uniform(size * 0.004, size * 0.012)
        draw_rose(draw, cx, cy, r, rose_ink, rose_hi, layers=4, rot=rng.uniform(0, 6.28))
    ink = np.asarray(img, dtype=np.float32) / 255.0

    # floral lace texture + crinkle + copper sparkle dust
    lace = fbm(size, 6, 12, seed + 3)
    ink *= (0.55 + 0.20 * lace)[..., None]
    crinkle = fbm(size, 7, 40, seed + 4)
    height = 0.55 * crinkle + 0.25 * n2 + 0.20 * nn
    sparkle = (fbm(size, 3, 200, seed + 5) > 0.72).astype(np.float32)
    sparkle = np.asarray(
        Image.fromarray((sparkle * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)),
        dtype=np.float32) / 255.0
    ink = mix(ink, hex_rgb(D.FABRIC["sparkle"]), sparkle * 0.55)

    rough = np.clip(0.62 - 0.22 * crinkle + 0.06 * sparkle, 0.05, 1.0)
    return {"colour": ink, "roughness": rough, "normal": normal_from_height(height, 1.6),
            "height": height}


# -------------------------------------------------------------------- lace
def black_lace(size=2048, seed=83) -> dict:
    """Sheer black lace: a floral cord net with real alpha between the cords.

    The photographs show the skirt reading as smoke over the legs, with a
    scalloped cord pattern and a denser band at the waist. Alpha is a map,
    so the material is genuinely sheer rather than a dark opaque shell.
    """
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    # net: two diagonal cord families plus a floral rosette lattice
    diag = np.abs(np.sin((xx + yy) * math.pi * 26.0)) * np.abs(np.sin((xx - yy) * math.pi * 26.0))
    cord = np.clip(diag ** 0.35, 0, 1)
    petals = np.zeros((size, size), dtype=np.float32)
    rng = np.random.default_rng(seed)
    for _ in range(220):
        cx, cy = rng.uniform(0, 1), rng.uniform(0, 1)
        r = rng.uniform(0.012, 0.030)
        d = np.hypot(xx - cx, yy - cy)
        ang = np.arctan2(yy - cy, xx - cx)
        ring = np.exp(-((d - r * (0.55 + 0.22 * np.sin(ang * 5.0))) / (size / 900.0 + 0.0022)) ** 2)
        petals = np.maximum(petals, ring)
    cord = np.clip(np.maximum(cord * 0.85, petals), 0, 1)
    # a denser, opaque band at the waist edge and a scalloped hem
    band = np.clip(1.0 - np.abs(yy - 0.03) / 0.022, 0, 1)
    alpha = np.clip(0.42 + cord * (0.96 - 0.42) + band * 0.5, 0, 1)
    alpha[yy > 0.985] = 0.0
    base = hex_rgb("#0B0A0A")
    cord_col = hex_rgb("#191616")
    col = mix(base, cord_col, cord * 0.8)
    height = cord * 0.8 + fbm(size, 5, 40, seed + 1) * 0.2
    rough = np.clip(0.44 + 0.24 * (1 - cord), 0.2, 0.9)
    rgb = np.concatenate([col, alpha[..., None]], axis=-1)
    return {"colour": rgb, "roughness": rough,
            "normal": normal_from_height(height, 0.9), "alpha": alpha}


# -------------------------------------------------------------------- skin
def skin(size=4096, seed=23) -> dict:
    """Warm medium-deep skin with freckles, pores, and tattoo linework."""
    mottle = fbm(size, 6, 5, seed)
    pore = fbm(size, 4, 120, seed + 1)
    base = hex_rgb(D.SKIN["base"])
    light = hex_rgb(D.SKIN["light"])
    deep = hex_rgb(D.SKIN["deep"])
    col = mix(base, light, np.clip((mottle - 0.5) * 1.5 + 0.35, 0, 1) * 0.55)
    col = mix(col, deep, np.clip((0.45 - mottle) * 1.2, 0, 1) * 0.5)
    # vascular warmth
    col = mix(col, hex_rgb(D.SKIN["blush"]), np.clip((fbm(size, 4, 9, seed + 2) - 0.55) * 1.6, 0, 1) * 0.22)

    # freckles: clustered scatters, ref_B
    rng = np.random.default_rng(seed + 5)
    freck = np.zeros((size, size), dtype=np.float32)
    for _ in range(26000):
        x, y = rng.uniform(0, size), rng.uniform(0, size)
        r = rng.uniform(0.6, 2.2)
        freck[int(y) % size, int(x) % size] = 1.0
    freck = np.asarray(Image.fromarray((freck * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(0.8)), dtype=np.float32) / 255.0
    col = mix(col, hex_rgb(D.SKIN["freckle"]), freck * 0.55)

    # tattoo ink is real geometry (thin tubes on the chest and arms), never a
    # texture: a smart-projected ink decal reads as random scratches.
    height = 0.5 * pore + 0.3 * mottle + 0.2 * freck
    rough = np.clip(0.44 + 0.16 * pore - 0.10 * freck + 0.05 * (mottle - 0.5), 0.12, 1.0)
    return {"colour": col, "roughness": rough, "normal": normal_from_height(height, 0.7),
            "height": height}


# ----------------------------------------------------------------- leather
def leather(size=2048, seed=31) -> dict:
    grain = fbm(size, 7, 60, seed)
    veins = np.abs(fbm(size, 4, 14, seed + 1) - 0.5) * 2.0
    base = hex_rgb(D.LEATHER["base"])
    wear = hex_rgb(D.LEATHER["wear"])
    col = mix(base, wear, np.clip((grain - 0.35) * 0.9, 0, 1))
    col = mix(col, hex_rgb(D.COPPER["patina"]), np.clip((1 - veins) * 0.14, 0, 1))
    rough = np.clip(D.LEATHER["rough"] - 0.16 * grain + 0.08 * veins, 0.2, 0.95)
    return {"colour": col, "roughness": rough, "normal": normal_from_height(grain * 0.7 + veins * 0.3, 1.2),
            "height": grain}


# ------------------------------------------------------------------ copper
def copper(size=2048, seed=41) -> dict:
    brush = np.asarray(
        Image.fromarray((fbm(size, 3, 300, seed) * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(0.6)), dtype=np.float32) / 255.0
    patina = fbm(size, 5, 12, seed + 1)
    base = hex_rgb(D.COPPER["polished"])
    col = mix(base, hex_rgb(D.COPPER["deep"]), np.clip((patina - 0.5) * 0.8, 0, 1))
    col = mix(col, hex_rgb(D.COPPER["patina"]), np.clip((patina - 0.72) * 2.2, 0, 1))
    col *= (0.93 + 0.12 * brush)[..., None]
    rough = np.clip(D.COPPER["rough_polished"] + 0.14 * (patina - 0.5) + 0.06 * brush, 0.05, 0.6)
    return {"colour": col, "roughness": rough}


# -------------------------------------------------------------------- hair
def hair(size=2048, seed=53) -> dict:
    """Strand-aligned variation: black with rose-red and dusty pink bands."""
    u = np.linspace(0, 1, size, dtype=np.float32)[None, :].repeat(size, axis=0)
    v = np.linspace(0, 1, size, dtype=np.float32)[:, None].repeat(size, axis=1)
    strand = fbm(size, 5, 90, seed)
    band = np.clip((np.sin((u * 9.0 + strand * 3.0) * math.pi) * 0.5 + 0.5) - 0.62, 0, 1) * 3.0
    base = hex_rgb(D.HAIR["body"])
    col = mix(base, hex_rgb(D.HAIR["rose"]), band * 0.85)
    col = mix(col, hex_rgb(D.HAIR["rose_hi"]), np.clip(band - 0.55, 0, 1) * 0.8)
    col = mix(col, hex_rgb(D.HAIR["pink"]), np.clip((band - 0.9) * 1.6, 0, 1) * 0.7)
    col *= (0.75 + 0.45 * strand)[..., None]
    rough = np.clip(0.30 + 0.14 * strand, 0.12, 0.6)
    return {"colour": col, "roughness": rough}


# --------------------------------------------------------------------- eye
def eye_iris(size=1024, seed=61) -> dict:
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cx = cy = size / 2
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (size / 2)
    fibres = 0.5 + 0.5 * np.sin(34 * np.arctan2(yy - cy, xx - cx) + 12 * fbm(size, 4, 30, seed))
    iris = mix(hex_rgb(D.SKIN["iris"]), hex_rgb(D.SKIN["iris_ring"]),
               np.clip(r * 1.1, 0, 1))
    col = mix(iris, iris * 1.25, fibres * 0.35)
    pupil = np.clip(1.0 - r / 0.30, 0, 1)
    col = mix(col, np.zeros(3, dtype=np.float32), np.clip(pupil * 2.2, 0, 1))
    limbal = np.clip((r - 0.92) * 8.0, 0, 1)
    col = mix(col, hex_rgb(D.SKIN["iris_ring"]), limbal)
    outside = np.clip((r - 1.0) * 6.0, 0, 1)
    col = mix(col, hex_rgb(D.SKIN["sclera"]), outside)
    return {"colour": col}


# -------------------------------------------------------------------- nail
def nail(size=1024, seed=71) -> dict:
    grad = np.linspace(0, 1, size, dtype=np.float32)[:, None].repeat(size, axis=1)
    speck = fbm(size, 4, 90, seed)
    col = mix(hex_rgb(D.SKIN["nail"]), hex_rgb(D.SKIN["nail_tip"]), np.clip(grad * 0.55 + speck * 0.15, 0, 1))
    rough = np.clip(0.10 + 0.05 * speck, 0.05, 0.3)
    return {"colour": col, "roughness": rough}


# ----------------------------------------------------------------- bundle
SETS = {
    "camo_rose": (camo_rose, 4096),
    "skin": (skin, 4096),
    "leather": (leather, 2048),
    "copper": (copper, 2048),
    "hair": (hair, 2048),
    "eye_iris": (eye_iris, 1024),
    "black_lace": (black_lace, 2048),
    "nail": (nail, 1024),
}


def build(outdir: str, sets=None, size_scale=1.0) -> dict:
    """Write the whole texture set, deterministically, and return a manifest."""
    manifest = {"generated_at": None, "sets": {}}
    for name in (sets or SETS):
        fn, size = SETS[name]
        size = int(size * size_scale)
        maps = fn(size=size)
        entry = {"size": size, "maps": {}}
        for map_name, arr in maps.items():
            if map_name == "height":
                continue
            path = os.path.join(outdir, f"{name}_{map_name}.png")
            save(path, arr)
            entry["maps"][map_name] = {"file": os.path.basename(path), "sha256": sha(path)}
        manifest["sets"][name] = entry
        print(f"[textures] {name} {size}x{size} -> {list(entry['maps'])}")
    import datetime
    manifest["generated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with open(os.path.join(outdir, "textures.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return manifest


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    build(out)
