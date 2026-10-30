"""Cycles CPU preview renders: 3/4 view, one hard sun, black world, low samples + OIDN denoise."""
import math
import bpy
from mathutils import Vector
from . import core, mats


def setup(samples=24, res=(960, 540)):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 2
    sc.cycles.transparent_max_bounces = 4
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 4
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new('black')
    w.color = (0, 0, 0)
    try:
        bg = w.node_tree.nodes.get('Background')
        bg.inputs['Color'].default_value = (0, 0, 0, 1)
        bg.inputs['Strength'].default_value = 0.0
    except Exception:
        pass
    sc.world = w


def sun(direction=(-0.55, 0.75, 0.9), energy=5.0, angle_deg=0.53, name='_preview_sun'):
    ld = bpy.data.lights.new(name, 'SUN')
    ld.energy = energy
    ld.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new(name, ld)
    core.link(ob)
    d = Vector(direction).normalized()
    core.place(ob, core.look_frame(d * 10, Vector((0, 0, 0))))
    return ob


def fill(energy=0.0):
    return None


def _world_points(max_pts=30000):
    pts = []
    objs = [o for o in core.mesh_objects() if not o.name.startswith('DECAL_') and not o.get('_cutter')]
    total = sum(len(o.data.vertices) for o in objs) or 1
    step = max(1, total // max_pts)
    for o in objs:
        M = core.world(o)
        vs = o.data.vertices
        for i in range(0, len(vs), step):
            pts.append(M @ vs[i].co)
    return pts


def camera_for_bounds(lo, hi, view_dir=(1.0, 0.8, 0.55), fov=30, aspect=16 / 9, margin=1.08, target=None,
                      name='_preview_cam', points=None):
    """Frame the geometry: the camera looks along -view_dir and backs off until every point (mesh vertices
    when given, else the 8 box corners) fits the frustum; the target is re-centred on the projected extent."""
    d = Vector(view_dir).normalized()
    half = math.radians(fov) / 2
    th, tw = math.tan(half), math.tan(half) * aspect
    pts = points if points else [Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1])
                                 for z in (lo[2], hi[2])]
    c = (Vector(lo) + Vector(hi)) * 0.5 if target is None else Vector(target)
    Mr = core.look_frame(c + d, c).to_3x3()
    Mv = Mr.transposed()
    Q = [Mv @ (p - c) for p in pts]
    if target is None:
        # re-centre on the projected extent (orthographic approximation)
        cx = (max(q.x for q in Q) + min(q.x for q in Q)) / 2
        cy = (max(q.y for q in Q) + min(q.y for q in Q)) / 2
        c = c + Mr @ Vector((cx, cy, 0))
        Q = [q - Vector((cx, cy, 0)) for q in Q]
    dist = max(max(abs(q.x) / tw + q.z, abs(q.y) / th + q.z) for q in Q)
    r = (Vector(hi) - Vector(lo)).length * 0.5
    dist = max(dist * margin, r * 0.3)
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(fov)
    cd.clip_start = max(0.005, dist * 0.01)
    cd.clip_end = dist * 10
    ob = bpy.data.objects.new(name, cd)
    core.link(ob)
    core.place(ob, core.look_frame(c + d * dist, c))
    return ob


def camera_at(loc, target, fov=60, name='_preview_cam', up=(0, 0, 1)):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(fov)
    cd.clip_start = 0.01
    cd.clip_end = 500
    ob = bpy.data.objects.new(name, cd)
    core.link(ob)
    core.place(ob, core.look_frame(Vector(loc), Vector(target), Vector(up)))
    return ob


def render(path, cam, samples=24, res=(960, 540)):
    setup(samples, res)
    mats.preview_mode(True)
    for o in bpy.context.scene.objects:          # decal planes carry runtime-generated textures only
        if o.name.startswith('DECAL_') or o.get('_cutter'):
            o.hide_render = True
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def preview(path, view_dir=(1.0, 0.8, 0.55), sun_dir=(-0.55, 0.75, 0.9), fov=30, samples=24, margin=1.05,
            lo=None, hi=None, energy=5.0):
    pts = None
    if lo is None:
        lo, hi = core.world_bounds([o for o in core.mesh_objects() if not o.name.startswith('DECAL_')])
        pts = _world_points()
    cam = camera_for_bounds(lo, hi, view_dir, fov, margin=margin, points=pts)
    s = sun(sun_dir, energy)
    render(path, cam, samples)
    return cam, s
