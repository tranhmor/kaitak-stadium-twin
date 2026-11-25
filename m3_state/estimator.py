"""M3: state estimate and 2-minute forecast (roadmap v7.5 section 4).

Uses sensor data only: camera counts for covered zones and crossings at counting lines.
State: people per zone. Each update predicts with a flow balance on the zone graph and corrects
camera-covered zones with a per-zone (diagonal) Kalman filter; zones without a camera, or whose camera
reading is stale, keep the flow-balance estimate. The forecast runs the flow balance forward: seating and
floor zones keep emptying at the measured rate, walking zones pass people on at the Weidmann (1993)
speed for their density, limited by boundary capacity, jam density downstream and closed gates.
The testbed uses the same speed-density law, so forecast skill measured against it is an upper bound.
"""
import math

import numpy as np

from contracts.schemas import FORECAST_HORIZON_S, FRUIN_F, STALE_AFTER_S

LINE_RECALL = 0.97      # assumed counting-line detection rate (sensor specification)
CAMERA_CV = 0.05        # assumed camera count error, share of the count
RATE_ALPHA = 0.3        # smoothing of measured flow rates
GATE_DWELL_S = 10.0     # time to walk through a gate forecourt
V_FREE, RHO_MAX = 1.34, 5.4   # Weidmann free speed (m/s) and maximum density (persons/m²)


def walking_speed(rho):
    return np.maximum(0.1, V_FREE * (1 - np.exp(-1.913 * (1 / np.maximum(rho, 0.05) - 1 / RHO_MAX))))


class StateEstimator:
    def __init__(self, venue):
        self.v = v = venue
        n = len(v.zone_ids)
        assumed = {k: a["value"] for k, a in v.manifest["assumed"].items()}
        self.flow_per_m, self.gate_share, self.jam = assumed["specific_flow_pps_per_m"], assumed["gate_flow_share"], assumed["jam_density_ppm2"]
        self.area = np.array([v.area[z] for z in v.zone_ids])
        self.x = np.array([float(v.zones[z]["capacity"]) for z in v.zone_ids])     # ticketed occupancy at the start
        self.P = np.full(n, 25.0)
        self.seen = np.zeros(n)
        self.t = 0.0
        self.rate = {m: 0.0 for m in v.moves}                                       # persons/s per directed move
        self.gate_in = {g: 0.0 for g in v.gates}                                    # cumulative arrivals per gate
        self.line_net = {e["line_id"]: 0.0 for e in v.edges}                        # cumulative net forward crossings
        self.display_pass = {d: 0.0 for d in v.displays}                            # cumulative passes per display
        self.display_line = {d["at_line"]: k for k, d in v.displays.items()}
        self.line_edge = {e["line_id"]: e for e in v.edges}
        self.is_origin = np.array([v.zones[z]["type"] in ("seating", "floor") for z in v.zone_ids])
        self.is_gate = np.array([v.zones[z]["type"] == "gate" for z in v.zone_ids])
        self.walking = np.array([v.is_walking(z) for z in v.zone_ids])
        # walking distance across a zone: twice the mean distance from its centroid to its boundary lines
        self.length = np.array([2 * np.mean([v.to_line(z, e["line_id"]) for e in v.edges if z in (e["from"], e["to"])]) for z in v.zone_ids])

    # ------------------------------------------------------------------ update
    def update(self, t_s, zone_counts, line_counts, closed=()):
        v, idx = self.v, self.v.index
        dt = max(t_s - self.t, 1e-6)
        self.t = t_s
        net, gross = np.zeros(len(self.x)), np.zeros(len(self.x))
        flows = {m: 0.0 for m in v.moves}
        for lid, (fwd, bwd) in line_counts.items():
            e = self.line_edge[lid]
            a, b = e["from"], e["to"]
            fwd, bwd = fwd / LINE_RECALL, bwd / LINE_RECALL
            self.line_net[lid] += fwd - bwd
            net[idx[a]] -= fwd - bwd
            net[idx[b]] += fwd - bwd
            gross[idx[a]] += fwd + bwd
            gross[idx[b]] += fwd + bwd
            flows[(a, b)] = fwd
            if (b, a) in flows:
                flows[(b, a)] = bwd
            if b in self.gate_in:
                self.gate_in[b] += fwd
            if lid in self.display_line:
                self.display_pass[self.display_line[lid]] += fwd
        # boundaries without a counting line: seating -> portal, inferred from the drop in the seating count
        uncounted = np.zeros(len(self.x), bool)
        for (a, b), (e, _) in v.moves.items():
            if e["counting"]:
                continue
            uncounted[idx[a]] = uncounted[idx[b]] = True
            if v.zones[a]["type"] == "seating" and a in zone_counts:
                out = max(0.0, self.x[idx[a]] - zone_counts[a])
                net[idx[b]] += out
                flows[(a, b)] = out
        for m, f in flows.items():
            self.rate[m] += RATE_ALPHA * (f / dt - self.rate[m])
        # predict
        x = self.x + net
        x[self.is_gate] = self.x[self.is_gate] * math.exp(-dt / GATE_DWELL_S) + np.maximum(net[self.is_gate], 0)
        P = self.P + 1.0 + (0.05 * gross) ** 2 + np.where(uncounted, 400.0, 0.0)
        # correct with camera counts
        for z, m in zone_counts.items():
            i = idx[z]
            R = (CAMERA_CV * max(m, 10.0)) ** 2 + 1.0
            K = P[i] / (P[i] + R)
            x[i] += K * (m - x[i])
            P[i] *= 1 - K
            self.seen[i] = t_s
        self.x = np.clip(x, 0.0, self.jam * self.area * 1.1)
        self.P = P
        fc = self.forecast(closed)
        state = {}
        for z, i in idx.items():
            monitored = v.zones[z]["monitored"]
            age = t_s - self.seen[i] if monitored else 0.0
            stale = monitored and age > STALE_AFTER_S
            state[z] = {"count": round(float(self.x[i]), 1), "density": round(float(self.x[i] / self.area[i]), 3),
                        "forecast_density": round(float(fc[i] / self.area[i]), 3),
                        "basis": "measured" if monitored and not stale else "estimated", "stale": bool(stale), "age_s": round(float(age), 1)}
        return state

    # ------------------------------------------------------------------ forecast
    def forecast(self, closed=(), horizon_s=FORECAST_HORIZON_S, dt=5.0):
        v, idx = self.v, self.v.index
        x = self.x.copy()
        out_rate = {z: 0.0 for z in v.zone_ids}
        for (a, b), r in self.rate.items():
            out_rate[a] += r
        for _ in range(int(horizon_s / dt)):
            dx = np.zeros(len(x))
            room = np.maximum(self.jam * self.area - x, 0.0)
            leave = np.minimum(1.0, walking_speed(x / self.area) * dt / self.length)     # share of a zone that walks out in dt
            for (a, b), (e, _) in v.moves.items():
                ai, bi = idx[a], idx[b]
                if self.is_origin[ai]:
                    want = self.rate[(a, b)] * dt                                    # origins keep discharging at the measured rate
                else:
                    share = self.rate[(a, b)] / out_rate[a] if out_rate[a] > 1e-3 else 1.0 / len(v.out[a])
                    want = share * x[ai] * leave[ai]                                 # walking zones pass on their content
                cap = e["width_m"] * self.flow_per_m * dt
                if self.is_gate[bi]:
                    cap = 0.0 if b in closed else cap * self.gate_share
                f = max(0.0, min(want, cap, x[ai] + dx[ai], room[bi] - dx[bi]))
                dx[ai] -= f
                dx[bi] += f
            x = np.maximum(x + dx, 0.0)
            x[self.is_gate] *= math.exp(-dt / GATE_DWELL_S)
        return x

    # ------------------------------------------------------------------ indicators
    def kpis(self, state):
        v = self.v
        inside = float(self.x.sum())
        total = float(sum(z["capacity"] for z in v.zones.values()))
        walk = [(state[z]["density"], z) for z in v.zone_ids if v.is_walking(z)]
        fwalk = [(state[z]["forecast_density"], z) for z in v.zone_ids if v.is_walking(z)]
        return {"people_total": total, "people_inside": round(inside, 0), "exited_share": round(max(0.0, 1 - inside / total), 4),
                "max_density": max(walk)[0], "max_forecast_density": max(fwalk)[0],
                "zones_over_now": float(sum(d > FRUIN_F for d, _ in walk)), "zones_over_forecast": float(sum(d > FRUIN_F for d, _ in fwalk)),
                "stale_zones": float(sum(s["stale"] for s in state.values()))}
