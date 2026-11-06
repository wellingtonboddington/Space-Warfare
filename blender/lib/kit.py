"""Reusable greeble / kit-part library. Every part is real geometry added to a MeshBuilder.

Convention: `M` is the part frame (4x4). For surface-mounted parts local +Z is the outward surface normal
and the part sits on z = 0. Functions return useful frames/points (nozzle exits, muzzles) where relevant.
"""
import math
import random
from mathutils import Vector, Matrix
from . import core
from .core import T, R, S, frame

V = Vector


# ------------------------------------------------------------------------------------------- basics
def strut(mb, p0, p1, r, mat='MAT_HULL_METAL', seg=8, ends=0.0, end_mat=None):
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    L = d.length
    if L < 1e-6:
        return []
    M = frame((p0 + p1) / 2, z=d)
    f = mb.cyl(r, L, M, mat, seg=seg, caps=True)
    if ends > 0:
        for p, s in ((p0, 1), (p1, -1)):
            Me = frame(p + d.normalized() * (s * ends * 0.5), z=d)
            f += mb.cyl(r * 1.6, ends, Me, end_mat or mat, seg=min(seg, 6))
    return f


def bolt_row(mb, M, p0, p1, n, r=0.006, h=0.004, mat='MAT_HULL_METAL'):
    p0, p1 = V(p0), V(p1)
    for i in range(n):
        t = 0.5 if n == 1 else i / (n - 1)
        mb.hexbolt(r, h, M @ T(p0.lerp(p1, t)) @ R('Z', 15 * i), mat)


def bolt_rect(mb, M, w, h, pitch, inset, r=0.006, hh=0.004, z=0.0, mat='MAT_HULL_METAL'):
    """Bolts around a rectangle perimeter (centred, local XY), at height z."""
    x0, x1 = -w / 2 + inset, w / 2 - inset
    y0, y1 = -h / 2 + inset, h / 2 - inset
    nx = max(2, int(round((x1 - x0) / pitch)) + 1)
    ny = max(2, int(round((y1 - y0) / pitch)) + 1)
    Mz = M @ T(0, 0, z)
    bolt_row(mb, Mz, (x0, y0, 0), (x1, y0, 0), nx, r, hh, mat)
    bolt_row(mb, Mz, (x0, y1, 0), (x1, y1, 0), nx, r, hh, mat)
    if ny > 2:
        dy = (y1 - y0) / (ny - 1)
        bolt_row(mb, Mz, (x0, y0 + dy, 0), (x0, y1 - dy, 0), ny - 2, r, hh, mat)
        bolt_row(mb, Mz, (x1, y0 + dy, 0), (x1, y1 - dy, 0), ny - 2, r, hh, mat)


def bolt_circle(mb, M, radius, n, r=0.006, hh=0.004, z=0.0, mat='MAT_HULL_METAL', phase=0.0):
    for i in range(n):
        a = phase + math.tau * i / n
        mb.hexbolt(r, hh, M @ T(radius * math.cos(a), radius * math.sin(a), z) @ R('Z', math.degrees(a)), mat)


def access_panel(mb, M, w, h, t=0.012, mat='MAT_HULL_PAINT', bolt_mat='MAT_HULL_METAL', pitch=0.2, bolt_r=0.006,
                 handle=False, latch=False, recess=False, seg=1):
    """Bolted access cover: bevelled plate proud of the surface, perimeter fasteners, optional grab handle."""
    f = mb.box((w, h, t), M @ T(0, 0, t / 2), mat, bevel=min(t * 0.45, 0.006), seg=seg)
    if recess:
        # shallow raised stiffener cross on top
        mb.box((w * 0.8, h * 0.06, t * 0.5), M @ T(0, 0, t + t * 0.25), mat, bevel=t * 0.2, seg=1)
    bolt_rect(mb, M, w, h, pitch, max(bolt_r * 2.2, 0.012), bolt_r, bolt_r * 0.7, z=t, mat=bolt_mat)
    if handle:
        hw = min(w * 0.5, 0.18)
        pts = [(-hw / 2, 0, t), (-hw / 2, 0, t + 0.035), (hw / 2, 0, t + 0.035), (hw / 2, 0, t)]
        mb.sweep(pts, 0.006, M, bolt_mat, seg=6)
    if latch:
        mb.box((0.03, 0.05, 0.008), M @ T(w / 2 - 0.03, 0, t + 0.004), 'MAT_PANEL_BLACK', bevel=0.002, seg=1)
    return f


def handrail(mb, M, length, standoff=0.06, r=0.011, feet=2, mat='MAT_PAINT_YELLOW'):
    """EVA handrail along local X, feet down to the surface (z=0)."""
    pts = [(-length / 2, 0, 0.0), (-length / 2, 0, standoff), (length / 2, 0, standoff), (length / 2, 0, 0.0)]
    mb.sweep(pts, r, M, mat, seg=6)
    for i in range(feet):
        x = -length / 2 + length * i / max(1, feet - 1)
        mb.box((0.04, 0.03, 0.006), M @ T(x, 0, 0.003), 'MAT_HULL_METAL')


def tie_down(mb, M, r=0.025, mat='MAT_HULL_METAL'):
    """Tether/tie-down point: base plate + D-ring."""
    mb.cyl(r * 1.3, 0.006, M @ T(0, 0, 0.003), mat, seg=8, bevel=0.002, bseg=1)
    mb.torus(r * 0.75, r * 0.18, M @ T(0, 0, r * 0.8) @ R('X', 90), mat, seg=12, rseg=5)


def pipe_run(mb, pts, r, mat='MAT_HULL_METAL', clamp_every=0.45, clamp_mat='MAT_HULL_METAL', surface_dir=None,
             bracket_len=None, res_u=4, seg_res=1):
    """Pipe through control points (curve + bevel depth -> mesh) with clamp bands and stand-off brackets.
    surface_dir: world vector from the pipe toward the mounting surface (brackets drop that way)."""
    mb.curve_pipe(pts, r, mat, bevel_res=seg_res, res_u=res_u)
    P = [V(p) for p in pts]
    # walk the polyline placing clamps
    total = sum((P[i + 1] - P[i]).length for i in range(len(P) - 1))
    if clamp_every <= 0 or total < clamp_every * 0.8:
        return
    n = max(1, int(total / clamp_every))
    for k in range(n):
        s = (k + 0.5) * total / n
        acc = 0.0
        for i in range(len(P) - 1):
            L = (P[i + 1] - P[i]).length
            if acc + L >= s:
                t = (s - acc) / max(L, 1e-9)
                p = P[i].lerp(P[i + 1], t)
                d = (P[i + 1] - P[i]).normalized()
                Mc = frame(p, z=d)
                mb.torus(r * 1.18, r * 0.28, Mc, clamp_mat, seg=8, rseg=3)
                if surface_dir is not None:
                    sd = V(surface_dir).normalized()
                    bl = bracket_len if bracket_len is not None else r * 2.5
                    q = p + sd * (r + bl / 2)
                    Mb = frame(q, z=sd, y=d)
                    mb.box((r * 1.6, r * 1.2, bl), Mb, clamp_mat)
                    mb.box((r * 4, r * 2.2, r * 0.5), frame(p + sd * (r + bl), z=sd, y=d), clamp_mat)
                break
            acc += L


def _resample(pts, step):
    P = [V(p) for p in pts]
    out = [P[0]]
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        L = (b - a).length
        n = max(1, int(math.ceil(L / step)))
        for k in range(1, n + 1):
            out.append(a.lerp(b, k / n))
    return out


def _smooth_path(pts, iters=2):
    P = [V(p) for p in pts]
    for _ in range(iters):
        Q = [P[0]]
        for i in range(len(P) - 1):
            Q.append(P[i].lerp(P[i + 1], 0.25))
            Q.append(P[i].lerp(P[i + 1], 0.75))
        Q.append(P[-1])
        P = Q
    return P


def cable_loom(mb, pts, strands=5, r=0.0045, twist=5.0, mats=('MAT_CABLE_BLACK', 'MAT_CABLE_GREY', 'MAT_CABLE_RED',
               'MAT_CABLE_YELLOW'), clamp_every=0.16, clamp_mat='MAT_HULL_METAL', surface_dir=None, rng=None,
               seg=6, step=0.03, lacing=True):
    """Twisted multi-strand cable bundle along a path, with P-clamps (band + tab) and lacing ties.
    twist: turns per metre. surface_dir: toward the wall (clamp tabs screw down that way)."""
    rng = rng or random.Random(1)
    P = _resample(_smooth_path(pts, 2), step)
    n = len(P)
    tans = []
    for i in range(n):
        a = P[max(i - 1, 0)]
        b = P[min(i + 1, n - 1)]
        tans.append((b - a).normalized())
    nrm = core._any_perp(tans[0])
    frames = []
    for i in range(n):
        if i > 0:
            ax = tans[i - 1].cross(tans[i])
            if ax.length > 1e-9:
                nrm = Matrix.Rotation(tans[i - 1].angle(tans[i]), 3, ax.normalized()) @ nrm
            nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
        frames.append((nrm.copy(), tans[i].cross(nrm)))
    bundle_r = r * (1.0 if strands == 1 else 1.0 / math.sin(math.pi / strands)) if strands > 1 else 0.0
    arc = [0.0]
    for i in range(1, n):
        arc.append(arc[-1] + (P[i] - P[i - 1]).length)
    for s in range(strands):
        ph = math.tau * s / strands
        rr = r * rng.uniform(0.75, 1.15)
        sp = []
        for i in range(n):
            a = ph + math.tau * twist * arc[i]
            nn, bb = frames[i]
            sp.append(P[i] + (nn * math.cos(a) + bb * math.sin(a)) * bundle_r)
        mb.sweep(sp, rr, None, mats[s % len(mats)], seg=seg)
    # clamps
    if clamp_every > 0:
        total = arc[-1]
        k = clamp_every * 0.5
        while k < total:
            i = min(range(n), key=lambda j: abs(arc[j] - k))
            Mc = frame(P[i], z=tans[i])
            outer = bundle_r + r * 1.25
            mb.torus(outer, r * 0.45, Mc, clamp_mat, seg=8, rseg=3)
            if surface_dir is not None:
                sd = V(surface_dir).normalized()
                tab = P[i] + sd * (outer + 0.008)
                mb.box((0.018, 0.012, 0.004), frame(tab, z=sd, y=tans[i]), clamp_mat, bevel=0.0012, seg=1)
                mb.hexbolt(0.003, 0.002, frame(tab + sd * 0.002, z=-sd), 'MAT_HULL_METAL')
            k += clamp_every
        if lacing:
            k = clamp_every
            while k < total - 0.02:
                i = min(range(n), key=lambda j: abs(arc[j] - k))
                mb.torus(bundle_r + r * 1.05, r * 0.22, frame(P[i], z=tans[i]), 'MAT_CABLE_BLACK', seg=8, rseg=3)
                k += clamp_every


def connector(mb, M, r=0.012, length=0.03, mat='MAT_HULL_METAL', boot_mat='MAT_RUBBER', cable=None):
    """Circular mil-spec connector: flange, knurled coupling ring, backshell, boot; pointing local +Z."""
    mb.box((r * 2.6, r * 2.6, 0.003), M @ T(0, 0, 0.0015), mat)
    mb.lathe([(r, 0.003), (r, 0.003 + length * 0.33), (r * 1.18, 0.003 + length * 0.36),
              (r * 1.18, 0.003 + length * 0.58), (r * 0.85, 0.003 + length * 0.6), (r * 0.6, 0.003 + length),
              (0.0, 0.003 + length)], M, [mat, mat, mat, mat, boot_mat, boot_mat], seg=8)
    if cable:
        mb.sweep(cable, r * 0.45, M, 'MAT_CABLE_BLACK', seg=6)


def umbilical_port(mb, M, w=0.26, h=0.18, mat='MAT_DARK_COMPOSITE', rng=None):
    """Recessed umbilical plate: frame, 3 connectors, dust caps on lanyards, keying pins."""
    rng = rng or random.Random(3)
    mb.box((w, h, 0.012), M @ T(0, 0, 0.006), 'MAT_HULL_METAL', bevel=0.004, seg=2)
    mb.box((w * 0.86, h * 0.8, 0.006), M @ T(0, 0, 0.014), mat, bevel=0.002, seg=1)
    xs = [-w * 0.28, 0.0, w * 0.28]
    for i, x in enumerate(xs):
        rr = 0.022 if i != 1 else 0.03
        connector(mb, M @ T(x, -h * 0.05, 0.017), rr, 0.03)
        # dust cap hanging on a lanyard
        cap = M @ T(x + rr * 1.6, -h * 0.32, 0.02) @ R('X', 70)
        mb.cyl(rr * 1.1, 0.012, cap, 'MAT_RUBBER', seg=8)
    mb.cyl(0.004, 0.02, M @ T(-w * 0.42, h * 0.3, 0.025), 'MAT_HULL_METAL', seg=6)
    mb.cyl(0.004, 0.02, M @ T(w * 0.42, h * 0.3, 0.025), 'MAT_HULL_METAL', seg=6)
    bolt_rect(mb, M, w, h, 0.06, 0.012, 0.004, 0.003, z=0.012)


def valve(mb, M, size=0.06, kind='wheel', mat='MAT_HULL_METAL', handle_mat='MAT_PAINT_RED'):
    """Inline valve body (pipe along local X) with bonnet up +Z and a handwheel or lever."""
    s = size
    mb.cyl(s * 0.42, s * 1.6, M @ R('Y', 90), mat, seg=10)
    for x in (-s * 0.8, s * 0.8):
        mb.cyl(s * 0.55, s * 0.12, M @ T(x, 0, 0) @ R('Y', 90), mat, seg=10)
        bolt_circle(mb, M @ T(x + (s * 0.06 if x > 0 else -s * 0.06), 0, 0) @ R('Y', 90 if x > 0 else -90),
                    s * 0.45, 4, s * 0.06, s * 0.04, phase=math.pi / 4)
    mb.cyl(s * 0.3, s * 0.6, M @ T(0, 0, s * 0.55), mat, seg=10)
    mb.cyl(s * 0.36, s * 0.12, M @ T(0, 0, s * 0.85), mat, seg=6)
    if kind == 'wheel':
        mb.torus(s * 0.55, s * 0.06, M @ T(0, 0, s * 1.0), handle_mat, seg=12, rseg=4)
        for k in range(3):
            a = math.tau * k / 3
            mb.box((s * 0.55, s * 0.06, s * 0.05), M @ T(math.cos(a) * s * 0.27, math.sin(a) * s * 0.27, s * 1.0)
                   @ R('Z', math.degrees(a)), handle_mat)
        mb.cyl(s * 0.1, s * 0.12, M @ T(0, 0, s * 1.0), mat, seg=8)
    else:
        mb.box((s * 1.1, s * 0.16, s * 0.08), M @ T(s * 0.45, 0, s * 0.98), handle_mat, bevel=s * 0.03, seg=2)


def star_tracker(mb, M, r=0.055, baffle=0.22, mat='MAT_DARK_COMPOSITE'):
    """Star tracker: electronics box + conical sun baffle with internal vane rings, boresight local +Z."""
    mb.box((r * 2.6, r * 2.2, r * 1.4), M @ T(0, 0, r * 0.7), mat, bevel=0.004, seg=2)
    base = r * 1.4
    prof = [(r * 0.8, base), (r * 0.8, base + 0.02), (r * 1.0, base + 0.03), (r * 1.85, base + baffle),
            (r * 1.75, base + baffle), (r * 0.92, base + 0.035), (r * 0.7, base + 0.03)]
    mb.lathe(prof, M, mat, seg=14)
    for k in range(1, 3):
        z = base + baffle * k / 3.5
        rr = r * (1.0 + 0.85 * (z - base) / baffle)
        mb.lathe([(rr * 0.96, z), (rr * 0.8, z + 0.003)], M, mat, seg=14)
    mb.cyl(r * 0.55, 0.004, M @ T(0, 0, base + 0.03), 'MAT_GLASS', seg=10)
    connector(mb, M @ T(r * 1.3, 0, r * 0.7) @ R('Y', 90), 0.008, 0.02)


def whip_antenna(mb, M, length=0.8, r=0.006, mat='MAT_HULL_METAL'):
    mb.cyl(0.03, 0.04, M @ T(0, 0, 0.02), 'MAT_DARK_COMPOSITE', seg=8, bevel=0.004, bseg=1)
    mb.cyl(0.012, 0.05, M @ T(0, 0, 0.065), 'MAT_HULL_METAL', seg=8)
    mb.cyl(r, length, M @ T(0, 0, 0.09 + length / 2), mat, seg=6, r2=r * 0.5)
    mb.sphere(r * 1.6, M @ T(0, 0, 0.09 + length), mat, seg=6, rings=3)


def patch_antenna(mb, M, w=0.16, mat='MAT_DARK_COMPOSITE'):
    mb.box((w, w, 0.014), M @ T(0, 0, 0.007), mat, bevel=0.003, seg=1)
    mb.box((w * 0.7, w * 0.7, 0.004), M @ T(0, 0, 0.016), 'MAT_PANEL_BLACK', bevel=0.001, seg=1)
    bolt_rect(mb, M, w, w, w, 0.01, 0.0035, 0.002, z=0.014)


def dish(mb, M, R_=0.45, depth=0.12, mat='MAT_RADIATOR', back_mat='MAT_HULL_METAL', feed=True, struts=3,
         seg=20):
    """Parabolic reflector opening along local +Z, vertex on z=0, rim + back ribs + feed on struts."""
    prof_front, prof_back = [], []
    n = 7
    for k in range(n + 1):
        rr = R_ * k / n
        z = depth * (rr / R_) ** 2
        prof_front.append((rr, z))
        prof_back.append((rr, z - 0.012 - 0.01 * (1 - rr / R_)))
    mb.lathe(list(reversed(prof_front))[::2] + [prof_front[0]], M, mat, seg=seg)
    mb.lathe(prof_back[::2] + [prof_back[-1]], M, back_mat, seg=seg)
    mb.lathe([(R_ * 1.0, depth), (R_ * 1.02, depth - 0.006), (R_ * 1.0, depth - 0.024)], M, back_mat, seg=seg)
    for k in range(6):
        a = math.tau * k / 6
        p0 = V((math.cos(a) * R_ * 0.15, math.sin(a) * R_ * 0.15, -0.02))
        p1 = V((math.cos(a) * R_ * 0.95, math.sin(a) * R_ * 0.95, depth - 0.03))
        strut(mb, M @ p0, M @ p1, 0.008, back_mat, seg=4)
    mb.cyl(R_ * 0.18, 0.08, M @ T(0, 0, -0.05), back_mat, seg=12, bevel=0.006, bseg=1)
    if feed:
        fz = depth + R_ * R_ / (4 * depth) * 0.55
        for k in range(struts):
            a = math.tau * k / struts + 0.3
            strut(mb, M @ V((math.cos(a) * R_ * 0.92, math.sin(a) * R_ * 0.92, depth * 0.95)),
                  M @ V((0, 0, fz)), 0.006, back_mat, seg=4)
        mb.lathe([(0.0, fz + 0.06), (0.03, fz + 0.06), (0.03, fz), (0.055, fz - 0.05), (0.05, fz - 0.052)], M,
                 'MAT_DARK_COMPOSITE', seg=10)


def nozzle(mb, M, r_throat, r_exit, length, mat='MAT_ENGINE_BELL', seg=12, wall=0.004):
    """Small bell nozzle, exit toward local +Z, throat at z=0 (outer and inner wall)."""
    prof = []
    n = 3
    for k in range(n + 1):
        t = k / n
        rr = r_throat + (r_exit - r_throat) * (1 - (1 - t) ** 1.8)
        prof.append((rr + wall, length * t))
    inner = [(r - wall, z) for r, z in reversed(prof)]
    mb.lathe([(r_throat * 1.4, -length * 0.15)] + prof + [(prof[-1][0] - wall * 0.5, length + wall * 0.3)]
             + inner + [(r_throat * 0.4, -length * 0.05)], M, mat, seg=seg)
    return M @ T(0, 0, length)


def rcs_quad(mb, M, size=0.16, mat='MAT_HULL_METAL', body_mat='MAT_DARK_COMPOSITE', dirs=None):
    """RCS quad: housing on a standoff with up to 4 nozzles. Local frame: +Z away from the hull.
    dirs: list of local exhaust directions (default: +X, -X, +Y, -Y). Returns world frames (local +Z = exhaust)."""
    s = size
    dirs = dirs or [V((1, 0, 0)), V((-1, 0, 0)), V((0, 1, 0)), V((0, -1, 0))]
    # standoff + base plate
    mb.box((s * 1.3, s * 1.3, 0.012), M @ T(0, 0, 0.006), 'MAT_HULL_METAL')
    mb.cyl(s * 0.28, s * 0.6, M @ T(0, 0, s * 0.3), mat, seg=8)
    hz = s * 0.6 + s * 0.4
    mb.box((s, s, s * 0.75), M @ T(0, 0, hz), body_mat, bevel=s * 0.08, seg=1)
    mb.box((s * 1.04, s * 1.04, s * 0.12), M @ T(0, 0, hz + s * 0.25), 'MAT_HULL_METAL')
    # propellant feed lines
    mb.curve_pipe([M @ V((s * 0.2, s * 0.2, 0.01)), M @ V((s * 0.35, s * 0.3, s * 0.3)),
                   M @ V((s * 0.32, s * 0.32, hz - s * 0.3))], 0.006, 'MAT_HULL_METAL', bevel_res=1, res_u=3)
    out = []
    for d in dirs:
        d = V(d).normalized()
        base = V((0, 0, hz)) + d * (s * 0.5)
        Mn = frame(M @ base, z=(M.to_3x3() @ d))
        ex = nozzle(mb, Mn @ T(0, 0, s * 0.02), s * 0.05, s * 0.15, s * 0.32, 'MAT_ENGINE_BELL', seg=8, wall=0.003)
        out.append(ex)
    return out


def vent(mb, M, r=0.03, mat='MAT_HULL_METAL'):
    """Vent outlet: flange, short pipe, flared exit with guard ring, pointing local +Z. Returns exit frame."""
    mb.cyl(r * 2.2, 0.008, M @ T(0, 0, 0.004), mat, seg=10)
    bolt_circle(mb, M, r * 1.75, 4, 0.004, 0.003, z=0.008, phase=0.4)
    mb.lathe([(r, 0.0), (r, 0.06), (r * 1.6, 0.1), (r * 1.5, 0.102), (r * 0.85, 0.064), (r * 0.85, 0.0)], M,
             mat, seg=10)
    mb.torus(r * 1.6, r * 0.12, M @ T(0, 0, 0.1), 'MAT_PAINT_YELLOW', seg=10, rseg=3)
    return M @ T(0, 0, 0.1)


def box_unit(mb, M, size, mat='MAT_DARK_COMPOSITE', rng=None, ribs=0, connectors=2, handles=False,
             rib_mat=None, bevel=None):
    """Avionics/equipment box on z=0: bevelled case, cooling fins on +Z, connectors on -Y face, handles."""
    rng = rng or random.Random(0)
    sx, sy, sz = size
    b = bevel if bevel is not None else min(sx, sy, sz) * 0.06
    mb.box((sx, sy, sz), M @ T(0, 0, sz / 2), mat, bevel=b, seg=1)
    if ribs:
        for i in range(ribs):
            x = -sx * 0.4 + sx * 0.8 * i / max(1, ribs - 1)
            mb.box((min(0.008, sx * 0.03), sy * 0.86, sz * 0.12), M @ T(x, 0, sz + sz * 0.06), rib_mat or mat)
    for k in range(connectors):
        x = -sx * 0.3 + sx * 0.6 * (k / max(1, connectors - 1) if connectors > 1 else 0.5)
        rr = rng.uniform(0.008, 0.014)
        connector(mb, M @ T(x, -sy / 2, sz * 0.5) @ R('X', 90), rr, 0.025)
    if handles:
        for x in (-sx * 0.35, sx * 0.35):
            mb.sweep([(x, -sy / 2, sz * 0.25), (x, -sy / 2 - 0.03, sz * 0.25), (x, -sy / 2 - 0.03, sz * 0.75),
                      (x, -sy / 2, sz * 0.75)], 0.005, M, 'MAT_HULL_METAL', seg=6)
    # corner fasteners on the lid
    for sxn in (-1, 1):
        for syn in (-1, 1):
            mb.hexbolt(0.004, 0.003, M @ T(sxn * (sx / 2 - 0.012), syn * (sy / 2 - 0.012), sz), 'MAT_HULL_METAL')


def stencil_plate(mb, M, w=0.12, h=0.05, mat='MAT_HULL_METAL'):
    mb.box((w, h, 0.002), M @ T(0, 0, 0.001), mat, bevel=0.0006, seg=1)
    for x in (-w / 2 + 0.006, w / 2 - 0.006):
        mb.cyl(0.0025, 0.0015, M @ T(x, 0, 0.0025), mat, seg=6)


def light_beacon(mb, M, r=0.025, lens_mat='MAT_LIGHT', mat='MAT_DARK_COMPOSITE'):
    mb.cyl(r * 1.4, 0.015, M @ T(0, 0, 0.0075), mat, seg=10, bevel=0.003, bseg=1)
    mb.sphere(r, M @ T(0, 0, 0.015), lens_mat, seg=10, rings=4, z0=0.0, z1=1.0)
    mb.torus(r * 1.05, 0.0025, M @ T(0, 0, 0.02 + r * 0.3), 'MAT_HULL_METAL', seg=10, rseg=3)


def hinge(mb, M, length, r=0.02, knuckles=5, mat='MAT_HULL_METAL'):
    """Knuckle hinge along local Y centred on origin (axis = local Y)."""
    for k in range(knuckles):
        y = -length / 2 + length * (k + 0.5) / knuckles
        mb.cyl(r, length / knuckles * 0.9, M @ T(0, y, 0) @ R('X', 90), mat, seg=8)
    mb.cyl(r * 0.45, length * 1.04, M @ R('X', 90), mat, seg=6)


# ------------------------------------------------------------------------------------------- tanks
def tank_sphere(mb, M, r, mat='MAT_HULL_METAL', seg=28, rings=14, straps=True, strap_mat='MAT_HULL_METAL',
                mli=None, rng=None):
    """Spherical tank: two hemispheres with an equatorial girth weld + mount ring, meridian weld seams,
    polar bosses with fill/drain fittings, optional straps. Local Z = polar axis."""
    rng = rng or random.Random(5)
    f = mb.sphere(r, M, mli or mat, seg=seg, rings=rings)
    if mli:
        mb.wrinkle(f, r * 0.012, r * 0.18, seed=rng.random() * 10)
    # equatorial girth ring (the structural mount) + weld bead either side
    mb.lathe([(r * 1.0, -0.035), (r * 1.045, -0.03), (r * 1.06, -0.012), (r * 1.06, 0.012), (r * 1.045, 0.03),
              (r * 1.0, 0.035)], M, strap_mat, seg=seg)
    for z in (-0.045, 0.045):
        mb.torus(r * math.cos(math.asin(z / r)) + 0.002, 0.006, M @ T(0, 0, z), 'MAT_HULL_METAL', seg=seg, rseg=3)
    # mount tabs on the girth ring
    for k in range(8):
        a = math.tau * k / 8 + math.pi / 8
        Mt = M @ R('Z', math.degrees(a)) @ T(r * 1.08, 0, 0)
        mb.box((0.05, 0.035, 0.07), Mt, strap_mat)
    if not mli:
        # meridian weld seams (gore welds) on each hemisphere
        for k in range(3):
            a = math.tau * k / 3 + 0.25
            pts = []
            for j in range(1, 7):
                el = math.radians(8 + 74 * j / 6)
                pts.append((r * 1.002 * math.cos(el) * math.cos(a), r * 1.002 * math.cos(el) * math.sin(a),
                            r * 1.002 * math.sin(el)))
            mb.sweep(pts, 0.0045, M, 'MAT_HULL_METAL', seg=3, caps=False)
            mb.sweep([(x, y, -z) for x, y, z in pts], 0.0045, M, 'MAT_HULL_METAL', seg=3, caps=False)
    # polar bosses
    for s in (1, -1):
        Mp = M @ (R('X', 180) if s < 0 else Matrix.Identity(4))
        mb.lathe([(r * 0.16, r * 0.985), (r * 0.17, r * 1.0), (r * 0.14, r * 1.05), (r * 0.08, r * 1.06),
                  (r * 0.06, r * 1.12), (0.0, r * 1.12)], Mp, 'MAT_HULL_METAL', seg=12)

    if straps:
        for a in (0.0, 90.0):
            Ms = M @ R('Z', a) @ R('X', 90)
            mb.torus(r * 1.012, 0.012, Ms, strap_mat, seg=seg, rseg=3)
    return f


def tank_cyl(mb, M, r, length, mat='MAT_HULL_METAL', seg=28, dome=0.6, welds=3, stringers=0, mli=None, rng=None,
             end_fittings=True):
    """Cylindrical tank along local Z (centred): ellipsoidal domes, circumferential welds, optional
    stringers or an MLI wrap."""
    rng = rng or random.Random(9)
    h = length / 2
    prof = []
    for k in range(7, -1, -1):
        a = math.pi / 2 * k / 7
        prof.append((r * math.cos(a), -h - dome * r * math.sin(a) + dome * r))
    prof = [(0.0 if p[0] < 1e-6 else p[0], p[1]) for p in prof]
    mid = []
    nmid = max(2, welds + 1)
    for k in range(1, nmid):
        mid.append((r, -h + dome * r + (2 * h - 2 * dome * r) * k / nmid))
    top = [(rr, -z) for rr, z in reversed(prof)]
    full = prof + mid + top
    f = mb.lathe(full, M, mli or mat, seg=seg)
    if mli:
        mb.wrinkle(f, r * 0.01, r * 0.2, seed=rng.random() * 10)
    zs = [-h + dome * r, h - dome * r] + [z for _, z in mid]
    for z in zs:
        mb.torus(r * 1.004, 0.007 if not mli else 0.012, M @ T(0, 0, z), 'MAT_HULL_METAL', seg=seg, rseg=4)
    if stringers:
        for k in range(stringers):
            a = math.tau * k / stringers
            Ms = M @ R('Z', math.degrees(a)) @ T(r * 1.01, 0, 0)
            mb.box((0.02, 0.03, 2 * h - 2 * dome * r), Ms, 'MAT_HULL_METAL', bevel=0.003, seg=1)
    if end_fittings:
        for s in (1, -1):
            Mp = M @ (R('X', 180) if s < 0 else Matrix.Identity(4))
            ztop = h - dome * r + dome * r
            mb.lathe([(r * 0.2, ztop - 0.01), (r * 0.2, ztop + 0.02), (r * 0.1, ztop + 0.05), (r * 0.06, ztop + 0.12),
                      (0.0, ztop + 0.12)], Mp, 'MAT_HULL_METAL', seg=14)
    return f


# ------------------------------------------------------------------------------------------- structure
def truss(mb, p0, p1, w, bays, r_long=0.03, r_diag=0.016, mat='MAT_HULL_METAL', up=(0, 0, 1), nodes=True):
    """Square box truss between p0 and p1 (centreline), width w: longerons, battens, alternating diagonals,
    node fittings."""
    p0, p1 = V(p0), V(p1)
    ax = (p1 - p0)
    L = ax.length
    Mf = frame(p0, z=ax, y=V(up))
    cs = [(-w / 2, -w / 2), (w / 2, -w / 2), (w / 2, w / 2), (-w / 2, w / 2)]
    for x, y in cs:
        strut(mb, Mf @ V((x, y, 0)), Mf @ V((x, y, L)), r_long, mat, seg=8)
    for b in range(bays + 1):
        z = L * b / bays
        for i in range(4):
            x0, y0 = cs[i]
            x1, y1 = cs[(i + 1) % 4]
            strut(mb, Mf @ V((x0, y0, z)), Mf @ V((x1, y1, z)), r_diag * 1.1, mat, seg=5)
            if nodes:
                mb.box((r_long * 3.0, r_long * 3.0, r_long * 3.0), Mf @ T(x0, y0, z), mat)
        if b < bays:
            z1 = L * (b + 1) / bays
            for i in range(4):
                x0, y0 = cs[i]
                x1, y1 = cs[(i + 1) % 4]
                if (b + i) % 2 == 0:
                    strut(mb, Mf @ V((x0, y0, z)), Mf @ V((x1, y1, z1)), r_diag, mat, seg=5)
                else:
                    strut(mb, Mf @ V((x1, y1, z)), Mf @ V((x0, y0, z1)), r_diag, mat, seg=5)


def radiator_panel(mb, M, span, chord, t=0.03, tubes=10, mat='MAT_RADIATOR', frame_mat='MAT_HULL_METAL',
                   header=True, tip_cap=True):
    """Radiator panel in local frame: hinge line = local Y axis at x=0, panel extends +X by `span`,
    chord along Y (centred), thickness along Z. Fluid tubes run spanwise as raised ridges on both faces,
    fed by a header manifold along the hinge edge."""
    x0 = 0.12 if header else 0.0
    w = span - x0
    f = mb.box((w, chord, t), M @ T(x0 + w / 2, 0, 0), mat, bevel=0.004, seg=1)
    # edge frame (spar) around the panel
    for y in (-chord / 2, chord / 2):
        mb.box((w, 0.04, t * 1.5), M @ T(x0 + w / 2, y, 0), frame_mat, bevel=0.006, seg=2)
    if tip_cap:
        mb.box((0.04, chord + 0.04, t * 1.5), M @ T(span - 0.02, 0, 0), frame_mat, bevel=0.006, seg=2)
    # tubes on both faces
    for i in range(tubes):
        y = -chord / 2 + chord * (i + 0.5) / tubes
        for zs in (1, -1):
            mb.cyl(0.011, w - 0.08, M @ T(x0 + w / 2, y, zs * t / 2) @ R('Y', 90), mat, seg=5, caps=False)
    # cross ribs every ~0.8 m
    nrib = max(1, int(w / 0.8))
    for k in range(1, nrib + 1):
        x = x0 + w * k / (nrib + 1)
        for zs in (1, -1):
            mb.box((0.025, chord, 0.008), M @ T(x, 0, zs * (t / 2 + 0.004)), frame_mat)
    if header:
        mb.cyl(0.045, chord + 0.02, M @ T(x0 * 0.55, 0, 0) @ R('X', 90), frame_mat, seg=12, bevel=0.006, bseg=1)
        mb.cyl(0.03, chord * 0.98, M @ T(x0 * 0.55, 0, 0.05) @ R('X', 90), frame_mat, seg=10)
        for i in range(tubes):
            y = -chord / 2 + chord * (i + 0.5) / tubes
            mb.cyl(0.009, x0 * 0.6, M @ T(x0 * 0.75, y, 0) @ R('Y', 90), frame_mat, seg=6)
    return f


def mli_box(mb, M, size, mat='MAT_MLI_GOLD', amp=0.008, scale=0.12, seed=0.0, cuts=4, tape=True):
    """Box wrapped in a crinkled multi-layer-insulation blanket with tape seams. Base on z=0."""
    sx, sy, sz = size
    f = mb.box((sx, sy, sz), M @ T(0, 0, sz / 2), mat, bevel=min(sx, sy, sz) * 0.08, seg=2)
    f = mb.subdivide(f, cuts)
    mb.wrinkle(f, amp, scale, seed)
    if tape:
        tm = 'MAT_MLI_SILVER' if mat == 'MAT_MLI_GOLD' else 'MAT_MLI_GOLD'
        mb.box((sx * 1.01, 0.03, sz * 1.01), M @ T(0, sy * 0.18, sz / 2), tm, bevel=0.002, seg=1)
        mb.box((0.03, sy * 1.01, 0.004), M @ T(-sx * 0.22, 0, sz + 0.004), tm, bevel=0.001, seg=1)
    return f


def mli_wrap(mb, faces, amp=0.008, scale=0.12, seed=0.0, cuts=2):
    f = mb.subdivide(faces, cuts)
    mb.wrinkle(f, amp, scale, seed)
    return f


def regen_bell(mb, M, r_throat, r_exit, length, tubes=72, chamber_r=None, chamber_len=0.35, mat='MAT_ENGINE_BELL'):
    """Regeneratively cooled engine: combustion chamber, throat, bell whose skin is made of brazed coolant
    tubes (radial ridges), inlet manifold torus at the exit, injector dome. Exhaust toward local -Z.
    Throat at z=0. Returns exit-centre frame (local +Z = exhaust direction)."""
    cr = chamber_r or r_throat * 1.7
    seg = tubes * 2

    def ridge(i, j):
        return 1.0 + (0.012 if i % 2 == 0 else -0.004)

    # bell outer (tube skin) from throat to exit, going -Z
    prof = []
    nb = 9
    for k in range(nb + 1):
        t = k / nb
        rr = r_throat + (r_exit - r_throat) * (1 - (1 - t) ** 2.1) * (0.92 + 0.08 * t)
        prof.append((rr, -length * t))
    outer = mb.lathe(prof, M, mat, seg=seg, rfunc=ridge)
    # inner wall (seen looking up the nozzle) - smooth, slightly inside
    inner = [(r * 0.985, z) for r, z in reversed(prof)]
    mb.lathe([(prof[-1][0] * 1.012, prof[-1][1] - 0.004)] + inner[::2] + [inner[-1]], M, mat, seg=tubes)
    # chamber + converging section above the throat
    mb.lathe([(r_throat, 0.0), (r_throat * 1.25, chamber_len * 0.25), (cr, chamber_len * 0.55), (cr, chamber_len),
              (cr * 0.85, chamber_len + 0.05), (cr * 0.5, chamber_len + 0.11), (0.0, chamber_len + 0.13)], M,
             'MAT_HULL_METAL', seg=32)
    # exit manifold + mid stiffener rings
    mb.torus(r_exit * 1.02, 0.035, M @ T(0, 0, -length + 0.03), 'MAT_HULL_METAL', seg=48, rseg=6)
    for t in (0.33, 0.62):
        rr = r_throat + (r_exit - r_throat) * (1 - (1 - t) ** 2.1) * (0.92 + 0.08 * t)
        mb.torus(rr * 1.02, 0.014, M @ T(0, 0, -length * t), 'MAT_HULL_METAL', seg=36, rseg=3)
    mb.torus(cr * 1.03, 0.03, M @ T(0, 0, chamber_len * 0.75), 'MAT_HULL_METAL', seg=24, rseg=5)
    # coolant return lines from exit manifold up the bell to the chamber
    for k in range(4):
        a = math.tau * k / 4 + math.pi / 4
        pts = []
        for j in range(7):
            t = 1 - j / 6
            z = -length * t * 0.98
            rr = (r_throat + (r_exit - r_throat) * (1 - (1 - t) ** 2.1) * (0.92 + 0.08 * t)) + 0.05
            pts.append(M @ V((rr * math.cos(a), rr * math.sin(a), z)))
        pts.append(M @ V(((cr + 0.06) * math.cos(a), (cr + 0.06) * math.sin(a), chamber_len * 0.7)))
        mb.curve_pipe(pts, 0.018, 'MAT_HULL_METAL', bevel_res=1, res_u=3)
    return M @ T(0, 0, -length) @ R('X', 180)


def gimbal_yoke(mb, M, r=0.25, mat='MAT_HULL_METAL', h=None):
    """Turret/gimbal azimuth base: bearing ring + yoke arms rising along local Z to an elevation axis
    along local X at height h. Returns the elevation axis height."""
    h = h if h is not None else r * 1.1
    mb.cyl(r * 1.05, 0.05, M @ T(0, 0, 0.025), 'MAT_HULL_METAL', seg=24, bevel=0.01, bseg=2)
    mb.cyl(r * 0.95, 0.06, M @ T(0, 0, 0.08), mat, seg=24, bevel=0.012, bseg=2)
    bolt_circle(mb, M, r * 0.98, 16, 0.008, 0.006, z=0.05)
    side = frame((0, 0, 0), z=(1, 0, 0), y=(0, 0, 1))      # local X = Y (width), local Y = Z (height)
    for s in (-1, 1):
        x = s * r * 0.82
        prof = [(-r * 0.38, 0.1), (r * 0.38, 0.1), (0.1, h + 0.07), (-0.1, h + 0.07)]
        mb.prism(prof, 0.09, M @ T(x, 0, 0) @ side, mat, bevel=0.012, seg=2)
        mb.cyl(0.075, 0.12, M @ T(x, 0, h) @ R('Y', 90), 'MAT_HULL_METAL', seg=14, bevel=0.01, bseg=1)
    return h


# ------------------------------------------------------------------------------------------- gimbals
def gimbal_turret(az_name, el_name, hp_name, az_pivot, mount_z, aperture, parent, static_mb, ventral=False,
                  director_len=None, el_gap=None, director_mat='MAT_DARK_COMPOSITE', body_mat='MAT_HULL_PAINT',
                  kind='laser'):
    """Two-axis gimbal (docs/ASSETS.md 2.3): static pedestal (into static_mb) from the hull at mount_z up to the
    azimuth bearing; `<az_name>` (turntable + yoke, origin on the azimuth pivot, rotates about local Z);
    `<el_name>` (beam director / optic, origin on the elevation axis, rotates about local X, aperture along +Y at
    rest); `<hp_name>` muzzle empty (local +Z = beam direction) parented to EL. Ventral turrets hang below
    the hull (geometry mirrored in Z) but keep identity rest orientations.
    Returns (az_ob, el_ob, hp_ob, (lo, hi)) with lo/hi = world bounds of all its geometry."""
    from . import geo
    s = -1.0 if ventral else 1.0
    a = aperture
    R_b = a * 1.25                      # director barrel radius
    L = director_len or a * 4.2
    p = Vector(az_pivot)
    # ---- static pedestal
    with static_mb.region('_turret'):
        h = abs(p.z - mount_z)
        static_mb.cyl(R_b * 0.55, h, T(p.x, p.y, (p.z + mount_z) / 2), 'MAT_HULL_METAL', seg=12)
        static_mb.cyl(R_b * 0.85, 0.025, T(p.x, p.y, mount_z + s * 0.0125), 'MAT_HULL_METAL', seg=12)
        static_mb.cyl(R_b * 1.05, 0.04, T(p.x, p.y, p.z - s * 0.02), body_mat, seg=18)
        for k in range(4):
            ang = math.tau * k / 4 + math.pi / 4
            q0 = Vector((p.x + math.cos(ang) * R_b * 0.85, p.y + math.sin(ang) * R_b * 0.85, mount_z))
            q1 = Vector((p.x + math.cos(ang) * R_b * 0.5, p.y + math.sin(ang) * R_b * 0.5, p.z - s * 0.05))
            strut(static_mb, q0, q1, 0.012 + a * 0.03, 'MAT_HULL_METAL', seg=5)
    st_lo, st_hi = static_mb.regions.pop('_turret')
    # ---- azimuth node
    el_h = s * (el_gap if el_gap is not None else R_b + 0.09)
    az = geo.MeshBuilder(az_name)
    Mz = T(p)
    arm_x = R_b + 0.045 + a * 0.12
    with az.region('all'):
        az.cyl(R_b * 1.1, 0.05, Mz @ T(0, 0, s * 0.025), body_mat, seg=18)
        az.cyl(R_b * 0.7, 0.03, Mz @ T(0, 0, s * 0.065), 'MAT_HULL_METAL', seg=16)
        side = frame((0, 0, 0), z=(1, 0, 0), y=(0, 0, s))
        for sx in (-1, 1):
            prof = [(-R_b * 0.45, 0.04), (R_b * 0.45, 0.04), (R_b * 0.22, abs(el_h) + 0.06), (-R_b * 0.22, abs(el_h) + 0.06)]
            az.prism(prof, 0.05 + a * 0.08, Mz @ T(sx * arm_x, 0, 0) @ side, body_mat, bevel=0.008, seg=1)
            az.cyl(R_b * 0.3, 0.07 + a * 0.1, Mz @ T(sx * (arm_x + 0.03), 0, el_h) @ R('Y', 90), 'MAT_HULL_METAL', seg=12)
        # elevation drive motor + cable loop
        az.box((0.08 + a * 0.2, 0.1 + a * 0.2, 0.1 + a * 0.2), Mz @ T(arm_x + 0.1 + a * 0.12, 0, el_h * 0.55),
               'MAT_DARK_COMPOSITE', bevel=0.01, seg=1)
        az.curve_pipe([Mz @ Vector((-arm_x, -R_b * 0.3, s * 0.06)), Mz @ Vector((-arm_x - 0.08, -R_b * 0.5, el_h * 0.4)),
                       Mz @ Vector((-arm_x - 0.03, -R_b * 0.2, el_h * 0.9))], 0.012, 'MAT_CABLE_BLACK', res_u=3)
    az_lo, az_hi = az.regions['all']
    az_ob = az.to_object(az_name, parent=parent, origin=T(p))
    # ---- elevation node: director
    pe = p + Vector((0, 0, el_h))
    el = geo.MeshBuilder(el_name)
    My = frame(pe, z=(0, 1, 0), y=(0, 0, 1))         # local +Z = forward (+Y world)
    y0, y1 = -L * 0.42, L * 0.58
    with el.region('all'):
        if kind == 'laser':
            prof = [(0.0, y0 - 0.02), (R_b * 0.6, y0 - 0.02), (R_b * 0.95, y0), (R_b, y0 + 0.05), (R_b, y1 - 0.06),
                    (R_b * 1.1, y1 - 0.04), (R_b * 1.1, y1), (a * 1.02, y1), (a * 1.0, y1 - 0.05),
                    (a * 0.92, y1 - 0.08), (0.0, y1 - 0.08)]
            el.lathe(prof, My, [director_mat, director_mat, director_mat, body_mat, body_mat, body_mat, body_mat,
                                'MAT_HULL_METAL', 'MAT_PANEL_BLACK', 'MAT_PANEL_BLACK'], seg=20)
            el.cyl(a * 0.9, 0.006, My @ T(0, 0, y1 - 0.075), 'MAT_GLASS', seg=20, caps=True)
            # secondary mirror on a 3-vane spider
            el.cyl(a * 0.22, 0.04, My @ T(0, 0, y1 - 0.03), 'MAT_DARK_COMPOSITE', seg=12)
            for k in range(3):
                ang = math.tau * k / 3 + math.pi / 2
                el.box((a * 0.8, 0.008, 0.012), My @ T(math.cos(ang) * a * 0.5, math.sin(ang) * a * 0.5, y1 - 0.03)
                       @ R('Z', math.degrees(ang)), 'MAT_DARK_COMPOSITE')
            # banded MLI-silver jacket + cooling fins on the back
            for t in (0.15, 0.55):
                el.torus(R_b * 1.01, 0.008 + a * 0.02, My @ T(0, 0, y0 + (y1 - y0) * t), 'MAT_HULL_METAL', seg=20, rseg=3)
            for k in range(5):
                x = -R_b * 0.5 + R_b * 0.25 * k
                el.box((0.01, L * 0.3, R_b * 0.35), T(pe + Vector((x, y0 + L * 0.2, s * R_b * 0.95))), 'MAT_HULL_METAL')
            box_unit(el, frame(pe + Vector((0, y0 - 0.02, 0)), z=(0, -1, 0), y=(0, 0, 1)),
                     (R_b * 1.1, R_b * 0.9, 0.08 + a * 0.2), 'MAT_DARK_COMPOSITE', ribs=0, connectors=2)
        else:      # optical telescope style (lasercom terminal)
            prof = [(0.0, y0), (R_b, y0), (R_b, y1), (R_b * 1.08, y1 + a * 0.6), (R_b * 1.0, y1 + a * 0.6),
                    (a * 0.85, y1 - 0.02), (0.0, y1 - 0.02)]
            el.lathe(prof, My, [director_mat, director_mat, body_mat, body_mat, 'MAT_PANEL_BLACK', 'MAT_PANEL_BLACK'],
                     seg=16)
            el.cyl(a * 0.8, 0.004, My @ T(0, 0, y1 - 0.015), 'MAT_GLASS', seg=16)
        # trunnions to the yoke
        for sx in (-1, 1):
            el.cyl(R_b * 0.22, arm_x - R_b + 0.02, T(pe + Vector((sx * (R_b + (arm_x - R_b) / 2), 0, 0))) @ R('Y', 90),
                   'MAT_HULL_METAL', seg=10)
    el_lo, el_hi = el.regions['all']
    el_ob = el.to_object(el_name, parent=az_ob, origin=T(pe))
    hp_M = frame(pe + Vector((0, y1 + (a * 0.6 if kind != 'laser' else 0.0), 0)), z=(0, 1, 0), y=(0, 0, 1))
    hp = core.empty(hp_name, hp_M, el_ob, 'SINGLE_ARROW', 0.3)
    lo = Vector((min(st_lo.x, az_lo.x, el_lo.x), min(st_lo.y, az_lo.y, el_lo.y), min(st_lo.z, az_lo.z, el_lo.z)))
    hi = Vector((max(st_hi.x, az_hi.x, el_hi.x), max(st_hi.y, az_hi.y, el_hi.y), max(st_hi.z, az_hi.z, el_hi.z)))
    return az_ob, el_ob, hp, (lo, hi)
