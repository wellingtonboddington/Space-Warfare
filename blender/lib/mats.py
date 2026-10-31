"""Contract material library (docs/ASSETS.md 1.2). Principled BSDF only; the runtime keys on the names.

Additions beyond the contract table (documented in blender/README.md "As-built notes"):
  MAT_PAINT_RED / MAT_PAINT_AMBER / MAT_PAINT_YELLOW / MAT_PAINT_WHITE  accent paint (guards, AI bezel,
                     warning stripes, dial ticks)
  MAT_HIVIS          civilian high-visibility orange (hauler markings)
  MAT_SOLAR_CELL     depot solar array cells
  MAT_EYE            pilot sclera
"""
import bpy

# name: (base_rgb, metallic, roughness, extra)
SPEC = {
    'MAT_HULL_PAINT':     ((0.60, 0.60, 0.60), 0.0, 0.55, {}),
    'MAT_HULL_METAL':     ((0.74, 0.74, 0.75), 1.0, 0.45, {}),
    'MAT_DARK_COMPOSITE': ((0.055, 0.058, 0.062), 0.0, 0.62, {}),
    'MAT_MLI_GOLD':       ((1.00, 0.71, 0.29), 1.0, 0.24, {}),
    'MAT_MLI_SILVER':     ((0.86, 0.87, 0.89), 1.0, 0.20, {}),
    'MAT_RADIATOR':       ((0.86, 0.86, 0.84), 0.0, 0.48, {}),
    'MAT_ENGINE_BELL':    ((0.36, 0.28, 0.22), 1.0, 0.5, {}),
    'MAT_GLASS':          ((0.02, 0.025, 0.03), 0.0, 0.04, {'alpha': 0.22}),
    'MAT_RUBBER':         ((0.025, 0.025, 0.025), 0.0, 0.88, {}),
    'MAT_CABLE_BLACK':    ((0.018, 0.018, 0.018), 0.0, 0.55, {}),
    'MAT_CABLE_GREY':     ((0.30, 0.30, 0.30), 0.0, 0.55, {}),
    'MAT_CABLE_RED':      ((0.55, 0.035, 0.025), 0.0, 0.50, {}),
    'MAT_CABLE_YELLOW':   ((0.78, 0.55, 0.02), 0.0, 0.50, {}),
    'MAT_PANEL_GREY':     ((0.105, 0.11, 0.115), 0.35, 0.52, {}),
    'MAT_PANEL_BLACK':    ((0.025, 0.025, 0.027), 0.0, 0.42, {}),
    'MAT_SEAT':           ((0.11, 0.115, 0.10), 0.0, 0.92, {}),
    'MAT_SUIT':           ((0.60, 0.61, 0.58), 0.0, 0.82, {}),
    'MAT_SUIT_DARK':      ((0.06, 0.065, 0.075), 0.0, 0.70, {}),
    'MAT_SKIN':           ((0.56, 0.39, 0.31), 0.0, 0.55, {}),
    'MAT_VISOR':          ((0.05, 0.05, 0.045), 0.0, 0.03, {'alpha': 0.28}),
    'MAT_HELMET':         ((0.80, 0.80, 0.78), 0.0, 0.32, {}),
    'MAT_LABELS':         ((0.80, 0.80, 0.80), 0.3, 0.50, {}),
    'MAT_DECALS':         ((0.90, 0.90, 0.90), 0.0, 0.55, {}),
    'MAT_LIGHT':          ((0.20, 0.20, 0.20), 0.0, 0.30, {'emit': (1.0, 1.0, 1.0), 'emit_strength': 1.0}),
    'MAT_EMISSIVE_WARM':  ((0.30, 0.20, 0.12), 0.0, 0.40, {'emit': (1.0, 0.62, 0.30), 'emit_strength': 3.0}),
    # additions
    'MAT_PAINT_RED':      ((0.50, 0.04, 0.03), 0.0, 0.55, {}),
    'MAT_PAINT_AMBER':    ((0.80, 0.42, 0.04), 0.0, 0.50, {}),
    'MAT_PAINT_YELLOW':   ((0.80, 0.62, 0.05), 0.0, 0.55, {}),
    'MAT_PAINT_WHITE':    ((0.82, 0.82, 0.80), 0.0, 0.50, {}),
    'MAT_HIVIS':          ((0.95, 0.30, 0.02), 0.0, 0.55, {}),
    'MAT_SOLAR_CELL':     ((0.015, 0.03, 0.09), 0.6, 0.18, {}),
    'MAT_EYE':            ((0.80, 0.78, 0.75), 0.0, 0.25, {}),
}


def _principled(mat):
    if mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    for n in nt.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    out = None
    for n in nt.nodes:
        if n.type == 'OUTPUT_MATERIAL':
            out = n
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    if out is None:
        out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return bsdf


def get(name):
    """Return (create on first use) the material `name`. MAT_SCREEN_<id> is generated on demand."""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    if name.startswith('MAT_SCREEN_'):
        spec = ((0.01, 0.012, 0.012), 0.0, 0.12, {'emit': (0.02, 0.05, 0.03), 'emit_strength': 1.0})
    else:
        spec = SPEC[name]
    base, metal, rough, extra = spec
    m = bpy.data.materials.new(name)
    b = _principled(m)
    b.inputs['Base Color'].default_value = (*base, 1.0)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if 'emit' in extra:
        b.inputs['Emission Color'].default_value = (*extra['emit'], 1.0)
        b.inputs['Emission Strength'].default_value = extra['emit_strength']
    if 'alpha' in extra:
        b.inputs['Alpha'].default_value = extra['alpha']
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    m.diffuse_color = (*base, 1.0)
    m.metallic = metal
    m.roughness = rough
    return m


def preview_mode(on=True):
    """Preview renders only (never exported): drive Base Color with the COLOR_0 masks the way the runtime
    shader does, roughly: AO darkens, cavity adds grime, edge wear exposes bare metal on paint."""
    for m in bpy.data.materials:
        if m.node_tree is None:
            continue
        nt = m.node_tree
        b = None
        for n in nt.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                b = n
        if b is None or 'mask_preview' in nt.nodes:
            continue
        sock = b.inputs['Base Color']
        base = tuple(sock.default_value)
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.name = 'mask_preview'
        attr.attribute_name = 'Mask'
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(attr.outputs['Color'], sep.inputs['Color'])
        # ao factor = 0.25 + 0.75 * R ; grime = 1 - 0.45 * B
        ao = nt.nodes.new('ShaderNodeMath'); ao.operation = 'MULTIPLY_ADD'
        nt.links.new(sep.outputs['Red'], ao.inputs[0]); ao.inputs[1].default_value = 0.75; ao.inputs[2].default_value = 0.25
        gr = nt.nodes.new('ShaderNodeMath'); gr.operation = 'MULTIPLY_ADD'
        nt.links.new(sep.outputs['Blue'], gr.inputs[0]); gr.inputs[1].default_value = -0.45; gr.inputs[2].default_value = 1.0
        f = nt.nodes.new('ShaderNodeMath'); f.operation = 'MULTIPLY'
        nt.links.new(ao.outputs[0], f.inputs[0]); nt.links.new(gr.outputs[0], f.inputs[1])
        col = nt.nodes.new('ShaderNodeMix'); col.data_type = 'RGBA'; col.blend_type = 'MIX'
        col.inputs['Factor'].default_value = 0.0
        col.inputs['A'].default_value = base
        worn = (0.62, 0.62, 0.63, 1.0)
        col.inputs['B'].default_value = worn
        if m.name in ('MAT_HULL_PAINT', 'MAT_PANEL_GREY', 'MAT_PANEL_BLACK', 'MAT_PAINT_RED', 'MAT_PAINT_AMBER',
                      'MAT_PAINT_YELLOW', 'MAT_HIVIS', 'MAT_HELMET'):
            wear = nt.nodes.new('ShaderNodeMath'); wear.operation = 'MULTIPLY'
            nt.links.new(sep.outputs['Green'], wear.inputs[0]); wear.inputs[1].default_value = 0.55
            nt.links.new(wear.outputs[0], col.inputs['Factor'])
        mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        nt.links.new(col.outputs['Result'], mul.inputs['A'])
        comb = nt.nodes.new('ShaderNodeCombineColor')
        for k in ('Red', 'Green', 'Blue'):
            nt.links.new(f.outputs[0], comb.inputs[k])
        nt.links.new(comb.outputs['Color'], mul.inputs['B'])
        nt.links.new(mul.outputs['Result'], sock)
