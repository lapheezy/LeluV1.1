"""
==========================================================
LÉLU 3D FORGE — BLENDER POST-PROCESS (headless)

Runs inside Blender (or the `bpy` Python module) on a GLB the
Forge downloaded and inspected:

  blender --background --python lelu_postprocess.py -- '<json>'
  python lelu_postprocess.py -- '<json>'        (bpy module)

  json: { "input": ".../rigged.glb", "outDir": "...",
          "faceKeys": true, "mobile": {"targetTris": 24000,
          "textureSize": 1024}, "previews": true }

What it does, and reports in outDir/report.json:

  clean      removes loose meshes that are not part of the
             character (no skin weights, no parent) when an
             armature is present
  measure    height, feet height, facing, bone list
  face       a Meshy rig has no face controls. This finds the
             face from the mesh itself (head bone weights +
             the front profile: nose tip, mouth line) and adds
             ARKit-named shape keys the avatar behaviour
             already drives: eyeBlinkLeft/Right, eyeWideLeft/
             Right, jawOpen, mouthSmileLeft/Right,
             mouthFrownLeft/Right, browInnerUp,
             browDownLeft/Right. They move painted features
             (the eyes and lips are texture, not separate
             geometry), so they read at conversational
             distance, not in a close-up.
  mobile     a lighter copy for phones: decimated to a
             triangle budget, textures downscaled, JPEG
  previews   Cycles CPU renders of the face neutral and with
             the keys on, and the full body, for review

Nothing is uploaded and nothing spends credits.
==========================================================
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

ARGS = json.loads(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else {}
INPUT = ARGS["input"]
OUT = ARGS["outDir"]
os.makedirs(OUT, exist_ok=True)
REPORT = {"input": os.path.basename(INPUT), "steps": [], "warnings": []}


def log(step, **data):
    REPORT["steps"].append({"step": step, **data})
    print(f"[lelu-postprocess] {step} {json.dumps(data)}", flush=True)


def load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=INPUT)
    armature = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    removed = []
    if armature:
        for o in list(bpy.data.objects):
            if o.type == "MESH" and o.parent is None and len(o.vertex_groups) == 0:
                removed.append(o.name)
                bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    body = max(meshes, key=lambda o: len(o.data.vertices))
    return armature, body, removed


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def world_verts(obj):
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def bone_head(armature, name):
    for b in armature.data.bones:
        if b.name.lower() == name.lower():
            return armature.matrix_world @ b.head_local
    return None


# --------------------------------------------------------------- face ---


def find_face(armature, body):
    """Landmarks in world space (Blender: z up, the character faces -y)."""
    verts = world_verts(body)
    zs = [v.z for v in verts]
    height = max(zs) - min(zs)
    s = height / 1.75  # proportions below are for a 1.75 m figure
    head_group = next((g for g in body.vertex_groups if g.name.lower() == "head"), None)
    if armature is None or head_group is None:
        return None, "no Head bone / weights"
    gi = head_group.index
    head_w = {}
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == gi and g.weight > 0.3:
                head_w[v.index] = g.weight
    head_base = bone_head(armature, "Head")
    head_top = bone_head(armature, "head_end") or head_base + Vector((0, 0, 0.25 * s))
    hv = [verts[i] for i in head_w]
    if len(hv) < 200:
        return None, f"only {len(hv)} head vertices"
    cy = sum(v.y for v in hv) / len(hv)
    cx = sum(v.x for v in hv) / len(hv)
    span = head_top.z - head_base.z
    # Front profile: the frontmost point of a narrow centre column, per 2 mm slice.
    column = [v for v in hv if abs(v.x - cx) < 0.012 * s and v.y < cy]
    lo, hi = head_base.z + 0.15 * span, head_base.z + 0.65 * span
    slices = {}
    for v in column:
        if lo <= v.z <= hi:
            k = int((v.z - lo) / (0.002 * s))
            if k not in slices or v.y < slices[k].y:
                slices[k] = v
    if len(slices) < 10:
        return None, "face profile too sparse"
    nose = min(slices.values(), key=lambda v: v.y)
    # Mouth line: the deepest recess of the profile 18–45 mm below the nose tip.
    below = [v for v in slices.values() if nose.z - 0.045 * s <= v.z <= nose.z - 0.018 * s]
    mouth_z = max(below, key=lambda v: v.y).z if below else nose.z - 0.03 * s
    face_front = nose.y
    eye_z = nose.z + 0.036 * s
    chin_z = mouth_z - 0.04 * s
    eye_dx = 0.031 * s
    landmarks = {
        "scale": s,
        "centreX": cx,
        "headCentreY": cy,
        "noseTip": list(nose),
        "mouthZ": mouth_z,
        "eyeZ": eye_z,
        "chinZ": chin_z,
        "eyeLeft": [cx + eye_dx, face_front + 0.02 * s, eye_z],
        "eyeRight": [cx - eye_dx, face_front + 0.02 * s, eye_z],
        "mouthCornerLeft": [cx + 0.023 * s, face_front + 0.012 * s, mouth_z],
        "mouthCornerRight": [cx - 0.023 * s, face_front + 0.012 * s, mouth_z],
        "headVertices": len(hv),
        "profileSlices": len(slices),
    }
    return {"lm": landmarks, "head": head_w, "verts": verts}, None


def smooth(edge0, edge1, x):
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def gauss(d2, r):
    return math.exp(-d2 / (r * r))


def add_face_keys(body, face):
    lm = face["lm"]
    s = lm["scale"]
    head = face["head"]
    verts = face["verts"]
    inv = body.matrix_world.inverted()
    front = [i for i in head if verts[i].y < lm["headCentreY"]]
    if not body.data.shape_keys:
        body.shape_key_add(name="Basis", from_mix=False)
    counts = {}

    def key(name, move):
        k = body.shape_key_add(name=name, from_mix=False)
        n = 0
        for i in front:
            w = verts[i]
            _CUR[0] = i
            d = move(w)
            if d is None or d.length < 1e-6:
                continue
            k.data[i].co = inv @ (w + d)
            n += 1
        counts[name] = n

    def eye(centre, close):
        ex, ez = centre[0], centre[2]

        def move(w):
            h = gauss((w.x - ex) ** 2, 0.016 * s) * (1 if abs(w.x - ex) < 0.028 * s else 0)
            if h < 0.02 or abs(w.z - ez) > 0.02 * s or w.y > lm["noseTip"][1] + 0.05 * s:
                return None
            if close:
                # Lids meet slightly below the eye centre: squash the eye band onto that line.
                line = ez - 0.002 * s
                dz = (line - w.z) * (0.85 if w.z > line else 0.45)
            else:
                dz = (w.z - ez) * 0.22
            return Vector((0, 0, dz * h * (1 - smooth(0.012 * s, 0.02 * s, abs(w.z - ez)))))

        return move

    key("eyeBlinkLeft", eye(lm["eyeLeft"], True))
    key("eyeBlinkRight", eye(lm["eyeRight"], True))
    key("eyeWideLeft", eye(lm["eyeLeft"], False))
    key("eyeWideRight", eye(lm["eyeRight"], False))

    # Jaw: rotate the lower face about a hinge behind and above the mouth.
    hinge_y = lm["headCentreY"] + 0.01 * s
    hinge_z = lm["noseTip"][2] - 0.004 * s
    angle = math.radians(8)

    def jaw(w):
        wz = 1 - smooth(lm["mouthZ"] - 0.008 * s, lm["mouthZ"] + 0.002 * s, w.z)
        wz *= smooth(lm["chinZ"] - 0.045 * s, lm["chinZ"] - 0.01 * s, w.z)
        wx = 1 - smooth(0.05 * s, 0.075 * s, abs(w.x - lm["centreX"]))
        wt = wz * wx * head[_CUR[0]]
        if wt < 0.01:
            return None
        y, z = w.y - hinge_y, w.z - hinge_z
        ny = y * math.cos(angle) - z * math.sin(angle)
        nz = y * math.sin(angle) + z * math.cos(angle)
        return Vector((0, (ny - y) * wt, (nz - z) * wt))

    key("jawOpen", jaw)

    def corner(c, up):
        def move(w):
            g = gauss((w.x - c[0]) ** 2 + (w.z - c[2]) ** 2, 0.013 * s)
            if g < 0.02:
                return None
            out = 1 if c[0] > lm["centreX"] else -1
            return Vector((0.0015 * s * out * g, 0.0015 * s * g, up * s * g))

        return move

    key("mouthSmileLeft", corner(lm["mouthCornerLeft"], 0.0065))
    key("mouthSmileRight", corner(lm["mouthCornerRight"], 0.0065))
    key("mouthFrownLeft", corner(lm["mouthCornerLeft"], -0.0035))
    key("mouthFrownRight", corner(lm["mouthCornerRight"], -0.0035))

    brow_z = lm["eyeZ"] + 0.021 * s

    def brow(cx_, up, r):
        def move(w):
            g = gauss((w.x - cx_) ** 2 + (w.z - brow_z) ** 2, r * s)
            return Vector((0, 0, up * s * g)) if g > 0.02 else None

        return move

    key("browInnerUp", lambda w: (brow(lm["centreX"] + 0.012 * s, 0.004, 0.012)(w) or Vector()) + (brow(lm["centreX"] - 0.012 * s, 0.004, 0.012)(w) or Vector()))
    key("browDownLeft", brow(lm["eyeLeft"][0], -0.003, 0.016))
    key("browDownRight", brow(lm["eyeRight"][0], -0.003, 0.016))
    return counts


_CUR = [0]  # index of the vertex being moved (head weights are per index)



# ------------------------------------------------------------- mobile ---


def make_mobile(body, target_tris, texture_size):
    before = tri_count(body)
    if before > target_tris:
        mod = body.modifiers.new("lelu_decimate", "DECIMATE")
        mod.ratio = target_tris / before
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = body
        while body.modifiers[0].name != mod.name:
            bpy.ops.object.modifier_move_up(modifier=mod.name)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    scaled = []
    for img in bpy.data.images:
        if img.size[0] > texture_size or img.size[1] > texture_size:
            f = texture_size / max(img.size[0], img.size[1])
            scaled.append([img.name, list(img.size)])
            img.scale(max(1, int(img.size[0] * f)), max(1, int(img.size[1] * f)))
    return before, tri_count(body), scaled


def export(path, jpeg=False):
    # Morph normals would double the file for no visible gain on these small offsets.
    kwargs = dict(filepath=path, export_format="GLB", export_skins=True, export_morph=True, export_morph_normal=False, export_animations=True, export_yup=True)
    if jpeg:
        kwargs.update(export_image_format="JPEG", export_jpeg_quality=85)
    bpy.ops.export_scene.gltf(**kwargs)
    return os.path.getsize(path)


# ------------------------------------------------------------ previews ---


def render(path, target, distance, size=512):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("lelu_world")
    scene.world.color = (0.05, 0.04, 0.07)
    if "lelu_cam" not in bpy.data.objects:
        cam = bpy.data.objects.new("lelu_cam", bpy.data.cameras.new("lelu_cam"))
        scene.collection.objects.link(cam)
        key = bpy.data.objects.new("lelu_key", bpy.data.lights.new("lelu_key", "SUN"))
        key.data.energy = 3.5
        key.rotation_euler = (math.radians(60), 0, math.radians(-25))
        scene.collection.objects.link(key)
        fill = bpy.data.objects.new("lelu_fill", bpy.data.lights.new("lelu_fill", "SUN"))
        fill.data.energy = 1.5
        fill.rotation_euler = (math.radians(70), 0, math.radians(160))
        scene.collection.objects.link(fill)
        scene.camera = cam
    cam = bpy.data.objects["lelu_cam"]
    cam.data.lens = 85
    cam.location = Vector(target) + Vector((0, -distance, 0))
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def set_keys(body, values):
    if not body.data.shape_keys:
        return
    for kb in body.data.shape_keys.key_blocks[1:]:
        kb.value = values.get(kb.name, 0.0)


# --------------------------------------------------------------- main ---


def main():
    armature, body, removed = load()
    if armature:
        armature.data.pose_position = "REST"
    verts = world_verts(body)
    zs = [v.z for v in verts]
    log(
        "measure",
        removedLooseMeshes=removed,
        height=round(max(zs) - min(zs), 4),
        feetZ=round(min(zs), 4),
        triangles=tri_count(body),
        bones=[b.name for b in armature.data.bones] if armature else [],
        facing="-Y in Blender (glTF +Z)",
    )

    face_counts = None
    face = None
    if ARGS.get("faceKeys", True):
        face, why = find_face(armature, body)
        if face is None:
            REPORT["warnings"].append(f"No face shape keys: {why}.")
        else:
            face_counts = add_face_keys(body, face)
            REPORT["landmarks"] = face["lm"]
            log("face", keys=face_counts)
    REPORT["faceKeys"] = sorted(face_counts) if face_counts else []

    if armature:
        armature.data.pose_position = "POSE"
    size = export(os.path.join(OUT, "lelu.glb"))
    log("export", file="lelu.glb", bytes=size)

    if ARGS.get("previews", True):
        if armature:
            armature.data.pose_position = "REST"
        if face:
            lm = face["lm"]
            target = (lm["centreX"], lm["noseTip"][1], lm["noseTip"][2] + 0.01)
            set_keys(body, {})
            render(os.path.join(OUT, "preview_face_neutral.png"), target, 0.75)
            set_keys(body, {"jawOpen": 1, "mouthSmileLeft": 1, "mouthSmileRight": 1, "browInnerUp": 1})
            render(os.path.join(OUT, "preview_face_open_smile.png"), target, 0.75)
            set_keys(body, {"eyeBlinkLeft": 1, "eyeBlinkRight": 1})
            render(os.path.join(OUT, "preview_face_blink.png"), target, 0.75)
            set_keys(body, {})
        render(os.path.join(OUT, "preview_body.png"), (0, 0, (max(zs) + min(zs)) / 2), 7.5)
        log("previews")
        if armature:
            armature.data.pose_position = "POSE"

    mobile = ARGS.get("mobile")
    if mobile:
        # Shape keys block applying a decimate, so the phone copy is rebuilt from the
        # source: decimate first, then the same face keys on the lighter mesh.
        armature, body, _ = load()
        before, after, scaled = make_mobile(body, int(mobile.get("targetTris", 24000)), int(mobile.get("textureSize", 1024)))
        mobile_keys = []
        if ARGS.get("faceKeys", True):
            if armature:
                armature.data.pose_position = "REST"
            f2, why = find_face(armature, body)
            if f2:
                mobile_keys = sorted(add_face_keys(body, f2))
            else:
                REPORT["warnings"].append(f"Mobile copy has no face shape keys: {why}.")
            if armature:
                armature.data.pose_position = "POSE"
        size = export(os.path.join(OUT, "lelu_mobile.glb"), jpeg=True)
        log("mobile", file="lelu_mobile.glb", bytes=size, trianglesBefore=before, trianglesAfter=after, texturesScaled=scaled, faceKeys=mobile_keys)

    with open(os.path.join(OUT, "report.json"), "w") as fh:
        json.dump(REPORT, fh, indent=2)


main()
