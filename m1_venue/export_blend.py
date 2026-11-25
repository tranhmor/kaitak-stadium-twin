"""M1 step 1 (Blender): read the leader's .blend read-only and export
  out/venue_lite.glb   merged, Draco-compressed display geometry, one mesh per category
  out/seats.bin        Float32 [x, y, z, yaw, colour_index] per seat instance (local frame, metres)
  out/geometry_ref.json  reference rings and boxes used by build_layout.py

Run:  Blender -b <file.blend> --python m1_venue/export_blend.py -- m1_venue/out
The .blend is never saved. Local frame = Blender world frame (x east, y north, z up, metres).
"""
import bpy, bmesh, json, math, os, re, struct, sys, hashlib

OUT = sys.argv[sys.argv.index("--") + 1]
SRC_SCENE = "01 | 启德主场馆"
DECIMATE = {"ctx_landmarks": 0.12}

# category -> (name patterns, default colour). First match wins.
CATEGORIES = [
    ("stadium_glass", [r"^Stadium glazed concourse band", r"^Stadium \| Curtain wall", r"^Sealed low-iron glazing", r"^Curtain wall \|"]),
    ("stadium_shell", [r"^Parametric stadium envelope", r"^Shell rib"]),
    ("stadium_roof", [r"^Open roof ring", r"^Roof rib", r"^Retractable canopy", r"^Canopy •"]),
    ("stadium_bowl", [r"^Seating bowl", r"^Tier walkway", r"^Cast concrete", r"^Lower stands", r"^Upper stand", r"^Suite level", r"^South Terrace \| public viewing deck"]),
    ("stadium_floor", [r"^Concert floor"]),
    ("stage_screens", [r"^Stage video wall", r"^Stage side screen"]),
    ("stage", [r"^Stage deck", r"^Stage •", r"^Concert •"]),
    ("ctx_ground", [r"^Site ground"]),
    ("ctx_green", [r"^Mapped green space"]),
    ("ctx_roads", [r"^Mapped road union"]),
    ("ctx_paths", [r"^Mapped pedestrian network"]),
    ("ctx_plazas", [r"^Proposed approach plazas"]),
    ("ctx_windows", [r"^Footprint aligned facade windows"]),
    ("ctx_buildings", [r"^OSM building", r"^Pavilion", r"^Event kiosk", r"^Kiosk"]),
    ("ctx_landmarks", [r"^HK source", r"^geometry_0"]),
    ("ctx_trees", [r"^Parametric canopy", r"^Tree branch", r"^Procedural trunk", r"^Icosphere"]),
]


def category(name):
    for cat, pats in CATEGORIES:
        if any(re.search(p, name) for p in pats):
            return cat
    return None


src = bpy.data.scenes[SRC_SCENE]
bpy.context.window.scene = src
dg = bpy.context.evaluated_depsgraph_get()

# ---- seats (geometry-nodes instances) ---------------------------------------------------------
COLOURS = ["slate", "brick", "mandarin", "oyster", "oxblood"]
seats = []
for inst in dg.object_instances:
    if inst.is_instance and inst.parent.original.name.startswith("Seats |"):
        m = inst.matrix_world
        colour = inst.parent.original.name.split("•")[-1].strip()
        seats += [m.translation.x, m.translation.y, m.translation.z, math.atan2(m[1][1], m[0][1]), float(COLOURS.index(colour))]
with open(os.path.join(OUT, "seats.bin"), "wb") as f:
    f.write(struct.pack(f"<{len(seats)}f", *seats))

# ---- merged display meshes ----------------------------------------------------------------------
bms, counts = {}, {}
for ob in src.objects:
    cat = category(ob.name)
    if cat is None or ob.type not in {"MESH", "CURVE"}:
        continue
    ev = ob.evaluated_get(dg)
    try:
        me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    except RuntimeError:
        continue
    if me is None or len(me.polygons) == 0:
        continue
    me.transform(ob.matrix_world)
    bm = bms.setdefault(cat, bmesh.new())
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    counts[cat] = counts.get(cat, 0) + 1

exp = bpy.data.scenes.new("M1_export")
stats = {}
for cat, bm in bms.items():
    me = bpy.data.meshes.new(cat)
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    mat = bpy.data.materials.new(cat)
    me.materials.append(mat)
    for p in me.polygons:
        p.material_index = 0
    ob = bpy.data.objects.new(cat, me)
    ob["m1_category"] = cat
    ob["m1_source_objects"] = counts[cat]
    exp.collection.objects.link(ob)
    if cat in DECIMATE:
        mod = ob.modifiers.new("decimate", "DECIMATE")
        mod.ratio = DECIMATE[cat]
    stats[cat] = {"source_objects": counts[cat], "vertices": len(me.vertices), "faces": len(me.polygons)}

bpy.context.window.scene = exp
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "venue_lite.glb"), export_format="GLB", use_active_scene=True,
    export_apply=True, export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
    export_animations=False, export_texcoords=False, export_image_format="NONE",
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10,
)

# ---- reference geometry for the functional layer --------------------------------------------------
def ring(name, z, tol=0.3):
    ob = bpy.data.objects[name]
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    return [[round(p.x, 3), round(p.y, 3)] for p in pts if abs(p.z - z) < tol]


def bbox(name):
    ob = bpy.data.objects[name]
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    return [round(min(p[i] for p in pts), 3) for i in range(3)] + [round(max(p[i] for p in pts), 3) for i in range(3)]


blend = bpy.data.filepath
ref = {
    "source_blend": os.path.basename(blend),
    "source_sha256": hashlib.sha256(open(blend, "rb").read()).hexdigest(),
    "source_scene": SRC_SCENE,
    "blender_version": bpy.app.version_string,
    "model_status": src.get("model_status", ""),
    "provenance": src.get("provenance", ""),
    "frame": "Blender world frame: x east, y north, z up, metres",
    "seat_count": len(seats) // 5,
    "seat_colours": COLOURS,
    "rings": {
        "envelope_z12_5": ring("Parametric stadium envelope", 12.5),
        "bowl_front_z4": ring("Seating bowl", 4.0),
        "roof_ring_z43": ring("Open roof ring", 43.0),
    },
    "boxes": {n: bbox(n) for n in ["Concert floor", "Stage deck", "Stage video wall", "South Terrace | public viewing deck"]},
    "display_meshes": stats,
}
json.dump(ref, open(os.path.join(OUT, "geometry_ref.json"), "w"), ensure_ascii=False, indent=1)
print("M1_EXPORT_OK", json.dumps(stats))
