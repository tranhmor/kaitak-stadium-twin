"""Agent testbed, mesoscopic stand-in for JuPedSim (roadmap v7.5 section 6).

Every spectator is an individual agent with a seat, a pre-movement delay, a walking speed, a target gate
and a compliance draw. Agents move zone to zone on the M1 graph; each boundary passes at most
the design flow per metre of width and a zone accepts people only below jam density (both from the M1 manifest). Walking speed inside a zone
follows the Weidmann fundamental diagram. This reproduces queues and spillback at zone resolution; it does
not resolve individual trajectories, so it replaces JuPedSim only until the microscopic run is wired in.
The twin never reads this module: it receives `sensor_batch()` through M2 only.
"""
import json
import math

import numpy as np

from contracts.venue import Venue

V_FREE = 1.34           # m/s, Weidmann free speed
RHO_MAX = 5.4


def weidmann(rho):
    if rho <= 0.05:
        return V_FREE
    return max(0.1, V_FREE * (1 - math.exp(-1.913 * (1 / rho - 1 / RHO_MAX))))


class MesoTestbed:
    def __init__(self, seed=1, p_follow=0.6, premove_median_s=75.0, camera_noise=0.05, line_detect=0.97,
                 venue=None):
        self.v = venue or Venue()
        self.rng = np.random.default_rng(seed)
        self.sensor_rng = np.random.default_rng(seed + 10_000)
        self.p_follow = p_follow
        assumed = {k: a["value"] for k, a in self.v.manifest["assumed"].items()}
        self.gate_share, self.specific_flow, self.jam = assumed["gate_flow_share"], assumed["specific_flow_pps_per_m"], assumed["jam_density_ppm2"]
        self.camera_noise, self.line_detect = camera_noise, line_detect
        v = self.v
        spawn = json.load(open(v.out_dir / "spawn.json"))["zones"]
        zone, xy = [], []
        for z, pts in spawn.items():
            zone += [v.index[z]] * len(pts)
            xy += pts
        self.n = len(zone)
        self.zone = np.array(zone)
        self.origin = self.zone.copy()
        xy = np.array(xy)
        self.speed = np.clip(self.rng.normal(1.0, 0.15, self.n), 0.6, 1.4)
        self.premove = np.minimum(self.rng.lognormal(math.log(premove_median_s), 0.7, self.n), 600.0)
        self.follower = self.rng.random(self.n) < p_follow
        self.guided = np.zeros(self.n, bool)        # saw a message naming a gate other than its own
        self.followed = np.zeros(self.n, bool)
        self.exit_t = np.full(self.n, np.nan)
        self.exit_gate = np.full(self.n, -1)
        self.closed = set()
        self.messages = {}                          # display_id -> gate zone id
        self.display_at = {(d["upstream"], d["zone"]): d["id"] for d in v.displays.values()}
        self.dist, self.next = v.routes()               # all gates: people walk towards a closed gate until they see it
        self.open_dist = self.dist                      # open gates only: used when choosing a new gate
        self.gate_idx = {g: i for i, g in enumerate(v.gates)}
        self.target = np.array([self.gate_idx[v.nearest_gate(v.zone_ids[z], self.dist)] for z in self.zone])
        # time at which the agent reaches the boundary it leaves its origin zone through
        first_line = [v.moves[(v.zone_ids[z], self.next[v.zone_ids[z]][v.gates[g]])][0]["line_id"] for z, g in zip(self.zone, self.target)]
        mids = np.array([v.line_mid[l] for l in first_line])
        self.ready = self.premove + np.hypot(*(xy - mids).T) / (0.6 * self.speed)   # 0.6 m/s along seat rows
        self.t = 0.0
        self.credit = {m: 0.0 for m in v.moves}
        self.cross = {e["line_id"]: [0, 0] for e in v.edges}                        # forward, backward since last batch
        self.gate_out = {g: 0 for g in v.gates}

    # ------------------------------------------------------------------ inputs from the twin (through M2)
    def set_guidance(self, messages):
        self.messages = dict(messages)

    def set_closed(self, gates):
        gates = set(gates)
        if gates != self.closed:
            self.closed = gates
            self.open_dist, _ = self.v.routes([g for g in self.v.gates if g not in gates])

    # ------------------------------------------------------------------ dynamics
    def _retarget(self, idx, gate):
        self.target[idx] = self.gate_idx[gate]

    def step(self, dt=1.0):
        v, t = self.v, self.t
        inside = np.isnan(self.exit_t)
        counts = np.bincount(self.zone[inside], minlength=len(v.zone_ids)).astype(float)
        # people who can see that their gate is closed pick the nearest open one
        for g in self.closed:
            gi = self.gate_idx[g]
            for nb in v.zones[g]["neighbors"]:
                seen = np.where(inside & (self.zone == v.index[nb]) & (self.target == gi))[0]
                if len(seen):
                    self._retarget(seen, v.nearest_gate(nb, self.open_dist))
        # gate zones are forecourts: people walk through and leave the model
        for g in v.gates:
            done = np.where(inside & (self.zone == v.index[g]) & (self.ready <= t))[0]
            self.exit_t[done], self.exit_gate[done] = t, self.gate_idx[g]
            self.gate_out[g] += len(done)
            counts[v.index[g]] -= len(done)
        moves = list(v.moves.items())
        self.rng.shuffle(moves)
        for (a, b), (e, sign) in moves:
            cap = e["width_m"] * self.specific_flow * dt
            if v.zones[b]["type"] == "gate":
                cap = 0.0 if b in self.closed else cap * self.gate_share
            self.credit[(a, b)] = min(self.credit[(a, b)] + cap, max(cap, 1.0) * 2)
            ai, bi = v.index[a], v.index[b]
            in_a = np.where(inside & (self.zone == ai) & (self.ready <= t))[0]
            if not len(in_a):
                continue
            want = np.array([self.next[a].get(v.gates[g]) == b for g in self.target[in_a]])
            cand = in_a[want]
            room = int(self.jam * v.area[b] - counts[bi])
            k = min(len(cand), int(self.credit[(a, b)]), max(room, 0))
            if k <= 0:
                continue
            go = cand[np.argsort(self.ready[cand])[:k]]
            self.credit[(a, b)] -= k
            self.cross[e["line_id"]][0 if sign > 0 else 1] += k
            counts[ai] -= k
            counts[bi] += k
            self.zone[go] = bi
            disp = self.display_at.get((a, b))
            msg = self.messages.get(disp) if disp else None
            if msg and msg not in self.closed:
                other = self.target[go] != self.gate_idx[msg]
                self.guided[go[other]] = True
                obey = go[other & self.follower[go]]
                self.followed[obey] = True
                self._retarget(obey, msg)
            # walking time across zone b to the boundary it will leave through
            rho = counts[bi] / v.area[b]
            if v.zones[b]["type"] == "gate":
                walk = np.full(k, self.v.manifest["assumed"]["gate_depth_m"]["value"])
            else:
                nxt = [self.next[b].get(v.gates[g]) for g in self.target[go]]
                walk = np.array([v.to_line(b, e["line_id"]) + (v.to_line(b, v.moves[(b, n)][0]["line_id"]) if n else 0.0) for n in nxt])
            self.ready[go] = t + walk / (weidmann(rho) * self.speed[go])
        self.t += dt

    # ------------------------------------------------------------------ outputs
    def true_counts(self):
        inside = np.isnan(self.exit_t)
        c = np.bincount(self.zone[inside], minlength=len(self.v.zone_ids))
        return {z: int(c[i]) for z, i in self.v.index.items()}

    def sensor_batch(self, dropped=()):
        """Virtual cameras: noisy counts for camera-covered zones, thinned crossings at counting lines."""
        v, truth = self.v, self.true_counts()
        zc = []
        for z in v.zone_ids:
            if v.zones[z]["monitored"] and z not in dropped:
                n = truth[z]
                zc.append({"zone_id": z, "count": max(0, int(round(n * (1 + self.sensor_rng.normal(0, self.camera_noise)))))})
        lc = []
        for lid in v.counting_lines:
            f, b = self.cross[lid]
            lc.append({"line_id": lid, "forward": int(self.sensor_rng.binomial(f, self.line_detect)),
                       "backward": int(self.sensor_rng.binomial(b, self.line_detect))})
        self.cross = {l: [0, 0] for l in self.cross}
        return zc, lc

    def exited(self):
        return int(np.sum(~np.isnan(self.exit_t)))

    def summary(self):
        done = self.exit_t[~np.isnan(self.exit_t)]
        q = lambda p: float(np.quantile(done, p)) if len(done) >= p * self.n else None
        guided = int(self.guided.sum())
        return {"people": self.n, "exited": int(len(done)), "t50_s": q(0.5), "t90_s": q(0.9), "t100_s": float(done.max()) if len(done) == self.n else None,
                "guided": guided, "followed": int(self.followed.sum()), "true_compliance": (float(self.followed.sum()) / guided) if guided else None,
                "exits_by_gate": {g: int(np.sum(self.exit_gate == i)) for g, i in self.gate_idx.items()}}
