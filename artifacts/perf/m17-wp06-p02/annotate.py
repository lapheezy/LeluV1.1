"""Draw the projected box and the renderer's identity mask onto a capture.

The frame comes from `__cosmosObjectIdentity.capture()` — the renderer's own
buffer — and the rectangles come from `measurements.json`, recorded in the same
evaluation as the masks. Cyan is the projected box (the claim under test);
yellow is the identity mask (the pixels that disappeared when the object was
hidden, i.e. the renderer's own answer).
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
data = json.loads((EVIDENCE / "measurements.json").read_text())

SCALE = 0.5
for vp in data["viewports"]:
    name = vp.get("frame")
    if not name:
        continue
    frame = EVIDENCE / name
    if not frame.exists():
        continue
    img = Image.open(frame).convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for idx, obj in enumerate(vp["objects"]):
        colour = [(0, 255, 255, 255), (255, 0, 200, 255), (120, 255, 120, 255)][idx % 3]
        mask_colour = [(255, 230, 0, 255), (255, 140, 0, 255), (0, 200, 255, 255)][idx % 3]
        box = obj.get("projected")
        if box:
            l, t, r, b = [v * SCALE for v in box]
            draw.rectangle([l, t, r, b], outline=colour, width=2)
            draw.text((l + 2, max(0, t - 11)), f"{obj['id']} box", fill=colour)
        mask = obj.get("observed")
        if mask:
            l, t, r, b = [v * SCALE for v in mask]
            draw.rectangle([l, t, r, b], outline=mask_colour, width=1)
    out = EVIDENCE / f"annotated-{vp['size'][0]}x{vp['size'][1]}.png"
    Image.alpha_composite(img, overlay).convert("RGB").save(out)
    print(f"wrote {out.relative_to(ROOT)}")
