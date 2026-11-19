"""
LÉLU CHARACTER FOUNDRY — verify the owned Meshy character, then save the
canonical Blender project.

    blender --background --factory-startup --python lelu_meshy_verify.py -- job.json

job.json: {"input": "…/lelu.glb", "output": "…/meshy/blender.json", "blend": "…/meshy/lelu-canon.blend"}

This is the part a GLB header cannot answer: how many loose parts each mesh has
(so hair/clothing separation is a measured question, not a guess), what the
armature's bones are called, which shape keys exist on which mesh, and where the
head sits in metres. It writes the report and saves a .blend the team can open.

It does not modify the asset and it does not save over the original.
"""
import json
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: blender -b --factory-startup --python lelu_meshy_verify.py -- job.json")
job = json.load(open(argv[0]))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
scene = bpy.context.scene

meshes = [o for o in scene.objects if o.type == "MESH"]
armatures = [o for o in scene.objects if o.type == "ARMATURE"]


def loose_parts(obj):
    """Connected components of the mesh, by walking edges. 224k triangles: fine."""
    mesh = obj.data
    parent = list(range(len(mesh.vertices)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for edge in mesh.edges:
        a, b = find(edge.vertices[0]), find(edge.vertices[1])
        if a != b:
            parent[a] = b
    roots = {find(i) for i in range(len(mesh.vertices))}
    sizes = {}
    for i in range(len(mesh.vertices)):
        r = find(i)
        sizes[r] = sizes.get(r, 0) + 1
    ordered = sorted(sizes.values(), reverse=True)
    return {"count": len(roots), "largestVertices": ordered[:10], "totalVertices": len(mesh.vertices)}


objects = []
for obj in meshes:
    world = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = [min(v[i] for v in world) for i in range(3)]
    hi = [max(v[i] for v in world) for i in range(3)]
    obj.data.calc_loop_triangles()
    keys = obj.data.shape_keys
    objects.append({
        "name": obj.name,
        "triangles": len(obj.data.loop_triangles),
        "vertices": len(obj.data.vertices),
        "materials": [s.material.name if s.material else None for s in obj.material_slots],
        "uvLayers": [uv.name for uv in obj.data.uv_layers],
        "shapeKeys": [kb.name for kb in (keys.key_blocks if keys else [])][1:],
        "parent": obj.parent.name if obj.parent else None,
        "modifiers": [m.type for m in obj.modifiers],
        "bounds_zup_m": {"min": lo, "max": hi, "height": hi[2] - lo[2]},
        "looseParts": loose_parts(obj),
    })

rigs = [{
    "name": arm.name,
    "bones": len(arm.data.bones),
    "boneNames": [b.name for b in arm.data.bones],
    "actions": [a.name for a in bpy.data.actions],
    "posePosition": arm.data.pose_position,
} for arm in armatures]

head = next((o for o in objects if "head" in o["name"].lower()), None)
body = max(objects, key=lambda o: o["triangles"]) if objects else None
total_height = max((o["bounds_zup_m"]["max"][2] for o in objects), default=None)
head_height = head["bounds_zup_m"]["height"] if head else None

report = {
    "input": job["input"],
    "blender": bpy.app.version_string,
    "objects": objects,
    "armatures": rigs,
    "summary": {
        "objects": len(objects),
        "triangles": sum(o["triangles"] for o in objects),
        "materials": sorted({m for o in objects for m in o["materials"] if m}),
        "shapeKeys": sorted({k for o in objects for k in o["shapeKeys"]}),
        "bones": rigs[0]["bones"] if rigs else 0,
        "heightM": total_height,
        "headHeightM": head_height,
        "headToBodyRatio": (head_height / total_height) if head_height and total_height else None,
        "headToBodyBasis": "head object height / total model height, both from world-space bounds",
        "loosePartsPerMesh": {o["name"]: o["looseParts"]["count"] for o in objects},
        "separability": {
            "head": "separate object" if head else "not separate",
            "hair": "fused into the head/body meshes (no hair object, no hair material)" if not any("hair" in (o["name"] + " " + " ".join(m or "" for m in o["materials"])).lower() for o in objects) else "has its own object/material",
            "clothing": "fused into the body mesh (one material per mesh, no garment objects)" if not any("cloth" in (o["name"] + " " + " ".join(m or "" for m in o["materials"])).lower() for o in objects) else "has its own object/material",
        },
        "bodyObject": body["name"] if body else None,
    },
}

with open(job["output"], "w") as fh:
    json.dump(report, fh, indent=1)

if job.get("blend"):
    bpy.ops.wm.save_as_mainfile(filepath=job["blend"], copy=True)

print("MESHY_VERIFY " + json.dumps(report["summary"]))
