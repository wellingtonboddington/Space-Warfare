# SEVERANCE — Blender asset pipeline

Headless, deterministic, code-only asset authoring with **Blender 5.2.3 as a Python module** (`pip install bpy==5.2.3`).
The binding contract is [`docs/ASSETS.md`](../docs/ASSETS.md); this folder implements it.

```bash
python3 blender/build_all.py                      # everything (≈ 6 min on 4 CPU cores, no GPU)
python3 blender/build_all.py --only chassis,kkv   # a subset (kits reuse the cached chassis scene)
python3 blender/build_all.py --no-preview         # skip the Cycles previews
python3 blender/textures.py                       # textures only (numpy + Pillow, no bpy needed)
node tools/asset_view.mjs [--only cockpit]        # load every GLB in three.js and screenshot it
```

Outputs: `assets/*.glb`, `assets/tex/*`, `assets/previews/<asset>.png` (Cycles: 3/4 view, one hard sun, black
world), `assets/previews/three_<asset>.png` and `three_report.json` (three.js QA), and `js/data/hull_layout.json`
(generated from the `HIT_*` and anchor empties; entries for assets not rebuilt in a run are kept).
`blender/.cache/` (git-ignored) keeps each finished scene as a `.blend` for QA renders.

## Layout

| file | contents |
|---|---|
| `build_all.py` | driver: reset → build → apply modifier stacks → bake COLOR_0 masks → export GLB → layout → preview |
| `lib/core.py` | scene reset, frames (`frame`, `look_frame`), parent-inverse-free placement, empties, HIT boxes, cameras, joins |
| `lib/geo.py` | `MeshBuilder`: bmesh primitives (box, cyl, lathe/screw profiles, sphere, torus, sweep, prism, loft, convex-from-planes, grid), per-part angle-limited bevels, insets, curve pipes (bevel-depth curves → mesh), wrinkle displacement, region bounds for HIT boxes; booleans |
| `lib/kit.py` | greeble / kit-part library: bolts, bolted access panels, handrails, tie-downs, pipe runs with clamps and brackets, twisted multi-strand looms with P-clamps and lacing, connectors, umbilical ports, valves, star trackers, antennas, dishes, nozzles, RCS quads, vents, equipment boxes, stencil plates, beacons, hinges, spherical/cylindrical tanks with weld seams, box trusses, radiator panels with fluid tubes, MLI blankets, regen-cooled bells, gimbal yokes, two-axis gimbal turrets |
| `lib/masks.py` | COLOR_0: R = AO (cosine-weighted BVH ray casts against the whole assembled asset), G = edge wear (convex dihedral curvature, optional noise-modulated chipping), B = cavity (concave curvature + short-range occlusion) |
| `lib/mats.py` | the contract materials (Principled BSDF) + preview-only mask shading |
| `lib/export.py` | glTF export with the contract options; hull-layout extraction |
| `lib/render.py` | Cycles CPU previews (vertex-fitted framing, OIDN) |
| `lib/fracture.py` | Voronoi bisect fracture with torn edges and plate bending |
| `interceptor.py` | chassis + recon / skirmisher / picket kits |
| `cockpit.py` | cockpit from `js/data/cockpit_layout.json` |
| `pilot.py` | rigged, skinned pilot with face morphs, helmet, visor |
| `gunship.py` `hauler.py` `depot.py` `decoy.py` `kkv.py` `debris.py` | other craft and objects |
| `textures.py` | tiling detail maps, Moon, Earth |

Conventions: 1 unit = 1 m, Blender +Y forward / +Z up / +X starboard, exported Y-up. Every object is authored in
the asset root frame; children never carry a parent-inverse matrix, so node transforms are exactly what three.js
sees. All randomness is seeded (`random.Random`, `numpy.random.default_rng`, positional `mathutils.noise`).

Determinism: Blender's C bmesh operators and modifiers (bevel, boolean, solidify) iterate pointer-keyed hash maps,
so their element order follows memory layout and changes from run to run even with identical geometry. After the
modifier stacks are applied, `core.canonicalize` rebuilds every non-skinned mesh in a canonical order: vertices
sorted by position, faces rotated and sorted, with materials, smooth flags, sharp edges, UVs and custom normals
carried across. Rebuilding then reproduces byte-identical GLBs (verified for `kkv` and `debris` across separate
runs). The builder itself never iterates sets of BMesh elements (`geo._uniq`). The skinned pilot is excluded from
canonicalisation; its geometry is reproducible, but its byte order is not guaranteed.

## Verification (what was checked, and how)

* `tools/asset_view.mjs` bundles three 0.186.1 from `node_modules` with esbuild, embeds each GLB as base64, loads it
  with `GLTFLoader` in headless Chromium (SwiftShader) and prints node names, triangles, morph targets, skins, cameras
  (position and direction converted back to the Blender frame) and the COLOR_0 range of every mesh. Kits are loaded
  as children of the chassis root with identity transforms, exactly like the runtime. The right-hand panel is
  a second check: the radiators stowed with the contract rotations (chassis, picket), the exported `CAM_WIDE`
  (cockpit), morphs plus a bone pose (pilot), or the raw COLOR_0 masks.
* Cockpit label atlas, decal atlas and screens are checked with debug CanvasTextures: captions and placards read
  correctly, and the screen test pattern is upright with (0,0) at the bottom left.
* Pilot: 25 bones; each bone's local +Y points at its child joint (worst deviation 4.3°, at the clavicles); 11 morph
  targets on every `PILOT_BODY` primitive.
* Cockpit at `COCKPIT_ANCHOR`: the window glass of the cockpit and of the `CAPSULE` coincide (4 mm apart by design).

## As-built notes (deviations, additions, runtime notes)

**Naming / node structure**
* Root nodes: `CHASSIS`, `KIT_RECON`, `KIT_SKIRMISHER`, `KIT_PICKET`, `COCKPIT`, `PILOT` (the armature), `GUNSHIP`,
  `HAULER`, `DEPOT`, `KKV`, `DEBRIS`; `decoy.glb` has two roots, `DECOY_SHIP` and `DECOY_KKV`, both at the origin.
  All roots sit at the origin with identity rotation.
* **three.js renames bones**: `GLTFLoader` sanitises node names (`PropertyBinding.sanitizeNodeName` strips `.`), so
  `upper_arm.L` arrives as `upper_armL`. The GLB itself holds the exact contract names. Look bones up with
  `THREE.PropertyBinding.sanitizeNodeName('upper_arm.L')`.
* `PILOT_BODY` exports as a group of skinned primitives (one per material, 10), each carrying the same 11 morph
  targets. Set morph influences on every child mesh, for example with `traverse` and `morphTargetDictionary`.
* Picket `RAD_L2` / `RAD_R2` are root-level nodes of `kit_picket.glb` with glTF extras `{"parent": "RAD_L"}` /
  `{"parent": "RAD_R"}` (a GLB cannot reference a node in another file). The runtime should `attach()` them to the
  chassis node: their rest transform is in the chassis frame, so `attach` keeps the pose. `hull_layout.json` reports
  the same parents. Their HIT boxes are children of `RAD_L2` / `RAD_R2`.
* `HP_ENGINE`, `HP_ENGINE_0/1` and `HP_KKV_MOTOR` keep identity rotation (exhaust along root −Y, as in the default
  layout). Every other `HP_*` has local +Z = exhaust / vent / launch / beam direction.
* Engines are separate nodes: chassis `ENGINE_BELL`, gunship `ENGINE_BELL_0/1`, hauler `ENGINE_BELL`.
* `KKV_<i>` (skirmisher, gunship) are the launch canisters, with their origin at the canister centre.
* Chassis decals on the capsule are children of `CAPSULE`, so hiding the capsule hides them.

**Cockpit control contract**
* Moving nodes hold neutral geometry, and their rest transform is `states[0]`. Every moving node carries glTF extras
  that spell out the animation: `anim` (rotate | translate), `axis` (local X / Z), `unit`, `states`, `values`
  (`values[k]` is the absolute local transform for state k; the rest is `values[0]`).
  Toggles: X +25° (lever down, `states[0]`) and −25°. Guards: X 0° closed, −100° open. Rotaries: Z = `detents`
  (degrees, +ccw seen by the pilot). Valves: Z 0 / 90. Lever: X 0 (stowed), −35, +35. Buttons: Z 0 / −0.004 m.
  Breakers: Z 0 / +0.006 m. Needles carry `sweep`, with the rest at `sweep[0]`. Visor: X 72° (open, the rest) / 0 (closed).
* Gauges have `<id>_BASE` + `<id>_NEEDLE` and no `_MOV`. Items: `PATCH_KIT` (mesh, child `PATCH_KIT_DISC`) and
  `CO2_CART` (mesh), with a static `CO2_CART_CLIP`. Both blanking plates are meshes oriented in the panel frame.
* `BLANK_PLATE_STICK` sits 2 cm aft of the layout position, within the 3 cm allowance, to clear the pedestal tub.
* Placards: a `PLACARD_<id>` backing plate with a child `LABEL_PLACARD_<id>` engraved face (MAT_LABELS). The AI
  placard plate is amber.
* `LAMP_*` anchors all exist. Lamp fixtures `LIGHT_LAMP_<id>` (MAT_LIGHT) exist only where a surface is near:
  `FLOOD_L/R` and `DOME`. `PANEL` and `PEDESTAL` float in free space in the layout, so they are anchors only. Point lamps
  have identity rotation.
* Extras: `LIGHT_<id>` → `color`; `LIGHT_ANN_<id>` → `color`; `LIGHT_TALLY_<id>` → `always_on`; `SCREEN_<id>` → `px`.
* **UV convention**: the TEXCOORD_0 values in the GLB (as three.js reads them) equal the contract formulas, with v up and
  row 0 at the top: label cell v ∈ [1−(row+1)/16, 1−row/16], decal cells likewise with 4×4 cells, `SCREEN_*` (0,0) at
  the bottom left. That is the convention of a default `CanvasTexture` (`flipY = true`) and of render targets. Blender
  stores 1−v because the exporter flips V.
* The cockpit nests in the chassis capsule. 24 of 4,762 shell vertices poke out of the `CAPSULE` solid by up to 19 mm
  at the cab shoulder near eye level. This is invisible, because the capsule is hidden in first person and the
  cockpit is not drawn from outside.

**Export / materials**
* `export_cameras=True` is used for the chassis as well as the cockpit, because the contract's `CAM_EXT_*` are
  Blender cameras. `export_morph` and `export_skins` stay on for every asset (harmless).
* COLOR_0 is a FLOAT_COLOR point attribute named `Mask`, exported as linear floats (no sRGB conversion). GLTFLoader
  turns `vertexColors` on for any primitive with COLOR_0, so the runtime must switch it off and read the masks itself.
* Additional materials (not in the contract table): `MAT_PAINT_RED`, `MAT_PAINT_AMBER`, `MAT_PAINT_YELLOW`,
  `MAT_PAINT_WHITE` (accent paint: guards, the AI bezel, blanking plates, dial ticks), `MAT_HIVIS` (hauler markings),
  `MAT_SOLAR_CELL` (depot arrays), `MAT_EYE` (pilot sclera), and `MAT_BETA_CLOTH`, the white woven outer cover of
  the hauler's MLI blanket. Silver MLI reflecting a black sky rendered the hauler's dominant surface black.
* Pilot eyeball and eyelid vertices get open-air AO, because a rest-pose bake would put dark lids over the eye when
  `eyesClosed` is applied.

**Dimensions**
* The chassis is 13.1 m from nose sensors to nozzle exit (contract: "about 14 m"), with a 2.24 m capsule, radiators
  spanning 10.9 m, tanks at x = ±1.15 (clear of the 0.7 m keel truss) and `COCKPIT_ANCHOR` at (0, 4.65, 0.35),
  unchanged from the default layout.
* Stowed radiators fold vertically at x = ±0.55 and clear every dorsal kit item (checked in the stow render).
* The mullions between `FWD_C` and `FWD_L/R` are about 5 cm by layout, so the capsule cab facets meet there.

**Textures**
* `moon_albedo.jpg` stores the sRGB encoding of the linear normal albedo (highlands ≈ 0.12, maria ≈ 0.07), so it is
  dark by design; scale it in the shader for a brighter disc. `moon_normal.jpg`: R = east, G = north. The normal maps use the
  OpenGL convention (+G up). `detail_nonslip.png` is a height mask (white = raised lugs). `earth_ocean_mask.png` is
  white over ocean. All detail maps were checked for tileability (seam/inner gradient ratio ≤ 1.4).

## Budgets (triangles, as built)

| asset | built | budget |
|---|---|---|
| chassis + kit_recon / kit_skirmisher / kit_picket | 50,498 + 8,212 / 9,030 / 9,396 → 58.7k / 59.5k / 59.9k | ≤ 60k |
| cockpit | 96,700 | ≤ 120k |
| pilot | 13,212 | ≤ 20k |
| gunship | 38,218 | ≤ 50k |
| hauler | 22,124 | ≤ 40k |
| depot | 43,322 | ≤ 50k |
| decoy (both) | 6,916 | ≤ 8k |
| kkv | 2,982 | ≤ 3k |
| debris | 48 – 356 per piece | ≤ 600 each |

## Known weaknesses / next steps

* The pilot body is a skin-modifier volume: the suit folds, the hands (mittens with a thumb) and the boots are
  simple. A hand-modelled glove with fingers, plus corrective shape keys at the shoulders and knees, would help
  most. The head is stylised, not a likeness.
* The capsule's lower body is a lofted octagon. It could use more distinct structural panels (doublers, a heat
  shield ring) and a few more decals.
* The Moon albedo is procedural at 2.7 km/px: maria are noise-edged ellipses, and there are no wrinkle ridges or rilles.
* MLI and metal read dark against a black world in the Cycles previews. That is physically right, but in-game
  reflections rely on the runtime environment and lighting.
* The AO bake is static, so moving parts (stowed radiators, turrets, an open guard or visor) keep their rest-pose occlusion.
