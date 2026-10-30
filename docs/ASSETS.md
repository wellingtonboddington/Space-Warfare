# SEVERANCE — 3D Asset Contract (Pass 1)

This is the binding contract between the Blender pipeline (`/blender`, run headless with `bpy==5.2.3`)
and the runtime (`/js`). The runtime finds objects **by name**. Names, pivots and axis
conventions below are an API: renaming anything breaks the game. Geometry quality, style and
detail are up to the modeler, within the budgets.

## 0. Pipeline

- `pip install bpy==5.2.3` gives Blender 5.2.3 as a Python module (Python 3.13). Build everything headless:
  `python3 blender/build_all.py` → writes `assets/*.glb`, `assets/tex/*`, `assets/previews/*.png`,
  and **`js/data/hull_layout.json`**, which is generated from the `HIT_*` and anchor empties (section 3).
- Every script is deterministic: seeded RNG and no manual steps. Re-running reproduces identical assets.
- Export: glTF binary (`.glb`), `export_yup=True` (default), `export_apply=True` (modifiers applied),
  `export_extras=True`, `export_cameras=True` (cockpit only), `export_vertex_color='ACTIVE'`
  (so the mask attribute below is exported as `COLOR_0`), `export_morph=True` and `export_skins=True` (pilot),
  and no Draco (the runtime does not ship a Draco decoder).
- Previews: one Cycles CPU render per asset (3/4 view, hard sun, black background, low samples),
  saved to `assets/previews/<asset>.png` for visual QA. Do not ship them in the build.

## 1. Global conventions

- **Units:** 1 Blender unit = 1 metre.
- **Axes (Blender):** +Y = forward (nose), +Z = up (dorsal), +X = right (starboard). The sim uses this
  same body frame. The glTF exporter converts to Y-up. At runtime a node's local axes map as follows:
  Blender local +X → three local +X, Blender local +Z → three local +Y, Blender local +Y → three local −Z.
- **Origins:** each ship asset's root origin is roughly its centre of mass. The pilot's origin is the seat reference point. The cockpit's origin is the design eye point.
- **Art direction:** hard-SF, utilitarian, function over form. Visible maintenance panels, bolted access
  covers, cable and pipe runs with clamps, MLI blankets (gold and silver crinkled foil), asymmetric functional
  greebling, weld seams on tanks, stencils, scuffs. No smooth fantasy hulls. Bevel hard edges, so the harsh single sun
  catches them, and use weighted normals.
- **Budgets (triangles, after modifiers):** chassis + any one kit ≤ 60k; cockpit ≤ 120k; pilot ≤ 20k;
  gunship ≤ 50k; hauler ≤ 40k; depot ≤ 50k; decoy ≤ 8k; KKV ≤ 3k; each debris piece ≤ 600.
  Target hardware is a laptop with an integrated GPU.
- **Textures:** ≤ 2048² except the Moon (4096×2048). Prefer the vertex masks below plus tiling detail maps
  over unique per-asset bakes.

### 1.1 Vertex mask attribute (COLOR_0)
Every mesh carries one colour attribute, which is exported as `COLOR_0` (RGB, 0..1). The runtime uses it **as masks, not as colour**:
- **R = ambient occlusion** (1 = open, 0 = fully occluded). Bake it per vertex: a Cycles AO bake to vertex colours,
  or hemisphere ray casts with `scene.ray_cast`.
- **G = edge wear** (1 = sharp convex edge, likely to be scuffed down to bare metal). Derive it from convex curvature or the bevel weights.
- **B = cavity/grime** (1 = concave crevice). Derive it from concave curvature, or from dirty-vertex-colours.
Meshes need enough vertex density for this to read. Bevels supply most of it.

### 1.2 Materials (Principled BSDF; the runtime keys on these names)
| Material name | Use | Notes |
|---|---|---|
| `MAT_HULL_PAINT` | painted hull panels | base colour neutral light grey (0.6). The runtime tints it per faction (TC off-white/blue-grey, LC regolith ochre/orange). |
| `MAT_HULL_METAL` | bare aluminium/titanium structure, truss | metallic 1, roughness 0.45 |
| `MAT_DARK_COMPOSITE` | composite panels, sensor housings | |
| `MAT_MLI_GOLD`, `MAT_MLI_SILVER` | thermal blankets | metallic, low roughness. Wrinkle the geometry so it crinkles. |
| `MAT_RADIATOR` | radiator panels | white ceramic-coated, with visible fluid tubes as geometry |
| `MAT_ENGINE_BELL` | nozzle interior and exterior | the runtime drives emissive heat glow after burns |
| `MAT_GLASS` | windows, visors, sensor lenses | |
| `MAT_RUBBER`, `MAT_CABLE_BLACK`, `MAT_CABLE_GREY`, `MAT_CABLE_RED`, `MAT_CABLE_YELLOW` | hoses and cables | |
| `MAT_PANEL_GREY` | cockpit panels (dark grey anodised, worn) | |
| `MAT_PANEL_BLACK` | bezels, knobs | |
| `MAT_SEAT` | seat and harness fabric | |
| `MAT_SUIT`, `MAT_SUIT_DARK`, `MAT_SKIN`, `MAT_VISOR`, `MAT_HELMET` | pilot | |
| `MAT_LABELS` | label plates and annunciator lenses | UVs map into the label-atlas cell (cockpit section). The runtime supplies the texture. |
| `MAT_DECALS` | hull decal planes | UVs map into the decal-atlas cell (section 2.4). The runtime supplies the texture. |
| `MAT_SCREEN_<id>` | one per cockpit screen | the runtime replaces it with a live render target |
| `MAT_LIGHT` | every indicator lamp, lens or tally | the runtime clones it per object and drives the emission colour and intensity |
| `MAT_EMISSIVE_WARM` | permanently lit small details (e.g. LED strips) | |

### 1.3 Tiling detail textures (`assets/tex/`, generated by numpy/PIL in `blender/textures.py`)
These are applied at runtime with triplanar mapping, so no UVs are needed for them:
`detail_paint_normal.png` (orange peel and subtle dents, 1024², tangent-space),
`detail_scratch.png` (grey scratch/scuff mask, 1024²), `detail_grime.png` (grey streaky grime, 1024²),
`detail_mli_normal.png` (crinkled foil, 1024²), `detail_nonslip.png` (cockpit floor tread, 512²).
All must tile seamlessly.

## 2. Interceptor: shared chassis plus variant kits

Files: `chassis.glb`, plus `kit_recon.glb`, `kit_skirmisher.glb` and `kit_picket.glb`. **The kits are authored in
the chassis frame**: the runtime adds a kit as a child of the chassis root with an identity transform. The three
variants have to read as the same chassis with a different loadout.

### 2.1 Chassis (about 14 m long, about 2.3 m capsule diameter, radiators span about 11 m when deployed)
From the nose aft: the pressurised **crew capsule** (node `CAPSULE`), whose canopy apertures match the cockpit
windows (section 4), then the equipment/avionics ring, then a truss keel carrying **two spherical propellant tanks** side by side
(fuel to port, oxidiser to starboard), each with weld seams and straps, then the powerplant (fuel cells and batteries, belly), then the
dorsal water heat-sink tank, the coolant pump bay (ventral), **two hinged radiator panels**, and an aft thrust structure with a
**regeneratively cooled engine bell** (visible tube detail). There are **4 RCS quads** and a small nose sensor cluster: a fixed radar array,
an IRST dome and an optical camera. Add star-tracker baffles, antennas, handrails, tie-down points, umbilical ports and cable runs.

Required nodes:
- `CAPSULE`: the exterior crew-capsule shell. The runtime hides it in first person.
- `RAD_L`, `RAD_R`: radiator panels, each a separate object with its **origin on the hinge line** (the hinge runs along Y).
  The rest pose is **deployed** (flat in the XY plane, extending outboard). The runtime stows a panel by rotating it about its local Y axis,
  to +90° for `RAD_L` and −90° for `RAD_R` (folded up against the dorsal side). Leave clearance for that.
- `ENGINE_BELL`: a separate object, so the runtime can drive its glow material.
- `COCKPIT_ANCHOR`: an Empty at the design eye point. The cockpit's origin is placed here with identity rotation.
- `HP_ENGINE`: an Empty at the nozzle exit centre. Exhaust leaves along −Y.
- `HP_RCS_<quad>_<n>`: one Empty per nozzle (quads `FP`, `FS`, `AD`, `AV` = fore-port, fore-starboard, aft-dorsal, aft-ventral;
  n = 0..3). The **Empty's local +Z = exhaust direction**.
- `HP_VENT_HS`, `HP_VENT_O2`, `HP_VENT_CLNT`, `HP_VENT_PROP`: vent outlets. Local +Z = vent direction.
- `CAM_EXT_AFT` (dorsal, looking aft over the spine at the radiators and engine), `CAM_EXT_FWD` (ventral aft, looking forward
  at the tanks and capsule), `CAM_EXT_BOOM` (at the tip of `RAD_L` and parented to it, looking inboard at the whole ship). These are Blender **Camera** objects.
- `DECAL_<role>`: thin planes slightly proud of the hull, with material `MAT_DECALS`, for these roles:
  `HULLNUM_L`, `HULLNUM_R`, `INSIGNIA_L`, `INSIGNIA_R`, `NAME_L`, `NAME_R`, `STENCIL_0` … `STENCIL_5`.
- `HIT_<component>`: Empties with display type CUBE. Their **scale gives the half-extents** of an axis-aligned box in the root frame,
  and they carry no rotation. The sim uses these for hit-location → component damage. Chassis components:
  `cabin, avionics, powerplant, tank_fuel, tank_ox, keel, heatsink, coolant, radiator_l, radiator_r, engine,
  rcs_fp, rcs_fs, rcs_ad, rcs_av, irst, radar, optics, comms`.
  Put the radiator HIT boxes at the deployed pose, as children of `RAD_L`/`RAD_R` so that they move with them.

### 2.2 Kits (authored in the chassis frame, sharing the chassis's mount points)
- **Recon** (`kit_recon.glb`): no weapons. It carries the best sensors and stays light and fragile-looking.
  - A large dorsal **IR telescope** (about 0.6 m aperture, 2.4 m long, with a sunshade baffle) on a two-axis gimbal:
    nodes `TEL_AZ` (rotates about local Z, Blender up) → child `TEL_EL` (rotates about local X).
  - A big ventral **AESA radar** panel (about 1.8 × 1.3 m tile array).
  - A nose **lidar** turret.
  - A gimballed **laser-comm** terminal: `LCOM_AZ` → `LCOM_EL`.
  - HIT: `telescope, aesa, lidar, lasercom`.
- **Skirmisher** (`kit_skirmisher.glb`):
  - A **KKV rack** of 6 launch canisters (each about 1.5 m long, 0.32 m diameter) along the dorsal/flank keel.
    Each is a separate object `KKV_<i>` (i = 0..5), so the runtime can hide it on launch. Muzzle Empties `HP_KKV_<i>` sit at the canister mouths, with local +Z = launch direction (mostly +Y, splayed a little).
  - A small ventral PD turret: `PD_0_AZ` → `PD_0_EL`, with muzzle `HP_PD_0` (local +Z = beam direction).
  - A medium radar dish.
  - HIT: `kkv_rack, pd_0, radar_dish`.
- **Picket** (`kit_picket.glb`):
  - Two large PD turrets with 0.5 m beam-director optics: `PD_0_*` dorsal and `PD_1_*` ventral, with the same `AZ`/`EL`/`HP_PD` scheme as above.
  - A capacitor bank module, heavy coolant plumbing, and radiator **tip extensions** `RAD_L2` and `RAD_R2`, parented to `RAD_L`/`RAD_R` with the same hinge convention.
  - HIT: `pd_0, pd_1, capacitor, radiator_l2, radiator_r2`.

### 2.3 Turret and gimbal pivot convention
`*_AZ` is the azimuth node, rotating about its **local Blender Z** (three local +Y). `*_EL` is the elevation node, a child of AZ, rotating
about its **local X**. In the rest pose the muzzle or aperture points along local **+Y** of the EL node (Blender), which is forward.

### 2.4 Decal atlas (runtime-generated, 4 × 4 cells)
`DECAL_<role>` UVs map into these cells (col, row, with row 0 at the top):
`HULLNUM_L (0,0)`, `HULLNUM_R (1,0)`, `INSIGNIA_L (2,0)`, `INSIGNIA_R (3,0)`, `NAME_L (0,1)`, `NAME_R (1,1)`,
`STENCIL_0..5 (2,1) (3,1) (0,2) (1,2) (2,2) (3,2)`. Use cell size 0.25 × 0.25 in UV, mirrored correctly so that text reads
the right way from outside.

## 3. Generated layout data: `js/data/hull_layout.json`
`build_all.py` writes this from the scene (Blender coordinates, root frame, metres):
```json
{ "<asset>": {
    "hit":     { "<component>": { "c": [x,y,z], "h": [hx,hy,hz], "parent": "RAD_L"|null } },
    "anchors": { "<NAME>": { "p": [x,y,z], "q": [w,x,y,z], "parent": "<node>"|null } },
    "bounds":  { "min": [..], "max": [..] },
    "tris": 12345 } }
```
Assets: `chassis, kit_recon, kit_skirmisher, kit_picket, gunship, hauler, depot, decoy, kkv`.
`anchors` holds every `HP_*`, `CAM_*`, `COCKPIT_ANCHOR`, `RAD_*`, `TEL_*`, `LCOM_*` and `PD_*` node.
A hand-written default ships until the pipeline overwrites it, so keep the schema exactly.

## 4. Cockpit (`cockpit.glb`)
The semantics come from **`js/data/cockpit_layout.json`** (generated by `tools/gen_cockpit_layout.mjs`). Read it in `cockpit.py`.
- **Origin = the design eye point.** Use the layout's frame. Build a cramped Soyuz/fighter-style capsule interior:
  the pressure shell with stringers and padding, a floor with a non-slip plate, the seat with harness and headrest at `shell.seatRef`,
  a heel rest, cable looms along the walls (several twisted bundles with clamps), handholds, stencils, and an emergency
  O2 mask. The window frames and glass `WINDOW_<id>` follow `windows[].corners`.
- **Panels:** a solid panel body per `panels[]` entry, with screws, edge lighting and wear. Controls sit at their `pos` (panel-local u, v).
  Positions may move by ≤ 3 cm to avoid overlaps, but the ids must stay.
- **Screens:** `SCREEN_<id>` is a single quad with UV (0,0) at the bottom-left and (1,1) at the top-right as the pilot sees it, using material `MAT_SCREEN_<id>`.
  Give it a recessed bezel with a slight hood. The `AI` screen bezel must look different: amber-painted frame and an engraved
  `PLACARD_AI` plate.
- **Controls** (`controls[]`): one root Empty `<id>` at the control position, oriented so that **local +Z = panel normal
  (toward the pilot), local +Y = panel up, local +X = panel right**. Children:
  - `<id>_BASE` (static housing) and `<id>_MOV` (moving part, **origin at the pivot**). The rest pose is `states[0]`
    (detent 0 for rotaries). Animation contract by `type`: see the header comment of `tools/gen_cockpit_layout.mjs`.
  - `toggle_guarded` adds `<id>_GUARD`: a flip cover with its origin on the hinge at the top edge, rotating about local X.
  - Buttons with `light` get a lens `LIGHT_<id>` (`MAT_LIGHT`). Gauges get a dial face, a glass cover and `<id>_NEEDLE`
    (origin at the needle pivot, rest pose pointing at `sweep[0]`). Draw tick marks as geometry or through the label atlas.
  - Items: `PATCH_KIT` (a pouch, with child `PATCH_KIT_DISC`) and `CO2_CART` in its clip.
  - Rotaries with `detentLabels` get small engraved caption plates (`LABEL_<id>_<k>`) at each detent angle.
- **Label plates** `LABEL_<id>` (and `LABEL_<placard id>`) are small engraved plates near each control, material `MAT_LABELS`,
  with UVs covering exactly that label's atlas cell (`labelAtlas`, `labelIndex`, 4:1 cells). Annunciator lenses
  `LIGHT_ANN_<id>` use `MAT_LIGHT` **and** map UVs to their caption cell. The runtime composites the caption into the emission.
- **Blanking plates:** `BLANK_PLATE_STICK` (floor, between the knees, `blankPlateStick`) and `BLANK_PLATE_THR` (left console).
  Bolted, stencilled, with slightly scratched edges. These are deliberately prominent pieces of lore.
- **Interior cameras:** a Blender **Camera** `CAM_<id>` for each `cameras[]` entry (aimed at `target`, with the given vertical fov), plus a dome housing
  `CAMDOME_<id>` and an always-on tally lamp `LIGHT_TALLY_<id>` (`MAT_LIGHT`).
- **Empties:** `EYE` (origin), `SEAT_REF`, `HEADREST`, `LAMP_<id>` (spots aimed at their target, local −Z = aim, like a light),
  `LEAK_<n>` (local +Z = outward), `ARC_<id>`, `SND_<id>`.
- Wear: chipped edges on handholds and panel corners, grime in the crevices (vertex masks), a few stickers and placards.

## 5. Pilot (`pilot.glb`)
- A seated, pressure-suited human (bulky IVA suit with hoses, a chest control unit and a helmet). It is rigged and skinned, and its
  **rest/bind pose is seated** to fit the seat (origin = `SEAT_REF`; eye midpoint at (0, 0.16, 0.74) relative to the origin, so it
  coincides with the cockpit's EYE).
- Required bones (exact names): `root, pelvis, spine_01, spine_02, chest, neck, head, clavicle.L/R, upper_arm.L/R,
  forearm.L/R, hand.L/R, fingers.L/R, thumb.L/R, thigh.L/R, shin.L/R, foot.L/R`. Bone roll should be sane
  (each bone's local Y runs along the bone) so runtime IK on the arm chain works.
- The helmet is a separate mesh `HELMET` parented to the `head` bone. The visor `VISOR` is a child of HELMET with its origin on the
  visor hinge, rotating about its local X (rest = **open**, raised). The face is visible through the open visor.
- **Face shape keys** are exported as morph targets: `browUp, browDown, browKnit, eyesWide, eyesClosed, jawOpen,
  mouthTense, mouthFrown, lipsPart, cheekPuff, nostrilFlare`. They must be legible on a low-resolution, noisy camera feed.
- ≤ 20k triangles. Single-sided materials are fine. Name the mesh `PILOT_BODY`.

## 6. Other craft and objects
- `gunship.glb`: an armed strike platform, about 26 m. It is a different silhouette from the Interceptor, but in the same engineering language.
  It has a crew module, a central tank, a small fission powerplant with a shadow shield, twin engines, big radiators, an **8-tube KKV bay**
  (`KKV_<i>` + `HP_KKV_<i>`, i = 0..7), one PD turret (`PD_0_*`), and a radar.
  HIT: `cabin, reactor, tank_main, engine_0, engine_1, kkv_bay, pd_0, radiator_l, radiator_r, radar`.
  Anchors: `HP_ENGINE_0`, `HP_ENGINE_1`. It uses `MAT_HULL_PAINT`, so the runtime tints it per faction.
- `hauler.glb`: a civilian or LC ice hauler, about 38 m. It has a huge MLI-wrapped cylindrical water-ice tank on a truss, a small crew pod,
  one engine and one radiator, and it is visibly civilian (high-vis markings, unarmed). HIT: `cabin, tank_cargo, engine, radiator, truss`. Anchor: `HP_ENGINE`.
- `depot.glb`: the Picket's protected asset, an orbital propellant depot about 60 m across. It has a cluster of 4 large insulated tanks on
  a central truss, two big solar-array wings, radiators, docking ports with a control module, and lights.
  HIT: `control, tank_0, tank_1, tank_2, tank_3, truss, array_l, array_r, radiator`.
- `decoy.glb`: an inflatable decoy (node `DECOY_SHIP`) that crudely mimics an Interceptor's size and outline. It has wrinkled aluminised
  envelope lobes, a heater pack and a gas bottle. Also `DECOY_KKV`: a 1.5 m wrinkled balloon with a wire radar-reflector cage, a small
  KKV-sized decoy. HIT: `envelope` (for DECOY_SHIP) and `envelope_kkv`.
- `kkv.glb`: a kinetic kill vehicle, about 1.4 m long and 0.3 m in diameter. It has a sapphire IR seeker dome with a shroud, an avionics section,
  **4 lateral divert thrusters** (`HP_DIVERT_0..3`, local +Z = exhaust), small attitude jets and a boost motor nozzle (`HP_KKV_MOTOR`,
  exhaust along −Y). HIT: `body`.
- `debris.glb`: 12 separate nodes `DEBRIS_00 … DEBRIS_11`, each ≤ 600 triangles, origin at its centroid. Include bent hull
  plates with torn edges, truss fragments, shattered tank shell pieces, a radiator fragment with tubes, a chunk with a
  dangling cable and some small fragments. Make them by procedural fracture (Voronoi bisect) of modelled parts.

## 7. Sky textures (`assets/tex/`, `blender/textures.py`, numpy/PIL)
- `moon_albedo.jpg` (4096×2048) and `moon_normal.jpg` (4096×2048, tangent space: R = east, G = north), plus
  `moon_height.png` (2048×1024, 8-bit). Equirectangular: u = (lon + 180)/360, v = (90 − lat)/180 (row 0 = north).
  Use a realistic power-law crater size-frequency distribution (fresh bowl craters, degraded old craters, central peaks
  on large ones, a few rayed young craters), highlands brighter than maria (albedo about 0.12 against 0.07). Place the major
  near-side maria at roughly their real positions as soft irregular shapes: Imbrium (33N, 16W), Serenitatis (28N, 17E), Tranquillitatis
  (8.5N, 31E), Crisium (17N, 59E), Fecunditatis (8S, 51E), Nubium (21S, 17W), Oceanus Procellarum (about 20N, 57W, very large)
  and Frigoris (56N, 1E). Far-side and polar highlands should be heavily cratered, and South Pole–Aitken (53S, 169W, 2500 km) a subtle
  darker depression. Add Tycho (43S, 11W) with rays, Copernicus (10N, 20W), and Shackleton (89.9S) at the pole.
- `earth_albedo.jpg` (2048×1024, same projection): oceans in deep blue, land from `node_modules/world-atlas/land-50m.json`
  (TopoJSON; decode with a tiny decoder or the `topojson-client` algorithm in Python), coloured by latitude/biome, with polar ice.
  Also `earth_clouds.jpg` (2048×1024, grey, procedural with latitude banding) and `earth_ocean_mask.png` (1024×512).
