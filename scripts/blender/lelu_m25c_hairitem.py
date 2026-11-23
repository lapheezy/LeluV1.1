"""
LÉLU M25 Complete — a Meshy hairstyle becomes her own wardrobe item.

    blender -b --factory-startup --python lelu_m25c_hairitem.py -- job.json
    job: {"look": bald look glb, "hair": Meshy GLB (hair on a mannequin bust), "output": glb, "report": json,
          "name": "hair_copper_coils", "headOffset": [x,y,z], "decimate": 0.55, "textureSize": 1024,
          "fit": {"scale": 1.0, "dx": 0, "dy": 0, "dz": 0}}

1. The mannequin goes. Meshy puts the hair on a grey/black bust; colour cannot separate a black bust
   from dark curls, and the remeshed normals are too noisy for smoothness tests. Geometry can: the
   mannequin is the innermost surface. A triangle is the mannequin when a ray from it toward the
   inside (the mannequin's head centre for the head, the vertical neck axis for neck and bust) meets
   nothing. Hair lies outside the mannequin, so its inward ray always meets it.
2. The hair is fitted to HER head: uniform scale from the mannequin's chin-to-crown height to hers,
   then her chin height, her nose-tip depth and her midline. `fit` adds a manual correction.
3. Anything left inside her head is removed (hidden anyway), the mesh is decimated and its textures
   downsized for the app.
4. It is skinned to the look's own skeleton (Head above the neck, blending to Neck and Spine02 down
   the back), so long hair follows her neck and back instead of swinging rigidly with her head.
   The exported GLB holds the armature and this one mesh; the client binds it to her live bones by
   name (src/app/scene/genesis/PlacedModel.tsx), so any hairstyle can be worn with any look.
"""
import hashlib
import json
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_m25_common as C  # noqa: E402

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
OFF = np.array(job["headOffset"], float)
R = {"job": {k: v for k, v in job.items() if k not in ("report",)}}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["look"])
for o in list(bpy.data.objects):
    if o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()
bpy.context.view_layer.update()
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
look_objects = [o for o in bpy.data.objects if o.type == "MESH"]

# ------------------------------------------------ her landmarks (her coordinates = world - OFF)
mask = bpy.data.objects["lelu_scalp"]
MA = C.mesh_arrays(mask)
mq = MA["wco"][MA["tv"]].mean(1) - OFF
front = mq[:, 1] < -0.05
her_chin = float(np.percentile(mq[front & (np.abs(mq[:, 0]) < 0.02), 2], 1))
# the nose tip: most forward midline point between mouth and brow (the forehead, where the old
# headpiece was pressed flat, is excluded)
nose = front & (np.abs(mq[:, 0]) < 0.012) & (mq[:, 2] > 1.545) & (mq[:, 2] < 1.59)
her_nose_y = float(np.sort(mq[nose, 1])[:5].mean())
skull = bpy.data.objects.get("lelu_skull")
if skull is not None:
    SKA = C.mesh_arrays(skull)
    her_top = float((SKA["wco"][:, 2] - OFF[2]).max())
else:
    her_top = 1.70
R["her"] = {"chinZ": round(her_chin, 4), "noseTipY": round(her_nose_y, 4), "crownZ": round(her_top, 4)}

# ------------------------------------------------ the Meshy hair
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=job["hair"])
new = [o for o in bpy.data.objects if o not in before]
hm = [o for o in new if o.type == "MESH"]
for o in new:
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
if len(hm) > 1:
    bpy.ops.object.select_all(action="DESELECT")
    for o in hm:
        o.select_set(True)
    bpy.context.view_layer.objects.active = hm[0]
    bpy.ops.object.join()
hair = hm[0]
hair.parent = None
hair.data.transform(hair.matrix_world)
hair.matrix_world.identity()
hair.name = job.get("name", "lelu_hair_item")

A = C.mesh_arrays(hair)
T = C.triangle_texture(hair, A)
_, sat, val = C.hsv(T["albedo"][:, :3])
tri = A["wco"][A["tv"]]
cen = tri.mean(1)
white = (sat < 0.2) & (val > 0.45) & (cen[:, 1] < np.median(cen[:, 1]) - 0.05)
wf = cen[white]
x0 = float(np.median(wf[:, 0]))
chin0 = float(np.percentile(wf[:, 2], 2))
browtop0 = float(np.percentile(wf[:, 2], 98))
fh = browtop0 - chin0
face_y = float(np.percentile(wf[:, 1], 2))
hc = np.array([x0, face_y + 0.62 * fh, chin0 + 0.55 * fh])  # inside the mannequin's head
axis_y = face_y + 0.75 * fh
zone_bottom = chin0 - float(job.get("bustDepth", 1.1)) * fh
mann = np.zeros(len(cen), bool)
head_targets = [hc, hc + np.array([0, 0.12 * fh, 0.1 * fh]), hc + np.array([0, -0.1 * fh, -0.15 * fh])]
neck_t = [float(t) for t in job.get("neckTargets", [0.35, 0.5, 0.65, 0.8])]
in_zone = cen[:, 2] >= zone_bottom
# The mannequin is a thick shell (an outer and an inner surface): each pass peels the innermost
# remaining layer, so `peel` passes take its layers off while the hair outside them stays.
peel_counts = []
for _pass in range(int(job.get("peel", 2))):
    live = np.nonzero(~mann)[0]
    lt = tri[live]
    bvh = BVHTree.FromPolygons(lt.reshape(-1, 3).tolist(), np.arange(len(lt) * 3).reshape(-1, 3).tolist())
    found = []
    for i in live[in_zone[live]]:
        p = cen[i]
        if p[2] > chin0 - 0.15 * fh:
            targets = head_targets
        else:
            targets = [np.array([x0, face_y + t * fh, p[2]]) for t in neck_t] + [hc]
        for tgt in targets:
            d = tgt - p
            dist = float(np.linalg.norm(d))
            if dist < 1e-6:
                found.append(i)
                break
            d /= dist
            hit = bvh.ray_cast(Vector((p + d * 0.002).tolist()), Vector(d.tolist()), dist)
            if hit[0] is None:
                found.append(i)
                break
    found = np.array(found, int)
    if _pass > 0 and len(found) and job.get("shellMax") is not None:
        # a later pass may only take the mannequin's other wall: triangles within the shell's
        # thickness of what the first pass took. Hair resting on the mannequin lies further out.
        from scipy.spatial import cKDTree
        dd, _ = cKDTree(cen[first]).query(cen[found])
        R.setdefault("peelDistancePct", []).append([round(float(x), 4) for x in np.percentile(dd, [10, 25, 50, 75, 90, 97])])
        found = found[dd <= float(job["shellMax"])]
    if _pass == 0:
        first = found
    mann[found] = True
    peel_counts.append(len(found))
R["peelPasses"] = peel_counts
# the mannequin's face is also its white skin; and stray hair-free islands inside its volume go with it
mann |= white
# grey mannequin skin the rays missed at the hairline: hair is saturated brown/copper, the mannequin is not
mann |= (sat < float(job.get("greySat", 0.15))) & (cen[:, 2] > chin0 - 0.15 * fh)
R["mannequin"] = {"triangles": int(mann.sum()), "of": int(len(cen)), "chinZ": round(chin0, 4), "faceTopZ": round(browtop0, 4)}

if job.get("debugRender"):
    # colour the classification (red = mannequin, blue = hair) and render front + side, then stop
    me = hair.data
    for k, c in enumerate(((0.15, 0.35, 0.9, 1), (0.9, 0.1, 0.1, 1))):
        m = bpy.data.materials.new(f"dbg{k}")
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = c
        me.materials.append(m) if k else (me.materials.clear(), me.materials.append(m))
    mi = np.zeros(len(me.polygons), np.int32)
    mi[A["tp"][mann]] = 1
    me.polygons.foreach_set("material_index", mi)
    for o in look_objects:
        o.hide_render = True
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = 4; sc.cycles.use_denoising = False
    sc.render.resolution_x = sc.render.resolution_y = 500
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.5
    cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.1
    for nm, loc, rot in (("front", (0, -4, 0), (np.pi / 2, 0, 0)), ("side", (4, 0, 0), (np.pi / 2, 0, np.pi / 2)), ("cut", (0, 4, 0), (np.pi / 2, 0, np.pi))):
        cam.location = loc; cam.rotation_euler = rot
        sc.render.filepath = job["debugRender"].replace(".png", f"-{nm}.png")
        bpy.ops.render.render(write_still=True)
    print("M25C_HAIRITEM_DEBUG", int(mann.sum()))
    raise SystemExit(0)

# mannequin crown (for the scale): the highest mannequin triangle near the midline
crown = mann & (np.abs(cen[:, 0] - x0) < 0.25 * fh) & (cen[:, 2] > chin0)
top0 = float(np.percentile(cen[crown, 2], 99.5)) if crown.any() else browtop0 + 0.35 * fh
nose0 = float(cen[mann & (np.abs(cen[:, 0] - x0) < 0.03 * fh) & (cen[:, 2] > chin0) & (cen[:, 2] < chin0 + 0.6 * fh), 1].min())

bm = bmesh.new()
bm.from_mesh(hair.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in set(A["tp"][mann].tolist())], context="FACES")
bm.to_mesh(hair.data)
bm.free()

# ------------------------------------------------ fit to her head
fit = job.get("fit", {})
# scale from the face (chin to hairline: where the mannequin's white skin ends, and her own
# hairline), which the peeling cannot move; the crown is reported only
her_hairline = float(job.get("herHairlineZ", 1.662))
s = (her_hairline - her_chin) / (browtop0 - chin0) * float(fit.get("scale", 1.0))
tx = OFF[0] + 0.0 - x0 * s + float(fit.get("dx", 0))
ty = OFF[1] + her_nose_y - nose0 * s + float(fit.get("dy", 0))
tz = OFF[2] + her_chin - chin0 * s + float(fit.get("dz", 0))
co = np.empty(len(hair.data.vertices) * 3, np.float32)
hair.data.vertices.foreach_get("co", co)
co = co.reshape(-1, 3) * s + np.array([tx, ty, tz])
hair.data.vertices.foreach_set("co", co.astype(np.float32).reshape(-1))
hair.data.update()
R["fit"] = {"scale": round(s, 5), "translate": [round(float(v), 4) for v in (tx, ty, tz)], "mannequinCrownZ": round(top0, 4), "mannequinNoseY": round(nose0, 4)}

# ------------------------------------------------ remove what is inside her head (hidden anyway)
E = job.get("headEllipsoid", {"centre": [0.0, -0.015, 1.585], "radii": [0.066, 0.088, 0.105], "front": 0.07, "below": 0.09})
A2 = C.mesh_arrays(hair)
q = A2["wco"][A2["tv"]].mean(1) - OFF
ec = np.array(E["centre"])
ry = np.where(q[:, 1] < ec[1], float(E.get("front", E["radii"][1])), E["radii"][1])
rz = np.where(q[:, 2] < ec[2], float(E["below"]), E["radii"][2])
inside = (((q[:, 0] - ec[0]) / E["radii"][0]) ** 2 + ((q[:, 1] - ec[1]) / ry) ** 2 + ((q[:, 2] - ec[2]) / rz) ** 2) < 1.0
# and in front of her face: nothing of the hairstyle may hang over her eyes, nose or mouth
face_box = (np.abs(q[:, 0]) < float(job.get("faceHalfWidth", 0.045))) & (q[:, 1] < -0.05) & (q[:, 2] > her_chin - 0.01) & (q[:, 2] < float(job.get("faceTopZ", 1.645)))
drop = inside | face_box
bm = bmesh.new()
bm.from_mesh(hair.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in set(A2["tp"][drop].tolist())], context="FACES")
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
# loose crumbs (mannequin seams the rays missed)
bm.faces.ensure_lookup_table()
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
    if len(comp) < int(job.get("crumbFaces", 12)):
        kill += comp
bmesh.ops.delete(bm, geom=kill, context="FACES")
bm.to_mesh(hair.data)
bm.free()
R["removedInsideHead"] = int(inside.sum())
R["removedOverFace"] = int(face_box.sum())
R["crumbsRemoved"] = len(kill)

# ------------------------------------------------ lighter for the app
dec = float(job.get("decimate", 0.55))
if dec < 1.0:
    mod = hair.modifiers.new("dec", "DECIMATE")
    mod.ratio = dec
    bpy.context.view_layer.objects.active = hair
    bpy.ops.object.modifier_apply(modifier=mod.name)
size = int(job.get("textureSize", 1024))
for m in hair.data.materials:
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image and max(n.image.size) > size:
                n.image.scale(size, size)
R["triangles"] = sum(len(p.vertices) - 2 for p in hair.data.polygons)

# ------------------------------------------------ skin to her skeleton
names = {b.name for b in rig.data.bones}
def bone(*cands):
    return next((c for c in cands if c in names), None)
head_b, neck_b, spine_b = bone("Head"), bone("neck", "Neck"), bone("Spine02", "Spine01", "Spine")
co = np.array([v.co[:] for v in hair.data.vertices])
z = co[:, 2] - OFF[2]
w_head = np.clip((z - float(job.get("neckZ", 1.47))) / 0.06, 0, 1)
w_neck = np.clip((z - 1.30) / 0.17, 0, 1) * (1 - w_head)
w_sp = 1 - w_head - w_neck
groups = {k: hair.vertex_groups.new(name=k) for k in {head_b, neck_b or head_b, spine_b} if k}
for i in range(len(co)):
    for k, w in ((head_b, w_head[i]), (neck_b or head_b, w_neck[i]), (spine_b, w_sp[i])):
        if k and w > 1e-4:
            groups[k].add([i], float(w), "ADD")
hair.parent = rig
hair.matrix_parent_inverse = rig.matrix_world.inverted()
hair.modifiers.new("Armature", "ARMATURE").object = rig
R["skin"] = {"bones": sorted(groups), "verticesOnHead": int((w_head > 0.5).sum()), "vertices": int(len(co))}

# ------------------------------------------------ export: armature + this one mesh
for o in look_objects:
    bpy.data.objects.remove(o, do_unlink=True)
os.makedirs(os.path.dirname(os.path.abspath(job["output"])), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_animations=False,
                          export_skins=True, export_morph=False, export_image_format="JPEG", export_jpeg_quality=88)
R["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
R["outputBytes"] = os.path.getsize(job["output"])
json.dump(R, open(job["report"], "w"), indent=1)
print("M25C_HAIRITEM", json.dumps({k: R.get(k) for k in ("her", "mannequin", "fit", "triangles", "outputBytes")}))
