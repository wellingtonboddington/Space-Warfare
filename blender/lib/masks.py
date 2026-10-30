"""COLOR_0 vertex masks (docs/ASSETS.md 1.1), written as a FLOAT_COLOR point attribute named 'Mask' and
exported with export_vertex_color='ACTIVE' (arrives in three.js as geometry.attributes.color, linear).

R = ambient occlusion: cosine-weighted hemisphere ray casts against a BVH of the *whole assembled asset*
    (world space, rest pose), so a tank strut darkens the tank and a panel recess darkens its bolts.
G = edge wear: convex dihedral curvature summed per vertex (bevel strips light up), lightly diffused.
B = cavity / grime: concave curvature plus short-range occlusion (crevices between touching parts).
"""
import math
import random
import numpy as np
import bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from . import core


def _hemisphere_dirs(n, seed=7):
    """Cosine-weighted directions on the +Z hemisphere (Fibonacci spiral, deterministic)."""
    dirs = []
    ga = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        u = (i + 0.5) / n
        r = math.sqrt(u)
        a = i * ga
        dirs.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1.0 - u)))))
    return dirs


def build_bvh(objs):
    verts, polys = [], []
    for o in objs:
        M = core.world(o)
        me = o.data
        base = len(verts)
        verts.extend([M @ v.co for v in me.vertices])
        me.calc_loop_triangles()
        polys.extend([(base + t.vertices[0], base + t.vertices[1], base + t.vertices[2]) for t in me.loop_triangles])
    return BVHTree.FromPolygons(verts, polys, all_triangles=True, epsilon=0.0)


def bake(objs=None, ao_dist=1.5, crevice=0.04, samples=24, eps=None, ao_gain=1.0, wear_gain=1.0,
         cavity_gain=1.0, occluders=None, seed=1):
    """Compute and store the masks on every mesh object in `objs` (default: all scene meshes)."""
    objs = [o for o in (objs if objs is not None else core.mesh_objects()) if o.type == "MESH"]
    bvh = build_bvh(occluders or objs)
    dirs = _hemisphere_dirs(samples)
    eps = eps if eps is not None else max(ao_dist * 0.0015, 0.0004)
    rng = random.Random(seed)
    for o in objs:
        me = o.data
        M = core.world(o)
        N3 = M.to_3x3().inverted_safe().transposed()
        nv = len(me.vertices)
        if nv == 0:
            continue
        # --- curvature (topological, object space is fine: it is scale-free per edge angle)
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        conv = [0.0] * nv
        conc = [0.0] * nv
        for e in bm.edges:
            if len(e.link_faces) != 2:
                # open boundary edges (thin plates, cable ends) read as worn edges
                for v in e.verts:
                    conv[v.index] += 0.6
                continue
            try:
                a = e.calc_face_angle_signed()
            except ValueError:
                continue
            if a > 0:
                for v in e.verts:
                    conv[v.index] += a
            else:
                for v in e.verts:
                    conc[v.index] -= a
        # one diffusion pass so bevel strips read as a band, not a pixel line
        nbrs = [[l.other_vert(v).index for l in v.link_edges] for v in bm.verts]
        conv2 = [0.0] * nv
        conc2 = [0.0] * nv
        for i in range(nv):
            nb = nbrs[i]
            if nb:
                conv2[i] = 0.6 * conv[i] + 0.4 * sum(conv[j] for j in nb) / len(nb)
                conc2[i] = 0.6 * conc[i] + 0.4 * sum(conc[j] for j in nb) / len(nb)
            else:
                conv2[i], conc2[i] = conv[i], conc[i]
        bm.free()
        # --- AO ray casts in world space (frames vectorised with numpy; the loop only casts rays)
        co = np.empty(nv * 3, dtype=np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(nv, 3)
        nn = np.empty(nv * 3, dtype=np.float64)
        me.vertices.foreach_get('normal', nn)
        nn = nn.reshape(nv, 3)
        Mn = np.array(M)
        P = co @ Mn[:3, :3].T + Mn[:3, 3]
        Nw = nn @ np.array(N3).T
        ln = np.linalg.norm(Nw, axis=1, keepdims=True)
        Nw = np.where(ln > 1e-9, Nw / np.maximum(ln, 1e-12), np.array([0.0, 0.0, 1.0]))
        a = np.where(np.abs(Nw[:, :1]) < 0.9, np.array([[1.0, 0, 0]]), np.array([[0, 1.0, 0]]))
        Tg = a - Nw * np.sum(a * Nw, axis=1, keepdims=True)
        Tg /= np.linalg.norm(Tg, axis=1, keepdims=True)
        Bt = np.cross(Nw, Tg)
        rot = np.array([rng.random() * math.tau for _ in range(nv)])
        c, s = np.cos(rot)[:, None], np.sin(rot)[:, None]
        Tg, Bt = Tg * c + Bt * s, Bt * c - Tg * s
        Dl = np.array([[d.x, d.y, d.z] for d in dirs])
        W = (Tg[:, None, :] * Dl[None, :, 0:1] + Bt[:, None, :] * Dl[None, :, 1:2] + Nw[:, None, :] * Dl[None, :, 2:3])
        O = (P + Nw * eps).tolist()
        W = W.tolist()
        cols = [0.0] * (nv * 4)
        ray = bvh.ray_cast
        K = len(dirs)
        for i in range(nv):
            org = O[i]
            occ = 0.0
            crev = 0.0
            for w in W[i]:
                hit = ray(org, w, ao_dist)
                if hit[0] is not None:
                    dist = hit[3]
                    occ += 1.0 - 0.65 * (dist / ao_dist)
                    if dist < crevice:
                        crev += 1.0 - dist / crevice
            ao = 1.0 - min(1.0, ao_gain * occ / K)
            ao = max(0.0, min(1.0, ao)) ** 1.15
            wear = min(1.0, wear_gain * conv2[i] / (0.5 * math.pi))
            wear = wear * wear * (3 - 2 * wear)
            cav = max(min(1.0, cavity_gain * conc2[i] / (0.5 * math.pi)), min(1.0, 2.2 * crev / K))
            k = i * 4
            cols[k] = ao
            cols[k + 1] = wear
            cols[k + 2] = cav
            cols[k + 3] = 1.0
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
        attr = me.color_attributes.new('Mask', 'FLOAT_COLOR', 'POINT')
        attr.data.foreach_set('color', cols)
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = 0
