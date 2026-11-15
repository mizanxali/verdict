"""
The Aldermere courtroom, built from code. Run inside Blender (MCP or the Text editor):

    exec(open("art/blender/courtroom.py").read())

Everything is in metres: x to the right, y away from the camera, z up. The room is staged
like a theatre set (everyone cheats out to the camera), and each piece of furniture lives
in the collection for the depth layer it occupies in the 2D stage, so render.py can export
the layers the cast is interleaved with.
"""
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "art", "blender")
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import importlib

import kit

importlib.reload(kit)
from kit import arch_pts, box, coll, cyl, hexc, light, link, prism, raised_panels, sphere, text, use

kit.reset()
scene = bpy.context.scene

W = 7.6  # half width of the room
BW = 10.5  # back wall face

# ───────────────────────────── materials ─────────────────────────────
M = {
    "walnut": kit.mat_wood("walnut", "#1e0f08", "#4a2a18", rough=0.36, coat=0.4),
    "walnut_z": kit.mat_wood("walnut_z", "#1e0f08", "#4a2a18", rough=0.36, coat=0.4, grain_axis="z"),
    "oak": kit.mat_wood("oak", "#3a2213", "#7a4c2a", rough=0.3, coat=0.5),
    "oak_z": kit.mat_wood("oak_z", "#3a2213", "#7a4c2a", rough=0.3, coat=0.5, grain_axis="z"),
    "ebony": kit.mat_basic("ebony", "#140c08", rough=0.4, coat=0.3),
    "plaster": kit.mat_plaster("plaster", "#1d3a35", "#244640"),
    "floor": kit.mat_planks("floor", "#2a170d", "#4a2b19", rough=0.26),
    "carpet": kit.mat_carpet("carpet", "#4d1219", "#a8823e"),
    "brass": kit.mat_basic("brass", "#c99a48", rough=0.26, metal=1.0),
    "brass_dull": kit.mat_basic("brass_dull", "#a77c38", rough=0.42, metal=1.0),
    "leather": kit.mat_basic("leather", "#4a1013", rough=0.42, coat=0.25),
    "leather_g": kit.mat_basic("leather_g", "#1c3a2e", rough=0.45, coat=0.25),
    "plate": kit.mat_basic("plate", "#d7b56a", rough=0.22, metal=1.0),
    "sign": kit.mat_basic("sign", "#120d0b", rough=0.35),
    "paper": kit.mat_basic("paper", "#ece4d2", rough=0.85),
    "paper_y": kit.mat_basic("paper_y", "#e9d27a", rough=0.85),
    "manila": kit.mat_basic("manila", "#c9a66a", rough=0.8),
    "book_r": kit.mat_basic("book_r", "#5a1a1c", rough=0.6),
    "book_b": kit.mat_basic("book_b", "#1d2c4a", rough=0.6),
    "book_g": kit.mat_basic("book_g", "#1f3a2c", rough=0.6),
    "glass": kit.mat_basic("glass", "#ffffff", rough=0.02, transmission=1.0, ior=1.45),
    "black": kit.mat_basic("black", "#0c0b0d", rough=0.35),
    "clockface": kit.mat_basic("clockface", "#efe6d0", rough=0.5),
    "lampshade": kit.mat_basic("lampshade", "#f4dca2", rough=0.6, emit="#ffd08a", emit_strength=6.0),
    "greenglass": kit.mat_basic("greenglass", "#0f4a30", rough=0.15, coat=0.6, emit="#0c5a34", emit_strength=0.4),
    "bulb": kit.mat_emit("bulb", "#ffd9a0", 30.0),
    "sky": kit.mat_gradient_emit("sky", "#f1b97a", "#fde3b4", strength=1.7),
    "city": kit.mat_basic("city", "#8a6a58", rough=0.9, emit="#e9b98a", emit_strength=1.4),
    "corridor": kit.mat_plaster("corridor", "#6b4a2e", "#7a5434", rough=0.8),
    "enamel": kit.mat_basic("enamel", "#14233a", rough=0.3, coat=0.8),
    "hidden": kit.mat_basic("hidden", "#202020", rough=1.0),
}

L = {k: coll(f"L_{k}") for k in ("back", "bench", "clerk", "door", "stand", "juryback", "jurymid", "juryfront", "tables", "rail")}
LIGHTS = coll("LIGHTS")
SPOTS = coll("SPOTS")
FX = coll("FX")


def boolean_cut(target, cutter):
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    mod.solver = "EXACT"
    # keep the bevel last so cut edges are bevelled too
    if "bevel" in target.modifiers:
        target.modifiers.move(target.modifiers.find("cut"), target.modifiers.find("bevel"))
    cutter.hide_render = True
    cutter.display_type = "WIRE"
    cutter.visible_camera = False
    cutter.visible_shadow = False


# ───────────────────────────── the room ─────────────────────────────
use(L["back"])
WIN_X = (-4.45, 4.15)
WIN_W, WIN_Z0, WIN_ZS = 1.5, 2.45, 4.6
DOOR_X0, DOOR_X1, DOOR_H = 5.45, 6.75, 2.55

floor = box("floor", -W, W, -8, BW + 0.3, -0.06, 0, M["floor"], bevel=0)
carpet = box("carpet", -0.62, 0.62, -8, 6.9, 0, 0.012, M["carpet"], bevel=0.004)

ceiling = box("ceiling", -W - 1, W + 1, -16, BW + 1, 7.4, 7.6, M["hidden"], bevel=0)
ceiling.visible_camera = False
box("sidewall_l", -W - 0.15, -W, -16, BW + 0.3, 0, 7.4, M["plaster"], bevel=0)
box("sidewall_r", W, W + 0.15, -16, BW + 0.3, 0, 7.4, M["plaster"], bevel=0)

# upper wall with arched window openings and the door opening
wall = box("wall", -W, W, BW, BW + 0.3, 1.25, 7.4, M["plaster"], bevel=0)
for i, cx in enumerate(WIN_X):
    cut = prism(f"wincut_{i}", arch_pts(cx, WIN_W, WIN_Z0, WIN_ZS), BW - 0.4, BW + 0.6, None, bevel=0)
    boolean_cut(wall, cut)
doorcut = box("doorcut", DOOR_X0, DOOR_X1, BW - 0.5, BW + 0.6, -0.2, DOOR_H, None, bevel=0)
boolean_cut(wall, doorcut)

# wainscot, chair rail, skirting
wains = box("wainscot", -W, W, BW - 0.12, BW + 0.3, 0, 1.25, M["walnut"], bevel=0.004)
doorcut2 = box("doorcut2", DOOR_X0, DOOR_X1, BW - 0.6, BW + 0.6, -0.2, DOOR_H, None, bevel=0)
boolean_cut(wains, doorcut2)
for x0, x1 in ((-W, DOOR_X0 - 0.16), (DOOR_X1 + 0.16, W)):
    box(f"chairrail_{x0:.0f}", x0, x1, BW - 0.2, BW, 1.22, 1.32, M["oak"], bevel=0.012)
    box(f"skirting_{x0:.0f}", x0, x1, BW - 0.16, BW, 0, 0.14, M["ebony"], bevel=0.008)
# wainscot panels, skipping the door and what the bench hides anyway
for x0, x1, n in ((-W + 0.1, -2.6, 5), (2.6, DOOR_X0 - 0.22, 3), (DOOR_X1 + 0.22, W - 0.1, 1)):
    raised_panels(f"wpan_{x0:.0f}", x0, x1, 0.16, 1.18, BW - 0.12, n, 1, M["walnut_z"], margin=0.06, gap=0.08)

# crown moulding
box("crown_a", -W, W, BW - 0.22, BW, 6.55, 6.75, M["walnut"], bevel=0.02)
box("crown_b", -W, W, BW - 0.32, BW, 6.75, 6.92, M["oak"], bevel=0.03)
box("frieze", -W, W, BW - 0.06, BW, 6.25, 6.55, M["walnut_z"], bevel=0.01)

# pilasters
for x in (-6.6, -2.95, 2.95):
    box(f"pil_{x}", x - 0.2, x + 0.2, BW - 0.16, BW, 1.32, 6.25, M["walnut_z"], bevel=0.015)
    box(f"pil_in_{x}", x - 0.13, x + 0.13, BW - 0.2, BW - 0.15, 1.6, 5.9, M["oak_z"], bevel=0.012)
    box(f"pil_cap_{x}", x - 0.26, x + 0.26, BW - 0.24, BW, 5.95, 6.25, M["oak"], bevel=0.02)
    box(f"pil_base_{x}", x - 0.25, x + 0.25, BW - 0.22, BW, 1.32, 1.55, M["oak"], bevel=0.02)

# arched windows: frame, glazing bars, sill, sky and a skyline beyond
for i, cx in enumerate(WIN_X):
    fr = prism(f"winframe_{i}", arch_pts(cx, WIN_W + 0.26, WIN_Z0 - 0.08, WIN_ZS), BW - 0.1, BW + 0.12, M["walnut"], bevel=0.015)
    inner = prism(f"winframe_cut_{i}", arch_pts(cx, WIN_W - 0.02, WIN_Z0, WIN_ZS), BW - 0.4, BW + 0.5, None, bevel=0)
    boolean_cut(fr, inner)
    y = BW + 0.12
    box(f"win_mull_{i}", cx - 0.03, cx + 0.03, y - 0.03, y + 0.03, WIN_Z0, WIN_ZS + WIN_W / 2, M["walnut"], bevel=0.008)
    for k in range(1, 5):
        z = WIN_Z0 + k * (WIN_ZS - WIN_Z0) / 4.4
        box(f"win_bar_{i}_{k}", cx - WIN_W / 2, cx + WIN_W / 2, y - 0.025, y + 0.025, z - 0.025, z + 0.025, M["walnut"], bevel=0.006)
    # radial glazing bars in the arch head
    for a in (35, 90, 145):
        r = WIN_W / 2
        bar = box(f"win_rad_{i}_{a}", -0.02, 0.02, -0.02, 0.02, 0, r, M["walnut"], bevel=0.005, pivot=(0, 0, 0))
        bar.location = (cx, y, WIN_ZS)
        bar.rotation_euler = (0, math.radians(90 - a), 0)
    box(f"win_sill_{i}", cx - WIN_W / 2 - 0.22, cx + WIN_W / 2 + 0.22, BW - 0.26, BW + 0.05, WIN_Z0 - 0.2, WIN_Z0 - 0.08, M["oak"], bevel=0.015)
    box(f"win_apron_{i}", cx - WIN_W / 2 - 0.1, cx + WIN_W / 2 + 0.1, BW - 0.08, BW, WIN_Z0 - 0.5, WIN_Z0 - 0.2, M["walnut"], bevel=0.012)
    # keystone
    box(f"win_key_{i}", cx - 0.12, cx + 0.12, BW - 0.14, BW + 0.05, WIN_ZS + WIN_W / 2 + 0.02, WIN_ZS + WIN_W / 2 + 0.34, M["oak"], bevel=0.015)

sky = box("sky", -30, 30, 26, 26.2, -6, 24, M["sky"], bevel=0)
sky.visible_shadow = False
# a skyline glimpsed through the glass
import random

random.seed(7)
x = -18.0
while x < 18:
    w = random.uniform(1.4, 3.4)
    h = random.uniform(1.0, 5.5)
    b = box(f"city_{x:.1f}", x, x + w, 22, 24, -2, h, M["city"], bevel=0)
    b.visible_shadow = False
    x += w + random.uniform(0.0, 0.7)
dome = sphere("city_dome", 3.6, 21.5, 5.2, 1.4, M["city"])
dome.visible_shadow = False

# ───────────────────────────── the bench (back wall reredos, chair, desk) ─────────────────────────────
use(L["back"])
box("reredos", -2.55, 2.55, BW - 0.26, BW, 0.45, 5.45, M["walnut_z"], bevel=0.02)
raised_panels("rer_low", -2.3, 2.3, 0.65, 2.65, BW - 0.26, 3, 1, M["walnut_z"], margin=0.05, gap=0.1)
raised_panels("rer_up", -1.75, 1.75, 2.9, 3.35, BW - 0.26, 3, 1, M["oak_z"], margin=0.02, gap=0.1)
box("rer_cornice", -2.8, 2.8, BW - 0.5, BW, 5.45, 5.62, M["oak"], bevel=0.03)
box("rer_cornice2", -2.7, 2.7, BW - 0.42, BW, 5.3, 5.45, M["walnut"], bevel=0.02)
prism("rer_pediment", [(-2.7, 5.62), (2.7, 5.62), (0, 6.38)], BW - 0.42, BW, M["walnut"], bevel=0.02)
prism("rer_pediment_in", [(-2.2, 5.7), (2.2, 5.7), (0, 6.17)], BW - 0.46, BW - 0.4, M["oak"], bevel=0.012)
for sx in (-1, 1):
    cyl(f"rer_col_{sx}", sx * 2.3, BW - 0.36, 0.6, 5.3, 0.12, M["oak_z"])
    cyl(f"rer_colcap_{sx}", sx * 2.3, BW - 0.36, 5.12, 5.3, 0.17, M["brass_dull"])
    cyl(f"rer_colbase_{sx}", sx * 2.3, BW - 0.36, 0.55, 0.72, 0.17, M["brass_dull"])

# the seal of the Commonwealth of Aldermere
SEAL = (0.0, BW - 0.3, 4.32)
sx_, sy_, sz_ = SEAL
cyl("seal_rim", sx_, sz_, sy_ - 0.05, sy_ + 0.02, 0.72, M["brass"], verts=96, axis="Y")
cyl("seal_ring", sx_, sz_, sy_ - 0.08, sy_ - 0.04, 0.66, M["brass_dull"], verts=96, axis="Y")
cyl("seal_field", sx_, sz_, sy_ - 0.1, sy_ - 0.06, 0.47, M["enamel"], verts=96, axis="Y")
cyl("seal_inner", sx_, sz_, sy_ - 0.105, sy_ - 0.095, 0.49, M["brass"], verts=96, axis="Y", r2=0.47)
# lettering round the ring, upright on both arcs
kit.ring_text("seal_top", "COMMONWEALTH OF ALDERMERE", 0.565, 0.085, M["brass"], center=(sx_, 0, sz_), y=sy_ - 0.09, mid_deg=90, step_deg=6.6, top=True, extrude=0.008)
kit.ring_text("seal_bot", "FIAT JUSTITIA", 0.565, 0.085, M["brass"], center=(sx_, 0, sz_), y=sy_ - 0.09, mid_deg=270, step_deg=7.2, top=False, extrude=0.008)
# the alder tree over the waters, imported from seal.svg as a coin relief
y_em = sy_ - 0.105
before = set(bpy.data.objects)
bpy.ops.import_curve.svg(filepath=os.path.join(HERE, "seal.svg"))
parts = [o for o in bpy.data.objects if o not in before and o.type == "CURVE"]
xs, ys = [], []
for o in parts:
    for spl in o.data.splines:
        for bp in spl.bezier_points:
            v = o.matrix_world @ bp.co
            xs.append(v.x)
            ys.append(v.y)
cx0, cy0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
k_em = 0.6 / (max(ys) - min(ys))
for o in parts:
    o.data.extrude = 0.006 / k_em
    o.data.bevel_depth = 0.003 / k_em
    o.data.bevel_resolution = 3
    o.data.materials.clear()
    o.data.materials.append(M["brass"])
    o.location = (o.location.x - cx0, o.location.y - cy0, 0)
    link(o, L["back"])
emb = bpy.data.objects.new("seal_emblem", None)
link(emb, L["back"])
for o in parts:
    o.parent = emb
emb.scale = (k_em, k_em, k_em)
emb.rotation_euler = (math.radians(90), 0, 0)
emb.location = (sx_, y_em, sz_ + 0.0)
for c in list(bpy.data.collections):
    if c.name.startswith("seal.svg") or c.name == "seal.svg":
        bpy.data.collections.remove(c)
use(L["back"])

# the judge's chair, high-backed, behind where the judge stands
use(L["back"])
box("bench_platform", -2.45, 2.45, 7.7, BW, 0, 0.45, M["walnut"], bevel=0.01)
box("jchair_back", -0.48, 0.48, 8.95, 9.2, 1.0, 2.85, M["leather"], bevel=0.08, segments=5)
box("jchair_frame", -0.55, 0.55, 9.12, 9.26, 0.45, 2.95, M["walnut_z"], bevel=0.04)
cyl("jchair_finial_l", -0.5, 9.17, 2.95, 3.1, 0.05, M["brass"])
cyl("jchair_finial_r", 0.5, 9.17, 2.95, 3.1, 0.05, M["brass"])
for r_ in range(4):
    for c_ in range(3 - (r_ % 2)):
        x = -0.24 + c_ * 0.24 + (0.12 if r_ % 2 else 0)
        sphere(f"jchair_tuft_{r_}_{c_}", x, 8.945, 1.55 + r_ * 0.3, 0.018, M["brass"])

use(L["bench"])
BENCH_TOP = 1.5
box("bench_carcass", -2.2, 2.2, 7.0, 7.9, 0, BENCH_TOP - 0.08, M["walnut_z"], bevel=0.01)
box("bench_top", -2.34, 2.34, 6.88, 7.98, BENCH_TOP - 0.08, BENCH_TOP, M["oak"], bevel=0.02)
box("bench_cornice", -2.26, 2.26, 6.93, 7.0, BENCH_TOP - 0.24, BENCH_TOP - 0.08, M["walnut"], bevel=0.015)
box("bench_plinth", -2.26, 2.26, 6.92, 7.02, 0, 0.18, M["ebony"], bevel=0.01)
raised_panels("bench_pan", -2.2, 2.2, 0.22, BENCH_TOP - 0.28, 7.0, 3, 1, M["walnut_z"], margin=0.08, gap=0.12)
for x in (-2.22, 2.22):
    box(f"bench_corner_{x}", x - 0.08, x + 0.08, 6.9, 7.1, 0, BENCH_TOP - 0.08, M["oak_z"], bevel=0.02)
PLATE_BENCH = (-0.62, 0.62, BENCH_TOP - 0.22, BENCH_TOP - 0.1)
box("bench_plate", PLATE_BENCH[0], PLATE_BENCH[1], 6.9, 6.935, PLATE_BENCH[2], PLATE_BENCH[3], M["plate"], bevel=0.006)
# sound block and gavel
cyl("soundblock", 0.95, 7.35, BENCH_TOP, BENCH_TOP + 0.045, 0.1, M["walnut"])
g_head = cyl("gavel_head", 0.82, BENCH_TOP + 0.1, 7.27, 7.47, 0.045, M["walnut"], axis="X")
g_head.location = (0.8, 7.3, BENCH_TOP + 0.09)
g_head.rotation_euler = (0, math.radians(90), math.radians(25))
for dx in (-0.07, 0.07):
    b_ = cyl(f"gavel_band_{dx}", 0, 0, -0.008, 0.008, 0.047, M["brass"], axis="Z")
    b_.parent = g_head
    b_.location = (0, 0, dx)
g_handle = cyl("gavel_handle", 0, 0, 0, 0.3, 0.012, M["walnut"], axis="Z")
g_handle.parent = g_head
g_handle.location = (0.0, 0, 0)
g_handle.rotation_euler = (math.radians(90), 0, 0)
box("bench_papers", -1.15, -0.6, 7.2, 7.6, BENCH_TOP, BENCH_TOP + 0.008, M["paper"], bevel=0.002).rotation_euler = (0, 0, math.radians(4))
box("bench_book", -1.75, -1.35, 7.25, 7.55, BENCH_TOP, BENCH_TOP + 0.07, M["book_r"], bevel=0.01)

# ───────────────────────────── clerk's desk ─────────────────────────────
use(L["clerk"])
CK = (-3.75, -2.55, 6.0, 6.8, 0.86)
x0, x1, y0, y1, top = CK
box("clerk_carcass", x0 + 0.04, x1 - 0.04, y0, y1, 0, top - 0.05, M["walnut_z"], bevel=0.01)
box("clerk_top", x0 - 0.06, x1 + 0.06, y0 - 0.08, y1 + 0.04, top - 0.05, top, M["oak"], bevel=0.015)
box("clerk_plinth", x0 + 0.02, x1 - 0.02, y0 - 0.03, y0 + 0.02, 0, 0.14, M["ebony"], bevel=0.008)
raised_panels("clerk_pan", x0 + 0.04, x1 - 0.04, 0.18, top - 0.12, y0, 2, 1, M["walnut_z"], margin=0.06, gap=0.1)
# banker's lamp
lx, ly = x1 - 0.2, y0 + 0.36
cyl("lamp_base", lx, ly, top, top + 0.03, 0.09, M["brass"])
cyl("lamp_stem", lx, ly, top + 0.03, top + 0.3, 0.012, M["brass"])
shade = cyl("lamp_shade", lx, ly, 0, 0.3, 0.075, M["greenglass"], axis="X", verts=32)
shade.location = (lx, ly - 0.05, top + 0.33)
shade.scale = (1, 1, 1)
cyl("lamp_bulb", lx, ly - 0.05, top + 0.27, top + 0.3, 0.035, M["bulb"])
box("clerk_papers", x0 + 0.08, x0 + 0.46, y0 + 0.1, y0 + 0.45, top, top + 0.01, M["paper"], bevel=0.002).rotation_euler = (0, 0, math.radians(-5))
box("clerk_ledger", x0 + 0.5, x0 + 0.8, y0 + 0.12, y0 + 0.44, top, top + 0.05, M["book_g"], bevel=0.01)
box("clerk_ledger_p", x0 + 0.515, x0 + 0.785, y0 + 0.11, y0 + 0.43, top + 0.012, top + 0.045, M["paper"], bevel=0.004)
use(L["back"])
box("clerk_chair", -3.37, -2.93, 7.15, 7.32, 0.45, 1.25, M["leather_g"], bevel=0.05, segments=4)

# ───────────────────────────── witness stand ─────────────────────────────
use(L["stand"])
SX0, SX1, SY0, SY1, SH, SRAIL = 2.35, 4.15, 5.85, 7.9, 0.32, 1.32
box("stand_front", SX0, SX1, SY0, SY0 + 0.18, 0, SRAIL, M["walnut_z"], bevel=0.01)
box("stand_rail", SX0 - 0.06, SX1 + 0.06, SY0 - 0.06, SY0 + 0.24, SRAIL, SRAIL + 0.07, M["oak"], bevel=0.02)
box("stand_plinth", SX0 - 0.02, SX1 + 0.02, SY0 - 0.04, SY0 + 0.04, 0, 0.14, M["ebony"], bevel=0.008)
raised_panels("stand_pan", SX0, SX1, 0.18, SRAIL - 0.08, SY0, 2, 1, M["walnut_z"], margin=0.08, gap=0.1)
for sx, x in (("l", SX0), ("r", SX1)):
    box(f"stand_side_{sx}", x - 0.05, x + 0.05, SY0, SY0 + 1.2, 0, SRAIL, M["walnut_z"], bevel=0.01)
    box(f"stand_siderail_{sx}", x - 0.07, x + 0.07, SY0, SY0 + 1.24, SRAIL, SRAIL + 0.07, M["oak"], bevel=0.02)
    cyl(f"stand_post_{sx}", x, SY0 + 0.06, SRAIL + 0.07, SRAIL + 0.2, 0.045, M["brass"])
    sphere(f"stand_ball_{sx}", x, SY0 + 0.06, SRAIL + 0.23, 0.05, M["brass"])
PLATE_STAND = (2.85, 3.65, 0.9, 1.06)
box("stand_plate", PLATE_STAND[0], PLATE_STAND[1], SY0 - 0.035, SY0 - 0.005, PLATE_STAND[2], PLATE_STAND[3], M["plate"], bevel=0.006)
# gooseneck microphone
cv = bpy.data.curves.new("mic_neck", "CURVE")
cv.dimensions = "3D"
cv.bevel_depth = 0.009
cv.bevel_resolution = 4
spl = cv.splines.new("BEZIER")
spl.bezier_points.add(1)
p0, p1 = spl.bezier_points
p0.co = (3.85, SY0 + 0.1, SRAIL + 0.07)
p0.handle_left = (3.85, SY0 + 0.1, SRAIL - 0.1)
p0.handle_right = (3.85, SY0 + 0.1, SRAIL + 0.25)
p1.co = (3.62, SY0 + 0.2, SRAIL + 0.42)
p1.handle_left = (3.78, SY0 + 0.16, SRAIL + 0.45)
p1.handle_right = (3.5, SY0 + 0.22, SRAIL + 0.4)
neck = bpy.data.objects.new("mic_neck", cv)
cv.materials.append(M["black"])
link(neck)
cyl("mic_base", 3.85, SY0 + 0.1, SRAIL + 0.07, SRAIL + 0.1, 0.05, M["black"])
mh = cyl("mic_head", 0, 0, -0.06, 0.06, 0.028, M["black"], axis="Z", verts=24)
mh.location = (3.56, SY0 + 0.21, SRAIL + 0.4)
mh.rotation_euler = (0, math.radians(70), 0)
cyl("stand_glass", 2.62, SY0 + 0.1, SRAIL + 0.07, SRAIL + 0.19, 0.03, M["glass"])
use(L["back"])
box("stand_platform", SX0, SX1, SY0, SY1, 0, SH, M["walnut"], bevel=0.01)
box("stand_chair", 2.98, 3.52, 7.35, 7.52, SH + 0.45, SH + 1.25, M["leather"], bevel=0.05, segments=4)

# ───────────────────────────── the witnesses' door ─────────────────────────────
use(L["back"])
DX = (DOOR_X0 + DOOR_X1) / 2
for nm, a, b in (("l", DOOR_X0 - 0.16, DOOR_X0), ("r", DOOR_X1, DOOR_X1 + 0.16)):
    box(f"door_jamb_{nm}", a, b, BW - 0.14, BW + 0.3, 0, DOOR_H, M["oak_z"], bevel=0.012)
box("door_head", DOOR_X0 - 0.2, DOOR_X1 + 0.2, BW - 0.16, BW + 0.3, DOOR_H, DOOR_H + 0.2, M["oak"], bevel=0.015)
box("door_cornice", DOOR_X0 - 0.3, DOOR_X1 + 0.3, BW - 0.28, BW, DOOR_H + 0.2, DOOR_H + 0.3, M["walnut"], bevel=0.02)
SIGN = (DX - 0.56, DX + 0.56, DOOR_H + 0.44, DOOR_H + 0.66)
box("door_sign", SIGN[0], SIGN[1], BW - 0.06, BW, SIGN[2], SIGN[3], M["sign"], bevel=0.01)
text("door_sign_text", "WITNESSES", DX, BW - 0.065, (SIGN[2] + SIGN[3]) / 2, 0.11, M["brass"], extrude=0.003, spacing=1.25)
# the clock above
CLK = (DX, BW - 0.1, 4.05)
cyl("clock_case", CLK[0], CLK[2], CLK[1] - 0.04, CLK[1] + 0.1, 0.34, M["walnut"], verts=64, axis="Y")
cyl("clock_bezel", CLK[0], CLK[2], CLK[1] - 0.07, CLK[1] - 0.03, 0.3, M["brass"], verts=64, axis="Y")
cyl("clock_face", CLK[0], CLK[2], CLK[1] - 0.075, CLK[1] - 0.05, 0.27, M["clockface"], verts=64, axis="Y")
for h in range(12):
    a = math.radians(h * 30)
    r0 = 0.235
    t = box(f"clock_tick_{h}", -0.006 if h % 3 else -0.011, 0.006 if h % 3 else 0.011, -0.004, 0.004, 0, 0.03 if h % 3 else 0.045, M["black"], bevel=0, pivot=(0, 0, 0))
    t.location = (CLK[0] + r0 * math.sin(a), CLK[1] - 0.08, CLK[2] + r0 * math.cos(a) - 0.0)
    t.rotation_euler = (0, a, 0)
    t.location.z -= 0.0
for nm, ang, ln, wd in (("h", 300, 0.13, 0.014), ("m", 62, 0.2, 0.009)):
    hand = box(f"clock_hand_{nm}", -wd, wd, -0.004, 0.004, -0.03, ln, M["black"], bevel=0, pivot=(0, 0, 0))
    hand.location = (CLK[0], CLK[1] - 0.088, CLK[2])
    hand.rotation_euler = (0, math.radians(ang), 0)
cyl("clock_pin", CLK[0], CLK[2], CLK[1] - 0.1, CLK[1] - 0.08, 0.016, M["brass"], axis="Y")
# corridor beyond the door, lit warmer than the court
box("corr_floor", DOOR_X0 - 0.12, DOOR_X1 + 0.6, BW + 0.3, BW + 3.0, -0.06, 0, M["floor"], bevel=0)
box("corr_back", DOOR_X0 - 0.12, DOOR_X1 + 0.6, BW + 2.6, BW + 2.8, 0, 2.75, M["corridor"], bevel=0)
box("corr_l", DOOR_X0 - 0.12, DOOR_X0 - 0.02, BW + 0.3, BW + 2.8, 0, 2.75, M["corridor"], bevel=0)
box("corr_r", DOOR_X1 + 0.6, DOOR_X1 + 0.8, BW + 0.3, BW + 2.8, 0, 2.75, M["corridor"], bevel=0)
box("corr_ceiling", DOOR_X0 - 0.12, DOOR_X1 + 0.8, BW + 0.3, BW + 2.8, 2.75, 2.85, M["corridor"], bevel=0)
box("corr_wainscot", DOOR_X0 - 0.12, DOOR_X1 + 0.6, BW + 2.5, BW + 2.6, 0, 1.0, M["walnut_z"], bevel=0.01)
box("corr_bench", DX - 0.7, DX + 0.5, BW + 2.1, BW + 2.5, 0.42, 0.5, M["oak"], bevel=0.015)
# the door leaf (its own layer: it swings in the 2D stage)
use(L["door"])
DL = (DOOR_X0 + 0.02, DOOR_X1 - 0.02, BW - 0.08, BW - 0.02, 0.0, DOOR_H - 0.02)
leaf = box("door_leaf", DL[0], DL[1], DL[2], DL[3], DL[4], DL[5], M["walnut_z"], bevel=0.01)
raised_panels("door_pan", DL[0], DL[1], 0.12, 1.15, DL[2], 1, 1, M["oak_z"], margin=0.08)
raised_panels("door_pan_up", DL[0], DL[1], 1.2, DL[5] - 0.1, DL[2], 1, 1, M["oak_z"], margin=0.08)
cyl("door_port_ring", DX, 1.9, DL[2] - 0.05, DL[2] - 0.02, 0.22, M["brass"], axis="Y")
cyl("door_port_glass", DX, 1.9, DL[2] - 0.055, DL[2] - 0.045, 0.18, kit.mat_basic("portglass", "#e9c48a", rough=0.15, emit="#ffcf8a", emit_strength=1.2), axis="Y")
sphere("door_knob", DL[0] + 0.12, DL[2] - 0.05, 1.05, 0.04, M["brass"])
cyl("door_plate", DL[0] + 0.12, 1.05, DL[2] - 0.02, DL[2] - 0.005, 0.06, M["brass"], axis="Y")

# ───────────────────────────── jury box ─────────────────────────────
JX0, JX1 = -7.6, -3.95
JTIER = 0.62
JFRONT = 0.2
JURY_BACK_Y = (6.25, (-6.35, -5.45, -4.55))
JURY_FRONT_Y = (4.65, (-5.95, -4.85))
use(L["back"])
box("jury_tier", JX0, JX1, 5.25, 7.05, 0, JTIER, M["walnut"], bevel=0.01)
box("jury_riser", JX0, JX1, 4.05, 5.25, 0, JFRONT, M["walnut"], bevel=0.01)
use(L["juryback"])
box("jury_partition", JX0, JX1, 6.95, 7.1, JTIER, 1.85, M["walnut_z"], bevel=0.01)
box("jury_partition_rail", JX0, JX1 + 0.04, 6.9, 7.14, 1.85, 1.93, M["oak"], bevel=0.02)
raised_panels("jury_part_pan", JX0, JX1, JTIER + 0.1, 1.75, 6.95, 3, 1, M["walnut_z"], margin=0.08, gap=0.12)
for x in JURY_BACK_Y[1]:
    box(f"jchair_b_{x}", x - 0.27, x + 0.27, 6.55, 6.72, JTIER + 0.45, JTIER + 1.22, M["leather"], bevel=0.06, segments=4)
    box(f"jchair_bf_{x}", x - 0.3, x + 0.3, 6.6, 6.75, JTIER + 0.4, JTIER + 0.48, M["walnut"], bevel=0.02)
use(L["jurymid"])
box("jury_midrail", JX0, JX1, 5.1, 5.26, 0, JTIER + 0.62, M["walnut_z"], bevel=0.01)
box("jury_midrail_top", JX0, JX1 + 0.04, 5.05, 5.3, JTIER + 0.62, JTIER + 0.69, M["oak"], bevel=0.02)
raised_panels("jury_mid_pan", JX0, JX1, 0.12, JTIER + 0.54, 5.1, 3, 1, M["walnut_z"], margin=0.06, gap=0.12)
for x in JURY_FRONT_Y[1]:
    box(f"jchair_f_{x}", x - 0.27, x + 0.27, 4.98, 5.08, JFRONT + 0.45, JFRONT + 1.2, M["leather"], bevel=0.05, segments=4)
use(L["juryfront"])
box("jury_front", JX0, JX1, 3.95, 4.1, 0, 0.92, M["walnut_z"], bevel=0.01)
box("jury_front_top", JX0, JX1 + 0.05, 3.88, 4.16, 0.92, 1.0, M["oak"], bevel=0.02)
box("jury_front_plinth", JX0, JX1 + 0.03, 3.92, 3.99, 0, 0.14, M["ebony"], bevel=0.008)
raised_panels("jury_front_pan", JX0, JX1, 0.18, 0.84, 3.95, 3, 1, M["walnut_z"], margin=0.07, gap=0.1)
box("jury_side", JX1 - 0.05, JX1 + 0.06, 3.95, 7.05, 0, 0.92, M["walnut_z"], bevel=0.01)
box("jury_side_top", JX1 - 0.08, JX1 + 0.09, 3.88, 7.05, 0.92, 1.0, M["oak"], bevel=0.02)
JSIGN = ((JX0 + JX1) / 2 + 0.25, 0.6)
box("jury_sign", JSIGN[0] - 0.36, JSIGN[0] + 0.36, 3.9, 3.95, JSIGN[1] - 0.08, JSIGN[1] + 0.08, M["sign"], bevel=0.008)
text("jury_sign_text", "JURY", JSIGN[0], 3.895, JSIGN[1], 0.1, M["brass"], extrude=0.003, spacing=1.4)

# ───────────────────────────── counsel tables ─────────────────────────────
use(L["tables"])
TY0, TY1, TH = 1.4, 2.4, 0.8


def counsel_table(side, x0, x1):
    box(f"{side}_top", x0 - 0.06, x1 + 0.06, TY0 - 0.06, TY1 + 0.04, TH - 0.05, TH, M["oak"], bevel=0.015)
    box(f"{side}_apron", x0, x1, TY0, TY0 + 0.06, 0.12, TH - 0.05, M["walnut_z"], bevel=0.008)
    raised_panels(f"{side}_pan", x0, x1, 0.14, TH - 0.08, TY0, 3, 1, M["walnut_z"], margin=0.06, gap=0.08)
    for x in (x0 + 0.04, x1 - 0.04):
        box(f"{side}_leg_{x:.1f}", x - 0.05, x + 0.05, TY0, TY0 + 0.1, 0, TH - 0.05, M["oak_z"], bevel=0.012)
    box(f"{side}_plinth", x0, x1, TY0 - 0.03, TY0 + 0.02, 0, 0.12, M["ebony"], bevel=0.008)
    cx = (x0 + x1) / 2
    label = "DEFENCE" if side == "def" else "PROSECUTION"
    w = 0.42 if side == "def" else 0.58
    box(f"{side}_sign", cx - w, cx + w, TY0 - 0.035, TY0 - 0.005, 0.38, 0.54, M["sign"], bevel=0.008)
    text(f"{side}_sign_text", label, cx, TY0 - 0.04, 0.46, 0.085, M["brass"], extrude=0.003, spacing=1.35)


counsel_table("def", -4.25, -0.75)
counsel_table("pro", 0.75, 4.25)
# defence: legal pad, folder, a loose sheet
box("def_pad", -2.35, -1.95, 1.62, 1.95, TH, TH + 0.012, M["paper_y"], bevel=0.003).rotation_euler = (0, 0, math.radians(-7))
box("def_pen", -1.9, -1.6, 1.7, 1.715, TH + 0.012, TH + 0.024, M["black"], bevel=0.004).rotation_euler = (0, 0, math.radians(18))
box("def_folder", -3.55, -2.95, 1.6, 2.0, TH, TH + 0.025, M["manila"], bevel=0.004).rotation_euler = (0, 0, math.radians(3))
box("def_sheet", -1.45, -1.05, 1.55, 1.85, TH, TH + 0.004, M["paper"], bevel=0.001).rotation_euler = (0, 0, math.radians(9))
box("def_box", -4.1, -3.65, 1.75, 2.25, TH, TH + 0.26, M["manila"], bevel=0.01)
# prosecution: books, carafe and glass, papers
box("pro_book1", 1.05, 1.6, 1.6, 2.0, TH, TH + 0.07, M["book_b"], bevel=0.01)
box("pro_book2", 1.08, 1.57, 1.62, 1.98, TH + 0.07, TH + 0.13, M["book_r"], bevel=0.01).rotation_euler = (0, 0, math.radians(-4))
box("pro_book3", 1.12, 1.52, 1.65, 1.95, TH + 0.13, TH + 0.18, M["book_g"], bevel=0.01).rotation_euler = (0, 0, math.radians(3))
box("pro_papers", 2.0, 2.45, 1.58, 1.9, TH, TH + 0.01, M["paper"], bevel=0.002).rotation_euler = (0, 0, math.radians(-4))
cyl("pro_carafe", 3.7, 1.75, TH, TH + 0.24, 0.07, M["glass"], r2=0.045)
cyl("pro_glass", 3.95, 1.68, TH, TH + 0.11, 0.035, M["glass"])
cyl("pro_water", 3.7, 1.75, TH + 0.01, TH + 0.15, 0.062, kit.mat_basic("water", "#d8ecf2", rough=0.02, transmission=1.0, ior=1.33), r2=0.052)

# counsel chairs, behind where counsel stand
use(L["back"])
for x, nm in ((-3.35, "dc1"), (-1.9, "dc2"), (2.4, "pc1"), (3.5, "pc2")):
    box(f"cchair_{nm}", x - 0.27, x + 0.27, 3.4, 3.56, 0.45, 1.12, M["leather"], bevel=0.05, segments=4)
    box(f"cchair_{nm}_seat", x - 0.29, x + 0.29, 2.95, 3.5, 0.4, 0.5, M["leather"], bevel=0.04)

# ───────────────────────────── the bar (gallery rail) ─────────────────────────────
use(L["rail"])
RY = -3.4
box("rail_top", -W, W, RY - 0.12, RY + 0.12, 0.94, 1.04, M["oak"], bevel=0.03)
box("rail_bottom", -W, W, RY - 0.08, RY + 0.08, 0.0, 0.12, M["walnut"], bevel=0.015)
x = -W + 0.12
while x < W:
    if abs(x) > 0.66:
        cyl(f"bal_{x:.2f}", x, RY, 0.12, 0.94, 0.032, M["walnut_z"], verts=16)
        sphere(f"bal_k_{x:.2f}", x, RY, 0.3, 0.05, M["walnut_z"], scale=(1, 1, 1.4))
        sphere(f"bal_k2_{x:.2f}", x, RY, 0.78, 0.045, M["walnut_z"], scale=(1, 1, 1.2))
    x += 0.2
for sx in (-1, 1):
    box(f"rail_post_{sx}", sx * 0.7 - 0.08, sx * 0.7 + 0.08, RY - 0.08, RY + 0.08, 0, 1.12, M["walnut_z"], bevel=0.02)
    sphere(f"rail_finial_{sx}", sx * 0.7, RY, 1.2, 0.07, M["brass"])
    box(f"gate_{sx}", sx * 0.62 - (0.27 if sx > 0 else -0.27) - 0.27, sx * 0.62 - (0.27 if sx > 0 else -0.27) + 0.27, RY - 0.03, RY + 0.03, 0.15, 0.9, M["walnut_z"], bevel=0.01)

# ───────────────────────────── lights ─────────────────────────────
use(LIGHTS)
sun = light("sun", "SUN", (0, 30, 20), 5.5, "#ffc98a", size=math.radians(1.2))
kit.look_at(sun, (18, 0, -2))
light("key_front", "AREA", (-3.5, -7.5, 7.5), 3200, "#ffe2c2", size=(9, 4), target=(-0.5, 5.5, 1.0))
light("fill_rim", "AREA", (5, -2, 6.5), 500, "#b9d0e6", size=(4, 4), target=(0, 6, 1))
for sx in (-1, 1):
    x = sx * 2.95
    light(f"sconce_{sx}", "POINT", (x, BW - 0.45, 3.55), 60, "#ffcf8a", size=0.08)
light("clerk_lamp", "POINT", (lx, ly - 0.05, CK[4] + 0.24), 25, "#ffd59a", size=0.05)
light("seal_spot", "SPOT", (0, BW - 3.5, 6.9), 900, "#ffd9a8", size=0.25, spot=26, blend=0.6, target=(0, BW - 0.3, 4.2))
light("corridor", "AREA", (DX, BW + 1.6, 2.6), 250, "#ffbf78", size=(1.6, 1.6), target=(DX, BW + 1.6, 0))
light("stand_spot", "SPOT", (3.2, 2.0, 6.8), 700, "#fff0d8", size=0.4, spot=22, blend=0.7, target=(3.2, 6.8, 0.9))
light("bench_spot", "SPOT", (0, 2.5, 7.2), 650, "#fff0d8", size=0.4, spot=24, blend=0.7, target=(0, 7.6, 1.2))

# sconce bodies
use(L["back"])
for sx in (-1, 1):
    x = sx * 2.95
    box(f"sconce_plate_{sx}", x - 0.07, x + 0.07, BW - 0.2, BW - 0.16, 3.15, 3.5, M["brass"], bevel=0.01)
    box(f"sconce_arm_{sx}", x - 0.015, x + 0.015, BW - 0.48, BW - 0.18, 3.3, 3.33, M["brass"], bevel=0.005)
    s = cyl(f"sconce_shade_{sx}", x, BW - 0.45, 3.42, 3.72, 0.15, M["lampshade"], r2=0.09)
    cyl(f"sconce_cup_{sx}", x, BW - 0.45, 3.3, 3.42, 0.05, M["brass"], r2=0.08)

# ───────────────────────────── atmosphere ─────────────────────────────
use(FX)
haze = box("haze", -W + 0.05, W - 0.05, -3, BW - 0.05, 0.01, 7.3, None, bevel=0)
vm = bpy.data.materials.new("haze")
vm.use_nodes = True
nt = vm.node_tree
for n in list(nt.nodes):
    if n.type == "BSDF_PRINCIPLED":
        nt.nodes.remove(n)
out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
pv = nt.nodes.new("ShaderNodeVolumePrincipled")
pv.inputs["Density"].default_value = 0.012
pv.inputs["Anisotropy"].default_value = 0.55
pv.inputs["Color"].default_value = hexc("#fff1df")
nt.links.new(pv.outputs["Volume"], out.inputs["Volume"])
haze.data.materials.append(vm)
haze.hide_render = True

# ───────────────────────────── world, camera ─────────────────────────────
world = bpy.data.worlds.new("court")
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = hexc("#2a2420")
bg.inputs["Strength"].default_value = 0.35
scene.world = world

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 58
cam_data.sensor_width = 36
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (0, -16.5, 4.4)
link(cam, scene.collection)
kit.look_at(cam, (0, 5.6, 1.75))
scene.camera = cam

# ───────────────────────────── where the cast stands ─────────────────────────────
# Each empty marks a figure's feet. "drop" is how far a seated figure sinks (metres).
use(SPOTS)


def spot(name, x, y, z=0.0, drop=0.0):
    e = bpy.data.objects.new(f"spot_{name}", None)
    e.empty_display_type = "SINGLE_ARROW"
    e.empty_display_size = 0.4
    e.location = (x, y, z)
    e["drop"] = drop
    link(e)
    return e


spot("judge", 0, 8.3, 0.66)
spot("clerk", -3.15, 7.0, 0, drop=0.32)
spot("stand", 3.25, 7.0, SH)
spot("doorway", DX, BW + 0.25, 0)
spot("player", -1.9, 2.95, 0, drop=0.45)
spot("defendant", -3.35, 2.95, 0, drop=0.45)
spot("prosecutor", 2.4, 2.95, 0, drop=0.45)
spot("mid1", 0.0, 3.5, 0)
spot("mid2", 2.15, 5.5, 0)
for i, x in enumerate(JURY_BACK_Y[1]):
    spot(f"juror{i}", x, JURY_BACK_Y[0], JTIER, drop=0.42)
for i, x in enumerate(JURY_FRONT_Y[1]):
    spot(f"juror{i + 3}", x, JURY_FRONT_Y[0], JFRONT, drop=0.42)

# brass plates that carry live text in the 2D stage: record their corners
scene["plate_bench"] = [PLATE_BENCH[0], 6.9, PLATE_BENCH[2], PLATE_BENCH[1], 6.9, PLATE_BENCH[3]]
scene["plate_stand"] = [PLATE_STAND[0], SY0 - 0.035, PLATE_STAND[2], PLATE_STAND[1], SY0 - 0.035, PLATE_STAND[3]]
scene["door_leaf"] = [DL[0], DL[2], DL[4], DL[1], DL[2], DL[5]]

# ───────────────────────────── render settings ─────────────────────────────
scene.render.engine = "CYCLES"
scene.cycles.device = "GPU"
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.cycles.volume_bounces = 1
scene.render.resolution_x = 1600
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass
scene.view_settings.exposure = 0.0
print("courtroom built:", len(bpy.data.objects), "objects")
