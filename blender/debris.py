"""Debris (debris.glb): DEBRIS_00 .. DEBRIS_11, each <= 600 triangles, origin at its centroid.

Pieces come from Voronoi bisect fracture (lib/fracture.py) of modelled parts, then torn-edge noise and bending:
  00-02 bent hull plates with torn edges (stiffened painted panel)   03-04 truss fragments
  05-06 shattered tank shell pieces (curved welded shell)            07    radiator fragment with fluid tubes
  08    equipment chunk with a dangling severed cable                09-11 small fragments (shard, bracket, MLI scrap)
In the file the pieces sit on a 4 x 3 grid so the preview shows them; the runtime places them.
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector, Matrix
from lib import core, geo, kit, mats, fracture
from lib.core import T, R, frame

V = Vector


def to_mesh(mb, name):
    me = bpy.data.meshes.new(name)
    mb.bm.to_mesh(me)
    for m in mb.mat_names:
        me.materials.append(mats.get(m))
    names = list(mb.mat_names)
    mb.bm.free()
    return me, names


def place_piece(name, bm, mat_names, pos, root, extra=None):
    """Re-centre a fractured bmesh on its centroid and make the DEBRIS_xx object at grid position pos."""
    c = V((0, 0, 0))
    for v in bm.verts:
        c += v.co
    c /= max(1, len(bm.verts))
    bmesh.ops.translate(bm, vec=-c, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mat_names:
        me.materials.append(mats.get(m))
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(35))
    ob = bpy.data.objects.new(name, me)
    core.link(ob)
    core.place(ob, T(pos), root)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris > 590:
        d = ob.modifiers.new('decimate', 'DECIMATE')
        d.ratio = 560.0 / tris
    wn = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    wn.keep_sharp = True
    return ob


def cut(me, names, seeds, i, cap, rng, tear=0.012, scale=0.05, jitter=0.15):
    if cap not in names:
        names.append(cap)
        me.materials.append(mats.get(cap))
    return fracture.cell(me, seeds, i, cap_mat=names.index(cap), tear=tear, tear_scale=scale, seed=i + 0.37,
                         jitter_planes=jitter, rng=rng)


def build():
    rng = random.Random(9101)
    root = core.empty('DEBRIS', size=0.5)
    grid = [V((-1.8 + 1.2 * (k % 4), 1.2 - 1.2 * (k // 4), 0.0)) for k in range(12)]
    pieces = []

    # ---- A: stiffened hull plate -> 3 bent, torn pieces + 1 small shard
    mb = geo.MeshBuilder('_plate')
    mb.box((1.4, 1.0, 0.025), T(0, 0, 0), 'MAT_HULL_PAINT', bevel=0.006, seg=1)
    f = mb.subdivide([x for x in mb.bm.faces], 5)
    for y in (-0.25, 0.25):
        mb.box((1.4, 0.04, 0.05), T(0, y, -0.035), 'MAT_HULL_METAL')
    mb.box((0.04, 1.0, 0.04), T(0.1, 0, -0.03), 'MAT_HULL_METAL')
    for x in (-0.5, -0.2, 0.4):
        mb.hexbolt(0.01, 0.007, T(x, 0.44, 0.0125), 'MAT_HULL_METAL')
    me, names = to_mesh(mb, '_plate')
    seeds = [V((-0.42, 0.22, 0)), V((0.35, 0.25, 0)), V((-0.05, -0.3, 0)), V((0.58, -0.38, 0)), V((-0.62, -0.4, 0))]
    for k, (deg, ax) in enumerate(((95, (0, 1, 0)), (-75, (1, 0, 0)), (120, (0.6, 0.8, 0)))):
        bm = cut(me, names, seeds, k, 'MAT_HULL_METAL', rng, tear=0.035, scale=0.035)
        fracture.bend(bm, V(seeds[k]) - V((0.1, 0.05, 0)), ax, V((0.8, -0.6, 0)) if k != 1 else V((0, 1, 0)), deg)
        pieces.append(('A', bm, list(names)))
    shard = cut(me, names, seeds, 3, 'MAT_HULL_METAL', rng, tear=0.02, scale=0.03)
    fracture.bend(shard, V(seeds[3]), (1, 0.3, 0), (0, 1, 0), -90)

    # ---- B: truss segment -> 2 fragments
    mb = geo.MeshBuilder('_truss')
    kit.truss(mb, (0, -0.9, 0), (0, 0.9, 0), 0.6, 2, 0.03, 0.016)
    me_t, names_t = to_mesh(mb, '_truss')
    seeds_t = [V((0.05, -0.55, 0.1)), V((-0.05, 0.6, -0.1)), V((0.3, 0.05, 0.25))]
    for k in range(2):
        bm = cut(me_t, names_t, seeds_t, k, 'MAT_HULL_METAL', rng, tear=0.01, scale=0.03, jitter=0.35)
        pieces.append(('B', bm, list(names_t)))

    # ---- C: curved tank shell patch with weld bead and girth-ring stub -> 2 pieces
    mb = geo.MeshBuilder('_shell')
    Rr = 0.74
    fc = mb.box((1.1, 1.1, 0.022), T(0, 0, Rr), 'MAT_HULL_METAL')
    fc = mb.subdivide(fc, 5)
    for v in mb.bm.verts:
        d = v.co.normalized()
        t = v.co.z - Rr                       # thickness offset relative to the mid surface
        v.co = d * (Rr + t)
    mb.sweep([V((math.sin(a) * (Rr + 0.012), 0.0, math.cos(a) * (Rr + 0.012))) for a in
              [math.radians(x) for x in range(-38, 40, 8)]], 0.007, None, 'MAT_HULL_METAL', seg=5)
    mb.box((0.06, 1.0, 0.05), T(0.38, 0, Rr * 0.92) @ R('Y', 30), 'MAT_HULL_METAL')
    me_s, names_s = to_mesh(mb, '_shell')
    seeds_s = [V((-0.25, 0.2, 0.7)), V((0.25, -0.2, 0.7)), V((0.3, 0.42, 0.62)), V((-0.35, -0.38, 0.62))]
    for k in range(2):
        bm = cut(me_s, names_s, seeds_s, k, 'MAT_HULL_METAL', rng, tear=0.03, scale=0.035)
        pieces.append(('C', bm, list(names_s)))

    # ---- D: radiator fragment with fluid tubes and a spar
    mb = geo.MeshBuilder('_rad')
    mb.box((1.0, 0.8, 0.03), T(0, 0, 0), 'MAT_RADIATOR')
    for i in range(5):
        y = -0.32 + i * 0.16
        for zs in (1, -1):
            mb.cyl(0.011, 1.0, T(0, y, zs * 0.015) @ R('Y', 90), 'MAT_RADIATOR', seg=5)
    mb.box((1.0, 0.04, 0.045), T(0, 0.4, 0), 'MAT_HULL_METAL')
    me_r, names_r = to_mesh(mb, '_rad')
    bm = cut(me_r, names_r, [V((-0.15, 0.1, 0)), V((0.5, -0.2, 0)), V((-0.6, -0.35, 0))], 0, 'MAT_HULL_METAL', rng,
             tear=0.015, scale=0.04)
    fracture.bend(bm, V((0.1, 0, 0)), (0, 1, 0), (1, 0, 0), 25)
    pieces.append(('D', bm, list(names_r)))

    # ---- E: equipment box chunk with a dangling severed cable
    mb = geo.MeshBuilder('_box')
    kit.box_unit(mb, T(0, 0, 0), (0.42, 0.3, 0.24), 'MAT_DARK_COMPOSITE', rng=rng, ribs=4, connectors=0,
                 rib_mat='MAT_HULL_METAL')
    mb.box((0.5, 0.06, 0.02), T(0, 0.17, 0.01), 'MAT_HULL_METAL')
    me_b, names_b = to_mesh(mb, '_box')
    bm_e = cut(me_b, names_b, [V((-0.1, 0.0, 0.12)), V((0.3, 0.1, 0.1)), V((0.0, -0.3, 0.2))], 0, 'MAT_HULL_METAL',
               rng, tear=0.015, scale=0.04)
    cab = geo.MeshBuilder('_cable')
    p0 = V((0.12, 0.02, 0.12))
    cab.curve_pipe([p0, p0 + V((0.12, 0.05, -0.05)), p0 + V((0.2, -0.05, -0.3)), p0 + V((0.15, 0.0, -0.55))], 0.009,
                   'MAT_CABLE_BLACK', res_u=4)
    cab.curve_pipe([p0 + V((0.0, 0.03, 0.0)), p0 + V((0.08, 0.1, -0.12)), p0 + V((0.06, 0.12, -0.32))], 0.006,
                   'MAT_CABLE_RED', res_u=4)
    kit.connector(cab, frame(p0 + V((0.15, 0.0, -0.55)), z=(0, 0, -1)), 0.014, 0.035)
    me_c, names_c = to_mesh(cab, '_cable')
    off = len(names_b)
    tmp = bmesh.new()
    tmp.from_mesh(me_c)
    for fc in tmp.faces:
        fc.material_index += off
    me_c2 = bpy.data.meshes.new('_c2')
    tmp.to_mesh(me_c2)
    tmp.free()
    bm_e.from_mesh(me_c2)
    pieces.append(('E', bm_e, names_b + names_c))

    # ---- F: small fragments: plate shard (from A), bracket shard, MLI scrap
    pieces.append(('F', shard, list(names)))
    mb = geo.MeshBuilder('_brk')
    mb.prism([(-0.12, 0.0), (0.12, 0.0), (0.12, 0.03), (0.02, 0.03), (0.02, 0.2), (-0.02, 0.2), (-0.02, 0.03),
              (-0.12, 0.03)], 0.08, T(0, 0, 0), 'MAT_HULL_METAL', bevel=0.003, seg=1)
    mb.hexbolt(0.01, 0.008, T(-0.08, 0.03, 0) @ R('X', -90), 'MAT_HULL_METAL')
    me_k, names_k = to_mesh(mb, '_brk')
    pieces.append(('F', cut(me_k, names_k, [V((0, 0.05, 0)), V((0.1, 0.2, 0.02))], 0, 'MAT_HULL_METAL', rng,
                            tear=0.006, scale=0.02), list(names_k)))
    mb = geo.MeshBuilder('_mli')
    f = mb.grid(0.45, 0.32, 9, 7, T(0, 0, 0), 'MAT_MLI_GOLD',
                zfunc=lambda x, y: 0.03 * math.sin(x * 9) * math.cos(y * 7) + 0.02 * math.sin(x * 23 + y * 5))
    mb.wrinkle(f, 0.008, 0.03, seed=5.0)
    # MLI scrap is an open sheet: give it a back face so it is a closed, double-sided shard
    back = mb.grid(0.45, 0.32, 9, 7, T(0, 0, -0.002) @ R('X', 180), 'MAT_MLI_SILVER',
                   zfunc=lambda x, y: -(0.03 * math.sin(x * 9) * math.cos(-y * 7) + 0.02 * math.sin(x * 23 - y * 5)))
    me_m, names_m = to_mesh(mb, '_mli')
    bm_m = bmesh.new()
    bm_m.from_mesh(me_m)
    pieces.append(('F', bm_m, list(names_m)))

    for k, (kind, bm, nm) in enumerate(pieces[:12]):
        ob = place_piece(f'DEBRIS_{k:02d}', bm, nm, grid[k], root)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)
    return {'root': root, 'masks': dict(ao_dist=0.4, crevice=0.02, samples=20, wear_gain=1.6, wear_noise=0.06),
            'preview': dict(view_dir=(0.35, -0.75, 0.85), sun_dir=(-0.5, 0.7, 0.9), fov=30, margin=1.0)}
