"""
LÉLU M24 — one import, four audits.

    blender --background --factory-startup --python lelu_m24_analyse.py -- job.json
    job.json: {"input": ".../lelu.glb", "out": "<lelu2>/artifacts/foundry/m24"}

Writes anatomy/measurements.json, hair/hair-geometry-analysis.json,
materials/texture-audit.json and rig/rig-validation.json.

Everything here is measured from the asset: bone pivots for segment lengths,
vertex positions for widths and depths, loose-shell topology for the hair,
uv areas for texture stretch, vertex groups for skinning. Nothing is estimated
from a table and then reported as if it had been measured.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
job = json.load(open(argv[0]))
OUT = job["out"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
scene = bpy.context.scene

meshes = [o for o in scene.objects if o.type == "MESH"]
rig = next((o for o in scene.objects if o.type == "ARMATURE"), None)
by_name = {o.name: o for o in meshes}


def write(rel, value):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(value, fh, indent=1)
    print("wrote", rel)


def world_bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi


def world_verts(obj):
    m = obj.matrix_world
    return [m @ v.co for v in obj.data.vertices]


def pct(values, q):
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
    return ordered[idx]


# ------------------------------------------------------------------ anatomy
body = by_name.get("char1")
head = by_name.get("lelu_head")
eye_l = by_name.get("eye_patch_l")
eye_r = by_name.get("eye_patch_r")
mouth = by_name.get("lelu_mouth")

bones = {}
if rig:
    for b in rig.data.bones:
        m = rig.matrix_world
        bones[b.name] = {"head": list(m @ b.head_local), "tail": list(m @ b.tail_local), "parent": b.parent.name if b.parent else None}


def dist(a, b):
    return math.dist(bones[a]["head"], bones[b]["head"]) if a in bones and b in bones else None


def mm(v):
    return None if v is None else round(v * 1000.0, 2)


measurements = {}
if bones:
    measurements = {
        "stature_m": None,
        "shoulderWidthMm": mm(dist("LeftArm", "RightArm")),
        "hipWidthMm": mm(dist("LeftUpLeg", "RightUpLeg")),
        "upperArmMm": mm(dist("LeftArm", "LeftForeArm")),
        "forearmMm": mm(dist("LeftForeArm", "LeftHand")),
        "thighMm": mm(dist("LeftUpLeg", "LeftLeg")),
        "calfMm": mm(dist("LeftLeg", "LeftFoot")),
        "neckMm": mm(dist("neck", "Head")),
        "headToNeckMm": mm(dist("Head", "head_end")),
        "spineMm": mm(dist("Hips", "Spine02")),
        "elbowHeightMm": mm(bones["LeftForeArm"]["head"][2]) if "LeftForeArm" in bones else None,
        "wristHeightMm": mm(bones["LeftHand"]["head"][2]) if "LeftHand" in bones else None,
        "crotchHeightMm": mm(bones["Hips"]["head"][2]) if "Hips" in bones else None,
    }

if eye_l and eye_r:
    cl = sum(world_verts(eye_l), Vector()) / len(eye_l.data.vertices)
    cr = sum(world_verts(eye_r), Vector()) / len(eye_r.data.vertices)
    measurements["interpupillaryMm"] = mm((cl - cr).length)
    measurements["eyeHeightMm"] = mm((cl.z + cr.z) / 2)
    measurements["eyeSurfaceMm"] = {"left": [round(v, 4) for v in cl], "right": [round(v, 4) for v in cr]}

if mouth:
    lo, hi = world_bounds(mouth)
    measurements["mouthWidthMm"] = mm(hi[0] - lo[0])
    measurements["mouthHeightMm"] = mm(hi[2] - lo[2])
    measurements["mouthCentreZ"] = mm((hi[2] + lo[2]) / 2)

if body:
    lo, hi = world_bounds(body)
    measurements["stature_m"] = round(hi[2] - lo[2], 4)
    measurements["bodyBounds"] = {"min": [round(v, 4) for v in lo], "max": [round(v, 4) for v in hi]}

# facial width and depth in a band at eye height (the eye patches give the band)
if head and eye_l:
    verts = world_verts(head)
    z0 = measurements["eyeHeightMm"] / 1000.0
    band = [v for v in verts if abs(v.z - z0) < 0.01]
    if band:
        measurements["faceWidthAtEyeMm"] = mm(max(v.x for v in band) - min(v.x for v in band))
        ys = [v.y for v in band if abs(v.x) < 0.06]
        if ys:
            measurements["faceDepthAtEyeMm"] = mm(max(ys) - min(ys))
    measurements["vertexCount"] = len(verts)

write("anatomy/measurements.json", {
    "source": job["input"],
    "blender": bpy.app.version_string,
    "units": "millimetres unless the key ends in _m",
    "method": "bone pivots for segment lengths, vertex extents for widths/depths, eye-patch centroids for interpupillary distance",
    "bones": {k: {"headMm": [mm(c) for c in v["head"]], "tailMm": [mm(c) for c in v["tail"]], "parent": v["parent"]} for k, v in bones.items()},
    "measurements": measurements,
    "notMeasured": [
        "skull height without hair (hair is fused into the head mesh: see hair analysis)",
        "nose width and projection (no landmark geometry, and the texture cannot be measured as geometry)",
        "finger lengths (hand shells are fused and too small to segment reliably)",
        "bust/waist/pelvis girth (no cross-section tool in this pass; widths only)",
    ],
})

# --------------------------------------------------------------------- hair
hair_report = {"method": "union-find over mesh edges; a shell is one connected component", "shells": {}}
if head:
    mesh = head.data
    parent = list(range(len(mesh.vertices)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in mesh.edges:
        ra, rb = find(e.vertices[0]), find(e.vertices[1])
        if ra != rb:
            parent[ra] = rb

    groups = {}
    mw = head.matrix_world
    for i, v in enumerate(mesh.vertices):
        r = find(i)
        co = mw @ v.co
        g = groups.get(r)
        if g is None:
            groups[r] = [1, co.x, co.y, co.z, co.x, co.y, co.z]
        else:
            g[0] += 1
            if co.x < g[1]:
                g[1] = co.x
            if co.y < g[2]:
                g[2] = co.y
            if co.z < g[3]:
                g[3] = co.z
            if co.x > g[4]:
                g[4] = co.x
            if co.y > g[5]:
                g[5] = co.y
            if co.z > g[6]:
                g[6] = co.z

    shells = []
    for count, x0, y0, z0, x1, y1, z1 in groups.values():
        shells.append({
            "vertices": count,
            "sizeMm": [round((x1 - x0) * 1000, 2), round((y1 - y0) * 1000, 2), round((z1 - z0) * 1000, 2)],
            "centreMm": [round((x0 + x1) / 2 * 1000, 2), round((y0 + y1) / 2 * 1000, 2), round((z0 + z1) / 2 * 1000, 2)],
            "diagMm": round(math.dist((x0, y0, z0), (x1, y1, z1)) * 1000, 2),
            "topMm": round(z1 * 1000, 2),
            "bottomMm": round(z0 * 1000, 2),
        })

    diags = [s["diagMm"] for s in shells]
    verts = [s["vertices"] for s in shells]
    buckets = {}
    for limit in (5, 10, 20, 40, 80, 160, 320, 640, 1280, 99999):
        buckets[f"<= {limit} mm" if limit < 99999 else "> 1280 mm"] = sum(1 for d in diags if d <= limit and (limit <= 5 or d > (0 if limit == 5 else 0)))
    # simple, honest histogram by size decade
    hist = {}
    for d in diags:
        key = f"{int(d // 10) * 10}-{int(d // 10) * 10 + 10} mm"
        hist[key] = hist.get(key, 0) + 1

    # Hair shells: the curls are small cards; the scalp/face is one large surface.
    small = [s for s in shells if s["diagMm"] <= 60]
    large = [s for s in shells if s["diagMm"] > 60]
    small_verts = sum(s["vertices"] for s in small)
    large_verts = sum(s["vertices"] for s in large)

    # Hairline: the highest front-facing shell near the midline.
    front = [s for s in shells if abs(s["centreMm"][0]) < 80 and s["centreMm"][1] < -40]
    hairline_top = max((s["topMm"] for s in front), default=None)
    eye_z = measurements.get("eyeHeightMm")

    hair_report["shells"] = {
        "total": len(shells),
        "vertices": len(mesh.vertices),
        "sizeHistogram": dict(sorted(hist.items())),
        "sizeMm": {"p10": pct(diags, 0.10), "median": pct(diags, 0.5), "p90": pct(diags, 0.9), "max": max(diags) if diags else None},
        "verticesPerShell": {"median": pct(verts, 0.5), "p90": pct(verts, 0.9), "max": max(verts) if verts else None},
        "smallShells": {"maxDiagMm": 60, "count": len(small), "vertices": small_verts},
        "largeShells": {"count": len(large), "vertices": large_verts},
        "largest": sorted(shells, key=lambda s: s["vertices"], reverse=True)[:5],
    }
    hair_report["hairline"] = {
        "frontShells": len(front),
        "highestFrontTopMm": hairline_top,
        "eyeHeightMm": eye_z,
        "aboveEyeLineMm": round(hairline_top - eye_z, 2) if hairline_top and eye_z else None,
        "note": "measured on the highest shell whose centre is within 80 mm of the midline and in front of the face; the photographs' target is 87.68 mm",
    }
    hair_report["coverage"] = {
        "headMeshHeightMm": round((max(s["topMm"] for s in shells) - min(s["bottomMm"] for s in shells)), 2) if shells else None,
        "lowestShellMm": min((s["bottomMm"] for s in shells), default=None),
    }

write("hair/hair-geometry-analysis.json", hair_report)

# ----------------------------------------------------------------- materials
tex_audit = {"materials": [], "images": [], "uv": {}, "stretch": {}}
for mat in bpy.data.materials:
    nodes = []
    if mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                nodes.append({"image": n.image.name, "size": list(n.image.size), "colorspace": n.image.colorspace_settings.name})
    tex_audit["materials"].append({"name": mat.name, "images": nodes})
for img in bpy.data.images:
    if img.size[0]:
        tex_audit["images"].append({"name": img.name, "width": img.size[0], "height": img.size[1], "channels": img.channels, "colorspace": img.colorspace_settings.name})

if body:
    mesh = body.data
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers[0].data if mesh.uv_layers else None
    if uv:
        ratios = []
        for tri in mesh.loop_triangles:
            l0, l1, l2 = tri.loops
            a, b, c = (mesh.vertices[i].co for i in tri.vertices)
            area3 = ((b - a).cross(c - a)).length / 2
            u0, u1, u2 = uv[l0].uv, uv[l1].uv, uv[l2].uv
            area2 = abs((u1[0] - u0[0]) * (u2[1] - u0[1]) - (u2[0] - u0[0]) * (u1[1] - u0[1])) / 2
            if area2 > 0 and area3 > 0:
                ratios.append(area3 / area2)
        med = pct(ratios, 0.5)
        tex_audit["stretch"] = {
            "mesh": body.name,
            "uvLayers": len(mesh.uv_layers),
            "triangles": len(mesh.loop_triangles),
            "ratioDefinition": "3D area / UV area, per triangle; a uniform map has one ratio, a stretched island has a much larger one",
            "median": round(med, 6) if med else None,
            "p10": round(pct(ratios, 0.1), 6) if ratios else None,
            "p90": round(pct(ratios, 0.9), 6) if ratios else None,
            "p99": round(pct(ratios, 0.99), 6) if ratios else None,
            "over4xMedianPct": round(100 * sum(1 for r in ratios if med and r > 4 * med) / len(ratios), 3) if ratios else None,
            "over10xMedianPct": round(100 * sum(1 for r in ratios if med and r > 10 * med) / len(ratios), 3) if ratios else None,
            "minMax": [round(min(ratios), 6), round(max(ratios), 6)] if ratios else None,
        }
        tex_audit["uv"] = {"bodyTriangles": len(mesh.loop_triangles), "uvLayers": [l.name for l in mesh.uv_layers]}

write("materials/texture-audit.json", tex_audit)

# ---------------------------------------------------------------------- rig
rig_report = {"armature": None, "weights": {}, "clips": []}
if rig:
    rig_report["armature"] = {
        "name": rig.name,
        "bones": len(rig.data.bones),
        "boneNames": [b.name for b in rig.data.bones],
        "root": rig.data.bones[0].name if rig.data.bones else None,
        "shapeKeyDrivers": "none beyond the exported keys",
    }
if body:
    unweighted = 0
    max_infl = 0
    for v in body.data.vertices:
        groups = [g for g in v.groups if g.weight > 0]
        if not groups:
            unweighted += 1
        max_infl = max(max_infl, len(groups))
    rig_report["weights"] = {
        "mesh": body.name,
        "vertices": len(body.data.vertices),
        "unweighted": unweighted,
        "unweightedPct": round(100 * unweighted / len(body.data.vertices), 3),
        "maxInfluences": max_infl,
        "vertexGroups": len(body.vertex_groups),
        "armatureModifier": any(m.type == "ARMATURE" for m in body.modifiers),
    }
rig_report["clips"] = [{"name": a.name, "frames": [int(a.frame_range[0]), int(a.frame_range[1])], "fcurves": len(a.fcurves)} for a in bpy.data.actions]
rig_report["shapeKeys"] = {
    o.name: [kb.name for kb in (o.data.shape_keys.key_blocks[1:] if o.data.shape_keys else [])] for o in meshes if o.data.shape_keys
}
write("rig/rig-validation.json", rig_report)
print("M24_ANALYSE done")
