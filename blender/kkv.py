"""Kinetic kill vehicle (kkv.glb): ~1.4 m x 0.3 m, nose +Y. Sapphire IR seeker dome in a shroud, avionics
section, divert ring with 4 lateral thrusters (HP_DIVERT_0..3, local +Z = exhaust), attitude jets, boost motor
(HP_KKV_MOTOR at the nozzle exit, exhaust along -Y, identity rotation)."""
import math
import random
from mathutils import Vector, Matrix
from lib import core, geo, kit
from lib.core import T, R, frame

V = Vector


def build():
    rng = random.Random(7101)
    root = core.empty('KKV', size=0.3)
    mb = geo.MeshBuilder('KKV_BODY')
    Mx = frame((0, 0, 0), z=(0, 1, 0), y=(0, 0, 1))         # lathe axis = +Y
    with mb.region('body'):
        # airframe profile (r, y): motor case aft, divert ring, avionics, seeker shroud
        prof = [(0.0, -0.58), (0.10, -0.58), (0.125, -0.555), (0.13, -0.40), (0.13, -0.12), (0.142, -0.105),
                (0.15, -0.09), (0.15, 0.12), (0.142, 0.135), (0.135, 0.15), (0.135, 0.46), (0.128, 0.50),
                (0.115, 0.55), (0.105, 0.6)]
        mats = ['MAT_HULL_METAL', 'MAT_HULL_METAL', 'MAT_HULL_PAINT', 'MAT_HULL_PAINT', 'MAT_HULL_METAL',
                'MAT_DARK_COMPOSITE', 'MAT_DARK_COMPOSITE', 'MAT_HULL_METAL', 'MAT_HULL_METAL', 'MAT_HULL_PAINT',
                'MAT_HULL_PAINT', 'MAT_DARK_COMPOSITE', 'MAT_DARK_COMPOSITE']
        mb.lathe(prof, Mx, mats, seg=18)
        # seeker shroud: thin conical collar around the dome, open at the front
        mb.lathe([(0.105, 0.6), (0.112, 0.6), (0.108, 0.665), (0.098, 0.665), (0.096, 0.61)], Mx, 'MAT_DARK_COMPOSITE',
                 seg=20)
        mb.sphere(0.085, frame(V((0, 0.6, 0)), z=(0, 1, 0)), 'MAT_GLASS', seg=20, rings=6, z0=0.0, z1=1.0)
        mb.torus(0.088, 0.006, frame(V((0, 0.605, 0)), z=(0, 1, 0)), 'MAT_HULL_METAL', seg=20, rseg=3)
        # gold MLI band on the motor case, avionics access panels, umbilical, canister rails
        f = mb.lathe([(0.1315, -0.36), (0.1315, -0.30), (0.1315, -0.24), (0.1315, -0.18)], Mx, 'MAT_MLI_GOLD', seg=20)
        mb.wrinkle(f, 0.0015, 0.03, seed=2.0)
        for k in range(3):
            a = math.radians(30 + 120 * k)
            n = V((math.cos(a), 0, math.sin(a)))
            Mp = frame(n * 0.135 + V((0, 0.3, 0)), z=n, y=(0, 1, 0))
            mb.box((0.07, 0.16, 0.004), Mp @ T(0, 0, 0.002), 'MAT_HULL_METAL', bevel=0.0015, seg=1)
            for y in (-0.07, 0.07):
                mb.cyl(0.003, 0.002, Mp @ T(0.028, y, 0.004), 'MAT_HULL_METAL', seg=5)
        kit.connector(mb, frame(V((0.0, 0.25, -0.136)), z=(0, 0, -1)), 0.012, 0.02)
        # gimballed IR seeker head behind the sapphire dome (so the dome never reads as an empty tube)
        Ms = frame(V((0, 0.615, 0)), z=(0.12, 1, 0.08))
        mb.cyl(0.048, 0.03, Ms, 'MAT_DARK_COMPOSITE', seg=10)
        mb.cyl(0.036, 0.004, Ms @ T(0, 0, 0.017), 'MAT_PANEL_BLACK', seg=10)
        mb.cyl(0.012, 0.012, Ms @ T(0, 0, 0.022), 'MAT_HULL_METAL', seg=6)
    # divert thrusters (+X, -X, +Z, -Z) on the divert ring
    hp = []
    for i, d in enumerate((V((1, 0, 0)), V((-1, 0, 0)), V((0, 0, 1)), V((0, 0, -1)))):
        base = V((0, 0.02, 0)) + d * 0.148
        Mn = frame(base, z=d, y=(0, 1, 0))
        mb.cyl(0.03, 0.02, Mn @ T(0, 0, 0.0), 'MAT_HULL_METAL', seg=10)
        ex = kit.nozzle(mb, Mn @ T(0, 0, 0.008), 0.012, 0.03, 0.05, "MAT_ENGINE_BELL", seg=8, wall=0.002)
        hp.append(ex)
    # attitude jets: pairs at the aft end (pitch / yaw / roll)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        n = V((math.cos(a), 0, math.sin(a)))
        t = V((-math.sin(a), 0, math.cos(a)))
        base = n * 0.13 + V((0, -0.46, 0))
        mb.box((0.03, 0.03, 0.02), frame(base, z=n), 'MAT_DARK_COMPOSITE')
        for s in ((-1, 1)[k % 2],):
            kit.nozzle(mb, frame(base + n * 0.008 + t * s * 0.01, z=t * s), 0.003, 0.008, 0.014, "MAT_ENGINE_BELL",
                       seg=5, wall=0.001)
    # boost motor nozzle
    with mb.region('body'):
        mb.lathe([(0.05, -0.58), (0.045, -0.6), (0.06, -0.64), (0.088, -0.70), (0.084, -0.70), (0.056, -0.645),
                  (0.04, -0.6), (0.0, -0.6)], Mx, 'MAT_ENGINE_BELL', seg=20)
    lo, hi = mb.regions['body']
    mb.to_object('KKV_BODY', parent=root)
    for i, Mx_ in enumerate(hp):
        core.empty(f'HP_DIVERT_{i}', Mx_, root, 'SINGLE_ARROW', 0.1)
    core.empty('HP_KKV_MOTOR', T(0, -0.70, 0), root, 'SINGLE_ARROW', 0.15)
    core.hit_box('body', lo, hi, root)
    return {'root': root, 'masks': dict(ao_dist=0.2, crevice=0.008, samples=20),
            'preview': dict(view_dir=(1.0, 0.6, 0.55), sun_dir=(-0.4, 0.8, 0.9), fov=26, margin=1.08)}
