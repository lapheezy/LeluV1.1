"""
LÉLU M25 Complete — assemble a wardrobe look: a rigged Meshy outfit body + LÉLU's own head.

    blender -b --factory-startup --python lelu_m25c_lookassemble.py -- job.json
    job: {"outfit": ".../rigged.glb", "lelu": ".../s3-shoulders.glb", "output": ".../look.glb",
          "report": ".../assemble.json", "cutZ": 1.465, "lookId": "bronze_velocity",
          "material": {"metallicScale": 0.55, "roughnessFloor": 0.32}}

The outfit body comes from Meshy's rigger with the same 24-bone skeleton and
bone names as LÉLU's rig, so her head objects (scalp/face, hair foundation,
ringlets, strands, eyes, mouth, teeth — with all 12 face shape keys) are moved
onto it unchanged: translated by the offset between the two Head bones,
re-parented to the outfit armature, their vertex groups (bone names) reused as
they are. The outfit loses every triangle above `cutZ` (its generated head and
crown); hair hanging below the cut stays. One skeleton, one identity.

Material: Meshy's metallic map renders the whole suit as mirror chrome. The
outfit material's metallic texture is scaled by `metallicScale` and its
roughness floored at `roughnessFloor` through a baked image (glTF-exportable),
so copper reads as metal with depth and the fabric parts stop being mirrors.
"""
import hashlib
import json
import math
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
cut = float(job["cutZ"]) if job.get("cutZ") not in (None, "auto") else 1.465
bpy.ops.wm.read_factory_settings(use_empty=True)
report = {"job": job}


def imp(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


outfit = imp(job["outfit"])
o_rig = next(o for o in outfit if o.type == "ARMATURE")
o_body = next(o for o in outfit if o.type == "MESH" and o.name != "Icosphere")
for o in outfit:
    if o.type == "MESH" and o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
o_rig.name = "Armature"
o_body.name = "look_" + job.get("lookId", "outfit")
for o in (o_rig,):
    o.data.pose_position = "REST"
    if o.animation_data:
        o.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

lelu = imp(job["lelu"])
l_rig = next(o for o in lelu if o.type == "ARMATURE")
l_rig.data.pose_position = "REST"
heads = [o for o in lelu if o.type == "MESH" and o.name.split(".")[0] in
         ("lelu_hair", "lelu_scalp", "lelu_hair_ringlets", "lelu_hair_strands", "eye_patch_l", "eye_patch_r", "lelu_mouth", "lelu_teeth")]

# ------------------------------------------------ canonical bone orientation
# Her clips (walk, sit, idle…) store bone rotations relative to HER rig's rest
# orientations. A Meshy rig of another body has its joints in the right places but
# its bones can point elsewhere (the coat's neck/Head pointed 15–20° off), so the
# same clip tipped her head back. Each outfit bone keeps its own joint position and
# length but takes LÉLU's rest direction and roll. In rest pose nothing moves (pose
# is identity), so the mesh is untouched; only the bind matrices change.
if job.get("alignBones", True):
    def edit_data(rig):
        bpy.context.view_layer.objects.active = rig
        for o in bpy.data.objects:
            o.select_set(o is rig)
        bpy.ops.object.mode_set(mode="EDIT")
        d = {b.name: ((b.tail - b.head).normalized(), b.roll, b.matrix.copy()) for b in rig.data.edit_bones}
        bpy.ops.object.mode_set(mode="OBJECT")
        return d
    assert all(abs(a - b) < 1e-6 for ra, rb in zip(o_rig.matrix_world, l_rig.matrix_world) for a, b in zip(ra, rb)), "rig object transforms differ"
    canon = edit_data(l_rig)
    bpy.context.view_layer.objects.active = o_rig
    for o in bpy.data.objects:
        o.select_set(o is o_rig)
    bpy.ops.object.mode_set(mode="EDIT")
    aligned = {}
    for b in o_rig.data.edit_bones:
        if b.name not in canon:
            continue
        before = (b.tail - b.head).normalized()
        direction, roll, mat = canon[b.name]
        length = b.length
        b.use_connect = False
        b.tail = b.head + direction * length
        b.align_roll(mat.to_3x3() @ Vector((0, 0, 1)))
        aligned[b.name] = round(math.degrees(before.angle(direction)), 2)
    bpy.ops.object.mode_set(mode="OBJECT")
    report["boneDirectionChangeDeg"] = aligned

h_o = o_rig.matrix_world @ o_rig.data.bones["Head"].head_local
h_l = l_rig.matrix_world @ l_rig.data.bones["Head"].head_local
offset = h_o - h_l
if job.get("headOffset") == "auto":
    # mean of the neck- and Head-bone offsets between the outfit rig and hers (what was
    # worked out by hand for each look in round 2, now computed every time)
    n_o = o_rig.matrix_world @ o_rig.data.bones["neck"].head_local
    n_l = l_rig.matrix_world @ l_rig.data.bones["neck"].head_local
    job["headOffset"] = [round(((h_o - h_l)[i] + (n_o - n_l)[i]) / 2, 4) for i in range(3)]
    job["headOffsetSource"] = "auto: mean of the neck- and Head-bone offsets"
    if job.get("cutZ") == "auto":
        job["cutZ"] = round(1.465 + job["headOffset"][2], 4)
    cut = float(job["cutZ"])
if job.get("headOffset"):
    # the rigger can misplace the Head bone (it did for the coat: 11 cm forward of
    # the neck); then the offset is measured on the generated face instead
    report["headBoneOffsetIgnoredMm"] = [round(x * 1000, 2) for x in offset]
    offset = Vector(job["headOffset"])
    report["headOffsetSource"] = job.get("headOffsetSource", "explicit")
report["headOffsetMm"] = [round(x * 1000, 2) for x in offset]
for o in heads:
    mw = o.matrix_world.copy()
    o.parent = o_rig
    o.matrix_world = Matrix.Translation(offset) @ mw
    for md in o.modifiers:
        if md.type == "ARMATURE":
            md.object = o_rig
    o.name = o.name.split(".")[0]
for o in lelu:
    if o not in heads and o.name in bpy.data.objects:
        bpy.data.objects.remove(o, do_unlink=True)

# cut the outfit's own head
me = o_body.data
W = o_body.matrix_world
hair_mode = job.get("hair", "lelu")
bm = bmesh.new()
bm.from_mesh(me)
if hair_mode == "outfit":
    # Keep the hair Meshy generated from this look's own reference. Her face stays:
    # outfit triangles above the cut are removed only where her face/scalp is
    # (inside it, or within `skinClearMm` of it) or in front of her face; the rest
    # of the generated hair shell, coils and ornaments stays.
    import os as _os
    sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
    import lelu_m25_common as C
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    for nm in ("lelu_hair_ringlets", "lelu_hair_strands"):
        if nm in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[nm], do_unlink=True)
    # her own hair foundation goes; lips and jewellery in that object stay
    hobj = bpy.data.objects["lelu_hair"]
    off_np = __import__("numpy").array(offset)
    HA = C.mesh_arrays(hobj)
    HA["wco"] = HA["wco"] - off_np  # classify in her own coordinates (face box, mouth band)
    hcls = C.classify(hobj, HA, C.triangle_texture(hobj, HA))
    hz = HA["wco"][HA["tv"]].mean(1)[:, 2] + offset.z
    hc = HA["wco"][HA["tv"]].mean(1)  # her own coordinates

    def face_jewel(c3):
        # hoops, forehead jewel, septum: the front half of the head, ear to ear
        return abs(c3[0]) < 0.095 and c3[1] < 0.0 and 1.48 < c3[2] < 1.70
    keep_cls = {"lips", "metal"} | ({"flower"} if job.get("keepFlowers") else set())
    hb = bmesh.new()
    hb.from_mesh(hobj.data)
    hb.faces.ensure_lookup_table()
    # head jewellery only (hoops, forehead, septum, lips); the chains that hung
    # inside the old hair below the neck would float over the new outfit
    in_face_box = C.in_face(hc)

    def keep_hair(i, c, z, c3):
        if c == "hair":
            # the cap: the top and back of her old hair stays as a closed, dark skull under
            # the new hair (removing it left her head hollow - visible in profile and from behind);
            # its long hanging ends and the fringe over her face go
            # the front edge of the cap (above the forehead) read as a black slab in front views
            return c3[2] > 1.53 and not in_face_box[i] and not (c3[1] < float(job.get("capFrontY", -0.03)) and abs(c3[0]) < 0.09)
        return c in keep_cls and z >= cut and not (c == "metal" and not face_jewel(c3))

    drop = set(HA["tp"][[not keep_hair(i, c, z, c3) for i, (c, z, c3) in enumerate(zip(hcls, hz, hc))]].tolist())
    report["leluHairFacesRemoved"] = len(drop)
    bmesh.ops.delete(hb, geom=[hb.faces[i] for i in drop], context="FACES")
    hb.to_mesh(hobj.data)
    hb.free()
    sc = bpy.data.objects["lelu_scalp"]
    SA = C.mesh_arrays(sc)
    SA["wco"] = SA["wco"] - off_np
    scls = C.classify(sc, SA, C.triangle_texture(sc, SA))
    SA["wco"] = SA["wco"] + off_np
    sz = SA["wco"][SA["tv"]].mean(1)[:, 2]
    sc3 = SA["wco"][SA["tv"]].mean(1) - off_np
    sdrop = set(SA["tp"][[(c == "flower" and not job.get("keepFlowers")) or (c == "hair") or (z < cut - 0.01) or (c == "metal" and not face_jewel(c3))
                          # copper-brown highlights in the old hair volume classify as skin; her
                          # real skin is the face, ears and neck - not beyond the ears or behind them
                          or (c3[2] > 1.50 and (abs(c3[0]) > 0.085 or c3[1] > 0.01))
                          for c, z, c3 in zip(scls, sz, sc3)]].tolist())
    sb = bmesh.new()
    sb.from_mesh(sc.data)
    sb.faces.ensure_lookup_table()
    bmesh.ops.delete(sb, geom=[sb.faces[i] for i in sdrop], context="FACES")
    sb.to_mesh(sc.data)
    sb.free()
    report["leluScalpFacesRemoved"] = len(sdrop)
    keepmask = [i not in sdrop for i in SA["tp"]]
    SA["tv"] = SA["tv"][keepmask]
    scls = scls[keepmask]
    # only her FACE skin decides where generated hair is cut (front half of the head)
    face_side = (SA["wco"][SA["tv"]].mean(1) - off_np)[:, 1] < -0.02
    skin_sel = [c in ("skin", "lips") and f for c, f in zip(scls, face_side)]
    tri = SA["wco"][SA["tv"]][skin_sel]
    bvh = BVHTree.FromPolygons(tri.reshape(-1, 3).tolist(), [[3 * i, 3 * i + 1, 3 * i + 2] for i in range(len(tri))])
    clear = float(job.get("skinClearMm", 6)) / 1000
    # per-face albedo of the outfit: generated face/ear skin left near her face is
    # light; generated hair is dark
    OA = C.mesh_arrays(o_body)
    otex = C.triangle_texture(o_body, OA)
    _, _, oval = C.hsv(otex["albedo"][:, :3])
    poly_dark = {}
    for t_, p_ in enumerate(OA["tp"]):
        poly_dark[int(p_)] = poly_dark.get(int(p_), True) and bool(oval[t_] < float(job.get("hairValue", 0.22)))
    light_clear = float(job.get("lightClearMm", 20)) / 1000
    kill = []
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        c = W @ f.calc_center_median()
        if c.z <= cut:
            continue
        loc, nrm, _, dist = bvh.find_nearest(c, 0.5)
        inside = loc is not None and (c - loc).dot(nrm) < 0 and dist < 0.03
        near = loc is not None and (dist < clear or (dist < light_clear and not poly_dark.get(f.index, True)))
        # everything the generated hair grows in front of her ears (its own hairline across her
        # forehead, sideburns over her cheeks) hides her face: cut it; hair starts behind her hairline
        face_front = (abs(c.x - offset.x) < float(job.get("frontCutHalfWidth", 0.10)) and c.y - offset.y < float(job.get("frontCutY", -0.035))
                      and 1.49 + offset.z < c.z < 1.78 + offset.z)
        if inside or near or face_front:
            kill.append(f)
else:
    kill = [f for f in bm.faces if (W @ f.calc_center_median()).z > cut]
report["hairMode"] = hair_mode
report["outfitFacesRemovedAboveCut"] = len(kill)
report["outfitFacesBefore"] = len(bm.faces)
bmesh.ops.delete(bm, geom=kill, context="FACES")
bm.to_mesh(me)
bm.free()
me.update()

# outfit material: tame the chrome through a baked metallic/roughness image
mcfg = job.get("material", {})
ms, rf = float(mcfg.get("metallicScale", 0.55)), float(mcfg.get("roughnessFloor", 0.32))
mat = o_body.material_slots[0].material
mat.name = "look_" + job.get("lookId", "outfit")
node = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def src_image(socket):
    s = node.inputs[socket]
    if not s.is_linked:
        return None
    n = s.links[0].from_node
    for _ in range(4):
        if n.type == "TEX_IMAGE":
            return n
        ins = [i for i in n.inputs if i.is_linked]
        if not ins:
            return None
        n = ins[0].links[0].from_node
    return None


mt, rt = src_image("Metallic"), src_image("Roughness")
stats = {}
if mt is not None and rt is not None and mt.image == rt.image:
    img = mt.image
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    stats["metallicMeanBefore"] = round(float(px[:, 2].mean()), 4)
    stats["roughnessP10Before"] = round(float(np.percentile(px[:, 1], 10)), 4)
    px[:, 2] *= ms
    px[:, 1] = np.maximum(px[:, 1], rf)
    new = bpy.data.images.new(mat.name + "_metalrough", w, h, alpha=False)
    new.colorspace_settings.name = "Non-Color"
    new.pixels.foreach_set(px.reshape(-1))
    new.pack()
    mt.image = new
    stats.update({"metallicMeanAfter": round(float(px[:, 2].mean()), 4), "roughnessFloor": rf, "metallicScale": ms, "packedMR": True})
elif mt is not None:
    # separate metallic / roughness images
    for nd, fn in ((mt, lambda a: a * ms), (rt, lambda a: np.maximum(a, rf))):
        if nd is None:
            continue
        img = nd.image
        w, h = img.size
        px = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        px[:, :3] = fn(px[:, :3])
        new = bpy.data.images.new(img.name + "_m25c", w, h, alpha=True)
        new.colorspace_settings.name = "Non-Color"
        new.pixels.foreach_set(px.reshape(-1))
        new.pack()
        nd.image = new
    stats.update({"metallicScale": ms, "roughnessFloor": rf, "packedMR": False})
report["material"] = stats

report["objects"] = [{"name": o.name, "triangles": sum(len(p.vertices) - 2 for p in o.data.polygons),
                      "shapeKeys": len(o.data.shape_keys.key_blocks) - 1 if o.data.shape_keys else 0}
                     for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
report["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
json.dump(report, open(job["report"], "w"), indent=1)
print("M25C_LOOK", json.dumps({k: report[k] for k in ("headOffsetMm", "outfitFacesRemovedAboveCut", "material")}))
