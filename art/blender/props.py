"""
Props for the interface, rendered one at a time on a transparent background with a shadow
catcher underneath: the seal (HUD crest, title mark), a gavel (rulings), a wax seal
(exposed contradictions), and one object per kind of exhibit (statement, CCTV still, access
log, logbook, email, medical record, insurance policy, parking ticket).

    exec(open("art/blender/props.py").read())                      # all
    PROPS_ONLY = ["gavel"]; exec(open("art/blender/props.py").read())  # some

Runs in its own scene ("props") so the courtroom scene is untouched.
"""
import math
import os
import random
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "art", "blender")
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import importlib

import kit

importlib.reload(kit)
from kit import box, cyl, hexc, link, sphere, text

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "art", "build", "props")
os.makedirs(OUT, exist_ok=True)
ONLY = globals().get("PROPS_ONLY")

# ───────────────────────────── a clean scene ─────────────────────────────
sc = bpy.data.scenes.get("props") or bpy.data.scenes.new("props")
bpy.context.window.scene = sc
for o in list(sc.collection.all_objects):
    bpy.data.objects.remove(o, do_unlink=True)
for c in list(sc.collection.children):
    bpy.data.collections.remove(c)

sc.render.engine = "CYCLES"
sc.cycles.device = "GPU"
sc.cycles.samples = 192
sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "AgX"
try:
    sc.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass

w = bpy.data.worlds.get("props_world") or bpy.data.worlds.new("props_world")
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = hexc("#3a3028")
bg.inputs["Strength"].default_value = 0.6
sc.world = w

ROOT = bpy.data.collections.new("props_root")
sc.collection.children.link(ROOT)

M = {
    "brass": kit.mat_basic("p_brass", "#e0bd6e", rough=0.28, metal=1.0),
    "brass_dull": kit.mat_basic("p_brass_dull", "#b8924c", rough=0.42, metal=1.0),
    "enamel": kit.mat_basic("p_enamel", "#15283f", rough=0.25, coat=0.9),
    "walnut": kit.mat_wood("p_walnut", "#24120a", "#5a321d", rough=0.3, coat=0.6, scale=(0.2, 0.2, 6)),
    "walnut_z": kit.mat_wood("p_walnut_z", "#24120a", "#5a321d", rough=0.3, coat=0.6, scale=(0.2, 0.2, 6), grain_axis="z"),
    "paper": kit.mat_basic("p_paper", "#f1ebdc", rough=0.8),
    "paper2": kit.mat_basic("p_paper2", "#e8dfcb", rough=0.85),
    "ink": kit.mat_basic("p_ink", "#2a2622", rough=0.7),
    "ink_blue": kit.mat_basic("p_ink_blue", "#26386a", rough=0.6),
    "red": kit.mat_basic("p_red", "#9a2b27", rough=0.55),
    "wax": kit.mat_basic("p_wax", "#7d1a1c", rough=0.32, coat=0.5, spec=0.6),
    "manila": kit.mat_basic("p_manila", "#d2b075", rough=0.75),
    "cloth_g": kit.mat_basic("p_cloth_g", "#1f3d30", rough=0.7),
    "board": kit.mat_basic("p_board", "#6b4a2c", rough=0.6),
    "steel": kit.mat_basic("p_steel", "#b8bcc2", rough=0.25, metal=1.0),
    "photo": kit.mat_basic("p_photo", "#1a1d1f", rough=0.4, coat=0.15),
    "photo_img": kit.mat_basic("p_photo_img", "#40463f", rough=0.45, coat=0.15, emit="#2c3a33", emit_strength=0.3),
    "orange": kit.mat_basic("p_orange", "#d8853a", rough=0.7),
    "ribbon": kit.mat_basic("p_ribbon", "#7c1f22", rough=0.45, coat=0.3),
    "blue_hdr": kit.mat_basic("p_blue_hdr", "#2f4f7f", rough=0.6),
}


def new_coll(name):
    c = bpy.data.collections.new(name)
    ROOT.children.link(c)
    kit.use(c)
    return c


def catcher(size=3.0, z=0.0):
    b = box("catcher", -size, size, -size, size, z - 0.01, z, None, bevel=0)
    b.is_shadow_catcher = True
    return b


def studio(target=(0, 0, 0), key=600, rim=250, fill=120):
    tx, ty, tz = target
    kit.light("p_key", "AREA", (tx - 2.2, ty - 2.6, tz + 3.4), key, "#fff1dc", size=(2.2, 2.2), target=target)
    kit.light("p_rim", "AREA", (tx + 2.6, ty + 2.4, tz + 2.2), rim, "#ffd9a3", size=(1.5, 1.5), target=target)
    kit.light("p_fill", "AREA", (tx + 2.6, ty - 2.4, tz + 1.0), fill, "#c9d8ea", size=(2.5, 2.5), target=target)


def camera(loc, target, ortho=None, lens=70):
    cd = bpy.data.cameras.new("p_cam")
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    else:
        cd.lens = lens
    cam = bpy.data.objects.new("p_cam", cd)
    cam.location = loc
    link(cam)
    kit.look_at(cam, target)
    sc.camera = cam
    return cam


def frame_all(cam, coll, margin=1.12):
    """Pull a perspective camera back along its axis until every object in coll fits."""
    from bpy_extras.object_utils import world_to_camera_view

    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in coll.all_objects:
        if o.type not in {"MESH", "CURVE", "FONT"} or getattr(o, "is_shadow_catcher", False):
            continue
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    if not pts:
        return
    center = sum(pts, Vector()) / len(pts)
    kit.look_at(cam, center)
    fwd = (center - cam.location).normalized()
    for _ in range(40):
        bpy.context.view_layer.update()
        vs = [world_to_camera_view(sc, cam, p) for p in pts]
        ext = max(max(abs(v.x - 0.5), abs(v.y - 0.5)) for v in vs) * 2
        if abs(ext - 1 / margin) < 0.01:
            break
        d = (cam.location - center).length
        cam.location = center - fwd * d * (ext * margin) ** 0.9


def render(name, res=512):
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.filepath = os.path.join(OUT, f"{name}.png")
    bpy.ops.render.render(write_still=True, scene=sc.name)
    print("rendered", name)


def clear(coll):
    for o in list(coll.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(coll)


def lines(prefix, x0, x1, y0, step, n, z, mat, widths=None, thick=0.012):
    random.seed(len(prefix) * 13 + n)
    for i in range(n):
        wfrac = (widths[i % len(widths)] if widths else random.uniform(0.55, 1.0))
        box(f"{prefix}_{i}", x0, x0 + (x1 - x0) * wfrac, y0 - i * step - thick / 2, y0 - i * step + thick / 2, z, z + 0.0015, mat, bevel=0)


def sheet(name, x0, x1, y0, y1, z=0.0, mat=None, thick=0.006, rot=0.0, curl=0.0):
    s = box(name, x0, x1, y0, y1, z, z + thick, mat or M["paper"], bevel=0.002)
    s.rotation_euler = (0, 0, math.radians(rot))
    if curl:
        sd = s.modifiers.new("curl", "SIMPLE_DEFORM")
        sd.deform_method = "BEND"
        sd.angle = math.radians(curl)
        sd.deform_axis = "Y"
    return s


def want(name):
    return not ONLY or name in ONLY


TOPDOWN = ((0.0, -2.2, 3.6), (0, 0, 0))


# ───────────────────────────── the seal ─────────────────────────────
def build_seal():
    c = new_coll("seal")
    cyl("s_rim", 0, 0, -0.05, 0.03, 1.0, M["brass"], verts=128, axis="Y")
    cyl("s_ring", 0, 0, -0.07, -0.04, 0.9, M["brass_dull"], verts=128, axis="Y")
    cyl("s_field", 0, 0, -0.09, -0.06, 0.66, M["enamel"], verts=128, axis="Y")
    cyl("s_inner", 0, 0, -0.095, -0.085, 0.69, M["brass"], verts=128, axis="Y", r2=0.66)
    # ring lettering, upright on both arcs, with stars between
    kit.ring_text("s_top", "COMMONWEALTH OF ALDERMERE", 0.79, 0.118, M["brass"], y=-0.075, mid_deg=90, step_deg=6.6, top=True, extrude=0.012)
    kit.ring_text("s_bot", "FIAT JUSTITIA", 0.79, 0.118, M["brass"], y=-0.075, mid_deg=270, step_deg=7.2, top=False, extrude=0.012)
    for ang in (196, 344):
        st = text(f"s_star{ang}", "✦", 0.79 * math.cos(math.radians(ang)), -0.075, 0.79 * math.sin(math.radians(ang)), 0.1, M["brass"], extrude=0.012)
    # emblem
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=os.path.join(HERE, "seal.svg"))
    parts = [o for o in bpy.data.objects if o not in before and o.type == "CURVE"]
    xs, ys = [], []
    for o in parts:
        for s in o.data.splines:
            for bp in s.bezier_points:
                v = o.matrix_world @ bp.co
                xs.append(v.x)
                ys.append(v.y)
    cx0, cy0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    k = 0.84 / (max(ys) - min(ys))
    emb = bpy.data.objects.new("s_emblem", None)
    link(emb)
    for o in parts:
        o.data.extrude = 0.01 / k
        o.data.bevel_depth = 0.005 / k
        o.data.bevel_resolution = 3
        o.data.materials.clear()
        o.data.materials.append(M["brass"])
        o.location = (o.location.x - cx0, o.location.y - cy0, 0)
        link(o)
        o.parent = emb
    emb.scale = (k, k, k)
    emb.rotation_euler = (math.radians(90), 0, 0)
    emb.location = (0, -0.1, 0)
    for cc in list(bpy.data.collections):
        if cc.name.startswith("seal.svg"):
            bpy.data.collections.remove(cc)
    kit.light("p_key", "AREA", (-2.2, -3.2, 2.6), 520, "#fff1dc", size=(2.5, 2.5), target=(0, 0, 0))
    kit.light("p_rim", "AREA", (2.6, -1.0, -2.0), 160, "#ffcf8a", size=(1.5, 1.5), target=(0, 0, 0))
    camera((0, -6, 0), (0, 0, 0), ortho=2.12)
    render("seal", 512)
    clear(c)


# ───────────────────────────── the gavel ─────────────────────────────
def build_gavel():
    c = new_coll("gavel")
    catcher()
    # sound block
    cyl("g_block", 0.25, 0.15, 0.0, 0.12, 0.42, M["walnut"], verts=96, bevel=0.02)
    cyl("g_block_top", 0.25, 0.15, 0.12, 0.135, 0.36, M["walnut"], verts=96, bevel=0.01)
    # the gavel built along local axes (head along X, handle along +Y), then laid on the block
    rig = bpy.data.objects.new("g_rig", None)
    link(rig)
    head = cyl("g_head", 0, 0, -0.33, 0.33, 0.13, M["walnut"], verts=64, axis="Z", bevel=0.02)
    head.parent = rig
    head.location = (0, 0, 0)
    head.rotation_euler = (0, math.radians(90), 0)
    for dx in (-0.2, 0.2):
        b = cyl(f"g_band{dx}", 0, 0, -0.025, 0.025, 0.137, M["brass"], verts=64)
        b.parent = rig
        b.location = (dx, 0, 0)
        b.rotation_euler = (0, math.radians(90), 0)
    for dx in (-0.335, 0.335):
        cap = cyl(f"g_cap{dx}", 0, 0, -0.012, 0.012, 0.112, M["brass"], verts=64)
        cap.parent = rig
        cap.location = (dx, 0, 0)
        cap.rotation_euler = (0, math.radians(90), 0)
    hd = cyl("g_handle", 0, 0, 0.0, 0.95, 0.036, M["walnut_z"], verts=32, r2=0.028)
    hd.parent = rig
    hd.location = (0, 0.475 + 0.1, 0)
    hd.rotation_euler = (math.radians(-90), 0, 0)
    knob = sphere("g_knob", 0, 0, 0, 0.05, M["walnut"])
    knob.parent = rig
    knob.location = (0, 1.07, 0)
    collar = cyl("g_collar", 0, 0, -0.03, 0.03, 0.05, M["brass"], verts=32)
    collar.parent = rig
    collar.location = (0, 0.15, 0)
    collar.rotation_euler = (math.radians(-90), 0, 0)
    rig.location = (0.22, 0.12, 0.135 + 0.13)
    rig.rotation_euler = (math.radians(-13), 0, math.radians(-38))
    studio(target=(0, 0, 0.2), key=520, rim=260, fill=90)
    cam = camera((1.1, -3.0, 2.3), (0, 0, 0.18), lens=60)
    frame_all(cam, c, 1.08)
    render("gavel", 512)
    clear(c)


# ───────────────────────────── a wax seal ─────────────────────────────
def build_wax():
    c = new_coll("wax")
    catcher()
    # an irregular puddle of wax, then a stamped disc in the middle
    me = bpy.data.meshes.new("w_pool")
    import bmesh

    bm = bmesh.new()
    random.seed(4)
    N = 72
    ring_pts = []
    for i in range(N):
        a = i / N * math.tau
        r = 0.62 + 0.05 * math.sin(a * 3 + 0.4) + 0.035 * math.sin(a * 7 + 1.1) + random.uniform(-0.012, 0.012)
        ring_pts.append((r * math.cos(a), r * math.sin(a)))
    bot = [bm.verts.new((x, y, 0)) for x, y in ring_pts]
    top = [bm.verts.new((x * 0.97, y * 0.97, 0.07)) for x, y in ring_pts]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bm.to_mesh(me)
    bm.free()
    pool = bpy.data.objects.new("w_pool", me)
    pool.data.materials.append(M["wax"])
    for p in pool.data.polygons:
        p.use_smooth = True
    bv = pool.modifiers.new("bevel", "BEVEL")
    bv.width = 0.05
    bv.segments = 6
    link(pool)
    cyl("w_disc", 0, 0, 0.06, 0.1, 0.46, M["wax"], verts=96, bevel=0.03)
    cyl("w_well", 0, 0, 0.095, 0.105, 0.4, M["wax"], verts=96, bevel=0.0)
    # the stamp: emblem pressed into the wax (raised relief reads better at small sizes)
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=os.path.join(HERE, "seal.svg"))
    parts = [o for o in bpy.data.objects if o not in before and o.type == "CURVE"]
    xs, ys = [], []
    for o in parts:
        for s in o.data.splines:
            for bp in s.bezier_points:
                v = o.matrix_world @ bp.co
                xs.append(v.x)
                ys.append(v.y)
    cx0, cy0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    k = 0.52 / (max(ys) - min(ys))
    emb = bpy.data.objects.new("w_emblem", None)
    link(emb)
    for o in parts:
        o.data.extrude = 0.012 / k
        o.data.bevel_depth = 0.008 / k
        o.data.bevel_resolution = 3
        o.data.materials.clear()
        o.data.materials.append(M["wax"])
        o.location = (o.location.x - cx0, o.location.y - cy0, 0)
        link(o)
        o.parent = emb
    emb.scale = (k, k, k)
    emb.location = (0, 0, 0.11)
    for cc in list(bpy.data.collections):
        if cc.name.startswith("seal.svg"):
            bpy.data.collections.remove(cc)
    studio(target=(0, 0, 0.05), key=420, rim=260, fill=60)
    cam = camera((0.0, -1.2, 4.0), (0, 0, 0.05), lens=80)
    frame_all(cam, c, 1.08)
    render("wax", 256)
    clear(c)


# ───────────────────────────── exhibits ─────────────────────────────
def doc_lines(prefix, x0, x1, ytop, n, z, step=0.075, mat=None, thick=0.014):
    lines(prefix, x0, x1, ytop, step, n, z, mat or M["ink"], thick=thick)


def build_statement():
    c = new_coll("ex_statement")
    catcher()
    sheet("st_back", -0.62, 0.62, -0.82, 0.82, 0.0, M["paper2"], rot=-7)
    s = sheet("st_page", -0.62, 0.62, -0.82, 0.82, 0.008, rot=3)
    kit.use(c)
    grp = bpy.data.objects.new("st_text", None)
    link(grp)
    for i, (y, n) in enumerate(((0.64, 1),)):
        pass
    box("st_title", -0.42, 0.42, 0.6, 0.65, 0.016, 0.0175, M["ink"], bevel=0).parent = grp
    for i in range(12):
        wl = 0.95 if i % 5 != 4 else 0.55
        b = box(f"st_l{i}", -0.5, -0.5 + 1.0 * wl, 0.46 - i * 0.075, 0.474 - i * 0.075, 0.016, 0.0175, M["ink"], bevel=0)
        b.parent = grp
    # signature
    cv = bpy.data.curves.new("st_sig", "CURVE")
    cv.dimensions = "3D"
    cv.bevel_depth = 0.008
    spl = cv.splines.new("POLY")
    pts = [(-0.4 + i * 0.035, -0.62 + 0.05 * math.sin(i * 1.3) + (0.03 if i % 4 == 0 else 0), 0.018) for i in range(20)]
    spl.points.add(len(pts) - 1)
    for p, co in zip(spl.points, pts):
        p.co = (*co, 1)
    sig = bpy.data.objects.new("st_sig", cv)
    cv.materials.append(M["ink_blue"])
    link(sig)
    sig.parent = grp
    grp.rotation_euler = (0, 0, math.radians(3))
    # paper clip
    clip = bpy.data.curves.new("st_clip", "CURVE")
    clip.dimensions = "3D"
    clip.bevel_depth = 0.012
    sp2 = clip.splines.new("POLY")
    cp = [(0.32, 0.95, 0.03), (0.32, 0.6, 0.03), (0.42, 0.6, 0.03), (0.42, 1.02, 0.03), (0.26, 1.02, 0.03), (0.26, 0.66, 0.03)]
    sp2.points.add(len(cp) - 1)
    for p, co in zip(sp2.points, cp):
        p.co = (*co, 1)
    co_ = bpy.data.objects.new("st_clip", clip)
    clip.materials.append(M["steel"])
    link(co_)
    studio()
    cam = camera(*TOPDOWN, lens=70)
    frame_all(cam, c, 1.1)
    render("ex_statement", 320)
    clear(c)


def build_photo():
    c = new_coll("ex_photo")
    catcher()
    p = box("ph_print", -0.62, 0.62, -0.48, 0.48, 0.0, 0.01, M["paper"], bevel=0.003)
    img = box("ph_img", -0.55, 0.55, -0.36, 0.42, 0.01, 0.012, M["photo_img"], bevel=0)
    # a dim figure in the frame
    fig = box("ph_fig", -0.06, 0.06, -0.15, 0.2, 0.012, 0.013, kit.mat_basic("p_fig", "#121614", rough=0.2), bevel=0)
    head = cyl("ph_head", 0, 0, 0.012, 0.013, 0.05, kit.mat_basic("p_fig2", "#121614", rough=0.2))
    head.location = (0, 0.25, 0.0125)
    osd = box("ph_osd", -0.5, -0.25, 0.34, 0.38, 0.012, 0.0135, kit.mat_basic("p_osd", "#e9e9e0", rough=0.3, emit="#e9e9e0", emit_strength=0.6), bevel=0)
    rec = cyl("ph_rec", 0.48, 0.36, 0.012, 0.0135, 0.022, kit.mat_basic("p_rec", "#d23a2a", rough=0.3, emit="#ff3a2a", emit_strength=2.0))
    rec.location = (0.48, 0.36, 0.0128)
    for o in (p, img, fig, head, osd, rec):
        pass
    grp = bpy.data.objects.new("ph_grp", None)
    link(grp)
    for o in (p, img, fig, head, osd, rec):
        o.parent = grp
    grp.rotation_euler = (0, 0, math.radians(-6))
    under = box("ph_under", -0.6, 0.6, -0.46, 0.46, -0.008, 0.0, M["paper2"], bevel=0.003)
    under.rotation_euler = (0, 0, math.radians(8))
    studio()
    cam = camera(*TOPDOWN, lens=70)
    frame_all(cam, c, 1.1)
    render("ex_photo", 320)
    clear(c)


def build_log():
    c = new_coll("ex_log")
    catcher()
    box("lg_board", -0.66, 0.66, -0.9, 0.86, 0.0, 0.03, M["board"], bevel=0.02)
    box("lg_paper", -0.58, 0.58, -0.82, 0.7, 0.03, 0.036, M["paper"], bevel=0.002)
    box("lg_clip", -0.26, 0.26, 0.66, 0.84, 0.036, 0.07, M["steel"], bevel=0.02)
    cyl("lg_rivet", -0.18, 0.75, 0.07, 0.08, 0.025, M["steel"])
    cyl("lg_rivet2", 0.18, 0.75, 0.07, 0.08, 0.025, M["steel"])
    # table rules and columns
    for i in range(10):
        y = 0.5 - i * 0.12
        box(f"lg_row{i}", -0.52, 0.52, y - 0.004, y + 0.004, 0.036, 0.0372, kit.mat_basic("p_rule", "#9aa6b4", rough=0.6), bevel=0)
        for j, (x0, x1) in enumerate(((-0.5, -0.28), (-0.22, 0.2), (0.26, 0.48))):
            wl = random.uniform(0.5, 1.0)
            box(f"lg_cell{i}_{j}", x0, x0 + (x1 - x0) * wl, y + 0.03, y + 0.06, 0.036, 0.0375, M["ink"], bevel=0)
    box("lg_hdr", -0.52, 0.52, 0.56, 0.64, 0.036, 0.0375, M["blue_hdr"], bevel=0)
    studio()
    cam = camera(*TOPDOWN, lens=70)
    frame_all(cam, c, 1.1)
    render("ex_log", 320)
    clear(c)


def build_logbook():
    c = new_coll("ex_logbook")
    catcher()
    box("lb_cover", -0.6, 0.6, -0.8, 0.8, 0.0, 0.16, M["cloth_g"], bevel=0.03)
    box("lb_pages", -0.57, 0.6, -0.77, 0.77, 0.025, 0.135, M["paper2"], bevel=0.005)
    box("lb_spine", -0.66, -0.52, -0.8, 0.8, 0.0, 0.16, kit.mat_basic("p_spine", "#1a2f24", rough=0.6), bevel=0.04)
    box("lb_label", -0.32, 0.36, 0.18, 0.5, 0.16, 0.162, M["paper"], bevel=0.004)
    for i in range(3):
        box(f"lb_lt{i}", -0.24, 0.28 - i * 0.1, 0.42 - i * 0.08, 0.44 - i * 0.08, 0.162, 0.1635, M["ink"], bevel=0)
    for y in (-0.62, 0.62):
        box(f"lb_corner{y}", 0.42, 0.62, y - 0.18 if y < 0 else y, y if y < 0 else y + 0.18, 0.0, 0.165, kit.mat_basic("p_corner", "#5a1d1d", rough=0.45), bevel=0.02)
    box("lb_ribbon", 0.1, 0.16, -1.0, -0.7, 0.07, 0.075, M["ribbon"], bevel=0.003)
    g = bpy.data.objects.new("lb", None)
    link(g)
    studio()
    cam = camera(*TOPDOWN, lens=70)
    frame_all(cam, c, 1.1)
    render("ex_logbook", 320)
    clear(c)


def build_email():
    c = new_coll("ex_email")
    catcher()
    sheet("em_page", -0.58, 0.58, -0.8, 0.8, 0.0, rot=-4)
    grp = bpy.data.objects.new("em_grp", None)
    link(grp)
    for i, (lbl, val) in enumerate(((0.12, 0.6), (0.12, 0.7), (0.12, 0.55))):
        y = 0.62 - i * 0.09
        box(f"em_k{i}", -0.48, -0.48 + lbl * 1.6, y, y + 0.03, 0.007, 0.0085, M["blue_hdr"], bevel=0).parent = grp
        box(f"em_v{i}", -0.22, -0.22 + val, y, y + 0.03, 0.007, 0.0085, M["ink"], bevel=0).parent = grp
    box("em_rule", -0.48, 0.48, 0.32, 0.33, 0.007, 0.0085, kit.mat_basic("p_rule2", "#9aa6b4", rough=0.6), bevel=0).parent = grp
    for i in range(8):
        wl = 0.95 if i % 4 != 3 else 0.5
        box(f"em_l{i}", -0.48, -0.48 + 0.96 * wl, 0.2 - i * 0.075, 0.226 - i * 0.075, 0.007, 0.0085, M["ink"], bevel=0).parent = grp
    grp.rotation_euler = (0, 0, math.radians(-4))
    # envelope beneath
    env = box("em_env", -0.7, 0.7, -0.45, 0.45, -0.012, 0.0, kit.mat_basic("p_env", "#e3d6b8", rough=0.8), bevel=0.004)
    env.rotation_euler = (0, 0, math.radians(10))
    env.location = (0.18, -0.5, 0)
    studio()
    cam = camera(*TOPDOWN, lens=70)
    frame_all(cam, c, 1.1)
    render("ex_email", 320)
    clear(c)


def build_medical():
    c = new_coll("ex_medical")
    catcher()
    box("md_back", -0.64, 0.64, -0.82, 0.78, 0.0, 0.012, M["manila"], bevel=0.006)
    box("md_tab", 0.12, 0.5, 0.74, 0.9, 0.0, 0.012, M["manila"], bevel=0.02)
    box("md_paper", -0.58, 0.58, -0.76, 0.84, 0.012, 0.018, M["paper"], bevel=0.002).rotation_euler = (0, 0, math.radians(2))
    f = box("md_front", -0.64, 0.64, -0.82, 0.55, 0.018, 0.03, M["manila"], bevel=0.006)
    box("md_label", -0.4, 0.18, 0.14, 0.4, 0.03, 0.032, M["paper"], bevel=0.003)
    box("md_cross_v", -0.3, -0.22, 0.17, 0.37, 0.032, 0.034, M["red"], bevel=0)
    box("md_cross_h", -0.36, -0.16, 0.23, 0.31, 0.032, 0.034, M["red"], bevel=0)
    for i in range(3):
        box(f"md_lt{i}", -0.1, 0.12 - i * 0.04, 0.32 - i * 0.07, 0.34 - i * 0.07, 0.032, 0.0335, M["ink"], bevel=0)
    box("md_stripe", -0.64, 0.64, -0.7, -0.62, 0.03, 0.031, M["red"], bevel=0)
    studio()
    cam = camera(*TOPDOWN, lens=70)
    frame_all(cam, c, 1.1)
    render("ex_medical", 320)
    clear(c)


def build_insurance():
    c = new_coll("ex_insurance")
    catcher()
    sheet("in_page", -0.6, 0.6, -0.82, 0.82, 0.0, rot=2)
    grp = bpy.data.objects.new("in_grp", None)
    link(grp)
    # engraved border
    for x0, x1, y0, y1 in ((-0.54, 0.54, 0.74, 0.76), (-0.54, 0.54, -0.76, -0.74), (-0.54, -0.52, -0.76, 0.76), (0.52, 0.54, -0.76, 0.76)):
        box(f"in_b{x0}{y0}", x0, x1, y0, y1, 0.007, 0.0085, M["blue_hdr"], bevel=0).parent = grp
    box("in_title", -0.34, 0.34, 0.56, 0.62, 0.007, 0.0085, M["blue_hdr"], bevel=0).parent = grp
    for i in range(7):
        wl = 0.9 if i % 3 else 0.7
        box(f"in_l{i}", -0.44, -0.44 + 0.88 * wl, 0.4 - i * 0.075, 0.424 - i * 0.075, 0.007, 0.0085, M["ink"], bevel=0).parent = grp
    grp.rotation_euler = (0, 0, math.radians(2))
    # gold foil seal with ribbons
    cyl("in_seal", 0.28, -0.5, 0.007, 0.03, 0.17, M["brass"], verts=48, bevel=0.01)
    for a in (-18, 14):
        r = box(f"in_rib{a}", -0.045, 0.045, -0.3, 0.0, 0.004, 0.008, M["ribbon"], bevel=0.002, pivot=(0, 0, 0))
        r.location = (0.28, -0.5, 0.0)
        r.rotation_euler = (0, 0, math.radians(a))
    studio()
    cam = camera(*TOPDOWN, lens=70)
    frame_all(cam, c, 1.1)
    render("ex_insurance", 320)
    clear(c)


def build_ticket():
    c = new_coll("ex_ticket")
    catcher()
    t = box("tk_stub", -0.32, 0.32, -0.75, 0.75, 0.0, 0.008, M["orange"], bevel=0.004)
    t.rotation_euler = (0, 0, math.radians(-14))
    grp = bpy.data.objects.new("tk_grp", None)
    link(grp)
    box("tk_band", -0.32, 0.32, 0.5, 0.62, 0.008, 0.0095, M["ink"], bevel=0).parent = grp
    for i in range(6):
        box(f"tk_l{i}", -0.24, -0.24 + random.uniform(0.25, 0.48), 0.34 - i * 0.09, 0.365 - i * 0.09, 0.008, 0.0095, M["ink"], bevel=0).parent = grp
    for i in range(14):
        box(f"tk_perf{i}", -0.3 + i * 0.044, -0.28 + i * 0.044, -0.36, -0.34, 0.008, 0.0095, kit.mat_basic("p_perf", "#8a4a1c", rough=0.7), bevel=0).parent = grp
    for i in range(18):
        wbar = 0.012 if i % 3 else 0.022
        box(f"tk_bar{i}", -0.24 + i * 0.026, -0.24 + i * 0.026 + wbar, -0.66, -0.46, 0.008, 0.0095, M["ink"], bevel=0).parent = grp
    grp.rotation_euler = (0, 0, math.radians(-14))
    studio()
    cam = camera(*TOPDOWN, lens=70)
    frame_all(cam, c, 1.1)
    render("ex_ticket", 320)
    clear(c)


def build_generic():
    c = new_coll("ex_generic")
    catcher()
    box("gn_back", -0.64, 0.64, -0.82, 0.78, 0.0, 0.012, M["manila"], bevel=0.006)
    box("gn_tab", -0.5, -0.1, 0.74, 0.9, 0.0, 0.012, M["manila"], bevel=0.02)
    box("gn_paper", -0.58, 0.58, -0.76, 0.84, 0.012, 0.018, M["paper"], bevel=0.002).rotation_euler = (0, 0, math.radians(-3))
    box("gn_front", -0.64, 0.64, -0.82, 0.55, 0.018, 0.03, M["manila"], bevel=0.006)
    box("gn_label", -0.3, 0.3, 0.2, 0.36, 0.03, 0.032, M["paper"], bevel=0.003)
    studio()
    cam = camera(*TOPDOWN, lens=70)
    frame_all(cam, c, 1.1)
    render("ex_generic", 320)
    clear(c)


BUILDERS = {
    "seal": build_seal,
    "gavel": build_gavel,
    "wax": build_wax,
    "ex_statement": build_statement,
    "ex_photo": build_photo,
    "ex_log": build_log,
    "ex_logbook": build_logbook,
    "ex_email": build_email,
    "ex_medical": build_medical,
    "ex_insurance": build_insurance,
    "ex_ticket": build_ticket,
    "ex_generic": build_generic,
}
for name, fn in BUILDERS.items():
    if want(name):
        fn()
print("props done")
