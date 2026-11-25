"""Shared reader for the M1 outputs. Every module (M2-M5, testbed) takes zones, lines and IDs from here."""
import heapq
import json
import math
from pathlib import Path

M1_OUT = Path(__file__).resolve().parent.parent / "m1_venue" / "out"
TWO_WAY = {("concourse", "concourse"), ("floor", "floor")}     # every other boundary is walked from -> to only
WALKING = ("portal", "concourse", "gate", "tunnel")            # zone types judged against the Fruin F threshold


class Venue:
    def __init__(self, out_dir=M1_OUT):
        out_dir = Path(out_dir)
        self.manifest = json.load(open(out_dir / "venue_manifest.json"))
        graph = json.load(open(out_dir / "graph.json"))
        self.zones = self.manifest["zones"]
        self.zone_ids = list(self.zones)
        self.index = {z: i for i, z in enumerate(self.zone_ids)}
        self.lines = self.manifest["lines"]
        self.displays = self.manifest["displays"]
        self.edges = graph["edges"]
        self.gates = [z for z in self.zone_ids if self.zones[z]["type"] == "gate"]
        self.area = {z: self.zones[z]["area_m2"] for z in self.zone_ids}
        self.counting_lines = [e["line_id"] for e in self.edges if e["counting"]]
        self.line_mid = {}
        for f in json.load(open(out_dir / "lines.geojson"))["features"]:
            (x0, y0, _), (x1, y1, _) = f["geometry"]["coordinates"]
            self.line_mid[f["id"]] = ((x0 + x1) / 2, (y0 + y1) / 2)
        # directed moves: (from_zone, to_zone) -> edge, sign (+1 = the line's forward direction)
        self.moves = {}
        for e in self.edges:
            self.moves[(e["from"], e["to"])] = (e, 1)
            if (self.zones[e["from"]]["type"], self.zones[e["to"]]["type"]) in TWO_WAY:
                self.moves[(e["to"], e["from"])] = (e, -1)
        self.out = {z: [] for z in self.zone_ids}
        for (a, b), (e, _) in self.moves.items():
            self.out[a].append(b)

    def is_walking(self, zone_id):
        return self.zones[zone_id]["type"] in WALKING

    def to_line(self, zone_id, line_id):
        """Walking distance from a zone's centroid to the middle of one of its boundary lines."""
        cx, cy, _ = self.zones[zone_id]["centroid"]
        mx, my = self.line_mid[line_id]
        return math.hypot(cx - mx, cy - my)

    def routes(self, open_gates=None):
        """Shortest walking distance and next zone from every zone to every open gate.
        Returns (dist[zone][gate], next_zone[zone][gate])."""
        open_gates = self.gates if open_gates is None else open_gates
        back = {z: [] for z in self.zone_ids}
        for (a, b), (e, _) in self.moves.items():
            back[b].append((a, e["length_m"]))
        dist = {z: {} for z in self.zone_ids}
        nxt = {z: {} for z in self.zone_ids}
        for g in open_gates:
            d, pq = {g: 0.0}, [(0.0, g)]
            while pq:
                du, u = heapq.heappop(pq)
                if du > d[u]:
                    continue
                for v, w in back[u]:
                    if self.zones[v]["type"] == "gate":
                        continue
                    if du + w < d.get(v, math.inf):
                        d[v] = du + w
                        nxt[v][g] = u
                        heapq.heappush(pq, (du + w, v))
            for z, dz in d.items():
                dist[z][g] = dz
        return dist, nxt

    def nearest_gate(self, zone_id, dist, open_gates=None):
        cands = {g: d for g, d in dist[zone_id].items() if open_gates is None or g in open_gates}
        return min(cands, key=cands.get) if cands else None
