"""
==========================================================
LÉLU CHARACTER FOUNDRY — MATERIAL LIBRARY (Blender)
==========================================================

Cycles-native node graphs, one per surface family, all driven
by the 4K maps texlib.py writes so the .blend, the render and
the exported glTF agree:

  skin        subsurface scattering, 4K albedo + roughness + normal
  lip         deep plum-brown, high coat, soft SSS
  copper      metallic 1.0, anisotropic, patina from the map
  crystal     transmission glass with a rose tint (ref_A drops)
  fabric      camo-rose print with sheen and normal detail
  leather     worn black leather
  hair        Cycles principled hair BSDF (melanin-driven)
  eye         sclera, iris (image), wet cornea
  nail        pale chrome with coat
  rubber      platform sole, matte
  teeth       enamel

Input names differ between Principled versions, so every set is
guarded: a missing socket is skipped rather than guessed.
==========================================================
"""

from __future__ import annotations

import os

import bpy


def _set(node, name, value):
    if name in node.inputs:
        try:
            node.inputs[name].default_value = value
            return True
        except (TypeError, ValueError):
            return False
    return False


def _tex(nodes, path, non_color=False, projection="UV"):
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(path, check_existing=True)
    node.image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    node.extension = "REPEAT"
    return node


def _uv(nodes, links, scale=(1.0, 1.0, 1.0), location=(0.0, 0.0, 0.0)):
    node = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = scale
    mapping.inputs["Location"].default_value = location
    links.new(node.outputs["UV"], mapping.inputs["Vector"])
    return mapping


def _bump(nodes, links, normal_tex, strength=1.0):
    bump = nodes.new("ShaderNodeBump")
    links.new(normal_tex.outputs["Color"], bump.inputs["Height"])
    _set(bump, "Strength", strength)
    _set(bump, "Distance", 0.004)
    return bump


def principled(name, base_color=(0.5, 0.5, 0.5, 1.0), metallic=0.0, roughness=0.5,
               texture_dir=None, maps=None, sss=0.0, coat=0.0, transmission=0.0,
               sheen=0.0, anisotropic=0.0, emission=None, uv_scale=1.0, bump_strength=1.0,
               alpha=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (250, 0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    _set(bsdf, "Base Color", base_color)
    _set(bsdf, "Metallic", metallic)
    _set(bsdf, "Roughness", roughness)
    _set(bsdf, "IOR", 1.5)
    if sss:
        _set(bsdf, "Subsurface Weight", sss)
        _set(bsdf, "Subsurface Radius", (1.0, 0.42, 0.28))
        _set(bsdf, "Subsurface Scale", 0.006)
    if coat:
        _set(bsdf, "Coat Weight", coat)
        _set(bsdf, "Coat Roughness", 0.06)
    if transmission:
        _set(bsdf, "Transmission Weight", transmission)
        _set(bsdf, "Roughness", min(roughness, 0.08))
    if sheen:
        _set(bsdf, "Sheen Weight", sheen)
        _set(bsdf, "Sheen Roughness", 0.4)
        _set(bsdf, "Sheen Tint", (0.85, 0.72, 0.66, 1.0))
    if anisotropic:
        _set(bsdf, "Anisotropic", anisotropic)
    if alpha is not None:
        _set(bsdf, "Alpha", alpha)
        mat.blend_method = "BLEND"

    if maps and texture_dir:
        coord = _uv(nodes, links, (uv_scale, uv_scale, uv_scale))
        if "colour" in maps:
            t = _tex(nodes, os.path.join(texture_dir, maps["colour"]))
            links.new(coord.outputs["Vector"], t.inputs["Vector"])
            links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if "roughness" in maps:
            t = _tex(nodes, os.path.join(texture_dir, maps["roughness"]), non_color=True)
            links.new(coord.outputs["Vector"], t.inputs["Vector"])
            links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
        if "alpha" in maps:
            t = _tex(nodes, os.path.join(texture_dir, maps["alpha"]), non_color=True)
            links.new(coord.outputs["Vector"], t.inputs["Vector"])
            links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.blend_method = "BLEND"
            _set(mat, "shadow_method", "HASHED") if "shadow_method" in dir(mat) else None
        if "normal" in maps:
            t = _tex(nodes, os.path.join(texture_dir, maps["normal"]), non_color=True)
            links.new(coord.outputs["Vector"], t.inputs["Vector"])
            bump = _bump(nodes, links, t, bump_strength)
            links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    if emission:
        _set(bsdf, "Emission Color", emission)
        _set(bsdf, "Emission Strength", 1.0)
    mat["foundry"] = "principled"
    return mat


def hair_material(name, melanin=0.92, redness=0.62, roughness=0.26, tint=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    hair = nodes.new("ShaderNodeBsdfHairPrincipled")
    hair.location = (250, 0)
    links.new(hair.outputs["BSDF"], out.inputs["Surface"])
    _set(hair, "Model", "CHIANG")
    _set(hair, "Melanin", melanin)
    _set(hair, "Melanin Redness", redness)
    _set(hair, "Roughness", roughness)
    _set(hair, "Radial Roughness", 0.42)
    _set(hair, "Coat", 0.12)
    _set(hair, "Random Roughness", 0.25)
    _set(hair, "Random Color", 0.12)
    if tint is not None:
        _set(hair, "Tint", tint)
    mat["foundry"] = "hair"
    return mat


def build_all(texture_dir: str, manifest: dict):
    """Create every material from the generated texture manifest."""
    sets = manifest["sets"]

    def maps_of(name):
        entry = sets.get(name)
        return {k: v["file"] for k, v in entry["maps"].items()} if entry else None

    mats = {}
    # measured skin: #7B4526 sRGB -> linear (0.196, 0.061, 0.020). The earlier
    # 0.42/0.20/0.11 base was more than twice too light, which is why she read
    # as pale under the studio lights.
    mats["skin"] = principled(
        "LELU_Skin", base_color=(0.288, 0.075, 0.036, 1.0), roughness=0.44,
        texture_dir=texture_dir, maps=maps_of("skin"), sss=0.22, coat=0.06,
        uv_scale=2.0, bump_strength=0.45)
    mats["lip"] = principled(
        "LELU_Lip", base_color=(0.085, 0.022, 0.018, 1.0), roughness=0.18,
        sss=0.10, coat=0.95, texture_dir=texture_dir, maps=None)
    mats["copper"] = principled(
        "LELU_Copper", base_color=(0.78, 0.38, 0.18, 1.0), metallic=1.0, roughness=0.22,
        texture_dir=texture_dir, maps=maps_of("copper"), anisotropic=0.35,
        uv_scale=2.0, bump_strength=0.15)
    mats["copper_antique"] = principled(
        "LELU_Copper_Antique", base_color=(0.45, 0.22, 0.11, 1.0), metallic=1.0,
        roughness=0.34, texture_dir=texture_dir, maps=maps_of("copper"),
        anisotropic=0.2, uv_scale=1.4, bump_strength=0.5)
    mats["crystal"] = principled(
        "LELU_Crystal", base_color=(0.86, 0.55, 0.52, 1.0), roughness=0.04,
        transmission=0.92, coat=0.5, metallic=0.0)
    mats["fabric"] = principled(
        "LELU_Fabric_CamoRose", base_color=(0.13, 0.13, 0.115, 1.0), roughness=0.68,
        texture_dir=texture_dir, maps=maps_of("camo_rose"), sheen=0.14,
        uv_scale=1.35, bump_strength=0.7)
    mats["fabric_bone"] = principled(
        "LELU_Fabric_Bone", base_color=(0.72, 0.66, 0.53, 1.0), roughness=0.55,
        texture_dir=texture_dir, maps=maps_of("camo_rose"), sheen=0.25, uv_scale=0.9)
    mats["fabric_mauve"] = principled(
        "LELU_Fabric_Mauve", base_color=(0.45, 0.24, 0.28, 1.0), roughness=0.5,
        texture_dir=texture_dir, maps=maps_of("camo_rose"), sheen=0.4, uv_scale=1.2)
    mats["leather"] = principled(
        "LELU_Leather", base_color=(0.055, 0.05, 0.045, 1.0), roughness=0.4,
        texture_dir=texture_dir, maps=maps_of("leather"), coat=0.25,
        uv_scale=2.5, bump_strength=0.5)
    mats["rubber"] = principled(
        "LELU_Rubber", base_color=(0.022, 0.021, 0.02, 1.0), roughness=0.72, sheen=0.12)
    mats["hair"] = hair_material("LELU_Hair", melanin=0.98, redness=0.22, roughness=0.22)
    mats["gold"] = principled("LELU_Gold", base_color=(0.72, 0.40, 0.10, 1.0),
                              metallic=1.0, roughness=0.16, anisotropic=0.2)
    mats["gold_used"] = principled("LELU_Gold_Used", base_color=(0.50, 0.28, 0.07, 1.0),
                                   metallic=1.0, roughness=0.30)
    lace_maps = maps_of("black_lace")
    if lace_maps and "alpha" not in lace_maps:
        lace_maps = dict(lace_maps, alpha=lace_maps.get("colour"))
    mats["lace"] = principled("LELU_Lace_Black", base_color=(0.018, 0.016, 0.015, 1.0),
                              roughness=0.42, texture_dir=texture_dir, maps=lace_maps,
                              sheen=0.3, uv_scale=4.0, bump_strength=0.5,
                              alpha=0.42)
    mats["lace_solid"] = principled("LELU_Lace_Cord", base_color=(0.014, 0.013, 0.012, 1.0),
                                    roughness=0.40, sheen=0.25)
    mats["stone"] = principled("LELU_BlackStone", base_color=(0.012, 0.010, 0.009, 1.0),
                               roughness=0.10, coat=0.9)
    mats["bracelet"] = principled("LELU_BeadBracelet", base_color=(0.09, 0.02, 0.015, 1.0),
                                  roughness=0.30, coat=0.6)
    mats["lip"] = principled("LELU_Lip", base_color=(0.052, 0.011, 0.006, 1.0),
                             roughness=0.14, sss=0.08, coat=0.95)
    mats["brow"] = principled("LELU_Brow", base_color=(0.010, 0.006, 0.005, 1.0),
                              roughness=0.32, coat=0.1)
    mats["hair_pink"] = hair_material("LELU_Hair_Rose", melanin=0.62, redness=0.85,
                                      roughness=0.3, tint=(0.42, 0.10, 0.14, 1.0))
    mats["nap"] = principled("LELU_Nap", base_color=(0.02, 0.02, 0.02, 1.0), roughness=0.9)

    sclera = principled("LELU_Sclera", base_color=(0.78, 0.74, 0.68, 1.0), roughness=0.12,
                        coat=0.6)
    mats["sclera"] = sclera
    iris_dir = texture_dir
    iris_maps = {"colour": os.path.join("eye_iris_colour.png")}
    mats["iris"] = principled("LELU_Iris", base_color=(0.16, 0.10, 0.06, 1.0),
                              roughness=0.18, texture_dir=iris_dir, maps=iris_maps,
                              uv_scale=1.0, coat=0.4)
    mats["cornea"] = principled("LELU_Cornea", base_color=(0.95, 0.95, 0.95, 1.0),
                                roughness=0.02, transmission=0.98, coat=1.0)
    mats["teeth"] = principled("LELU_Teeth", base_color=(0.86, 0.83, 0.78, 1.0),
                               roughness=0.22, sss=0.1)
    mats["mouth"] = principled("LELU_MouthInner", base_color=(0.10, 0.03, 0.035, 1.0),
                               roughness=0.5, sss=0.2)
    mats["nail"] = principled("LELU_Nail", base_color=(0.72, 0.55, 0.50, 1.0),
                              roughness=0.10, coat=0.9, texture_dir=texture_dir,
                              maps=maps_of("nail"), uv_scale=2.0)
    mats["tattoo"] = principled("LELU_Ink", base_color=(0.016, 0.013, 0.012, 1.0),
                                roughness=0.5)
    mats["brow"] = principled("LELU_Brow", base_color=(0.020, 0.013, 0.011, 1.0),
                              roughness=0.35, coat=0.15)
    return mats
