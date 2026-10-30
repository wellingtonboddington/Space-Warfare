"""glTF export with the contract options + hull_layout extraction (docs/ASSETS.md sections 0 and 3)."""
import re
import bpy
from . import core

ANCHOR_RE = re.compile(r'^(HP_.*|CAM_.*|COCKPIT_ANCHOR|RAD_[LR]2?|TEL_(AZ|EL)|LCOM_(AZ|EL)|PD_\d+_(AZ|EL))$')


def cleanup_for_export():
    """Remove helper objects (boolean cutters etc.) and private (underscore) custom properties."""
    for o in list(bpy.context.scene.objects):
        if o.get('_cutter'):
            core.remove(o)
    for o in bpy.context.scene.objects:
        for k in [k for k in o.keys() if k.startswith('_')]:
            del o[k]


def export_glb(path, cameras=False, objects=None):
    cleanup_for_export()
    sel = objects is not None
    if sel:
        keep = set(o for o in objects if o.name in bpy.context.scene.objects)
        for o in bpy.context.scene.objects:
            o.select_set(o in keep)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB', export_yup=True, export_apply=True, export_extras=True,
        export_cameras=cameras, export_lights=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True, export_morph=True, export_morph_normal=True,
        export_skins=True, export_animations=False, export_draco_mesh_compression_enable=False,
        export_materials='EXPORT', export_texcoords=True, export_normals=True, export_tangents=False,
        export_image_format='NONE', use_selection=sel, check_existing=False)


def _r(x, n=4):
    return [round(float(v), n) + 0.0 for v in x]


def layout(root=None, objs=None):
    """hull_layout entry: HIT boxes, anchors, bounds and triangle count of `objs` (default: whole scene).
    Positions are root-frame (== world, roots sit at the origin) at the rest pose. A `parent` custom
    property overrides the reported parent (kit nodes that the runtime re-attaches to chassis nodes)."""
    objs = list(objs) if objs is not None else list(bpy.context.scene.objects)
    hit, anchors = {}, {}

    def pname(o):
        if o.get('parent'):
            return str(o['parent'])
        p = o.parent
        if p is None or p == root:
            return None
        return p.name

    for o in sorted(objs, key=lambda o: o.name):
        if o.name.startswith('HIT_'):
            M = core.world(o)
            sc = M.to_scale()
            hit[o.name[4:]] = {'c': _r(M.translation), 'h': _r([abs(sc.x), abs(sc.y), abs(sc.z)]),
                               'parent': pname(o)}
        elif ANCHOR_RE.match(o.name) and o.type in ('EMPTY', 'CAMERA', 'MESH'):
            M = core.world(o)
            q = M.to_quaternion()
            anchors[o.name] = {'p': _r(M.translation), 'q': _r([q.w, q.x, q.y, q.z], 5), 'parent': pname(o)}
    meshes = [o for o in objs if o.type == 'MESH']
    lo, hi = core.world_bounds(meshes)
    return {'hit': hit, 'anchors': anchors, 'bounds': {'min': _r(lo, 3), 'max': _r(hi, 3)},
            'tris': core.tri_count(meshes)}
