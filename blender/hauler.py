"""Civilian / LC ice hauler (hauler.glb), ~38 m, unarmed.

Spine truss y -9.6..17; huge MLI-wrapped water-ice tank (r 3.2, y -5..13) threaded on the spine with clamp
bands and tape seams; small crew pod at the nose (y 15.3..18.5) with docking port; hi-vis orange/black chevron
bands on the pod and tank end rings (civilian marking, MAT_HIVIS); one regen engine aft (HP_ENGINE at the exit,
exhaust along -Y); one radiator on a dorsal mast aft; beacons, RCS, small pressurant spheres.
"""
import math
import random
from mathutils import Vector, Matrix
from lib import core, geo, kit
from lib.core import T, R, frame

V = Vector
AX = frame((0, 0, 0), z=(0, 1, 0), y=(0, 0, 1))


def hivis_band(mb, y, r, width=0.5, n=24):
    """Hi-vis band: orange ring with black chevron blocks, slightly proud of radius r."""
    mb.lathe([(r + 0.01, y - width / 2), (r + 0.02, y - width / 2 + 0.02), (r + 0.02, y + width / 2 - 0.02),
              (r + 0.01, y + width / 2)], AX, 'MAT_HIVIS', seg=40)
    for k in range(n):
        a = math.tau * k / n
        n_ = V((math.cos(a), 0, math.sin(a)))
        mb.box((width * 0.35, width * 0.95, 0.012), frame(n_ * (r + 0.026) + V((0, y, 0)), z=n_, y=(0, 1, 0)) @ R('Z', 35),
               'MAT_PANEL_BLACK')


def build():
    rng = random.Random(11101)
    root = core.empty('HAULER', size=2.0)
    mb = geo.MeshBuilder('HAULER_BODY')
    with mb.region('truss'):
        kit.truss(mb, (0, -9.6, 0), (0, -5.4, 0), 1.0, 3, 0.06, 0.03)
        kit.truss(mb, (0, 13.4, 0), (0, 15.3, 0), 1.0, 2, 0.06, 0.03)
        mb.box((1.0, 18.8, 1.0), T(0, 4, 0), 'MAT_HULL_METAL')               # spine through the tank (hidden)
    with mb.region('tank_cargo'):
        f = mb.lathe([(1.2, -5.15), (2.6, -4.9), (3.2, -4.0), (3.2, 12.0), (2.6, 12.9), (1.2, 13.15)], AX,
                     'MAT_BETA_CLOTH', seg=40)
        f = mb.subdivide(f, 1)
        mb.wrinkle(f, 0.04, 0.6, seed=8.0, sharp=0.7)
        mb.lathe([(1.25, -5.2), (1.25, -5.0)], AX, 'MAT_HULL_METAL', seg=24)
        mb.lathe([(1.25, 13.0), (1.25, 13.2)], AX, 'MAT_HULL_METAL', seg=24)
        for y in (-3.0, 0.4, 4.0, 7.6, 11.0):
            mb.torus(3.24, 0.05, T(0, y, 0) @ R('X', 90), 'MAT_HULL_METAL', seg=48, rseg=4)
            for k in range(4):
                a = math.radians(45 + 90 * k)
                mb.box((0.16, 0.25, 0.1), frame(V((math.cos(a) * 3.28, y, math.sin(a) * 3.28)),
                                                z=(math.cos(a), 0, math.sin(a))), 'MAT_HULL_METAL', bevel=0.02, seg=1)
        for a in (0, 90, 180, 270):
            mb.lathe([(3.215, -4.0), (3.215, 12.0)], AX @ R('Z', a), 'MAT_MLI_GOLD', seg=2, arc=4)
        hivis_band(mb, -4.25, 3.2, 0.6)
        hivis_band(mb, 12.25, 3.2, 0.6)
        for y in (-2.0, 9.0):
            kit.handrail(mb, frame(V((0, y, 3.25)), z=(0, 0, 1), y=(1, 0, 0)), 2.5, 0.12)
        kit.vent(mb, frame(V((0.0, 12.95, 2.2)), z=(0, 0.6, 1)), 0.06)
    with mb.region('cabin'):
        mb.lathe([(0.0, 15.3), (1.0, 15.3), (1.3, 15.6), (1.3, 17.2), (1.1, 17.9), (0.75, 18.25), (0.0, 18.3)], AX,
                 'MAT_HULL_PAINT', seg=16)
        hivis_band(mb, 16.0, 1.3, 0.35, n=14)
        for k in (-1, 0, 1):
            a = math.radians(90 + 32 * k)
            n_ = V((math.cos(a), 0.45, math.sin(a))).normalized()
            p = V((0, 17.55, 0)) + V((math.cos(a), 0, math.sin(a))) * 1.18
            mb.box((0.36, 0.26, 0.04), frame(p, z=n_, y=(0, 0.3, 1)), 'MAT_GLASS')
            mb.box((0.42, 0.32, 0.03), frame(p - n_ * 0.015, z=n_, y=(0, 0.3, 1)), 'MAT_HULL_METAL', bevel=0.008, seg=1)
        from depot import docking_port
        docking_port(mb, frame(V((0, 18.28, 0)), z=(0, 1, 0), y=(0, 0, 1)), 0.45)
        for sx in (-1, 1):
            kit.light_beacon(mb, frame(V((sx * 1.3, 16.6, 0)), z=(sx, 0, 0)), 0.05)
            kit.rcs_quad(mb, frame(V((sx * 1.3, 17.0, -0.4)), z=(sx, 0, 0), y=(0, 1, 0)), 0.22)
            kit.access_panel(mb, frame(V((sx * 1.29, 16.6, -0.5)), z=(sx, 0, -0.1), y=(0, 1, 0)), 0.6, 0.5, 0.015)
        kit.whip_antenna(mb, frame(V((0.4, 16.6, 1.27)), z=(0.3, 0, 1)), 1.1)
        kit.umbilical_port(mb, frame(V((0, 15.8, -1.29)), z=(0, 0, -1), y=(0, 1, 0)), 0.32, 0.22, rng=rng)
    # aft: pressurant spheres, thrust frame, engine
    for sx in (-1, 1):
        kit.tank_sphere(mb, T(sx * 1.05, -7.2, 0), 0.55, 'MAT_HULL_METAL', seg=20, rings=10, straps=False, rng=rng)
        kit.strut(mb, V((sx * 0.5, -7.2, 0)), V((sx * 0.6, -7.2, 0)), 0.05)
        kit.pipe_run(mb, [V((sx * 1.05, -7.2, -0.6)), V((sx * 0.6, -8.4, -0.5)), V((sx * 0.25, -9.7, -0.3))], 0.04,
                     'MAT_HULL_METAL', clamp_every=0)
    for k in range(6):
        a = math.tau * k / 6
        kit.strut(mb, V((math.cos(a) * 0.65, -9.6, math.sin(a) * 0.65)), V((math.cos(a) * 0.4, -10.2, math.sin(a) * 0.4)),
                  0.05, seg=8, ends=0.1)
    eng = geo.MeshBuilder('ENGINE_BELL')
    with eng.region('engine'):
        kit.regen_bell(eng, frame(V((0, -10.6, 0)), z=(0, 1, 0), y=(0, 0, 1)), 0.14, 0.9, 2.6, tubes=44, chamber_r=0.26,
                       chamber_len=0.45)
    # single radiator on a dorsal mast, aft of the tank
    with mb.region('radiator'):
        kit.radiator_panel(mb, T(-2.0, -6.4, 3.6), 4.0, 3.0, 0.04, tubes=12)
    kit.strut(mb, V((0, -6.4, 0.5)), V((0, -6.4, 3.55)), 0.09, seg=10, ends=0.15)
    kit.strut(mb, V((0.4, -7.5, 0.5)), V((-0.5, -6.4, 3.5)), 0.04, seg=6)
    kit.pipe_run(mb, [V((0.2, -6.0, 0.55)), V((0.25, -6.0, 3.0)), V((-1.85, -6.3, 3.6))], 0.04, 'MAT_HULL_METAL',
                 clamp_every=0.9, surface_dir=(-1, 0, 0))
    regions = dict(mb.regions)
    regions.update(eng.regions)
    mb.to_object('HAULER_BODY', parent=root)
    eng.to_object('ENGINE_BELL', parent=root)
    core.empty('HP_ENGINE', T(0, -13.2, 0), root, 'SINGLE_ARROW', 0.6)
    for comp in ('cabin', 'tank_cargo', 'engine', 'radiator', 'truss'):
        lo, hi = regions[comp]
        core.hit_box(comp, lo, hi, root)
    return {'root': root, 'masks': dict(ao_dist=2.5, crevice=0.08, samples=16),
            'preview': dict(view_dir=(1.0, 0.7, 0.55), sun_dir=(-0.5, 0.7, 0.9), fov=28, margin=1.02)}
