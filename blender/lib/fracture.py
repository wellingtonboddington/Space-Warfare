"""Voronoi bisect fracture for debris.

A closed source mesh is cut into convex-cell pieces: for each seed the mesh is clipped by the perpendicular
bisector half-space against every other seed (bmesh.ops.bisect_plane with clear_outer), the cut is capped, and
vertices created by the cuts (not present in the source) are jittered with 3D noise so the fracture edges read
as torn rather than sliced. Plates can additionally be bent (rotation proportional to distance from an axis).
"""
import math
import bmesh
from mathutils import Vector, Matrix, noise


def _mark(bm):
    lay = bm.verts.layers.float.get('orig') or bm.verts.layers.float.new('orig')
    for v in bm.verts:
        v[lay] = 1.0
    return lay


def cell(me, seeds, i, cap_mat=0, tear=0.012, tear_scale=0.05, seed=0.0, jitter_planes=0.0, rng=None):
    """Return a bmesh holding the Voronoi cell i of mesh `me` (seeds in mesh space)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    lay = _mark(bm)
    s = Vector(seeds[i])
    for j, t in enumerate(seeds):
        if j == i:
            continue
        t = Vector(t)
        n = (t - s).normalized()
        if jitter_planes and rng:
            n = (n + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jitter_planes).normalized()
        p = (s + t) * 0.5
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=p, plane_no=n, clear_outer=True)
        if not bm.faces:
            bm.free()
            return None
        bnd = [e for e in bm.edges if len(e.link_faces) == 1]
        if bnd:
            r = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
            for f in r['faces']:
                f.material_index = cap_mat
                f.smooth = False
    if not bm.faces:
        bm.free()
        return None
    # tear: jitter vertices created by the cuts
    off = Vector((seed * 5.1, seed * 2.3, seed * 7.9))
    for v in bm.verts:
        if v[lay] < 0.5:
            q = v.co * (1.0 / tear_scale) + off
            d = Vector((noise.noise(q), noise.noise(q + Vector((17.0, 3.0, 5.0))), noise.noise(q + Vector((3.0, 29.0, 11.0)))))
            v.co += d * tear
    # caps stay n-gons: they are triangulated after core.canonicalize, which keeps the result deterministic
    return bm


def bend(bm, axis_point, axis_dir, along, deg_per_m):
    """Curl a plate: rotate each vertex about axis_dir (through axis_point) by an angle proportional to its
    distance along `along` from the axis."""
    ap, ad, al = Vector(axis_point), Vector(axis_dir).normalized(), Vector(along).normalized()
    for v in bm.verts:
        d = (v.co - ap).dot(al)
        if d <= 0:
            continue
        Rm = Matrix.Rotation(math.radians(deg_per_m * d), 3, ad)
        v.co = Rm @ (v.co - ap) + ap


def tri_count(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)
