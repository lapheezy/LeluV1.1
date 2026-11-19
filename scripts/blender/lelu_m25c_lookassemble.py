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
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
cut = float(job.get("cutZ", 1.465))
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

h_o = o_rig.matrix_world @ o_rig.data.bones["Head"].head_local
h_l = l_rig.matrix_world @ l_rig.data.bones["Head"].head_local
offset = h_o - h_l
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
bm = bmesh.new()
bm.from_mesh(me)
kill = [f for f in bm.faces if (W @ f.calc_center_median()).z > cut]
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
