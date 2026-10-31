"""Orbital propellant depot (depot.glb), the Picket's protected asset, ~60 m across.

Central 1.6 m box truss along Y (y -23..23); control module at the centre with docking ports (+Z, -Z, +Y end
adapter) and floodlights; four large MLI-insulated cylindrical tanks on the truss (tank_0 y+8, tank_1 y-8,
tank_2 y+18, tank_3 y-18); two solar-array wings on booms and drive gimbals (x +-9 .. +-27); a dorsal radiator
on masts; transfer plumbing with valves along the truss; nav beacons (MAT_LIGHT).
"""
import math
import random
from mathutils import Vector, Matrix
from lib import core, geo, kit
from lib.core import T, R, frame

V = Vector
AX = frame((0, 0, 0), z=(0, 1, 0), y=(0, 0, 1))


def docking_port(mb, M, r=0.8):
    """Androgynous docking port: collar, guide petals, latches, capture ring, target and floodlight."""
    mb.lathe([(r * 1.25, 0.0), (r * 1.25, 0.25), (r * 1.1, 0.32), (r * 1.1, 0.5), (r * 1.0, 0.55), (r * 0.85, 0.55),
              (r * 0.85, 0.3), (0.0, 0.3)], M, ['MAT_HULL_PAINT', 'MAT_HULL_METAL', 'MAT_HULL_METAL', 'MAT_HULL_METAL',
                                                'MAT_HULL_METAL', 'MAT_DARK_COMPOSITE', 'MAT_DARK_COMPOSITE'], seg=24)
    for k in range(3):
        a = math.tau * k / 3
        Mp = M @ R('Z', math.degrees(a)) @ T(0, r * 0.95, 0.55)
        mb.prism([(-0.22, 0.0), (0.22, 0.0), (0.0, 0.42)], 0.04, Mp @ frame((0, 0, 0), z=(0, 1, 0), y=(0, 0, 1)),
                 'MAT_HULL_METAL', bevel=0.01, seg=1)
    for k in range(12):
        a = math.tau * (k + 0.5) / 12
        mb.box((0.08, 0.05, 0.08), M @ R('Z', math.degrees(a)) @ T(0, r * 1.05, 0.5), 'MAT_DARK_COMPOSITE')
    mb.box((0.3, 0.3, 0.02), M @ T(0, 0, 0.31), 'MAT_PAINT_WHITE')
    mb.box((0.05, 0.3, 0.025), M @ T(0, 0, 0.32), 'MAT_PANEL_BLACK')
    mb.box((0.3, 0.05, 0.025), M @ T(0, 0, 0.32), 'MAT_PANEL_BLACK')
    for s in (-1, 1):
        mb.cyl(0.07, 0.08, M @ T(s * r * 1.45, 0, 0.1) @ R('X', 30 * s), 'MAT_DARK_COMPOSITE', seg=10)
        mb.cyl(0.055, 0.01, M @ T(s * r * 1.45, 0.02 * s, 0.145) @ R('X', 30 * s), 'MAT_EMISSIVE_WARM', seg=10)


def tank(mb, c, comp, rng, gold=False):
    with mb.region(comp):
        f = kit.tank_cyl(mb, T(c) @ R('X', -90), 3.6, 7.0, 'MAT_HULL_METAL', seg=32, dome=0.5, welds=2,
                         mli='MAT_MLI_GOLD' if gold else 'MAT_MLI_SILVER', rng=rng, end_fittings=True)
        # support rings bolted to the truss and tape seams over the blanket
        for dy in (-2.2, 2.2):
            mb.torus(3.63, 0.07, T(c + V((0, dy, 0))) @ R('X', 90), 'MAT_HULL_METAL', seg=40, rseg=4)
            for a in (45, 135, 225, 315):
                ar = math.radians(a)
                p0 = c + V((math.cos(ar) * 3.6, dy, math.sin(ar) * 3.6))
                p1 = V((math.copysign(0.8, math.cos(ar)), c.y + dy, math.copysign(0.8, math.sin(ar))))
                kit.strut(mb, p0, p1, 0.06, 'MAT_HULL_METAL', seg=6, ends=0.15)
        for a in (0, 90):
            mb.torus(3.62, 0.025, T(c) @ R('Z', a) @ R('Y', 90), 'MAT_MLI_GOLD' if not gold else 'MAT_MLI_SILVER',
                     seg=40, rseg=3)
        kit.light_beacon(mb, frame(c + V((0, 0, 3.7)), z=(0, 0, 1)), 0.06)
        kit.handrail(mb, frame(c + V((3.62, 0, 0.6)), z=(1, 0, 0), y=(0, 0, 1)) @ R('Z', 90), 3.0, 0.12)


def wing(mb, side, comp, rng):
    s = side
    # boom truss from the control module to the drive gimbal
    kit.truss(mb, (s * 2.2, 0, 0), (s * 8.4, 0, 0), 0.6, 4, 0.04, 0.02)
    with mb.region(comp):
        mb.cyl(0.45, 0.6, frame(V((s * 8.7, 0, 0)), z=(s, 0, 0)), 'MAT_HULL_METAL', seg=16, bevel=0.03, bseg=1)
        mb.box((0.5, 0.9, 0.5), T(s * 9.05, 0, 0), 'MAT_DARK_COMPOSITE', bevel=0.04, seg=1)
        # two blanket panels with a central mast, cell grid, tension wires, tip beacon
        mb.box((18.0, 0.18, 0.18), T(s * 18.2, 0, 0), 'MAT_HULL_METAL', bevel=0.02, seg=1)
        for sy in (-1, 1):
            Mp = T(s * 18.2, sy * 1.6, 0)
            mb.box((17.6, 2.7, 0.02), Mp, 'MAT_SOLAR_CELL')
            mb.box((17.8, 0.06, 0.05), Mp @ T(0, sy * 1.37, 0), 'MAT_HULL_METAL')
            for k in range(13):
                x = -8.8 + 17.6 * k / 12
                mb.box((0.04, 2.7, 0.03), Mp @ T(x, 0, 0.005), 'MAT_HULL_METAL')
            for j in range(1, 4):
                mb.box((17.6, 0.015, 0.024), Mp @ T(0, -1.35 + 2.7 * j / 4, 0.004), 'MAT_PANEL_GREY')
        mb.box((0.25, 3.4, 0.2), T(s * 27.1, 0, 0), 'MAT_HULL_METAL', bevel=0.02, seg=1)
        kit.light_beacon(mb, frame(V((s * 27.25, 0, 0.1)), z=(s, 0, 0.3)), 0.06)


def build():
    rng = random.Random(10101)
    root = core.empty('DEPOT', size=3.0)
    mb = geo.MeshBuilder('DEPOT_BODY')
    with mb.region('truss'):
        kit.truss(mb, (0, -23, 0), (0, -2.4, 0), 1.6, 10, 0.08, 0.04)
        kit.truss(mb, (0, 2.4, 0), (0, 23, 0), 1.6, 10, 0.08, 0.04)
    with mb.region('control'):
        mb.lathe([(0.0, -2.4), (1.6, -2.4), (2.2, -1.9), (2.2, 1.9), (1.6, 2.4), (0.0, 2.4)], AX, 'MAT_HULL_PAINT',
                 seg=16, phase=math.pi / 16)
        for k in range(16):
            a = math.tau * k / 16
            n = V((math.cos(a), 0, math.sin(a)))
            if k in (0, 4, 8, 12):
                continue
            kit.access_panel(mb, frame(n * 2.16, z=n, y=(0, 1, 0)), 0.6, 2.6, 0.02, pitch=0.6, handle=(k % 4 == 2))
        docking_port(mb, frame(V((0, 0, 2.2)), z=(0, 0, 1), y=(0, 1, 0)), 0.75)
        docking_port(mb, frame(V((0, 0, -2.2)), z=(0, 0, -1), y=(0, 1, 0)), 0.75)
        kit.dish(mb, frame(V((1.4, 1.2, 2.1)), z=(0.3, 0.2, 1)), 0.7, 0.18, 'MAT_RADIATOR')
        for sx in (-1, 1):
            kit.star_tracker(mb, frame(V((sx * 1.6, -1.8, 1.5)), z=(sx, -0.3, 1)), 0.06, 0.25)
            kit.rcs_quad(mb, frame(V((sx * 2.2, 1.6, 0)), z=(sx, 0, 0), y=(0, 1, 0)), 0.3)
    for c, comp, gold in ((V((0, 8, 0)), 'tank_0', False), (V((0, -8, 0)), 'tank_1', False),
                          (V((0, 18, 0)), 'tank_2', True), (V((0, -18, 0)), 'tank_3', True)):
        tank(mb, c, comp, rng, gold)
    wing(mb, -1, 'array_l', rng)
    wing(mb, 1, 'array_r', rng)
    # dorsal radiator on masts
    with mb.region('radiator'):
        kit.radiator_panel(mb, T(-3.0, 0, 6.0) @ R('Z', 0), 6.0, 16.0, 0.05, tubes=24, header=True)
    for y in (-6.5, 0.0, 6.5):
        kit.strut(mb, V((0, y, 2.2 if y == 0 else 0.8)), V((-2.6, y, 5.95)), 0.08, seg=8, ends=0.2)
        kit.strut(mb, V((0, y, 2.2 if y == 0 else 0.8)), V((2.6, y, 5.95)), 0.08, seg=8, ends=0.2)
    # transfer plumbing along the truss with valves; end beacons and RCS
    for sx in (-0.95, 0.95):
        kit.pipe_run(mb, [V((sx, -21.5, 0.3)), V((sx, -12, 0.3)), V((sx, -2.6, 0.3)), V((sx * 1.4, 0, 1.2)),
                          V((sx, 2.6, 0.3)), V((sx, 12, 0.3)), V((sx, 21.5, 0.3))], 0.1, 'MAT_HULL_METAL',
                     clamp_every=2.5, surface_dir=(-1 if sx > 0 else 1, 0, 0))
        for y in (-13, -3.2, 3.2, 13):
            kit.valve(mb, T(sx, y, 0.3) @ R('Z', 90), 0.22, 'wheel')
    for y in (-23.3, 23.3):
        kit.light_beacon(mb, frame(V((0, y, 0.85)), z=(0, math.copysign(1, y), 0.5)), 0.08)
        kit.rcs_quad(mb, frame(V((0, y, -0.8)), z=(0, 0, -1), y=(0, 1, 0)), 0.3)
    regions = dict(mb.regions)
    mb.to_object('DEPOT_BODY', parent=root)
    for comp in ('control', 'tank_0', 'tank_1', 'tank_2', 'tank_3', 'truss', 'array_l', 'array_r', 'radiator'):
        lo, hi = regions[comp]
        core.hit_box(comp, lo, hi, root)
    return {'root': root, 'masks': dict(ao_dist=4.0, crevice=0.12, samples=16),
            'preview': dict(view_dir=(0.8, 0.6, 0.9), sun_dir=(-0.5, 0.7, 0.9), fov=28, margin=1.02)}
