"""
The jury room, rendered once as the backdrop for the deliberation replay: a long table seen
from its end, five leather chairs, ballots and a carafe, late light through slatted blinds.

    exec(open("art/blender/juryroom.py").read())

Runs in its own scene ("juryroom"); writes art/build/props/juryroom.png.
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
from kit import box, cyl, hexc, light, link, sphere

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "art", "build", "props")
os.makedirs(OUT, exist_ok=True)

sc = bpy.data.scenes.get("juryroom") or bpy.data.scenes.new("juryroom")
bpy.context.window.scene = sc
for o in list(sc.collection.all_objects):
    bpy.data.objects.remove(o, do_unlink=True)
for c in list(sc.collection.children):
    bpy.data.collections.remove(c)
root = bpy.data.collections.new("jr_root")
sc.collection.children.link(root)
kit.use(root)

M = {
    "walnut": kit.mat_wood("jr_walnut", "#1e0f08", "#4a2a18", rough=0.32, coat=0.45),
    "walnut_z": kit.mat_wood("jr_walnut_z", "#1e0f08", "#4a2a18", rough=0.32, coat=0.45, grain_axis="z"),
    "oak": kit.mat_wood("jr_oak", "#3a2213", "#7a4c2a", rough=0.28, coat=0.55),
    "plaster": kit.mat_plaster("jr_plaster", "#2a2a22", "#33332a"),
    "floor": kit.mat_planks("jr_floor", "#24140b", "#40261a", rough=0.3),
    "leather": kit.mat_basic("jr_leather", "#1c3a2e", rough=0.42, coat=0.3),
    "paper": kit.mat_basic("jr_paper", "#ece4d2", rough=0.85),
    "glass": kit.mat_basic("jr_glass", "#ffffff", rough=0.03, transmission=1.0),
    "brass": kit.mat_basic("jr_brass", "#c99a48", rough=0.26, metal=1.0),
    "slat": kit.mat_basic("jr_slat", "#d8c8a8", rough=0.6),
    "sky": kit.mat_gradient_emit("jr_sky", "#f2b874", "#ffe2b0", strength=4.0),
    "shade": kit.mat_basic("jr_shade", "#f0dca8", rough=0.6, emit="#ffcf8a", emit_strength=5.0),
}

# room: x across, y away from camera
box("floor", -5, 5, -4, 9, -0.05, 0, M["floor"], bevel=0)
box("back", -5, 5, 9, 9.2, 0, 4.2, M["plaster"], bevel=0)
box("left", -5.2, -5, -4, 9.2, 0, 4.2, M["plaster"], bevel=0)
box("right", 5, 5.2, -4, 9.2, 0, 4.2, M["plaster"], bevel=0)
box("ceiling", -5.2, 5.2, -4, 9.2, 4.2, 4.3, M["plaster"], bevel=0)
for x0, x1 in ((-5, 5),):
    box("wainscot_b", x0, x1, 8.88, 9.0, 0, 1.2, M["walnut_z"], bevel=0.005)
    box("rail_b", x0, x1, 8.82, 9.0, 1.18, 1.26, M["oak"], bevel=0.01)
for sx in (-1, 1):
    box(f"wainscot_{sx}", sx * 5 - (0.12 if sx > 0 else -0.0), sx * 5 + (0.0 if sx > 0 else 0.12), -4, 9, 0, 1.2, M["walnut_z"], bevel=0.005)
kit.raised_panels("wp", -4.9, 4.9, 0.15, 1.1, 8.88, 8, 1, M["walnut_z"], margin=0.05, gap=0.08)

# the window with slatted blinds in the back wall
WX0, WX1, WZ0, WZ1 = -1.6, 1.6, 1.4, 3.7
cut = box("wincut", WX0, WX1, 8.7, 9.5, WZ0, WZ1, None, bevel=0)
mod = bpy.data.objects["back"].modifiers.new("cut", "BOOLEAN")
mod.object = cut
mod.operation = "DIFFERENCE"
cut.hide_render = True
cut.display_type = "WIRE"
box("win_frame_t", WX0 - 0.12, WX1 + 0.12, 8.9, 9.25, WZ1, WZ1 + 0.12, M["walnut"], bevel=0.01)
box("win_frame_b", WX0 - 0.2, WX1 + 0.2, 8.75, 9.25, WZ0 - 0.1, WZ0, M["oak"], bevel=0.01)
for x in (WX0 - 0.12, WX1):
    box(f"win_frame_{x}", x, x + 0.12, 8.9, 9.25, WZ0, WZ1, M["walnut"], bevel=0.01)
box("win_mull", -0.03, 0.03, 9.05, 9.12, WZ0, WZ1, M["walnut"], bevel=0.005)
z = WZ0 + 0.06
while z < WZ1 - 0.02:
    s = box(f"slat_{z:.2f}", WX0 + 0.02, WX1 - 0.02, 8.94, 9.02, z - 0.012, z + 0.012, M["slat"], bevel=0.003)
    s.rotation_euler = (math.radians(38), 0, 0)
    z += 0.085
sky = box("sky", -12, 12, 18, 18.2, -4, 14, M["sky"], bevel=0)
sky.visible_shadow = False

# the table and chairs
TL0, TL1, TW, TH = 0.4, 7.4, 1.25, 0.76
box("table_top", -TW, TW, TL0, TL1, TH - 0.06, TH, M["walnut"], bevel=0.02)
box("table_apron", -TW + 0.08, TW - 0.08, TL0 + 0.08, TL1 - 0.08, TH - 0.2, TH - 0.06, M["walnut_z"], bevel=0.01)
for x in (-TW + 0.15, TW - 0.15):
    for y in (TL0 + 0.15, TL1 - 0.15):
        box(f"leg_{x}_{y}", x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0, TH - 0.06, M["walnut_z"], bevel=0.015)


def chair(name, x, y, facing):
    rig = bpy.data.objects.new(name, None)
    link(rig)
    parts = [
        box(f"{name}_seat", -0.27, 0.27, -0.25, 0.25, 0.44, 0.52, M["leather"], bevel=0.04),
        box(f"{name}_back", -0.27, 0.27, 0.2, 0.3, 0.52, 1.18, M["leather"], bevel=0.05, segments=4),
        box(f"{name}_frame", -0.3, 0.3, 0.26, 0.32, 0.44, 1.22, M["walnut_z"], bevel=0.02),
    ]
    for lx in (-0.24, 0.24):
        for ly in (-0.21, 0.24):
            parts.append(box(f"{name}_leg{lx}{ly}", lx - 0.025, lx + 0.025, ly - 0.025, ly + 0.025, 0, 0.44, M["walnut_z"], bevel=0.008))
    for i in range(4):
        parts.append(sphere(f"{name}_nail{i}", -0.18 + i * 0.12, 0.195, 1.12, 0.012, M["brass"]))
    for p in parts:
        p.parent = rig
    rig.location = (x, y, 0)
    rig.rotation_euler = (0, 0, facing)


for i, y in enumerate((1.4, 3.0, 4.6, 6.2)):
    chair(f"cl{i}", -TW - 0.32, y + (0.15 if i % 2 else 0), math.radians(-90 + (4 if i % 2 else -3)))
    chair(f"cr{i}", TW + 0.32, y + (0.1 if i % 2 else 0.2), math.radians(90 + (-5 if i % 2 else 3)))
chair("chead", 0, TL1 + 0.4, math.radians(0))

# what the jurors left on the table: ballots, notes, pencils, a carafe and glasses
import random

random.seed(11)
for i in range(9):
    x = random.uniform(-0.9, 0.9)
    y = random.uniform(TL0 + 0.6, TL1 - 0.6)
    s = box(f"note{i}", x - 0.11, x + 0.11, y - 0.15, y + 0.15, TH, TH + 0.003, M["paper"], bevel=0.001)
    s.rotation_euler = (0, 0, math.radians(random.uniform(-40, 40)))
for i in range(5):
    x = random.uniform(-0.8, 0.8)
    y = random.uniform(TL0 + 0.8, TL1 - 0.8)
    p = cyl(f"pencil{i}", x, y, -0.09, 0.09, 0.006, kit.mat_basic(f"jr_pencil{i}", "#c9932e", rough=0.5), axis="Z")
    p.location = (x, y, TH + 0.008)
    p.rotation_euler = (math.radians(90), 0, math.radians(random.uniform(0, 180)))
cyl("carafe", 0.25, 3.6, TH, TH + 0.26, 0.08, M["glass"], r2=0.05)
for x, y in ((-0.5, 2.2), (0.6, 4.9), (-0.35, 5.8)):
    cyl(f"glass{x}", x, y, TH, TH + 0.11, 0.035, M["glass"])
box("ballot_box", -0.2, 0.2, 6.5, 6.8, TH, TH + 0.2, M["oak"], bevel=0.01)
box("ballot_slot", -0.1, 0.1, 6.64, 6.66, TH + 0.2, TH + 0.205, kit.mat_basic("jr_slot", "#0a0806", rough=0.5), bevel=0)

# a pendant lamp over the table
cyl("pend_cord", 0, 4.2, 2.4, 4.2, 0.006, kit.mat_basic("jr_cord", "#111111", rough=0.5))
cyl("pend_shade", 0, 4.2, 2.1, 2.4, 0.32, M["shade"], r2=0.08)
light("pend", "POINT", (0, 4.2, 2.05), 120, "#ffcf8a", size=0.1)

# light
sun = light("jr_sun", "SUN", (0, 30, 12), 6.5, "#ffc37a", size=math.radians(0.8))
kit.look_at(sun, (-6, 0, -9))
light("jr_fill", "AREA", (0, -3.5, 3.2), 450, "#d9c4a8", size=(6, 2), target=(0, 5, 0.8))

# the air in the room, so the blinds throw shafts
haze = box("jr_haze", -4.95, 4.95, -3.5, 8.85, 0.01, 4.15, None, bevel=0)
vm = bpy.data.materials.new("jr_haze")
vm.use_nodes = True
nt = vm.node_tree
for n in list(nt.nodes):
    if n.type == "BSDF_PRINCIPLED":
        nt.nodes.remove(n)
out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
pv = nt.nodes.new("ShaderNodeVolumePrincipled")
pv.inputs["Density"].default_value = 0.035
pv.inputs["Anisotropy"].default_value = 0.6
nt.links.new(pv.outputs["Volume"], out.inputs["Volume"])
haze.data.materials.append(vm)
for o in sc.objects:
    if o.type == "LIGHT":
        o.visible_volume_scatter = o.name in ("jr_sun", "pend")

w = bpy.data.worlds.get("jr_world") or bpy.data.worlds.new("jr_world")
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = hexc("#201a14")
bg.inputs["Strength"].default_value = 0.3
sc.world = w

cd = bpy.data.cameras.new("jr_cam")
cd.lens = 32
cd.dof.use_dof = True
cd.dof.focus_distance = 7.0
cd.dof.aperture_fstop = 2.8
cam = bpy.data.objects.new("jr_cam", cd)
cam.location = (0.0, -2.6, 1.75)
link(cam)
kit.look_at(cam, (0, 6, 1.3))
sc.camera = cam

sc.render.engine = "CYCLES"
sc.cycles.device = "GPU"
sc.cycles.samples = 384
sc.cycles.use_denoising = True
sc.render.film_transparent = False
sc.render.resolution_x = 1920
sc.render.resolution_y = 1080
sc.render.resolution_percentage = globals().get("JR_SCALE", 100)
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.view_settings.view_transform = "AgX"
try:
    sc.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass
sc.render.filepath = os.path.join(OUT, "juryroom.png") if not globals().get("JR_PREVIEW") else "/tmp/juryroom_preview.png"
bpy.ops.render.render(write_still=True, scene=sc.name)
print("jury room rendered")
