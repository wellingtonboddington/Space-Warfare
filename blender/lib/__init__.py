"""SEVERANCE Blender asset library (headless bpy 5.2.3).

Modules
  core      scene reset, transforms/frames, empties, cameras, parenting, modifier application, joins
  mats      the contract material library (docs/ASSETS.md section 1.2)
  geo       MeshBuilder: bmesh primitives (box, cylinder, lathe, sphere, torus, sweep, prism), per-part
            angle-limited bevels, panel-seam insets, curve pipes, wrinkle displacement, region tracking
  kit       reusable greeble / kit-part library (bolts, access panels, pipes with clamps, twisted looms,
            valves, connectors, umbilicals, handrails, star trackers, antennas, dishes, RCS quads, tanks
            with weld seams, trusses, radiator panels, MLI blankets, nozzles, gimbals ...)
  masks     COLOR_0 vertex masks: R = ray-cast AO, G = convex edge wear, B = concave cavity
  export    glTF export with the contract options, triangle counting, hull_layout extraction
  render    Cycles CPU preview renders (hard sun, black world)
  fracture  Voronoi bisect fracture for debris
"""
