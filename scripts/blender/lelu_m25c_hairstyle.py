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
for nm in ("lelu_hair_ringlets", "lelu_hair_strands", "lelu_hairstyle", "lelu_hair_coils", "lelu_hair_jewels"):
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
    zc = [((W_b @ g.calc_center_median()).z - OFF[2]) for g in comp[:50]]
    # loose pieces anywhere; near the shoulders/neck, larger leftovers of the generated coils too
    if len(comp) < 40 or (len(comp) < 250 and min(zc) > 1.25):
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
items, coils, axes = [], [], []
lens = []
for k, root in enumerate(roots):
    R_c = mm(rng.uniform(*st["curlRadiusMm"]))
    pitch = mm(rng.uniform(*st["pitchMm"]))
    r_l = mm(rng.uniform(*st["lockRadiusMm"]))
    q = her(root)
    front = abs(q[0]) > 0.05 and q[1] < 0.01 and rng.random() < float(st.get("frontShare", 0.18))
    end_z = rng.uniform(*st["endZ"]) + OFF[2] * 0
    vol = mm(float(st.get("volumeMm", 0)) * rng.random())
    axis = grow(root, R_c + r_l + 0.003, end_z, front, vol)
    if len(axis) < 5:
        continue
    axis = smooth(resample(axis, 0.004), 12)
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


R["hairstyle"] = build("lelu_hairstyle", items, int(st.get("sides", 4)), ["hair", "highlight"])
R["locks"] = len(items)
R["coilsMesh"] = build("lelu_hair_coils", coils + cuffs, 6, ["copper", "gold"])
if jewels_v:
    jm = ["gold", "gold", "crystal"]
    R["jewelsMesh"] = build("lelu_hair_jewels", [], 4, ["copper", "gold", "crystal"], (jewels_v, [q[:, :4] for q in jewels_q], jewels_m))
R["lockLengthMm"] = {"p10": round(float(np.percentile(lens, 10)) * 1000), "p50": round(float(np.median(lens)) * 1000), "p90": round(float(np.percentile(lens, 90)) * 1000)}

bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
R["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
R["outputBytes"] = os.path.getsize(job["output"])
json.dump(R, open(job["report"], "w"), indent=1)
print("M25C_HAIRSTYLE", json.dumps({k: R[k] for k in ("generatedHair", "roots", "hairstyle", "coilsMesh", "lockLengthMm", "jewellery")}))
