"""M1 step 2: build the functional layer (zones, lines, displays, graph, walkable area) from the
reference geometry exported by export_blend.py and the scope in config.yaml.

Run:  .venv/bin/python m1_venue/build_layout.py                      # default stage preset -> m1_venue/out
      .venv/bin/python m1_venue/build_layout.py --preset south_end    # -> m1_venue/out/presets/south_end
      .venv/bin/python m1_venue/build_layout.py --all-presets [--out DIR]
Everything is in the Blender local frame (x east, y north, z up, metres); EPSG:2326 = local + frame origin.

Stage presets (config.yaml `stage_presets`). `original` keeps the .blend stage at the north end. `mirror` mirrors
three things about the east-west line through the centre of the concert floor: the stage block on the floor, the
lower-tier seats that cannot see the stage, and the floor seats. Everything else (bowl, concourse, gates, tunnels,
aisles, IDs) is the same in every preset. The default preset is written to out/; the others to out/presets/<id>/,
which hold no copy of venue_lite.glb, seats.bin or geometry_ref.json.
"""
import argparse
import heapq
import warnings
import json
import math
import struct
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import yaml
from shapely import contains_xy
from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import linemerge, unary_union

HERE = Path(__file__).parent
OUT = HERE / "out"
warnings.filterwarnings("ignore", message="invalid value encountered in oriented_envelope")
CFG = yaml.safe_load(open(HERE / "config.yaml"))
REF = json.load(open(OUT / "geometry_ref.json"))
GATES = {g["ref"]: g for g in json.load(open(HERE / "sources" / "gates_osm.json"))["gates"]}
A = {k: v["value"] for k, v in CFG["assumed"].items()}
SIDE = CFG["scope"]["side"]
Z0, Z2 = CFG["levels"]["L0"]["z"], CFG["levels"]["L2"]["z"]
PRESETS = CFG["stage_presets"]
DEFAULT_PRESET = CFG["default_preset"]


# ---------------------------------------------------------------- reference rings and seats
def ring_polygon(points):
    c = np.mean(points, axis=0)
    pts = sorted(points, key=lambda p: math.atan2(p[1] - c[1], p[0] - c[0]))
    return Polygon(pts).buffer(0)


front = ring_polygon(REF["rings"]["bowl_front_z4"])          # inner edge of the lower tier
envelope = ring_polygon(REF["rings"]["envelope_z12_5"])      # facade at concourse level
CX, CY = front.centroid.x, front.centroid.y

raw = (OUT / "seats.bin").read_bytes()
seats = np.array(struct.unpack(f"<{len(raw) // 4}f", raw)).reshape(-1, 5)
lt = CFG["lower_tier"]
lower = seats[(seats[:, 2] > lt["z_min"]) & (seats[:, 2] < lt["z_max"])]
FLOOR_SEATS = seats[seats[:, 2] < CFG["floor"]["z_max"]]
FLOOR = REF["boxes"]["Concert floor"]
PX, PY = (FLOOR[0] + FLOOR[3]) / 2, (FLOOR[1] + FLOOR[4]) / 2   # centre of the concert floor: mirror axis of the presets


def ang(x, y):
    return np.degrees(np.arctan2(y - CY, x - CX)) % 360


def ray_point(theta_deg, r):
    t = math.radians(theta_deg)
    return (CX + r * math.cos(t), CY + r * math.sin(t))


def ray_hit(poly, theta_deg):
    """Distance from the bowl centre to the boundary of a star-shaped polygon along a ray."""
    hit = LineString([(CX, CY), ray_point(theta_deg, 500)]).intersection(poly.exterior)
    pts = [hit] if hit.geom_type == "Point" else list(hit.geoms)
    return max(Point(CX, CY).distance(p) for p in pts)


def wedge(a0, a1, r=500):
    return Polygon([(CX, CY)] + [ray_point(a, r) for a in np.linspace(a0, a1, max(2, int((a1 - a0) / 0.5) + 1))])


def strip(theta_deg, r0, r1, width):
    return LineString([ray_point(theta_deg, r0), ray_point(theta_deg, r1)]).buffer(width / 2, cap_style="flat")


tier_depth = float(np.max([front.exterior.distance(Point(x, y)) for x, y in lower[:, :2]])) + 0.8
tier_back = front.buffer(tier_depth, join_style="round")
conc_outer = envelope.buffer(-A["concourse_inset_m"])
conc_inner = envelope.buffer(-A["concourse_inset_m"] - A["concourse_width_m"])
floor_all = front.buffer(-1.0)                                # 1 m gap = pitch wall under the lower tier

# ---------------------------------------------------------------- seating sections from aisle gaps
A0, A1 = CFG["scope"]["angle_range_deg"]
hist, _ = np.histogram(ang(lower[:, 0], lower[:, 1]), bins=np.arange(0, 360.01, 0.5))
gap_bins = np.where(hist == 0)[0]
aisles, run = [], [gap_bins[0]]
for b in gap_bins[1:]:
    if b - run[-1] > 1:
        aisles.append((run[0] + run[-1] + 1) * 0.25)
        run = [b]
    else:
        run.append(b)
aisles.append((run[0] + run[-1] + 1) * 0.25)
aisles = [a for a in aisles if A0 <= a <= A1]
bounds = [aisles[0]]
for a in aisles[1:]:
    if a - bounds[-1] > 18:                                   # no aisle gap in the seat data: split in two
        bounds.append((a + bounds[-1]) / 2)
    bounds.append(a)


def build(preset_id=DEFAULT_PRESET, out_dir=OUT):
    """Build one stage preset into out_dir and return the number of failed QA checks."""
    preset = PRESETS[preset_id]
    mirror = preset["mode"] == "mirror"
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    flip = lambda y: 2 * PY - y                          # mirror about the east-west line through the floor centre
    floor_seats = FLOOR_SEATS.copy()
    if mirror:
        floor_seats[:, 1] = flip(floor_seats[:, 1])
    default = preset_id == DEFAULT_PRESET
    mesh_file, seats_file = ("venue_lite.glb", "seats.bin") if default else ("../../venue_lite.glb", "../../seats.bin")
    tag = "" if default else f" · stage {preset_id}"

    zones, seat_xy, seat_z = {}, {}, {}


    def add_zone(zid, kind, level, geom, **props):
        zones[zid] = {"id": zid, "type": kind, "level": level, "side": SIDE, "geom": geom, **props}


    # gates: forecourt rectangles through the facade
    gate_geoms = {}
    for ref in CFG["scope"]["gates"]:
        gx, gy = GATES[ref]["local_xy"]
        theta = float(ang(gx, gy))
        r_env = ray_hit(envelope, theta)
        rect = strip(theta, r_env - A["concourse_inset_m"] - 0.2, r_env + A["gate_depth_m"], A["gate_width_m"])
        gate_geoms[ref] = (theta, r_env, rect)

    # concourse cells
    conc_ring = conc_outer.difference(conc_inner)
    n_cells = 12
    cell_edges = np.linspace(bounds[0], bounds[-1], n_cells + 1)
    for i in range(n_cells):
        g = conc_ring.intersection(wedge(cell_edges[i], cell_edges[i + 1]))
        add_zone(f"L2-{SIDE}-C{i + 1:02d}", "concourse", "L2", g, z=[Z2, Z2],
                 monitored=(i + 1) not in CFG["monitoring"]["unmonitored_concourse_cells"],
                 angle_deg=[round(float(cell_edges[i]), 2), round(float(cell_edges[i + 1]), 2)])
    conc_union = unary_union([z["geom"] for z in zones.values()])

    for ref, (theta, r_env, rect) in gate_geoms.items():
        add_zone(f"L2-{SIDE}-G-{ref}", "gate", "L2", rect.difference(conc_outer), z=[Z2, Z2], monitored=True,
                 gate_ref=ref, angle_deg=[round(theta, 2)] * 2, osm_id=GATES[ref]["osm_id"], width_m=A["gate_width_m"],
                 osm_to_facade_m=round(envelope.exterior.distance(Point(gx, gy)), 2),
                 exit_area=strip(theta, r_env + A["gate_depth_m"] - 3.0, r_env + A["gate_depth_m"], A["gate_width_m"]))

    # pitch tunnels at the aisle nearest to the assumed angles (L0 -> L2 ramps)
    tunnels = []
    for k, ta in enumerate(A["tunnel_angles_deg"]):
        theta = min(bounds[1:-1], key=lambda b: abs(b - ta))
        g = strip(theta, ray_hit(front, theta) - 2.5, ray_hit(conc_inner, theta) + 0.5, A["tunnel_width_m"])
        g = g.difference(floor_all).difference(conc_union)
        tunnels.append((theta, g))
        add_zone(f"L0-{SIDE}-T{k + 1:02d}", "tunnel", "L0", g, z=[Z0, Z2], monitored=True, angle_deg=[round(theta, 2)] * 2,
                 connects_levels=["L0", "L2"])
    tunnel_block = unary_union([g.buffer(0.6) for _, g in tunnels])

    # seating sections and their portals
    stage = REF["boxes"]["Stage deck"]
    wall_y = REF["boxes"]["Stage video wall"][1]                  # seats north of the video wall have no view
    tier_ring = tier_back.difference(front)
    for i in range(len(bounds) - 1):
        a0, a1 = bounds[i], bounds[i + 1]
        mid = (a0 + a1) / 2
        r_mid = ray_hit(tier_back, mid) - tier_depth / 2
        half_gap = math.degrees(0.3 / r_mid)                      # 0.6 m rail between sections
        sec = tier_ring.intersection(wedge(a0 + half_gap, a1 - half_gap)).difference(tunnel_block)
        sid, pid = f"L2-{SIDE}-S{i + 1:02d}", f"L2-{SIDE}-P{i + 1:02d}"
        inside = contains_xy(sec, lower[:, 0], lower[:, 1])
        sold = inside & ((lower[:, 1] >= flip(wall_y)) if mirror else (lower[:, 1] <= wall_y))
        seat_xy[sid], seat_z[sid] = lower[sold][:, :2], lower[sold][:, 2]
        add_zone(sid, "seating", "L2", sec, z=[lt["z_min"] + 0.5, Z2 - 0.4], monitored=True,
                 angle_deg=[round(a0, 2), round(a1, 2)], seats_in_model=int(inside.sum()), capacity=int(sold.sum()),
                 closed_for_concert=bool(sold.sum() < 0.5 * inside.sum()), official_sections=None)
        portal = strip(mid, ray_hit(tier_back, mid) - 1.0, ray_hit(conc_inner, mid) + 0.5, A["portal_width_m"])
        add_zone(pid, "portal", "L2", portal.difference(tier_back).difference(conc_union), z=[Z2, Z2], monitored=True,
                 angle_deg=[round(mid, 2)] * 2, serves=sid)

    # floor zones: west half of the pitch, three bands in front of the stage, stage block removed
    half = box(CX - 500, CY - 500, CX, CY + 500) if SIDE == "W" else box(CX, CY - 500, CX + 500, CY + 500)
    if mirror:
        stage_block = box(stage[0] - 3.0, flip(CY + 500), stage[3] + 3.0, flip(stage[1] - 2.0))
    else:
        stage_block = box(stage[0] - 3.0, stage[1] - 2.0, stage[3] + 3.0, CY + 500)
    floor_side = floor_all.intersection(half).difference(stage_block)
    ys = np.sort(np.unique(np.round(floor_seats[:, 1], 1)))
    cuts = [float((ys[j] + ys[j + 1]) / 2) for j in np.where(np.diff(ys) > 2.0)[0]]   # cross-aisles between seat blocks
    edges = [CY + 500] + sorted(cuts, reverse=True) + [CY - 500]
    fmask = floor_seats[:, 0] < CX if SIDE == "W" else floor_seats[:, 0] >= CX
    for i in range(len(edges) - 1):
        g = floor_side.intersection(box(CX - 500, edges[i + 1], CX + 500, edges[i]))
        zid = f"L0-{SIDE}-F{i + 1:02d}"
        inside = contains_xy(g, floor_seats[:, 0], floor_seats[:, 1]) & fmask
        seat_xy[zid], seat_z[zid] = floor_seats[inside][:, :2], floor_seats[inside][:, 2]
        add_zone(zid, "floor", "L0", g, z=[Z0, Z0], monitored=True, capacity=int(inside.sum()),
                 seats_in_model=int(inside.sum()), closed_for_concert=False)

    for z in zones.values():
        g = z["geom"].buffer(0)
        if g.geom_type == "MultiPolygon":
            g = max(g.geoms, key=lambda p: p.area)
        z["geom"] = g
        z["area_m2"] = round(g.area, 1)
        z.setdefault("capacity", 0)

    # ---------------------------------------------------------------- adjacency, lines, graph
    COUNTING = {("portal", "concourse"), ("concourse", "gate"), ("floor", "tunnel"), ("tunnel", "concourse"), ("concourse", "concourse")}
    ids = list(zones)
    pairs = []
    for i, a in enumerate(ids):
        ba = zones[a]["geom"].boundary.buffer(0.15)
        for b in ids[i + 1:]:
            if zones[a]["geom"].distance(zones[b]["geom"]) > 0.3:
                continue
            sliver = ba.intersection(zones[b]["geom"].boundary.buffer(0.15))
            if sliver.is_empty or sliver.area < 0.3:
                continue
            rect = list(sliver.minimum_rotated_rectangle.exterior.coords)[:4]
            k = min(range(4), key=lambda j: math.dist(rect[j], rect[(j + 1) % 4]))   # a short side of the sliver
            q = [rect[(k + j) % 4] for j in range(4)]
            line = LineString([((q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2), ((q[2][0] + q[3][0]) / 2, (q[2][1] + q[3][1]) / 2)])
            if line.length >= 1.0:
                pairs.append((a, b, line))

    # a gate opens into one concourse cell through its full assumed width
    pairs = [p for p in pairs if "gate" not in (zones[p[0]]["type"], zones[p[1]]["type"])]
    for ref, (theta, r_env, rect) in gate_geoms.items():
        seg = conc_outer.exterior.intersection(strip(theta, r_env - 6.0, r_env + 6.0, A["gate_width_m"]))
        seg = linemerge(seg) if seg.geom_type != "LineString" else seg
        line = LineString([seg.coords[0], seg.coords[-1]])
        cell = max((z for z in ids if zones[z]["type"] == "concourse"), key=lambda z: zones[z]["geom"].intersection(seg.buffer(0.5)).area)
        pairs.append((cell, f"L2-{SIDE}-G-{ref}", line))

    adj = {z: {} for z in ids}
    for a, b, line in pairs:
        w = zones[a]["geom"].centroid.distance(line.centroid) + zones[b]["geom"].centroid.distance(line.centroid)
        adj[a][b] = adj[b][a] = round(w, 1)


    def dijkstra(src):
        dist, prev, pq = {src: 0.0}, {}, [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist[u]:
                continue
            for v, w in adj[u].items():
                if zones[u]["type"] == "gate" and u != src:
                    continue                                       # gates are sinks, never passed through
                if d + w < dist.get(v, 1e18):
                    dist[v], prev[v] = d + w, u
                    heapq.heappush(pq, (d + w, v))
        return dist, prev


    gate_ids = [z for z in ids if zones[z]["type"] == "gate"]
    to_gate = {g: dijkstra(g)[0] for g in gate_ids}
    nearest = {z: min(to_gate[g].get(z, 1e18) for g in gate_ids) for z in ids}

    lines, edges_out = [], []
    for n, (a, b, line) in enumerate(sorted(pairs, key=lambda p: (p[0], p[1])), 1):
        ta, tb = zones[a]["type"], zones[b]["type"]
        if ta == tb == "concourse":
            up, down = sorted((a, b))                              # positive = increasing cell number
        else:
            up, down = (a, b) if nearest[a] >= nearest[b] else (b, a)
        lid = f"{zones[up]['level']}-{SIDE}-CL{n:02d}"
        counting = (zones[up]["type"], zones[down]["type"]) in COUNTING
        zmid = zones[down]["z"][0] if zones[down]["type"] != "tunnel" else zones[up]["z"][1]
        width = A["gate_width_m"] if zones[down]["type"] == "gate" else round(line.length, 2)   # clear width, not the oblique facade cut
        lines.append({"id": lid, "from": up, "to": down, "counting": counting, "width_m": width,
                      "z": zmid, "geom": line})
        edges_out.append({"from": up, "to": down, "line_id": lid, "width_m": width,
                          "length_m": adj[a][b], "counting": counting})

    for z in ids:
        zones[z]["neighbors"] = sorted(adj[z])
        zones[z]["dist_to_nearest_gate_m"] = round(nearest[z], 1)

    routes = {}
    for z in ids:
        if zones[z]["type"] not in ("seating", "floor"):
            continue
        routes[z] = {}
        dist, prev = dijkstra(z)
        for g in gate_ids:
            if g in dist:
                path, u = [g], g
                while u != z:
                    u = prev[u]
                    path.append(u)
                routes[z][g] = {"length_m": round(dist[g], 1), "path": path[::-1]}

    # stage preset: natural gate load (everyone to the nearest gate) and the gate the demo closes
    load = {g: 0 for g in gate_ids}
    for z in ids:
        if zones[z]["capacity"]:
            load[min(gate_ids, key=lambda g: to_gate[g].get(z, 1e18))] += zones[z]["capacity"]
    busiest = max(gate_ids, key=load.get)
    along = sorted(gate_ids, key=lambda g: zones[g]["angle_deg"][0])          # gate order along the concourse
    k = along.index(busiest)
    beside = [along[j] for j in (k - 1, k + 1) if 0 <= j < len(along)]
    close_gate = min(beside, key=lambda g: (abs(zones[g]["angle_deg"][0] - zones[busiest]["angle_deg"][0]), -load[g]))
    deck, wall = REF["boxes"]["Stage deck"], REF["boxes"]["Stage video wall"]
    yspan = lambda b: [round(flip(b[4]), 2), round(flip(b[1]), 2)] if mirror else [round(b[1], 2), round(b[4], 2)]
    stage_meta = {
        "preset_id": preset_id, "mode": preset["mode"], "status": preset["status"],
        "label_en": preset["label_en"], "label_zh": preset["label_zh"],
        "obstacles": [{"kind": kind, "x": [round(b[0], 2), round(b[3], 2)], "y": yspan(b), "z": [round(b[2], 2), round(b[5], 2)]}
                      for kind, b in (("stage_deck", deck), ("video_wall", wall))],
        "sold_seats": f"lower-tier seats with y {'>=' if mirror else '<='} {round(flip(wall_y) if mirror else wall_y, 2)} (in view of the stage)",
        "gate_load": load, "busiest_gate": busiest, "recommended_close_gate": close_gate,
        "recommended_close_rule": "the gate next to the busiest gate along the concourse; every seated person walks to the nearest gate",
    }

    # displays: one at each portal and tunnel mouth, telling the upstream zones which gate to use
    displays = []
    for ln in lines:
        kinds = (zones[ln["from"]]["type"], zones[ln["to"]]["type"])
        if kinds in (("portal", "concourse"), ("tunnel", "concourse")):
            up = ln["from"]
            serves = [zones[up]["serves"]] if kinds[0] == "portal" else [n for n in zones[up]["neighbors"] if zones[n]["type"] == "floor"]
            if kinds[0] == "tunnel":                              # floor zones whose shortest exit route uses this tunnel
                serves = sorted(z for z in ids if zones[z]["type"] == "floor"
                                and up in min(routes[z].values(), key=lambda r: r["length_m"])["path"])
            c = ln["geom"].centroid
            displays.append({"id": f"L2-{SIDE}-D{len(displays) + 1:02d}", "at_line": ln["id"], "zone": ln["to"], "upstream": up,
                             "serves": serves, "angle_deg": round(float(ang(c.x, c.y)), 2), "xyz": [round(c.x, 2), round(c.y, 2), Z2 + 3.2]})

    # ---------------------------------------------------------------- walkable area for the testbed
    walk = unary_union([z["geom"].buffer(0.08, join_style="mitre") for z in zones.values()]).buffer(-0.08, join_style="mitre").buffer(0)
    walk_ok = walk.geom_type == "Polygon"

    # ---------------------------------------------------------------- outputs
    E0, N0 = CFG["frame"]["origin_E"], CFG["frame"]["origin_N"]
    CRS = {"type": "name", "properties": {"name": "local metres (x east, y north, z up); EPSG:2326 E = x + %.3f, N = y + %.3f" % (E0, N0)}}


    def zone_z(z, x, y):
        z0, z1 = z["z"]
        if z0 == z1:
            return z0
        if z["type"] == "seating":
            t = front.exterior.distance(Point(x, y)) / tier_depth
        else:
            t = (math.hypot(x - CX, y - CY) - ray_hit(front, z["angle_deg"][0]) + 2.5) / (ray_hit(conc_inner, z["angle_deg"][0]) - ray_hit(front, z["angle_deg"][0]) + 3.0)
        return round(z0 + (z1 - z0) * min(1.0, max(0.0, t)), 2)


    def poly3d(z):
        g = z["geom"].segmentize(2.0)
        return {"type": "Polygon", "coordinates": [[[round(x, 3), round(y, 3), zone_z(z, x, y)] for x, y in r.coords] for r in [g.exterior, *g.interiors]]}


    def props(z):
        p = {k: v for k, v in z.items() if k not in ("geom", "exit_area")}
        c = z["geom"].representative_point() if not z["geom"].contains(z["geom"].centroid) else z["geom"].centroid
        p["centroid"] = [round(c.x, 2), round(c.y, 2), zone_z(z, c.x, c.y)]
        p["centroid_hk80"] = [round(c.x + E0, 2), round(c.y + N0, 2)]
        p["status"] = CFG["status"]
        return p


    def fc(features):
        return {"type": "FeatureCollection", "crs": CRS, "features": features}


    def dump(name, obj):
        json.dump(obj, open(out_dir / name, "w"), ensure_ascii=False, indent=1)


    zone_props = {z: props(zones[z]) for z in ids}
    dump("zones.geojson", fc([{"type": "Feature", "id": z, "properties": zone_props[z], "geometry": poly3d(zones[z])} for z in ids]))
    dump("lines.geojson", fc([{"type": "Feature", "id": ln["id"], "properties": {k: v for k, v in ln.items() if k != "geom"},
                               "geometry": {"type": "LineString", "coordinates": [[round(x, 3), round(y, 3), ln["z"]] for x, y in ln["geom"].coords]}} for ln in lines]))
    dump("displays.geojson", fc([{"type": "Feature", "id": d["id"], "properties": {k: v for k, v in d.items() if k != "xyz"},
                                  "geometry": {"type": "Point", "coordinates": d["xyz"]}} for d in displays]))
    dump("walkable.geojson", fc(
        [{"type": "Feature", "id": "walkable", "properties": {"kind": "walkable", "area_m2": round(walk.area, 1)}, "geometry": mapping(walk)}]
        + [{"type": "Feature", "id": f"exit:{g}", "properties": {"kind": "exit", "gate_zone": g, "gate_ref": zones[g]["gate_ref"]},
            "geometry": mapping(zones[g]["exit_area"])} for g in gate_ids]
        + [{"type": "Feature", "id": f"zone:{z}", "properties": {"kind": "zone", "zone": z, "type": zones[z]["type"]}, "geometry": mapping(zones[z]["geom"])} for z in ids]))
    dump("spawn.json", {"note": "sold seat positions per zone (local x, y), from the .blend seat instances", "zones": {z: np.round(v, 2).tolist() for z, v in seat_xy.items()},
                        "z": {z: np.round(v, 2).tolist() for z, v in seat_z.items()}})
    dump("graph.json", {"nodes": [{"id": z, "type": zones[z]["type"], "level": zones[z]["level"], "area_m2": zones[z]["area_m2"],
                                   "capacity": zones[z]["capacity"], "monitored": zones[z]["monitored"]} for z in ids],
                        "edges": edges_out, "routes": routes})

    capacity = sum(z["capacity"] for z in zones.values())
    manifest = {
        "manifest_version": CFG["version"], "status": CFG["status"],
        "built_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "venue": "Kai Tak Main Stadium", "scope": CFG["scope"] | {"levels": list(CFG["levels"]), "capacity": capacity},
        "source": {k: REF[k] for k in ("source_blend", "source_sha256", "source_scene", "blender_version", "model_status", "provenance")},
        "frame": CFG["frame"] | {"units": "metres", "axes": "x east, y north, z up", "bowl_centre": [round(CX, 2), round(CY, 2)],
                                 "pitch_centre": [round(PX, 2), round(PY, 2)],
                                 "glb_axes": "glTF +Y up: x = x, y = z, z = -y"},
        "levels": CFG["levels"], "assumed": CFG["assumed"],
        "id_rule": "<level>-<side>-<kind><nn>: S seating, P portal, C concourse cell, G-<letter> gate, F floor, T tunnel, CL line, D display",
        "files": {"mesh": mesh_file, "seats": seats_file, "zones": "zones.geojson", "lines": "lines.geojson",
                  "displays": "displays.geojson", "graph": "graph.json", "walkable": "walkable.geojson", "spawn": "spawn.json"},
        "zones": zone_props,
        "lines": {ln["id"]: {k: v for k, v in ln.items() if k != "geom"} for ln in lines},
        "displays": {d["id"]: d for d in displays},
        "gates": {g: {"ref": zones[g]["gate_ref"], "osm_id": zones[g]["osm_id"]} for g in gate_ids},
        "stage": stage_meta,
    }
    dump("venue_manifest.json", manifest)

    # ---------------------------------------------------------------- QA report
    checks = []


    def check(ok, text, warn=False):
        checks.append(("PASS" if ok else ("WARN" if warn else "FAIL"), text))


    sold_zones = [z for z in ids if zones[z]["capacity"] > 0]
    gates_per_zone = {z: len(routes[z]) for z in sold_zones}
    env_d = {g: round(envelope.exterior.distance(Point(GATES[zones[g]["gate_ref"]]["local_xy"])), 2) for g in gate_ids}
    overlap = max((zones[a]["geom"].intersection(zones[b]["geom"]).area for i, a in enumerate(ids) for b in ids[i + 1:]), default=0)
    glb_mb = (OUT / "venue_lite.glb").stat().st_size / 1e6
    by_type = {}
    for z in zones.values():
        by_type[z["type"]] = by_type.get(z["type"], 0) + 1
    check(len(set(ids)) == len(ids), f"{len(ids)} zones with unique IDs: " + ", ".join(f"{v} {k}" for k, v in sorted(by_type.items())))
    check(all(z["geom"].is_valid and z["geom"].geom_type == "Polygon" and z["geom"].area > 1 for z in zones.values()), "every zone is one valid polygon with area > 1 m²")
    check(overlap < 0.5, f"zones do not overlap (largest pairwise overlap {overlap:.2f} m²)")
    check(all(z["geom"].within(envelope.buffer(A["gate_depth_m"] + 1)) for z in zones.values()), "every zone lies inside the stadium envelope plus the gate forecourt depth")
    check(all(len(adj[z]) > 0 for z in ids), "zone graph has no isolated zone")
    check(all(v >= 2 for v in gates_per_zone.values()), f"every occupied zone reaches at least 2 gates (min {min(gates_per_zone.values())}, max {max(gates_per_zone.values())})")
    far = {zones[g]["gate_ref"]: d for g, d in env_d.items() if d >= 5}
    check(not far, "OSM gate points within 5 m of the model facade: " + ", ".join(f"{zones[g]['gate_ref']} {d} m" for g, d in env_d.items())
          + ("; gate zones are placed on the model facade along the ray through the OSM point" if far else ""), warn=True)
    check(walk_ok, f"walkable area is one connected polygon ({walk.area:,.0f} m², {len(walk.interiors) if walk_ok else '?'} holes)")
    check(all(zones[g]["exit_area"].intersection(walk).area > 0.9 * zones[g]["exit_area"].area for g in gate_ids), "every exit area lies on the walkable polygon")
    check(all(len(seat_xy[z]) == zones[z]["capacity"] for z in seat_xy), f"spawn points match capacity: {capacity:,} people ({sum(zones[z]['capacity'] for z in ids if zones[z]['type'] == 'seating'):,} lower tier, {sum(zones[z]['capacity'] for z in ids if zones[z]['type'] == 'floor'):,} floor)")
    check(glb_mb < 30, f"venue_lite.glb is {glb_mb:.1f} MB (limit 30 MB)")
    check(sum(ln["counting"] for ln in lines) > 0, f"{len(lines)} zone boundaries, {sum(ln['counting'] for ln in lines)} with a counting line; {len(displays)} displays")
    unmon = [z for z in ids if not zones[z]["monitored"]]
    check(0 < len(unmon) < len(ids) / 2, f"{len(unmon)} zones have no camera and must be estimated by M3: {', '.join(unmon)}")
    closed = [z for z in ids if zones[z].get("closed_for_concert")]
    check(True, f"{len(closed)} seating zones are behind the stage video wall and closed: {', '.join(closed)}", warn=bool(closed))
    check(close_gate in gate_ids, f"stage preset `{preset_id}` ({preset['mode']}, {preset['status']}); gate load with everyone at the nearest gate: "
          + ", ".join(f"{zones[g]['gate_ref']} {load[g]:,}" for g in gate_ids)
          + f"; gate to close in the demo: {zones[close_gate]['gate_ref']}, next to the busiest gate {zones[busiest]['gate_ref']}")
    for k, v in CFG["assumed"].items():
        checks.append(("WARN", f"assumed `{k}` = {v['value']} ({v['source']})"))
    checks.append(("WARN", "zone IDs are provisional; `official_sections` is empty until the official seating map is mapped"))
    checks.append(("WARN", f"source model status: {REF['model_status']}"))

    fails = [c for c in checks if c[0] == "FAIL"]
    report = [f"# M1 QA report", "", f"Built {manifest['built_at']} from `{REF['source_blend']}` (sha256 `{REF['source_sha256'][:16]}…`), config v{CFG['version']}.",
              "", f"**{sum(c[0] == 'PASS' for c in checks)} passed, {len(fails)} failed, {sum(c[0] == 'WARN' for c in checks)} notes.**", ""]
    report += [f"- [{s}] {t}" for s, t in checks]
    report += ["", "## Zones", "", "| ID | Type | Area m² | Capacity | Camera | Neighbours |", "|---|---|---|---|---|---|"]
    report += [f"| {z} | {zones[z]['type']} | {zones[z]['area_m2']} | {zones[z]['capacity']} | {'yes' if zones[z]['monitored'] else 'no'} | {len(adj[z])} |" for z in ids]
    (out_dir / "qa_report.md").write_text("\n".join(report) + "\n")

    # ---------------------------------------------------------------- preview
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    COL = {"seating": "#4f7cac", "portal": "#f2a65a", "concourse": "#7fb685", "gate": "#d1495b", "floor": "#8d6cab", "tunnel": "#e0c341"}
    fig, ax = plt.subplots(figsize=(13, 15))
    ax.plot(*envelope.exterior.xy, c="#999", lw=0.8)
    ax.plot(*front.exterior.xy, c="#999", lw=0.8)
    for z in zones.values():
        x, y = z["geom"].exterior.xy
        dead = z.get("closed_for_concert") or not z["monitored"]
        ax.fill(x, y, fc=COL[z["type"]], ec="k", lw=0.5, alpha=0.3 if dead else 0.75, hatch="//" if not z["monitored"] else None)
        c = z["geom"].representative_point()
        ax.text(c.x, c.y, z["id"].split("-", 2)[2], fontsize=6.5, ha="center", va="center")
    for ln in lines:
        ax.plot(*ln["geom"].xy, c="red" if ln["counting"] else "#555", lw=2.2 if ln["counting"] else 0.8)
    for d in displays:
        ax.plot(d["xyz"][0], d["xyz"][1], "k^", ms=4)
    sy0, sy1 = (flip(stage[4]), flip(stage[1])) if mirror else (stage[1], stage[4])
    ax.add_patch(plt.Rectangle((stage[0], sy0), stage[3] - stage[0], sy1 - sy0, fc="#333"))
    ax.text((stage[0] + stage[3]) / 2, (sy0 + sy1) / 2, "STAGE", color="w", ha="center", va="center", fontsize=8)
    ax.set_aspect("equal")
    ax.set_title(f"M1 functional layer{tag} · {SIDE} half · {len(ids)} zones · {capacity:,} people · red = counting line, ▲ = display, hatched = no camera")
    fig.savefig(out_dir / "preview.png", dpi=110, bbox_inches="tight")
    plt.close(fig)

    print("\n".join(f"[{s}] {t}" for s, t in checks))
    return len(fails)


def main():
    ap = argparse.ArgumentParser(description="Build the M1 functional layer for one or all stage presets.")
    ap.add_argument("--preset", choices=list(PRESETS), default=DEFAULT_PRESET)
    ap.add_argument("--all-presets", action="store_true", help="build every preset in config.yaml")
    ap.add_argument("--out", type=Path, default=OUT,
                    help="output root: the default preset is written here, the others to <out>/presets/<id> (default m1_venue/out)")
    a = ap.parse_args()
    fails = 0
    for pid in (list(PRESETS) if a.all_presets else [a.preset]):
        out_dir = a.out if pid == DEFAULT_PRESET else a.out / "presets" / pid
        print(f"== {pid} -> {out_dir}")
        fails += build(pid, out_dir)
    raise SystemExit(1 if fails else 0)


if __name__ == "__main__":
    main()
