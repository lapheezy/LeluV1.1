"""
LÉLU CHARACTER FOUNDRY — WP07 acceptance sheet.

    python3 scripts/foundry/acceptance_montage.py

Composes one image: rows are the five acceptance views, columns are the three
authorities in precedence order — the photograph, the owned Meshy character, the
CC0 foundry build. Every render was made by the same Cycles scene with the same
camera, lens, resolution and lights; only the asset differs. Labels are drawn,
not composited from a caption card.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PHOTO = os.path.join(ROOT, "reference-39")
MESHY = os.path.join(ROOT, "artifacts/foundry/meshy/renders")
CC0 = os.path.join(ROOT, "artifacts/foundry/benchmark")
OUT = os.path.join(ROOT, "artifacts/foundry/meshy/acceptance")

ROWS = [
    ("front portrait", "lelu-facial-expressions/lelu-facial-expression-01.png", "portrait-front.png"),
    ("three-quarter", "lelu-facial-expressions/lelu-facial-expression-03.png", "portrait-three-quarter.png"),
    ("side profile", "lelu-anatomy/lelu-anatomy-01.png", "profile.png"),
    ("rear", "lelu-hair/lelu-hair-07.png", "rear.png"),
    ("face close-up", "lelu-facial-expressions/lelu-facial-expression-02.png", "face-close-up.png"),
]
CELL = 512
LABEL = 46


def font(size):
    for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def cover(path):
    image = Image.open(path).convert("RGB")
    scale = CELL / min(image.size)
    image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)
    left = (image.width - CELL) // 2
    top = (image.height - CELL) // 2
    return image.crop((left, top, left + CELL, top + CELL))


def main():
    os.makedirs(OUT, exist_ok=True)
    width = CELL * 3
    height = len(ROWS) * (CELL + LABEL) + LABEL
    sheet = Image.new("RGB", (width, height), (18, 18, 20))
    draw = ImageDraw.Draw(sheet)
    head = font(26)
    label = font(20)
    for column, title in enumerate(("PHOTOGRAPH (identity)", "MESHY LÉLU (owned)", "CC0 FOUNDRY (superseded)")):
        draw.text((column * CELL + 12, 10), title, fill=(236, 232, 228), font=head)
    missing = []
    for row, (name, photo, shot) in enumerate(ROWS):
        top = LABEL + row * (CELL + LABEL)
        for column, path in enumerate((os.path.join(PHOTO, photo), os.path.join(MESHY, shot), os.path.join(CC0, shot))):
            if not os.path.exists(path):
                missing.append(path)
                draw.rectangle([column * CELL, top, column * CELL + CELL, top + CELL], outline=(90, 40, 40))
                draw.text((column * CELL + 20, top + CELL // 2), "missing", fill=(220, 120, 120), font=label)
                continue
            sheet.paste(cover(path), (column * CELL, top))
        draw.text((12, top + CELL + 8), name, fill=(200, 196, 190), font=label)
    target = os.path.join(OUT, "AB-comparison.png")
    sheet.save(target)
    print(f"wrote {os.path.relpath(target, ROOT)} ({sheet.width}x{sheet.height})")
    for path in missing:
        print("MISSING", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
