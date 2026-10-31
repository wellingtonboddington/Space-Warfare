"""Scene / transform / object helpers.

All objects are authored in the asset root frame (Blender: +Y forward, +Z up, +X starboard, metres).
Parenting never uses a parent-inverse matrix: a child's matrix_basis *is* its local transform, so the
glTF node transforms are exactly what the runtime sees.
"""
import math
import bpy
from mathutils import Vector, Matrix, Quaternion

V = Vector
UP = Vector((0.0, 0.0, 1.0))


# ----------------------------------------------------------------------------------------------
# Scene
# ----------------------------------------------------------------------------------------------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    return sc


def scene():
    return bpy.context.scene


def link(ob):
    if ob.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(ob)
    return ob


def all_objects():
    return list(bpy.context.scene.objects)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


# ----------------------------------------------------------------------------------------------
# Frames & transforms
# ----------------------------------------------------------------------------------------------
def vec(v):
    return v.copy() if isinstance(v, Vector) else Vector(v)


def frame(loc=(0, 0, 0), z=None, y=None, x=None):
    """Orthonormal frame (4x4) at loc. Give the primary axis (z, or y) and a hint for a second axis.
    z+y: z exact, y orthogonalised.   y+z: pass y first by giving only y and z=None? -> use frame_y.
    """
    loc = vec(loc)
    if z is not None:
        Z = vec(z).normalized()
        if y is not None:
            Y = vec(y)
            Y = (Y - Z * Y.dot(Z))
            if Y.length < 1e-6:
                Y = _any_perp(Z)
            Y.normalize()
            X = Y.cross(Z)
        elif x is not None:
            X = vec(x)
            X = (X - Z * X.dot(Z))
            if X.length < 1e-6:
                X = _any_perp(Z)
            X.normalize()
            Y = Z.cross(X)
        else:
            X = _any_perp(Z)
            Y = Z.cross(X)
    elif y is not None:
        Y = vec(y).normalized()
        hint = vec(x) if x is not None else (UP if abs(Y.dot(UP)) < 0.95 else Vector((1, 0, 0)))
        if x is not None:
            X = (hint - Y * hint.dot(Y)).normalized()
            Z = X.cross(Y)
        else:
            Z = (hint - Y * hint.dot(Y)).normalized()
            X = Y.cross(Z)
    else:
        X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = X[i], Y[i], Z[i], loc[i]
    return m


def _any_perp(z):
    a = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
    return (a - z * a.dot(z)).normalized()


def look_frame(loc, target, up=UP):
    """Camera / light convention: local -Z looks at target, local +Y is as close to `up` as possible."""
    loc = vec(loc)
    f = (vec(target) - loc).normalized()
    Z = -f
    u = vec(up)
    if abs(u.dot(Z)) > 0.98:
        u = Vector((0, 1, 0)) if abs(Z.y) < 0.9 else Vector((1, 0, 0))
    X = u.cross(Z).normalized()
    Y = Z.cross(X)
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = X[i], Y[i], Z[i], loc[i]
    return m


def T(x=0.0, y=0.0, z=0.0):
    if isinstance(x, (tuple, list, Vector)):
        return Matrix.Translation(vec(x))
    return Matrix.Translation((x, y, z))


def R(axis, deg):
    """Rotation matrix about 'X'|'Y'|'Z' or a vector, degrees."""
    if isinstance(axis, str):
        return Matrix.Rotation(math.radians(deg), 4, axis)
    return Matrix.Rotation(math.radians(deg), 4, vec(axis))


def S(sx, sy=None, sz=None):
    if sy is None:
        sy = sz = sx
    m = Matrix.Identity(4)
    m[0][0], m[1][1], m[2][2] = sx, sy, sz
    return m


def world(ob):
    """World matrix computed from matrix_basis chain (no depsgraph needed)."""
    if ob is None:
        return Matrix.Identity(4)
    m = ob.matrix_basis.copy()
    p = ob.parent
    if p is None:
        return m
    if ob.parent_type == 'BONE' and ob.parent_bone:
        b = p.data.bones[ob.parent_bone]
        return world(p) @ b.matrix_local @ T(0, b.length, 0) @ ob.matrix_parent_inverse @ m
    return world(p) @ ob.matrix_parent_inverse @ m


def place(ob, M_world, parent=None):
    """Set ob's world matrix to M_world, parented (no inverse) to parent."""
    ob.parent = parent
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.matrix_basis = (world(parent).inverted() @ M_world) if parent is not None else M_world.copy()
    return ob


def reparent(ob, parent):
    place(ob, world(ob), parent)


# ----------------------------------------------------------------------------------------------
# Empties & cameras
# ----------------------------------------------------------------------------------------------
def empty(name, M=None, parent=None, display='PLAIN_AXES', size=0.1, props=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = display
    ob.empty_display_size = size
    link(ob)
    place(ob, M if M is not None else Matrix.Identity(4), parent)
    if props:
        for k, v in props.items():
            ob[k] = v
    return ob


def hit_box(component, lo, hi, parent=None, pad=0.0):
    """HIT_<component>: CUBE empty, scale = half extents of an axis-aligned box (root frame), no rotation."""
    lo, hi = vec(lo), vec(hi)
    c = (lo + hi) * 0.5
    h = (hi - lo) * 0.5 + Vector((pad, pad, pad))
    h = Vector((max(h.x, 0.02), max(h.y, 0.02), max(h.z, 0.02)))
    M = T(c) @ S(h.x, h.y, h.z)
    ob = empty('HIT_' + component, M, parent, display='CUBE', size=1.0)
    return ob


def camera(name, loc, target, fov_v_deg, parent=None, up=UP, clip=(0.02, 4000.0)):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(fov_v_deg)
    cd.clip_start, cd.clip_end = clip
    ob = bpy.data.objects.new(name, cd)
    link(ob)
    place(ob, look_frame(loc, target, up), parent)
    return ob


# ----------------------------------------------------------------------------------------------
# Finalisation: modifiers -> real geometry, joins
# ----------------------------------------------------------------------------------------------
def apply_all_modifiers(objs=None):
    """Bake every modifier stack into plain mesh data (one depsgraph evaluation for the whole scene)."""
    objs = [o for o in (objs if objs is not None else mesh_objects()) if o.type == "MESH" and len(o.modifiers)
            and not any(m.type == "ARMATURE" for m in o.modifiers) and not o.data.shape_keys]   # skinned / morphs stay live
    if not objs:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    new = []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        new.append((o, me))
    for o, me in new:
        old = o.data
        o.modifiers.clear()
        o.data = me
        me.name = o.name
        if old.users == 0:
            bpy.data.meshes.remove(old)


def canonicalize(ob):
    """Rebuild a finished mesh in a canonical element order so the exported bytes depend only on the geometry.
    Blender's C bmesh operators / modifiers (bevel, boolean, solidify ...) iterate pointer-keyed hash maps, so their
    output element order follows memory layout and changes between runs. Vertices are sorted by position (ties
    broken by neighbourhood), faces rotated to start at their lowest vertex and sorted; materials, smooth flags,
    sharp edges, UV maps and custom split normals are carried across. Skinned / shape-keyed meshes are left alone."""
    import numpy as np
    if ob.type != 'MESH' or ob.data.shape_keys or any(m.type == 'ARMATURE' for m in ob.modifiers) or ob.modifiers:
        return
    me = ob.data
    nv, nl, npl, ne = len(me.vertices), len(me.loops), len(me.polygons), len(me.edges)
    if nv == 0 or npl == 0:
        return
    co = np.empty(nv * 3, np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(nv, 3)
    lv = np.empty(nl, np.int64)
    me.loops.foreach_get('vertex_index', lv)
    ls = np.empty(npl, np.int64)
    me.polygons.foreach_get('loop_start', ls)
    lt = np.empty(npl, np.int64)
    me.polygons.foreach_get('loop_total', lt)
    mi = np.empty(npl, np.int64)
    me.polygons.foreach_get('material_index', mi)
    sm = np.empty(npl, bool)
    me.polygons.foreach_get('use_smooth', sm)
    ev = np.empty(ne * 2, np.int64)
    me.edges.foreach_get('vertices', ev)
    ev = ev.reshape(ne, 2)
    sharp = set()
    if 'sharp_edge' in me.attributes:
        se = np.zeros(ne, bool)
        me.attributes['sharp_edge'].data.foreach_get('value', se)
        sharp = {(int(a), int(b)) for a, b in ev[se]}
    custom = me.has_custom_normals
    cn = None
    if custom:
        cn = np.empty(nl * 3, np.float64)
        me.corner_normals.foreach_get('vector', cn)
        cn = cn.reshape(nl, 3)
    uvs = []
    for layer in me.uv_layers:
        u = np.empty(nl * 2, np.float64)
        layer.data.foreach_get('uv', u)
        uvs.append((layer.name, u.reshape(nl, 2)))
    # vertex order: position, then summed neighbour position, then valence
    nsum = np.zeros((nv, 3))
    np.add.at(nsum, ev[:, 0], co[ev[:, 1]])
    np.add.at(nsum, ev[:, 1], co[ev[:, 0]])
    val = np.bincount(ev.ravel(), minlength=nv)
    r = lambda a: np.round(a, 7)
    order = np.lexsort((val, r(nsum[:, 2]), r(nsum[:, 1]), r(nsum[:, 0]), r(co[:, 2]), r(co[:, 1]), r(co[:, 0])))
    new_of = np.empty(nv, np.int64)
    new_of[order] = np.arange(nv)
    faces = []
    for p in range(npl):
        lidx = list(range(ls[p], ls[p] + lt[p]))
        vids = [int(new_of[lv[l]]) for l in lidx]
        k = vids.index(min(vids))
        faces.append((int(mi[p]), vids[k:] + vids[:k], lidx[k:] + lidx[:k], bool(sm[p])))
    faces.sort(key=lambda f: (f[0], f[1]))
    me2 = bpy.data.meshes.new(me.name)
    me2.from_pydata(co[order].tolist(), [], [f[1] for f in faces])
    for m in me.materials:
        me2.materials.append(m)
    me2.polygons.foreach_set('material_index', [f[0] for f in faces])
    me2.polygons.foreach_set('use_smooth', [f[3] for f in faces])
    lorder = [l for f in faces for l in f[2]]
    # from_pydata creates loops in face order, so new loop k corresponds to old loop lorder[k]
    for name, u in uvs:
        layer = me2.uv_layers.new(name=name)
        layer.data.foreach_set('uv', u[lorder].ravel())
    if sharp:
        old_pairs = {(int(new_of[a]), int(new_of[b])) for a, b in sharp}
        old_pairs |= {(b, a) for a, b in old_pairs}
        ev2 = np.empty(len(me2.edges) * 2, np.int64)
        me2.edges.foreach_get('vertices', ev2)
        ev2 = ev2.reshape(-1, 2)
        flags = [(int(a), int(b)) in old_pairs for a, b in ev2]
        attr = me2.attributes.get('sharp_edge') or me2.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
        attr.data.foreach_set('value', flags)
    if custom:
        me2.normals_split_custom_set([tuple(v) for v in cn[lorder]])
    old = ob.data
    ob.data = me2
    me2.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)


def finalize(objs=None):
    """Apply every modifier stack, then delete boolean cutters / helpers flagged `_cutter`."""
    apply_all_modifiers(objs)
    for o in list(bpy.context.scene.objects):
        if o.get('_cutter'):
            remove(o)


def join(objs, name=None):
    """Join mesh objects into objs[0] (keeps custom normals, materials, attributes)."""
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        if name:
            objs[0].name = name
        return objs[0]
    target = objs[0]
    with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs,
                                   selected_editable_objects=objs):
        bpy.ops.object.join()
    if name:
        target.name = name
        target.data.name = name
    return target


def tri_count(objs=None):
    n = 0
    for o in (objs if objs is not None else mesh_objects()):
        if o.type != 'MESH':
            continue
        me = o.data
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
    return n


def world_bounds(objs=None):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in (objs if objs is not None else mesh_objects()):
        if o.type != 'MESH':
            continue
        M = world(o)
        for v in o.data.vertices:
            p = M @ v.co
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    return lo, hi


def remove(ob):
    if ob is None:
        return
    for c in list(ob.children):
        remove(c)
    data = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    if data is not None and getattr(data, 'users', 1) == 0:
        if isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
