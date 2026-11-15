"""
Small modelling kit shared by the courtroom and prop scripts: scene reset, collections,
a handful of stylised PBR materials, and primitives that come out bevelled and smooth so
edges catch the light the way the 2D cast's flat shapes cannot.
"""
import math

import bmesh
import bpy
from mathutils import Vector

FONT_SERIF = "/System/Library/Fonts/Supplemental/BigCaslon.ttf"


# ───────────────────────────── scene ─────────────────────────────


def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.curves, bpy.data.node_groups, bpy.data.images, bpy.data.worlds):
        for b in list(block):
            if b.users == 0 or block is not bpy.data.images:
                try:
                    block.remove(b)
                except Exception:
                    pass
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


_active = {"c": None}


def use(c):
    _active["c"] = c


def link(obj, c=None):
    for uc in list(obj.users_collection):
        uc.objects.unlink(obj)
    (c or _active["c"] or bpy.context.scene.collection).objects.link(obj)
    return obj


# ───────────────────────────── materials ─────────────────────────────


def _new_mat(name):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m


def _bsdf(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _set(node, key, value):
    if key in node.inputs:
        node.inputs[key].default_value = value


def hexc(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [(c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


def mat_basic(name, color, rough=0.5, metal=0.0, coat=0.0, emit=None, emit_strength=0.0, transmission=0.0, ior=1.45, spec=0.5):
    m = _new_mat(name)
    b = _bsdf(m)
    _set(b, "Base Color", hexc(color) if isinstance(color, str) else color)
    _set(b, "Roughness", rough)
    _set(b, "Metallic", metal)
    _set(b, "Coat Weight", coat)
    _set(b, "Coat Roughness", 0.12)
    _set(b, "Specular IOR Level", spec)
    _set(b, "IOR", ior)
    if transmission:
        _set(b, "Transmission Weight", transmission)
    if emit:
        _set(b, "Emission Color", hexc(emit) if isinstance(emit, str) else emit)
        _set(b, "Emission Strength", emit_strength)
    m.diffuse_color = hexc(color) if isinstance(color, str) else color
    return m


def mat_wood(name, dark, light, rough=0.34, coat=0.35, scale=(1.2, 1.2, 22.0), grain_axis="x"):
    """Polished wood: stretched noise for grain, a second noise for figure, a ramp between two browns."""
    m = _new_mat(name)
    nt = m.node_tree
    b = _bsdf(m)
    tex = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    sx, _, sz = scale
    # grain runs along one axis: stretch the noise along it, compress it across
    if grain_axis == "x":
        mp.inputs["Scale"].default_value = (sx * 0.25, sz, sz)
    elif grain_axis == "z":
        mp.inputs["Scale"].default_value = (sz, sz, sx * 0.25)
    else:
        mp.inputs["Scale"].default_value = (sz, sx * 0.25, sz)
    nt.links.new(tex.outputs["Object"], mp.inputs["Vector"])
    n1 = nt.nodes.new("ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = 3.0
    n1.inputs["Detail"].default_value = 6.0
    n1.inputs["Roughness"].default_value = 0.62
    nt.links.new(mp.outputs["Vector"], n1.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "RINGS"
    wave.inputs["Scale"].default_value = 1.4
    wave.inputs["Distortion"].default_value = 6.0
    wave.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], wave.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "FLOAT"
    mix.inputs["Factor"].default_value = 0.35
    nt.links.new(n1.outputs["Fac"], mix.inputs["A"])
    nt.links.new(wave.outputs["Fac"], mix.inputs["B"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.28
    ramp.color_ramp.elements[0].color = hexc(dark)
    ramp.color_ramp.elements[1].position = 0.78
    ramp.color_ramp.elements[1].color = hexc(light)
    nt.links.new(mix.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    _set(b, "Roughness", rough)
    _set(b, "Coat Weight", coat)
    _set(b, "Coat Roughness", 0.18)
    _set(b, "Specular IOR Level", 0.45)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.05
    nt.links.new(n1.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    m.diffuse_color = hexc(light)
    return m


def mat_plaster(name, color, color2=None, rough=0.92):
    m = _new_mat(name)
    nt = m.node_tree
    b = _bsdf(m)
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 14.0
    n.inputs["Detail"].default_value = 8.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = hexc(color)
    ramp.color_ramp.elements[1].color = hexc(color2 or color)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.7
    nt.links.new(n.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    _set(b, "Roughness", rough)
    m.diffuse_color = hexc(color)
    return m


def mat_planks(name, dark, light, rough=0.3):
    """Floorboards: brick texture laid as long planks, each plank a slightly different tone."""
    m = _new_mat(name)
    nt = m.node_tree
    b = _bsdf(m)
    tex = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.55, 3.2, 1.0)
    nt.links.new(tex.outputs["Object"], mp.inputs["Vector"])
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.5
    br.squash = 1.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = 0.006
    br.inputs["Mortar Smooth"].default_value = 0.3
    br.inputs["Brick Width"].default_value = 1.0
    br.inputs["Row Height"].default_value = 0.25
    br.inputs["Color1"].default_value = hexc(dark)
    br.inputs["Color2"].default_value = hexc(light)
    br.inputs["Mortar"].default_value = hexc("#120a06")
    nt.links.new(mp.outputs["Vector"], br.inputs["Vector"])
    # fine grain on top
    mp2 = nt.nodes.new("ShaderNodeMapping")
    mp2.inputs["Scale"].default_value = (40.0, 1.5, 1.0)
    nt.links.new(tex.outputs["Object"], mp2.inputs["Vector"])
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 4.0
    n.inputs["Detail"].default_value = 8.0
    nt.links.new(mp2.outputs["Vector"], n.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.35
    nt.links.new(br.outputs["Color"], mix.inputs["A"])
    nt.links.new(n.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    _set(b, "Roughness", rough)
    _set(b, "Coat Weight", 0.25)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    bump.invert = True
    nt.links.new(br.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    m.diffuse_color = hexc(light)
    return m


def mat_carpet(name, field, border, rough=1.0, width=1.2):
    m = _new_mat(name)
    nt = m.node_tree
    b = _bsdf(m)
    tex = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tex.outputs["Generated"], sep.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "CONSTANT"
    cr.elements[0].position = 0.0
    cr.elements[0].color = hexc(field)
    stops = [(0.035, border), (0.06, field), (0.075, border), (0.09, field), (0.91, border), (0.925, field), (0.94, border), (0.965, field)]
    for pos, col in stops:
        e = cr.elements.new(pos)
        e.color = hexc(col)
    cr.elements[-1].color = hexc(field)
    nt.links.new(sep.outputs["X"], ramp.inputs["Fac"])
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 300.0
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.25
    nt.links.new(ramp.outputs["Color"], mix.inputs["A"])
    nt.links.new(n.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    _set(b, "Roughness", rough)
    _set(b, "Sheen Weight", 0.15)
    m.diffuse_color = hexc(field)
    return m


def mat_gradient_emit(name, top, bottom, strength=1.0, axis="Z"):
    """An emissive sky card: colour fades from bottom to top across the object's own height."""
    m = _new_mat(name)
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == "BSDF_PRINCIPLED":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    tex = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tex.outputs["Generated"], sep.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = hexc(bottom)
    ramp.color_ramp.elements[1].color = hexc(top)
    nt.links.new(sep.outputs[axis], ramp.inputs["Fac"])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def mat_emit(name, color, strength):
    m = _new_mat(name)
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == "BSDF_PRINCIPLED":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = hexc(color)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


# ───────────────────────────── geometry ─────────────────────────────


def _finish(obj, mat, bevel, segments=3):
    if mat:
        obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    if bevel and bevel > 0:
        m = obj.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(40)
        m.harden_normals = True
        m.miter_outer = "MITER_ARC"
    return link(obj)


def box(name, x0, x1, y0, y1, z0, z1, mat=None, bevel=0.01, segments=3, pivot=None):
    """Axis-aligned box from its extents (metres). The origin sits at its centre, or at `pivot`."""
    px, py, pz = pivot if pivot is not None else ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = (x0 if v.co.x < 0 else x1) - px
        v.co.y = (y0 if v.co.y < 0 else y1) - py
        v.co.z = (z0 if v.co.z < 0 else z1) - pz
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.location = (px, py, pz)
    return _finish(obj, mat, min(bevel, 0.45 * min(x1 - x0, y1 - y0, z1 - z0)) if bevel else 0, segments)


def cyl(name, x, y, z0, z1, r, mat=None, verts=48, bevel=0.004, axis="Z", r2=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=z1 - z0)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    if axis == "Z":
        obj.location = (x, y, (z0 + z1) / 2)
    elif axis == "Y":  # disc facing the camera: z0..z1 become y extents
        obj.rotation_euler = (math.radians(90), 0, 0)
        obj.location = (x, (z0 + z1) / 2, y)
    elif axis == "X":
        obj.rotation_euler = (0, math.radians(90), 0)
        obj.location = ((z0 + z1) / 2, x, y)
    return _finish(obj, mat, bevel, 2)


def sphere(name, x, y, z, r, mat=None, scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.location = (x, y, z)
    obj.scale = scale
    return _finish(obj, mat, 0)


def prism(name, pts_xz, y0, y1, mat=None, bevel=0.01):
    """Extrude a polygon drawn in the XZ plane (the wall plane) between y0 and y1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    front = [bm.verts.new((x, y0, z)) for x, z in pts_xz]
    back = [bm.verts.new((x, y1, z)) for x, z in pts_xz]
    bm.faces.new(list(reversed(front)))
    bm.faces.new(back)
    n = len(pts_xz)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    return _finish(obj, mat, bevel)


def arch_pts(cx, w, z0, zs, steps=24):
    """Outline of a round-headed arch: straight sides from z0 to the springing line zs, then a half circle."""
    r = w / 2
    pts = [(cx - r, z0), (cx + r, z0)]
    for i in range(steps + 1):
        a = i / steps * math.pi
        pts.append((cx + r * math.cos(a), zs + r * math.sin(a)))
    pts.append((cx - r, z0))
    return pts[:-1]


def text(name, body, x, y, z, size, mat=None, extrude=0.002, align="CENTER", font=FONT_SERIF, spacing=1.0, face="-Y"):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    try:
        cu.font = bpy.data.fonts.load(font, check_existing=True)
    except Exception:
        pass
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.space_character = spacing
    obj = bpy.data.objects.new(name, cu)
    obj.location = (x, y, z)
    if face == "-Y":
        obj.rotation_euler = (math.radians(90), 0, 0)
    elif face == "+Z":
        obj.rotation_euler = (0, 0, 0)
    if mat:
        cu.materials.append(mat)
    return link(obj)


def raised_panels(prefix, x0, x1, z0, z1, y_face, cols, rows, mat, margin=0.07, gap=0.06, depth=0.018, bevel=0.012):
    """Raised panels on a face that looks toward -Y, spanning x0..x1, z0..z1 at y = y_face."""
    w = (x1 - x0 - 2 * margin - (cols - 1) * gap) / cols
    h = (z1 - z0 - 2 * margin - (rows - 1) * gap) / rows
    out = []
    for c in range(cols):
        for r in range(rows):
            px = x0 + margin + c * (w + gap)
            pz = z0 + margin + r * (h + gap)
            # moulded frame, then the field standing proud of it
            out.append(box(f"{prefix}_frame_{c}_{r}", px, px + w, y_face - depth * 0.5, y_face + 0.01, pz, pz + h, mat, bevel=bevel * 0.6))
            ins = min(w, h) * 0.12
            out.append(box(f"{prefix}_field_{c}_{r}", px + ins, px + w - ins, y_face - depth * 1.4, y_face, pz + ins, pz + h - ins, mat, bevel=bevel))
    return out


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def light(name, kind, loc, energy, color="#ffffff", size=0.2, rot=None, spot=None, blend=0.3, target=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = hexc(color)[:3]
    if kind == "AREA":
        ld.size = size if not isinstance(size, tuple) else size[0]
        if isinstance(size, tuple):
            ld.shape = "RECTANGLE"
            ld.size_y = size[1]
    elif kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = size
    elif kind == "SUN":
        ld.angle = size
    if kind == "SPOT" and spot:
        ld.spot_size = math.radians(spot)
        ld.spot_blend = blend
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    if rot:
        ob.rotation_euler = [math.radians(a) for a in rot]
    if target:
        look_at(ob, target)
    return link(ob)


def ring_text(prefix, s, radius, size, mat, center=(0, 0, 0), y=0.0, mid_deg=90.0, step_deg=8.0, top=True, extrude=0.004):
    """Letters set one by one around a circle in the XZ plane (facing -Y), upright on both arcs:
    the top arc reads left to right with letters pointing out, the bottom arc with letters pointing in."""
    cx, _, cz = center
    n = len(s)
    out = []
    for i, ch in enumerate(s):
        if ch == " ":
            continue
        off = (i - (n - 1) / 2) * step_deg
        a = math.radians(mid_deg - off if top else mid_deg + off)
        x = cx + radius * math.cos(a)
        z = cz + radius * math.sin(a)
        t = text(f"{prefix}_{i}", ch, x, y, z, size, mat, extrude=extrude)
        # spin about the viewing axis so each letter's up points away from (top) or toward (bottom) the centre
        spin = a - math.pi / 2 if top else a + math.pi / 2
        t.rotation_euler = (math.radians(90), -spin, 0)
        out.append(t)
    return out
