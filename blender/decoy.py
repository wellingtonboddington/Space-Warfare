"""Inflatable decoys (decoy.glb). Two top-level nodes, both at the origin:
  DECOY_SHIP  wrinkled aluminised envelope lobes crudely mimicking the Interceptor's size and outline (cab lobe,
              ring lobe, twin tank lobes, spine sausage, two flat radiator pillows, engine cone), seams and
              tie cords, with the heater pack and the inflation gas bottle strapped to the spine.  HIT_envelope.
  DECOY_KKV   1.5 m wrinkled balloon with a wire radar-reflector cage (three orthogonal hoops + corner
              reflector fins) and a fill valve.  HIT_envelope_kkv.
"""
import math
import random
import bpy
from mathutils import Vector, Matrix
from lib import core, geo, kit
from lib.core import T, R, S, frame

V = Vector


def lobe(mb, c, r, M=None, seg=20, rings=12, amp=0.05, scale=0.2, seed=0.0, mat='MAT_MLI_SILVER'):
    """Ellipsoidal envelope lobe (r = radii), crinkled, with a seam bead around its waist."""
    Ms = T(c) @ (M or Matrix.Identity(4)) @ S(r[0], r[1], r[2])
    f = mb.sphere(1.0, Ms, mat, seg=seg, rings=rings)
    mb.wrinkle(f, amp, scale, seed, sharp=0.75)
    mb.torus(1.0, 0.012 / max(r), Ms @ R('X', 90), 'MAT_MLI_SILVER', seg=seg, rseg=3)
    return f


def build_ship(root_s, rng):
    mb = geo.MeshBuilder('DECOY_SHIP_ENVELOPE')
    with mb.region('envelope'):
        lobe(mb, V((0, 4.85, 0.1)), (1.05, 1.25, 0.95), seed=1.0)                  # cab
        lobe(mb, V((0, 3.2, 0.0)), (0.95, 0.55, 0.95), seed=2.0)                   # ring
        for sx in (-1, 1):
            lobe(mb, V((sx * 1.15, 0.75, 0.0)), (0.75, 0.75, 0.75), seed=3.0 + sx)  # tanks
        lobe(mb, V((0, -1.2, 0.0)), (0.42, 3.2, 0.42), seg=16, rings=14, seed=5.0)  # spine
        lobe(mb, V((0, -5.2, 0.0)), (0.55, 1.0, 0.55), seg=16, rings=8, seed=6.0)   # engine cone
        for sx in (-1, 1):
            # flat radiator pillows: squashed lobes on thin booms
            lobe(mb, V((sx * 3.0, -2.1, 0.0)), (2.45, 1.25, 0.09), seg=20, rings=8, amp=0.035, scale=0.3,
                 seed=7.0 + sx)
            kit.strut(mb, V((sx * 0.3, -2.1, 0)), V((sx * 0.75, -2.1, 0)), 0.02, 'MAT_HULL_METAL', seg=6)
    # tie cords between lobes, heater pack and gas bottle strapped to the spine
    for a, b in ((V((0, 3.75, 0.85)), V((0, 4.0, 0.9))), (V((0.9, 3.0, 0.2)), V((0.7, 1.3, 0.3))),
                 (V((-0.9, 3.0, 0.2)), V((-0.7, 1.3, 0.3))), (V((0, 2.65, 0.3)), V((0, 1.9, 0.38))),
                 (V((0.4, 0.4, 0.3)), V((0.38, -0.4, 0.3)))):
        mb.curve_pipe([a, (a + b) / 2 + V((0, 0, -0.06)), b], 0.006, 'MAT_CABLE_GREY', res_u=3, bevel_res=0)
    kit.mli_box(mb, frame(V((0, -0.6, 0.42)), z=(0, 0, 1), y=(0, 1, 0)), (0.42, 0.34, 0.26), 'MAT_MLI_GOLD', amp=0.006,
                scale=0.08, seed=4.0, cuts=2)
    mb.box((0.1, 0.06, 0.04), T(0.12, -0.42, 0.7), 'MAT_DARK_COMPOSITE', bevel=0.008, seg=1)
    mb.lathe([(0.0, -0.3), (0.13, -0.3), (0.15, -0.26), (0.15, 0.22), (0.1, 0.3), (0.04, 0.32), (0.04, 0.38),
              (0.0, 0.38)], frame(V((0.0, -2.9, 0.55)), z=(0, 1, 0), y=(0, 0, 1)), 'MAT_HULL_METAL', seg=14)
    for y in (-3.05, -2.75):
        mb.torus(0.155, 0.012, T(0, y, 0.55) @ R('X', 90), 'MAT_CABLE_BLACK', seg=14, rseg=3)
    mb.curve_pipe([V((0, -2.53, 0.55)), V((0, -2.3, 0.6)), V((0, -2.0, 0.42))], 0.01, 'MAT_CABLE_BLACK', res_u=3)
    lo, hi = mb.regions['envelope']
    mb.to_object('DECOY_SHIP_ENVELOPE', parent=root_s, sharp_angle=16, weighted=False)
    core.hit_box('envelope', lo, hi, root_s)


def build_kkv(root_k, rng):
    mb = geo.MeshBuilder('DECOY_KKV_ENVELOPE')
    with mb.region('envelope_kkv'):
        f = mb.sphere(0.72, T(0, 0, 0), 'MAT_MLI_SILVER', seg=20, rings=12)
        mb.wrinkle(f, 0.04, 0.14, seed=9.0, sharp=0.75)
        for M in (Matrix.Identity(4), R('X', 90), R('Y', 90)):
            mb.torus(0.75, 0.005, M, 'MAT_HULL_METAL', seg=32, rseg=3)
        # corner-reflector fins in the octant planes (wire mesh plates)
        for M in (Matrix.Identity(4), R('X', 90), R('Y', 90)):
            for k in range(4):
                mb.box((0.012, 0.72, 0.004), M @ R('Z', 45 + 90 * k) @ T(0, 0.37, 0), 'MAT_HULL_METAL')
    mb.cyl(0.04, 0.08, T(0, -0.76, 0) @ R('X', 90), 'MAT_HULL_METAL', seg=10)
    mb.cyl(0.02, 0.04, T(0, -0.82, 0) @ R('X', 90), 'MAT_PAINT_RED', seg=8)
    lo, hi = mb.regions['envelope_kkv']
    mb.to_object('DECOY_KKV_ENVELOPE', parent=root_k, sharp_angle=16, weighted=False)
    core.hit_box('envelope_kkv', lo, hi, root_k)


def spread_for_preview():
    ob = bpy.data.objects['DECOY_KKV']
    ob.matrix_basis = T(4.2, 2.5, 0.0)


def build():
    rng = random.Random(12101)
    root_s = core.empty('DECOY_SHIP', size=1.0)
    root_k = core.empty('DECOY_KKV', size=0.4)
    build_ship(root_s, rng)
    build_kkv(root_k, rng)
    return {'root': None, 'masks': dict(ao_dist=1.0, crevice=0.03, samples=16), 'pre_preview': spread_for_preview,
            'preview': dict(view_dir=(1.0, 0.75, 0.6), sun_dir=(-0.5, 0.7, 0.9), fov=28, margin=1.02)}
