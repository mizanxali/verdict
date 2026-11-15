"""
Render the courtroom built by courtroom.py into the depth layers the 2D stage composites,
and write a manifest the web app reads: where each layer sits, where each figure stands
(projected from the spot empties), and where the live brass nameplates are.

    exec(open("art/blender/render.py").read())          # all layers
    RENDER_ONLY = ["back"]; exec(open(...).read())      # just some

Layers come out as full-frame PNGs in art/build/court; encode.sh crops and converts them
to WebP for web/public/art/court.
"""
import json
import os

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd(), "..", ".."))
OUT = os.path.join(REPO, "art", "build", "court")
os.makedirs(OUT, exist_ok=True)

STAGE_W, STAGE_H = 1600, 900
FIGURE_UNITS = 318  # a figure's height in the 2D rig at scale 1
FIGURE_M = 1.72  # ...and the real height that stands for
SCALE = globals().get("RENDER_SCALE", 200)  # percent of 1600x900
SAMPLES = globals().get("RENDER_SAMPLES", 256)

LAYERS = ["back", "bench", "clerk", "door", "stand", "juryback", "jurymid", "juryfront", "tables", "rail"]

scene = bpy.context.scene
cam = scene.camera


def objects_in(c):
    out = set(c.objects)
    for ch in c.children:
        out |= objects_in(ch)
    return out


RENDERABLE = [o for o in scene.objects if o.type in {"MESH", "CURVE", "FONT"} and not o.hide_render]
haze = bpy.data.objects.get("haze")


def project(co):
    v = world_to_camera_view(scene, cam, Vector(co))
    return (v.x * STAGE_W, (1 - v.y) * STAGE_H)


def alpha_bbox(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[:, :, 3]
    bpy.data.images.remove(img)
    ys, xs = np.nonzero(a > 0.002)
    if not len(xs):
        return None
    # image rows are bottom-up
    pad = 2
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
    y0, y1 = max(0, h - (ys.max() + 1) - pad), min(h, h - ys.min() + pad)
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


def setup(samples):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = STAGE_W
    scene.render.resolution_y = STAGE_H
    scene.render.resolution_percentage = SCALE
    scene.render.film_transparent = True
    s = scene.render.image_settings
    s.file_format = "PNG"
    s.color_mode = "RGBA"
    s.color_depth = "8"
    s.compression = 30


def render_layer(name):
    keep = objects_in(bpy.data.collections[f"L_{name}"])
    for o in RENDERABLE:
        o.visible_camera = o in keep and o.name not in ("ceiling",)
        o.is_holdout = False
    if haze:
        haze.hide_render = True
    path = os.path.join(OUT, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def render_haze():
    """Light in the air only: every surface is a holdout, so the shafts are occluded but not drawn."""
    for o in RENDERABLE:
        o.visible_camera = o.name not in ("sky",) and not o.name.startswith("city")
        o.is_holdout = True
    haze.hide_render = False
    # only the sun and the lamps light the air: shafts and halos, not a uniform fog
    for o in scene.objects:
        if o.type == "LIGHT":
            o.visible_volume_scatter = o.name == "sun" or o.name.startswith("sconce") or o.name == "clerk_lamp"
    samples = scene.cycles.samples
    scene.cycles.samples = 768
    scene.cycles.volume_step_rate = 1.0
    path = os.path.join(OUT, "haze.png")
    scene.render.filepath = path
    pct = scene.render.resolution_percentage
    scene.render.resolution_percentage = 100
    bpy.ops.render.render(write_still=True)
    scene.render.resolution_percentage = pct
    scene.cycles.samples = samples
    for o in scene.objects:
        if o.type == "LIGHT":
            o.visible_volume_scatter = True
    for o in RENDERABLE:
        o.is_holdout = False
    haze.hide_render = True
    return path


def restore():
    for o in RENDERABLE:
        o.visible_camera = o.name != "ceiling"
        o.is_holdout = False
    if haze:
        haze.hide_render = True


def manifest(bboxes):
    k = SCALE / 100
    spots = {}
    for e in bpy.data.collections["SPOTS"].objects:
        name = e.name.replace("spot_", "")
        feet = e.location.copy()
        head = feet.copy()
        head.z += FIGURE_M
        fx, fy = project(feet)
        _, hy = project(head)
        s = (fy - hy) / FIGURE_UNITS
        spot = {"x": round(fx, 1), "y": round(fy, 1), "s": round(s, 4)}
        drop = float(e.get("drop", 0.0))
        if drop:
            sunk = feet.copy()
            sunk.z += FIGURE_M - drop
            _, sy = project(sunk)
            spot["sink"] = round((sy - hy) / s, 1)
        spots[name] = spot

    def quad(key):
        x0, y0, z0, x1, y1, z1 = scene[key]
        pts = [project((x0, y0, z1)), project((x1, y0, z1)), project((x1, y0, z0)), project((x0, y0, z0))]
        return [[round(a, 1), round(b, 1)] for a, b in pts]

    layers = {}
    for name, bb in bboxes.items():
        if bb is None:
            continue
        x, y, w, h = bb
        if name == "haze":  # rendered at stage size, shown full frame
            layers[name] = {"x": 0, "y": 0, "w": STAGE_W, "h": STAGE_H, "px": bb}
            continue
        layers[name] = {"x": round(x / k, 2), "y": round(y / k, 2), "w": round(w / k, 2), "h": round(h / k, 2), "px": [x, y, w, h]}
    out = {
        "stage": [STAGE_W, STAGE_H],
        "scale": k,
        "layers": layers,
        "spots": spots,
        "plates": {"bench": quad("plate_bench"), "stand": quad("plate_stand")},
        "doorLeaf": quad("door_leaf"),
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(out, f, indent=2)
    return out


only = globals().get("RENDER_ONLY")
manifest_only = globals().get("MANIFEST_ONLY", False)
setup(SAMPLES)
bbs_path = os.path.join(OUT, "bboxes.json")
bboxes = json.load(open(bbs_path)) if os.path.exists(bbs_path) else {}
for name in LAYERS:
    if manifest_only or (only and name not in only):
        continue
    p = render_layer(name)
    bboxes[name] = alpha_bbox(p) if name != "back" else [0, 0, STAGE_W * SCALE // 100, STAGE_H * SCALE // 100]
    print("rendered", name, bboxes[name])
if not manifest_only and (not only or "haze" in only):
    render_haze()
    bboxes["haze"] = [0, 0, STAGE_W, STAGE_H]
if not manifest_only:
    json.dump(bboxes, open(bbs_path, "w"))
restore()
m = manifest(bboxes)
print("manifest written:", len(m["spots"]), "spots", len(m["layers"]), "layers")
