"""Seated, pressure-suited pilot (pilot.glb): armature PILOT, skinned mesh PILOT_BODY with face morph targets,
HELMET parented to the `head` bone, hinged VISOR (rest = open).

Frame: origin = SEAT_REF (cockpit seatRef); +Y forward, +Z up, +X = pilot's right. Bone names follow the
contract; `.L` is the pilot's left (-X). The rest/bind pose is the seated pose that fits the cockpit seat,
heel rest and pedestal (knees spread to clear it); the eye midpoint is (0, 0.16, 0.74).

Body: a skin-modifier volume grown from a joint graph (bulky IVA suit, mitten gloves, boots) + one
subdivision, then shaped (wider torso, flattened hands) and dressed with suit hardware. Head: a lathed head
with dense ring stations at the brows / eyes / mouth line, sculpted by smooth feature functions, separate
eyeballs and eyelid shells, dark brow strips; the mouth is a dark band between two close rings that opens by
stretching, so jawOpen / lipsPart need no topology slit. Shape keys live on the head object, which is the join
target, so they survive merging the body into PILOT_BODY. Skin weights: region-limited distance-to-bone-segment
falloff (nearest bone + its parent/children only, top 3, normalised) so a resting hand never drags the thigh.
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from lib import core, geo, kit, mats
from lib.core import T, R, S, frame

V = Vector
EYE_RANGE = (0, 0)       # head-mesh vertex index range of eyeballs + lids (they keep their indices in the join)
EYE = V((0.0, 0.16, 0.74))
HC = V((0.0, 0.085, 0.75))          # head centre
HELMET_C = V((0.0, 0.095, 0.765))

BONES = {
    'root': ((0, 0, 0), (0, 0, 0.06), None),
    'pelvis': ((0, -0.02, 0.04), (0, -0.03, 0.17), 'root'),
    'spine_01': ((0, -0.03, 0.17), (0, -0.035, 0.29), 'pelvis'),
    'spine_02': ((0, -0.035, 0.29), (0, -0.03, 0.41), 'spine_01'),
    'chest': ((0, -0.03, 0.41), (0, -0.015, 0.56), 'spine_02'),
    'neck': ((0, -0.015, 0.56), (0, 0.02, 0.665), 'chest'),
    'head': ((0, 0.02, 0.665), (0, 0.06, 0.87), 'neck'),
}
SIDE = {
    'clavicle': ((-0.025, -0.01, 0.52), (-0.17, -0.035, 0.535), 'chest'),
    'upper_arm': ((-0.19, -0.035, 0.525), (-0.235, 0.02, 0.27), 'clavicle'),
    'forearm': ((-0.235, 0.02, 0.27), (-0.215, 0.27, 0.205), 'upper_arm'),
    'hand': ((-0.215, 0.27, 0.205), (-0.205, 0.355, 0.185), 'forearm'),
    'fingers': ((-0.205, 0.355, 0.185), (-0.20, 0.43, 0.16), 'hand'),
    'thumb': ((-0.19, 0.29, 0.21), (-0.165, 0.345, 0.215), 'hand'),
    'thigh': ((-0.10, 0.0, 0.0), (-0.21, 0.42, 0.09), 'pelvis'),
    'shin': ((-0.21, 0.42, 0.09), (-0.14, 0.72, -0.28), 'thigh'),
    'foot': ((-0.14, 0.72, -0.28), (-0.135, 0.90, -0.32), 'shin'),
}
for _n, (_h, _t, _p) in SIDE.items():
    for _s, _sx in (('L', 1), ('R', -1)):
        _par = _p if _p in BONES or _p is None or _p in ('chest', 'pelvis') else f'{_p}.{_s}'
        BONES[f'{_n}.{_s}'] = ((_h[0] * _sx, _h[1], _h[2]), (_t[0] * _sx, _t[1], _t[2]), _par)


def bone_seg(name):
    h, t, _ = BONES[name]
    return V(h), V(t)


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length


# ============================================================================================ armature
def build_armature():
    ad = bpy.data.armatures.new('PILOT')
    arm = bpy.data.objects.new('PILOT', ad)
    core.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = ad.edit_bones
    for name, (h, t, par) in BONES.items():
        b = eb.new(name)
        b.head, b.tail = V(h), V(t)
    for name, (h, t, par) in BONES.items():
        b = eb[name]
        if par:
            b.parent = eb[par]
            b.use_connect = (V(BONES[par][1]) - V(h)).length < 1e-4
        # roll: bone X = main hinge axis. Legs/spine/head: world X. Arms: normal of the arm plane.
        y = (V(t) - V(h)).normalized()
        if name.startswith(('upper_arm', 'forearm', 'hand', 'fingers', 'thumb', 'clavicle')):
            s = name.split('.')[1]
            sh, el, wr = V(BONES['upper_arm.' + s][0]), V(BONES['forearm.' + s][0]), V(BONES['hand.' + s][0])
            xh = (el - sh).cross(wr - el).normalized()
        else:
            xh = V((1, 0, 0))
        xh = (xh - y * xh.dot(y))
        if xh.length < 1e-6:
            xh = core._any_perp(y)
        xh.normalize()
        b.align_roll(xh.cross(y))          # align_roll sets the bone's Z axis
    bpy.ops.object.mode_set(mode='OBJECT')
    ad.display_type = 'STICK'
    return arm


# ============================================================================================ head
def head_profile():
    """(radius factor, z_rel) stations, dense at brows / eyes / mouth."""
    zs = [0.118, 0.112, 0.10, 0.085, 0.065, 0.045, 0.032, 0.022, 0.014, 0.006, -0.002, -0.01, -0.018, -0.026,
          -0.036, -0.046, -0.054, -0.0595, -0.0635, -0.0665, -0.0705, -0.078, -0.088, -0.098, -0.106, -0.113, -0.12,
          -0.128, -0.136]
    prof = []
    for z in zs:
        if z >= 0:
            r = math.sqrt(max(0.0, 1 - (z / 0.12) ** 2))
        else:
            r = math.sqrt(max(0.0, 1 - (z / 0.135) ** 2)) * (1 - 0.25 * min(1, -z / 0.11) ** 1.5)
            if z < -0.11:
                r = max(r, 0.5)
        prof.append((max(r, 0.0) if z < 0.118 else 0.0, z))
    return prof


def gauss(d2, s):
    return math.exp(-d2 / (2 * s * s))


def sculpt_head(p):
    """Displace a unit-profile head point (x, y, z rel. to HC) into a face. Returns new local position."""
    x, y, z = p
    sx = 0.074 * (1 - 0.18 * max(0.0, -z - 0.04) / 0.09)
    sy = 0.104 if y > 0 else 0.098
    x *= sx
    y *= sy
    front = max(0.0, y) / 0.104
    # flatten the face plane a little, square the jaw
    y -= 0.008 * front ** 3
    # brow ridge
    y += 0.007 * gauss((z - 0.02) ** 2, 0.009) * gauss(x * x, 0.04) * front
    # eye sockets
    for ex in (-0.031, 0.031):
        y -= 0.011 * gauss((x - ex) ** 2 + (z + 0.01) ** 2, 0.012) * front
    # cheekbones
    for ex in (-0.048, 0.048):
        y += 0.004 * gauss((x - ex) ** 2 + (z + 0.028) ** 2, 0.014) * front
        x += math.copysign(0.004, ex) * gauss((x - ex) ** 2 + (z + 0.028) ** 2, 0.016) * front if (x * ex) > 0 else 0
    # nose: bridge -> tip, nostril wings
    if -0.05 < z < 0.012:
        t = (0.012 - z) / 0.062
        prof = 0.007 + 0.03 * t ** 1.5 - 0.03 * max(0.0, t - 0.82) / 0.18 * (t > 0.82)
        y += prof * gauss(x * x, 0.008 + 0.007 * t) * front
    y += 0.004 * gauss(x * x * 0.4 + (z + 0.042) ** 2, 0.008) * front * (abs(x) > 0.006)
    # lips and chin
    y += 0.005 * gauss((z + 0.064) ** 2, 0.008) * gauss(x * x, 0.022) * front
    y += 0.008 * gauss((z + 0.1) ** 2, 0.012) * gauss(x * x, 0.02) * front
    return V((x, y, z))


def build_head():
    """Head object with eyes, lids, brows and the 11 face shape keys."""
    mb = geo.MeshBuilder('PILOT_BODY')
    prof = head_profile()
    seg = 36
    bm = mb.bm
    rings = []
    for (r, z) in prof:
        ring = []
        for i in range(seg if r > 0 else 1):
            a = math.tau * i / seg - math.pi / 2   # start at the back so the front is mid-ring
            p = sculpt_head(V((r * math.cos(a), r * math.sin(a), z)))
            ring.append(bm.verts.new(HC + p))
        rings.append(ring)
    skin, dark = mb.midx('MAT_SKIN'), mb.midx('MAT_SUIT_DARK')
    faces = []
    for j in range(len(rings) - 1):
        A, B = rings[j], rings[j + 1]
        for i in range(seg):
            i2 = (i + 1) % seg
            q = [A[i % len(A)], B[i % len(B)], B[i2 % len(B)], A[i2 % len(A)]]
            uq = []
            for v in q:
                if v not in uq:
                    uq.append(v)
            if len(uq) >= 3:
                f = bm.faces.new(uq)
                faces.append((f, prof[j][1], prof[j + 1][1]))
    bmesh.ops.recalc_face_normals(bm, faces=[f for f, _, _ in faces])
    for f, z0, z1 in faces:
        c = f.calc_center_median() - HC
        f.smooth = True
        f.material_index = skin
        if abs(z0 + 0.0635) < 1e-4 and abs(z1 + 0.0665) < 1e-4 and abs(c.x) < 0.024 and c.y > 0.05:
            f.material_index = dark                                     # mouth line
        elif c.z > 0.042 or c.y < -0.035 or (c.z > 0.03 and abs(c.x) > 0.05):
            f.material_index = dark                                     # comms cap
    # eyes, lids, brows
    global EYE_RANGE
    n_eye0 = len(bm.verts)
    eyes = []
    for sx, s in ((-1, 'L'), (1, 'R')):
        ec = V((sx * 0.031, EYE.y, EYE.z))
        mb.sphere(0.0125, frame(ec, z=(0, 1, 0)), 'MAT_EYE', seg=12, rings=8)
        mb.cyl(0.0052, 0.0012, frame(ec + V((0, 0.0119, 0)), z=(0, 1, 0)), 'MAT_SUIT_DARK', seg=10)
        eyes.append((s, ec))
    nv_before_lids = len(bm.verts)
    lid_ids = {}
    for s, ec in eyes:
        for part, a0, a1 in (('U', 22.0, 105.0), ('D', -100.0, -38.0)):
            ids = []
            Rl = 0.0136
            grid = []
            for ia in range(5):
                al = math.radians(a0 + (a1 - a0) * ia / 4)
                row = []
                for ib in range(7):
                    be = math.radians(-62 + 124 * ib / 6)
                    p = ec + V((Rl * math.sin(be), Rl * math.cos(be) * math.cos(al), Rl * math.cos(be) * math.sin(al)))
                    v = bm.verts.new(p)
                    row.append(v)
                grid.append(row)
            for ia in range(4):
                for ib in range(6):
                    f = bm.faces.new([grid[ia][ib], grid[ia + 1][ib], grid[ia + 1][ib + 1], grid[ia][ib + 1]])
                    f.material_index = skin
                    f.smooth = True
            lid_ids[(s, part)] = grid
    EYE_RANGE = (n_eye0, len(bm.verts))
    # brows: dark strips on the ridge
    brow_verts = {}
    for sx, s in ((-1, 'L'), (1, 'R')):
        pts = []
        for k in range(5):
            t = k / 4
            x = sx * (0.012 + 0.038 * t)
            z = 0.017 + 0.005 * math.sin(math.pi * t) - 0.006 * t
            pts.append(HC + V((x, 0.0, z)))
        # project to the head front surface by casting along +Y from the inside
        brow_verts[s] = pts
    bm.normal_update()
    bvh = BVHTree.FromBMesh(bm)
    for s, pts in brow_verts.items():
        surf = []
        for p in pts:
            hit = bvh.ray_cast(p, V((0, 1, 0)), 0.2)
            surf.append(hit[0] + V((0, 0.0025, 0)) if hit[0] else p + V((0, 0.1, 0)))
        mb.sweep(surf, [0.0028, 0.0034, 0.0032, 0.0028, 0.0018], None, 'MAT_SUIT_DARK', seg=5)
    ob = mb.to_object('PILOT_BODY', sharp_angle=None, weighted=False, free=False)
    me = ob.data
    # ---------------- shape keys (morph targets), exaggerated for a low-res noisy feed
    base = [v.co.copy() for v in me.vertices]
    nverts = len(base)
    lid_index = {}
    # map lid BMVerts -> mesh indices (bm indices == mesh indices after to_mesh)
    mb.bm.verts.index_update()
    for key, grid in lid_ids.items():
        lid_index[key] = [v.index for row in grid for v in row]
    mb.bm.free()
    ob.shape_key_add(name='Basis', from_mix=False)
    eye_c = {s: c for s, c in eyes}
    lidset = {i for ids in lid_index.values() for i in ids}

    def key(name, fn):
        kb = ob.shape_key_add(name=name, from_mix=False)
        for i, co in enumerate(base):
            d = fn(i, co - HC, co)
            if d is not None:
                kb.data[i].co = co + d
        return kb

    def face_w(l):          # front-of-face weight
        return max(0.0, min(1.0, (l.y - 0.02) / 0.05))

    def rot_lid(i, co, s, part, deg):
        c = eye_c[s]
        Rm = Matrix.Rotation(math.radians(deg), 3, 'X')
        return (Rm @ (co - c)) + c - co

    def lids(i, co, up_deg, down_deg):
        for (s, part), ids in lid_index.items():
            if i in ids:
                return rot_lid(i, co, s, part, up_deg if part == 'U' else down_deg)
        return None

    brow_z = 0.015

    def brow_region(l):
        return face_w(l) * gauss((l.z - brow_z) ** 2, 0.012) * (abs(l.x) < 0.06)

    key('browUp', lambda i, l, co: None if i in lidset else V((0, 0.0, 0.011)) * brow_region(l))
    key('browDown', lambda i, l, co: None if i in lidset else V((0, 0.003, -0.008)) * brow_region(l))
    key('browKnit', lambda i, l, co: None if i in lidset else
        V((-l.x * 0.35, 0.002, -0.006)) * brow_region(l) * gauss(l.x * l.x, 0.028))
    key('eyesWide', lambda i, l, co: lids(i, co, 24.0, -12.0) if i in lidset else
        V((0, 0, 0.004)) * brow_region(l))
    key('eyesClosed', lambda i, l, co: lids(i, co, -56.0, 7.0) if i in lidset else None)

    hinge = V((0.0, -0.015, -0.035))

    def jaw(i, l, co):
        if i in lidset or l.z > -0.064 or l.y < -0.02:
            return None
        w = min(1.0, (-0.064 - l.z) / 0.012) * min(1.0, (l.y + 0.02) / 0.05) * max(0.0, min(1.0, (l.z + 0.134) / 0.022))
        Rm = Matrix.Rotation(math.radians(-20.0 * w), 3, 'X')
        return (Rm @ (l - hinge) + hinge) - l
    key('jawOpen', jaw)

    def mouth_w(l):
        return face_w(l) * gauss((l.z + 0.065) ** 2, 0.012) * gauss(l.x * l.x, 0.026)
    key('mouthTense', lambda i, l, co: None if i in lidset else
        V((l.x * 0.25, -0.004, (0.002 if l.z < -0.065 else -0.002))) * mouth_w(l))
    key('mouthFrown', lambda i, l, co: None if i in lidset else
        V((0, 0, -0.009)) * mouth_w(l) * min(1.0, abs(l.x) / 0.018))
    key('lipsPart', lambda i, l, co: None if i in lidset else
        V((0, 0.001, 0.0035 if l.z >= -0.0635 else -0.0055)) * face_w(l) *
        gauss((l.z + 0.065) ** 2, 0.006) * gauss(l.x * l.x, 0.022))
    key('cheekPuff', lambda i, l, co: None if i in lidset else
        V((math.copysign(0.012, l.x), 0.006, 0)) * face_w(l) * gauss((abs(l.x) - 0.045) ** 2 + (l.z + 0.05) ** 2, 0.016))
    key('nostrilFlare', lambda i, l, co: None if i in lidset else
        V((math.copysign(0.005, l.x), 0.001, 0.001)) * face_w(l) * gauss((abs(l.x) - 0.012) ** 2 + (l.z + 0.042) ** 2,
                                                                          0.006))
    return ob


# ============================================================================================ body
JOINTS = {
    # name: (pos, radius, bone)
    'pel': ((0, -0.03, 0.07), 0.15), 'sp1': ((0, -0.035, 0.20), 0.15), 'sp2': ((0, -0.035, 0.32), 0.152),
    'ch': ((0, -0.025, 0.44), 0.16), 'uch': ((0, -0.015, 0.53), 0.13), 'nk': ((0, 0.0, 0.60), 0.068),
    'nk2': ((0, 0.015, 0.655), 0.056),
}
for _s, _sx in (('L', -1), ('R', 1)):
    for _n, (_p, _r) in {'sh': ((0.18, -0.035, 0.525), 0.078), 'ua': ((0.21, -0.008, 0.40), 0.066),
                         'el': ((0.235, 0.02, 0.27), 0.058), 'fa': ((0.228, 0.15, 0.24), 0.052),
                         'wr': ((0.215, 0.27, 0.205), 0.044), 'pa': ((0.207, 0.335, 0.19), 0.05),
                         'fi': ((0.201, 0.425, 0.162), 0.034), 'tb': ((0.19, 0.29, 0.212), 0.028),
                         'tt': ((0.168, 0.345, 0.215), 0.019), 'hp': ((0.10, 0.0, 0.025), 0.11),
                         'mt': ((0.155, 0.21, 0.05), 0.096), 'kn': ((0.21, 0.42, 0.09), 0.072),
                         'ms': ((0.18, 0.57, -0.09), 0.066), 'an': ((0.14, 0.72, -0.28), 0.056),
                         'to': ((0.135, 0.885, -0.315), 0.05), 'he': ((0.14, 0.685, -0.33), 0.05)}.items():
        JOINTS[f'{_n}{_s}'] = ((_p[0] * _sx, _p[1], _p[2]), _r)
EDGES = [('pel', 'sp1'), ('sp1', 'sp2'), ('sp2', 'ch'), ('ch', 'uch'), ('uch', 'nk'), ('nk', 'nk2')]
for _s in 'LR':
    EDGES += [(f'uch', f'sh{_s}'), (f'sh{_s}', f'ua{_s}'), (f'ua{_s}', f'el{_s}'), (f'el{_s}', f'fa{_s}'),
              (f'fa{_s}', f'wr{_s}'), (f'wr{_s}', f'pa{_s}'), (f'pa{_s}', f'fi{_s}'), (f'wr{_s}', f'tb{_s}'),
              (f'tb{_s}', f'tt{_s}'), ('pel', f'hp{_s}'), (f'hp{_s}', f'mt{_s}'), (f'mt{_s}', f'kn{_s}'),
              (f'kn{_s}', f'ms{_s}'), (f'ms{_s}', f'an{_s}'), (f'an{_s}', f'to{_s}'), (f'an{_s}', f'he{_s}')]


def build_suit():
    names = list(JOINTS)
    me = bpy.data.meshes.new('_suit')
    me.from_pydata([JOINTS[n][0] for n in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
    ob = bpy.data.objects.new('_suit', me)
    core.link(ob)
    sk = ob.modifiers.new('skin', 'SKIN')
    sk.branch_smoothing = 0.6
    sk.use_smooth_shade = True
    for i, n in enumerate(names):
        r = JOINTS[n][1]
        sv = me.skin_vertices[0].data[i]
        sv.radius = (r, r)
        sv.use_root = (n == 'pel')
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 1
    core.apply_all_modifiers([ob])
    return ob


def nearest_bone(p, names=None):
    best, bn = 1e9, None
    for n in (names or BONES):
        if n == 'root':
            continue
        a, b = bone_seg(n)
        d = seg_dist(p, a, b)
        if d < best:
            best, bn = d, n
    return bn, best


def shape_suit(ob):
    me = ob.data
    spine = {'pelvis', 'spine_01', 'spine_02', 'chest'}
    for v in me.vertices:
        p = v.co
        bn, _ = nearest_bone(p)
        if bn in spine:
            v.co = V((p.x * 1.17, -0.03 + (p.y + 0.03) * 0.88, p.z))
        elif bn and bn.split('.')[0] in ('hand', 'fingers', 'thumb'):
            a, b = bone_seg('hand.' + bn.split('.')[1])
            t = max(0, min(1, (p - a).dot(b - a) / (b - a).length_squared))
            c = a + (b - a) * t
            v.co = V((c.x + (p.x - c.x) * 1.12, p.y, c.z + (p.z - c.z) * 0.6))
        elif bn and bn.startswith('foot'):
            if p.z < -0.335:
                v.co = V((p.x * 1.0, p.y, -0.335 - (p.z + 0.335) * 0.3))
    # materials: gloves and boots dark, suit elsewhere
    me.materials.clear()
    me.materials.append(mats.get('MAT_SUIT'))
    me.materials.append(mats.get('MAT_SUIT_DARK'))
    for f in me.polygons:
        c = f.center
        bn, _ = nearest_bone(c)
        part = bn.split('.')[0] if bn else ''
        f.material_index = 1 if part in ('hand', 'fingers', 'thumb', 'foot') else 0
        f.use_smooth = True


def suit_details(body_ob):
    """Suit hardware projected onto the body surface: neck ring, wrist disconnects, chest control unit, hoses,
    shoulder patches (MAT_HULL_PAINT so the runtime faction tint reaches them), pockets, knee pads, zipper."""
    me = body_ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    d = geo.MeshBuilder('_suit_det')

    def on(p, off=0.0):
        loc, n, _, _ = bvh.find_nearest(V(p))
        return loc + n * off, n

    d.torus(0.088, 0.013, T(0, 0.004, 0.618) @ R('X', -8), 'MAT_HULL_METAL', seg=24, rseg=6)
    d.torus(0.078, 0.009, T(0, 0.004, 0.637) @ R('X', -8), 'MAT_SUIT_DARK', seg=24, rseg=5)
    for s, sx in (('L', -1), ('R', 1)):
        w = V(BONES['hand.' + s][0])
        fa = (w - V(BONES['forearm.' + s][0])).normalized()
        d.torus(0.05, 0.009, frame(w - fa * 0.012, z=fa), 'MAT_HULL_METAL', seg=16, rseg=4)
    # chest control unit
    p, n = on((0, 0.2, 0.40))
    Mc = frame(p, z=n, y=(0, 0, 1))
    d.box((0.17, 0.11, 0.055), Mc @ T(0, 0, 0.022), 'MAT_SUIT_DARK', bevel=0.008, seg=2)
    for k, x in enumerate((-0.05, 0.0, 0.05)):
        d.cyl(0.011, 0.012, Mc @ T(x, 0.02, 0.054), 'MAT_HULL_METAL' if k != 1 else 'MAT_PAINT_RED', seg=10)
    d.box((0.06, 0.03, 0.004), Mc @ T(0.02, -0.03, 0.05), 'MAT_PAINT_WHITE')
    hose_ports = []
    for sx in (-1, 1):
        port = Mc @ V((sx * 0.085, -0.02, 0.025))
        d.cyl(0.018, 0.03, frame(port, z=Mc.to_3x3() @ V((sx, 0, 0))), 'MAT_HULL_METAL', seg=10)
        hose_ports.append(port)
    # hoses from the chest unit down to the left hip disconnects (corrugated)
    for k, port in enumerate(hose_ports):
        hip, hn = on((-0.17, 0.06 + 0.04 * k, 0.12 + 0.03 * k), 0.025)
        mid = (port + hip) / 2 + V((-0.06, 0.07, 0.0))
        pts = [port, port + V((-0.03 if k == 0 else 0.03, 0.03, -0.03)), mid, hip]
        d.curve_pipe(pts, 0.016, 'MAT_CABLE_GREY', res_u=6)
        for t in range(1, 12):
            q = pts[1].lerp(mid, t / 6) if t <= 6 else mid.lerp(hip, (t - 6) / 6)
            q2 = pts[1].lerp(mid, (t + 0.5) / 6) if t < 6 else mid.lerp(hip, min(1, (t - 5.5) / 6))
            d.torus(0.017, 0.0035, frame(q, z=(q2 - q) if (q2 - q).length > 1e-4 else V((0, 0, 1))), 'MAT_CABLE_GREY',
                    seg=10, rseg=3)
        d.cyl(0.024, 0.04, frame(hip, z=hn), 'MAT_HULL_METAL', seg=12, bevel=0.004, bseg=1)
    # comms lead from the chest unit up to the neck ring
    d.curve_pipe([Mc @ V((-0.06, 0.055, 0.03)), V((-0.07, 0.12, 0.55)), V((-0.075, 0.06, 0.615))], 0.006,
                 'MAT_CABLE_BLACK', res_u=6)
    # shoulder patches (faction tint), thigh pockets, knee pads, zipper
    for s, sx in (('L', -1), ('R', 1)):
        p, n = on((sx * 0.27, -0.02, 0.46), 0.002)
        d.box((0.07, 0.06, 0.004), frame(p, z=n, y=(0, 0, 1)), 'MAT_HULL_PAINT', bevel=0.002, seg=1)
        p, n = on((sx * 0.25, 0.22, 0.06), 0.003)
        d.box((0.08, 0.1, 0.022), frame(p, z=n, y=(0, 1, 0)), 'MAT_SUIT', bevel=0.006, seg=2)
        d.box((0.08, 0.025, 0.026), frame(p, z=n, y=(0, 1, 0)) @ T(0, 0.04, 0.004), 'MAT_SUIT_DARK', bevel=0.005, seg=1)
        p, n = on((sx * 0.21, 0.47, 0.13), 0.002)
        d.box((0.09, 0.1, 0.016), frame(p, z=n, y=(0, 1, -0.6)), 'MAT_SUIT_DARK', bevel=0.006, seg=2)
    zp = []
    for z in (0.56, 0.48, 0.40, 0.32, 0.24, 0.16):
        p, n = on((0.02, 0.25, z), 0.002)
        zp.append(p)
    d.sweep(zp, 0.004, None, 'MAT_SUIT_DARK', seg=4)
    return d.to_object('_suit_det', sharp_angle=None, weighted=False)


# ============================================================================================ helmet
def build_helmet(arm):
    hb = geo.MeshBuilder('HELMET')
    c = HELMET_C
    rx, ry, rz = 0.142, 0.155, 0.152
    # shell: ellipsoid with the face opening and the neck opening removed
    seg, rings = 32, 18
    bm = hb.bm
    grid = []
    for j in range(rings + 1):
        el = math.radians(-58 + (90 + 58) * j / rings)
        row = []
        for i in range(seg):
            az = math.tau * i / seg
            p = c + V((rx * math.cos(el) * math.sin(az), ry * math.cos(el) * math.cos(az), rz * math.sin(el)))
            row.append(bm.verts.new(p))
        grid.append(row)
    shell = []
    for j in range(rings):
        for i in range(seg):
            i2 = (i + 1) % seg
            el = -58 + (90 + 58) * (j + 0.5) / rings
            az = math.degrees(math.tau * (i + 0.5) / seg)
            az = az - 360 if az > 180 else az
            if abs(az) < 54 and -42 < el < 30:
                continue                                # face opening
            f = bm.faces.new([grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i]])
            f.material_index = hb.midx('MAT_HELMET')
            f.smooth = True
            shell.append(f)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if (f.calc_center_median() - c).dot(f.normal) < 0:
            f.normal_flip()
    # opening seal rim, pivot bosses, ridge, comms port, rear pad, neck ring
    rim = []
    for k in range(29):
        t = k / 28
        if t < 0.25:
            az, el = -54 + 108 * (t / 0.25), 30
        elif t < 0.5:
            az, el = 54, 30 - 72 * ((t - 0.25) / 0.25)
        elif t < 0.75:
            az, el = 54 - 108 * ((t - 0.5) / 0.25), -42
        else:
            az, el = -54, -42 + 72 * ((t - 0.75) / 0.25)
        a, e = math.radians(az), math.radians(el)
        rim.append(c + V((rx * math.cos(e) * math.sin(a), ry * math.cos(e) * math.cos(a), rz * math.sin(e))) * 1.0)
    hb.sweep(rim, 0.009, None, 'MAT_SUIT_DARK', seg=6, closed=True, caps=False)
    for sx in (-1, 1):
        hb.cyl(0.03, 0.018, frame(c + V((sx * (rx + 0.004), 0.0, 0.02)), z=(sx, 0, 0)), 'MAT_HULL_METAL', seg=16,
               bevel=0.004, bseg=1)
        hb.box((0.03, 0.05, 0.012), frame(c + V((sx * (rx - 0.01), -0.05, -0.06)), z=(sx, 0, 0)), 'MAT_SUIT_DARK',
               bevel=0.003, seg=1)
    hb.sweep([c + V((0, ry * 0.6, rz * 0.78)), c + V((0, 0.0, rz * 1.02)), c + V((0, -ry * 0.75, rz * 0.62))], 0.008,
             None, 'MAT_HELMET', seg=6)
    hb.lathe([(0.1, -0.125), (0.105, -0.115), (0.105, -0.098), (0.098, -0.09)], T(c), 'MAT_HULL_METAL', seg=24)
    kit.connector(hb, frame(c + V((-rx * 0.9, -0.04, -0.07)), z=(-1, -0.3, -0.5)), 0.008, 0.02)
    ob = hb.to_object('HELMET', sharp_angle=40)
    so = ob.modifiers.new('solidify', 'SOLIDIFY')
    so.thickness = 0.008
    so.offset = -1.0
    # visor (child), modelled closed; rest transform = raised (open)
    vb = geo.MeshBuilder('VISOR')
    vr = (rx + 0.012, ry + 0.012, rz + 0.012)
    vg = []
    for j in range(9):
        el = math.radians(-46 + 80 * j / 8)
        row = []
        for i in range(13):
            az = math.radians(-60 + 120 * i / 12)
            row.append(vb.bm.verts.new(c + V((vr[0] * math.cos(el) * math.sin(az), vr[1] * math.cos(el) * math.cos(az),
                                             vr[2] * math.sin(el)))))
        vg.append(row)
    for j in range(8):
        for i in range(12):
            f = vb.bm.faces.new([vg[j][i], vg[j + 1][i], vg[j + 1][i + 1], vg[j][i + 1]])
            f.material_index = vb.midx('MAT_VISOR')
            f.smooth = True
    vb.sweep([v.co.copy() for v in vg[8]], 0.007, None, 'MAT_HELMET', seg=5)
    vb.sweep([v.co.copy() for v in vg[0]], 0.006, None, 'MAT_HELMET', seg=5)
    for sx in (-1, 1):
        side = [row[0 if sx < 0 else 12].co.copy() for row in vg]
        vb.sweep(side, 0.006, None, 'MAT_HELMET', seg=5)
        vb.box((0.012, 0.05, 0.05), frame(c + V((sx * (rx + 0.016), 0.0, 0.02)), z=(sx, 0, 0)), 'MAT_HELMET',
               bevel=0.004, seg=1)
    vb.box((0.05, 0.016, 0.012), T(c + V((0, vr[1] * 0.98, -0.03))) @ R('X', 20), 'MAT_HELMET', bevel=0.003, seg=1)
    hinge = c + V((0, 0.0, 0.02))
    open_deg = 72.0
    vis = vb.to_object('VISOR', origin=T(hinge), sharp_angle=None, weighted=False)
    # bone parenting (rest pose): world = arm @ bone.matrix_local @ T(0, len, 0) @ basis
    b = arm.data.bones['head']
    Wb = core.world(arm) @ b.matrix_local @ T(0, b.length, 0)
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = 'head'
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.matrix_basis = Wb.inverted() @ Matrix.Identity(4)
    core.place(vis, T(hinge) @ R('X', open_deg), ob)
    vis['anim'] = 'rotate'
    vis['axis'] = 'X'
    vis['unit'] = 'deg'
    vis['states'] = ['OPEN', 'CLOSED']
    vis['values'] = [open_deg, 0.0]
    return ob, vis


# ============================================================================================ weights
def skin_weights(ob, arm):
    me = ob.data
    names = [n for n in BONES if n != 'root']
    kids = {n: [] for n in BONES}
    for n, (_, _, p) in BONES.items():
        if p:
            kids[p].append(n)
    for n in names:
        ob.vertex_groups.new(name=n)
    groups = {g.name: g for g in ob.vertex_groups}
    sigma = 0.022
    for v in me.vertices:
        p = v.co
        b0, d0 = nearest_bone(p, names)
        cand = {b0}
        par = BONES[b0][2]
        if par and par != 'root':
            cand.add(par)
        cand.update(kids[b0])
        if p.z > 0.635 or (p.z > 0.60 and abs(p.x) < 0.095 and p.y > -0.12):
            cand = {'head', 'neck'}
            b0 = 'head' if p.z > 0.635 else 'neck'
            d0 = min(seg_dist(p, *bone_seg('head')), seg_dist(p, *bone_seg('neck')))
        ws = []
        for n in cand:
            a, b = bone_seg(n)
            ws.append((math.exp(-(seg_dist(p, a, b) - d0) / sigma), n))
        ws.sort(reverse=True)
        ws = ws[:3]
        tot = sum(w for w, _ in ws)
        for w, n in ws:
            if w / tot > 0.02:
                groups[n].add([v.index], w / tot, 'REPLACE')
    mod = ob.modifiers.new('armature', 'ARMATURE')
    mod.object = arm
    ob.parent = arm
    ob.matrix_parent_inverse = Matrix.Identity(4)


def fix_eye_masks():
    """Eyeballs and lids are baked at rest pose a millimetre apart, which would read as near-black AO once
    eyesClosed slides the lids over the eye. Give them open-air AO and no wear / cavity."""
    me = bpy.data.objects['PILOT_BODY'].data
    attr = me.color_attributes['Mask']
    a, b = EYE_RANGE
    for i in range(a, b):
        attr.data[i].color = (0.85, 0.0, 0.08, 1.0)


# ============================================================================================ build
def build():
    rng = random.Random(6101)
    arm = build_armature()
    head = build_head()
    suit = build_suit()
    shape_suit(suit)
    det = suit_details(suit)
    body = core.join([head, suit, det], 'PILOT_BODY')
    body.data.name = 'PILOT_BODY'
    skin_weights(body, arm)
    helmet, visor = build_helmet(arm)
    return {'root': arm, 'masks': dict(ao_dist=0.18, crevice=0.01, samples=20), 'post_masks': fix_eye_masks,
            'preview': {'camera': {'loc': (0.62, 1.05, 0.95), 'target': (0.0, 0.12, 0.5), 'fov': 42},
                        'sun_dir': (0.4, 0.9, 0.7), 'energy': 4.5, 'samples': 24,
                        'points': [((-0.6, 0.8, 0.9), 15.0)]}}
