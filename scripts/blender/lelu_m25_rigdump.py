"""
LÉLU M25 — dump rig, skinning and shape-key data of one GLB for regression.

    blender -b --factory-startup --python lelu_m25_rigdump.py -- <in.glb> <out.npz> <out.json>

Per mesh: world basis positions, every shape key's world-space delta, the
vertex-group names, per-vertex influence count and weight sum. The comparison is
done outside Blender (scripts/foundry/m25_validate.py) by matching vertices on
position, because a glTF round trip is free to reorder or split vertices.
"""
import json
import sys

import bpy
import numpy as np

inp, out_npz, out_json = sys.argv[sys.argv.index("--") + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=inp)
arrays, meta = {}, {"input": inp, "objects": {}}
rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
meta["bones"] = [b.name for b in rig.data.bones] if rig else []
for o in bpy.data.objects:
    if o.type != "MESH" or o.name == "Icosphere":
        continue
    me = o.data
    m = np.array(o.matrix_world)
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    w = co @ m[:3, :3].T + m[:3, 3]
    arrays[o.name + "|basis"] = w
    if me.uv_layers.active:
        # per-vertex UV (first loop that uses the vertex): lets the comparison match a
        # vertex that the repair moved by a few millimetres
        uvl = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers.active.data.foreach_get("uv", uvl)
        lv = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get("vertex_index", lv)
        uvv = np.zeros((n, 2))
        uvv[lv[::-1]] = uvl.reshape(-1, 2)[::-1]
        arrays[o.name + "|uv"] = uvv
    keys = []
    if me.shape_keys:
        for kb in me.shape_keys.key_blocks[1:]:
            k = np.empty(n * 3, np.float32)
            kb.data.foreach_get("co", k)
            kw = k.reshape(-1, 3).astype(np.float64) @ m[:3, :3].T + m[:3, 3]
            arrays[o.name + "|" + kb.name] = kw - w
            keys.append(kb.name)
    inf = np.zeros(n, np.int32)
    wsum = np.zeros(n)
    for v in me.vertices:
        ws = [g.weight for g in v.groups if g.weight > 1e-6]
        inf[v.index] = len(ws)
        wsum[v.index] = sum(ws)
    meta["objects"][o.name] = {
        "vertices": n, "triangles": sum(len(p.vertices) - 2 for p in me.polygons), "shapeKeys": keys,
        "vertexGroups": [g.name for g in o.vertex_groups], "unweighted": int((inf == 0).sum()),
        "maxInfluences": int(inf.max()) if n else 0, "weightSumRange": [round(float(wsum.min()), 4), round(float(wsum.max()), 4)] if n else None,
        "armatureModifier": any(md.type == "ARMATURE" for md in o.modifiers), "parent": o.parent.name if o.parent else None,
        "materials": [s.material.name if s.material else None for s in o.material_slots],
    }
np.savez_compressed(out_npz, **arrays)
json.dump(meta, open(out_json, "w"), indent=1)
print("M25_RIGDUMP", inp, len(meta["objects"]))
