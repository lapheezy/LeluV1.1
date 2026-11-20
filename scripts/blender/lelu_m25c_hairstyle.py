"""
LÉLU M25 Complete — build a look's hairstyle as real geometry, matched to its photographs.

    blender -b --factory-startup --python lelu_m25c_hairstyle.py -- job.json

job.json:
  {"input": look.glb, "output": look.glb, "report": json, "body": "look_bronze_velocity",
   "headOffset": [x, y, z],              # from the assemble report (her coords = world - offset)
   "seed": 7,
   "style": {
     "locks": 460, "rootSpacingMm": 7, "endZ": [0.92, 1.08],
     "curlRadiusMm": [3.5, 5.5], "pitchMm": [10, 14], "lockRadiusMm": [1.6, 2.3],
     "frontShare": 0.18, "highlightShare": 0.22,
     "hairColor": [0.012, 0.0065, 0.0045], "highlightColor": [0.07, 0.026, 0.011],
     "coils": {"count": 18, "radiusMm": 9, "pitchMm": 7, "wireMm": 1.1, "lengthMm": [60, 150], "temple": true},
     "cuffs": 0, "medallion": null | {"side": 1, "z": 1.64, "y": 0.0, "radiusMm": 22}
   }}

Why: the hair Meshy grows on an outfit body is a crumpled shell — it cannot make fine
spiral curls or copper wire coils, and it ended at mid-back. Here:
  1. the outfit body's own hair (dark albedo above the hips) is removed, holes in the
     back it hid are closed;
  2. locks are rooted on her own scalp cap behind the hairline, grown down under gravity
     and pushed off her body and head (BVH), kept clear of her face, to the requested
     length; each lock is a helix (curl) swept as a smooth tube;
  3. copper wire springs wrap chosen locks (and a coil at each temple), gold cuffs and an
     optional flower-of-life medallion with chains and a crystal drop are added;
  4. everything is skinned (Head at the crown, blending to Spine02 down the back).
"""
import hashlib
import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_m25_common as C  # noqa: E402

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
st = job["style"]
rng = np.random.default_rng(int(job.get("seed", 7)))
OFF = np.array(job["headOffset"], float)
R = {"job": {k: v for k, v in job.items() if k not in ("input", "output", "report")}}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
for o in list(bpy.data.objects):
    if o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = bpy.data.objects[job["body"]]
for nm in ("lelu_hair_ringlets", "lelu_hair_strands", "lelu_hairstyle", "lelu_hair_coils", "lelu_hair_jewels", "lelu_hair_filler", "lelu_forehead_patch"):
    if nm in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[nm], do_unlink=True)

# ------------------------------------------------ 1. remove the generated hair
A = C.mesh_arrays(body)
tex = C.triangle_texture(body, A)
_, sat, val = C.hsv(tex["albedo"][:, :3])
cen = A["wco"][A["tv"]].mean(1)
dark = (val < float(st.get("removeValue", 0.2))) & (cen[:, 2] > float(st.get("removeAboveZ", 0.9)))
# anything the outfit body still has above her neck is generated hair or coils (any colour)
dark |= (cen[:, 2] - OFF[2]) > float(st.get("headZ", 1.49))
polys = set(A["tp"][dark].tolist())
bm = bmesh.new()
bm.from_mesh(body.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in polys], context="FACES")
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
# drop loose fragments left behind
W_b = body.matrix_world
seen, kill = set(), []
for f in bm.faces:
    if f.index in seen:
        continue
    comp, stack = [], [f]
    seen.add(f.index)
    while stack:
        g = stack.pop()
        comp.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in seen:
                    seen.add(h.index)
                    stack.append(h)
    zc = [((W_b @ g.calc_center_median()).z - OFF[2]) for g in comp[:: max(1, len(comp) // 200)]]
    # loose pieces anywhere; near the shoulders/neck, larger leftovers of the generated coils too
    if len(comp) < 40 or (len(comp) < int(st.get("fragmentFaces", 250)) and min(zc) > float(st.get("fragmentMinZ", 1.25))):
        kill += comp
bmesh.ops.delete(bm, geom=kill, context="FACES")
W = body.matrix_world
loops_filled = 0
for _ in range(3):
    bnd = [e for e in bm.edges if e.is_boundary and min((W @ v.co).z for v in e.verts) > float(st.get("removeAboveZ", 0.9))]
    if not bnd:
        break
    r = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
    loops_filled += len(r["faces"])
    if r["faces"]:
        bmesh.ops.triangulate(bm, faces=r["faces"])
bm.to_mesh(body.data)
bm.free()
body.data.update()
R["generatedHair"] = {"facesRemoved": len(polys), "fragmentsRemoved": len(kill), "holeFacesAdded": loops_filled}

if st.get("noHair") and bpy.data.objects.get("lelu_hair") is not None:
    # bald look: hairstyles are wardrobe items now, so every old hair face goes; face jewellery and lips stay
    o = bpy.data.objects["lelu_hair"]
    BA = C.mesh_arrays(o)
    bt = C.triangle_texture(o, BA)
    bq = BA["wco"][BA["tv"]].mean(1) - OFF
    bmr = bt.get("mr")
    bmetal = bmr[:, 2] >= 0.5 if bmr is not None else np.zeros(len(bq), bool)
    bh, bs, bv = C.hsv(bt["albedo"][:, :3])
    lips = (np.abs(bq[:, 0]) < 0.03) & (bq[:, 2] > 1.53) & (bq[:, 2] < 1.565) & (bq[:, 1] < -0.07)
    keep = (bmetal & (np.abs(bq[:, 0]) < 0.095) & (bq[:, 1] < 0.0) & (bq[:, 2] > 1.48)) | lips
    bb = bmesh.new()
    bb.from_mesh(o.data)
    bb.faces.ensure_lookup_table()
    bmesh.ops.delete(bb, geom=[bb.faces[i] for i in set(BA["tp"][~keep].tolist())], context="FACES")
    bb.to_mesh(o.data)
    bb.free()
    R["baldOldHairFacesRemoved"] = int((~keep).sum())
    # her scalp object is a face mask; the loose copper hair fragments around it are found by
    # WHERE they are, not their colour (pause 2): every triangle outside an ellipsoid fitted to her
    # head (centre/radii in her coordinates, below/above the centre separately) goes. Her mask is
    # itself in pieces (cheeks are separate components), so connectivity cannot be used.
    o = bpy.data.objects["lelu_scalp"]
    SA0 = C.mesh_arrays(o)
    sq0 = SA0["wco"][SA0["tv"]].mean(1) - OFF
    E = st.get("headEllipsoid", {"centre": [0.0, -0.015, 1.585], "radii": [0.079, 0.105, 0.135], "below": 0.118})
    ec, er = np.array(E["centre"]), np.array(E["radii"], float)
    rz = np.where(sq0[:, 2] < ec[2], float(E["below"]), er[2])
    nd = np.sqrt(((sq0[:, 0] - ec[0]) / er[0]) ** 2 + ((sq0[:, 1] - ec[1]) / er[1]) ** 2 + ((sq0[:, 2] - ec[2]) / rz) ** 2)
    outside = nd > 1.0
    sb0 = bmesh.new()
    sb0.from_mesh(o.data)
    sb0.faces.ensure_lookup_table()
    bmesh.ops.delete(sb0, geom=[sb0.faces[i] for i in set(SA0["tp"][outside].tolist())], context="FACES")
    sb0.to_mesh(o.data)
    sb0.free()
    R["baldScalpFragmentsRemoved"] = int(outside.sum())

# her old hair cap: its front edge above the forehead reads as a black slab under the new hair
cap = bpy.data.objects.get("lelu_hair")
if cap is not None:
    CA = C.mesh_arrays(cap)
    ctex = C.triangle_texture(cap, CA)
    _, _, cval = C.hsv(ctex["albedo"][:, :3])
    cq = CA["wco"][CA["tv"]].mean(1) - OFF
    trim = (cval < 0.2) & (cq[:, 2] > 1.55) & (cq[:, 1] < float(st.get("capTrimY", 0.0)))
    tb = bmesh.new()
    tb.from_mesh(cap.data)
    tb.faces.ensure_lookup_table()
    bmesh.ops.delete(tb, geom=[tb.faces[i] for i in set(CA["tp"][trim].tolist())], context="FACES")
    tb.to_mesh(cap.data)
    tb.free()
    R["capFacesTrimmed"] = int(trim.sum())

HC_pre = np.array([0.0, -0.012, 1.585]) + OFF
# jewellery this look does NOT have in its photographs (e.g. the camo look's forehead
# headpiece): metal triangles in the given boxes (her coordinates) are removed
for box in st.get("dropJewelBoxes", []):
    for nm in ("lelu_hair", "lelu_scalp"):
        o = bpy.data.objects.get(nm)
        if o is None:
            continue
        JA = C.mesh_arrays(o)
        jt = C.triangle_texture(o, JA)
        jq = JA["wco"][JA["tv"]].mean(1) - OFF
        mr = jt.get("mr")
        metal = mr[:, 2] >= 0.35 if mr is not None else np.zeros(len(jq), bool)
        jh, jsat, jval = C.hsv(jt["albedo"][:, :3])
        shiny = metal | ((jval > 0.55) & (jsat < 0.35))  # silver/crystal parts
        inb = np.all([(jq[:, i] >= box["min"][i]) & (jq[:, i] <= box["max"][i]) for i in range(3)], axis=0)
        skin_like = (jh >= 4) & (jh <= 42) & (jsat >= 0.2) & (jsat <= 0.85) & (jval >= 0.25)
        sel = inb & (shiny | (~skin_like if box.get("allNonSkin") else False))
        if sel.any():
            # Do not delete (her face has no skin under the jewel: deleting leaves a hole).
            # Press the jewel's vertices radially onto the sphere her surrounding forehead
            # lies on, and give its faces the UV of nearby forehead skin, so it becomes skin.
            me_ = o.data
            Mw = np.array(o.matrix_world)
            Mi = np.linalg.inv(Mw)
            tri_sel = np.nonzero(sel)[0]
            jverts = np.unique(JA["tv"][tri_sel])
            skin_tri = inb & ~sel & skin_like
            if not skin_tri.any():
                skin_tri = ~sel & skin_like
            sv = np.unique(JA["tv"][skin_tri])
            radius = float(np.median(np.linalg.norm(JA["wco"][sv] - HC_pre, axis=1)))
            co = np.empty(len(me_.vertices) * 3, np.float32)
            me_.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3).astype(float)
            w = JA["wco"][jverts]
            d = w - HC_pre
            # local depth: inverse-distance mean radius of the 12 nearest skin vertices by direction
            sd = JA["wco"][sv] - HC_pre
            sr = np.linalg.norm(sd, axis=1)
            sdn = sd / sr[:, None]
            dn = d / np.linalg.norm(d, axis=1, keepdims=True)
            ang = np.arccos(np.clip(dn @ sdn.T, -1, 1))
            k12 = np.argsort(ang, axis=1)[:, :12]
            wk = 1.0 / (np.take_along_axis(ang, k12, 1) + 1e-3) ** 2
            r_loc = (wk * sr[k12]).sum(1) / wk.sum(1)
            w_new = HC_pre + dn * (r_loc + 0.0004)[:, None]
            co[jverts] = w_new @ Mi[:3, :3].T + Mi[:3, 3]
            me_.vertices.foreach_set("co", co.astype(np.float32).reshape(-1))
            # UV: a forehead skin texel above the jewel (inside the box, highest skin triangles)
            # the skin right next to the jewel (closest skin-coloured triangles to its centre)
            sc_ = jq[skin_tri]
            jc = jq[tri_sel].mean(0)
            near_ = np.argsort(np.linalg.norm(sc_[:, [0, 2]] - jc[[0, 2]], axis=1))[:8]
            uv_skin = np.median(JA["uv"][JA["tl"][np.nonzero(skin_tri)[0][near_]]].reshape(-1, 2), 0)
            uvd = np.empty(len(me_.loops) * 2, np.float32)
            me_.uv_layers.active.data.foreach_get("uv", uvd)
            uvd = uvd.reshape(-1, 2)
            uvd[JA["tl"][tri_sel].reshape(-1)] = uv_skin
            me_.uv_layers.active.data.foreach_set("uv", uvd.reshape(-1))
            # normals of the pressed loops: radial, like the forehead
            cur = np.array([tuple(cn.vector) for cn in me_.corner_normals])
            nrm_ = d / np.linalg.norm(d, axis=1, keepdims=True)
            nrm_l = nrm_ @ Mw[:3, :3]
            nrm_l /= np.linalg.norm(nrm_l, axis=1, keepdims=True)
            lookup = dict(zip(jverts.tolist(), nrm_l))
            for li in JA["tl"][tri_sel].reshape(-1):
                cur[li] = lookup[me_.loops[li].vertex_index]
            me_.normals_split_custom_set(cur.tolist())
            # and her skin material (they were on the metal "head detail" material)
            skin_slot = next((k for k, ms in enumerate(o.material_slots) if ms.material and "skin" in ms.material.name), None)
            if skin_slot is not None:
                mi = np.empty(len(me_.polygons), np.int32)
                me_.polygons.foreach_get("material_index", mi)
                mi[np.unique(JA["tp"][tri_sel])] = skin_slot
                me_.polygons.foreach_set("material_index", mi)
            me_.update()
        R.setdefault("jewelsPressedFlat", {})[f'{box.get("name","box")}:{nm}'] = int(sel.sum())

# holes her original face mesh has under a removed jewel: found by casting rays from the
# front — where the first hit lies far behind the forehead, there is no skin — and closed by
# a small cap tucked 0.4 mm under the forehead sphere, textured with her own forehead skin.
for box in [b for b in st.get("dropJewelBoxes", []) if b.get("allNonSkin") and not st.get("skullShell")]:
    so = bpy.data.objects["lelu_scalp"]
    SA_ = C.mesh_arrays(so)
    sbvh = BVHTree.FromPolygons(SA_["wco"][SA_["tv"]].reshape(-1, 3).tolist(), np.arange(len(SA_["tv"]) * 3).reshape(-1, 3).tolist())
    holes, surf_r = [], []
    for x in np.arange(box["min"][0] - 0.006, box["max"][0] + 0.006, 0.0015):
        for z in np.arange(box["min"][2] - 0.004, box["max"][2], 0.0015):
            o_ = Vector((x + OFF[0], -0.4 + OFF[1], z + OFF[2]))
            hit = sbvh.ray_cast(o_, Vector((0, 1, 0)), 1.0)
            if hit[0] is None or hit[0].y - OFF[1] > -0.05:  # nothing, or only the back of the head
                holes.append([x, z])
            else:
                surf_r.append((x, z, np.linalg.norm(np.array(hit[0]) - HC_pre)))
    if not holes:
        continue
    holes = np.array(holes)
    # only the hole where the jewel was: samples within 14 mm of the jewel's centre, below the hairline
    jc_ = np.array(box.get("centre", [0.0, 1.645]))
    holes = holes[(np.linalg.norm(holes - jc_, axis=1) < 0.014) & (holes[:, 1] < float(box.get("hairlineZ", 1.668)))]
    if len(holes) == 0:
        continue
    cx, cz = holes.mean(0)
    rad = float(np.max(np.linalg.norm(holes - [cx, cz], axis=1))) + 0.003
    sr_ = np.array(surf_r)
    ring_r = sr_[np.linalg.norm(sr_[:, :2] - [cx, cz], axis=1) < rad + 0.006, 2] if len(sr_) else np.array([])
    # just behind the skin that rims the hole (10th percentile of its radius, less 0.6 mm)
    rr = float(np.median(ring_r)) + float(box.get("patchLiftMm", 0.2)) / 1000 if len(ring_r) else float(np.median(sr_[:, 2]))
    # cap: polar grid on the sphere of radius rr, around the direction to the hole centre
    centre_dir = np.array([cx, -0.2, cz]) + OFF - HC_pre
    yfront = None
    hit = sbvh.ray_cast(Vector((cx + OFF[0], -0.4 + OFF[1], cz + OFF[2])), Vector((0, 1, 0)), 1.0)
    cdir = np.array([cx, -np.sqrt(max(rr ** 2 - cx ** 2 - (cz - 1.585) ** 2, 1e-6)) - 0.012, cz - 1.585])
    cdir /= np.linalg.norm(cdir)
    u_ = np.cross(cdir, [0, 0, 1.0]); u_ /= np.linalg.norm(u_)
    v_ = np.cross(cdir, u_)
    verts, faces = [HC_pre + cdir * rr], []
    ring_n, rings = 16, 4
    for ri in range(1, rings + 1):
        a = rad / rr * ri / rings
        for k in range(ring_n):
            t = 2 * np.pi * k / ring_n
            d_ = cdir * np.cos(a) + (u_ * np.cos(t) + v_ * np.sin(t)) * np.sin(a)
            verts.append(HC_pre + d_ * rr)
    for k in range(ring_n):
        faces.append((0, 1 + k, 1 + (k + 1) % ring_n))
    for ri in range(1, rings):
        b0, b1 = 1 + (ri - 1) * ring_n, 1 + ri * ring_n
        for k in range(ring_n):
            faces.append((b0 + k, b1 + k, b1 + (k + 1) % ring_n, b0 + (k + 1) % ring_n))
    Mi_ = np.linalg.inv(np.array(so.matrix_world))
    V_ = np.array(verts) @ Mi_[:3, :3].T + Mi_[:3, 3]
    pm = bpy.data.meshes.new("lelu_forehead_patch")
    pm.from_pydata(V_.tolist(), [], faces)
    pm.update()
    uvl = pm.uv_layers.new()
    # forehead skin texel just above the hole
    sq = SA_["wco"][SA_["tv"]].mean(1) - OFF
    near = np.argsort(np.linalg.norm(sq[:, [0, 2]] - [cx, cz - rad - 0.004], axis=1))[:6]
    uvs = np.median(SA_["uv"][SA_["tl"][near]].reshape(-1, 2), 0)
    for l in uvl.data:
        l.uv = uvs
    for poly in pm.polygons:
        poly.use_smooth = True
    # its own skin material, coloured with the median albedo of her forehead skin around the hole
    stex = C.triangle_texture(so, SA_)
    sh_, ss_, sv_ = C.hsv(stex["albedo"][:, :3])
    ring_ = (np.linalg.norm(sq[:, [0, 2]] - [cx, cz], axis=1) < rad + 0.012) & (sh_ >= 4) & (sh_ <= 42) & (ss_ >= 0.2) & (sv_ >= 0.25)
    srgb = np.median(stex["albedo"][ring_, :3], 0) if ring_.any() else np.array([0.55, 0.36, 0.27])
    lin = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    skin_mat = bpy.data.materials.new("m25c_skin_forehead_patch")
    skin_mat.use_nodes = True
    pp_ = skin_mat.node_tree.nodes["Principled BSDF"]
    pp_.inputs["Base Color"].default_value = (*lin, 1)
    pp_.inputs["Roughness"].default_value = 0.5
    pm.materials.append(skin_mat)
    po = bpy.data.objects.new("lelu_forehead_patch", pm)
    bpy.context.scene.collection.objects.link(po)
    po.parent = rig
    po.matrix_world = so.matrix_world.copy()
    po.vertex_groups.new(name="Head").add(list(range(len(verts))), 1.0, "REPLACE")
    po.modifiers.new("Armature", "ARMATURE").object = rig
    R.setdefault("holePatches", []).append({"skinSrgb": [round(float(x), 3) for x in srgb], "centreHerXZ": [round(float(cx), 4), round(float(cz), 4)], "radiusMm": round(rad * 1000, 1), "patchRadiusFromCentreMm": round(rr * 1000, 2), "rimRadiusP10Mm": round(float(np.percentile(ring_r, 10)) * 1000, 2) if len(ring_r) else None, "holeSamples": len(holes)})

# paint the removed jewellery out of her face texture: inside the UV footprint of the
# boxes, pixels that are not skin (the painted jewel, chain line, highlights) are inpainted
# from the skin around them (OpenCV Telea). A new packed image; the original is untouched.
inpaint_boxes = st.get("inpaintBoxes", [])
if inpaint_boxes:
    import cv2
    from PIL import Image as _I, ImageDraw as _D
    so = bpy.data.objects["lelu_scalp"]
    mat_ = so.material_slots[0].material
    node = C.find_image(mat_, "Base Color")
    img = node.image
    w_, h_ = img.size
    px = np.empty(w_ * h_ * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h_, w_, 4)
    region = _I.new("L", (w_, h_), 0)
    dr = _D.Draw(region)
    for nm in ("lelu_scalp", "lelu_hair"):
        o = bpy.data.objects.get(nm)
        if o is None:
            continue
        IA = C.mesh_arrays(o)
        iq = IA["wco"][IA["tv"]].mean(1) - OFF
        for box in inpaint_boxes:
            inb = np.all([(iq[:, i] >= box["min"][i]) & (iq[:, i] <= box["max"][i]) for i in range(3)], axis=0)
            for tri in IA["uv"][IA["tl"][inb]]:
                if np.ptp(tri[:, 0]) > 0.03 or np.ptp(tri[:, 1]) > 0.03:
                    continue  # straddles a seam: its outline would span the whole texture
                dr.polygon([(u % 1 * w_, (1 - v % 1) * h_) for u, v in tri], fill=255)
    reg = np.asarray(region)[::-1] > 0
    rgb = px[..., :3]
    hh, ss, vv = C.hsv(rgb.reshape(-1, 3))
    skin = ((hh >= 4) & (hh <= 42) & (ss >= 0.2) & (ss <= 0.85) & (vv >= 0.25) & (vv <= 0.9)).reshape(h_, w_)
    mask = (reg & ~skin).astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
    mask &= (reg.astype(np.uint8) * 255)
    img8 = np.clip(rgb[::-1] * 255, 0, 255).astype(np.uint8)
    out = cv2.inpaint(img8, mask[::-1].copy(), 9, cv2.INPAINT_TELEA)[::-1].astype(np.float32) / 255
    px[..., :3] = out
    new = bpy.data.images.new(img.name + "_" + job["body"], w_, h_, alpha=True)
    new.pixels.foreach_set(px.reshape(-1))
    new.pack()
    # every material that shows this texture (head detail AND skin) gets the repainted copy
    for m_ in bpy.data.materials:
        if m_.use_nodes:
            for n_ in m_.node_tree.nodes:
                if n_.type == "TEX_IMAGE" and n_.image == img:
                    n_.image = new
    R["inpaintedPixels"] = int((mask > 0).sum())
    R["inpaintRegionPixels"] = int(reg.sum())

# ------------------------------------------------ 1b. her skull (bald base)
# Her head mesh is only a face mask: without hair there is nothing behind it. A closed skull is
# grown under it: an ellipsoid around her head centre whose every vertex is pulled in to sit
# `insetMm` under the mask wherever a ray from the centre meets the mask (so it can never poke
# through her face) — it also closes the hole the old headpiece left in her forehead. Vertex
# colours: her own forehead skin below a hairline, dark scalp above it (any hairstyle item sits on
# it and gaps read as roots, not as a void). Skinned 100% to Head.
if st.get("skullShell"):
    so = bpy.data.objects["lelu_scalp"]
    SA_ = C.mesh_arrays(so)
    mt = SA_["wco"][SA_["tv"]]
    mbvh = BVHTree.FromPolygons(mt.reshape(-1, 3).tolist(), np.arange(len(mt) * 3).reshape(-1, 3).tolist())
    E = st.get("headEllipsoid", {"centre": [0.0, -0.015, 1.585], "radii": [0.079, 0.105, 0.135], "below": 0.118})
    SH = st["skullShell"]
    ec = np.array(E["centre"]) + OFF
    sr_ = np.array(SH.get("radii", [0.071, 0.09, 0.112]), float)
    front_ = float(SH.get("front", 0.072))  # shallower in front: it must stay behind her face where the mask is open
    below_ = float(SH.get("below", 0.10))
    inset = float(SH.get("insetMm", 2.0)) / 1000
    nu, nv = 64, 40
    # a lat-long grid with single poles
    verts, faces = [], []
    rows = []
    for j in range(1, nv):
        th = np.pi * j / nv
        row = []
        for i in range(nu):
            ph = 2 * np.pi * i / nu
            d = np.array([np.sin(th) * np.sin(ph), -np.sin(th) * np.cos(ph), np.cos(th)])
            rz_ = sr_[2] if d[2] >= 0 else below_
            ry_ = sr_[1] if d[1] >= 0 else front_
            k = 1.0 / np.sqrt((d[0] / sr_[0]) ** 2 + (d[1] / ry_) ** 2 + (d[2] / rz_) ** 2)
            hit = mbvh.ray_cast(Vector(ec.tolist()), Vector(d.tolist()), float(k) + 0.05)
            r = k
            if hit[0] is not None:
                r_m = float((np.array(hit[0]) - ec) @ d)
                r = min(k, max(r_m - inset, 0.02))
            row.append(len(verts))
            verts.append((d, r, hit[0] is not None))
        rows.append(row)
    # where a front ray met no mask (eyes, mouth, the old headpiece hole), the shell takes the
    # smallest radius of its hit neighbours so it cannot stand in front of her face
    Dn = np.array([v[0] for v in verts]); Rr = np.array([v[1] for v in verts]); Hh = np.array([v[2] for v in verts])
    grid = np.array(rows)
    for _ in range(int(SH.get("fillPasses", 12))):
        Rn = np.minimum.reduce([np.roll(Rr[grid], 1, 1), np.roll(Rr[grid], -1, 1),
                                np.vstack([Rr[grid][:1], Rr[grid][:-1]]), np.vstack([Rr[grid][1:], Rr[grid][-1:]])]).reshape(-1)
        front = (Dn[grid.reshape(-1), 1] < -0.2) & ~Hh[grid.reshape(-1)]
        idx = grid.reshape(-1)[front]
        Rr[idx] = np.minimum(Rr[idx], Rn[front] + 0.0005)
    verts = [ec + Dn[i] * Rr[i] for i in range(len(Dn))]
    top = len(verts); verts.append(ec + np.array([0, 0, sr_[2]]))
    bot = len(verts); verts.append(ec - np.array([0, 0, below_]))
    for i in range(nu):
        faces.append((top, rows[0][i], rows[0][(i + 1) % nu]))
        faces.append((bot, rows[-1][(i + 1) % nu], rows[-1][i]))
    for j in range(len(rows) - 1):
        for i in range(nu):
            a, b = rows[j][i], rows[j][(i + 1) % nu]
            c_, d_ = rows[j + 1][(i + 1) % nu], rows[j + 1][i]
            faces.append((a, d_, c_, b))
    V = np.array(verts)
    Mi_ = np.linalg.inv(np.array(so.matrix_world))
    me_s = bpy.data.meshes.new("lelu_skull")
    me_s.from_pydata((V @ Mi_[:3, :3].T + Mi_[:3, 3]).tolist(), [], faces)
    me_s.update()
    for poly in me_s.polygons:
        poly.use_smooth = True
    # colours: her forehead skin (median albedo of skin-coloured mask triangles on the forehead)
    stex = C.triangle_texture(so, SA_)
    sh_, ss_, sv_ = C.hsv(stex["albedo"][:, :3])
    sq = mt.mean(1) - OFF
    fore = (np.abs(sq[:, 0]) < 0.04) & (sq[:, 2] > 1.60) & (sq[:, 2] < 1.66) & (sh_ >= 4) & (sh_ <= 42) & (ss_ >= 0.2) & (sv_ >= 0.25)
    skin_srgb = np.median(stex["albedo"][fore, :3], 0) if fore.any() else np.array([0.55, 0.36, 0.27])
    scalp_srgb = np.array(SH.get("scalpSrgb", [0.075, 0.045, 0.032]))
    q = V - OFF
    ang = np.arctan2(q[:, 0] - E["centre"][0], -(q[:, 1] - E["centre"][1]))  # 0 front, ±pi back
    # hairline: across the forehead, down in front of the ears, and right down to the nape behind
    # them (under any hairstyle the back of her head must read as hair roots, never as bare skin)
    hl = SH.get("hairline", {"front": 1.662, "side": 1.60, "back": 1.42})
    a_ = np.abs(ang) / np.pi
    line = np.where(a_ < 0.5, hl["front"] + (hl["side"] - hl["front"]) * (a_ / 0.5),
                    hl["side"] + (hl["back"] - hl["side"]) * np.clip((a_ - 0.5) / 0.12, 0, 1))
    tz = np.clip((q[:, 2] - line) / 0.008 + 0.5, 0, 1)
    col_ = skin_srgb[None, :] * (1 - tz[:, None]) + scalp_srgb[None, :] * tz[:, None]
    lin = np.where(col_ <= 0.04045, col_ / 12.92, ((col_ + 0.055) / 1.055) ** 2.4)
    ca = me_s.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", np.concatenate([lin, np.ones((len(lin), 1))], 1).astype(np.float32).reshape(-1))
    sm = bpy.data.materials.new("m25c_skull")
    sm.use_nodes = True
    nt = sm.node_tree
    bs = nt.nodes["Principled BSDF"]
    an = nt.nodes.new("ShaderNodeVertexColor")
    an.layer_name = "Col"
    nt.links.new(an.outputs["Color"], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.55
    me_s.materials.append(sm)
    sk = bpy.data.objects.new("lelu_skull", me_s)
    bpy.context.scene.collection.objects.link(sk)
    sk.parent = rig
    sk.matrix_world = so.matrix_world.copy()
    sk.vertex_groups.new(name="Head").add(list(range(len(V))), 1.0, "REPLACE")
    sk.modifiers.new("Armature", "ARMATURE").object = rig
    R["skull"] = {"vertices": int(len(V)), "skinSrgb": [round(float(x), 3) for x in skin_srgb]}

# ------------------------------------------------ 2. colliders and her head
def world_tris(o):
    a = C.mesh_arrays(o)
    return a["wco"][a["tv"]]


col = [world_tris(body)] + [world_tris(bpy.data.objects[n]) for n in ("lelu_scalp", "lelu_hair") if n in bpy.data.objects]
col = np.concatenate(col)
bvh = BVHTree.FromPolygons(col.reshape(-1, 3).tolist(), np.arange(len(col) * 3).reshape(-1, 3).tolist(), epsilon=0.0)
head_tris = np.concatenate([world_tris(bpy.data.objects[n]) for n in ("lelu_scalp", "lelu_hair") if n in bpy.data.objects])
hb = BVHTree.FromPolygons(head_tris.reshape(-1, 3).tolist(), np.arange(len(head_tris) * 3).reshape(-1, 3).tolist(), epsilon=0.0)
HC = np.array([0.0, -0.012, 1.585]) + OFF  # her head centre, world


def her(p):
    return np.asarray(p) - OFF


def in_face(p, m=0.0):
    q = her(p)
    return abs(q[0]) < 0.078 + m and q[1] < -0.035 and 1.47 < q[2] < 1.71


# root candidates: the cap/scalp surface behind the hairline
ht = head_tris
hc = ht.mean(1)
hq = hc - OFF
area = np.linalg.norm(np.cross(ht[:, 1] - ht[:, 0], ht[:, 2] - ht[:, 0]), axis=1) / 2
ok = (hq[:, 2] > 1.54) & ((hq[:, 1] > -0.045) | ((np.abs(hq[:, 0]) > 0.065) & (hq[:, 1] > -0.07))) & (hq[:, 2] > 1.50)
cand_t = np.nonzero(ok)[0]
pick = rng.choice(cand_t, size=int(st["locks"]) * 8, p=area[cand_t] / area[cand_t].sum())
r1, r2 = rng.random(len(pick)), rng.random(len(pick))
s = np.sqrt(r1)
pts = ht[pick, 0] * (1 - s)[:, None] + ht[pick, 1] * (s * (1 - r2))[:, None] + ht[pick, 2] * (s * r2)[:, None]
roots = []
sp = float(st.get("rootSpacingMm", 7)) / 1000
from mathutils.kdtree import KDTree  # noqa: E402

for p in pts:
    if len(roots) >= int(st["locks"]):
        break
    if roots:
        kd = KDTree(len(roots))
        for i, q in enumerate(roots):
            kd.insert(Vector(q), i)
        kd.balance()
        if kd.find(Vector(p))[2] < sp:
            continue
    roots.append(p)
if st.get("noHair"):
    roots = []  # the look carries no hair: hairstyles are separate wardrobe items
R["roots"] = len(roots)


def out_dir(p):
    d = p - HC
    n = np.linalg.norm(d)
    return d / n if n > 1e-9 else np.array([0, 0, 1.0])


def body_surface_y(x, z, from_back):
    """y of the body/head surface at (x, z), seen from behind (+y) or from the front (-y)."""
    y0 = 2.0 if from_back else -2.0
    hit = bvh.ray_cast(Vector((x, y0, z)), Vector((0, -1.0 if from_back else 1.0, 0)), 4.0)
    return None if hit[0] is None else hit[0].y


def grow(root, clearance, end_z, front, layer=0.0):
    """Deterministic and stable: (1) over the head, from the root round to the nape at
    a fixed distance from the head centre; (2) hanging: straight down, standing off the
    back of the body (or the chest, for a lock worn in front) by clearance + layer."""
    pts = []
    d0 = out_dir(root)
    r0 = np.linalg.norm(root - HC) + clearance + layer * 0.5
    q = her(root)
    side = q[0]
    nape = np.array([np.clip(side * 1.6, -0.09, 0.09), 0.075 if not front else -0.02, -0.07])
    nape = nape / np.linalg.norm(nape)
    for t in np.linspace(0, 1, 24):
        d = d0 * (1 - t) + nape * t
        d /= np.linalg.norm(d)
        pts.append(HC + d * r0)
    x0 = pts[-1][0] - OFF[0]
    z = pts[-1][2]
    prev_y = pts[-1][1]
    while z > end_z:
        z -= 0.005
        drop = np.clip((pts[-1][2] - OFF[2] - 1.50) / -0.45, 0, 1) if False else np.clip((1.50 - (z - OFF[2])) / 0.40, 0, 1)
        x = OFF[0] + np.clip(x0 * (1 + float(st.get("spread", 0.55)) * drop), -0.21, 0.21)
        y_s = body_surface_y(x, z, not front)
        if y_s is None:
            y = prev_y
        else:
            y = y_s + (1 if not front else -1) * (clearance + layer)
            # never let the curtain cut back in front of where it already hangs
            y = max(y, prev_y - 0.01) if not front else min(y, prev_y + 0.01)
        prev_y = y
        pts.append(np.array([x, y, z]))
    return np.array(pts)


def resample(poly, spacing):
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    s_ = np.r_[0, np.cumsum(seg)]
    if s_[-1] < spacing * 3:
        return None
    t = np.arange(0, s_[-1], spacing)
    return np.stack([np.interp(t, s_, poly[:, i]) for i in range(3)], 1)


def smooth(p, it=10):
    p = p.copy()
    for _ in range(it):
        p[1:-1] = 0.5 * p[1:-1] + 0.25 * (p[:-2] + p[2:])
    return p


def frames(c):
    t = np.gradient(c, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
    n = np.zeros_like(c)
    ref = np.array([1.0, 0, 0]) if abs(t[0, 0]) < 0.9 else np.array([0, 1.0, 0])
    n0 = np.cross(t[0], ref)
    n[0] = n0 / np.linalg.norm(n0)
    for i in range(1, len(c)):
        v = n[i - 1] - np.dot(n[i - 1], t[i]) * t[i]
        ln = np.linalg.norm(v)
        n[i] = v / ln if ln > 1e-12 else n[i - 1]
    return t, n, np.cross(t, n)


def helix(axis, radius, pitch, phase, relax, ds):
    ax = resample(axis, ds)
    if ax is None:
        return None
    _, n, b = frames(ax)
    s_ = np.arange(len(ax)) * ds
    r = radius * np.clip(s_ / max(relax, 1e-6), 0.0, 1.0) ** 0.7
    a = phase + 2 * np.pi * s_ / pitch
    return ax + (np.cos(a) * r)[:, None] * n + (np.sin(a) * r)[:, None] * b


def tube(center, radius, sides, taper=0.5):
    if center is None or len(center) < 3:
        return None, None
    _, n, b = frames(center)
    k = len(center)
    rr = np.full(k, radius)
    tip = max(2, k // 10)
    rr[-tip:] *= np.linspace(1.0, taper, tip)
    rr[:2] *= 0.7
    th = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    ring = np.cos(th)[None, :, None] * n[:, None, :] + np.sin(th)[None, :, None] * b[:, None, :]
    verts = (center[:, None, :] + rr[:, None, None] * ring).reshape(-1, 3)
    i = np.arange(k - 1)[:, None] * sides
    j = np.arange(sides)[None, :]
    a0, a1 = i + j, i + (j + 1) % sides
    quads = np.stack([a0, a0 + sides, a1 + sides, a1], -1).reshape(-1, 4)
    return verts, quads


# ------------------------------------------------ 3. locks
mm = lambda v: float(v) / 1000
items, coils, axes, fillers = [], [], [], []
lens = []
for k, root in enumerate(roots):
    R_c = mm(rng.uniform(*st["curlRadiusMm"]))
    pitch = mm(rng.uniform(*st["pitchMm"]))
    r_l = mm(rng.uniform(*st["lockRadiusMm"]))
    q = her(root)
    front = abs(q[0]) > 0.05 and q[1] < 0.01 and rng.random() < float(st.get("frontShare", 0.18))
    end_z = rng.uniform(*st["endZ"]) + OFF[2] * 0
    filler = rng.random() < float(st.get("fillerShare", 0.0))
    vol = mm(float(st.get("volumeMm", 0)) * (rng.random() * 0.45 if filler else 0.45 + 0.55 * rng.random()))
    if filler:
        R_c, r_l = mm(1.5), mm(rng.uniform(*st.get("fillerRadiusMm", [4.5, 6.0])))
    axis = grow(root, R_c + r_l + 0.003, end_z, front, vol)
    if len(axis) < 5:
        continue
    axis = smooth(resample(axis, 0.004), 12)
    if filler:
        centre = resample(axis, 0.005)
        if centre is None:
            continue
        fillers.append((centre, r_l, "hair"))
        continue
    centre = helix(axis, R_c, pitch, rng.uniform(0, 2 * np.pi), float(st.get("rootRelaxMm", 25)) / 1000, mm(st.get("sampleMm", 1.8)))
    if centre is None:
        continue
    kind = "highlight" if rng.random() < float(st.get("highlightShare", 0.2)) else "hair"
    items.append((centre, r_l, kind))
    axes.append((axis, R_c, r_l, root, front, vol))
    lens.append(float(np.sum(np.linalg.norm(np.diff(axis, axis=0), axis=1))))

# copper wire coils around chosen locks (visible ones: back and sides, not the hidden inner ones)
cs = st.get("coils")
coil_count = 0
if cs:
    # coils only on the outer layer of hair, where they can be seen
    vmax = max(a[5] for a in axes) or 1.0
    order = [i for i, a in enumerate(axes) if a[5] > 0.55 * vmax or a[4]]
    rng.shuffle(order)
    for i in order[: int(cs["count"])]:
        axis, R_c, r_l, root, _, _v = axes[i]
        L = float(np.sum(np.linalg.norm(np.diff(axis, axis=0), axis=1)))
        seg_len = mm(rng.uniform(*cs["lengthMm"]))
        start = rng.uniform(0.04, max(0.05, 0.75 - seg_len / max(L, 1e-6)))
        ax = resample(axis, 0.002)
        s_ = np.arange(len(ax)) * 0.002
        sel = (s_ >= start * L) & (s_ <= start * L + seg_len)
        if sel.sum() < 6:
            continue
        wire = helix(ax[sel], R_c + r_l + mm(cs["radiusMm"]) - mm(8), mm(cs["pitchMm"]), 0.0, 0.0, 0.0008)
        coils.append((wire, mm(cs["wireMm"]), "copper"))
        coil_count += 1
    if cs.get("temple"):
        # a coiled lock at each temple, beside the face (as in the photographs)
        for side in (-1, 1):
            q0 = np.array([side * 0.072, -0.045, 1.635])
            axis = np.array([q0 + np.array([side * 0.004 * t, -0.002 * t, -0.012 * t]) for t in range(8)]) + OFF
            lock = helix(axis, mm(2.5), mm(7), 0.0, 0.004, 0.0012)
            items.append((lock, mm(1.4), "hair"))
            wire = helix(axis, mm(5.5), mm(6), 0.0, 0.0, 0.0008)
            coils.append((wire, mm(1.0), "copper"))
            coil_count += 1

# big open copper coils over the crown, running front to back on sections of hair (photo)
cc = st.get("crownCoils")
if cc:
    for k in range(int(cc["count"])):
        x = float(np.linspace(-cc.get("spreadX", 0.045), cc.get("spreadX", 0.045), int(cc["count"]))[k])
        y0 = float(rng.uniform(*cc.get("startY", [-0.06, -0.02])))
        path = []
        for t in np.linspace(0, 1, 30):
            q = np.array([x * (1 + 0.3 * t), y0 + t * float(cc.get("lengthMm", 70)) / 1000, 0.0])
            d_ = np.array([q[0], q[1] + 0.012, 0.11])
            d_ /= np.linalg.norm(d_)
            hit = hb.ray_cast(Vector(HC + d_ * 0.3), Vector(-d_), 0.3)
            r_s = (np.linalg.norm(np.array(hit[0]) - HC) if hit[0] is not None else 0.1) + mm(cc["radiusMm"]) * 0.6
            path.append(HC + d_ * r_s)
        wire = helix(np.array(path), mm(cc["radiusMm"]), mm(cc["pitchMm"]), rng.uniform(0, 6.28), 0.0, 0.0008)
        coils.append((wire, mm(cc["wireMm"]), "copper"))
        coil_count += 1

# gold cuffs on locks near the crown
cuffs = []
for i in list(range(len(axes)))[: int(st.get("cuffs", 0)) * 3 : 3]:
    axis, R_c, r_l, root, _, _v = axes[i]
    ax = resample(axis, 0.002)
    j = min(len(ax) - 2, int(rng.uniform(0.03, 0.12) / 0.002))
    c0 = ax[j]
    t = ax[j + 1] - ax[j]
    t /= np.linalg.norm(t)
    ring = np.array([c0 + t * (z * 0.0015) for z in range(-3, 4)])
    cuffs.append((ring, R_c + r_l + mm(1.2), "gold"))

# flower-of-life medallion with chains and a crystal drop
jewels_v, jewels_q, jewels_m = [], [], []


def add_torus(centre, normal, R_, r_, mat, seg=48, sides=6):
    normal = normal / np.linalg.norm(normal)
    u = np.cross(normal, [0, 0, 1.0])
    if np.linalg.norm(u) < 1e-6:
        u = np.cross(normal, [1.0, 0, 0])
    u /= np.linalg.norm(u)
    v = np.cross(normal, u)
    a = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    path = centre + R_ * (np.cos(a)[:, None] * u + np.sin(a)[:, None] * v)
    path = np.vstack([path, path[:1]])
    vv, qq = tube(path, r_, sides, taper=1.0)
    jewels_v.append(vv)
    jewels_q.append(qq)
    jewels_m.append(np.full(len(qq), mat))
    return u, v


med = st.get("medallion")
if med:
    side = float(med["side"])
    cq = np.array([side * float(med.get("x", 0.083)), float(med.get("y", 0.0)), float(med["z"])])
    c0 = cq + OFF
    nrm = np.array([side, 0.0, 0.0])
    Rm = mm(med["radiusMm"])
    u, v = add_torus(c0, nrm, Rm, mm(1.3), 1)
    for k in range(6):  # flower of life: centre + six petals, radius Rm/2
        a = k * np.pi / 3
        add_torus(c0 + 0.5 * Rm * (math.cos(a) * u + math.sin(a) * v) + nrm * 0.0005, nrm, 0.5 * Rm, mm(0.45), 1, seg=32, sides=4)
    add_torus(c0 + nrm * 0.0005, nrm, 0.5 * Rm, mm(0.45), 1, seg=32, sides=4)
    for k, dx in enumerate((-0.35, 0.0, 0.35)):  # three chains of beads, the middle one with a crystal
        top = c0 - v * Rm + u * dx * Rm
        n_beads = 7 if k == 1 else 5
        for b in range(n_beads):
            add_torus(top - np.array([0, 0, 0.0055 * (b + 1)]), np.array([0, 1.0, 0]), mm(1.4), mm(0.6), 1, seg=12, sides=4)
        if k == 1:
            tip = top - np.array([0, 0, 0.0055 * (n_beads + 1)])
            h = 0.012
            w_ = 0.0045
            oct_v = np.array([tip, tip - [0, 0, h], tip - [0, 0, h * 0.45] + [w_, 0, 0], tip - [0, 0, h * 0.45] - [w_, 0, 0],
                              tip - [0, 0, h * 0.45] + [0, w_, 0], tip - [0, 0, h * 0.45] - [0, w_, 0]])
            tri = np.array([[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]])
            jewels_v.append(oct_v)
            jewels_q.append(np.c_[tri, tri[:, 2]])  # degenerate quads → triangles
            jewels_m.append(np.full(len(tri), 2))
R["jewellery"] = {"coils": coil_count, "cuffs": len(cuffs), "medallion": bool(med)}


# ------------------------------------------------ 4. meshes, materials, skin
def mat(name, color, rough, metal=0.0, spec=0.5, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["Specular IOR Level"].default_value = spec
    if transmission:
        p.inputs["Transmission Weight"].default_value = transmission
    return m


ref = bpy.data.objects["lelu_scalp"].matrix_world.copy()
inv = np.array(ref.inverted())
MATS = {
    "hair": mat("m25c_hair_" + job["body"], tuple(st["hairColor"]), 0.42),
    "highlight": mat("m25c_hair_hl_" + job["body"], tuple(st["highlightColor"]), 0.40),
    "copper": mat("m25c_copper_wire", (0.93, 0.47, 0.29), 0.22, 1.0),
    "gold": mat("m25c_gold", (0.95, 0.72, 0.38), 0.25, 1.0),
    "crystal": mat("m25c_crystal", (0.98, 0.9, 0.92), 0.02, 0.0, 0.5, 0.9),
}


def build(name, parts, sides, mats, extra=None):
    V, Q, M = [], [], []
    base = 0
    for c, r, kind in parts:
        v, q = tube(c, r, sides)
        if v is None:
            continue
        V.append(v)
        Q.append(q + base)
        M.append(np.full(len(q), mats.index(kind)))
        base += len(v)
    if extra:
        for v, q, m in zip(*extra):
            V.append(v)
            Q.append(q + base)
            M.append(m)
            base += len(v)
    if not V:
        return None
    V, Q, M = np.concatenate(V), np.concatenate(Q), np.concatenate(M)
    Vl = V @ inv[:3, :3].T + inv[:3, 3]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(Vl))
    me.vertices.foreach_set("co", Vl.astype(np.float32).reshape(-1))
    me.loops.add(len(Q) * 4)
    me.loops.foreach_set("vertex_index", Q.reshape(-1).astype(np.int32))
    me.polygons.add(len(Q))
    me.polygons.foreach_set("loop_start", (np.arange(len(Q)) * 4).astype(np.int32))
    me.polygons.foreach_set("material_index", M.astype(np.int32))
    me.polygons.foreach_set("use_smooth", np.ones(len(Q), bool))
    me.update(calc_edges=True)
    me.validate()
    for k in mats:
        me.materials.append(MATS[k])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = rig
    ob.matrix_world = ref
    z = V[:, 2] - OFF[2]
    wh = np.clip((z - 1.30) / 0.22, 0, 1)
    gh, gs = ob.vertex_groups.new(name="Head"), ob.vertex_groups.new(name="Spine02")
    for i_, w_ in enumerate(wh.tolist()):
        if w_ > 0:
            gh.add([i_], w_, "REPLACE")
        if w_ < 1:
            gs.add([i_], 1 - w_, "REPLACE")
    ob.modifiers.new("Armature", "ARMATURE").object = rig
    return {"vertices": int(len(V)), "triangles": int(len(Q) * 2)}


R["hairstyle"] = None if not items else build("lelu_hairstyle", items, int(st.get("sides", 4)), ["hair", "highlight"])
if fillers:
    R["hairFiller"] = build("lelu_hair_filler", fillers, 4, ["hair"])
R["locks"] = len(items)
R["coilsMesh"] = None if not (coils or cuffs) else build("lelu_hair_coils", coils + cuffs, 6, ["copper", "gold"])
if jewels_v:
    jm = ["gold", "gold", "crystal"]
    R["jewelsMesh"] = build("lelu_hair_jewels", [], 4, ["copper", "gold", "crystal"], (jewels_v, [q[:, :4] for q in jewels_q], jewels_m))
R["lockLengthMm"] = None if not lens else {"p10": round(float(np.percentile(lens, 10)) * 1000), "p50": round(float(np.median(lens)) * 1000), "p90": round(float(np.percentile(lens, 90)) * 1000)}

bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
R["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
R["outputBytes"] = os.path.getsize(job["output"])
json.dump(R, open(job["report"], "w"), indent=1)
print("M25C_HAIRSTYLE", json.dumps({k: R.get(k) for k in ("generatedHair", "roots", "hairstyle", "coilsMesh", "lockLengthMm", "jewellery", "holePatches")}))
