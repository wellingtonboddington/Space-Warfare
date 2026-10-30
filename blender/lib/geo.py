"""MeshBuilder: accumulate many hard-surface parts into one bmesh with per-face materials.

Every primitive takes a placement matrix M (4x4, builder space = asset root frame unless stated) and a
material name. Primitives can be bevelled individually (angle-limited, 1-3 segments) so a 2 cm bolt and a
2 m hull plate get proportionate bevels before they share one object. Region tracking records the bounds
of named sub-assemblies so HIT_* boxes always match the geometry.
"""
import math
from contextlib import contextmanager
import bpy
import bmesh
from mathutils import Vector, Matrix, noise
from . import core, mats

TAU = math.tau
I4 = Matrix.Identity(4)


def _m(M):
    return I4 if M is None else M


class MeshBuilder:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mat_names = []
        self.regions = {}
        self._rec = []          # stack of vert lists being recorded for regions
        self._uv = None

    # ------------------------------------------------------------------ materials / regions
    def midx(self, mat):
        if mat not in self.mat_names:
            self.mat_names.append(mat)
        return self.mat_names.index(mat)

    def _finish(self, verts, faces, mat):
        if mat is not None:
            i = self.midx(mat)
            for f in faces:
                f.material_index = i
        for f in faces:
            f.smooth = True
        self._track(verts)
        return faces

    @contextmanager
    def _track(self, verts):
        """Grow every active region's bounding box by these vertices (coordinates at creation time;
        bmesh ops such as subdivide_edges can invalidate Python vertex references later)."""
        if not self._rec or not verts:
            return
        xs = [v.co.x for v in verts if v.is_valid]
        if not xs:
            return
        ys = [v.co.y for v in verts if v.is_valid]
        zs = [v.co.z for v in verts if v.is_valid]
        lo = (min(xs), min(ys), min(zs))
        hi = (max(xs), max(ys), max(zs))
        for box in self._rec:
            for i in range(3):
                box[0][i] = min(box[0][i], lo[i])
                box[1][i] = max(box[1][i], hi[i])

    @contextmanager
    def region(self, name):
        box = [[1e9, 1e9, 1e9], [-1e9, -1e9, -1e9]]
        self._rec.append(box)
        try:
            yield
        finally:
            self._rec = [b for b in self._rec if b is not box]
            if box[0][0] <= box[1][0]:
                lo, hi = Vector(box[0]), Vector(box[1])
                if name in self.regions:
                    a, b = self.regions[name]
                    lo = Vector((min(lo.x, a.x), min(lo.y, a.y), min(lo.z, a.z)))
                    hi = Vector((max(hi.x, b.x), max(hi.y, b.y), max(hi.z, b.z)))
                self.regions[name] = (lo, hi)

    @contextmanager
    def no_region(self):
        """Geometry added inside is excluded from every active region (antennas, harnesses, pipe runs that
        would otherwise inflate a HIT box)."""
        saved = self._rec
        self._rec = []
        try:
            yield
        finally:
            self._rec = saved

    # ------------------------------------------------------------------ primitives
    def box(self, size, M=None, mat='MAT_HULL_PAINT', bevel=0.0, seg=2, angle=30):
        sx, sy, sz = size
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=_m(M) @ core.S(sx, sy, sz))
        verts = r['verts']
        faces = list({f for v in verts for f in v.link_faces})
        self._finish(verts, faces, mat)
        if bevel > 0:
            faces = self.bevel(faces, bevel, seg, angle)
        return faces

    def cyl(self, r, depth, M=None, mat='MAT_HULL_METAL', seg=16, r2=None, caps=True, bevel=0.0, bseg=2,
            angle=30):
        """Cylinder / frustum along local Z, centred on the origin."""
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r,
                                    radius2=r if r2 is None else r2, depth=depth, matrix=_m(M))
        verts = res['verts']
        faces = list({f for v in verts for f in v.link_faces})
        self._finish(verts, faces, mat)
        if bevel > 0 and caps:
            faces = self.bevel(faces, bevel, bseg, angle)
        return faces

    def hexbolt(self, r, h, M=None, mat='MAT_HULL_METAL', washer=False, bevel=False):
        """Hex bolt head (20 tris; washer/bevel optional for hero close-ups), base on z=0, pointing +Z."""
        M = _m(M)
        f = self.cyl(r, h, M @ core.T(0, 0, h / 2), mat, seg=6, bevel=min(r, h) * 0.18 if bevel else 0.0, bseg=1)
        if washer:
            f += self.cyl(r * 1.35, h * 0.22, M @ core.T(0, 0, h * 0.11), mat, seg=8)
        return f

    def lathe(self, profile, M=None, mat='MAT_HULL_METAL', seg=24, rfunc=None, phase=0.0, arc=None,
              cap_start=False, cap_end=False):
        """Revolve profile [(r, z), ...] about local Z. r == 0 collapses to a pole.
        mat may be a list (one per profile segment). rfunc(i_seg, i_ring) -> radius multiplier."""
        M = _m(M)
        bm = self.bm
        full = arc is None
        n_ang = seg if full else seg + 1
        a_span = TAU if full else math.radians(arc)
        rings = []
        allv = []
        for j, (r, z) in enumerate(profile):
            if r <= 1e-7:
                v = bm.verts.new(M @ Vector((0, 0, z)))
                rings.append([v] * n_ang)
                allv.append(v)
                continue
            ring = []
            for i in range(n_ang):
                a = phase + a_span * i / seg
                rr = r * (rfunc(i, j) if rfunc else 1.0)
                v = bm.verts.new(M @ Vector((rr * math.cos(a), rr * math.sin(a), z)))
                ring.append(v)
                allv.append(v)
            rings.append(ring)
        faces = []
        mats_list = mat if isinstance(mat, (list, tuple)) else None
        for j in range(len(rings) - 1):
            A, B = rings[j], rings[j + 1]
            mj = mats_list[min(j, len(mats_list) - 1)] if mats_list else mat
            mi = self.midx(mj)
            rng = range(seg) if full else range(seg)
            for i in range(seg):
                i2 = (i + 1) % n_ang if full else i + 1
                q = [A[i], A[i2], B[i2], B[i]]
                uq = []
                for v in q:
                    if v not in uq:
                        uq.append(v)
                if len(uq) < 3:
                    continue
                try:
                    f = bm.faces.new(uq)
                except ValueError:
                    continue
                f.material_index = mi
                f.smooth = True
                faces.append(f)
        caps = []
        if full and cap_start and profile[0][0] > 1e-7:
            caps.append(bm.faces.new(list(reversed(rings[0]))))
        if full and cap_end and profile[-1][0] > 1e-7:
            caps.append(bm.faces.new(rings[-1]))
        mi0 = self.midx(mats_list[0] if mats_list else mat)
        for c in caps:
            c.material_index = mi0
            c.smooth = True
        faces += caps
        self._track(allv)
        return faces

    def sphere(self, r, M=None, mat='MAT_HULL_METAL', seg=24, rings=12, z0=-1.0, z1=1.0):
        prof = []
        a0, a1 = math.asin(max(-1, min(1, z0))), math.asin(max(-1, min(1, z1)))
        for k in range(rings + 1):
            a = a0 + (a1 - a0) * k / rings
            prof.append((r * math.cos(a) if abs(abs(a) - math.pi / 2) > 1e-6 else 0.0, r * math.sin(a)))
        return self.lathe(prof, M, mat, seg)

    def torus(self, R, r, M=None, mat='MAT_HULL_METAL', seg=24, rseg=8, arc=None):
        M = _m(M)
        bm = self.bm
        full = arc is None
        n = seg if full else seg + 1
        span = TAU if full else math.radians(arc)
        rings = []
        allv = []
        for i in range(n):
            a = span * i / seg
            c, s = math.cos(a), math.sin(a)
            ring = []
            for k in range(rseg):
                b = TAU * k / rseg
                rr = R + r * math.cos(b)
                v = bm.verts.new(M @ Vector((rr * c, rr * s, r * math.sin(b))))
                ring.append(v)
                allv.append(v)
            rings.append(ring)
        faces = []
        for i in range(seg):
            A, B = rings[i], rings[(i + 1) % n]
            for k in range(rseg):
                k2 = (k + 1) % rseg
                faces.append(bm.faces.new([A[k], B[k], B[k2], A[k2]]))
        if not full:
            faces.append(bm.faces.new(list(reversed(rings[0]))))
            faces.append(bm.faces.new(rings[-1]))
        return self._finish(allv, faces, mat)

    def sweep(self, pts, radius, M=None, mat='MAT_CABLE_BLACK', seg=8, caps=True, closed=False, twist=0.0):
        """Tube along a polyline using parallel-transport frames. radius: float or per-point list."""
        M = _m(M)
        P = [M @ Vector(p) for p in pts]
        n = len(P)
        if n < 2:
            return []
        rad = radius if isinstance(radius, (list, tuple)) else [radius] * n
        tans = []
        for i in range(n):
            if closed:
                t = (P[(i + 1) % n] - P[i - 1])
            elif i == 0:
                t = P[1] - P[0]
            elif i == n - 1:
                t = P[-1] - P[-2]
            else:
                t = (P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
            if t.length < 1e-9:
                t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
            tans.append(t.normalized())
        nrm = core._any_perp(tans[0])
        bm = self.bm
        rings = []
        allv = []
        for i in range(n):
            if i > 0:
                # parallel transport
                a, b = tans[i - 1], tans[i]
                ax = a.cross(b)
                if ax.length > 1e-9:
                    ang = a.angle(b)
                    nrm = Matrix.Rotation(ang, 3, ax.normalized()) @ nrm
                nrm = (nrm - b * nrm.dot(b)).normalized()
            bnm = tans[i].cross(nrm)
            ring = []
            for k in range(seg):
                a = TAU * k / seg + twist * i
                d = nrm * math.cos(a) + bnm * math.sin(a)
                v = bm.verts.new(P[i] + d * rad[i])
                ring.append(v)
                allv.append(v)
            rings.append(ring)
        faces = []
        last = n if closed else n - 1
        for i in range(last):
            A, B = rings[i], rings[(i + 1) % n]
            for k in range(seg):
                k2 = (k + 1) % seg
                faces.append(bm.faces.new([A[k], A[k2], B[k2], B[k]]))
        if caps and not closed:
            faces.append(bm.faces.new(list(reversed(rings[0]))))
            faces.append(bm.faces.new(rings[-1]))
        return self._finish(allv, faces, mat)

    def prism(self, poly, depth, M=None, mat='MAT_HULL_PAINT', bevel=0.0, seg=2, z0=None, angle=30):
        """Extrude a 2D polygon (local XY, CCW) along +Z by depth (from z0, default centred)."""
        M = _m(M)
        bm = self.bm
        z0 = -depth / 2 if z0 is None else z0
        bot = [bm.verts.new(M @ Vector((x, y, z0))) for x, y in poly]
        top = [bm.verts.new(M @ Vector((x, y, z0 + depth))) for x, y in poly]
        faces = [bm.faces.new(list(reversed(bot))), bm.faces.new(top)]
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new([bot[i], bot[j], top[j], top[i]]))
        self._finish(bot + top, faces, mat)
        if bevel > 0:
            faces = self.bevel(faces, bevel, seg, angle)
        return faces

    def loft(self, rings, M=None, mat='MAT_HULL_PAINT', cap_start=True, cap_end=True, closed=True):
        """Skin a list of rings (each a list of 3D points, equal counts) into quads; optional end caps."""
        M = _m(M)
        bm = self.bm
        R_ = [[bm.verts.new(M @ Vector(p)) for p in ring] for ring in rings]
        n = len(R_[0])
        faces = []
        for j in range(len(R_) - 1):
            A, B = R_[j], R_[j + 1]
            for i in range(n if closed else n - 1):
                i2 = (i + 1) % n
                faces.append(bm.faces.new([A[i], A[i2], B[i2], B[i]]))
        if cap_start:
            faces.append(bm.faces.new(list(reversed(R_[0]))))
        if cap_end:
            faces.append(bm.faces.new(R_[-1]))
        return self._finish([v for r in R_ for v in r], faces, mat)

    def convex(self, planes, center=(0, 0, 0), size=8.0, mat='MAT_HULL_PAINT'):
        """Convex polyhedron = big cube clipped by half-spaces [(point, outward_normal), ...]."""
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=size, matrix=Matrix.Translation(Vector(center)))
        for p, n in planes:
            geom = list(tmp.verts) + list(tmp.edges) + list(tmp.faces)
            bmesh.ops.bisect_plane(tmp, geom=geom, plane_co=Vector(p), plane_no=Vector(n).normalized(),
                                   clear_outer=True)
            bnd = [e for e in tmp.edges if len(e.link_faces) == 1]
            if bnd:
                bmesh.ops.holes_fill(tmp, edges=bnd, sides=0)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        me = bpy.data.meshes.new('_convex')
        tmp.to_mesh(me)
        tmp.free()
        faces = self.append_mesh(me, None, mat_override=mat)
        bpy.data.meshes.remove(me)
        return faces

    def quad(self, corners, mat='MAT_HULL_PAINT', uvs=None, M=None):
        """Single face from 3-4+ corner points (CCW seen from the front). Optional per-corner UVs."""
        M = _m(M)
        vs = [self.bm.verts.new(M @ Vector(c)) for c in corners]
        f = self.bm.faces.new(vs)
        if uvs is not None:
            if self._uv is None:
                self._uv = self.bm.loops.layers.uv.verify()
            for loop, uv in zip(f.loops, uvs):
                loop[self._uv].uv = uv
        self._finish(vs, [f], mat)
        return f

    def grid(self, w, h, nx, ny, M=None, mat='MAT_HULL_PAINT', zfunc=None):
        """Subdivided plane in local XY centred on origin, +Z normal. zfunc(x, y) -> z offset."""
        M = _m(M)
        bm = self.bm
        vs = []
        for j in range(ny + 1):
            row = []
            for i in range(nx + 1):
                x = -w / 2 + w * i / nx
                y = -h / 2 + h * j / ny
                z = zfunc(x, y) if zfunc else 0.0
                row.append(bm.verts.new(M @ Vector((x, y, z))))
            vs.append(row)
        faces = []
        for j in range(ny):
            for i in range(nx):
                faces.append(bm.faces.new([vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]]))
        return self._finish([v for r in vs for v in r], faces, mat)

    def append_mesh(self, me, M=None, mat_override=None):
        """Append a mesh datablock (materials remapped by name)."""
        M = _m(M)
        tmp = bmesh.new()
        tmp.from_mesh(me)
        remap = {}
        for i, m in enumerate(me.materials):
            remap[i] = self.midx(mat_override or (m.name if m else 'MAT_HULL_METAL'))
        if not me.materials:
            remap[0] = self.midx(mat_override or 'MAT_HULL_METAL')
        for f in tmp.faces:
            f.material_index = remap.get(f.material_index, remap.get(0, 0))
        bmesh.ops.transform(tmp, matrix=M, verts=tmp.verts)
        me2 = bpy.data.meshes.new('_tmp')
        tmp.to_mesh(me2)
        tmp.free()
        n0 = len(self.bm.verts)
        self.bm.from_mesh(me2)
        bpy.data.meshes.remove(me2)
        self.bm.verts.ensure_lookup_table()
        newv = [self.bm.verts[i] for i in range(n0, len(self.bm.verts))]
        faces = list({f for v in newv for f in v.link_faces})
        for f in faces:
            f.smooth = True
        self._track(newv)
        return faces

    def curve_pipe(self, pts, radius, mat='MAT_HULL_METAL', M=None, bevel_res=1, res_u=3, poly=False, caps=True,
                   tilt=None):
        """Pipe/cable through control points using a Blender curve with bevel depth, converted to mesh."""
        cu = bpy.data.curves.new('_pipe', 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_mode = 'ROUND'
        cu.bevel_depth = radius
        cu.bevel_resolution = bevel_res
        cu.resolution_u = res_u
        cu.use_fill_caps = caps
        cu.twist_mode = 'MINIMUM'
        if poly:
            sp = cu.splines.new('POLY')
            sp.points.add(len(pts) - 1)
            for i, p in enumerate(pts):
                sp.points[i].co = (*p, 1.0)
        else:
            sp = cu.splines.new('BEZIER')
            sp.bezier_points.add(len(pts) - 1)
            for i, p in enumerate(pts):
                b = sp.bezier_points[i]
                b.co = p
                b.handle_left_type = b.handle_right_type = 'AUTO'
                if tilt:
                    b.tilt = tilt[i]
        ob = bpy.data.objects.new('_pipe', cu)
        core.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        me.materials.clear()
        faces = self.append_mesh(me, M, mat_override=mat)
        bpy.data.meshes.remove(me)
        return faces

    # ------------------------------------------------------------------ operations
    def bevel(self, faces, width, seg=2, angle=30, profile=0.5):
        """Angle-limited bevel of the edges bounding `faces`. Returns the updated face set."""
        edges = set()
        lim = math.radians(angle)
        for f in faces:
            if not f.is_valid:
                continue
            for e in f.edges:
                if len(e.link_faces) == 2:
                    try:
                        if e.calc_face_angle() > lim:
                            edges.add(e)
                    except ValueError:
                        pass
        if not edges:
            return faces
        res = bmesh.ops.bevel(self.bm, geom=list(edges), offset=width, offset_type='OFFSET', segments=seg,
                              profile=profile, affect='EDGES', clamp_overlap=True, material=-1,
                              harden_normals=False)
        newf = res['faces']
        for f in newf:
            f.smooth = True
        newv = res['verts']
        self._track(newv)
        return [f for f in faces if f.is_valid] + list(newf)

    def inset(self, faces, thickness, depth=0.0, individual=True):
        """Inset faces (panel seams when depth < 0 on a thin border). Returns the inner faces."""
        faces = [f for f in faces if f.is_valid]
        if individual:
            r = bmesh.ops.inset_individual(self.bm, faces=faces, thickness=thickness, depth=depth,
                                           use_even_offset=True)
        else:
            r = bmesh.ops.inset_region(self.bm, faces=faces, thickness=thickness, depth=depth,
                                       use_even_offset=True)
        for f in r['faces']:
            f.smooth = True
        return faces

    def seam_panel(self, face, border, groove_w=0.008, groove_d=0.006, raise_=0.0):
        """Panel seam: inset a face, then a narrow inset sunk below the surface (a groove), optional raise."""
        if not face.is_valid:
            return None
        r1 = bmesh.ops.inset_individual(self.bm, faces=[face], thickness=border, depth=0.0, use_even_offset=True)
        r2 = bmesh.ops.inset_individual(self.bm, faces=[face], thickness=groove_w, depth=-groove_d,
                                        use_even_offset=True)
        r3 = bmesh.ops.inset_individual(self.bm, faces=[face], thickness=0.0005, depth=groove_d + raise_,
                                        use_even_offset=True)
        return face

    def wrinkle(self, faces, amp, scale, seed=0.0, sharp=0.6):
        """Crinkle (MLI) displacement along vertex normals: ridged noise, deterministic."""
        verts = list({v for f in faces if f.is_valid for v in f.verts})
        self.bm.normal_update()
        off = Vector((seed * 13.17, seed * 7.31, seed * 3.77))
        disp = []
        for v in verts:
            p = v.co * (1.0 / scale) + off
            n1 = noise.noise(p, noise_basis='PERLIN_ORIGINAL')
            n2 = noise.noise(p * 2.7 + Vector((5.2, 1.3, 7.7)), noise_basis='PERLIN_ORIGINAL')
            ridged = (1.0 - abs(n1)) ** 2 * sharp + n2 * (1 - sharp)
            disp.append((v, v.normal.copy() * (ridged * amp)))
        for v, d in disp:
            v.co += d

    def subdivide(self, faces, cuts=1):
        edges = list({e for f in faces if f.is_valid for e in f.edges})
        r = bmesh.ops.subdivide_edges(self.bm, edges=edges, cuts=cuts, use_grid_fill=True)
        newv = [g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)]
        self._track(newv)
        return list({f for f in self.bm.faces if f.is_valid and any(v in set(newv) for v in f.verts)}) or faces

    def transform(self, faces, M):
        verts = list({v for f in faces if f.is_valid for v in f.verts})
        bmesh.ops.transform(self.bm, matrix=M, verts=verts)

    def bounds(self):
        if not self.bm.verts:
            return Vector(), Vector()
        xs = [v.co for v in self.bm.verts]
        lo = Vector((min(p.x for p in xs), min(p.y for p in xs), min(p.z for p in xs)))
        hi = Vector((max(p.x for p in xs), max(p.y for p in xs), max(p.z for p in xs)))
        return lo, hi

    # ------------------------------------------------------------------ output
    def to_object(self, name=None, parent=None, origin=None, sharp_angle=32, weighted=True, bevel_mod=None,
                  merge=0.0, free=True, props=None):
        """Create the mesh object. origin: world matrix of the object (mesh is re-expressed relative to it)."""
        name = name or self.name
        bm = self.bm
        if merge > 0:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
        if origin is not None:
            bmesh.ops.transform(bm, matrix=origin.inverted(), verts=bm.verts)
        bm.normal_update()
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        if free:
            bm.free()
        for mn in self.mat_names:
            me.materials.append(mats.get(mn))
        if not self.mat_names:
            me.materials.append(mats.get('MAT_HULL_METAL'))
        me.shade_smooth()
        if sharp_angle is not None:
            me.set_sharp_from_angle(angle=math.radians(sharp_angle))
        ob = bpy.data.objects.new(name, me)
        core.link(ob)
        core.place(ob, origin if origin is not None else Matrix.Identity(4), parent)
        if bevel_mod:
            w, s, a = bevel_mod
            b = ob.modifiers.new('bevel', 'BEVEL')
            b.width = w
            b.segments = s
            b.limit_method = 'ANGLE'
            b.angle_limit = math.radians(a)
            b.use_clamp_overlap = True
            b.miter_outer = 'MITER_ARC'
        if weighted:
            wn = ob.modifiers.new('wnormal', 'WEIGHTED_NORMAL')
            wn.keep_sharp = True
            wn.mode = 'FACE_AREA'
            wn.weight = 50
        if props:
            for k, v in props.items():
                ob[k] = v
        return ob


def regions_union(*builders):
    out = {}
    for b in builders:
        for k, (lo, hi) in b.regions.items():
            if k in out:
                a, c = out[k]
                lo = Vector((min(lo.x, a.x), min(lo.y, a.y), min(lo.z, a.z)))
                hi = Vector((max(hi.x, c.x), max(hi.y, c.y), max(hi.z, c.z)))
            out[k] = (lo, hi)
    return out


def boolean(target, cutter, op='DIFFERENCE', solver='EXACT', transfer_materials=True):
    """Add a boolean modifier ahead of bevel/weighted-normal (booleans run first); the cutter object is
    flagged `_cutter` and deleted by core.finalize() after the stack is applied."""
    m = target.modifiers.new('bool_' + cutter.name, 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = solver
    if transfer_materials:
        try:
            m.material_mode = 'TRANSFER'
        except Exception:
            pass
    first = next((i for i, mod in enumerate(target.modifiers) if mod.type != 'BOOLEAN'), None)
    if first is not None and first < len(target.modifiers) - 1:
        with bpy.context.temp_override(object=target, active_object=target):
            bpy.ops.object.modifier_move_to_index(modifier=m.name, index=first)
    cutter.hide_render = True
    cutter.display_type = 'WIRE'
    cutter['_cutter'] = True
    return m
