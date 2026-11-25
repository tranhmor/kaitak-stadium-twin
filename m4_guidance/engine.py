"""M4: guidance engine (roadmap v7.5 section 4).

Trigger: a walking zone whose 2-minute forecast exceeds Fruin level F (2.2 persons/m²) for two consecutive
updates, or a gate closure. Action: every display is given one open gate so that the gates clear at the
same time. Displays keep their order along the concourse (a display never sends people across the stream
of its neighbour), so a plan is a set of cut points between gates and all plans can be compared.
A proposal changes nothing until the duty manager (or the batch approval rule) approves it.
Observed compliance is estimated from counting lines and used in the next plan: the lower it is, the more
displays have to be redirected to move the same number of people.
"""
import itertools
import math

from contracts.schemas import FRUIN_F

WALK_SPEED = 1.1            # m/s, planning value
DEBOUNCE = 2                # consecutive updates above the threshold
PROPOSAL_TTL_S = 120.0      # an undecided proposal is withdrawn and planned again after this long
COOLDOWN_S = 60.0           # after a decision, before the same zone can trigger again
MIN_GAIN_S = 30.0           # a new plan must cut the expected clearance time by this much
MAX_EXTRA_WALK_M = 150.0    # nobody is sent further than this beyond their usual route
CHANGE_COST_S = 2.0         # charge per changed display, so that equal plans keep the current messages
MIN_PEOPLE = 30             # displays serving fewer remaining people are left alone
DEFAULT_COMPLIANCE = 0.6    # planning value until compliance has been observed
SETTLE_S = 30.0             # people who passed a display walk for about this long before the next counting line


class GuidanceEngine:
    def __init__(self, venue, run_id):
        self.v, self.run_id = venue, run_id
        a = {k: x["value"] for k, x in venue.manifest["assumed"].items()}
        self.gate_cap = a["gate_width_m"] * a["specific_flow_pps_per_m"] * a["gate_flow_share"]     # persons/s
        self.dist, self.next = venue.routes()
        self.default = {d: venue.nearest_gate(x["zone"], self.dist) for d, x in venue.displays.items()}
        self.order = sorted(venue.displays, key=lambda d: venue.displays[d]["angle_deg"])     # along the concourse
        self.gate_order = sorted(venue.gates, key=lambda g: venue.zones[g]["angle_deg"][0])
        self.sharing = {}
        for x in venue.displays.values():
            for z in x["serves"]:
                self.sharing[z] = self.sharing.get(z, 0) + 1
        self.assigned = dict(self.default)          # display -> gate currently shown or implied
        self.active = {}                            # display -> gate, approved messages only
        self.over = {}                              # zone -> consecutive updates above the threshold
        self.cool = {}                              # trigger -> time until which it is ignored
        self.closed = set()
        self.unplanned = set()                      # closed gates not yet covered by a proposal
        self.pending = None
        self.version = 0
        self.compliance = None
        self.track = None                           # bookkeeping for the compliance estimate

    # ------------------------------------------------------------------ helpers
    def path(self, zone, gate):
        p = [zone]
        while p[-1] != gate:
            p.append(self.next[p[-1]][gate])
        return p

    def usual_path(self, display):
        """Route of people who ignore the displays: to their usual gate, and if it is closed, on to the
        nearest open gate from the concourse cell in front of it."""
        zone, gate = self.v.displays[display]["zone"], self.default[display]
        path = self.path(zone, gate)
        if gate in self.closed:
            open_gates = [g for g in self.v.gates if g not in self.closed]
            turn = path[-2]
            path = path[:-1] + self.path(turn, min(open_gates, key=lambda g: self.dist[turn][g]))[1:]
        return path

    def remaining(self, display, state):
        """People still seated who will pass this display (a zone with two displays is split evenly)."""
        return sum(state[z]["count"] / self.sharing[z] for z in self.v.displays[display]["serves"])

    def cost(self, plan, n, usual, walking, p, current):
        """Seconds until the busiest gate clears, plus the mean extra walk and a small charge per change."""
        load = dict(walking)
        extra = 0.0
        for d, g in plan.items():
            u = usual[d]
            if g in self.closed:
                g = u
            load[g] += p * n[d]
            load[u] += (1 - p) * n[d]
            zone = self.v.displays[d]["zone"]
            extra += p * n[d] * max(0.0, self.dist[zone][g] - self.dist[zone][u]) / WALK_SPEED
        total = sum(n.values()) or 1.0
        return max(load.values()) / self.gate_cap + extra / total + CHANGE_COST_S * sum(plan[d] != current[d] for d in plan)

    # ------------------------------------------------------------------ main step
    def step(self, t_s, state, closed):
        """Returns the guidance records that changed in this update: an expired proposal and/or a new one."""
        v = self.v
        closed = set(closed)
        self.unplanned |= closed - self.closed
        self.unplanned &= closed
        self.closed = closed
        newly_closed = self.unplanned
        events = []
        if self.pending and t_s - self.pending["created_t_s"] > PROPOSAL_TTL_S:    # counts have moved on: plan again
            old, self.pending = self.pending, None
            old.update(status="superseded", decided_t_s=t_s, decided_by="rule:expired")
            self.unplanned |= {g for g in closed if g in self.assigned.values()}   # still unanswered
            events.append(old)
        for z in v.zone_ids:
            hot = v.is_walking(z) and state[z]["forecast_density"] > FRUIN_F
            self.over[z] = self.over.get(z, 0) + 1 if hot else 0
        triggers = [(state[z]["forecast_density"], z) for z in v.zone_ids if self.over[z] >= DEBOUNCE and self.cool.get(z, -1) <= t_s]
        open_gates = [g for g in self.gate_order if g not in closed]
        if self.pending or not (triggers or newly_closed) or not open_gates:
            return events
        hot = [z for _, z in sorted(triggers, reverse=True)]
        p = min(max(self.compliance if self.compliance is not None else DEFAULT_COMPLIANCE, 0.15), 1.0)
        n = {d: self.remaining(d, state) for d in self.order}
        usual = {d: self.usual_path(d)[-1] for d in self.order}
        walking = {g: 0.0 for g in open_gates}
        for z in v.zone_ids:                         # people already walking: nearest open gate
            if v.is_walking(z) and state[z]["count"] > 0:
                walking[min(open_gates, key=lambda g: self.dist[z].get(g, math.inf))] += state[z]["count"]
        before = dict(self.assigned)
        current = {d: (g if g not in closed else usual[d]) for d, g in before.items()}
        best, best_cost = current, self.cost(current, n, usual, walking, p, current)
        base_cost = best_cost
        for cuts in itertools.combinations_with_replacement(range(len(self.order) + 1), len(open_gates) - 1):
            edges = (0, *cuts, len(self.order))
            plan = {d: open_gates[k] for k in range(len(open_gates)) for d in self.order[edges[k]:edges[k + 1]]}
            for d in plan:                           # displays with nobody left to guide stay as they are
                if n[d] < MIN_PEOPLE or self.dist[v.displays[d]["zone"]][plan[d]] - self.dist[v.displays[d]["zone"]][usual[d]] > MAX_EXTRA_WALK_M:
                    plan[d] = current[d]
            c = self.cost(plan, n, usual, walking, p, current)
            if c < best_cost - 1e-9:
                best, best_cost = plan, c
        forced = any(g in closed for g in before.values())
        if base_cost - best_cost < MIN_GAIN_S and not forced:
            best = current
        changes = {d: g for d, g in best.items() if g != before[d]}
        if not changes:
            for z in hot:
                self.cool[z] = t_s + COOLDOWN_S
            self.unplanned = set()
            return events
        self.version += 1
        trigger = sorted(newly_closed)[0] if newly_closed else hot[0]
        reason = (f"Gate {v.zones[trigger]['gate_ref']} closed" if newly_closed else
                  f"{trigger} forecast {state[trigger]['forecast_density']:.1f} persons/m² in 2 min (limit {FRUIN_F})")
        reason += f"; busiest gate clears in {base_cost / 60:.0f} min now, {best_cost / 60:.0f} min with this plan (assumed compliance {p:.2f})"
        assignments, messages = [], []
        for d, g in sorted(changes.items()):
            disp = v.displays[d]
            for z in disp["serves"]:
                assignments.append({"zone_id": z, "from_gate": before[d], "to_gate": g, "people": int(round(state[z]["count"] / self.sharing[z]))})
            nxt = self.path(disp["zone"], g)[1]
            (x0, y0), (x1, y1) = disp["xyz"][:2], v.zones[nxt]["centroid"][:2]
            ref = v.zones[g]["gate_ref"]
            messages.append({"display_id": d, "gate_id": g, "gate_ref": ref, "text": f"EXIT VIA GATE {ref}",
                             "bearing_deg": round(math.degrees(math.atan2(y1 - y0, x1 - x0)) % 360, 1)})
        self.pending = {"id": f"{self.run_id}-g{self.version:03d}", "run_id": self.run_id, "version": self.version, "status": "proposed",
                        "created_t_s": t_s, "decided_t_s": None, "decided_by": None, "trigger_zone": trigger,
                        "trigger_forecast": state[trigger]["forecast_density"], "reason": reason,
                        "assignments": assignments, "messages": messages, "plan": changes}
        self.unplanned = set()
        return events + [self.pending]

    def decide(self, t_s, action, by, drop_zones=(), display_pass=None, line_net=None):
        g = self.pending
        if g is None:
            return None
        self.pending = None
        g["decided_t_s"], g["decided_by"] = t_s, by
        self.cool[g["trigger_zone"]] = t_s + (COOLDOWN_S if action == "approve" else 2 * COOLDOWN_S)
        for z in self.v.zone_ids:
            self.over[z] = 0
        if action != "approve":
            g["status"] = "rejected"
            return g
        drop = set(drop_zones)
        if drop:
            keep = {d for d in g["plan"] if not drop & set(self.v.displays[d]["serves"])}
            g["plan"] = {d: x for d, x in g["plan"].items() if d in keep}
            g["messages"] = [m for m in g["messages"] if m["display_id"] in keep]
            g["assignments"] = [a for a in g["assignments"] if a["zone_id"] not in drop]
        g["status"] = "approved"
        self.assigned.update(g["plan"])
        self.active.update(g["plan"])
        if display_pass is not None:
            self.track = {"t0": t_s, "display_pass": dict(display_pass), "line_net": None, "history": []}
        return g

    # ------------------------------------------------------------------ feedback
    def observe(self, t_s, display_pass, line_net):
        """Share of redirected people who followed, estimated from counting lines only.

        Since the last approval, each display has counted the people who passed it. If a share p of them
        follows the message, the expected net flow over a concourse line is base + p * delta, where base
        routes everyone to their usual gate and delta moves the redirected ones to the gate shown.
        p is the least-squares fit over the first line on each redirected route. Lines on the usual route
        are left out: when that route ends in a queue, they count the queue and not the choice."""
        v, tr = self.v, self.track
        if not tr:
            return self.compliance
        # People who passed a display before the approval are still walking when it takes effect, and the
        # last ones counted at a display have not reached a line yet. So displays are read from the approval
        # to SETTLE_S ago, and lines from SETTLE_S after the approval to now.
        tr["history"].append((t_s, dict(display_pass)))
        if tr["line_net"] is None:
            if t_s - tr["t0"] >= SETTLE_S:
                tr["line_net"] = dict(line_net)
            return self.compliance
        while len(tr["history"]) > 1 and tr["history"][1][0] <= t_s - SETTLE_S:
            tr["history"].pop(0)
        if t_s - tr["t0"] < 60 + SETTLE_S:
            return self.compliance
        display_pass = tr["history"][0][1]
        num = den = moved = 0.0
        base, delta, near = {}, {}, set()
        for d, disp in v.displays.items():
            n = display_pass[d] - tr["display_pass"][d]
            usual = self.usual_path(d)
            shown = self.active.get(d, usual[-1])
            guided = self.path(disp["zone"], shown) if shown not in self.closed else usual
            for path, sign, book in ((usual, 1.0, base), (usual, -1.0, delta), (guided, 1.0, delta)):
                if book is delta and guided == usual:
                    continue
                for k, (a, b) in enumerate(zip(path, path[1:])):
                    e, direction = v.moves[(a, b)]
                    book[e["line_id"]] = book.get(e["line_id"], 0.0) + sign * direction * n
                    if path is guided and book is delta and k == 0:
                        near.add(e["line_id"])
            if guided != usual:
                moved += n
        for lid in near:
            dl = delta.get(lid, 0.0)
            num += dl * (line_net[lid] - tr["line_net"][lid] - base.get(lid, 0.0))
            den += dl * dl
        if moved >= 150 and den > 0:
            self.compliance = round(min(1.0, max(0.0, num / den)), 3)
        return self.compliance
