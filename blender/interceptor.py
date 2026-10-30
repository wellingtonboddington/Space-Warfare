"""Interceptor: shared chassis (chassis.glb) + three variant kits authored in the chassis frame.

Layout (Blender root frame, metres, +Y forward):
  capsule        y  3.75 .. 6.15   faceted canopy cab (carved from the cockpit window planes) on a wide
                                   lower pressure body + chin nose with the fixed radar array
  avionics ring  y  2.75 .. 3.75   16-gon equipment ring: bays, star trackers, comms dish, fore RCS quads
  keel truss     y  2.75 .. -4.0   0.7 m box truss carrying everything aft
  prop tanks     y ~0.75           two spheres side by side (fuel port, oxidiser starboard)
  powerplant     belly y ~1.95     fuel-cell stacks, battery modules, reactant dewars
  heat sink      dorsal y ~-1.4    MLI-wrapped water tank;  coolant pump bay ventral
  radiators      y -0.8 .. -3.4    two hinged panels, hinge lines at x = +-0.55
  thrust struct  y -4.0 .. -4.55   strut cone, gimbal, actuators, gold MLI skirt
  engine         throat y -4.95, exit y -6.80 (regen-cooled bell, 1.24 m exit)
"""
import json
import math
import os
import random
from mathutils import Vector, Matrix
from lib import core, geo, kit, mats
from lib.core import T, R, S, frame

V = Vector
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
with open(os.path.join(ROOT, 'js', 'data', 'cockpit_layout.json')) as _f:
    LAYOUT = json.load(_f)

EYE = V((0.0, 4.65, 0.35))         # COCKPIT_ANCHOR (design eye point)
SKIN = 0.06                         # outer skin offset from the cockpit window planes
HINGE_X = 0.55
RAD_Y = -2.1
RAD_SPAN = 4.9
RAD_CHORD = 2.6
THROAT_Y = -4.95
BELL_LEN = 1.85
EXIT_R = 0.62
TANK_R = 0.74
TANK_X = 1.15
TANK_Y = 0.75


def E(x, y, z):
    """Eye-relative -> root frame."""
    return EYE + V((x, y, z))


# ============================================================================================ capsule
def window_geometry():
    out = []
    for w in LAYOUT['windows']:
        P = [V(c) for c in w['corners']]
        n = V((0, 0, 0))
        for i in range(len(P)):
            a, b = P[i], P[(i + 1) % len(P)]
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        n.normalize()
        c = sum(P, V()) / len(P)
        if n.dot(c) < 0:
            n = -n
        # project corners onto the best-fit plane
        P = [p - n * (p - c).dot(n) for p in P]
        out.append((w['id'], P, c, n))
    return out


def lower_body_rings():
    # y_rel, half width, top z, bottom z, top chamfer, bottom chamfer   (eye-relative)
    st = [(-0.90, 1.05, -0.03, -1.30, 0.34, 0.46),
          (-0.45, 1.12, -0.05, -1.34, 0.34, 0.48),
          (0.10, 1.12, -0.06, -1.33, 0.34, 0.48),
          (0.55, 1.04, -0.09, -1.29, 0.32, 0.45),
          (0.95, 0.86, -0.13, -1.20, 0.29, 0.40),
          (1.30, 0.62, -0.20, -1.04, 0.21, 0.28),
          (1.50, 0.50, -0.26, -0.90, 0.14, 0.20)]
    rings = []
    for y, hw, zt, zb, ct, cb in st:
        k = 0.29      # two-step rounded corners (45 deg each)
        pts = [(-hw + ct, zt), (-hw + ct * k, zt - ct * k), (-hw, zt - ct), (-hw, zb + cb), (-hw + cb * k, zb + cb * k),
               (-hw + cb, zb), (hw - cb, zb), (hw - cb * k, zb + cb * k), (hw, zb + cb), (hw, zt - ct),
               (hw - ct * k, zt - ct * k), (hw - ct, zt)]
        rings.append([E(x, y, z) for x, z in pts])
    return st, rings


def shell_planes(wins, offset):
    """Half-spaces of the faceted canopy cab, eye-relative. offset = distance outboard of the window planes
    (the chassis CAPSULE uses SKIN; the cockpit pressure shell uses a small negative offset so the two nest)."""
    planes = []
    for wid, P, c, n in wins:
        planes.append((c + n * offset, n))
    o = offset - SKIN
    for p, n in [
        (V((0, 0, 0.57)), V((0, -0.06, 1))),                           # roof
        (V((-0.6, 0, 0.8)) * 0.84, V((-0.6, 0, 0.8))),                 # upper chamfers
        (V((0.6, 0, 0.8)) * 0.84, V((0.6, 0, 0.8))),
        (V((0, -0.55, 0.62)), V((0, -0.5, 0.866))),                    # aft roof slope
        (V((-0.5, -0.6, 0.5)), V((-0.45, -0.45, 0.77))),               # aft corner facets
        (V((0.5, -0.6, 0.5)), V((0.45, -0.45, 0.77))),
        (V((0, -0.88, 0)), V((0, -1, 0))),                             # aft bulkhead
    ]:
        n = n.normalized()
        planes.append((p + n * o, n))
    return planes


def cab_planes(wins):
    planes = shell_planes(wins, SKIN) + [(V((0, 0, -0.40)), V((0, 0, -1)))]   # buried in the lower body
    return [(EYE + p, n) for p, n in planes]


def check_windows(wins, planes, margin=0.0):
    bad = []
    for wid, P, c, n in wins:
        for p in P:
            q = EYE + p + n * SKIN
            for (pp, nn) in planes:
                if (nn - n).length < 1e-6:
                    continue
                if (q - pp).dot(nn) > -margin:
                    bad.append((wid, tuple(round(x, 3) for x in p), tuple(round(x, 2) for x in nn)))
    return bad


def decal(mb_parent, role, cell, center, normal, up, size, proud=0.004, mirror=False, project=None, n=4):
    """DECAL_<role>: thin subdivided plane proud of the hull, UVs into the 4x4 decal atlas cell
    (three.js UV convention, v up, row 0 at the top). `project(p)` snaps grid points onto a curved hull."""
    col, row = cell
    mb = geo.MeshBuilder('DECAL_' + role)
    Z = V(normal).normalized()
    Y = (V(up) - Z * V(up).dot(Z)).normalized()
    X = Y.cross(Z)
    if mirror:
        X = -X
    c = V(center)
    w = h = size
    grid = []
    for j in range(n + 1):
        rowp = []
        for i in range(n + 1):
            s, t = i / n, j / n
            p = c + X * ((s - 0.5) * w) + Y * ((t - 0.5) * h)
            if project:
                p = project(p)
            p = p + Z * proud
            u = (col + s) / 4.0
            v3 = 1.0 - (row + 1) / 4.0 + t / 4.0         # three.js UV (v up)
            rowp.append((p, (u, 1.0 - v3)))              # Blender UV (glTF exporter flips v)
        grid.append(rowp)
    for j in range(n):
        for i in range(n):
            a, b, cc, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            if mirror:
                mb.quad([a[0], d[0], cc[0], b[0]], 'MAT_DECALS', uvs=[a[1], d[1], cc[1], b[1]])
            else:
                mb.quad([a[0], b[0], cc[0], d[0]], 'MAT_DECALS', uvs=[a[1], b[1], cc[1], d[1]])
    return mb.to_object(parent=mb_parent, sharp_angle=None, weighted=False)


DECAL_CELLS = {'HULLNUM_L': (0, 0), 'HULLNUM_R': (1, 0), 'INSIGNIA_L': (2, 0), 'INSIGNIA_R': (3, 0),
               'NAME_L': (0, 1), 'NAME_R': (1, 1), 'STENCIL_0': (2, 1), 'STENCIL_1': (3, 1), 'STENCIL_2': (0, 2),
               'STENCIL_3': (1, 2), 'STENCIL_4': (2, 2), 'STENCIL_5': (3, 2)}


def build_capsule(root, rng):
    wins = window_geometry()
    planes = cab_planes(wins)
    bad = check_windows(wins, planes)
    if bad:
        print('WARNING window/facet clearance:', bad[:6])
    st, rings = lower_body_rings()

    # --- hull solid: lower body loft (with extra stations for panel breaks) + faceted cab, boolean union
    hull = geo.MeshBuilder('CAPSULE')
    with hull.region('cabin'):
        lf = hull.loft(rings, None, 'MAT_HULL_PAINT')
    # recessed panel lines along every station and corner (V-grooves from an individual inset)
    import bmesh as _bm
    _bm.ops.recalc_face_normals(hull.bm, faces=hull.bm.faces)
    sides = [f for f in lf if f.is_valid and len(f.verts) == 4]
    _bm.ops.inset_individual(hull.bm, faces=sides, thickness=0.009, depth=-0.006, use_even_offset=True)
    hull_ob = hull.to_object('CAPSULE', parent=root, bevel_mod=(0.012, 1, 40), sharp_angle=30)
    cab = geo.MeshBuilder('CAPSULE_CAB')
    with cab.region('cabin'):
        cab.convex(planes, center=EYE + V((0, 0, 0)), size=4.0, mat='MAT_HULL_PAINT')
    cab_regions = dict(cab.regions)
    cab_ob = cab.to_object('_cab', weighted=False)
    geo.boolean(hull_ob, cab_ob, 'UNION')

    # --- window recesses: cutter prisms (reveal = metal, floor = dark interior) + glass panes
    det = geo.MeshBuilder('CAPSULE_DETAIL')
    for wid, P, c, n in wins:
        cut = geo.MeshBuilder('_win_' + wid)
        cc = sum(P, V()) / 4
        grow = [cc + (p - cc) * 1.0 + (p - cc).normalized() * 0.012 for p in P]
        inner = [EYE + p - n * 0.035 for p in grow]
        outer = [EYE + p + n * 0.35 for p in grow]
        bm = cut.bm
        vi = [bm.verts.new(p) for p in inner]
        vo = [bm.verts.new(p) for p in outer]
        fl = [bm.faces.new(list(reversed(vi))), bm.faces.new(vo)]
        sides = [bm.faces.new([vi[i], vi[(i + 1) % 4], vo[(i + 1) % 4], vo[i]]) for i in range(4)]
        import bmesh as _bm
        _bm.ops.recalc_face_normals(bm, faces=bm.faces)
        fl[0].material_index = cut.midx('MAT_PANEL_BLACK')
        fl[1].material_index = cut.midx('MAT_PANEL_BLACK')
        for f in sides:
            f.material_index = cut.midx('MAT_HULL_METAL')
        cob = cut.to_object('_cut_' + wid, weighted=False, sharp_angle=None)
        geo.boolean(hull_ob, cob, 'DIFFERENCE')
        # exterior glass pane at the cockpit window plane + a thin frame ring around the aperture
        det.quad([EYE + p + n * 0.004 for p in P], 'MAT_GLASS')
        for i in range(4):
            a, b = EYE + grow[i] + n * 0.01, EYE + grow[(i + 1) % 4] + n * 0.01
            mid = (a + b) / 2
            d = (b - a)
            outward = (mid - (EYE + cc)).normalized()
            det.box((d.length + 0.03, 0.03, 0.02), frame(mid + outward * 0.012 + n * SKIN * 0.6, z=n, x=d),
                    'MAT_HULL_METAL')

    # --- details on the capsule: hatch, handrails, vents, umbilical, antennas, lights, seams
    side_y = [s[0] for s in st]

    def side_x(y_rel, sgn):
        for i in range(len(st) - 1):
            if st[i][0] <= y_rel <= st[i + 1][0]:
                t = (y_rel - st[i][0]) / (st[i + 1][0] - st[i][0])
                return sgn * (st[i][1] + (st[i + 1][1] - st[i][1]) * t)
        return sgn * st[0][1]

    # port side crew hatch: framed plug door with handle, hinges, external release, handrails
    hx = side_x(-0.25, -1)
    Mh = frame(E(hx - 0.002, -0.25, -0.70), z=(-1, 0, 0), y=(0, 0, 1))
    with det.region('cabin'):
        det.box((0.78, 0.62, 0.025), Mh @ T(0, 0, 0.0125), 'MAT_HULL_METAL', bevel=0.008, seg=2)
        det.box((0.66, 0.50, 0.03), Mh @ T(0, 0, 0.035), 'MAT_HULL_PAINT', bevel=0.01, seg=2)
        kit.bolt_rect(det, Mh, 0.74, 0.58, 0.07, 0.02, 0.006, 0.004, z=0.025)
        det.sweep([(-0.12, -0.15, 0.05), (-0.12, -0.15, 0.09), (0.12, -0.15, 0.09), (0.12, -0.15, 0.05)], 0.012,
                  Mh, 'MAT_PAINT_YELLOW', seg=8)
        kit.hinge(det, Mh @ T(0, 0.3, 0.04) @ R('Z', 90), 0.5, 0.018, 3)
        det.box((0.09, 0.09, 0.02), Mh @ T(0.22, 0.12, 0.06), 'MAT_PAINT_RED', bevel=0.004, seg=1)
        kit.handrail(det, Mh @ T(0, 0.38, 0.0), 0.7, 0.07)
        kit.handrail(det, Mh @ T(-0.48, 0.0, 0.0) @ R('Z', 90), 0.45, 0.07)
        kit.handrail(det, Mh @ T(0.48, -0.05, 0.0) @ R('Z', 90), 0.45, 0.07)
        # starboard: O2 vent, umbilical port, handrails
        sx = side_x(-0.45, 1)
        Mv = frame(E(sx + 0.002, -0.45, -0.50), z=(1, 0, 0.15), y=(0, 0, 1))
        vent_o2 = kit.vent(det, Mv, 0.028)
        sx2 = side_x(0.25, 1)
        kit.umbilical_port(det, frame(E(sx2 + 0.002, 0.25, -0.95), z=(1, 0, 0), y=(0, 0, 1)), 0.3, 0.2)
        kit.handrail(det, frame(E(sx + 0.002, -0.05, -0.30), z=(1, 0, 0), y=(0, 0, 1)), 0.8, 0.07)
        kit.handrail(det, frame(E(side_x(0.45, -1) - 0.002, 0.45, -0.32), z=(-1, 0, 0), y=(0, 0, 1)), 0.6, 0.07)
        # roof: handrails and a beacon each side of the top window, aft blister
        for sgn in (-1, 1):
            kit.handrail(det, frame(E(sgn * 0.33, -0.25, 0.57 + 0.0), z=(sgn * 0.0, -0.06, 1), y=(0, 1, 0))
                         @ R('Z', 90), 0.8, 0.07)
            kit.light_beacon(det, frame(E(sgn * 0.58, -0.75, 0.385), z=(sgn * 0.6, 0, 0.8)), 0.025,
                             lens_mat='MAT_LIGHT')
        with det.no_region():
            kit.whip_antenna(det, frame(E(0.18, -0.70, 0.565), z=(0, -0.06, 1)), 0.55)
        with det.no_region():
            kit.patch_antenna(det, frame(E(-0.18, -0.62, 0.567), z=(0, -0.06, 1)), 0.14)
        # chin/belly: access panels, drain port, tie-downs
        for i, yy in enumerate((-0.45, 0.4)):
            kit.access_panel(det, frame(E(0.0, yy, -1.30 - 0.04 * (1 if yy < 0.6 else 0) - 0.002 - 0.0), z=(0, 0, -1),
                                        y=(0, 1, 0)), 0.5, 0.36, 0.012, pitch=0.08)
        for sgn in (-1, 1):
            for yy in (0.35,):
                kit.access_panel(det, frame(E(side_x(yy, sgn) + sgn * 0.002, yy, -0.92), z=(sgn, 0, 0),
                                            y=(0, 0, 1)), 0.34, 0.26, 0.01, pitch=0.07, handle=(yy > 0))
            kit.tie_down(det, frame(E(side_x(0.85, sgn) + sgn * 0.003, 0.85, -0.75), z=(sgn, 0.35, 0)))
    regions = geo.regions_union(hull, det)
    for k, v in cab_regions.items():
        lo, hi = regions.get(k, v)
        regions[k] = (V((min(lo.x, v[0].x), min(lo.y, v[0].y), min(lo.z, v[0].z))),
                      V((max(hi.x, v[1].x), max(hi.y, v[1].y), max(hi.z, v[1].z))))
    hull_det = det.to_object('_capsule_detail', parent=root)
    return hull_ob, hull_det, wins, vent_o2, side_x, regions


# ============================================================================================ body
def build_ring(mb, rng):
    """Equipment / avionics ring y 2.75..3.75, 16-gon radius 1.0."""
    Mr = frame((0, 0, 0), z=(0, 1, 0), y=(0, 0, 1))
    seg = 16
    with mb.region('avionics'):
        mb.lathe([(0.68, 3.80), (0.96, 3.76), (1.0, 3.71), (1.0, 2.79), (0.97, 2.75), (0.62, 2.71)], Mr,
                 'MAT_HULL_PAINT', seg=seg, phase=math.pi / seg)
        # aft bulkhead gold MLI blanket disc with crinkle
        f = mb.lathe([(0.0, 2.70), (0.62, 2.705), (0.96, 2.72)], Mr, 'MAT_MLI_GOLD', seg=20)
        f = mb.subdivide(f, 1)
        mb.wrinkle(f, 0.008, 0.09, seed=3.0)
        # bay doors on most flats
        ap = math.tau / seg
        for k in range(seg):
            a = k * ap
            n = V((math.cos(a), 0, math.sin(a)))
            if k not in (2, 5, 11, 14):      # bay doors on four flats; side flats carry RCS / names
                continue
            p = n * (1.0 * math.cos(ap / 2)) + V((0, 3.25, 0))
            Mf = frame(p, z=n, y=(0, 1, 0))
            kit.access_panel(mb, Mf, 0.33, 0.78, 0.01, pitch=0.26, bolt_r=0.005, handle=(k % 4 == 2),
                             latch=(k % 3 == 0))
        # longitudinal stiffener bands
        for k in range(seg):
            a = (k + 0.5) * ap
            n = V((math.cos(a), 0, math.sin(a)))
            mb.box((0.045, 0.96, 0.02), frame(n * 0.99 + V((0, 3.25, 0)), z=n, y=(0, 1, 0)), 'MAT_HULL_METAL',
                   bevel=0.005, seg=1)
        # star trackers (dorsal port, two at different cants)
        for i, (a_deg, yy, cant) in enumerate(((112.5, 3.4, 25),)):
            a = math.radians(a_deg)
            n = V((math.cos(a), 0, math.sin(a)))
            Mst = frame(n * 1.0 + V((0, yy, 0)), z=n, y=(0, 1, 0)) @ R('X', cant)
            kit.star_tracker(mb, Mst, 0.05, 0.2)
        # patch / whip antennas
        with mb.no_region():
            kit.whip_antenna(mb, frame(V((0, 3.6, 0)) + V((math.cos(math.radians(78.75)), 0,
                                                             math.sin(math.radians(78.75)))) * 0.985,
                                       z=(math.cos(math.radians(78.75)), 0, math.sin(math.radians(78.75)))), 0.9)
        with mb.no_region():
            kit.patch_antenna(mb, frame(V((0, 3.0, -0.985)), z=(0, 0, -1)), 0.18)
    # comms: high gain dish on a mast, dorsal starboard
    with mb.region('comms'):
        a = math.radians(56.25)
        n = V((math.cos(a), 0, math.sin(a)))
        base = n * 0.98 + V((0, 2.98, 0))
        mb.cyl(0.07, 0.04, frame(base + n * 0.02, z=n), 'MAT_HULL_METAL', seg=12, bevel=0.008, bseg=1)
        top = V((0.6, 2.98, 1.25))
        kit.strut(mb, base + n * 0.03, top - V((0, 0, 0.05)), 0.035, 'MAT_HULL_METAL', seg=10)
        kit.gimbal_yoke(mb, frame(top - V((0, 0, 0.06)), z=(0, 0, 1)), 0.09, h=0.11)
        kit.dish(mb, frame(top + V((0, 0.0, 0.07)), z=(0.25, 0.7, 0.6)), 0.34, 0.09, 'MAT_RADIATOR')


def rcs(mb, name, M, dirs):
    frames = kit.rcs_quad(mb, M, 0.17, dirs=dirs)
    return frames


def build_keel(mb):
    with mb.region('keel'):
        kit.truss(mb, (0, 2.74, 0), (0, -4.0, 0), 0.7, 9, 0.035, 0.018)
        # longitudinal cable trays + harness along the dorsal longerons
        for sgn in (-1, 1):
            kit.cable_loom(mb, [(sgn * 0.2, 2.7, 0.40), (sgn * 0.22, 0.0, 0.41), (sgn * 0.2, -3.9, 0.40)], strands=3,
                           r=0.013, twist=0.6, mats=('MAT_CABLE_BLACK', 'MAT_CABLE_GREY', 'MAT_CABLE_BLACK', 'MAT_HULL_METAL'), clamp_every=1.3, surface_dir=(0, 0, -1), seg=4, step=0.6,
                           rng=random.Random(sgn + 5), lacing=False)


def build_tanks(mb, rng):
    for side, comp in ((-1, 'tank_fuel'), (1, 'tank_ox')):
        c = V((side * TANK_X, TANK_Y, 0.0))
        with mb.region(comp):
            kit.tank_sphere(mb, T(c) @ R('Z', 11.25), TANK_R, 'MAT_HULL_METAL', seg=24, rings=10, straps=False,
                            rng=rng)
        # mount struts from inboard girth tabs to the keel nodes (V pairs)
        for dy in (-0.55, 0.55):
            for dz in (-0.35, 0.35):
                tab = c + V((-side * TANK_R * 0.86, dy * 0.55, 0.0))
                node = V((side * 0.35, TANK_Y + dy * 1.2, dz))
                kit.strut(mb, tab, node, 0.022, 'MAT_HULL_METAL', seg=6, ends=0.05)
        # outboard support yoke to keep the tank from looking cantilevered
        for dz in (-1, 1):
            kit.strut(mb, c + V((-side * 0.2, -0.5, dz * TANK_R * 0.7)), V((side * 0.35, TANK_Y - 1.4, dz * 0.35)),
                      0.018, 'MAT_HULL_METAL', seg=8, ends=0.04)
        # feed line from the bottom pole aft along the keel to the engine
        kit.pipe_run(mb, [c + V((0, 0, -TANK_R * 1.1)), c + V((0, -0.2, -TANK_R * 1.18)),
                          V((side * 0.42, TANK_Y - 0.9, -0.42)), V((side * 0.42, -2.0, -0.42)),
                          V((side * 0.40, -3.7, -0.42)), V((side * 0.18, -4.45, -0.22))], 0.032, 'MAT_HULL_METAL',
                     clamp_every=0.9, surface_dir=(-side, 0, 0.6))
        # pressurant line + fill/drain valve at the top pole
        kit.valve(mb, T(c + V((0, 0, TANK_R * 1.18))) @ R('Z', 90), 0.05, 'lever')
        kit.pipe_run(mb, [c + V((0, 0.04, TANK_R * 1.2)), c + V((-side * 0.3, 0.2, TANK_R * 1.15)),
                          V((side * 0.38, TANK_Y + 0.4, 0.45))], 0.014, 'MAT_HULL_METAL', clamp_every=0)


def build_powerplant(mb, rng):
    with mb.region('powerplant'):
        z0 = -0.38
        mb.box((1.25, 1.15, 0.05), T(0, 1.95, z0 - 0.025), 'MAT_HULL_METAL', bevel=0.01, seg=2)
        # fuel cell stacks: plate stacks with end plates and tie rods
        for sx in (-0.3, 0.3):
            cz = z0 - 0.05 - 0.17
            mb.box((0.34, 0.62, 0.30), T(sx, 2.05, cz), 'MAT_DARK_COMPOSITE', bevel=0.01, seg=2)
            for k in range(9):
                mb.box((0.36, 0.014, 0.32), T(sx, 2.05 - 0.26 + k * 0.065, cz), 'MAT_HULL_METAL')
            for ep in (-0.33, 0.33):
                mb.box((0.40, 0.04, 0.36), T(sx, 2.05 + ep, cz), 'MAT_HULL_METAL', bevel=0.008, seg=2)
            for tx in (-0.17, 0.17):
                for tz in (-0.15, 0.15):
                    mb.cyl(0.01, 0.72, T(sx + tx, 2.05, cz + tz) @ R('X', 90), 'MAT_HULL_METAL', seg=6)
            kit.connector(mb, T(sx, 2.05 - 0.36, cz) @ R('X', 90), 0.02, 0.04)
        # battery modules (aft)
        for i, sx in enumerate((-0.42, -0.14, 0.14, 0.42)):
            kit.box_unit(mb, T(sx, 1.55, z0 - 0.05) @ R('X', 180), (0.24, 0.3, 0.2), 'MAT_DARK_COMPOSITE',
                         rng=rng, ribs=4, connectors=1, rib_mat='MAT_HULL_METAL')
        # reactant dewars (fore) in gold MLI
        for sx in (-0.38, 0.38):
            f = mb.sphere(0.17, T(sx, 2.42, z0 - 0.24), 'MAT_MLI_GOLD', seg=12, rings=6)
            mb.wrinkle(f, 0.004, 0.05, seed=sx * 10)
            mb.torus(0.172, 0.01, T(sx, 2.42, z0 - 0.24), 'MAT_HULL_METAL', seg=16, rseg=4)
            kit.strut(mb, V((sx, 2.42, z0 - 0.08)), V((sx, 2.42, z0)), 0.02)
        # harness up to the ring
        kit.cable_loom(mb, [(0.0, 1.45, z0 - 0.06), (0.05, 2.0, z0 - 0.42), (0.0, 2.6, z0 - 0.3),
                            (0.0, 2.72, -0.6)], strands=5, r=0.009, twist=1.5, mats=('MAT_CABLE_BLACK', 'MAT_CABLE_GREY', 'MAT_CABLE_BLACK', 'MAT_HULL_METAL'), clamp_every=0.35, seg=4, step=0.15,
                       rng=rng, lacing=False)


def build_heatsink(mb, rng):
    with mb.region('heatsink'):
        c = V((0, -1.4, 0.69))
        f = kit.tank_cyl(mb, T(c) @ R('X', 90), 0.33, 1.6, 'MAT_HULL_METAL', seg=20, dome=0.45, welds=1,
                         mli='MAT_MLI_SILVER', rng=rng, end_fittings=True)
        for yy in (-0.85, -1.95):
            mb.prism([(-0.3, 0.35), (0.3, 0.35), (0.22, 0.45), (-0.22, 0.45)], 0.08,
                     frame((0, yy, 0), z=(0, 1, 0), y=(0, 0, 1)) @ T(0, 0, 0), 'MAT_HULL_METAL', bevel=0.01)
            mb.torus(0.345, 0.018, T(0, yy, 0.69) @ R('X', 90), 'MAT_HULL_METAL', seg=16, rseg=3, arc=200)
        hs_vent = kit.vent(mb, frame(V((0, -1.4, 1.025)), z=(0, 0, 1)), 0.03)
        # plumbing to the pump bay
        with mb.no_region():
            kit.pipe_run(mb, [V((0.12, -2.2, 0.6)), V((0.25, -2.45, 0.45)), V((0.42, -2.5, 0.0)),
                              V((0.3, -2.0, -0.45))], 0.024, 'MAT_HULL_METAL', clamp_every=0.5, surface_dir=(1, 0, 0))
    return hs_vent


def build_pumpbay(mb, rng):
    with mb.region('coolant'):
        c = V((0, -1.6, -0.36))
        mb.box((0.8, 1.0, 0.04), T(c + V((0, 0, -0.03))), 'MAT_HULL_METAL', bevel=0.008, seg=2)
        for sx in (-0.2, 0.2):
            M = T(sx, -1.75, -0.6) @ R('X', 90)
            mb.cyl(0.11, 0.36, M, 'MAT_DARK_COMPOSITE', seg=12, bevel=0.01, bseg=1)
            for k in range(5):
                mb.cyl(0.13, 0.012, M @ T(0, 0, -0.12 + k * 0.06), 'MAT_HULL_METAL', seg=12, caps=False)
            mb.cyl(0.08, 0.16, T(sx, -1.47, -0.6) @ R('X', 90), 'MAT_HULL_METAL', seg=12, bevel=0.01, bseg=1)
            kit.connector(mb, T(sx, -1.95, -0.6) @ R('X', -90), 0.018, 0.04)
            kit.strut(mb, V((sx, -1.75, -0.49)), V((sx, -1.75, -0.4)), 0.03)
        f = mb.sphere(0.13, T(0, -1.3, -0.58), 'MAT_HULL_METAL', seg=16, rings=8)
        mb.torus(0.132, 0.008, T(0, -1.3, -0.58), 'MAT_HULL_METAL', seg=16, rseg=4)
        kit.valve(mb, T(0.0, -2.0, -0.55) @ R('Z', 0), 0.06, 'wheel')
        for sgn in (-1, 1):
            with mb.no_region():
                kit.pipe_run(mb, [V((sgn * 0.2, -1.47 + 0.08, -0.6)), V((sgn * 0.3, -1.2, -0.5)),
                                  V((sgn * 0.5, -0.95, -0.12)), V((sgn * 0.55, -0.9, -0.02))], 0.022, 'MAT_HULL_METAL',
                             clamp_every=0)
            with mb.no_region():
                kit.pipe_run(mb, [V((sgn * 0.2, -1.95, -0.6)), V((sgn * 0.32, -2.3, -0.5)),
                                  V((sgn * 0.5, -3.2, -0.12)), V((sgn * 0.55, -3.3, -0.02))], 0.022, 'MAT_HULL_METAL',
                             clamp_every=0.9)
        clnt_vent = kit.vent(mb, frame(V((0.0, -1.85, -0.72)), z=(0, 0, -1)), 0.025)
    return clnt_vent


def build_thrust(mb, rng):
    with mb.region('engine'):
        ring_y = -4.55
        for k in range(8):
            a = math.tau * k / 8 + math.pi / 8
            p1 = V((0.42 * math.cos(a), ring_y, 0.42 * math.sin(a)))
            cx = 0.35 if math.cos(a) > 0 else -0.35
            cz = 0.35 if math.sin(a) > 0 else -0.35
            kit.strut(mb, V((cx, -4.0, cz)), p1, 0.028, 'MAT_HULL_METAL', seg=8, ends=0.05)
        mb.torus(0.42, 0.04, T(0, ring_y, 0) @ R('X', 90), 'MAT_HULL_METAL', seg=32, rseg=8)
        mb.cyl(0.16, 0.14, T(0, ring_y - 0.02, 0) @ R('X', 90), 'MAT_HULL_METAL', seg=16, bevel=0.015, bseg=2)
        for k in range(4):
            a = math.tau * k / 4
            kit.strut(mb, V((0.42 * math.cos(a), ring_y, 0.42 * math.sin(a))), V((0.1 * math.cos(a), ring_y - 0.03,
                                                                                    0.1 * math.sin(a))), 0.025)
        # gimbal actuators (pitch + yaw)
        for p0, p1 in ((V((0.35, -4.0, 0.0)), V((0.2, THROAT_Y + 0.3, 0.0))),
                       (V((0.0, -4.0, 0.35)), V((0.0, THROAT_Y + 0.3, 0.2)))):
            d = (p1 - p0)
            mid = p0 + d * 0.45
            kit.strut(mb, p0, mid, 0.04, 'MAT_HULL_METAL', seg=10, ends=0.05)
            kit.strut(mb, mid - d.normalized() * 0.05, p1, 0.022, 'MAT_HULL_METAL', seg=8, ends=0.04)
            mb.box((0.07, 0.12, 0.07), frame(p0 + d * 0.2, z=d), 'MAT_DARK_COMPOSITE', bevel=0.01, seg=1)
        # gold MLI skirt over the aft frame (heat shield blanket)
        prof = [(0.36, -3.98), (0.62, -4.08), (0.62, -4.12), (0.40, -4.12)]
        f = mb.lathe([(0.34, -4.0), (0.6, -4.05), (0.6, -4.1)], frame((0, 0, 0), z=(0, 1, 0), y=(0, 0, 1)),
                     'MAT_MLI_GOLD', seg=20)
        f = mb.subdivide(f, 1)
        mb.wrinkle(f, 0.008, 0.07, seed=7.0)


def build_engine(root, rng):
    mb = geo.MeshBuilder('ENGINE_BELL')
    with mb.region('engine'):
        Mt = frame(V((0, THROAT_Y, 0)), z=(0, 1, 0), y=(0, 0, 1))
        kit.regen_bell(mb, Mt, 0.11, EXIT_R, BELL_LEN, tubes=40, chamber_r=0.19, chamber_len=0.42)
    ob = mb.to_object('ENGINE_BELL', parent=root)
    return ob, mb


def build_sensors(mb, rng):
    # fixed radar array on the nose face
    yf = EYE.y + 1.50
    with mb.region('radar'):
        Mr = frame(V((0, yf + 0.03, EYE.z - 0.58)), z=(0, 1, 0.12), y=(0, -0.12, 1))
        mb.box((0.9, 0.58, 0.05), Mr @ T(0, 0, 0.0), 'MAT_HULL_METAL', bevel=0.012, seg=2)
        mb.box((0.82, 0.5, 0.03), Mr @ T(0, 0, 0.03), 'MAT_DARK_COMPOSITE', bevel=0.006, seg=1)
        for i in range(8):
            for j in range(5):
                mb.box((0.094, 0.094, 0.008), Mr @ T(-0.36 + i * 0.103, -0.2 + j * 0.1, 0.048), 'MAT_PANEL_BLACK')
        kit.bolt_rect(mb, Mr, 0.9, 0.58, 0.14, 0.02, 0.006, 0.004, z=0.025)
    # IRST turret (starboard) and optical camera (port) on the nose deck
    deck_z = EYE.z - 0.20
    with mb.region('irst'):
        c = V((0.30, EYE.y + 1.25, deck_z))
        mb.cyl(0.11, 0.06, T(c + V((0, 0, 0.03))), 'MAT_HULL_METAL', seg=16, bevel=0.01, bseg=2)
        mb.cyl(0.095, 0.08, T(c + V((0, 0, 0.1))), 'MAT_DARK_COMPOSITE', seg=16, bevel=0.012, bseg=2)
        mb.sphere(0.075, T(c + V((0, 0.01, 0.16))), 'MAT_GLASS', seg=20, rings=10, z0=-0.2, z1=1.0)
        # shroud hood around the aft half of the dome
        mb.lathe([(0.088, 0.13), (0.092, 0.23)], T(c + V((0, 0, 0.0))) @ R('Z', 180), 'MAT_DARK_COMPOSITE',
                 seg=12, arc=200)
        kit.bolt_circle(mb, T(c), 0.1, 8, 0.005, 0.004, z=0.06)
    with mb.region('optics'):
        c = V((-0.30, EYE.y + 1.25, deck_z))
        mb.box((0.14, 0.2, 0.12), T(c + V((0, -0.02, 0.07))), 'MAT_DARK_COMPOSITE', bevel=0.012, seg=2)
        Ml = frame(c + V((0, 0.08, 0.09)), z=(0, 1, 0.08))
        mb.lathe([(0.0, 0.0), (0.05, 0.0), (0.05, 0.06), (0.06, 0.07), (0.065, 0.16), (0.058, 0.16),
                  (0.044, 0.07), (0.035, 0.065), (0.0, 0.065)], Ml, 'MAT_DARK_COMPOSITE', seg=16)
        mb.cyl(0.034, 0.004, Ml @ T(0, 0, 0.066), 'MAT_GLASS', seg=16)
        kit.connector(mb, T(c + V((0.07, -0.08, 0.07))) @ R('Y', 90), 0.01, 0.02)


def build_chassis():
    rng = random.Random(1401)
    root = core.empty('CHASSIS', display='PLAIN_AXES', size=1.0)
    hull_ob, hull_det, wins, vent_o2, side_x, cap_regions = build_capsule(root, rng)

    body = geo.MeshBuilder('CHASSIS_BODY')
    build_ring(body, rng)
    build_keel(body)
    build_tanks(body, rng)
    build_powerplant(body, rng)
    hs_vent = build_heatsink(body, rng)
    clnt_vent = build_pumpbay(body, rng)
    build_thrust(body, rng)
    build_sensors(body, rng)

    # fore RCS quads on the ring side flats; aft quads on dorsal/ventral pylons
    hp = {}
    with body.region('rcs_fp'):
        hp['FP'] = rcs(body, 'FP', frame(V((-1.0, 3.42, 0)), z=(-1, 0, 0), y=(0, 1, 0)),
                       [V((0, 0, 1)), V((0, 1, 0)), V((-1, 0, 0)), V((1, 0, 0))])
    with body.region('rcs_fs'):
        hp['FS'] = rcs(body, 'FS', frame(V((1.0, 3.42, 0)), z=(1, 0, 0), y=(0, 1, 0)),
                       [V((0, 0, 1)), V((0, 1, 0)), V((-1, 0, 0)), V((1, 0, 0))])
    for q, sz in (('AD', 1), ('AV', -1)):
        with body.region('rcs_' + q.lower()):
            base = V((0, -3.78, sz * 0.36))
            body.box((0.12, 0.16, 0.22), T(base + V((0, 0, sz * 0.11))), 'MAT_HULL_METAL', bevel=0.01, seg=1)
            hp[q] = rcs(body, q, frame(base + V((0, 0, sz * 0.22)), z=(0, 0, sz), y=(0, 1, 0)),
                        [V((0, 0, 1)), V((0, -1, 0)), V((1, 0, 0)), V((-1, 0, 0))])

    # propellant dump vent between the tanks
    prop_vent = kit.vent(body, frame(V((0, TANK_Y, 0.37)), z=(0, 0, 1)), 0.022)
    # camera housings
    # aft camera on a mast from the ring top, high enough to look over any dorsal kit
    aft_cam_pos = V((-0.22, 2.95, 1.78))
    body.cyl(0.07, 0.03, T(-0.22, 2.95, 0.995), 'MAT_HULL_METAL', seg=10)
    body.cyl(0.028, 0.74, T(-0.22, 2.95, 1.37), 'MAT_HULL_METAL', seg=8)
    kit.strut(body, V((-0.22, 3.35, 0.99)), V((-0.22, 2.97, 1.5)), 0.012, 'MAT_HULL_METAL', seg=5)
    body.box((0.09, 0.15, 0.08), T(aft_cam_pos + V((0, 0.02, 0))), 'MAT_DARK_COMPOSITE', bevel=0.01, seg=1)
    body.cyl(0.025, 0.04, frame(aft_cam_pos + V((0, -0.07, 0)), z=(0, -1, 0)), 'MAT_GLASS', seg=8)
    fwd_cam_pos = V((0.55, -3.95, -0.62))
    kit.strut(body, V((0.35, -3.95, -0.35)), fwd_cam_pos + V((0, 0, 0.04)), 0.02)
    body.box((0.08, 0.12, 0.08), T(fwd_cam_pos), 'MAT_DARK_COMPOSITE', bevel=0.01, seg=1)

    regions = geo.regions_union(body)
    for k, v in cap_regions.items():
        regions[k] = v
    body_ob = body.to_object('CHASSIS_BODY', parent=root)

    # radiators
    rad = {}
    for side, nm in ((-1, 'RAD_L'), (1, 'RAD_R')):
        mb = geo.MeshBuilder(nm)
        hinge = V((side * HINGE_X, RAD_Y, 0.0))
        Mloc = T(hinge) @ (R('Z', 180) if side < 0 else Matrix.Identity(4))
        with mb.region('radiator_' + ('l' if side < 0 else 'r')):
            kit.radiator_panel(mb, Mloc, RAD_SPAN, RAD_CHORD, 0.03, tubes=11)
        # hinge knuckles and swivel joints on the hinge line
        for yy in (-0.9, 0.0, 0.9):
            kit.hinge(mb, T(hinge + V((0, yy, 0))), 0.3, 0.03, 3)
        if side < 0:
            # boom camera housing at the tip, looking inboard
            tip = V((-(HINGE_X + RAD_SPAN) + 0.05, RAD_Y + RAD_CHORD / 2 - 0.08, 0.06))
            mb.box((0.1, 0.1, 0.1), T(tip), 'MAT_DARK_COMPOSITE', bevel=0.012, seg=1)
            mb.cyl(0.03, 0.05, frame(tip + V((0.06, 0, 0.02)), z=(1, 0, 0.1)), 'MAT_DARK_COMPOSITE', seg=10)
        ob = mb.to_object(nm, parent=root, origin=T(hinge))
        regions.update(mb.regions)
        rad[nm] = ob
        # hinge brackets on the keel side (body side of the hinge)
    hb = geo.MeshBuilder('_hinge_brackets')
    for side in (-1, 1):
        for yy in (-0.9, 0.0, 0.9):
            p = V((side * HINGE_X, RAD_Y + yy, 0))
            hb.box((0.22, 0.08, 0.1), T(p + V((-side * 0.11, 0.2, 0))), 'MAT_HULL_METAL', bevel=0.012, seg=2)
            hb.box((0.22, 0.08, 0.1), T(p + V((-side * 0.11, -0.2, 0))), 'MAT_HULL_METAL', bevel=0.012, seg=2)
        # flex coolant hoses across the hinge
        for yy in (-1.15, 1.15):
            p = V((side * HINGE_X, RAD_Y + yy, 0))
            hb.curve_pipe([p + V((-side * 0.05, 0, -0.02)), p + V((side * 0.0, 0, -0.12)), p + V((side * 0.12, 0, -0.05)),
                           p + V((side * 0.18, 0, 0.0))], 0.02, 'MAT_RUBBER', res_u=6)
    hb_ob = hb.to_object('_hinge_brackets', parent=root)

    eng_ob, eng_mb = build_engine(root, rng)
    regions.update(eng_mb.regions)

    # join static parts: capsule details into CAPSULE (after booleans are applied), brackets into body
    core.finalize()
    cap = core.join([hull_ob, hull_det], 'CAPSULE')
    core.join([body_ob, hb_ob], 'CHASSIS_BODY')

    # ---- empties / anchors
    core.empty('COCKPIT_ANCHOR', T(EYE), root, 'ARROWS', 0.3)
    core.empty('HP_ENGINE', T(0, THROAT_Y - BELL_LEN, 0), root, 'SINGLE_ARROW', 0.6)
    for q in ('FP', 'FS', 'AD', 'AV'):
        for i, Mx in enumerate(hp[q]):
            core.empty(f'HP_RCS_{q}_{i}', Mx, root, 'SINGLE_ARROW', 0.15)
    core.empty('HP_VENT_HS', hs_vent, root, 'SINGLE_ARROW', 0.2)
    core.empty('HP_VENT_O2', vent_o2, root, 'SINGLE_ARROW', 0.2)
    core.empty('HP_VENT_CLNT', clnt_vent, root, 'SINGLE_ARROW', 0.2)
    core.empty('HP_VENT_PROP', prop_vent, root, 'SINGLE_ARROW', 0.2)
    core.camera('CAM_EXT_AFT', aft_cam_pos + V((0, -0.1, 0.0)), V((0, -4.6, 0.0)), 58, root)
    core.camera('CAM_EXT_FWD', fwd_cam_pos + V((0, 0.08, 0)), V((0, 3.0, 0.1)), 56, root)
    tip_cam = V((-(HINGE_X + RAD_SPAN) + 0.13, RAD_Y + RAD_CHORD / 2 - 0.08, 0.08))
    core.camera('CAM_EXT_BOOM', tip_cam, V((0, 0.6, 0.2)), 50, rad['RAD_L'])

    # ---- decals
    def side_center(y_rel, sgn, z_rel):
        return E(side_x(y_rel, sgn), y_rel, z_rel)
    for sgn, s in ((-1, 'L'), (1, 'R')):
        n = V((sgn, 0, 0))
        decal(cap, 'HULLNUM_' + s, DECAL_CELLS['HULLNUM_' + s], side_center(0.25, sgn, -0.62), n, (0, 0, 1), 0.46,
              mirror=False)
        decal(cap, 'INSIGNIA_' + s, DECAL_CELLS['INSIGNIA_' + s], side_center(-0.62, sgn, -0.62), n, (0, 0, 1), 0.40)
        decal(root, 'NAME_' + s, DECAL_CELLS['NAME_' + s], V((sgn * 1.0 * math.cos(math.pi / 16), 2.98, 0)),
              n, (0, 0, 1), 0.36)

    def on_sphere(c, r):
        return lambda p: c + (p - c).normalized() * r
    for i, (side, ang) in enumerate(((-1, 35), (1, 35))):
        c = V((side * TANK_X, TANK_Y, 0))
        a = math.radians(ang)
        n = V((side * math.cos(a), 0, math.sin(a)))
        decal(root, f'STENCIL_{i}', DECAL_CELLS[f'STENCIL_{i}'], c + n * TANK_R, n, (0, 1, 0), 0.3,
              project=on_sphere(c, TANK_R + 0.002))
    hc = V((0, -1.4, 0.69))
    decal(root, 'STENCIL_2', DECAL_CELLS['STENCIL_2'], hc + V((0.24, -0.25, 0.24)), V((1, 0, 1)), (0, 1, 0), 0.22,
          project=lambda p: hc + V((p.x, 0, p.z - hc.z)).normalized() * 0.35 + V((0, p.y - hc.y, 0)), proud=0.006)
    decal(cap, 'STENCIL_3', DECAL_CELLS['STENCIL_3'], side_center(-0.25, -1, -0.24), V((-1, 0, 0)), (0, 0, 1), 0.2)
    decal(rad['RAD_R'], 'STENCIL_4', DECAL_CELLS['STENCIL_4'], V((HINGE_X + 0.45, RAD_Y + RAD_CHORD / 2 - 0.25, 0.024)),
          V((0, 0, 1)), (0, 1, 0), 0.24)
    decal(root, 'STENCIL_5', DECAL_CELLS['STENCIL_5'], V((0, 3.0, 0.0)) + V((math.cos(math.radians(-67.5)), 0,
          math.sin(math.radians(-67.5)))) * 0.99, V((math.cos(math.radians(-67.5)), 0, math.sin(math.radians(-67.5)))),
          (0, 1, 0), 0.24)

    # ---- HIT boxes from the tracked regions
    for comp in ('cabin', 'avionics', 'powerplant', 'tank_fuel', 'tank_ox', 'keel', 'heatsink', 'coolant', 'engine',
                 'rcs_fp', 'rcs_fs', 'rcs_ad', 'rcs_av', 'irst', 'radar', 'optics', 'comms'):
        lo, hi = regions[comp]
        core.hit_box(comp, lo, hi, root)
    for comp, nm in (('radiator_l', 'RAD_L'), ('radiator_r', 'RAD_R')):
        lo, hi = regions[comp]
        core.hit_box(comp, lo, hi, rad[nm])
    return {
        'root': root, 'cameras': True,
        'masks': dict(ao_dist=1.4, crevice=0.05, samples=24),
        'preview': dict(view_dir=(1.0, 0.85, 0.55), sun_dir=(-0.5, 0.7, 0.9), fov=28, margin=1.02),
    }


# ============================================================================================ kits
# Kits are authored in the chassis frame and share its mount points:
#   dorsal spine pedestal (y ~1.05)  : recon IR telescope | skirmisher KKV rack | picket PD_0
#   ventral mid (y ~0.8)             : recon AESA         |                     | picket PD_1 + capacitor bank
#   nose chin                        : recon lidar
#   ventral ring flat                :                    | skirmisher radar dish
#   aft spine (y ~ -2.95)            : recon lasercom     | skirmisher PD_0 (ventral aft)
KEEL_TOP = 0.35
KEEL_BOT = -0.35


def _union(*boxes):
    lo = V((min(b[0].x for b in boxes), min(b[0].y for b in boxes), min(b[0].z for b in boxes)))
    hi = V((max(b[1].x for b in boxes), max(b[1].y for b in boxes), max(b[1].z for b in boxes)))
    return lo, hi


def _spine_pedestal(mb, y, top_z, r=0.15):
    """Common dorsal mount: base plate bolted across the keel's top longerons + tapered pedestal."""
    mb.box((0.86, 0.5, 0.03), T(0, y, KEEL_TOP + 0.05), 'MAT_HULL_METAL', bevel=0.008, seg=1)
    for sx in (-0.35, 0.35):
        mb.box((0.1, 0.56, 0.06), T(sx, y, KEEL_TOP + 0.02), 'MAT_HULL_METAL')
        kit.bolt_row(mb, T(sx, y, KEEL_TOP + 0.065), (0, -0.22, 0), (0, 0.22, 0), 3, 0.008, 0.006)
    mb.lathe([(r * 1.6, KEEL_TOP + 0.065), (r * 1.25, KEEL_TOP + 0.12), (r, top_z - 0.05), (r * 1.2, top_z)],
             T(0, y, 0), 'MAT_HULL_PAINT', seg=16)


def build_kit_recon():
    rng = random.Random(2101)
    root = core.empty('KIT_RECON', size=1.0)
    st = geo.MeshBuilder('KIT_RECON_BODY')
    hits = {}
    # ---------------- IR telescope (0.6 m aperture, 2.4 m with sunshade) on a two-axis gimbal
    az_p = V((0, 1.05, 0.64))
    el_p = V((0, 1.05, 1.16))
    with st.region('telescope'):
        _spine_pedestal(st, az_p.y, az_p.z - 0.02)
        with st.no_region():
            kit.cable_loom(st, [(0.12, az_p.y - 0.1, KEEL_TOP + 0.1), (0.2, 1.8, KEEL_TOP + 0.08), (0.25, 2.65, 0.45)],
                           strands=3, r=0.01, twist=1.2, clamp_every=0.5, seg=4, step=0.15, rng=rng,
                           mats=('MAT_CABLE_BLACK', 'MAT_CABLE_GREY', 'MAT_CABLE_BLACK'), lacing=False)
    az = geo.MeshBuilder('TEL_AZ')
    with az.region('telescope'):
        az.cyl(0.34, 0.06, T(az_p + V((0, 0, 0.03))), 'MAT_HULL_PAINT', seg=24, bevel=0.01, bseg=1)
        kit.bolt_circle(az, T(az_p + V((0, 0, 0.06))), 0.3, 10, 0.008, 0.006)
        side = frame((0, 0, 0), z=(1, 0, 0), y=(0, 0, 1))
        for sx in (-1, 1):
            az.prism([(-0.2, 0.05), (0.2, 0.05), (0.07, 0.56), (-0.07, 0.56)], 0.05,
                     T(az_p + V((sx * 0.45, 0, 0))) @ side, 'MAT_HULL_METAL', bevel=0.006, seg=1)
            az.cyl(0.08, 0.06, T(el_p + V((sx * 0.48, 0, 0))) @ R('Y', 90), 'MAT_HULL_METAL', seg=14, bevel=0.008,
                   bseg=1)
        az.box((0.12, 0.16, 0.14), T(az_p + V((0.56, 0, 0.3))), 'MAT_DARK_COMPOSITE', bevel=0.01, seg=1)
    tel_az = az.to_object('TEL_AZ', parent=root, origin=T(az_p))
    el = geo.MeshBuilder('TEL_EL')
    My = frame(el_p, z=(0, 1, 0), y=(0, 0, 1))
    with el.region('telescope'):
        y0, y1, ys = -0.95, 1.15, 1.45
        # barrel in a silver MLI jacket, metal end rings, dark interior, primary mirror
        f = el.lathe([(0.36, y0 + 0.06), (0.36, y1)], My, 'MAT_MLI_SILVER', seg=24)
        f = el.subdivide(f, 2)
        el.wrinkle(f, 0.006, 0.08, seed=4.2)
        el.lathe([(0.0, y0 - 0.02), (0.3, y0 - 0.02), (0.37, y0), (0.37, y0 + 0.08)], My, 'MAT_HULL_METAL', seg=24)
        el.lathe([(0.375, y1 - 0.05), (0.39, y1), (0.39, ys), (0.4, ys + 0.01), (0.37, ys + 0.01), (0.34, y1),
                  (0.33, y1 - 0.1), (0.31, -0.55), (0.0, -0.55)], My,
                 ['MAT_HULL_METAL', 'MAT_HULL_PAINT', 'MAT_HULL_PAINT', 'MAT_HULL_METAL', 'MAT_PANEL_BLACK',
                  'MAT_PANEL_BLACK', 'MAT_PANEL_BLACK', 'MAT_PANEL_BLACK'], seg=24)
        el.cyl(0.3, 0.01, My @ T(0, 0, -0.54), 'MAT_GLASS', seg=24)
        for t in (0.3, 0.7):
            el.torus(0.372, 0.012, My @ T(0, 0, y0 + (y1 - y0) * t), 'MAT_HULL_METAL', seg=24, rseg=3)
        for yy in (y1 + 0.1, y1 + 0.22):
            el.lathe([(0.39, yy), (0.33, yy + 0.004)], My, 'MAT_PANEL_BLACK', seg=24)
        # scarfed sunshade lip (upper half extends further)
        el.lathe([(0.392, ys), (0.392, ys + 0.3), (0.398, ys + 0.3), (0.398, ys)], My @ R('Z', 0), 'MAT_HULL_PAINT',
                 seg=12, arc=180)
        # secondary mirror spider
        el.cyl(0.07, 0.06, My @ T(0, 0, y1 - 0.15), 'MAT_DARK_COMPOSITE', seg=12)
        for k in range(4):
            ang = math.tau * k / 4 + math.pi / 4
            el.box((0.3, 0.006, 0.01), My @ T(math.cos(ang) * 0.2, math.sin(ang) * 0.2, y1 - 0.15) @ R('Z', math.degrees(ang)),
                   'MAT_DARK_COMPOSITE')
        # trunnions, cryocooler with fins on the back, focal-plane box underneath
        for sx in (-1, 1):
            el.cyl(0.07, 0.1, T(el_p + V((sx * 0.42, 0, 0))) @ R('Y', 90), 'MAT_HULL_METAL', seg=12)
        kit.box_unit(el, frame(el_p + V((0, y0 - 0.02, 0)), z=(0, -1, 0), y=(0, 0, 1)), (0.34, 0.3, 0.16),
                     'MAT_DARK_COMPOSITE', rng=rng, ribs=0, connectors=2)
        for k in range(6):
            el.box((0.3, 0.008, 0.12), T(el_p + V((0, y0 - 0.2 - k * 0.025, 0))), 'MAT_HULL_METAL')
        kit.mli_box(el, frame(el_p + V((0, -0.35, -0.36)), z=(0, 0, -1), y=(0, 1, 0)), (0.26, 0.42, 0.1),
                    'MAT_MLI_GOLD', amp=0.004, scale=0.06, seed=2.0, cuts=2, tape=False)
    tel_el = el.to_object('TEL_EL', parent=tel_az, origin=T(el_p))
    hits['telescope'] = geo.regions_union(st, az, el)['telescope']

    # ---------------- ventral AESA (1.8 x 1.3 m tile array) on struts under the tanks
    with st.region('aesa'):
        c = V((0, 0.95, -1.0))
        Ma = T(c) @ R('X', 8)
        st.box((1.8, 1.3, 0.07), Ma, 'MAT_DARK_COMPOSITE', bevel=0.012, seg=1)
        st.box((1.84, 1.34, 0.03), Ma @ T(0, 0, 0.045), 'MAT_HULL_METAL', bevel=0.008, seg=1)
        for i in range(12):
            for j in range(8):
                st.box((0.135, 0.145, 0.012), Ma @ T(-0.825 + i * 0.15, -0.56 + j * 0.16, -0.041), 'MAT_PANEL_BLACK')
        for sx in (-0.35, 0.35):
            for yy in (0.45, 1.45):
                kit.strut(st, Ma @ V((sx * 1.6, yy - 0.95, 0.06)), V((sx, yy, KEEL_BOT)), 0.02, 'MAT_HULL_METAL',
                          seg=6, ends=0.04)
        st.box((0.5, 0.4, 0.1), Ma @ T(0, 0.2, 0.1), 'MAT_DARK_COMPOSITE', bevel=0.01, seg=1)
        kit.pipe_run(st, [Ma @ V((0.2, 0.3, 0.12)), V((0.25, 1.3, -0.6)), V((0.3, 1.6, KEEL_BOT))], 0.018,
                     'MAT_HULL_METAL', clamp_every=0)
        kit.cable_loom(st, [Ma @ V((-0.2, 0.3, 0.12)), (-0.25, 1.3, -0.6), (-0.3, 1.6, KEEL_BOT)], strands=3, r=0.008,
                       twist=2.0, clamp_every=0.3, seg=4, step=0.1, rng=rng,
                       mats=('MAT_CABLE_BLACK', 'MAT_CABLE_GREY', 'MAT_CABLE_BLACK'), lacing=False)
    # ---------------- nose lidar turret under the chin
    with st.region('lidar'):
        c = V((0.0, EYE.y + 1.18, EYE.z - 1.10))
        st.box((0.3, 0.26, 0.02), T(c + V((0, 0, 0.01))), 'MAT_HULL_METAL', bevel=0.004, seg=1)
        st.cyl(0.07, 0.1, T(c + V((0, 0, -0.05))), 'MAT_HULL_METAL', seg=12)
        st.cyl(0.13, 0.04, T(c + V((0, 0, -0.1))), 'MAT_DARK_COMPOSITE', seg=16, bevel=0.008, bseg=1)
        st.sphere(0.115, T(c + V((0, 0, -0.2))), 'MAT_DARK_COMPOSITE', seg=16, rings=8)
        st.cyl(0.06, 0.02, frame(c + V((0, 0.105, -0.2)), z=(0, 1, 0)), 'MAT_GLASS', seg=12)
        st.lathe([(0.075, 0.0), (0.082, 0.03), (0.07, 0.03)], frame(c + V((0, 0.1, -0.2)), z=(0, 1, 0)),
                 'MAT_HULL_METAL', seg=12)
    # ---------------- laser-comm terminal, aft spine
    with st.region('lasercom'):
        mast_top = V((0, -2.95, 0.58))
        st.box((0.3, 0.3, 0.03), T(0, -2.95, KEEL_TOP + 0.05), 'MAT_HULL_METAL', bevel=0.006, seg=1)
        st.cyl(0.05, mast_top.z - KEEL_TOP - 0.06, T(0, -2.95, (mast_top.z + KEEL_TOP + 0.06) / 2), 'MAT_HULL_METAL',
               seg=10)
        for k in range(3):
            ang = math.tau * k / 3
            kit.strut(st, V((math.cos(ang) * 0.13, -2.95 + math.sin(ang) * 0.13, KEEL_TOP + 0.07)),
                      V((0, -2.95, mast_top.z - 0.08)), 0.01, seg=5)
    lc_az, lc_el, lc_hp, lc_box = kit.gimbal_turret('LCOM_AZ', 'LCOM_EL', '_LCOM_HP', mast_top, mast_top.z - 0.001,
                                                    0.075, root, st, ventral=False, director_len=0.36, el_gap=0.17,
                                                    kind='optic')
    core.remove(lc_hp)
    hits['aesa'] = st.regions['aesa']
    hits['lidar'] = st.regions['lidar']
    hits['lasercom'] = _union(st.regions['lasercom'], lc_box)
    st.to_object('KIT_RECON_BODY', parent=root)
    for k, (lo, hi) in hits.items():
        core.hit_box(k, lo, hi, root)
    return {'root': root, 'masks': dict(ao_dist=1.2, crevice=0.04, samples=20),
            'preview': dict(view_dir=(1.0, 0.85, 0.6), sun_dir=(-0.5, 0.7, 0.9), fov=28, margin=1.02)}


def _kkv_canister(name, mouth, axis, parent, L=1.5, r=0.16):
    """KKV_<i>: launch canister (separate object so the runtime can hide it on launch), origin at its centre."""
    mb = geo.MeshBuilder(name)
    ax = V(axis).normalized()
    cen = mouth - ax * (L / 2)
    M = frame(cen, z=ax, y=(0, 0, 1))
    h = L / 2
    prof = [(0.0, -h - 0.05), (r * 0.5, -h - 0.05), (r * 0.85, -h - 0.02), (r, -h + 0.02), (r, h - 0.06),
            (r * 1.06, h - 0.04), (r * 1.06, h), (r * 0.9, h + 0.004), (r * 0.75, h + 0.02), (0.0, h + 0.03)]
    mb.lathe(prof, M, ['MAT_HULL_METAL', 'MAT_HULL_METAL', 'MAT_HULL_PAINT', 'MAT_HULL_PAINT', 'MAT_HULL_METAL',
                       'MAT_HULL_METAL', 'MAT_DARK_COMPOSITE', 'MAT_DARK_COMPOSITE', 'MAT_DARK_COMPOSITE'], seg=14)
    for z in (-h + 0.25, h - 0.3):
        mb.torus(r * 1.012, 0.012, M @ T(0, 0, z), 'MAT_HULL_METAL', seg=14, rseg=3)
    mb.box((0.03, L * 0.8, 0.03), M @ T(0, r + 0.012, 0) @ R('X', 90), 'MAT_HULL_METAL')
    mb.box((0.012, 0.06, 0.008), M @ T(0, 0, h + 0.03) @ R('Z', 45), 'MAT_PAINT_RED')
    ob = mb.to_object(name, parent=parent, origin=T(cen))
    return ob, M


def build_kit_skirmisher():
    rng = random.Random(3101)
    root = core.empty('KIT_SKIRMISHER', size=1.0)
    st = geo.MeshBuilder('KIT_SKIRMISHER_BODY')
    hits = {}
    # ---------------- KKV rack: 3 x 2 canisters on the dorsal spine, splayed slightly
    xs = (-0.36, 0.0, 0.36)
    zs = (0.77, 1.12)
    mouth_y = 1.85
    boxes = []
    with st.region('kkv_rack'):
        for yy in (0.62, 1.55):
            # saddle frame: uprights, crossbars and diagonal brace
            for sx in (-0.58, 0.58):
                st.box((0.05, 0.08, 0.98), T(sx, yy, 0.86), 'MAT_HULL_METAL', bevel=0.008, seg=1)
            for zz in (0.58, 0.95, 1.31):
                st.box((1.2, 0.07, 0.04), T(0, yy, zz), 'MAT_HULL_PAINT', bevel=0.008, seg=1)
            kit.strut(st, V((-0.56, yy, 0.4)), V((0.56, yy, 1.29)), 0.012, seg=5)
            for sx in (-0.35, 0.35):
                st.box((0.14, 0.16, 0.05), T(sx, yy, KEEL_TOP + 0.04), 'MAT_HULL_METAL', bevel=0.006, seg=1)
                kit.strut(st, V((sx, yy, KEEL_TOP + 0.06)), V((sx * 1.4, yy, 0.58)), 0.016, seg=6)
        # launch-control box + harness
        kit.box_unit(st, T(0, 0.2, 0.42), (0.36, 0.24, 0.16), 'MAT_DARK_COMPOSITE', rng=rng, ribs=4, connectors=3,
                     rib_mat='MAT_HULL_METAL')
        kit.cable_loom(st, [(0.0, 0.08, 0.5), (0.05, -0.2, 0.45), (0.1, -0.4, KEEL_TOP + 0.08)], strands=3, r=0.009,
                       twist=2.0, clamp_every=0.2, seg=4, step=0.08, rng=rng,
                       mats=('MAT_CABLE_BLACK', 'MAT_CABLE_YELLOW', 'MAT_CABLE_BLACK'), lacing=False)
    i = 0
    for zi, z in enumerate(zs):
        for xi, x in enumerate(xs):
            yaw = (-3.0, 0.0, 3.0)[xi]
            pitch = (1.0, 3.0)[zi]
            ax = (R('X', pitch) @ R('Z', -yaw)).to_3x3() @ V((0, 1, 0))
            mouth = V((x, mouth_y, z))
            ob, M = _kkv_canister(f'KKV_{i}', mouth, ax, root)
            boxes.append(core.world_bounds([ob]))
            core.empty(f'HP_KKV_{i}', frame(mouth + ax * 0.035, z=ax, y=(0, 0, 1)), root, 'SINGLE_ARROW', 0.3)
            # canister clamp bands at the saddles (rack side, static)
            for yy in (0.62, 1.55):
                t = (yy - (mouth.y - 0.75 * ax.y)) / max(ax.y, 1e-6)
                p = mouth - ax * 0.75 + ax * t
                st.torus(0.172, 0.014, frame(p, z=ax), 'MAT_HULL_METAL', seg=12, rseg=3)
            i += 1
    hits['kkv_rack'] = _union(st.regions['kkv_rack'], *boxes)
    # ---------------- small ventral PD turret, aft spine
    az, eln, hp, box = kit.gimbal_turret('PD_0_AZ', 'PD_0_EL', 'HP_PD_0', V((0, -2.75, -0.6)), KEEL_BOT, 0.09, root, st,
                                         ventral=True, director_len=0.42)
    hits['pd_0'] = box
    # ---------------- medium radar dish on a ventral ring flat
    with st.region('radar_dish'):
        a = math.radians(-67.5)
        n = V((math.cos(a), 0, math.sin(a)))
        base = V((0, 3.3, 0)) + n * 0.99
        st.box((0.3, 0.3, 0.02), frame(base + n * 0.01, z=n, y=(0, 1, 0)), 'MAT_HULL_METAL', bevel=0.004, seg=1)
        tip = base + n * 0.32
        kit.strut(st, base + n * 0.02, tip, 0.04, seg=10)
        kit.gimbal_yoke(st, frame(tip, z=n), 0.08, h=0.1)
        kit.dish(st, frame(tip + n * 0.12 + V((0, 0.05, 0)), z=(0.35, 0.65, -0.68)), 0.42, 0.11, 'MAT_RADIATOR')
        kit.cable_loom(st, [base + V((0, -0.12, 0)), base + n * 0.15 + V((0, -0.08, 0)), tip + V((0, -0.05, -0.02))],
                       strands=2, r=0.008, twist=3.0, clamp_every=0, seg=4, step=0.05, rng=rng,
                       mats=('MAT_CABLE_BLACK', 'MAT_CABLE_GREY'), lacing=False)
    hits['radar_dish'] = st.regions['radar_dish']
    st.to_object('KIT_SKIRMISHER_BODY', parent=root)
    for k, (lo, hi) in hits.items():
        core.hit_box(k, lo, hi, root)
    return {'root': root, 'masks': dict(ao_dist=1.2, crevice=0.04, samples=20),
            'preview': dict(view_dir=(1.0, 0.85, 0.6), sun_dir=(-0.5, 0.7, 0.9), fov=28, margin=1.02)}


def build_kit_picket():
    rng = random.Random(4101)
    root = core.empty('KIT_PICKET', size=1.0)
    st = geo.MeshBuilder('KIT_PICKET_BODY')
    hits = {}
    # ---------------- two large PD turrets, 0.5 m beam directors
    with st.region('pd0_mount'):
        _spine_pedestal(st, 1.05, 0.6)
    az0, el0, hp0, b0 = kit.gimbal_turret('PD_0_AZ', 'PD_0_EL', 'HP_PD_0', V((0, 1.05, 0.62)), 0.6, 0.25, root, st,
                                          ventral=False, director_len=1.0)
    hits['pd_0'] = _union(b0, st.regions['pd0_mount'])
    az1, el1, hp1, b1 = kit.gimbal_turret('PD_1_AZ', 'PD_1_EL', 'HP_PD_1', V((0, 0.72, -0.58)), KEEL_BOT, 0.25, root, st,
                                          ventral=True, director_len=1.0)
    hits['pd_1'] = b1
    # ---------------- capacitor bank module (ventral, aft of PD_1)
    with st.region('capacitor'):
        c = V((0, -0.42, -0.36))
        st.box((0.86, 1.1, 0.04), T(c + V((0, 0, -0.03))), 'MAT_HULL_METAL', bevel=0.008, seg=1)
        for sx in (-0.4, 0.4):
            for sy in (-0.5, 0.5):
                st.box((0.05, 0.05, 0.52), T(c + V((sx, sy, -0.3))), 'MAT_HULL_METAL')
        st.box((0.86, 1.1, 0.03), T(c + V((0, 0, -0.57))), 'MAT_DARK_COMPOSITE', bevel=0.006, seg=1)
        for ix in range(3):
            for iy in range(4):
                p = c + V((-0.24 + ix * 0.24, -0.36 + iy * 0.24, -0.3))
                st.cyl(0.09, 0.42, T(p), 'MAT_DARK_COMPOSITE', seg=10)
                st.cyl(0.06, 0.03, T(p + V((0, 0, 0.225))), 'MAT_HULL_METAL', seg=8, caps=False)
        for iy in range(4):
            st.box((0.66, 0.035, 0.012), T(c + V((0, -0.36 + iy * 0.24, -0.06))), 'MAT_ENGINE_BELL')
        st.box((0.05, 0.9, 0.015), T(c + V((0.36, 0, -0.065))), 'MAT_ENGINE_BELL')
        for k in range(4):
            st.box((0.86, 0.008, 0.08), T(c + V((0, -0.45 + k * 0.3, -0.62))), 'MAT_HULL_METAL')
        # HV cables to both turrets
        with st.no_region():
            for tgt, sgn in ((V((0.18, 0.72, -0.62)), 1), (V((0.42, 1.05, 0.5)), -1)):
                kit.cable_loom(st, [c + V((0.36, 0.5, -0.1)), c + V((0.44, 0.9, -0.05)), V((0.44, 0.6, -0.2)), tgt],
                               strands=2, r=0.016, twist=0.8, clamp_every=0.5, seg=5, step=0.18, rng=rng,
                               mats=('MAT_CABLE_RED', 'MAT_CABLE_BLACK'), lacing=False, surface_dir=(1, 0, 0))
    hits['capacitor'] = st.regions['capacitor']
    # ---------------- heavy coolant plumbing: pump bay -> capacitor heat exchanger -> turrets
    for sgn in (-1, 1):
        kit.pipe_run(st, [V((sgn * 0.3, -1.25, -0.5)), V((sgn * 0.3, -0.98, -0.62)), V((sgn * 0.3, -0.6, -0.95)),
                          V((sgn * 0.3, 0.2, -0.95)), V((sgn * 0.22, 0.45, -0.75))], 0.035, 'MAT_HULL_METAL',
                     clamp_every=0.45, surface_dir=(0, 0, 1))
    kit.pipe_run(st, [V((-0.42, -0.95, -0.2)), V((-0.43, -0.2, 0.15)), V((-0.42, 0.6, 0.42)), V((-0.2, 1.0, 0.58))],
                 0.03, 'MAT_HULL_METAL', clamp_every=0.5, surface_dir=(1, 0, 0))

    # ---------------- radiator tip extensions (re-attached under RAD_L / RAD_R by the runtime: extras.parent)
    for side, nm, rad, comp in ((-1, 'RAD_L2', 'RAD_L', 'radiator_l2'), (1, 'RAD_R2', 'RAD_R', 'radiator_r2')):
        mb = geo.MeshBuilder(nm)
        hinge = V((side * (HINGE_X + RAD_SPAN), RAD_Y, 0.0))
        span, chord = 2.0, 2.3
        Mloc = T(hinge + V((0, -0.15, 0))) @ (R('Z', 180) if side < 0 else Matrix.Identity(4))
        with mb.region(comp):
            kit.radiator_panel(mb, Mloc, span, chord, 0.028, tubes=10, header=False)
            for yy in (-0.8, 0.5):
                kit.hinge(mb, T(hinge + V((0, yy, 0))), 0.26, 0.026, 3)
            mb.curve_pipe([hinge + V((-side * 0.06, -1.25, -0.03)), hinge + V((0, -1.32, -0.1)),
                           hinge + V((side * 0.08, -1.25, -0.03))], 0.016, 'MAT_RUBBER', res_u=5)
        ob = mb.to_object(nm, parent=root, origin=T(hinge), props={'parent': rad})
        lo, hi = mb.regions[comp]
        core.hit_box(comp, lo, hi, ob)
    st.to_object('KIT_PICKET_BODY', parent=root)
    for k, (lo, hi) in hits.items():
        core.hit_box(k, lo, hi, root)
    return {'root': root, 'masks': dict(ao_dist=1.2, crevice=0.04, samples=20),
            'preview': dict(view_dir=(1.0, 0.85, 0.6), sun_dir=(-0.5, 0.7, 0.9), fov=28, margin=1.02)}
