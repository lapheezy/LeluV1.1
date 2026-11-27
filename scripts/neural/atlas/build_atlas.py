import json, os, re, sys, hashlib
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, Table, TableStyle, PageBreak, KeepTogether
from xml.sax.saxutils import escape

W, OUT = sys.argv[1], sys.argv[2]  # work dir (untrusted downloads), output dir in the repo
check = json.load(open(os.path.join(W, "check.json")))
desc = {d["title"]: d["desc"] for d in json.load(open(os.path.join(W, "desc.json")))}
SECTION = lambda n: "V1 · Canonical Knowledge Map" if n <= 15 else "V2 · Cognitive Architecture Map" if n <= 31 else "V3 · Agent Society Map" if n <= 42 else "Shared Multiversal Navigation"

# Licences established by targeted checks (see README.md for how): only these permit redistribution.
PERMITTED = {
    8: {"license": "CC BY-SA 4.0", "evidence": "Repository jacomyma/mapping-controversies LICENSE: 'Attribution-ShareAlike 4.0 International'. Image served from that repository's GitHub Pages site.", "credit": "Mathieu Jacomy, Mapping Controversies (jacomyma.github.io/mapping-controversies), CC BY-SA 4.0"},
    41: {"license": "Apache-2.0", "evidence": "Image is docs/snapshot01.png in cognizant-ai-lab/nsflow; that repository's LICENSE.txt is the Apache License 2.0.", "credit": "Cognizant AI Lab, nsflow (github.com/cognizant-ai-lab/nsflow), Apache-2.0"},
    46: {"license": "CC BY 4.0", "evidence": "NOIRLab usage policy (noirlab.edu/public/copyright): images 'licensed under a Creative Commons Attribution 4.0 International License'. Credit line on the image page.", "credit": "DESI Collaboration/NOIRLab/NSF/AURA/R. Proctor, CC BY 4.0"},
}
INFORMS = {
    1: "V1 Force-Directed + node inspector", 2: "shared layout selector (Force/Tree/Radial)", 3: "3D navigation, relationship filters", 4: "cluster colouring, edge styling",
    5: "graph settings panel, labels", 6: "dense mesh: Core Orbit 'unconnected' ring", 7: "in-world detail inspector", 8: "ForceAtlas2-style communities in Force-Directed Universe",
    9: "Temporal River, snapshot timeline", 10: "dark topology + metadata side panel", 11: "Nested Universes (spatial clusters)", 12: "Infinite Canvas with contextual panel",
    13: "Infinite Canvas mixed media", 14: "Infinite Canvas cards in columns", 15: "Radial Constellation",
    16: "V2 Connectome Tractography (tubes)", 17: "V2 Neural Sphere density", 18: "V2 Anatomical Core nodes on surface", 19: "multi-view comparison (saved views)",
    20: "Tractography colour by function", 21: "Multiscale (projection per subsystem)", 22: "Anatomical Core region colouring", 23: "multi-panel atlas + overlays",
    24: "tract endpoints, orientation controls", 25: "Connectome: coloured regions + bundles", 26: "Tractography streamline density", 27: "Multiscale: file-level particles",
    28: "Exploded Layers (cortical layers)", 29: "region overlays + pathways", 30: "synchronized views", 31: "structural density reference",
    32: "V3 agent panels with status", 33: "agent cards + workflow states", 34: "Usage monitor: roster, activity, model usage", 35: "fleet health / session control",
    36: "topology builder + governance sidebar (Development panel)", 37: "dense multi-agent topology", 38: "incidents, error rates (alerts)", 39: "agent topology + model telemetry",
    40: "decision queue + safety checks (owner decisions)", 41: "agent graph + chat workspace (Agent Workspace)", 42: "streaming console + telemetry",
    43: "navigable star field, object search", 44: "scale-aware navigation", 45: "Galactic Spiral / large-scale structure", 46: "Holographic Spatial depth encoding",
    47: "object inspector + time controls", 48: "Topographic Field (voids/filaments)", 49: "Neural Universe filament clusters", 50: "Temporal River across cosmic time",
}

def reason(r):
    n = r["n"]
    if n in PERMITTED: return None
    bits = []
    if not r["sourceStatus"] or r["sourceStatus"] >= 400: bits.append(f"source page unreachable ({r.get('sourceError') or r['sourceStatus']})")
    if r["imageStatus"] != 200: bits.append(f"original image not retrievable ({r.get('imageError') or r['imageStatus']})")
    elif not r["imageType"].startswith("image/"): bits.append(f"image URL returns {r['imageType'].split(';')[0]}, not an image")
    if n == 44: bits.append("the APOD URL now serves a different day's picture, so it no longer corresponds to the named illustration")
    if n == 23: bits.append("image is served from an EBRAINS data bucket, not the Apache-2.0 repository; no licence for the bucket was found")
    if n == 25: bits.append("Europe PMC reports no licence for the MRtrix3 paper; reuse of the figure is not confirmed")
    kinds = {e["kind"] for e in r["licenseEvidence"]}
    if "all-rights-reserved" in kinds: bits.append("page states 'All rights reserved'")
    elif "copyright" in kinds: bits.append("page carries a copyright notice and no reuse licence")
    elif r["sourceStatus"] == 200 and n not in (23, 25): bits.append("no reuse licence found on the source page")
    return "; ".join(bits) or "no reuse licence found"

os.makedirs(os.path.join(OUT, "images"), exist_ok=True)
register = []
for r in check:
    n = r["n"]
    entry = {
        "n": n, "section": SECTION(n), "title": r["title"], "description": desc.get(r["title"], ""), "informs": INFORMS.get(n, ""),
        "source": r["source"], "sourceHttp": r["sourceStatus"], "image": r["image"], "imageHttp": r["imageStatus"], "imageType": r["imageType"].split(";")[0],
        "imageBytes": r["imageBytes"], "imageSha256": r["imageSha256"], "imageReferencedBySource": r["imageReferencedBySource"],
        "licenseEvidenceFound": [e["kind"] + ": " + e["context"] for e in r["licenseEvidence"] if "fontawesome" not in e["context"].lower()],
    }
    if n in PERMITTED:
        p = PERMITTED[n]
        src = os.path.join(W, r["file"])
        im = Image.open(src).convert("RGB")
        im.thumbnail((1600, 1600))
        dst = os.path.join(OUT, "images", f"{n:02d}.jpg")
        im.save(dst, "JPEG", quality=85)
        entry.update({"status": "embedded", "license": p["license"], "licenseEvidence": p["evidence"], "credit": p["credit"], "file": f"images/{n:02d}.jpg", "modification": f"resized to {im.width}×{im.height} and re-encoded as JPEG", "embeddedSha256": hashlib.sha256(open(dst, 'rb').read()).hexdigest()})
    else:
        entry.update({"status": "view-only", "license": "not established", "why": reason(r)})
    register.append(entry)
json.dump(register, open(os.path.join(OUT, "register.json"), "w"), indent=1, ensure_ascii=False)

# ---------------- PDF
ss = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=20, spaceAfter=6)
H2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=colors.HexColor("#1757ac"), spaceBefore=10)
B = ParagraphStyle("b", parent=ss["BodyText"], fontSize=8.6, leading=11)
S = ParagraphStyle("s", parent=B, fontSize=7.4, leading=9.4, textColor=colors.HexColor("#334155"))
T = ParagraphStyle("t", parent=B, fontSize=10, leading=12.5, fontName="Helvetica-Bold")
link = lambda u: f'<link href="{escape(u)}" color="#1757ac">{escape(u if len(u) < 95 else u[:92] + "…")}</link>'
story = [Paragraph("LÉLU Neural Map — 50-reference visual atlas (verified)", H1),
         Paragraph(f"Built from the 50 references in the handoff brief. Every source page and original image URL was requested on 2026-11-27 and the result is recorded below. "
                   f"<b>{sum(e['status']=='embedded' for e in register)}</b> images carry a licence that permits redistribution and are <b>embedded</b> with attribution. "
                   f"<b>{sum(e['status']=='view-only' for e in register)}</b> are <b>view-only</b>: open them at the source; no generated or placeholder image stands in for them.", B), Spacer(1, 4),
         Paragraph("How licences were established: a reuse licence counts only when the publisher states it for that image (an image page's credit plus the publisher's licence policy, or the LICENSE of the repository that holds the file). Copyright notices, 'All rights reserved', and pages with no licence are view-only. Font/icon licences embedded in page CSS (e.g. Font Awesome) were discarded as false positives.", S), Spacer(1, 6)]
rows = [["#", "Reference", "Source", "Image", "Status"]] + [[str(e["n"]), Paragraph(escape(e["title"]), S), str(e["sourceHttp"] or "—"), f"{e['imageHttp'] or '—'} {e['imageType'].replace('image/','')}", e["status"] + (f" · {e['license']}" if e["status"] == "embedded" else "")] for e in register]
tab = Table(rows, colWidths=[8*mm, 78*mm, 16*mm, 26*mm, 46*mm], repeatRows=1)
tab.setStyle(TableStyle([("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8), ("FONT", (0, 1), (-1, -1), "Helvetica", 7.4), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]
                        + [("BACKGROUND", (4, i + 1), (4, i + 1), colors.HexColor("#dcfce7")) for i, e in enumerate(register) if e["status"] == "embedded"]))
story += [tab, PageBreak()]
section = None
for e in register:
    if e["section"] != section:
        section = e["section"]
        story.append(Paragraph(escape(section), H2))
    block = [Paragraph(f"{e['n']:02d}. {escape(e['title'])}", T)]
    if e["description"]: block.append(Paragraph(escape(e["description"]), B))
    block.append(Paragraph(f"<b>Informs:</b> {escape(e['informs'])}", B))
    block.append(Paragraph(f"<b>Source</b> ({e['sourceHttp'] or 'unreachable'}): {link(e['source'])}", S))
    block.append(Paragraph(f"<b>Original image</b> ({e['imageHttp'] or 'unreachable'}, {e['imageType'] or '—'}, {e['imageBytes']:,} bytes{', referenced by the source page' if e['imageReferencedBySource'] else ', not found in the source page HTML'}): {link(e['image'])}", S))
    if e["status"] == "embedded":
        img = RLImage(os.path.join(OUT, e["file"]))
        ratio = img.imageHeight / img.imageWidth
        img.drawWidth = 170 * mm
        img.drawHeight = min(110 * mm, 170 * mm * ratio)
        img.drawWidth = img.drawHeight / ratio
        block += [Spacer(1, 3), img, Paragraph(f"<b>Credit:</b> {escape(e['credit'])} · <b>Licence:</b> {escape(e['license'])} · {escape(e['modification'])}.", S), Paragraph(f"<b>Licence evidence:</b> {escape(e['licenseEvidence'])}", S)]
    else:
        block.append(Paragraph(f"<font color='#b45309'><b>VIEW-ONLY</b></font> — {escape(e['why'])}. Open the original at the source; separate permission is needed to reproduce it.", S))
    block.append(Spacer(1, 7))
    story.append(KeepTogether(block))
doc = SimpleDocTemplate(os.path.join(OUT, "LELU_NEURAL_MAP_50_REFERENCE_ATLAS_VERIFIED.pdf"), pagesize=A4, leftMargin=14*mm, rightMargin=14*mm, topMargin=14*mm, bottomMargin=14*mm, title="LÉLU Neural Map — 50-reference visual atlas (verified)")
doc.build(story)
print("embedded", [e["n"] for e in register if e["status"] == "embedded"], "view-only", sum(e["status"] == "view-only" for e in register))
