"""Draw the projected boxes recorded in measurements.json onto the saved screenshots.

The boxes are the numbers the projection contract reported, in viewport CSS px.
Drawing them onto the capture is the pixel-space cross-check: if a box does not
land on its chair, it is visible here without any colour detector involved.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
data = json.loads((EVIDENCE / "measurements.json").read_text())

for vp in data["viewports"]:
    src = ROOT / vp["screenshot"]
    img = Image.open(src).convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for idx, (oid, obj) in enumerate(vp["objects"].items()):
        if not obj.get("bounds"):
            continue
        l, t, r, b = obj["bounds"]
        colour = [(0, 255, 255, 235), (255, 0, 200, 235), (255, 230, 0, 235)][idx % 3]
        draw.rectangle([l, t, r, b], outline=colour, width=2)
        cx, cy = obj["center"]
        draw.line([cx - 6, cy, cx + 6, cy], fill=colour, width=2)
        draw.line([cx, cy - 6, cx, cy + 6], fill=colour, width=2)
        label = f"{oid} ({cx},{cy})"
        tw = draw.textlength(label)
        draw.rectangle([l, max(0, t - 12), l + tw + 4, max(0, t - 12) + 11], fill=(0, 0, 0, 190))
        draw.text((l + 2, max(0, t - 12)), label, fill=colour)
    out = EVIDENCE / f"annotated-{vp['size'][0]}x{vp['size'][1]}.png"
    Image.alpha_composite(img, overlay).convert("RGB").save(out)
    print(f"wrote {out.relative_to(ROOT)}")
