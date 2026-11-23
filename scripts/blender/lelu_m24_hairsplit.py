"""
LÉLU M24 — split the hair from the head without touching a single vertex.

    blender --background --factory-startup --python lelu_m24_hairsplit.py -- job.json
    job: {"input": ".../lelu.glb", "out": ".../lelu-m24-hair-split.glb", "report": ".../hair/hair-split.json"}

Why by albedo: the head mesh is unwelded triangle soup (86,228 "shells", median 3
vertices), so connectivity says nothing about hair. What distinguishes hair from
skin is the base-colour texture at each triangle's UV — black/burgundy versus
deep brown skin. This script samples that texture per triangle, splits the head
into `lelu_hair` and `lelu_scalp`, and exports both with the original armature,
materials, UVs and shape keys. No vertex is moved, welded, smoothed or
retopologised: the union of the two objects is the original surface, triangle for
triangle, which is what makes the appearance check meaningful.
"""
import json
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
job = json.load(open(argv[0]))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
scene = bpy.context.scene
for obj in scene.objects:
    if obj.type == "ARMATURE":
        obj.data.pose_position = "REST"
    if obj.animation_data:
        obj.animation_data_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)

head = bpy.data.objects.get("lelu_head")
if head is None:
    raise SystemExit("lelu_head not found")

mesh = head.data
mat = head.material_slots[0].material
image = None
for node in mat.node_tree.nodes:
    if node.type == "TEX_IMAGE" and node.image and "Base" not in node.name:
        image = node.image
for node in mat.node_tree.nodes:
    if node.type == "BSDF_PRINCIPLED":
        base = node.inputs.get("Base Color")
        if base and base.is_linked:
            src = base.links[0].from_node
            if src.type == "TEX_IMAGE" and src.image:
                image = src.image
if image is None:
    raise SystemExit("no base-colour image on the head material")

width, height = image.size
pixels = list(image.pixels)  # RGBA floats, bottom-up
print("TEXTURE", image.name, width, height, "channels", image.channels)


def sample(u, v):
    x = min(width - 1, max(0, int(u * width)))
    y = min(height - 1, max(0, int(v * height)))
    i = (y * width + x) * 4
    return pixels[i], pixels[i + 1], pixels[i + 2]


uv_layer = mesh.uv_layers.active.data
lums = []
tri_uv = []
for poly in mesh.polygons:
    u = v = 0.0
    for li in poly.loop_indices:
        u += uv_layer[li].uv[0]
        v += uv_layer[li].uv[1]
    u /= poly.loop_total
    v /= poly.loop_total
    r, g, b = sample(u, v)
    lums.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
    tri_uv.append((r, g, b))

# Two-means on luminance: hair is the dark cluster, skin the lighter one. The
# split point is derived from this texture, not chosen by hand.
lo, hi = min(lums), max(lums)
cut = (lo + hi) / 2
for _ in range(24):
    dark = [l for l in lums if l <= cut]
    light = [l for l in lums if l > cut]
    if not dark or not light:
        break
    cut = (sum(dark) / len(dark) + sum(light) / len(light)) / 2

hair_polys = [p.index for p in mesh.polygons if lums[p.index] <= cut]
scalp_polys = [p.index for p in mesh.polygons if lums[p.index] > cut]
print("SPLIT cut", round(cut, 4), "hair tris", len(hair_polys), "scalp tris", len(scalp_polys))

# Area of each side, so the report can say how much surface is hair.
mw = head.matrix_world


def world(poly, index):
    return mw @ mesh.vertices[poly.vertices[index]].co


def area_of(indices):
    """World-space area: the object carries a 0.01 scale, so local coords are cm."""
    total = 0.0
    for i in indices:
        poly = mesh.polygons[i]
        a, b, c = world(poly, 0), world(poly, 1), world(poly, 2)
        total += ((b - a).cross(c - a)).length / 2
    return total


hair_area = area_of(hair_polys)
scalp_area = area_of(scalp_polys)

# Hairline: lowest hair triangle in the forehead band, in metres above the eyes.
eye_z = 1.59285
band = []
for i in hair_polys:
    poly = mesh.polygons[i]
    pts = [mw @ mesh.vertices[v].co for v in poly.vertices]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    if abs(sum(xs) / 3) < 0.06 and sum(ys) / 3 < -0.05:
        band.append(min(zs))
hairline_mm = round((min(band) - eye_z) * 1000, 2) if band else None
hair_top_mm = round(max((mw @ mesh.vertices[v].co).z for i in hair_polys for v in mesh.polygons[i].vertices) * 1000, 2)

# Separate: select scalp polygons and split them off, leaving hair as the head.
bpy.context.view_layer.objects.active = head
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")
for i in scalp_polys:
    mesh.polygons[i].select = True
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")

new_objects = [o for o in scene.objects if o.type == "MESH" and o.name.startswith("lelu_head.")]
scalp = new_objects[0] if new_objects else None
if scalp is not None:
    scalp.name = "lelu_scalp"
    head.name = "lelu_hair"

scene.frame_set(0)
report = {
    "input": job["input"],
    "output": job["out"],
    "method": "per-triangle base-colour sampling at the UV centroid; two-means luminance split; mesh.separate(SELECTED). No vertex moved.",
    "textureSource": {"image": image.name, "width": width, "height": height},
    "luminanceCut": round(cut, 5),
    "renderedClassification": {
        "hairTriangles": len(hair_polys),
        "scalpTriangles": len(scalp_polys),
        "hairAreaMm2": round(hair_area * 1e6, 1),
        "scalpAreaMm2": round(scalp_area * 1e6, 1),
        "hairShareOfSurface": round(100 * hair_area / (hair_area + scalp_area), 2),
    },
    "hairline": {
        "foreheadBandDefinition": "hair triangles with |x| < 60 mm and y < -50 mm",
        "lowestHairMm": round(min(band) * 1000, 2) if band else None,
        "aboveEyeLineMm": hairline_mm,
        "photographTargetMm": 87.68,
        "highestHairMm": hair_top_mm,
    },
    "objects": [{"name": o.name, "triangles": len(o.data.polygons), "vertexGroups": len(o.vertex_groups),
                 "shapeKeys": [kb.name for kb in (o.data.shape_keys.key_blocks[1:] if o.data.shape_keys else [])]} for o in scene.objects if o.type == "MESH"],
}

os.makedirs(os.path.dirname(job["report"]), exist_ok=True)
with open(job["report"], "w") as fh:
    json.dump(report, fh, indent=1)

bpy.ops.export_scene.gltf(filepath=job["out"], export_format="GLB", export_apply=False, export_morph=True,
                          export_animations=False, export_skins=True, use_selection=False)
print("M24_HAIRSPLIT " + json.dumps({"cut": round(cut, 4), "hairTris": len(hair_polys), "scalpTris": len(scalp_polys), "hairlineMm": hairline_mm}))
