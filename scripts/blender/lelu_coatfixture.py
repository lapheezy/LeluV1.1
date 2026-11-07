"""
==========================================================
LÉLU 3D FORGE — COAT FIXTURE (test double, never an asset)

Builds a garment-shaped shell fitted to a character's own
skeleton so the weighting stage can be exercised and proven
before the real coat exists: an open-fronted, flared coat
from the shoulders to below the knee, with thickness.

It is deliberately NOT a substitute for the supplied design:
it carries no texture, no lapels and no panel construction.
Its only job is to be a mesh in the right place, so a
weighting claim can be tested rather than asserted.

  blender --background --factory-startup \
    --python lelu_coatfixture.py -- '{"body": …, "out": …}'
==========================================================
"""

import json
import math
import sys

import bpy
from mathutils import Vector


def arg_config():
    if "--" not in sys.argv:
        print("[coatfixture] ERROR no JSON after --")
        sys.exit(2)
    return json.loads(sys.argv[sys.argv.index("--") + 1])


def main():
    config = arg_config()
    body_path, out_path = config["body"], config["out"]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=body_path)
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm is None:
        print("[coatfixture] ERROR body has no armature")
        sys.exit(2)

    def head(name, fallback):
        bone = arm.data.bones.get(name)
        return (arm.matrix_world @ bone.head_local) if bone else fallback

    def tail(name, fallback):
        bone = arm.data.bones.get(name)
        return (arm.matrix_world @ bone.tail_local) if bone else fallback

    hips = head("Hips", Vector((0, 0, 0.95)))
    neck = head("Neck", Vector((0, 0, 1.45)))
    shoulder_l = head("LeftArm", Vector((-0.18, 0, 1.4)))
    shoulder_r = head("RightArm", Vector((0.18, 0, 1.4)))
    knee_l = head("LeftLeg", Vector((-0.1, 0, 0.5)))
    ankle_l = head("LeftFoot", Vector((-0.1, 0, 0.08)))

    half_shoulder = max(0.16, (shoulder_r - shoulder_l).length / 2)
    half_hip = max(0.13, abs(hips.z) * 0.0 + 0.16)
    hem_z = min(knee_l.z - 0.22, ankle_l.z + 0.25)
    top_z = max(shoulder_l.z, shoulder_r.z, neck.z - 0.02)
    flare = half_hip * 2.3

    # z, radius — a coat that is close at the shoulders and swings out at the hem.
    levels = [
        (top_z, half_shoulder * 1.02),
        (neck.z - 0.12, half_shoulder * 1.10),
        (hips.z + 0.22, half_hip * 1.06),
        (hips.z, half_hip * 1.02),
        (hips.z - 0.35, (half_hip + flare) / 2),
        (hem_z + 0.3, flare * 0.92),
        (hem_z, flare),
    ]
    centre = Vector(((shoulder_l.x + shoulder_r.x) / 2, (shoulder_l.y + shoulder_r.y) / 2, 0))
    segments = 48
    gap_degrees = 26.0  # the front opening
    vertices = []
    for z, radius in levels:
        for segment in range(segments):
            angle = 2 * math.pi * segment / segments
            degrees = math.degrees(angle) % 360
            if degrees < gap_degrees / 2 or degrees > 360 - gap_degrees / 2:
                continue
            depth = radius * 0.72
            vertices.append((centre.x + math.cos(angle) * radius, centre.y + math.sin(angle) * depth, z))

    ring = len(vertices) // len(levels)
    faces = []
    for level in range(len(levels) - 1):
        for segment in range(ring):
            a = level * ring + segment
            b = level * ring + (segment + 1) % ring
            faces.append((a, b, b + ring, a + ring))

    mesh = bpy.data.meshes.new("coat_fixture")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate()
    obj = bpy.data.objects.new("coat_fixture", mesh)
    bpy.context.collection.objects.link(obj)

    # Thickness, so it is a garment and not a shell of zero depth.
    solidify = obj.modifiers.new("Solidify", "SOLIDIFY")
    solidify.thickness = 0.012
    solidify.offset = 0.0
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    bpy.ops.object.shade_smooth()

    for other in bpy.data.objects:
        other.select_set(other is obj)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", use_selection=True, export_animations=False)
    print(f"[coatfixture] {len(obj.data.vertices)} verts, {len(obj.data.polygons)} faces, top {top_z:.2f}, hem {hem_z:.2f} -> {out_path}")


main()
