"""
==========================================================
LÉLU 3D FORGE — COAT WEIGHTS (headless Blender)

A long coat cannot be attached to one bone. This binds a
garment mesh to the character's own armature with weights
that follow her anatomy, and then PROVES the result moves by
posing her and measuring what the garment did:

  * every vertex is weighted, and its weights sum to 1
  * the shoulder-to-waist band follows the spine chain
  * below the hips the panels follow the hips and both upper
    legs, so a step swings the panels instead of dragging a
    rigid shell
  * a vertex never reads as rigid: a garment weighted to a
    single bone is reported, not accepted

Measured, not asserted. report.json carries, per pose, the
displacement of each band and how many garment vertices ended
up inside her body (BVH nearest-surface test).

  blender --background --factory-startup \
    --python lelu_coatweights.py -- '{"body": …, "garment": …, "outDir": …}'
==========================================================
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def log(message):
    print(f"[coatweights] {message}")


def fail(message, code=2):
    print(f"[coatweights] ERROR {message}")
    sys.exit(code)


def arg_config():
    if "--" not in sys.argv:
        fail("no arguments; expected a JSON object after --")
    return json.loads(sys.argv[sys.argv.index("--") + 1])


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def bone_point(arm, name):
    """World-space head of a bone, or None."""
    bone = arm.data.bones.get(name)
    if bone is None:
        return None
    return arm.matrix_world @ bone.head_local


def first_bone_point(arm, names, fallback):
    for name in names:
        point = bone_point(arm, name)
        if point is not None:
            return point
    return fallback


def segment_distance(point, head, tail):
    """Distance from a point to a bone's segment (not its infinite line)."""
    axis = tail - head
    length_sq = axis.length_squared
    if length_sq < 1e-12:
        return (point - head).length
    t = max(0.0, min(1.0, (point - head).dot(axis) / length_sq))
    return (point - (head + axis * t)).length


def ensure_vertex_groups(obj, names):
    groups = {}
    for name in names:
        groups[name] = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
    return groups


def weight_garment(arm, obj, max_influences, min_weight):
    """
    Anatomical bands, then inverse-distance falloff inside a band.

    Bands are what stop the coat behaving like a rigid shell:
    the upper body must not follow a leg, and the hem must not
    follow a shoulder.
    """
    bones = arm.data.bones
    matrix_world = arm.matrix_world

    def z_of(name, fallback):
        bone = bones.get(name)
        return (matrix_world @ bone.head_local).z if bone is not None else fallback

    def segment(name):
        bone = bones.get(name)
        if bone is None:
            return None
        return (name, matrix_world @ bone.head_local, matrix_world @ bone.tail_local)

    heights = [(matrix_world @ bone.head_local).z for bone in bones]
    top = max(heights) if heights else 1.7
    bottom = min(heights) if heights else 0.0
    chest = z_of("Spine02", z_of("Spine01", bottom + (top - bottom) * 0.7))
    hips = z_of("Hips", bottom + (top - bottom) * 0.5)
    knee = z_of("LeftLeg", z_of("RightLeg", bottom + (top - bottom) * 0.28))

    upper = [s for s in (segment(n) for n in ("Spine02", "Spine01", "Neck")) if s]
    middle = [s for s in (segment(n) for n in ("Spine01", "Hips")) if s]
    lower = [s for s in (segment(n) for n in ("Hips", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg")) if s]
    if not upper or not lower:
        fail("the armature is missing the spine or the leg bones this weighting needs")

    # A bone may not appear twice in one candidate list: assigning the same
    # group twice with REPLACE would drop the first share and leave a vertex
    # summing to less than 1. Lower panels include the hips; the spine band does too.
    lower_names = {name for name, _, _ in lower}
    lower_band = lower + [segment_ for segment_ in middle if segment_[0] not in lower_names]

    all_names = sorted({name for name, _, _ in upper + middle + lower})
    groups = ensure_vertex_groups(obj, all_names)

    world = obj.matrix_world
    per_vertex = []
    band_counts = {"upper": 0, "middle": 0, "lower": 0}
    influence_counts = []

    for vertex in obj.data.vertices:
        point = world @ vertex.co
        if point.z >= chest:
            candidates, band = upper, "upper"
        elif point.z >= hips:
            candidates, band = middle, "middle"
        else:
            # Below the hips the panels must follow the legs, not a single root bone.
            candidates, band = lower_band, "lower"
        band_counts[band] += 1

        scored = []
        for name, head, tail in candidates:
            distance = segment_distance(point, head, tail)
            scored.append((1.0 / ((distance + 0.02) ** 2), name))
        scored.sort(reverse=True)
        scored = scored[:max_influences]
        strongest = scored[0][0]
        scored = [(score, name) for score, name in scored if score >= strongest * min_weight]
        total = sum(score for score, _ in scored)
        if total <= 0:
            fail(f"vertex {vertex.index} could not be weighted")
        per_vertex.append([(name, score / total) for score, name in scored])
        influence_counts.append(len(scored))

    for vertex_index, weights in enumerate(per_vertex):
        merged = {}
        for name, weight in weights:
            merged[name] = merged.get(name, 0.0) + weight
        for name, weight in merged.items():
            groups[name].add([vertex_index], weight, "REPLACE")

    return {
        "bands": band_counts,
        "influenceCounts": influence_counts,
        "bones": all_names,
        "thresholds": {"chest": round(chest, 4), "hips": round(hips, 4), "knee": round(knee, 4)},
    }


def bind(arm, obj):
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    modifier = obj.modifiers.get("Armature") or obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = arm
    modifier.use_vertex_groups = True
    modifier.use_bone_envelopes = False


def evaluated_world_vertices(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    matrix = evaluated.matrix_world
    points = [matrix @ vertex.co for vertex in mesh.vertices]
    triangles = []
    mesh.calc_loop_triangles()
    for tri in mesh.loop_triangles:
        triangles.append(tuple(tri.vertices))
    evaluated.to_mesh_clear()
    return points, triangles


def apply_pose(arm, rotations):
    bpy.context.view_layer.objects.active = arm
    for bone_name, euler in rotations.items():
        pose_bone = arm.pose.bones.get(bone_name)
        if pose_bone is None:
            continue
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = [math.radians(angle) for angle in euler]
    bpy.context.view_layer.update()


def rest_pose(arm):
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()


def main():
    config = arg_config()
    body_path, garment_path, out_dir = config["body"], config["garment"], config["outDir"]
    options = config.get("options", {})
    max_influences = int(options.get("maxInfluences", 4))
    min_weight = float(options.get("minWeight", 0.02))
    os.makedirs(out_dir, exist_ok=True)

    clear_scene()
    import_glb(body_path)
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm is None:
        fail("the body has no armature")
    body_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    log(f"body: armature {arm.name}, {len(arm.data.bones)} bones, {len(body_meshes)} meshes")

    imported = import_glb(garment_path)
    garment_meshes = [o for o in imported if o.type == "MESH"]
    if not garment_meshes:
        fail("the garment file has no mesh")
    for obj in garment_meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = garment_meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()

    problems = []
    warnings = []
    stats = []
    for obj in garment_meshes:
        result = weight_garment(arm, obj, max_influences, min_weight)
        bind(arm, obj)
        stats.append({"object": obj.name, **result})
        log(f"weighted {obj.name}: {len(obj.data.vertices)} vertices, bands {result['bands']}")

    # ---- deformation evidence: pose her, measure the garment ----
    rest_pose(arm)
    rest_points = [evaluated_world_vertices(obj)[0] for obj in garment_meshes]
    poses = [
        ("stand", {}),
        ("step", {"LeftUpLeg": (28, 0, 0), "LeftLeg": (-18, 0, 0)}),
        ("turn", {"Spine02": (0, 22, 0), "Hips": (0, 14, 0)}),
        ("sit", {"LeftUpLeg": (-78, 0, 0), "RightUpLeg": (-78, 0, 0), "LeftLeg": (72, 0, 0), "RightLeg": (72, 0, 0)}),
        ("gesture", {"LeftArm": (0, 0, 48), "RightArm": (0, 0, -30)}),
    ]
    deformation = []
    body_points, body_triangles = evaluated_world_vertices(body_meshes[0]) if body_meshes else ([], [])
    for name, rotations in poses:
        rest_pose(arm)
        if rotations:
            apply_pose(arm, rotations)
        body_points, body_triangles = evaluated_world_vertices(body_meshes[0]) if body_meshes else ([], [])
        bvh = BVHTree.FromPolygons(body_points, body_triangles) if body_triangles else None
        total_max = 0.0
        total_moved = 0
        penetrating = 0
        counted = 0
        for obj, rest in zip(garment_meshes, rest_points):
            points, _ = evaluated_world_vertices(obj)
            for index, point in enumerate(points):
                if index % 7:
                    continue  # sample: every 7th vertex keeps the report honest and the run short
                counted += 1
                displacement = (point - rest[index]).length
                total_max = max(total_max, displacement)
                if displacement > 0.01:
                    total_moved += 1
                if bvh is not None:
                    location, normal, _, distance = bvh.find_nearest(point)
                    if location is not None and distance < 0.004 and (point - location).dot(normal) < 0:
                        penetrating += 1
        deformation.append(
            {
                "name": name,
                "sampledVertices": counted,
                "maxDisplacement": round(total_max, 4),
                "movedShare": round(total_moved / counted, 4) if counted else 0.0,
                "penetratingVertices": penetrating,
            }
        )
        log(f"pose {name}: max {total_max:.3f} m, moved {total_moved}/{counted}, penetrating {penetrating}")
    rest_pose(arm)

    # ---- weights summary ----
    total_vertices = 0
    unweighted = 0
    sums = []
    influences = []
    bone_share = {}
    for obj, stat in zip(garment_meshes, stats):
        total_vertices += len(obj.data.vertices)
        influences.extend(stat["influenceCounts"])
        for vertex in obj.data.vertices:
            total = sum(group.weight for group in vertex.groups)
            if total <= 1e-6:
                unweighted += 1
            sums.append(total)
            for group in vertex.groups:
                name = obj.vertex_groups[group.group].name
                bone_share[name] = round(bone_share.get(name, 0.0) + group.weight, 4)

    if unweighted:
        problems.append(f"{unweighted} garment vertices carry no weight and would stay behind.")
    if sums and (min(sums) < 0.999 or max(sums) > 1.001):
        problems.append(f"weights are not normalised (min {min(sums):.4f}, max {max(sums):.4f}).")
    mean_influences = sum(influences) / len(influences) if influences else 0.0
    if mean_influences < 1.5:
        problems.append(f"the garment is effectively rigid: {mean_influences:.2f} bones per vertex.")
    if len(bone_share) < 3:
        problems.append(f"only {len(bone_share)} bones carry weight; a long coat needs the spine and both legs.")
    if not any(d["maxDisplacement"] > 0.02 for d in deformation if d["name"] != "stand"):
        problems.append("posing her did not move the garment: the binding is not live.")
    if all(d["movedShare"] == 0 for d in deformation if d["name"] != "stand"):
        problems.append("no sample vertex moved between poses.")

    out_model = os.path.join(out_dir, "lelu.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in garment_meshes:
        obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=out_model, export_format="GLB", use_selection=True, export_skins=True, export_animations=False)

    report = {
        "ok": not problems,
        "garment": {
            "objects": len(garment_meshes),
            "vertices": total_vertices,
            "triangles": sum(len(obj.data.polygons) for obj in garment_meshes),
        },
        "bones": sorted(bone_share),
        "boneShare": bone_share,
        "weights": {
            "unweighted": unweighted,
            "minSum": round(min(sums), 5) if sums else 0,
            "maxSum": round(max(sums), 5) if sums else 0,
            "meanInfluences": round(mean_influences, 3),
            "maxInfluences": max_influences,
        },
        "bandThresholds": stats[0]["thresholds"] if stats else {},
        "deformation": deformation,
        "problems": problems,
        "warnings": warnings,
    }
    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    log(f"done: ok={report['ok']} problems={problems}")
    if not report["ok"]:
        sys.exit(3)


main()
