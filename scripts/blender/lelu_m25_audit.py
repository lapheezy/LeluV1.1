"""
LÉLU M25 — geometry, normal and material audit of one GLB.

    blender -b --factory-startup --python lelu_m25_audit.py -- job.json
    job: {"input": ".../model.glb", "out": ".../audit.json", "label": "v0004"}

Measures, per mesh object, the things that decide whether a visible triangle is
geometry or shading:

* topology: vertices, triangles, unique positions (is it welded?), degenerate and
  sliver triangles, duplicate faces, open/non-manifold edges and winding
  consistency on the position-welded graph (computed, never applied);
* normals: whether the exported loop normals equal the face normals (flat
  shading), and the normal spread at coincident positions (the discontinuity a
  renderer draws as a hard crease);
* geometry: the dihedral angle between position-adjacent triangles — a
  distribution that says whether the surface itself is crumpled;
* materials: which Principled inputs are textured, the metallic and roughness
  statistics the textures actually carry, blend mode, image sizes;
* per-region albedo classes on char1 (hair-dark / skin / other) so a defect can
  be pinned to a region of a fused mesh.

Nothing is modified. Numbers are written exactly as measured.
"""
import json
import math
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
job = json.load(open(argv[0]))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
scene = bpy.context.scene
for o in scene.objects:
    if o.type == "ARMATURE":
        o.data.pose_position = "REST"


def pct(a, qs=(1, 10, 50, 90, 99)):
    a = np.asarray(a, dtype=np.float64)
    if a.size == 0:
        return None
    return {f"p{q}": round(float(np.percentile(a, q)), 5) for q in qs}


def mesh_arrays(obj):
    me = obj.data
    me.calc_loop_triangles()
    nv = len(me.vertices)
    co = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    m = np.array(obj.matrix_world, dtype=np.float64)
    co = co @ m[:3, :3].T + m[:3, 3]
    nt = len(me.loop_triangles)
    tv = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", tv)
    tl = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("loops", tl)
    tp = np.empty(nt, np.int32)
    me.loop_triangles.foreach_get("polygon_index", tp)
    nl = len(me.loops)
    ln = np.empty(nl * 3, np.float32)
    me.loops.foreach_get("normal", ln)
    ln = ln.reshape(-1, 3).astype(np.float64)
    ln = ln @ m[:3, :3].T
    ln /= np.maximum(np.linalg.norm(ln, axis=1, keepdims=True), 1e-12)
    mat_idx = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("material_index", mat_idx)
    uv = None
    if me.uv_layers.active:
        uvd = np.empty(nl * 2, np.float32)
        me.uv_layers.active.data.foreach_get("uv", uvd)
        uv = uvd.reshape(-1, 2).astype(np.float64)
    return co, tv.reshape(-1, 3), tl.reshape(-1, 3), tp, ln, mat_idx, uv


def weld_ids(co, tol=1e-6):
    q = np.round(co / tol).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    return inv.reshape(-1)


def base_image(mat, socket_name):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            s = n.inputs.get(socket_name)
            if s is None or not s.is_linked:
                return None
            node = s.links[0].from_node
            # follow separate-colour / normal-map nodes back to the image
            for _ in range(4):
                if node.type == "TEX_IMAGE":
                    return node
                ins = [i for i in node.inputs if i.is_linked]
                if not ins:
                    return None
                node = ins[0].links[0].from_node
    return None


image_cache = {}


def image_array(img):
    if img.name in image_cache:
        return image_cache[img.name]
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    arr = px.reshape(h, w, 4)
    image_cache[img.name] = arr
    return arr


def sample(arr, uv):
    h, w = arr.shape[:2]
    x = np.clip((uv[:, 0] % 1.0) * w, 0, w - 1).astype(np.int64)
    y = np.clip((uv[:, 1] % 1.0) * h, 0, h - 1).astype(np.int64)
    return arr[y, x]


def principled(mat):
    if not mat or not mat.use_nodes:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def describe_material(mat):
    node = principled(mat)
    if node is None:
        return {"name": mat.name if mat else None, "principled": False}
    d = {"name": mat.name, "principled": True, "blend_method": getattr(mat, "blend_method", None),
         "surface_render_method": getattr(mat, "surface_render_method", None), "inputs": {}}
    for name in ("Base Color", "Metallic", "Roughness", "Normal", "Alpha", "Specular IOR Level", "Emission Color"):
        s = node.inputs.get(name)
        if s is None:
            continue
        if s.is_linked:
            img = base_image(mat, name)
            d["inputs"][name] = {"linked": True, "image": img.image.name if img and img.image else None,
                                 "size": list(img.image.size) if img and img.image else None,
                                 "colorspace": img.image.colorspace_settings.name if img and img.image else None,
                                 "interpolation": img.interpolation if img else None}
        else:
            v = s.default_value
            try:
                v = [round(float(x), 4) for x in v]
            except TypeError:
                v = round(float(v), 4)
            d["inputs"][name] = {"linked": False, "value": v}
    return d


def tri_metrics(co, tv):
    a, b, c = co[tv[:, 0]], co[tv[:, 1]], co[tv[:, 2]]
    cr = np.cross(b - a, c - a)
    area = np.linalg.norm(cr, axis=1) / 2
    fn = cr / np.maximum(2 * area[:, None], 1e-20)

    def ang(p, q, r):
        u, v = q - p, r - p
        cosv = np.sum(u * v, 1) / np.maximum(np.linalg.norm(u, axis=1) * np.linalg.norm(v, axis=1), 1e-20)
        return np.degrees(np.arccos(np.clip(cosv, -1, 1)))

    min_ang = np.minimum(np.minimum(ang(a, b, c), ang(b, c, a)), ang(c, a, b))
    e = np.stack([np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1), np.linalg.norm(a - c, axis=1)], 1)
    return area, fn, min_ang, e


def edge_graph(wid_t):
    """Edges on the position-welded triangle graph; returns (edges, tri, orientation sign)."""
    e = np.concatenate([wid_t[:, [0, 1]], wid_t[:, [1, 2]], wid_t[:, [2, 0]]], 0)
    tri = np.concatenate([np.arange(len(wid_t))] * 3)
    sign = np.where(e[:, 0] < e[:, 1], 1, -1)
    key = np.sort(e, 1)
    return key, tri, sign


report = {"input": job["input"], "label": job.get("label"), "sha256": None, "objects": []}
import hashlib
report["sha256"] = hashlib.sha256(open(job["input"], "rb").read()).hexdigest()

for obj in sorted([o for o in scene.objects if o.type == "MESH"], key=lambda o: o.name):
    co, tv, tl, tp, ln, mat_idx, uv = mesh_arrays(obj)
    nt = len(tv)
    area, fn, min_ang, edges = tri_metrics(co, tv)
    wid = weld_ids(co, 1e-6)
    wid_t = wid[tv]
    degenerate = int(np.sum(area < 1e-12)) + int(np.sum((wid_t[:, 0] == wid_t[:, 1]) | (wid_t[:, 1] == wid_t[:, 2]) | (wid_t[:, 0] == wid_t[:, 2])) - np.sum(area < 1e-12) * 0)
    collapsed = int(np.sum((wid_t[:, 0] == wid_t[:, 1]) | (wid_t[:, 1] == wid_t[:, 2]) | (wid_t[:, 0] == wid_t[:, 2])))
    zero_area = int(np.sum(area < 1e-12))
    slivers = int(np.sum(min_ang < 1.0))
    sorted_face = np.sort(wid_t, 1)
    _, counts = np.unique(sorted_face, axis=0, return_counts=True)
    duplicate_faces = int(np.sum(counts[counts > 1] - 1))

    # flat shading: loop normal vs face normal
    lnt = ln[tl]  # (nt,3,3)
    dev = np.degrees(np.arccos(np.clip(np.einsum("tij,tj->ti", lnt, fn), -1, 1)))
    flat_tris = int(np.sum(np.all(dev < 0.5, axis=1)))
    inverted = int(np.sum(np.all(dev > 90, axis=1)))

    # normal spread at coincident positions
    loop_wid = np.empty(len(ln), np.int64)
    loop_wid[tl.reshape(-1)] = wid_t.reshape(-1)
    order = np.argsort(loop_wid, kind="stable")
    lw_sorted = loop_wid[order]
    starts = np.r_[0, np.nonzero(np.diff(lw_sorted))[0] + 1]
    mean_n = np.add.reduceat(ln[order], starts, axis=0)
    cnt = np.diff(np.r_[starts, len(order)])
    mean_n /= np.maximum(np.linalg.norm(mean_n, axis=1, keepdims=True), 1e-12)
    group_of_loop = np.repeat(np.arange(len(starts)), cnt)
    spread = np.degrees(np.arccos(np.clip(np.sum(ln[order] * mean_n[group_of_loop], 1), -1, 1)))
    max_spread = np.maximum.reduceat(spread, starts)
    multi = cnt > 1
    shared_positions = int(np.sum(multi))
    hard_positions = int(np.sum(max_spread[multi] > 30))

    # welded edges: manifoldness, winding, dihedral
    key, tri, sign = edge_graph(wid_t)
    good = key[:, 0] != key[:, 1]
    key, tri, sign = key[good], tri[good], sign[good]
    k64 = key[:, 0].astype(np.int64) * (int(wid.max()) + 1) + key[:, 1]
    o = np.argsort(k64, kind="stable")
    k64s, tris, signs = k64[o], tri[o], sign[o]
    st = np.r_[0, np.nonzero(np.diff(k64s))[0] + 1]
    ec = np.diff(np.r_[st, len(k64s)])
    boundary = int(np.sum(ec == 1))
    manifold = int(np.sum(ec == 2))
    nonmanifold = int(np.sum(ec > 2))
    two = st[ec == 2]
    t1, t2 = tris[two], tris[two + 1]
    inconsistent = int(np.sum(signs[two] == signs[two + 1]))
    dih = np.degrees(np.arccos(np.clip(np.sum(fn[t1] * fn[t2], 1), -1, 1)))
    # unsigned bend between adjacent faces; winding-inconsistent pairs flipped
    dih = np.where(signs[two] == signs[two + 1], 180 - dih, dih)

    # connected components on welded graph (union-find over manifold+nonmanifold pairs)
    parent = np.arange(nt)

    def find(x):
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    pairs_a = tris[st[ec >= 2]]
    pairs_b = tris[st[ec >= 2] + 1]
    for a_, b_ in zip(pairs_a.tolist(), pairs_b.tolist()):
        ra, rb = find(a_), find(b_)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in range(nt)])
    _, comp_sizes = np.unique(roots, return_counts=True)

    entry = {
        "name": obj.name,
        "vertices": int(len(co)),
        "triangles": int(nt),
        "uniquePositions": int(wid.max() + 1),
        "weldRatio": round(float(len(co) / (wid.max() + 1)), 3),
        "isTriangleSoup": bool(len(co) >= 2.5 * nt),
        "surfaceAreaM2": round(float(area.sum()), 5),
        "edgeLengthMm": pct(edges.reshape(-1) * 1000),
        "degenerate": {"zeroArea": zero_area, "collapsedAfterWeld": collapsed, "sliverMinAngleBelow1deg": slivers,
                       "minAngleDeg": pct(min_ang)},
        "duplicateFaces": duplicate_faces,
        "normals": {
            "flatShadedTriangles": flat_tris,
            "flatShadedShare": round(flat_tris / max(nt, 1), 4),
            "invertedLoopNormals": inverted,
            "loopVsFaceDeviationDeg": pct(dev.reshape(-1)),
            "sharedPositions": shared_positions,
            "positionsWithNormalSpreadOver30deg": hard_positions,
            "hardShareOfShared": round(hard_positions / max(shared_positions, 1), 4),
            "hasCustomNormals": bool(obj.data.has_custom_normals),
        },
        "weldedGraph": {
            "boundaryEdges": boundary, "manifoldEdges": manifold, "nonManifoldEdges": nonmanifold,
            "windingInconsistentEdges": inconsistent,
            "dihedralDeg": pct(dih),
            "dihedralOver60Share": round(float(np.mean(dih > 60)) if dih.size else 0.0, 4),
            "components": int(len(comp_sizes)),
            "componentTriangles": pct(comp_sizes),
            "largestComponent": int(comp_sizes.max()),
        },
        "materials": [describe_material(s.material) for s in obj.material_slots],
        "shapeKeys": [kb.name for kb in obj.data.shape_keys.key_blocks] if obj.data.shape_keys else [],
        "vertexGroups": len(obj.vertex_groups),
        "bounds": {"min": [round(float(x), 4) for x in co.min(0)], "max": [round(float(x), 4) for x in co.max(0)]},
    }

    # texture statistics at triangle centroids
    if uv is not None and obj.material_slots:
        mat = obj.material_slots[0].material
        cuv = uv[tl].mean(1)
        for socket, key_ in (("Base Color", "albedo"), ("Metallic", "metallic"), ("Roughness", "roughness")):
            node = base_image(mat, socket)
            if node and node.image:
                arr = image_array(node.image)
                s = sample(arr, cuv)
                if key_ == "albedo":
                    lum = 0.2126 * s[:, 0] + 0.7152 * s[:, 1] + 0.0722 * s[:, 2]
                    entry.setdefault("textureStats", {})["albedoLuminance"] = pct(lum)
                    entry["textureStats"]["albedoMeanRGB"] = [round(float(x), 4) for x in s[:, :3].mean(0)]
                    entry["_lum"] = lum
                else:
                    # glTF packs roughness in G and metallic in B of one image
                    ch = 2 if key_ == "metallic" else 1
                    entry.setdefault("textureStats", {})[key_] = pct(s[:, ch])
                    entry["textureStats"][key_ + "Mean"] = round(float(s[:, ch].mean()), 4)
                    entry["_" + key_] = s[:, ch]

    # regional breakdown for the fused body
    if obj.name == "char1" and "_lum" in entry:
        lum = entry["_lum"]
        cen = co[tv].mean(1)
        z, x = cen[:, 2], cen[:, 0]
        regions = {
            "shoulders": (z > 1.30) & (z < 1.47) & (np.abs(x) > 0.08),
            "upperChest": (z > 1.22) & (z < 1.40) & (np.abs(x) <= 0.12) & (cen[:, 1] < 0),
            "neck": (z >= 1.40) & (z < 1.50) & (np.abs(x) < 0.08),
            "upperBack": (z > 1.20) & (z < 1.47) & (cen[:, 1] > 0.02),
            "arms": (np.abs(x) > 0.2) & (z > 0.95) & (z < 1.40),
        }
        dark = lum < 0.12
        tri_dih = np.zeros(nt)
        cnt_dih = np.zeros(nt)
        np.add.at(tri_dih, t1, dih)
        np.add.at(tri_dih, t2, dih)
        np.add.at(cnt_dih, t1, 1)
        np.add.at(cnt_dih, t2, 1)
        mean_dih = np.where(cnt_dih > 0, tri_dih / np.maximum(cnt_dih, 1), np.nan)
        reg = {}
        for name, mask in regions.items():
            md = mean_dih[mask]
            md = md[~np.isnan(md)]
            reg[name] = {
                "triangles": int(mask.sum()),
                "hairDarkAlbedoShare": round(float(dark[mask].mean()) if mask.any() else 0, 4),
                "meanEdgeMm": round(float(edges[mask].mean() * 1000) if mask.any() else 0, 3),
                "triangleMeanDihedralDeg": pct(md) if md.size else None,
                "dihedralOver45Share": round(float(np.mean(md > 45)) if md.size else 0, 4),
                "flatShadedShare": round(float(np.mean(np.all(dev[mask] < 0.5, axis=1))) if mask.any() else 0, 4),
                "metallicMean": round(float(entry["_metallic"][mask].mean()), 4) if "_metallic" in entry and mask.any() else None,
                "roughnessMean": round(float(entry["_roughness"][mask].mean()), 4) if "_roughness" in entry and mask.any() else None,
            }
        entry["regions"] = reg
        dmask = dark
        entry["darkAlbedoTriangles"] = {"count": int(dmask.sum()), "share": round(float(dmask.mean()), 4),
                                         "zRange": pct(cen[dmask, 2]) if dmask.any() else None}
    if obj.name == "lelu_hair" and "_metallic" in entry:
        entry["hairMetallicShareAbove0.5"] = round(float(np.mean(entry["_metallic"] > 0.5)), 4)
    for k in [k for k in entry if k.startswith("_")]:
        del entry[k]
    report["objects"].append(entry)
    print("AUDIT", obj.name, nt, "flat", entry["normals"]["flatShadedShare"], "dih>60", entry["weldedGraph"]["dihedralOver60Share"])

report["images"] = [{"name": i.name, "size": list(i.size), "colorspace": i.colorspace_settings.name,
                     "alphaMode": i.alpha_mode} for i in bpy.data.images if i.size[0] > 0]
os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
with open(job["out"], "w") as fh:
    json.dump(report, fh, indent=1)
print("M25_AUDIT done", job["out"])
