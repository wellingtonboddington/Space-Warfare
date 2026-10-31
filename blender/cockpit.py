"""Interceptor cockpit (cockpit.glb), driven entirely by js/data/cockpit_layout.json.

Origin = design eye point (EYE). The pressure shell is carved from the same window-plane half-spaces as the
chassis CAPSULE cab (interceptor.shell_planes), offset inboard, so the cockpit placed at COCKPIT_ANCHOR
nests inside the hull and its windows line up with the capsule apertures by construction.

Control node structure (docs/ASSETS.md section 4):
  <id>        Empty at the control position; local +Z = panel normal, +Y = panel up, +X = panel right
  <id>_BASE   static housing
  <id>_MOV    moving part, origin on the pivot. Geometry is modelled in the neutral pose and the node's rest
              transform is set to states[0] (toggle +25 deg about X = lever down; rotary = detents[0] about Z;
              valve 0; lever 0 = stowed; buttons/breakers at rest IN). Custom props (glTF extras) on every
              moving node spell the animation out: axis, unit and per-state values.
  <id>_GUARD  flip cover, origin on its top-edge hinge, closed at rest, opens to -100 deg about X
  <id>_NEEDLE gauge needle, origin on the pivot, rest = sweep[0] about Z
  LIGHT_<id>  lens (MAT_LIGHT) on illuminated buttons, child of <id>_MOV
  LABEL_*     engraved plates (MAT_LABELS) whose UVs cover exactly their label-atlas cell
UV convention: the TEXCOORD_0 values that reach three.js match the contract formulas directly (v up, row 0 at
the top: v in [1-(row+1)/16, 1-row/16]; SCREEN_* (0,0) bottom-left). Blender stores 1-v because the glTF
exporter flips V.
"""
import math
import random
import bmesh
from mathutils import Vector, Matrix
from lib import core, geo, kit, mats
from lib.core import T, R, S, frame
import interceptor

V = Vector
L = interceptor.LAYOUT
PANELS = {p['id']: p for p in L['panels']}
CTRL = {c['id']: c for c in L['controls']}


# ============================================================================================ helpers
class Panel:
    def __init__(self, p):
        self.id = p['id']
        self.c = V(p['center'])
        n = V(p['normal']).normalized()
        up = V(p['up'])
        up = (up - n * up.dot(n)).normalized()
        self.n, self.up = n, up
        self.right = up.cross(n)
        self.w, self.h = p['size']
        self.M = frame(self.c, z=n, y=up)

    def at(self, u, v, dz=0.0):
        return self.M @ T(u, v, dz)

    def pos(self, u, v, dz=0.0):
        return self.c + self.right * u + self.up * v + self.n * dz


PNL = {k: Panel(v) for k, v in PANELS.items()}


def cell_uv(index, cols=8, rows=16):
    col, row = index % cols, index // cols
    return col / cols, (col + 1) / cols, 1 - (row + 1) / rows, 1 - row / rows     # u0 u1 v0 v1 (three.js, v up)


def uv3(u, v):
    """three.js UV -> Blender UV (the glTF exporter flips V on export)."""
    return (u, 1.0 - v)


def label(name, M, w, index, parent, proud=0.0016):
    """LABEL_*: engraved 4:1 plate face, UVs exactly on its atlas cell."""
    h = w / 4.0
    u0, u1, v0, v1 = cell_uv(index)
    mb = geo.MeshBuilder(name)
    mb.quad([(-w / 2, -h / 2, proud), (w / 2, -h / 2, proud), (w / 2, h / 2, proud), (-w / 2, h / 2, proud)],
            'MAT_LABELS', uvs=[uv3(u0, v0), uv3(u1, v0), uv3(u1, v1), uv3(u0, v1)], M=M)
    return mb.to_object(name, parent=parent, origin=M, sharp_angle=None, weighted=False)


def plate_under(mb, M, w, h, mat='MAT_PANEL_BLACK', t=0.0012):
    """Engraved label backing plate (static) with two tiny rivets."""
    mb.box((w + 0.004, h + 0.003, t), M @ T(0, 0, t / 2), mat)
    for x in (-w / 2 - 0.0005, w / 2 + 0.0005):
        mb.cyl(0.0012, 0.0006, M @ T(x, 0, t + 0.0003), 'MAT_HULL_METAL', seg=5)


def props(ob, **kw):
    for k, v in kw.items():
        ob[k] = v
    return ob


# ============================================================================================ shell
def shell_planes():
    wins = interceptor.window_geometry()
    pl = interceptor.shell_planes(wins, -0.003)
    extra = [((0, 0, -1.17), (0, 0, -1)), ((0, 1.0, 0), (0, 1, 0)), ((0, 0.98, -0.9), (0, 0.6, -0.8)),
             ((0.72, 0, -1.08), (0.5, 0, -0.866)), ((-0.72, 0, -1.08), (-0.5, 0, -0.866)),
             ((0, -0.7, -1.0), (0, -0.6, -0.8)), ((0.72, 0, 0), (1, 0, 0)), ((-0.72, 0, 0), (-1, 0, 0))]
    pl += [(V(p), V(n).normalized()) for p, n in extra]
    return wins, pl


def section(planes, y, inset=0.0):
    """Convex cross-section of the shell at constant y (x, z polygon), optionally inset."""
    poly = [(-3.0, -3.0), (3.0, -3.0), (3.0, 3.0), (-3.0, 3.0)]
    for p, n in planes:
        a, b = n.x, n.z
        if abs(a) < 1e-9 and abs(b) < 1e-9:
            continue
        d = n.dot(p) - n.y * y - inset * math.hypot(a, b)
        out = []
        for i in range(len(poly)):
            P, Q = poly[i], poly[(i + 1) % len(poly)]
            fp, fq = a * P[0] + b * P[1] - d, a * Q[0] + b * Q[1] - d
            if fp <= 0:
                out.append(P)
            if fp * fq < 0:
                t = fp / (fp - fq)
                out.append((P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t))
        poly = out
        if not poly:
            break
    return poly


def nearest_plane_normal(planes, p):
    best, bn = 1e9, V((0, 0, 1))
    for q, n in planes:
        d = abs((p - q).dot(n))
        if d < best:
            best, bn = d, n
    return bn


def snap(planes, p):
    """Project p onto the nearest inner shell plane; returns (point on the wall, inward normal)."""
    best, bp, bn = 1e9, p, V((0, 0, 1))
    for q, n in planes:
        d = (p - q).dot(n)
        if abs(d) < best:
            best, bp, bn = abs(d), p - n * d, n
    return bp, -bn


def build_shell(root, rng):
    wins, planes = shell_planes()
    sb = geo.MeshBuilder('SHELL')
    sb.convex(planes, center=(0, 0, -0.3), size=4.0, mat='MAT_PANEL_GREY')
    bmesh.ops.reverse_faces(sb.bm, faces=sb.bm.faces)              # faces look into the cabin
    shell = sb.to_object('SHELL', parent=root, weighted=False, sharp_angle=30)
    so = shell.modifiers.new('solidify', 'SOLIDIFY')
    so.thickness = 0.035
    so.offset = -1.0
    so.use_even_offset = True
    for wid, P, c, n in wins:
        cut = geo.MeshBuilder('_wcut_' + wid)
        cc = sum(P, V()) / 4
        grow = [p + (p - cc).normalized() * 0.006 for p in P]
        bm = cut.bm
        vi = [bm.verts.new(p - n * 0.05) for p in grow]
        vo = [bm.verts.new(p + n * 0.2) for p in grow]
        bm.faces.new(list(reversed(vi)))
        bm.faces.new(vo)
        for i in range(4):
            bm.faces.new([vi[i], vi[(i + 1) % 4], vo[(i + 1) % 4], vo[i]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        cut.midx('MAT_PANEL_GREY')
        cob = cut.to_object('_wcut_' + wid, weighted=False, sharp_angle=None)
        geo.boolean(shell, cob, 'DIFFERENCE', transfer_materials=False, reorder=False)
    bv = shell.modifiers.new('bevel', 'BEVEL')
    bv.width, bv.segments, bv.limit_method, bv.angle_limit = 0.015, 2, 'ANGLE', math.radians(25)
    bv.use_clamp_overlap = True
    wn = shell.modifiers.new('wn', 'WEIGHTED_NORMAL')
    wn.keep_sharp = True

    det = geo.MeshBuilder('SHELL_DETAIL')
    # --- window glass (WINDOW_<id>) + inner trim frames with screws
    for wid, P, c, n in wins:
        g = geo.MeshBuilder('WINDOW_' + wid)
        f = g.quad(P, 'MAT_GLASS')
        f.normal_update()
        if f.normal.dot(c) > 0:                                    # face the pilot
            f.normal_flip()
        g.to_object('WINDOW_' + wid, parent=root, sharp_angle=None, weighted=False)
        cc = sum(P, V()) / 4
        for i in range(4):
            a, b = P[i], P[(i + 1) % 4]
            d = b - a
            mid = (a + b) / 2
            inward = (cc - mid)
            inward = (inward - n * inward.dot(n)).normalized()
            Mf = frame(mid + inward * 0.004 - n * 0.022, z=-n, x=d)
            det.box((d.length + 0.05, 0.03, 0.012), Mf, 'MAT_PANEL_BLACK', bevel=0.003, seg=1)
            for t in (0.2, 0.5, 0.8):
                det.hexbolt(0.0028, 0.0018, frame(a + d * t + inward * 0.006 - n * 0.016, z=-n), 'MAT_HULL_METAL')

    # --- ring frames (stringers) at stations aft of the windows, quilted padding between them
    for y in (-0.66, -0.36, -0.06):
        poly = section(planes, y, inset=0.0)
        for i in range(len(poly)):
            a, b = V((poly[i][0], y, poly[i][1])), V((poly[(i + 1) % len(poly)][0], y, poly[(i + 1) % len(poly)][1]))
            d = b - a
            if d.length < 0.02:
                continue
            mid = (a + b) / 2
            inward = V((-(d.z), 0, d.x)).normalized()
            if inward.dot(V((0, y, -0.3)) - mid) < 0:
                inward = -inward
            det.box((d.length + 0.03, 0.028, 0.03), frame(mid + inward * 0.012, z=inward, x=d), 'MAT_PANEL_GREY',
                    bevel=0.004, seg=1)
            if d.length > 0.12:
                for t in (0.25, 0.75):
                    det.hexbolt(0.0035, 0.002, frame(a + d * t + inward * 0.027 + V((0, 0.008, 0)), z=inward),
                                'MAT_HULL_METAL')
    # quilted padding on the aft walls / ceiling between the frames
    def quilt(M, w, h, nx, ny, depth=0.025):
        def z(x, y):
            u = (x / w + 0.5) * nx
            v = (y / h + 0.5) * ny
            pu = math.sin(math.pi * (u % 1.0))
            pv = math.sin(math.pi * (v % 1.0))
            edge = min(1.0, 6 * min(x / w + 0.5, 0.5 - x / w, y / h + 0.5, 0.5 - y / h))
            return depth * (0.35 + 0.65 * (pu * pv) ** 0.6) * edge
        det.grid(w, h, nx * 3, ny * 3, M, 'MAT_SEAT', zfunc=z)
    quilt(frame(V((0, -0.80, -0.25)), z=(0, 1, 0), y=(0, 0, 1)), 0.9, 0.62, 5, 4)
    for sx in (-1, 1):
        quilt(frame(V((sx * 0.70, -0.51, -0.12)), z=(-sx, 0, 0), y=(0, 0, 1)), 0.26, 0.42, 2, 3)
    quilt(frame(V((0, -0.50, 0.49)), z=(0, 0.25, -1), y=(0, 1, 0)), 0.5, 0.26, 4, 2)

    # --- floor: non-slip plate, kick strips, heel rest
    det.box((0.92, 1.62, 0.014), T(0, 0.12, -1.163), 'MAT_PANEL_GREY', bevel=0.004, seg=1)
    for x in (-0.44, 0.44):
        det.box((0.03, 1.6, 0.03), T(x, 0.12, -1.15), 'MAT_HULL_METAL', bevel=0.004, seg=1)
    for x in (-0.4, 0.0, 0.4):
        for y in (-0.62, -0.1, 0.4, 0.88):
            det.hexbolt(0.004, 0.0025, T(x, y, -1.156), 'MAT_HULL_METAL')
    for sx in (-0.26, 0.26):
        det.box((0.035, 0.05, 0.06), T(sx, 0.55, -1.13), 'MAT_HULL_METAL', bevel=0.005, seg=1)
    det.cyl(0.018, 0.5, T(0, 0.55, -1.10) @ R('Y', 90), 'MAT_HULL_METAL', seg=12)
    det.cyl(0.024, 0.36, T(0, 0.55, -1.10) @ R('Y', 90), 'MAT_RUBBER', seg=12)
    for k in range(9):
        det.torus(0.0245, 0.0025, T(-0.16 + k * 0.04, 0.55, -1.10) @ R('Y', 90), 'MAT_RUBBER', seg=12, rseg=3)

    # --- overhead grab handles + side handholds (worn yellow)
    for sx in (-1, 1):
        for (pa, pb) in (((sx * 0.40, -0.30, 0.45), (sx * 0.40, 0.05, 0.45)),
                         ((sx * 0.70, -0.62, -0.40), (sx * 0.70, -0.62, -0.12))):
            a, na = snap(planes, V(pa))
            b, nb = snap(planes, V(pb))
            det.sweep([a, a + na * 0.055, b + nb * 0.055, b], 0.011, None, 'MAT_PAINT_YELLOW', seg=8)
            for p, n_ in ((a, na), (b, nb)):
                det.cyl(0.02, 0.012, frame(p + n_ * 0.006, z=n_), 'MAT_HULL_METAL', seg=8)
    return wins, planes, det


# ============================================================================================ looms
def loom_mix(rng, k):
    """Strand colours for one bundle: mostly grey/black sheathing, an occasional coded colour."""
    base = ['MAT_CABLE_GREY', 'MAT_CABLE_BLACK', 'MAT_CABLE_GREY', 'MAT_CABLE_BLACK', 'MAT_CABLE_GREY']
    accent = ('MAT_CABLE_RED', 'MAT_CABLE_YELLOW', None)[k % 3]
    if accent:
        base[rng.randrange(len(base))] = accent
    return tuple(base)


def build_looms(rng):
    lm = geo.MeshBuilder('LOOMS')
    mix = ('MAT_CABLE_GREY', 'MAT_CABLE_BLACK', 'MAT_CABLE_GREY', 'MAT_CABLE_RED', 'MAT_CABLE_BLACK', 'MAT_CABLE_GREY',
           'MAT_CABLE_YELLOW')
    runs = [
        # left wall, aft wall -> breaker wall -> under the console
        ([(-0.66, -0.78, -0.30), (-0.68, -0.4, -0.42), (-0.67, -0.05, -0.44), (-0.62, 0.05, -0.47),
          (-0.6, 0.2, -0.70), (-0.6, 0.35, -0.95)], 6, 0.0055, (-1, 0, 0)),
        ([(0.66, -0.78, -0.30), (0.68, -0.4, -0.40), (0.67, -0.05, -0.43), (0.62, 0.05, -0.47),
          (0.6, 0.2, -0.72), (0.6, 0.4, -0.97)], 6, 0.0055, (1, 0, 0)),
        # along the upper left/right wall to the overhead
        ([(-0.62, -0.78, 0.22), (-0.62, -0.4, 0.26), (-0.6, -0.1, 0.29), (-0.35, 0.05, 0.40), (-0.2, 0.12, 0.43)], 4,
         0.0045, (-0.6, 0, 0.8)),
        ([(0.62, -0.78, 0.22), (0.62, -0.4, 0.26), (0.6, -0.1, 0.29), (0.35, 0.05, 0.40), (0.2, 0.12, 0.43)], 4,
         0.0045, (0.6, 0, 0.8)),
        # under the main panel, sagging between the side consoles
        ([(-0.6, 0.62, -0.55), (-0.3, 0.70, -0.58), (0.0, 0.72, -0.60), (0.3, 0.70, -0.58), (0.6, 0.62, -0.55)], 5,
         0.005, (0, 1, 0)),
        # floor run to the pedestal
        ([(-0.5, -0.6, -1.13), (-0.42, 0.0, -1.135), (-0.2, 0.3, -1.135), (-0.05, 0.42, -1.10)], 3, 0.006,
         (0, 0, -1)),
        ([(0.5, -0.6, -1.13), (0.42, 0.0, -1.135), (0.2, 0.3, -1.135), (0.05, 0.42, -1.10)], 3, 0.006, (0, 0, -1)),
    ]
    for k, (pts, n, r, sd) in enumerate(runs):
        kit.cable_loom(lm, pts, strands=n, r=r, twist=4.0, mats=loom_mix(rng, k), clamp_every=0.17, surface_dir=sd,
                       rng=rng, seg=5, step=0.03, lacing=True)
    # loose single cables with connectors behind the main panel bottom
    for k in range(5):
        x = -0.35 + k * 0.17
        a = V((x, 0.66, -0.52))
        lm.curve_pipe([a, a + V((0.02, -0.03, -0.12)), a + V((0.06 * (k % 2 - 0.5), 0.02, -0.2))], 0.004,
                      mix[k % len(mix)], res_u=4)
        kit.connector(lm, frame(a + V((0, 0, 0.005)), z=(0, 0, 1)), 0.008, 0.02)
    return lm


# ============================================================================================ seat
def build_seat(root, rng):
    sr = V(L['shell']['seatRef'])
    hr = V(L['shell']['headrest'])
    sm = geo.MeshBuilder('SEAT')
    pan_z = sr.z - 0.085
    # seat pan (contoured cushion on a metal bucket) and back
    sm.box((0.46, 0.46, 0.06), T(0, sr.y + 0.06, pan_z - 0.03) @ R('X', 7), 'MAT_SEAT', bevel=0.025, seg=3)
    sm.box((0.5, 0.5, 0.03), T(0, sr.y + 0.06, pan_z - 0.075) @ R('X', 7), 'MAT_PANEL_GREY', bevel=0.008, seg=2)
    back_bot = V((0, sr.y - 0.17, pan_z - 0.02))
    back_top = V((0, hr.y - 0.10, hr.z - 0.12))
    bd = (back_top - back_bot)
    Mb = frame((back_bot + back_top) / 2, z=(0, 1, -bd.y / bd.z * 0 + 0.12), y=bd)
    sm.box((0.46, bd.length, 0.07), Mb, 'MAT_SEAT', bevel=0.025, seg=3)
    sm.box((0.5, bd.length + 0.04, 0.03), Mb @ T(0, 0, -0.05), 'MAT_PANEL_GREY', bevel=0.008, seg=2)
    for sx in (-1, 1):
        # side bolsters (thigh + torso), seat frame rails
        sm.box((0.06, 0.4, 0.09), T(sx * 0.25, sr.y + 0.04, pan_z) @ R('X', 7), 'MAT_SEAT', bevel=0.02, seg=2)
        sm.box((0.07, 0.07, bd.length * 0.7), Mb @ T(sx * 0.255, -bd.length * 0.12, 0.02), 'MAT_SEAT', bevel=0.02,
               seg=2)
        sm.box((0.02, 0.55, 0.05), T(sx * 0.27, sr.y + 0.0, pan_z - 0.1), 'MAT_HULL_METAL', bevel=0.004, seg=1)
        for y in (sr.y - 0.18, sr.y + 0.2):
            kit.strut(sm, V((sx * 0.25, y, pan_z - 0.11)), V((sx * 0.28, y + 0.02, -1.15)), 0.018, 'MAT_HULL_METAL', seg=8)
        sm.box((0.06, 0.9, 0.025), T(sx * 0.28, sr.y + 0.05, -1.145), 'MAT_HULL_METAL', bevel=0.005, seg=1)
        kit.strut(sm, Mb @ V((sx * 0.25, -bd.length * 0.4, -0.06)), V((sx * 0.3, sr.y - 0.5, -1.15)), 0.015, seg=6)
    # headrest with side wings
    Mh = frame(V((0, hr.y - 0.045, hr.z)), z=(0, 1, 0.05), y=(0, 0, 1))
    sm.box((0.26, 0.2, 0.09), Mh, 'MAT_SEAT', bevel=0.03, seg=3)
    for sx in (-1, 1):
        sm.box((0.05, 0.18, 0.12), Mh @ T(sx * 0.14, 0, 0.04) @ R('Y', -sx * 20), 'MAT_SEAT', bevel=0.02, seg=2)
    kit.strut(sm, Mh @ V((-0.08, -0.06, -0.05)), back_top + V((-0.08, -0.04, -0.03)), 0.012, seg=6)
    kit.strut(sm, Mh @ V((0.08, -0.06, -0.05)), back_top + V((0.08, -0.04, -0.03)), 0.012, seg=6)
    # seat adjust handle (yellow/black) and survival-kit box under the pan
    sm.sweep([(0.27, sr.y + 0.15, pan_z - 0.06), (0.3, sr.y + 0.22, pan_z - 0.06), (0.3, sr.y + 0.27, pan_z - 0.02)],
             0.008, None, 'MAT_PAINT_YELLOW', seg=6)
    kit.box_unit(sm, T(0, sr.y + 0.05, -1.15), (0.36, 0.34, 0.16), 'MAT_PANEL_BLACK', rng=rng, ribs=0, connectors=1)
    # harness: shoulder straps over the pilot's shoulders down to the rotary buckle, lap belts, crotch strap
    buckle = V((0, sr.y + 0.22, sr.z + 0.07))
    for sx in (-1, 1):
        pts = [back_top + V((sx * 0.06, 0.02, -0.04)), V((sx * 0.085, -0.13, -0.17)), V((sx * 0.11, -0.03, -0.22)),
               V((sx * 0.10, 0.05, -0.40)), buckle + V((sx * 0.04, -0.02, 0.06))]
        sm.sweep(pts, 0.012, None, 'MAT_SEAT', seg=4)
        lap = [V((sx * 0.25, sr.y - 0.06, pan_z + 0.02)), V((sx * 0.20, sr.y + 0.1, sr.z + 0.06)),
               buckle + V((sx * 0.05, 0, 0))]
        sm.sweep(lap, 0.012, None, 'MAT_SEAT', seg=4)
        sm.box((0.03, 0.006, 0.05), frame(V((sx * 0.11, -0.03, -0.25)), z=(0, 1, 0.3)), 'MAT_HULL_METAL',
               bevel=0.002, seg=1)
    sm.sweep([V((0, sr.y + 0.17, pan_z + 0.0)), V((0, sr.y + 0.22, sr.z + 0.02)), buckle], 0.012, None, 'MAT_SEAT',
             seg=4)
    sm.cyl(0.04, 0.018, frame(buckle, z=(0, 1, 0.4)), 'MAT_HULL_METAL', seg=16, bevel=0.004, bseg=1)
    sm.cyl(0.022, 0.012, frame(buckle + V((0, 0.012, 0.004)), z=(0, 1, 0.4)), 'MAT_PAINT_RED', seg=12)
    return sm.to_object('SEAT', parent=root)


# ============================================================================================ controls
def toggle(c, P, root, st, guarded=False):
    cid = c['id']
    M = P.at(*c['pos'])
    rootE = core.empty(cid, M, root, 'ARROWS', 0.015)
    b = geo.MeshBuilder(cid + '_BASE')
    b.box((0.016, 0.026, 0.0012), M @ T(0, 0, 0.0006), 'MAT_PANEL_BLACK')
    b.cyl(0.0078, 0.0028, M @ T(0, 0, 0.0026), 'MAT_HULL_METAL', seg=6)
    b.cyl(0.0056, 0.006, M @ T(0, 0, 0.0055), 'MAT_HULL_METAL', seg=10)
    b.to_object(cid + '_BASE', parent=rootE, origin=M)
    piv = M @ T(0, 0, 0.004)
    rest = R('X', 25)
    m = geo.MeshBuilder(cid + '_MOV')
    Mm = piv @ rest
    m.lathe([(0.0, 0.0), (0.0024, 0.0), (0.0021, 0.012), (0.0016, 0.021), (0.0, 0.0215)], Mm, 'MAT_HULL_METAL', seg=8)
    m.sphere(0.0033, Mm @ T(0, 0, 0.023), 'MAT_HULL_METAL', seg=8, rings=5)
    mov = m.to_object(cid + '_MOV', parent=rootE, origin=Mm)
    props(mov, anim='rotate', axis='X', unit='deg', states=list(c['states']), values=[25.0, -25.0])
    if guarded:
        hinge = M @ T(0, 0.016, 0.013)
        g = geo.MeshBuilder(cid + '_GUARD')
        striped = cid == 'SW_CABIN_DUMP'
        # cover: front plate + two cheeks, hinged at the top edge, covering the lever in its rest (down) pose
        for k in range(4 if striped else 1):
            y0 = -0.034 + (0.034 / (4 if striped else 1)) * k
            hgt = 0.034 / (4 if striped else 1)
            mat = ('MAT_PAINT_RED' if k % 2 == 0 else 'MAT_PANEL_BLACK') if striped else 'MAT_PAINT_RED'
            g.box((0.026, hgt, 0.0018), hinge @ T(0, y0 + hgt / 2, 0.016), mat)
        for sx in (-1, 1):
            g.prism([(0.0, -0.012), (-0.034, -0.012), (-0.034, 0.016), (0.0, 0.016)], 0.0018,
                    hinge @ T(sx * 0.0122, 0, 0) @ frame((0, 0, 0), z=(1, 0, 0), y=(0, 0, 1)), 'MAT_PAINT_RED')
        g.cyl(0.0022, 0.03, hinge @ R('Y', 90), 'MAT_HULL_METAL', seg=8)
        gob = g.to_object(cid + '_GUARD', parent=rootE, origin=hinge)
        props(gob, anim='rotate', axis='X', unit='deg', states=['CLOSED', 'OPEN'], values=[0.0, -100.0])
        # hinge brackets on the panel
        st.box((0.004, 0.006, 0.014), hinge @ T(-0.016, 0, -0.007), 'MAT_HULL_METAL')
        st.box((0.004, 0.006, 0.014), hinge @ T(0.016, 0, -0.007), 'MAT_HULL_METAL')
        if striped:      # safety wire from the guard to a panel eyelet
            st.sweep([M @ V((0.013, -0.036, 0.004)), M @ V((0.022, -0.04, 0.008)), M @ V((0.028, -0.03, 0.002))], 0.0006,
                     None, 'MAT_HULL_METAL', seg=4)
            st.torus(0.002, 0.0006, M @ T(0.028, -0.03, 0.0015), 'MAT_HULL_METAL', seg=6, rseg=3)
    return rootE, (0.0, -0.032 if not guarded else -0.04)


def breaker(c, P, root, st):
    cid = c['id']
    M = P.at(*c['pos'])
    rootE = core.empty(cid, M, root, 'ARROWS', 0.012)
    b = geo.MeshBuilder(cid + '_BASE')
    b.cyl(0.0095, 0.004, M @ T(0, 0, 0.002), 'MAT_PANEL_BLACK', seg=12)
    b.cyl(0.0105, 0.0012, M @ T(0, 0, 0.0006), 'MAT_HULL_METAL', seg=6)
    b.to_object(cid + '_BASE', parent=rootE, origin=M)
    piv = M @ T(0, 0, 0.004)
    m = geo.MeshBuilder(cid + '_MOV')
    m.cyl(0.0058, 0.006, piv @ T(0, 0, 0.003), 'MAT_PAINT_WHITE', seg=10)
    m.cyl(0.0062, 0.0035, piv @ T(0, 0, 0.0075), 'MAT_PANEL_BLACK', seg=10, bevel=0.0008, bseg=1)
    mov = m.to_object(cid + '_MOV', parent=rootE, origin=piv)
    props(mov, anim='translate', axis='Z', unit='m', states=['IN', 'POPPED'], values=[0.0, 0.006])
    return rootE, (0.0, -0.021)


def rotary(c, P, root, st):
    cid = c['id']
    M = P.at(*c['pos'])
    s = c['size']
    big = s > 0.06
    rootE = core.empty(cid, M, root, 'ARROWS', 0.02)
    b = geo.MeshBuilder(cid + '_BASE')
    b.cyl(s * 0.62, 0.002, M @ T(0, 0, 0.001), 'MAT_PANEL_BLACK', seg=24)
    for a in c['detents']:
        Ma = M @ R('Z', a)
        b.box((0.0016, s * 0.12, 0.0008), Ma @ T(0, s * 0.53, 0.0024), 'MAT_PAINT_WHITE')
    b.cyl(s * 0.2, 0.004, M @ T(0, 0, 0.004), 'MAT_HULL_METAL', seg=6)
    b.to_object(cid + '_BASE', parent=rootE, origin=M)
    piv = M @ T(0, 0, 0.002)
    rest = R('Z', c['detents'][0])
    Mm = piv @ rest
    m = geo.MeshBuilder(cid + '_MOV')
    kr = s * (0.38 if big else 0.32)
    kh = 0.034 if big else 0.018
    if big:
        # pointer skirt + heavy knurled knob (the trust dial)
        m.lathe([(0.0, 0.003), (s * 0.5, 0.003), (s * 0.52, 0.007), (s * 0.47, 0.009), (0.0, 0.009)], Mm,
                'MAT_PANEL_BLACK', seg=32)
        m.prism([(-0.005, s * 0.42), (0.005, s * 0.42), (0.0, s * 0.56)], 0.003, Mm @ T(0, 0, 0.0075), 'MAT_PAINT_WHITE')

        def knurl(i, j):
            return 1.0 + (0.06 if i % 2 == 0 else 0.0)
        m.lathe([(kr, 0.009), (kr, 0.009 + kh * 0.85), (kr * 0.92, 0.009 + kh)], Mm, 'MAT_PANEL_BLACK', seg=40,
                rfunc=knurl)
        m.lathe([(kr * 0.92, 0.009 + kh), (0.0, 0.009 + kh)], Mm, 'MAT_PANEL_BLACK', seg=20)
        m.box((0.004, kr * 1.5, 0.003), Mm @ T(0, kr * 0.35, 0.009 + kh), 'MAT_PAINT_WHITE')
    else:
        m.lathe([(0.0, 0.002), (kr * 1.1, 0.002), (kr * 1.1, 0.005), (kr, 0.006), (kr * 0.9, 0.006 + kh),
                 (0.0, 0.006 + kh)], Mm, 'MAT_PANEL_BLACK', seg=16)
        m.box((0.003, kr * 1.4, 0.004), Mm @ T(0, kr * 0.45, 0.006 + kh * 0.6), 'MAT_PANEL_BLACK')
        m.box((0.0012, kr * 0.9, 0.0008), Mm @ T(0, kr * 0.55, 0.006 + kh + 0.0003), 'MAT_PAINT_WHITE')
    mov = m.to_object(cid + '_MOV', parent=rootE, origin=Mm)
    props(mov, anim='rotate', axis='Z', unit='deg', states=list(c['states']), values=[float(a) for a in c['detents']])
    # detent caption plates around the knob
    if c.get('detentLabels'):
        rad = s * 0.75 + (0.022 if big else 0.016)
        lw = 0.034 if big else 0.026
        for k, (a, idx) in enumerate(zip(c['detents'], c['detentLabelIndices'])):
            ar = math.radians(a)
            u, v = -math.sin(ar) * rad, math.cos(ar) * rad
            Ml = M @ T(u, v, 0)
            plate_under(st, Ml, lw, lw / 4)
            label(f'LABEL_{cid}_{k}', Ml @ T(0, 0, 0.0012), lw, idx, rootE)
    return rootE, (0.0, -(s * 0.62 + 0.012))


def valve(c, P, root, st):
    cid = c['id']
    M = P.at(*c['pos'])
    s = c['size']
    rootE = core.empty(cid, M, root, 'ARROWS', 0.02)
    b = geo.MeshBuilder(cid + '_BASE')
    b.cyl(s * 0.5, 0.004, M @ T(0, 0, 0.002), 'MAT_HULL_METAL', seg=6)
    b.lathe([(s * 0.36, 0.004), (s * 0.34, 0.016), (s * 0.24, 0.02), (0.0, 0.02)], M, 'MAT_HULL_METAL', seg=16)
    for a, mat in ((0, 'MAT_PAINT_WHITE'), (90, 'MAT_PAINT_RED')):
        b.box((0.002, s * 0.12, 0.001), M @ R('Z', -a) @ T(0, s * 0.44, 0.0045), mat)
    b.to_object(cid + '_BASE', parent=rootE, origin=M)
    piv = M @ T(0, 0, 0.02)
    m = geo.MeshBuilder(cid + '_MOV')
    hm = 'MAT_PAINT_RED' if 'O2' in cid else 'MAT_PAINT_YELLOW'
    m.cyl(s * 0.16, 0.012, piv @ T(0, 0, 0.006), 'MAT_HULL_METAL', seg=12)
    m.prism([(-s * 0.12, -s * 0.1), (s * 0.12, -s * 0.1), (s * 0.08, s * 0.85), (-s * 0.08, s * 0.85)], 0.008,
            piv @ T(0, 0, 0.012), hm, bevel=0.0015, seg=1)
    mov = m.to_object(cid + '_MOV', parent=rootE, origin=piv)
    props(mov, anim='rotate', axis='Z', unit='deg', states=list(c['states']), values=[0.0, 90.0])
    return rootE, (0.0, -(s * 0.5 + 0.011))


def button(c, P, root, st):
    cid = c['id']
    M = P.at(*c['pos'])
    s = c.get('size', 0.02)
    rootE = core.empty(cid, M, root, 'ARROWS', 0.012)
    soft = cid.startswith('BZ_')
    lit = c.get('light')
    b = geo.MeshBuilder(cid + '_BASE')
    if soft:
        b.box((s * 1.25, s * 1.0, 0.004), M @ T(0, 0, 0.002), 'MAT_PANEL_BLACK', bevel=0.0008, seg=1)
    elif s >= 0.035:
        b.box((s * 1.2, s * 1.2, 0.008), M @ T(0, 0, 0.004), 'MAT_PANEL_BLACK', bevel=0.0015, seg=1)
    else:
        b.lathe([(s * 0.7, 0.0), (s * 0.7, 0.006), (s * 0.58, 0.008), (s * 0.5, 0.008)], M, 'MAT_PANEL_BLACK', seg=16)
    b.to_object(cid + '_BASE', parent=rootE, origin=M)
    piv = M @ T(0, 0, 0.004)
    m = geo.MeshBuilder(cid + '_MOV')
    if soft:
        m.box((s * 0.95, s * 0.7, 0.004), piv @ T(0, 0, 0.002), 'MAT_PANEL_GREY', bevel=0.001, seg=1)
    elif s >= 0.035:
        m.box((s * 0.95, s * 0.95, 0.008), piv @ T(0, 0, 0.004), 'MAT_PANEL_BLACK', bevel=0.0015, seg=1)
    else:
        m.cyl(s * 0.45, 0.009, piv @ T(0, 0, 0.0045), 'MAT_PANEL_BLACK' if lit else 'MAT_PANEL_GREY', seg=16,
              bevel=0.001, bseg=1)
    mov = m.to_object(cid + '_MOV', parent=rootE, origin=piv)
    props(mov, anim='translate', axis='Z', unit='m', states=['UP', 'PRESSED'], values=[0.0, -0.004])
    if lit:
        lm = geo.MeshBuilder('LIGHT_' + cid)
        if s >= 0.035:
            lm.box((s * 0.82, s * 0.82, 0.002), piv @ T(0, 0, 0.0085), 'MAT_LIGHT')
        else:
            lm.cyl(s * 0.36, 0.002, piv @ T(0, 0, 0.0095), 'MAT_LIGHT', seg=16)
        lob = lm.to_object('LIGHT_' + cid, parent=mov, origin=piv @ T(0, 0, 0.009), weighted=False)
        props(lob, color=lit)
    return rootE, (0.0, -(s * 0.62 + 0.012))


def lever(c, P, root, st):
    cid = c['id']
    M = P.at(*c['pos'])
    s = c['size']
    rootE = core.empty(cid, M, root, 'ARROWS', 0.02)
    b = geo.MeshBuilder(cid + '_BASE')
    piv_off = -s * 0.42
    for sx in (-1, 1):
        b.prism([(-0.014, 0.0), (0.014, 0.0), (0.008, 0.03), (-0.008, 0.03)], 0.004,
                M @ T(sx * 0.014, piv_off, 0) @ frame((0, 0, 0), z=(1, 0, 0), y=(0, 0, 1)), 'MAT_HULL_METAL')
    b.box((0.05, 0.04, 0.004), M @ T(0, piv_off, 0.002), 'MAT_HULL_METAL', bevel=0.001, seg=1)
    b.box((0.024, 0.012, 0.022), M @ T(0, piv_off + s * 0.85, 0.011), 'MAT_PANEL_BLACK', bevel=0.002, seg=1)
    b.to_object(cid + '_BASE', parent=rootE, origin=M)
    piv = M @ T(0, piv_off, 0.024)
    m = geo.MeshBuilder(cid + '_MOV')
    m.cyl(0.006, 0.034, piv @ R('Y', 90), 'MAT_HULL_METAL', seg=10)
    m.box((0.014, s * 0.6, 0.008), piv @ T(0, s * 0.3, 0.0), 'MAT_HULL_METAL', bevel=0.002, seg=1)
    m.lathe([(0.0, 0.0), (0.011, 0.0), (0.012, s * 0.05), (0.012, s * 0.32), (0.009, s * 0.36), (0.0, s * 0.36)],
            piv @ T(0, s * 0.56, 0.0) @ R('X', -90), 'MAT_RUBBER', seg=10)
    mov = m.to_object(cid + '_MOV', parent=rootE, origin=piv)
    props(mov, anim='rotate', axis='X', unit='deg', states=['STOWED', 'MIN', 'MAX'], values=[0.0, -35.0, 35.0])
    return rootE, (0.05, piv_off)


def gauge(c, P, root, st):
    cid = c['id']
    M = P.at(*c['pos'])
    s = c['size']
    r = s / 2
    rootE = core.empty(cid, M, root, 'ARROWS', 0.02)
    b = geo.MeshBuilder(cid + '_BASE')
    b.lathe([(r * 1.02, 0.0), (r * 1.04, 0.01), (r * 0.98, 0.016), (r * 0.9, 0.016), (r * 0.88, 0.006),
             (0.0, 0.006)], M, ['MAT_PANEL_BLACK', 'MAT_PANEL_BLACK', 'MAT_HULL_METAL', 'MAT_PANEL_BLACK',
                                'MAT_PANEL_BLACK'], seg=24)
    sw0, sw1 = c['sweep']
    full = abs(sw1 - sw0) >= 359
    nmaj = 12 if full else 9
    for k in range(nmaj + (0 if full else 0)):
        t = k / nmaj if full else k / (nmaj - 1)
        a = sw0 + (sw1 - sw0) * t
        b.box((0.0013, r * 0.17, 0.0006), M @ R('Z', a) @ T(0, r * 0.74, 0.0063), 'MAT_PAINT_WHITE')
        if not full and k < nmaj - 1:
            a2 = sw0 + (sw1 - sw0) * (k + 0.5) / (nmaj - 1)
            b.box((0.0008, r * 0.08, 0.0006), M @ R('Z', a2) @ T(0, r * 0.78, 0.0063), 'MAT_PAINT_WHITE')
    if not full:     # red limit arc segment near the max end
        for k in range(3):
            a = sw0 + (sw1 - sw0) * (0.86 + 0.05 * k)
            b.box((0.0025, r * 0.09, 0.0006), M @ R('Z', a) @ T(0, r * 0.62, 0.0064), 'MAT_PAINT_RED')
    b.cyl(r * 0.9, 0.0015, M @ T(0, 0, 0.0125), 'MAT_GLASS', seg=24)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        b.cyl(0.0018, 0.001, M @ T(math.cos(a) * r * 1.2, math.sin(a) * r * 1.2, 0.0005), 'MAT_HULL_METAL', seg=6)
    b.to_object(cid + '_BASE', parent=rootE, origin=M)
    piv = M @ T(0, 0, 0.0075)
    Mm = piv @ R('Z', sw0)
    n = geo.MeshBuilder(cid + '_NEEDLE')
    n.prism([(-0.0011, -r * 0.18), (0.0011, -r * 0.18), (0.0004, r * 0.8), (-0.0004, r * 0.8)], 0.0008, Mm @ T(0, 0, 0.0006),
            'MAT_PAINT_AMBER')
    n.cyl(r * 0.09, 0.002, Mm @ T(0, 0, 0.001), 'MAT_PANEL_BLACK', seg=10)
    nob = n.to_object(cid + '_NEEDLE', parent=rootE, origin=Mm, weighted=False)
    props(nob, anim='rotate', axis='Z', unit='deg', sweep=[float(sw0), float(sw1)])
    return rootE, (0.0, -(r + 0.012))


PLATE_T = 0.007


def blank_plate(name, M, w, h, parent, rng, label_idx=None, stub=False):
    """Bolted Severance blanking plate: thick safety-yellow plate with a bold black hazard border, 8 washered
    bolts lock-wired in a loop that ends in a lead tamper seal and a red enforcement tag, gouged edges."""
    pb = geo.MeshBuilder(name)
    t = PLATE_T
    pb.box((w, h, t), M @ T(0, 0, t / 2), 'MAT_PAINT_YELLOW', bevel=0.0028, seg=2)
    # hazard stripes in the border band (diagonal bars)
    band = 0.02
    nstr = 8
    for side in range(4):
        horiz = side < 2
        length = w if horiz else h
        sgn = 1 if side % 2 == 0 else -1
        for k in range(nstr):
            tt = (k + 0.5) / nstr - 0.5
            p = (tt * (w - band), sgn * (h / 2 - band / 2)) if horiz else (sgn * (w / 2 - band / 2), tt * (h - band))
            pb.box((length / nstr * 0.5, band * 0.9, 0.0007), M @ T(p[0], p[1], t + 0.0002) @ R('Z', 40 if horiz else 50),
                   'MAT_PANEL_BLACK')
    # 8 bolts (corners + edge midpoints) with washers, lock-wired as one loop
    ring = []
    for x, y in ((-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)):
        p = M @ T(x * (w / 2 - 0.01), y * (h / 2 - 0.01), t)
        pb.cyl(0.0065, 0.001, p @ T(0, 0, 0.0005), 'MAT_HULL_METAL', seg=10)
        pb.hexbolt(0.005, 0.0042, p @ T(0, 0, 0.001) @ R('Z', rng.uniform(0, 60)), 'MAT_HULL_METAL', bevel=True)
        ring.append(p @ V((0, 0, 0.0038)))
    wire = []
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        wire += [a, a.lerp(b, 0.5) + (M.to_3x3() @ V((0, 0, 0.0012)))]
    pb.sweep(wire + [ring[0]], 0.0006, None, 'MAT_HULL_METAL', seg=4, caps=False)
    # lead tamper seal + red enforcement tag hanging from the wire at the lower-right bolt
    s0 = M @ V((w / 2 - 0.01, -h / 2 + 0.01, t + 0.004))
    s1 = M @ V((w / 2 + 0.004, -h / 2 - 0.006, t + 0.006))
    pb.sweep([s0, s1], 0.0006, None, 'MAT_HULL_METAL', seg=4)
    pb.cyl(0.0055, 0.0028, frame(s1, z=M.to_3x3() @ V((0, 0, 1))), 'MAT_HULL_METAL', seg=10, bevel=0.0008, bseg=1)
    pb.box((0.022, 0.036, 0.0006), M @ T(w / 2 + 0.014, -h / 2 - 0.024, t + 0.007) @ R('Z', -18), 'MAT_PAINT_RED')
    pb.box((0.014, 0.004, 0.0007), M @ T(w / 2 + 0.015, -h / 2 - 0.016, t + 0.0075) @ R('Z', -18), 'MAT_PAINT_WHITE')
    if stub:
        # where the hand-controller column passed through: a round cover boss with its own bolt circle
        pb.cyl(0.032, 0.008, M @ T(0, 0.012, t + 0.004), 'MAT_HULL_METAL', seg=24, bevel=0.002, bseg=2)
        kit.bolt_circle(pb, M @ T(0, 0.012, t + 0.008), 0.024, 6, 0.0028, 0.002)
    # pry gouges and chipped paint along the edges (bare-metal slivers)
    for k in range(9):
        side = k % 4
        if side < 2:
            q = (rng.uniform(-w * 0.42, w * 0.42), (1 if side else -1) * (h / 2 - 0.0035))
            rz = rng.uniform(-25, 25)
        else:
            q = ((1 if side == 3 else -1) * (w / 2 - 0.0035), rng.uniform(-h * 0.42, h * 0.42))
            rz = 90 + rng.uniform(-25, 25)
        pb.box((rng.uniform(0.006, 0.02), 0.0012, 0.0005), M @ T(q[0], q[1], t + 0.0001) @ R('Z', rz), 'MAT_HULL_METAL')
    return pb.to_object(name, parent=parent, origin=M)


# ============================================================================================ panels
def panel_body(st, P, depth=0.06, to_floor=False, border=0.008):
    """Solid panel: face plate with a bezel border and screws, housing behind (or down to the floor)."""
    w, h = P.w, P.h
    M = P.M
    st.box((w, h, 0.012), M @ T(0, 0, -0.006), 'MAT_PANEL_GREY', bevel=0.003, seg=2)
    st.box((w + 0.012, h + 0.012, 0.006), M @ T(0, 0, -0.012), 'MAT_PANEL_BLACK', bevel=0.002, seg=1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            st.hexbolt(0.0028, 0.0015, M @ T(sx * (w / 2 - border), sy * (h / 2 - border), 0.0), 'MAT_HULL_METAL')
    for k in range(1, int(w / 0.18)):
        x = -w / 2 + w * k / int(w / 0.18)
        for sy in (-1, 1):
            st.hexbolt(0.0024, 0.0013, M @ T(x, sy * (h / 2 - border), 0.0), 'MAT_HULL_METAL')
    if to_floor:
        # tub down to the floor: prism from the face outline projected straight down
        corners = [P.pos(-w / 2, -h / 2, -0.015), P.pos(w / 2, -h / 2, -0.015), P.pos(w / 2, h / 2, -0.015),
                   P.pos(-w / 2, h / 2, -0.015)]
        floor = [V((p.x, p.y, -1.15)) for p in corners]
        bm = st.bm
        a = [bm.verts.new(p) for p in corners]
        f_ = [bm.verts.new(p) for p in floor]
        faces = [bm.faces.new(list(reversed(a)))]
        for i in range(4):
            faces.append(bm.faces.new([a[i], a[(i + 1) % 4], f_[(i + 1) % 4], f_[i]]))
        st._finish(a + f_, faces, 'MAT_PANEL_GREY')
        bmesh.ops.recalc_face_normals(bm, faces=faces)
    else:
        st.box((w * 0.96, h * 0.96, depth), M @ T(0, 0, -depth / 2 - 0.012), 'MAT_PANEL_GREY', bevel=0.004, seg=1)


def label_for(c, P, st, rootE, offs):
    if not c.get('label') or c.get('noLabel'):
        return
    u, v = c['pos']
    w = 0.05 if len(c['label']) <= 12 else 0.062
    du, dv = offs
    M = P.at(u + du, v + dv)
    plate_under(st, M, w, w / 4)
    label('LABEL_' + c['id'], M @ T(0, 0, 0.0012), w, c['labelIndex'], rootE)


def build_panels(root, rng):
    st = geo.MeshBuilder('PANELS')
    # main panel with a deep housing; glareshield coaming; consoles and pedestal down to the floor
    panel_body(st, PNL['MAIN'], depth=0.2)
    panel_body(st, PNL['LEFT_WALL'], depth=0.1)
    panel_body(st, PNL['RIGHT_WALL'], depth=0.1)
    panel_body(st, PNL['OVERHEAD'], depth=0.06)
    panel_body(st, PNL['LEFT_CONSOLE'], to_floor=True)
    panel_body(st, PNL['RIGHT_CONSOLE'], to_floor=True)
    panel_body(st, PNL['PEDESTAL'], to_floor=True)
    G = PNL['GLARE']
    st.box((G.w, G.h, 0.01), G.M @ T(0, 0, -0.005), 'MAT_PANEL_BLACK', bevel=0.002, seg=1)
    # coaming: profile in YZ extruded across the panel width
    mt = PNL['MAIN'].pos(0, PNL['MAIN'].h / 2)
    gb, gt = G.pos(0, -G.h / 2), G.pos(0, G.h / 2)
    prof = [(gb.y, gb.z - 0.004), (gt.y, gt.z), (0.86, gt.z + 0.005), (0.9, mt.z - 0.02), (mt.y, mt.z - 0.01)]
    poly = [(y, z) for y, z in prof]                       # profile in (y, z), extruded across x
    st.prism(poly, 1.0, Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))), 'MAT_PANEL_GREY', bevel=0.006,
             seg=2)
    # padded crash coaming roll along the glareshield rear edge
    st.cyl(0.022, 0.92, T(0, gt.y - 0.01, gt.z + 0.012) @ R('Y', 90), 'MAT_SEAT', seg=12)
    # LED flood strip under the coaming lip lighting the main panel (always on)
    st.box((0.8, 0.008, 0.004), T(0, gb.y + 0.02, gb.z - 0.012), 'MAT_EMISSIVE_WARM')
    # side cheek panels joining the main panel to the consoles
    for sx in (-1, 1):
        st.prism([(0.55, -1.15), (0.98, -1.15), (0.98, -0.12), (0.74, -0.12), (0.55, -0.6)], 0.03,
                 Matrix(((0, 0, 1, sx * 0.495), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))), 'MAT_PANEL_GREY',
                 bevel=0.004, seg=1)
    # screens with recessed bezels + hoods
    for s in L['screens']:
        P = PNL[s['panel']]
        u, v = s['pos']
        w, h = s['size']
        M = P.at(u, v)
        ai = s['id'] == 'AI'
        bez = 'MAT_PAINT_AMBER' if ai else 'MAT_PANEL_BLACK'
        bw = 0.012
        for (x, y, bx, by) in ((0, h / 2 + bw / 2, w + 2 * bw, bw), (0, -h / 2 - bw / 2, w + 2 * bw, bw),
                               (-w / 2 - bw / 2, 0, bw, h), (w / 2 + bw / 2, 0, bw, h)):
            st.box((bx, by, 0.009), M @ T(x, y, 0.0045), bez, bevel=0.0015, seg=1)
        st.box((w + 0.004, h + 0.004, 0.012), M @ T(0, 0, -0.0092), 'MAT_PANEL_BLACK')
        # hood over the top edge
        st.box((w + 2 * bw, 0.022, 0.0025), M @ T(0, h / 2 + bw, 0.018) @ R('X', -35), bez, bevel=0.0008, seg=1)
        for sx in (-1, 1):
            st.box((0.0025, 0.02, 0.018), M @ T(sx * (w / 2 + bw - 0.001), h / 2 + bw - 0.004, 0.009), bez)
        for sx in (-1, 1):
            for sy in (-1, 1):
                st.hexbolt(0.0018, 0.001, M @ T(sx * (w / 2 + bw / 2), sy * (h / 2 + bw / 2), 0.009), 'MAT_HULL_METAL')
        sm = geo.MeshBuilder('SCREEN_' + s['id'])
        corners = [(-w / 2, -h / 2, 0.0015), (w / 2, -h / 2, 0.0015), (w / 2, h / 2, 0.0015), (-w / 2, h / 2, 0.0015)]
        sm.quad(corners, 'MAT_SCREEN_' + s['id'], uvs=[uv3(0, 0), uv3(1, 0), uv3(1, 1), uv3(0, 1)], M=M)
        sob = sm.to_object('SCREEN_' + s['id'], parent=root, origin=M, sharp_angle=None, weighted=False)
        props(sob, px=list(s['px']))
    # annunciator housing on the glare strip + lenses LIGHT_ANN_<id> with caption UVs
    for a in L['annunciators']:
        u, v = a['pos']
        w, h = a['size']
        M = G.at(u, v)
        st.box((w + 0.006, h + 0.006, 0.006), M @ T(0, 0, 0.003), 'MAT_PANEL_BLACK', bevel=0.001, seg=1)
        name = 'LIGHT_ANN_' + a['id'][4:]
        u0, u1, v0, v1 = cell_uv(a['labelIndex'])
        lm = geo.MeshBuilder(name)
        z = 0.0065
        lm.quad([(-w / 2, -h / 2, z), (w / 2, -h / 2, z), (w / 2, h / 2, z), (-w / 2, h / 2, z)], 'MAT_LIGHT',
                uvs=[uv3(u0, v0), uv3(u1, v0), uv3(u1, v1), uv3(u0, v1)], M=M)
        lob = lm.to_object(name, parent=root, origin=M, sharp_angle=None, weighted=False)
        props(lob, color=a['color'])
    return st


def build_controls(root, st, rng):
    fn = {'toggle': toggle, 'toggle_guarded': lambda c, P, r, s: toggle(c, P, r, s, guarded=True), 'breaker': breaker,
          'rotary': rotary, 'valve': valve, 'button': button, 'lever': lever, 'gauge': gauge}
    for c in L['controls']:
        P = PNL[c['panel']]
        t = c['type']
        if t in fn:
            rootE, offs = fn[t](c, P, root, st)
            if t == 'toggle' or t == 'toggle_guarded':
                offs = (0.0, -0.034 if t == 'toggle' else -0.045)
            label_for(c, P, st, rootE, offs)
        elif t == 'static':     # BLANK_PLATE_THR
            M = P.at(*c['pos'])
            w, h = c['size'], c['size'] * 1.2
            ob = blank_plate(c['id'], M, w, h, root, rng)
            plate_under(st, M @ T(0, -0.012, PLATE_T + 0.0002), 0.096, 0.024, 'MAT_PANEL_BLACK')
            label('LABEL_' + c['id'], M @ T(0, -0.012, PLATE_T + 0.0014), 0.096, c['labelIndex'], ob)
            # the throttle quadrant's old harness: capped stub cables beside the plate
            for k in range(2):
                a = M @ V((w / 2 + 0.012, -0.02 + k * 0.02, 0.0))
                st.curve_pipe([a, a + P.n * 0.025 + P.right * 0.006, a + P.n * 0.04 + P.up * 0.01 * (k - 0.5)], 0.003,
                              'MAT_CABLE_BLACK', res_u=3)
                st.cyl(0.0042, 0.012, frame(a + P.n * 0.04 + P.up * 0.01 * (k - 0.5), z=P.n), 'MAT_PAINT_RED', seg=8)
        elif t == 'item':
            build_item(c, P, root, st, rng)


def build_item(c, P, root, st, rng):
    cid = c['id']
    u, v = c['pos']
    if cid == 'PATCH_KIT':
        M = P.at(u, v, 0.0)
        pb = geo.MeshBuilder(cid)
        f = pb.box((0.14, 0.12, 0.05), M @ T(0, 0, 0.026), 'MAT_HIVIS', bevel=0.012, seg=3)
        pb.box((0.142, 0.05, 0.054), M @ T(0, 0.04, 0.028), 'MAT_HIVIS', bevel=0.01, seg=2)   # flap
        for x in (-0.045, 0.045):
            pb.box((0.018, 0.13, 0.054), M @ T(x, 0, 0.0275), 'MAT_SEAT', bevel=0.003, seg=1)  # straps
            pb.box((0.016, 0.014, 0.004), M @ T(x, -0.03, 0.055), 'MAT_HULL_METAL')
        ob = pb.to_object(cid, parent=root, origin=M)
        dm = geo.MeshBuilder(cid + '_DISC')
        Md = M @ T(0.02, 0.055, 0.03) @ R('X', -70)
        dm.cyl(0.05, 0.004, Md, 'MAT_HULL_METAL', seg=20, bevel=0.0012, bseg=1)
        dm.torus(0.046, 0.003, Md @ T(0, 0, 0.002), 'MAT_RUBBER', seg=20, rseg=3)
        dm.cyl(0.012, 0.01, Md @ T(0, 0, 0.006), 'MAT_PANEL_BLACK', seg=10)
        dm.to_object(cid + '_DISC', parent=ob, origin=Md)
        Ml = P.at(u - 0.105, v + 0.02)
        plate_under(st, Ml, 0.05, 0.0125)
        label('LABEL_' + cid, Ml @ T(0, 0, 0.0012), 0.05, c['labelIndex'], ob)
        # wall strap anchors
        for x in (-0.045, 0.045):
            st.box((0.024, 0.01, 0.006), P.at(u + x, v + 0.068, 0.003), 'MAT_HULL_METAL')
    elif cid == 'CO2_CART':
        v2 = v - 0.025
        M = P.at(u, v2, 0.04)
        cm = geo.MeshBuilder(cid)
        cm.lathe([(0.0, -0.09), (0.03, -0.09), (0.035, -0.085), (0.035, 0.08), (0.028, 0.09), (0.012, 0.092),
                  (0.012, 0.1), (0.0, 0.1)], M @ R('X', -90), ['MAT_HULL_METAL', 'MAT_HULL_METAL', 'MAT_PAINT_WHITE',
                                                              'MAT_HULL_METAL', 'MAT_HULL_METAL', 'MAT_HULL_METAL',
                                                              'MAT_HULL_METAL'], seg=16)
        cm.torus(0.0355, 0.0025, M @ T(0, 0.05, 0) @ R('X', 90), 'MAT_PAINT_YELLOW', seg=16, rseg=3)
        ob = cm.to_object(cid, parent=root, origin=M)
        clip = geo.MeshBuilder(cid + '_CLIP')
        Mw = P.at(u, v2, 0.0)
        clip.box((0.05, 0.16, 0.006), Mw @ T(0, 0, 0.003), 'MAT_PANEL_BLACK', bevel=0.0015, seg=1)
        for y in (-0.05, 0.05):
            clip.torus(0.037, 0.0035, Mw @ T(0, y, 0.04) @ R('X', 90), 'MAT_HULL_METAL', seg=16, rseg=3, arc=200)
        clip.to_object(cid + '_CLIP', parent=root, origin=Mw)
        Ml = P.at(u, v2 - 0.105)
        plate_under(st, Ml, 0.05, 0.0125)
        label('LABEL_' + cid, Ml @ T(0, 0, 0.0012), 0.05, c['labelIndex'], ob)


def build_placards(root, st):
    """PLACARD_<id> backing plate + LABEL_PLACARD_<id> engraved face, near the item named in `near`."""
    where = {
        'PLACARD_DOCTRINE': (PNL['PEDESTAL'], (0.0, 0.112), 0.07),
        'PLACARD_TALLY': (PNL['OVERHEAD'], (0.0, -0.085), 0.07),
        'PLACARD_O2': (PNL['RIGHT_WALL'], (-0.07, 0.112), 0.07),
        'PLACARD_AI': (PNL['MAIN'], (0.118, 0.137), 0.064),
        'PLACARD_RAW': (PNL['MAIN'], (-0.355, 0.137), 0.064),
    }
    for p in L['placards']:
        pid = p['id']
        if pid == 'PLACARD_STICK':
            bp = L['blankPlateStick']
            n = V(bp['normal']).normalized()
            M = frame(V(bp['pos']) + V((0, -0.128, -0.07)), z=(0, -1, 0.15), y=(0, 0, 1))
            w = 0.07
        else:
            P, (u, v), w = where[pid]
            M = P.at(u, v)
        pm = geo.MeshBuilder(pid)
        amber = pid == 'PLACARD_AI'
        pm.box((w + 0.008, w / 4 + 0.006, 0.002), M @ T(0, 0, 0.001), 'MAT_PAINT_AMBER' if amber else 'MAT_HULL_METAL',
               bevel=0.0008, seg=1)
        for x in (-w / 2 - 0.002, w / 2 + 0.002):
            pm.cyl(0.0014, 0.0008, M @ T(x, 0, 0.0024), 'MAT_HULL_METAL', seg=6)
        ob = pm.to_object(pid, parent=root, origin=M)
        label('LABEL_' + pid, M @ T(0, 0, 0.002), w, p['labelIndex'], ob)


# ============================================================================================ build
def stencil(mb, M, rows, h=0.006, mat='MAT_PAINT_WHITE', rng=None):
    """Stencilled text block as geometry: rows of word-length bars (reads as lettering on a noisy camera feed;
    contract text lives in the label atlas, these are the anonymous maintenance stencils)."""
    rng = rng or random.Random(3)
    y = 0.0
    for words in rows:
        x = 0.0
        tot = sum(words) * h * 0.75 + (len(words) - 1) * h * 0.6
        x = -tot / 2
        for n in words:
            ln = n * h * 0.75
            # letters as separate narrow blocks with small gaps (stencil bridges)
            for k in range(n):
                mb.box((h * 0.6, h, 0.0004), M @ T(x + k * h * 0.75 + h * 0.3, y, 0.0002), mat)
            x += ln + h * 0.6
        y -= h * 1.6


def hazard_tape(mb, M, length, width=0.022, n=None):
    """Yellow/black chevron tape strip along local X."""
    n = n or max(3, int(length / 0.03))
    mb.box((length, width, 0.0005), M @ T(0, 0, 0.00025), 'MAT_PAINT_YELLOW')
    for k in range(n):
        x = -length / 2 + (k + 0.5) * length / n
        mb.box((length / n * 0.42, width * 1.12, 0.0006), M @ T(x, 0, 0.0004) @ R('Z', 45), 'MAT_PANEL_BLACK')


def build_clutter(planes, rng):
    """Second dressing pass: conduit and looms on walls/ceiling, stringers, padding, life-support hardware,
    stencils, hazard tape, checklist, extinguisher. Everything is snapped onto the shell planes."""
    cl = geo.MeshBuilder('CLUTTER')
    mix = ('MAT_CABLE_GREY', 'MAT_CABLE_BLACK', 'MAT_CABLE_GREY', 'MAT_CABLE_RED', 'MAT_CABLE_BLACK', 'MAT_CABLE_YELLOW')

    def on(p, off=0.0):
        q, n = snap(planes, V(p))
        return q + n * off, n

    # ---- rigid conduit (metal tube) runs with saddle clamps
    conduits = [
        [(-0.70, -0.79, -0.02), (-0.70, -0.40, -0.03), (-0.70, 0.10, -0.03), (-0.69, 0.14, -0.14)],
        [(0.70, -0.79, -0.02), (0.70, -0.40, -0.03), (0.70, 0.10, -0.03), (0.69, 0.14, -0.14)],
        [(-0.06, -0.80, 0.30), (-0.06, -0.62, 0.45), (-0.06, -0.30, 0.50), (-0.06, 0.10, 0.50)],
        [(0.24, -0.80, -1.10), (0.24, -0.80, -0.40), (0.24, -0.79, 0.20), (0.26, -0.65, 0.42)],
        [(-0.24, -0.80, -1.10), (-0.24, -0.80, -0.40), (-0.24, -0.79, 0.20), (-0.26, -0.65, 0.42)],
    ]
    for run in conduits:
        pts, ns = zip(*[on(p, 0.016) for p in run])
        kit.pipe_run(cl, list(pts), 0.008, 'MAT_HULL_METAL', clamp_every=0.14, surface_dir=-ns[1], bracket_len=0.004)
    # ---- more looms: across the ceiling on the frame line, aft wall, down beside the seat
    looms = [
        ([(-0.5, -0.12, 0.40), (-0.3, -0.12, 0.50), (0.0, -0.12, 0.51), (0.3, -0.12, 0.50), (0.5, -0.12, 0.40)], 5),
        ([(-0.6, -0.79, 0.12), (-0.2, -0.80, 0.14), (0.2, -0.80, 0.14), (0.6, -0.79, 0.12)], 4),
        ([(0.55, -0.79, 0.1), (0.62, -0.6, -0.2), (0.6, -0.45, -0.7), (0.5, -0.3, -1.1)], 4),
        ([(-0.55, -0.79, 0.1), (-0.62, -0.6, -0.25), (-0.6, -0.45, -0.75), (-0.5, -0.3, -1.1)], 4),
    ]
    for k, (run, n) in enumerate(looms):
        pts, ns = zip(*[on(p, 0.022) for p in run])
        kit.cable_loom(cl, list(pts), strands=n, r=0.005, twist=4.5, mats=loom_mix(rng, k + 3), clamp_every=0.15,
                       surface_dir=-ns[1], rng=rng, seg=5, step=0.03, lacing=True)
    # ---- junction boxes where looms meet
    for p, sz in (((-0.70, -0.55, 0.10), (0.12, 0.09, 0.05)), ((0.70, -0.58, 0.10), (0.12, 0.09, 0.05)),
                  ((0.0, -0.80, 0.14), (0.16, 0.1, 0.05))):
        q, n = on(p)
        kit.box_unit(cl, frame(q, z=n, y=(0, 0, 1) if abs(n.z) < 0.7 else (0, 1, 0)), sz, 'MAT_PANEL_BLACK', rng=rng,
                     ribs=0, connectors=3)
        stencil(cl, frame(q + n * (sz[2] + 0.0005), z=n, y=(0, 0, 1) if abs(n.z) < 0.7 else (0, 1, 0)) @ T(0, 0.02, 0),
                [(3, 2), (4,)], 0.005, 'MAT_PAINT_YELLOW')
    # ---- longitudinal stringers (riveted hat-section bars) on side walls and ceiling, aft of the windows
    for sx in (-1, 1):
        for z in (-0.62, -0.30, 0.16):
            a, n = on((sx * 0.72, -0.80, z), 0.006)
            b, _ = on((sx * 0.72, 0.12 if z < 0 else -0.02, z), 0.006)
            d = b - a
            cl.box((d.length, 0.024, 0.012), frame((a + b) / 2, z=n, x=d), 'MAT_PANEL_GREY', bevel=0.002, seg=1)
            for k in range(int(d.length / 0.09)):
                cl.cyl(0.0022, 0.0012, frame(a + d * ((k + 0.5) / int(d.length / 0.09)) + n * 0.0066, z=n),
                       'MAT_HULL_METAL', seg=5)
    for sx in (-0.26, 0.26):
        a, n = on((sx, -0.62, 0.52), 0.006)
        b, _ = on((sx, 0.30, 0.52), 0.006)
        d = b - a
        cl.box((d.length, 0.024, 0.012), frame((a + b) / 2, z=n, x=d), 'MAT_PANEL_GREY', bevel=0.002, seg=1)

    # ---- extra quilted padding: lower side walls beside the seat, ceiling bay between frames
    def quilt(M, w, h, nx, ny, depth=0.022):
        def z(x, y):
            u = (x / w + 0.5) * nx
            v = (y / h + 0.5) * ny
            pu = math.sin(math.pi * (u % 1.0))
            pv = math.sin(math.pi * (v % 1.0))
            edge = min(1.0, 6 * min(x / w + 0.5, 0.5 - x / w, y / h + 0.5, 0.5 - y / h))
            return depth * (0.35 + 0.65 * (pu * pv) ** 0.6) * edge
        cl.grid(w, h, nx * 3, ny * 3, M, 'MAT_SEAT', zfunc=z)
    for sx in (-1, 1):
        q, n = on((sx * 0.72, -0.55, -0.80), 0.002)
        quilt(frame(q, z=n, y=(0, 0, 1)), 0.42, 0.28, 3, 2)
    q, n = on((0.0, -0.22, 0.52), 0.002)
    quilt(frame(q, z=n, y=(0, 1, 0)), 0.42, 0.22, 4, 2)
    # ---- CO2 scrubber housing (aft right, low) with hoses up to the cabin fan
    q, n = on((0.72, -0.66, -0.55))
    Ms = frame(q, z=n, y=(0, 0, 1))
    cl.box((0.2, 0.34, 0.14), Ms @ T(0, 0, 0.07), 'MAT_PANEL_GREY', bevel=0.006, seg=2)
    cl.box((0.17, 0.12, 0.004), Ms @ T(0, 0.08, 0.142), 'MAT_PANEL_BLACK', bevel=0.002, seg=1)
    for y in (-0.13, 0.13):
        cl.box((0.03, 0.02, 0.016), Ms @ T(0.11, y, 0.09), 'MAT_HULL_METAL', bevel=0.002, seg=1)
    cl.box((0.05, 0.012, 0.012), Ms @ T(0, -0.06, 0.146), 'MAT_PAINT_YELLOW')
    stencil(cl, Ms @ T(0, -0.11, 0.1405), [(4, 3), (6,)], 0.006, 'MAT_PAINT_WHITE')
    hose = [Ms @ V((0.0, 0.17, 0.07)), Ms @ V((0.0, 0.28, 0.05)), on((0.66, -0.66, 0.05), 0.04)[0],
            on((0.3, -0.66, 0.42), 0.04)[0]]
    cl.curve_pipe(hose, 0.018, 'MAT_RUBBER', res_u=5)
    for p in hose[1:3]:
        cl.torus(0.021, 0.004, frame(p, z=(hose[2] - hose[1])), 'MAT_HULL_METAL', seg=12, rseg=3)
    # ---- cabin fan with grille on the aft roof slope + eyeball air vents near the face
    q, n = on((0.0, -0.62, 0.45))
    Mf = frame(q, z=n, y=(0, 1, 0))
    cl.cyl(0.075, 0.03, Mf @ T(0, 0, 0.015), 'MAT_PANEL_BLACK', seg=20, bevel=0.004, bseg=1)
    for r in (0.025, 0.045, 0.065):
        cl.torus(r, 0.0025, Mf @ T(0, 0, 0.031), 'MAT_HULL_METAL', seg=20, rseg=3)
    for k in range(4):
        cl.box((0.13, 0.004, 0.003), Mf @ T(0, 0, 0.031) @ R('Z', 45 * k), 'MAT_HULL_METAL')
    for p in ((-0.22, 0.05, 0.52), (0.22, 0.05, 0.52), (-0.5, 0.5, -0.06), (0.5, 0.5, -0.06)):
        q, n = on(p)
        Mv = frame(q, z=n)
        cl.cyl(0.026, 0.008, Mv @ T(0, 0, 0.004), 'MAT_PANEL_BLACK', seg=14)
        cl.sphere(0.018, Mv @ T(0, 0, 0.008) @ R('X', 20), 'MAT_HULL_METAL', seg=12, rings=6, z0=-0.2, z1=0.9)
        cl.cyl(0.009, 0.004, Mv @ T(0, 0, 0.026) @ R('X', 20), 'MAT_PANEL_BLACK', seg=10)
    # ---- fire extinguisher in a strap bracket (aft left)
    q, n = on((-0.72, -0.70, -0.50))
    Me = frame(q + n * 0.06, z=(0, 0, 1), x=n)
    cl.lathe([(0.0, -0.17), (0.045, -0.17), (0.05, -0.15), (0.05, 0.11), (0.035, 0.15), (0.015, 0.16), (0.015, 0.19),
              (0.0, 0.19)], Me, ['MAT_PAINT_RED', 'MAT_PAINT_RED', 'MAT_PAINT_RED', 'MAT_PAINT_RED', 'MAT_HULL_METAL',
                                 'MAT_HULL_METAL', 'MAT_HULL_METAL'], seg=16)
    cl.box((0.05, 0.016, 0.03), Me @ T(0.02, 0, 0.2), 'MAT_PANEL_BLACK', bevel=0.003, seg=1)
    cl.sweep([Me @ V((0.0, 0.0, 0.2)), Me @ V((-0.04, 0.0, 0.21)), Me @ V((-0.055, 0.02, 0.14))], 0.005, None,
             'MAT_RUBBER', seg=6)
    for z in (-0.09, 0.07):
        cl.torus(0.053, 0.004, Me @ T(0, 0, z), 'MAT_HULL_METAL', seg=16, rseg=3, arc=220)
    cl.box((0.04, 0.12, 0.3), frame(q + n * 0.004, z=n, y=(0, 0, 1)), 'MAT_HULL_METAL', bevel=0.003, seg=1)
    stencil(cl, frame(q + n * 0.0085, z=n, y=(0, 0, 1)) @ T(0, 0.18, 0), [(4,), (3, 2)], 0.007, 'MAT_PAINT_RED')
    # ---- checklist clipboard on the left wall (pages fanned under a spring clip, pen on a cord)
    q, n = on((-0.72, -0.22, -0.18))
    Mc = frame(q + n * 0.004, z=n, y=(0, 0, 1)) @ R('Z', 4)
    cl.box((0.16, 0.22, 0.004), Mc @ T(0, 0, 0.002), 'MAT_DARK_COMPOSITE', bevel=0.002, seg=1)
    for k in range(4):
        cl.box((0.14, 0.2, 0.0012), Mc @ T(0.002 * k, -0.006 - 0.003 * k, 0.0046 + 0.0013 * k) @ R('Z', -1.5 * k),
               'MAT_PAINT_WHITE')
        if k == 3:
            for j in range(9):
                cl.box((rng.uniform(0.05, 0.11), 0.003, 0.0004), Mc @ T(-0.05 + 0.03 * rng.random(), 0.06 - j * 0.017, 0.0096),
                       'MAT_PANEL_BLACK')
    cl.box((0.07, 0.022, 0.012), Mc @ T(0, 0.1, 0.012), 'MAT_HULL_METAL', bevel=0.003, seg=2)
    cl.cyl(0.004, 0.13, Mc @ T(0.09, -0.02, 0.012) @ R('X', 90), 'MAT_PANEL_BLACK', seg=6)
    cl.curve_pipe([Mc @ V((0.09, 0.045, 0.012)), Mc @ V((0.11, 0.08, 0.02)), Mc @ V((0.06, 0.11, 0.016))], 0.0015,
                  'MAT_CABLE_RED', res_u=4)
    # ---- O2 mask stowage cup + stencil
    q, n = on((0.72, -0.12, -0.04))
    Mo = frame(q, z=n, y=(0, 0, 1))
    cl.lathe([(0.055, 0.0), (0.06, 0.07), (0.056, 0.072), (0.05, 0.004)], Mo, 'MAT_PANEL_BLACK', seg=16)
    hazard_tape(cl, Mo @ T(0, 0.085, 0.0005), 0.14, 0.018)
    stencil(cl, Mo @ T(0, -0.085, 0.0005), [(2, 4)], 0.008, 'MAT_PAINT_YELLOW')
    # ---- hazard tape on edges people kick or hit: heel rest, stick plinth front, seat pan front
    hazard_tape(cl, frame(V((0, 0.5, -1.155)), z=(0, 0, 1)), 0.5, 0.025)
    hazard_tape(cl, frame(V((0, 0.06, -1.155)), z=(0, 0, 1)), 0.22, 0.025)
    for sx in (-1, 1):
        hazard_tape(cl, frame(V((sx * 0.56, 0.2, -0.505)), z=(0, 0, 1), x=(0, 1, 0)), 0.3, 0.016)
    # ---- maintenance stencils around the cabin
    for p, rows, h, mat in (((0.0, -0.80, -0.55), [(5, 3), (2, 6, 4)], 0.009, 'MAT_PAINT_WHITE'),
                            ((-0.72, -0.62, 0.0), [(6,), (3, 5)], 0.007, 'MAT_PAINT_WHITE'),
                            ((0.72, -0.30, -0.95), [(4, 2, 4)], 0.008, 'MAT_PAINT_YELLOW'),
                            ((0.0, -0.40, 0.52), [(7, 3)], 0.008, 'MAT_PAINT_WHITE'),
                            ((-0.30, 0.6, -1.155), [(2, 4)], 0.012, 'MAT_PAINT_YELLOW')):
        q, n = on(p, 0.001)
        stencil(cl, frame(q, z=n, y=(0, 0, 1) if abs(n.z) < 0.7 else (0, 1, 0)), rows, h, mat)
    # inspection tags / stickers on panel bodies
    for p, mat in (((-0.47, 0.0, -0.64), 'MAT_PAINT_YELLOW'), ((0.3, 0.71, -0.43), 'MAT_PAINT_WHITE'),
                   ((0.55, -0.02, -0.38), 'MAT_PAINT_YELLOW')):
        cl.box((0.03, 0.02, 0.0006), frame(V(p), z=(0, -0.5, 0.9)), mat)
    # ---- extra handholds: above both side windows, and vertical bars on the windscreen posts
    for sx in (-1, 1):
        a, na = on((sx * 0.62, 0.20, 0.33))
        b, nb = on((sx * 0.62, 0.47, 0.33))
        cl.sweep([a, a + na * 0.05, b + nb * 0.05, b], 0.01, None, 'MAT_PAINT_YELLOW', seg=8)
        for pnt, nn in ((a, na), (b, nb)):
            cl.cyl(0.018, 0.01, frame(pnt + nn * 0.005, z=nn), 'MAT_HULL_METAL', seg=8)
    return cl


def build():
    rng = random.Random(5101)
    root = core.empty('COCKPIT', size=0.3)
    core.empty('EYE', Matrix.Identity(4), root, 'SPHERE', 0.02)
    sr = V(L['shell']['seatRef'])
    core.empty('SEAT_REF', T(sr), root, 'ARROWS', 0.1)
    core.empty('HEADREST', T(V(L['shell']['headrest'])), root, 'PLAIN_AXES', 0.05)

    wins, planes, det = build_shell(root, rng)
    st = build_panels(root, rng)
    build_controls(root, st, rng)
    build_placards(root, st)

    # stick blanking plate on a floor plinth (where the pre-Severance hand controller stood)
    bp = L['blankPlateStick']
    n = V(bp['normal']).normalized()
    Mb = frame(V(bp['pos']) + V((0, -0.02, 0)), z=n, y=(0, 1, 0))
    hw = bp['size'] * 0.5 + 0.014
    top = [Mb @ V((x, y, -0.004)) for x, y in ((-hw, -hw), (hw, -hw), (hw, hw), (-hw, hw))]
    bot = [V((p.x * 1.15, p.y + (0.02 if i in (2, 3) else -0.02), -1.15)) for i, p in enumerate(top)]
    bm = det.bm
    a = [bm.verts.new(p) for p in top]
    b = [bm.verts.new(p) for p in bot]
    faces = [bm.faces.new(a)] + [bm.faces.new([a[i], b[i], b[(i + 1) % 4], a[(i + 1) % 4]]) for i in range(4)]
    det._finish(a + b, faces, 'MAT_PANEL_GREY')
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    blank_plate('BLANK_PLATE_STICK', Mb, bp['size'], bp['size'], root, rng, stub=True)

    # interior cameras: Camera + dome housing + always-on tally lamp
    for cam in L['cameras']:
        pos, tgt = V(cam['pos']), V(cam['target'])
        core.camera('CAM_' + cam['id'], pos, tgt, cam['fov'], root, clip=(0.02, 50.0))
        d = (tgt - pos).normalized()
        if cam['id'] == 'PILOT':       # hangs from the windscreen header between FWD_C and TOP
            base, inward = pos + V((0, 0.6, 0.8)).normalized() * 0.05, -V((0, 0.6, 0.8)).normalized()
        else:
            base, inward = snap(planes, pos)
        dm = geo.MeshBuilder('CAMDOME_' + cam['id'])
        Mbase = frame(base, z=inward)
        dm.cyl(0.045, 0.012, Mbase @ T(0, 0, 0.006), 'MAT_PANEL_BLACK', seg=16, bevel=0.003, bseg=1)
        if (pos - base).length > 0.03:
            kit.strut(dm, base + inward * 0.01, pos - d * 0.02, 0.012, 'MAT_PANEL_BLACK', seg=8)
        Md = frame(pos, z=d)
        dm.cyl(0.026, 0.02, Md @ T(0, 0, -0.012), 'MAT_PANEL_BLACK', seg=14)
        dm.sphere(0.03, Md, 'MAT_GLASS', seg=16, rings=6, z0=0.0, z1=1.0)
        dm.torus(0.03, 0.003, Md, 'MAT_HULL_METAL', seg=16, rseg=3)
        dm.to_object('CAMDOME_' + cam['id'], parent=root, origin=Md)
        tl = geo.MeshBuilder('LIGHT_TALLY_' + cam['id'])
        Mt = Mbase @ T(0.033, 0.0, 0.014)
        tl.sphere(0.0055, Mt, 'MAT_LIGHT', seg=10, rings=4, z0=0.0, z1=1.0)
        tob = tl.to_object('LIGHT_TALLY_' + cam['id'], parent=root, origin=Mt, weighted=False)
        props(tob, color='red', always_on=True)

    # lamp anchors (+ fixtures), leak / arc / sound empties
    for lp in L['lamps']:
        pos = V(lp['pos'])
        if lp['kind'] == 'spot':
            M = core.look_frame(pos, V(lp['target']))
        else:
            M = T(pos)
        core.empty('LAMP_' + lp['id'], M, root, 'CONE' if lp['kind'] == 'spot' else 'SPHERE', 0.03,
                   props={'kind': lp['kind']})
        wall, inward = snap(planes, pos)
        if (wall - pos).length > 0.14:
            continue                    # free-floating lamp positions (PANEL, PEDESTAL): anchor only
        fx = geo.MeshBuilder('LIGHT_LAMP_' + lp['id'])
        if lp['kind'] == 'spot':
            fx.lathe([(0.0, -0.035), (0.018, -0.035), (0.024, 0.0), (0.02, 0.0)], M @ R('X', 180), 'MAT_PANEL_BLACK',
                     seg=12)
            fx.cyl(0.019, 0.002, M @ T(0, 0, -0.001), 'MAT_LIGHT', seg=12)
            kit.strut(det, M @ V((0, 0, 0.035)), wall, 0.008, 'MAT_HULL_METAL', seg=6)
        else:
            Mf = frame(wall + inward * 0.004, z=inward)
            fx.cyl(0.04, 0.01, Mf, 'MAT_PANEL_BLACK', seg=16, bevel=0.002, bseg=1)
            fx.sphere(0.03, Mf @ T(0, 0, 0.005), 'MAT_LIGHT', seg=16, rings=4, z0=0.0, z1=0.6)
        fob = fx.to_object('LIGHT_LAMP_' + lp['id'], parent=root, weighted=False)
        props(fob, lamp=lp['id'])
    for lk in L['leakSites']:
        p = V(lk['pos'])
        core.empty(lk['id'], frame(p, z=nearest_plane_normal(planes, p)), root, 'SINGLE_ARROW', 0.05)
    for a in L['arcSites']:
        core.empty('ARC_' + a['id'], T(V(a['pos'])), root, 'PLAIN_AXES', 0.04)
    for s in L['sounds']:
        core.empty('SND_' + s['id'], T(V(s['pos'])), root, 'SPHERE', 0.04)

    # emergency O2 mask in a wall clip near the right side window, hose to a wall regulator
    om = geo.MeshBuilder('O2_MASK')
    Mm = frame(V((0.64, -0.05, 0.02)), z=(-1, 0.1, 0.1), y=(0, 0, 1))
    om.lathe([(0.0, 0.055), (0.012, 0.055), (0.03, 0.045), (0.042, 0.02), (0.046, 0.0), (0.04, -0.004)], Mm, 'MAT_RUBBER',
             seg=16)
    om.torus(0.043, 0.005, Mm @ T(0, 0, -0.002), 'MAT_SUIT_DARK', seg=16, rseg=4)
    om.sweep([Mm @ V((0.0, 0.0, 0.055)), V((0.62, -0.15, 0.02)), V((0.63, -0.2, -0.1)), V((0.66, -0.25, -0.16))], 0.007,
             None, 'MAT_CABLE_GREY', seg=6)
    om.box((0.08, 0.06, 0.035), frame(V((0.68, -0.27, -0.18)), z=(-1, 0, 0)), 'MAT_PANEL_BLACK', bevel=0.004, seg=1)
    om.cyl(0.012, 0.03, frame(V((0.655, -0.27, -0.165)), z=(-1, 0, 0)), 'MAT_PAINT_RED', seg=10)
    om.torus(0.05, 0.004, Mm @ T(0, 0, 0.02), 'MAT_HULL_METAL', seg=16, rseg=3, arc=220)
    om.to_object('O2_MASK', parent=root)

    lm = build_looms(rng)
    build_clutter(planes, rng).to_object('CLUTTER', parent=root)
    lm.to_object('LOOMS', parent=root)
    seat = build_seat(root, rng)
    st.to_object('PANELS', parent=root)
    det.to_object('SHELL_DETAIL', parent=root)
    core.finalize()
    core.join([core.bpy.data.objects['SHELL'], core.bpy.data.objects['SHELL_DETAIL']], 'SHELL')
    return {'root': root, 'cameras': True,
            'masks': dict(ao_dist=0.35, crevice=0.012, samples=20, wear_gain=1.4, wear_noise=0.05),
            'preview': {'camera': {'loc': (0.0, -0.05, 0.03), 'target': (0.0, 0.7, -0.38), 'fov': 72},
                        'sun_dir': (-0.35, 0.8, 0.6), 'energy': 4.0, 'samples': 32,
                        'points': [((0.0, -0.25, 0.45), 6.0), ((0.0, 0.35, -0.2), 3.0), ((-0.42, 0.25, 0.3), 2.0),
                                   ((0.42, 0.25, 0.3), 2.0)]}}
