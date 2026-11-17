"""
==========================================================
LÉLU CHARACTER FOUNDRY — DESIGN AUTHORITY
==========================================================

The design authority is the three photographs saved in

    leluverse/assets/characters/lelu_character/references/PRIMARY_SOURCE/
        01_front_full_body.png   silhouette, bodysuit, pants, boots, harness
        02_face_closeup.png      skull, brows, eyes, liner, nose, lips, hair
        03_back_upper_body.png   hair mass, braids, hair chains, sashes
        04_front_apose.png       proportions, arm and leg lengths

with sha256 + provenance in that folder's manifest.json. Older jpeg studies
in scripts/avatar/references (short curls, black lace) are superseded and
must not drive the model.

Values below marked MEASURED were sampled from those files by
`reference_sheet.py`, which writes foundry/references/reference_sheet.json.
Values the photographs do not show are marked INFERRED and listed at the
bottom, so the QC gate can report them.

All measurements are metres, +Z up, the character faces -Y.
"""

# ---------------------------------------------------------------- identity
HEIGHT_M = 1.72
HEAD_COUNT = 7.40          # MEASURED: stylised fashion proportion, long legs
SOLE_M = 0.095             # platform boot sole

PRIMARY_SOURCE = {
    "front": "references/PRIMARY_SOURCE/01_front_full_body.png",
    "face": "references/PRIMARY_SOURCE/02_face_closeup.png",
    "back": "references/PRIMARY_SOURCE/03_back_upper_body.png",
    "apose": "references/PRIMARY_SOURCE/04_front_apose.png",
}

# MEASURED from 02_face_closeup.png: warm deep brown, copper-lit.
SKIN = {
    "base":      "#924D35",     # cheek, mid-tone
    "light":     "#B06B48",     # forehead / cheekbone / nose bridge highlight
    "deep":      "#5A3120",     # under-jaw, temple, inner arm
    "shadow":    "#452415",
    "freckle":   "#5C3320",     # constellation marks under both eyes
    "blush":     "#A85C3C",     # terracotta blush, high on the cheekbones
    "lip":       "#541E1B",     # glossy plum-brown, darker at the border
    "lip_gloss": "#7E3326",
    "iris":      "#4A2E1C",
    "iris_ring": "#22140C",
    "sclera":    "#E8DDCE",
    "nail":      "#B98A6E",     # long copper stiletto nails
    "nail_tip":  "#C0703F",
}

# MEASURED: near-black curls with plum / burgundy streaks through the ends.
HAIR = {
    "root":     "#0B0908",
    "body":     "#141110",
    "rose":     "#6B2E33",      # plum streak
    "rose_hi":  "#8E4247",
    "pink":     "#7A4A50",      # dusty pink highlight locks
    "tip":      "#2A1E1C",
}

# MEASURED: dusty rose roses pinned in the hair and printed on the fabric.
ROSE = {
    "petal":    "#A06A72",
    "petal_dk": "#7A4650",
    "petal_hi": "#BE8A92",
    "leaf":     "#4E4A38",
    "leaf_dk":  "#33301F",
}

# MEASURED: copper, not yellow gold — polished on the hoops, antique on the
# harness hardware.
COPPER = {
    "polished": "#AC5E41",
    "deep":     "#7A4230",
    "patina":   "#6B4433",
    "rough_polished": 0.18,
    "rough_antique":  0.34,
}

# MEASURED: camo print in charcoal / olive / bone carrying dusty-rose blooms,
# with copper sparkle dust through the cloth.
FABRIC = {
    "charcoal": "#3C312C",
    "olive":    "#3D3B27",
    "bone":     "#93876C",
    "mauve":    "#5C343B",
    "rose_ink": "#6B3440",
    "sparkle":  "#D8B98C",
    "lace":     "#B9A88E",
}

LEATHER = {"base": "#191615", "wear": "#2E2621", "rough": 0.44}

# ------------------------------------------------------------- body profile
TORSO = [
    (0.98, 0.150, 0.115,  0.000, 2.2),
    (1.02, 0.163, 0.120,  0.000, 2.2),
    (1.06, 0.170, 0.122, -0.002, 2.2),
    (1.10, 0.164, 0.117, -0.004, 2.2),
    (1.14, 0.145, 0.104, -0.006, 2.3),
    (1.18, 0.126, 0.094, -0.008, 2.4),
    (1.22, 0.120, 0.090, -0.010, 2.4),
    (1.27, 0.126, 0.094, -0.010, 2.4),
    (1.32, 0.140, 0.104, -0.008, 2.4),
    (1.36, 0.150, 0.112, -0.006, 2.3),
    (1.40, 0.156, 0.118, -0.004, 2.2),
    (1.43, 0.158, 0.120, -0.002, 2.2),
    (1.47, 0.160, 0.112,  0.000, 2.2),
    (1.51, 0.172, 0.108,  0.002, 2.3),
    (1.54, 0.150, 0.100,  0.002, 2.4),
    (1.560, 0.105, 0.085,  0.000, 2.2),
    (1.585, 0.062, 0.062,  0.000, 2.0),
    (1.615, 0.056, 0.057, -0.002, 2.0),
    (1.648, 0.054, 0.056, -0.002, 2.0),
]

HEAD = [
    (1.560, 0.048, 0.050, -0.004, 2.0),
    (1.592, 0.052, 0.058, -0.010, 2.0),
    (1.612, 0.062, 0.070, -0.016, 2.2),
    (1.630, 0.070, 0.080, -0.020, 2.3),
    (1.650, 0.076, 0.088, -0.022, 2.4),
    (1.672, 0.082, 0.094, -0.021, 2.4),
    (1.698, 0.085, 0.097, -0.017, 2.4),
    (1.718, 0.086, 0.098, -0.013, 2.4),
    (1.740, 0.084, 0.096, -0.009, 2.4),
    (1.762, 0.080, 0.092, -0.003, 2.3),
    (1.788, 0.072, 0.083,  0.002, 2.2),
    (1.812, 0.058, 0.066,  0.004, 2.1),
    (1.830, 0.030, 0.034,  0.004, 2.0),
]

LEGS = {"hip_z": 1.00, "knee_z": 0.50, "ankle_z": 0.095, "hip_x": 0.082,
        "knee_x": 0.062, "ankle_x": 0.052,
        "thigh_r": 0.088, "knee_r": 0.058, "calf_r": 0.062, "ankle_r": 0.038}

ARMS = {"shoulder_x": 0.175, "shoulder_z": 1.505, "elbow_z": 1.215,
        "wrist_z": 0.985, "elbow_x": 0.246, "wrist_x": 0.278,
        "upper_r": 0.050, "elbow_r": 0.040, "fore_r": 0.038, "wrist_r": 0.026}

# ------------------------------------------------- measured proportions
# calibration.json -> verified_fractions_of_figure, read off the 10% grid on
# 01_front_full_body.png and verified by drawing the lines back onto the
# photograph (foundry/references/calib_verified_front.png). Knee and ankle were
# corrected after that check (0.668 -> 0.735, 0.913 -> 0.900).
HEADS_TALL_MEASURED = 6.704          # (sole - crown) / (chin - crown)
HEADS_TALL_WITH_HAIR = 5.793         # the hair adds a lot above the crown

LANDMARK_FRACTIONS = {
    "skull_crown": 0.0000,
    "hairline":    0.0305,
    "brow":        0.0578,
    "eye":         0.0662,
    "nose_tip":    0.1071,
    "lip":         0.1282,
    "chin":        0.1492,
    "neck_base":   0.1649,
    "shoulder":    0.1754,
    "bust":        0.2216,
    "underbust":   0.2647,
    "waist":       0.2805,
    "belt":        0.3277,
    "crotch":      0.4580,
    "knee":        0.7350,
    "ankle":       0.9000,
    "sole":        1.0000,
}

# The measured body is stylised and differs from the neutral base mesh; this is
# why garments fitted to the base float. Numbers are metres above the floor for
# a 1.72 m figure.
PROPORTION_GAP = {
    "head_scale_needed": 1.15,
    "eye_height_m":  round((1 - 0.0662) * 1.72, 3),
    "chin_height_m": round((1 - 0.1492) * 1.72, 3),
    "waist_height_m": round((1 - 0.2805) * 1.72, 3),
    "belt_height_m": round((1 - 0.3277) * 1.72, 3),
    "crotch_height_m": round((1 - 0.4580) * 1.72, 3),
    "knee_height_m": round((1 - 0.7350) * 1.72, 3),
}


# --------------------------------------------------------------- face
# MEASURED from 02_face_closeup.png, expressed in head-widths where it matters:
#   face is a soft oval, wide at the cheekbones, tapering to a rounded chin;
#   brows bold and sharply arched; eyes large and almond with a strong wing;
#   nose short with a rounded tip and flared alae; lips very full, dark gloss.
FACE = {
    "eye_z": 1.6985, "eye_x": 0.0350, "eye_y": -0.1060,
    "eye_rx": 0.0182, "eye_rz": 0.0104,
    "iris_r": 0.0072, "pupil_r": 0.0028,
    "brow_z": 1.7250, "brow_arch": 0.0086, "brow_len": 0.036,
    "brow_thick_inner": 0.0062, "brow_thick_outer": 0.0011,
    "nose_z": 1.6735, "nose_y": -0.1300, "nose_w": 0.0140,
    "mouth_z": 1.6480, "mouth_y": -0.1045, "mouth_w": 0.0320,
    "upper_lip_h": 0.0116, "lower_lip_h": 0.0154,
    "jaw_w": 0.062, "chin_z": 1.6255, "face_w": 0.092,
    "wing_len": 0.019,            # eyeliner flick beyond the outer corner
    "septum_z": 1.6620, "lip_stud_z": 1.6300,
    "blush_z": 1.6820,
    "forehead_ornament": True,     # copper chain + rose-quartz cabochon
    "forehead_swirls": True,       # black swirl linework on the forehead
    "constellation_marks": True,   # star/freckle marks under both eyes
}

# ------------------------------------------------------------ placements
# Roses pinned in the hair and printed on the garment (ref front/back/face).
ROSES = [
    (-0.088, -0.036, 1.800, 0.030, 18),
    (0.090, -0.030, 1.792, 0.028, -22),
    (-0.100, -0.020, 1.722, 0.024, 8),
    (0.102, -0.014, 1.716, 0.026, -12),
    (0.084, 0.052, 1.760, 0.022, 30),
    (-0.170, -0.020, 1.480, 0.026, -40),
    (-0.060, -0.118, 1.240, 0.026, 0),
    (0.070, -0.112, 1.060, 0.030, 0),
    (-0.082, -0.098, 0.760, 0.034, 0),
    (0.096, -0.092, 0.520, 0.030, 0),
]

# Chains threaded through the hair with faceted crystal drops and copper spheres.
HAIR_CHAINS = [
    (-0.112, -0.046, 1.780, 0.42, 0.016, True),
    (0.116, -0.040, 1.774, 0.46, 0.016, True),
    (-0.120, 0.020, 1.700, 0.30, 0.015, True),
    (0.122, 0.026, 1.694, 0.34, 0.015, True),
    (-0.070, -0.070, 1.792, 0.26, 0.014, False),
    (0.074, -0.066, 1.788, 0.24, 0.014, False),
]

JEWELRY = {
    "septum_ring": 0.0075,
    "hoop_earring": 0.0175,
    "choker_chains": 3,
    "pendant": {"spheres": 2, "sphere_r": 0.016, "crystal_len": 0.055},
    "rings_per_hand": 5,
    "cuff_bands_per_arm": 6,
    "ankle_drops": True,
}

CLOTHING = {
    "corset": {"z_top": 1.470, "z_bottom": 1.120, "cup_rose": True,
               "center_buckle": True, "side_cutouts": True},
    "pants": {"z_top": 1.060, "z_bottom": 0.230, "bag": 0.070,
              "gathers": True, "pockets": 3, "straps": 5},
    "hips": {"belt": True, "pouches": 3, "ribbons": 4, "chain_swags": 3},
    "arms": {"pauldron": "left", "sleeves": "mesh", "cuffs": True},
    "boots": {"shaft_top": 0.360, "sole_h": SOLE_M, "platform_w": 0.135,
              "laces": 8, "buckles": 3, "chains": True, "crystal_drops": True},
}

# ---------------------------------------------------------------- hair
# MEASURED: falls to the hip, not the knees; very dense, layered, with a
# braided crown at the centre part and a plum streak through the ends.
HAIR_SPEC = {
    "scalp_ring_z": 1.792,
    "length_m": 0.62,
    "strand_count": 4200,
    "clump_size": 16,
    "curl_radius": 0.023,
    "curl_turns": 2.2,
    "strand_r": 0.0028,
    "shells": [0.0, 0.7, 1.4, 2.0, 2.6],
    "front_fringe": True,
    "side_locks_pink": True,
    "braided_part": True,
}

# ------------------------------------------------- inferred surfaces
INFERRED = [
    "back of the head under the hair mass",
    "inner boot shafts above the ankle",
    "underside of the trouser gathers",
    "reverse of the shoulder pauldron plate",
    "interior of the corset cups",
]


def palette():
    out = {}
    for table in (SKIN, HAIR, ROSE, COPPER, FABRIC, LEATHER):
        out.update({k: v for k, v in table.items() if isinstance(v, str)})
    return out
