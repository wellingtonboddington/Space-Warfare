"""Gunship (gunship.glb): ~26 m armed strike platform. Different silhouette from the Interceptor, same
engineering language (bolted panels, trusses, welded tanks, regen bells, MLI, radiators).

Layout (root frame, +Y forward): nose AESA disc y~12.9 | faceted crew module y 9.6..12.6 | 8-tube KKV bay +
dorsal PD turret y 6.6..9.4 | central tank (r 2.0) y -0.2..6.2 on the spine truss | layered shadow shield
y ~-3.0, fission reactor with control drums y -3.4..-5.2 | radiator wings y -4.3..-8.8 | twin regen engines,
throats y -10.4, exits y -12.8 (HP_ENGINE_0/1, exhaust along -Y). Painted parts use MAT_HULL_PAINT so the
runtime faction tint applies.
"""
import math
import random
from mathutils import Vector, Matrix
from lib import core, geo, kit
from lib.core import T, R, frame

V = Vector
AX = frame((0, 0, 0), z=(0, 1, 0), y=(0, 0, 1))          # lathe axis = +Y


def build_cabin(mb, rng):
    with mb.region('cabin'):
        # octagonal pressure module with chamfered ends (bevelled hard edges), panel grooves
        prof = [(0.0, 9.55), (1.05, 9.55), (1.45, 9.8), (1.5, 10.0), (1.5, 11.9), (1.4, 12.25), (1.05, 12.6),
                (0.0, 12.6)]
        f = mb.lathe(prof, AX, 'MAT_HULL_PAINT', seg=8, phase=math.pi / 8)
        f = mb.bevel(f, 0.03, 2, 30)
        # windscreen band: dark glass insets on the upper front facets
        for k in (1, 2, 3):
            a = math.pi / 8 + math.tau * k / 8 - math.tau / 16
            a = math.radians(45 + 45 * (k - 1))
            n = V((math.cos(a), 0, math.sin(a)))
            Mw = frame(V((0, 11.95, 0)) + n * 1.395, z=n, y=(0, 1, 0))
            mb.box((0.62, 0.34, 0.03), Mw, 'MAT_GLASS')
            mb.box((0.7, 0.42, 0.02), Mw @ T(0, 0, -0.012), 'MAT_HULL_METAL', bevel=0.006, seg=1)
        # access panels, hatch, handrails on the flats
        for k in range(8):
            a = math.tau * k / 8 + math.pi / 8 - math.pi / 8
            n = V((math.cos(a), 0, math.sin(a)))
            if k in (1, 2, 3):
                continue
            M = frame(V((0, 10.75, 0)) + n * 1.39, z=n, y=(0, 1, 0))
            kit.access_panel(mb, M, 0.7, 1.1, 0.014, pitch=0.3, handle=(k == 6))
            kit.handrail(mb, M @ T(0, 0.75, 0.0), 0.9, 0.08)
        kit.umbilical_port(mb, frame(V((-1.39, 10.2, -0.3)), z=(-1, 0, 0), y=(0, 0, 1)), 0.32, 0.22, rng=rng)
        for sx in (-1, 1):
            kit.light_beacon(mb, frame(V((sx * 1.45, 12.0, 0.0)), z=(sx, 0.3, 0)), 0.03)
        kit.whip_antenna(mb, frame(V((0.5, 10.3, 1.37)), z=(0.3, 0, 1)), 1.0)
        kit.star_tracker(mb, frame(V((-0.6, 10.0, 1.33)), z=(-0.4, -0.2, 1)), 0.05, 0.2)
    with mb.region('radar'):
        Mr = frame(V((0, 12.62, 0)), z=(0, 1, 0), y=(0, 0, 1))
        mb.cyl(1.0, 0.16, Mr @ T(0, 0, 0.08), 'MAT_HULL_METAL', seg=24, bevel=0.03, bseg=2)
        mb.cyl(0.92, 0.04, Mr @ T(0, 0, 0.18), 'MAT_DARK_COMPOSITE', seg=24)
        for i in range(-4, 5):
            for j in range(-4, 5):
                if i * i + j * j > 18:
                    continue
                mb.box((0.17, 0.17, 0.012), Mr @ T(i * 0.19, j * 0.19, 0.205), 'MAT_PANEL_BLACK')
        kit.bolt_circle(mb, Mr @ T(0, 0, 0.16), 0.96, 16, 0.012, 0.008)


def build_bay(st, root, rng):
    """8-tube KKV bay under a deck forward of the tank; KKV_<i> canisters are separate objects."""
    boxes = []
    with st.region('kkv_bay'):
        st.box((1.8, 3.0, 0.08), T(0, 8.0, -0.18), 'MAT_HULL_PAINT', bevel=0.02, seg=2)            # deck
        for sx in (-1, 1):
            st.box((0.08, 3.0, 1.1), T(sx * 0.92, 8.0, -0.72), 'MAT_HULL_PAINT', bevel=0.015, seg=1)  # cheeks
            for y in (6.9, 8.0, 9.1):
                kit.bolt_row(st, frame(V((sx * 0.965, y, -0.72)), z=(sx, 0, 0)), (0, -0.35, -0.35), (0, -0.35, 0.35),
                             4, 0.01, 0.007)
        for y in (6.75, 8.0, 9.25):
            st.box((1.84, 0.08, 1.12), T(0, y, -0.72), 'MAT_HULL_METAL', bevel=0.01, seg=1)              # frames
        st.box((1.8, 3.0, 0.05), T(0, 8.0, -1.28), 'MAT_HULL_METAL', bevel=0.01, seg=1)
    i = 0
    hps = []
    for z in (-0.47, -0.97):
        for x in (-0.6, -0.2, 0.2, 0.6):
            mouth = V((x, 9.45, z))
            ax = V((x * 0.02, 1, 0.01)).normalized()
            mb = geo.MeshBuilder(f'KKV_{i}')
            cen = mouth - ax * 0.78
            M = frame(cen, z=ax, y=(0, 0, 1))
            h = 0.78
            mb.lathe([(0.0, -h - 0.04), (0.12, -h - 0.04), (0.17, -h), (0.17, h - 0.05), (0.18, h - 0.03), (0.18, h),
                      (0.15, h + 0.005), (0.0, h + 0.02)], M,
                     ['MAT_HULL_METAL', 'MAT_HULL_METAL', 'MAT_HULL_PAINT', 'MAT_HULL_METAL', 'MAT_HULL_METAL',
                      'MAT_DARK_COMPOSITE', 'MAT_DARK_COMPOSITE'], seg=12)
            mb.torus(0.172, 0.012, M @ T(0, 0, 0.2), 'MAT_HULL_METAL', seg=12, rseg=3)
            ob = mb.to_object(f'KKV_{i}', parent=root, origin=T(cen))
            boxes.append(core.world_bounds([ob]))
            hps.append((f'HP_KKV_{i}', frame(mouth + ax * 0.03, z=ax, y=(0, 0, 1))))
            i += 1
    lo, hi = st.regions['kkv_bay']
    for b in boxes:
        lo = V((min(lo.x, b[0].x), min(lo.y, b[0].y), min(lo.z, b[0].z)))
        hi = V((max(hi.x, b[1].x), max(hi.y, b[1].y), max(hi.z, b[1].z)))
    return hps, (lo, hi)


def build_tank(mb, rng):
    with mb.region('tank_main'):
        kit.tank_cyl(mb, T(0, 3.0, 0) @ R('X', -90), 2.0, 6.4, 'MAT_HULL_PAINT', seg=32, dome=0.55, welds=3,
                     stringers=16, rng=rng)
        # gold MLI patches over the forward dome sensors, feed manifolds to the aft
        f = kit.mli_box(mb, frame(V((0, 3.0, 2.0)), z=(0, 0, 1), y=(0, 1, 0)), (0.9, 1.8, 0.12), 'MAT_MLI_GOLD',
                        amp=0.01, scale=0.15, seed=3.0, cuts=2)
        for sx in (-1, 1):
            kit.handrail(mb, frame(V((sx * 2.01, 3.0, 0.6)), z=(sx, 0, 0.3), y=(0, 0, 1)) @ R('Z', 90), 3.0, 0.1)
            kit.vent(mb, frame(V((sx * 1.4, 0.4, 1.3)), z=(sx, -0.3, 1)), 0.035)
    for sx in (-1, 1):
        kit.pipe_run(mb, [V((sx * 0.9, -0.35, -1.0)), V((sx * 1.0, -1.5, -0.9)), V((sx * 1.1, -6.0, -0.9)),
                          V((sx * 1.2, -9.4, -0.5)), V((sx * 1.2, -9.8, -0.2))], 0.07, 'MAT_HULL_METAL',
                     clamp_every=1.2, surface_dir=(0, 0, 1))


def build_spine(mb):
    kit.truss(mb, (0, 9.55, 0), (0, 6.3, 0), 0.9, 3, 0.05, 0.025)
    kit.truss(mb, (0, -0.25, 0), (0, -2.8, 0), 0.9, 3, 0.05, 0.025)
    for sx in (-1, 1):
        for sz in (-1, 1):
            kit.strut(mb, V((sx * 0.45, -3.2, sz * 0.45)), V((sx * 1.0, -9.5, sz * 0.6)), 0.05, 'MAT_HULL_METAL', seg=8,
                      ends=0.12)
    kit.truss(mb, (0, -9.4, 0), (0, -10.1, 0), 2.6, 1, 0.06, 0.03)


def build_reactor(mb, rng):
    with mb.region('reactor'):
        # layered shadow shield (tungsten / lithium-hydride stack) facing the crew
        Ms = frame(V((0, -3.0, 0)), z=(0, -1, 0), y=(0, 0, 1))
        mb.lathe([(0.0, -0.2), (1.25, -0.2), (1.3, -0.15), (1.3, -0.08), (1.18, -0.06), (1.18, 0.06), (1.05, 0.08),
                  (1.05, 0.2), (0.0, 0.2)], Ms, ['MAT_HULL_METAL', 'MAT_HULL_METAL', 'MAT_DARK_COMPOSITE',
                                                 'MAT_HULL_METAL', 'MAT_DARK_COMPOSITE', 'MAT_HULL_METAL',
                                                 'MAT_DARK_COMPOSITE', 'MAT_HULL_METAL'], seg=32)
        kit.bolt_circle(mb, Ms @ T(0, 0, -0.2), 1.15, 20, 0.02, 0.015, z=0.0)
        # reactor vessel with control drums and coolant loops
        Mv = frame(V((0, -4.2, 0)), z=(0, 1, 0), y=(0, 0, 1))
        mb.lathe([(0.0, -0.9), (0.4, -0.9), (0.55, -0.75), (0.55, 0.65), (0.45, 0.8), (0.0, 0.8)], Mv,
                 'MAT_HULL_METAL', seg=24)
        for k in range(8):
            a = math.tau * k / 8
            p = V((math.cos(a) * 0.68, -4.25, math.sin(a) * 0.68))
            mb.cyl(0.12, 1.3, frame(p, z=(0, 1, 0)), 'MAT_DARK_COMPOSITE', seg=10, bevel=0.015, bseg=1)
            mb.cyl(0.05, 0.12, frame(p + V((0, 0.7, 0)), z=(0, 1, 0)), 'MAT_HULL_METAL', seg=8)
        for z in (-0.5, 0.5):
            mb.torus(0.82, 0.04, frame(V((0, -4.25 + z, 0)), z=(0, 1, 0)), 'MAT_HULL_METAL', seg=24, rseg=4)
        for sx in (-1, 1):
            mb.curve_pipe([V((sx * 0.5, -3.6, 0.3)), V((sx * 0.9, -3.8, 0.6)), V((sx * 1.3, -4.6, 0.2)),
                           V((sx * 1.45, -5.5, 0.0))], 0.06, 'MAT_HULL_METAL', res_u=4)
        kit.light_beacon(mb, frame(V((0, -3.3, 1.3)), z=(0, 0, 1)), 0.035, lens_mat='MAT_LIGHT')


def build_engines(root, mb, rng):
    hps = []
    regions = {}
    for i, sx in enumerate((-1, 1)):
        x = sx * 1.2
        eb = geo.MeshBuilder(f'ENGINE_BELL_{i}')
        with eb.region(f'engine_{i}'):
            Mt = frame(V((x, -10.4, 0)), z=(0, 1, 0), y=(0, 0, 1))
            kit.regen_bell(eb, Mt, 0.12, 0.65, 2.4, tubes=40, chamber_r=0.2, chamber_len=0.45)
        regions.update(eb.regions)
        eb.to_object(f'ENGINE_BELL_{i}', parent=root)
        with mb.region(f'engine_{i}'):
            mb.box((0.7, 0.3, 0.7), T(x, -9.75, 0), 'MAT_HULL_METAL', bevel=0.03, seg=2)
            # turbopump + gimbal actuators
            mb.cyl(0.16, 0.5, frame(V((x - sx * 0.45, -9.9, 0.35)), z=(0, 1, 0)), 'MAT_HULL_METAL', seg=14,
                   bevel=0.02, bseg=1)
            mb.curve_pipe([V((x - sx * 0.45, -10.15, 0.35)), V((x - sx * 0.3, -10.3, 0.3)), V((x, -10.15, 0.22))],
                          0.05, 'MAT_HULL_METAL', res_u=4)
            for d in (V((0, 0, 1)), V((sx, 0, 0))):
                kit.strut(mb, V((x, -9.7, 0)) + d * 0.45, V((x, -10.0, 0)) + d * 0.2, 0.035, seg=8, ends=0.06)
        hps.append((f'HP_ENGINE_{i}', T(x, -12.8, 0)))
    return hps, regions


def build_radiators(mb, rng):
    for side, comp in ((-1, 'radiator_l'), (1, 'radiator_r')):
        with mb.region(comp):
            M = T(side * 1.45, -6.55, 0) @ (R('Z', 180) if side < 0 else Matrix.Identity(4))
            kit.radiator_panel(mb, M, 7.0, 4.5, 0.035, tubes=16)
        mb.box((0.3, 4.6, 0.25), T(side * 1.35, -6.55, 0), 'MAT_HULL_METAL', bevel=0.03, seg=2)
        for y in (-4.6, -8.5):
            kit.strut(mb, V((side * 1.3, y, 0)), V((side * 0.75, -5.3 if y > -6 else -8.0, 0.3)), 0.04, seg=8)
        kit.pipe_run(mb, [V((side * 1.45, -5.4, 0.15)), V((side * 1.2, -5.2, 0.3)), V((side * 0.7, -4.7, 0.25))], 0.05,
                     'MAT_HULL_METAL', clamp_every=0)


def build():
    rng = random.Random(8101)
    root = core.empty('GUNSHIP', size=2.0)
    mb = geo.MeshBuilder('GUNSHIP_BODY')
    build_cabin(mb, rng)
    hps, bay_box = build_bay(mb, root, rng)
    build_tank(mb, rng)
    build_spine(mb)
    build_reactor(mb, rng)
    build_radiators(mb, rng)
    eng_hps, eng_regions = build_engines(root, mb, rng)
    # RCS quads: cabin sides and aft frame
    for nm, p, n in (('a', V((-1.5, 10.0, 0.0)), V((-1, 0, 0))), ('b', V((1.5, 10.0, 0.0)), V((1, 0, 0))),
                     ('c', V((0, -9.6, 1.35)), V((0, 0, 1))), ('d', V((0, -9.6, -1.35)), V((0, 0, -1)))):
        kit.rcs_quad(mb, frame(p, z=n, y=(0, 1, 0)), 0.22)
    # dorsal PD turret on a pedestal over the bay
    az, el, hp, pd_box = kit.gimbal_turret('PD_0_AZ', 'PD_0_EL', 'HP_PD_0', V((0, 8.0, 0.55)), -0.14, 0.2, root, mb,
                                           ventral=False, director_len=0.9)
    regions = geo.regions_union(mb)
    regions.update(eng_regions)
    for k, v in eng_regions.items():
        if k in mb.regions:
            a, b = mb.regions[k]
            regions[k] = (V((min(a.x, v[0].x), min(a.y, v[0].y), min(a.z, v[0].z))),
                          V((max(b.x, v[1].x), max(b.y, v[1].y), max(b.z, v[1].z))))
    mb.to_object('GUNSHIP_BODY', parent=root)
    for name, M in hps + eng_hps:
        core.empty(name, M, root, 'SINGLE_ARROW', 0.4)
    regions['kkv_bay'] = bay_box
    regions['pd_0'] = pd_box
    for comp in ('cabin', 'reactor', 'tank_main', 'engine_0', 'engine_1', 'kkv_bay', 'pd_0', 'radiator_l',
                 'radiator_r', 'radar'):
        lo, hi = regions[comp]
        core.hit_box(comp, lo, hi, root)
    return {'root': root, 'masks': dict(ao_dist=2.0, crevice=0.06, samples=20),
            'preview': dict(view_dir=(1.0, 0.75, 0.6), sun_dir=(-0.5, 0.7, 0.9), fov=28, margin=1.02)}
