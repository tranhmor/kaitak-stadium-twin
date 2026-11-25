"""One twin session = one run: M3 estimator + M4 engine fed by reading batches. No I/O here, so the
service (m2_service/app.py) and the offline experiments (testbed/experiment.py) run identical logic."""
from contracts.schemas import Guidance
from m3_state.estimator import StateEstimator
from m4_guidance.engine import GuidanceEngine


class Rejected(ValueError):
    """A batch that breaks the contract: unknown ID, zone without a camera, or a repeated sequence number."""


def public(g):
    return Guidance(**g).model_dump()


class TwinSession:
    def __init__(self, venue, run_id, approval="manual"):
        self.v, self.run_id, self.approval = venue, run_id, approval
        self.est = StateEstimator(venue)
        self.eng = GuidanceEngine(venue, run_id)
        self.closed = set()
        self.seq, self.t = -1, 0.0
        self.guidance = {}
        self.state = None
        self.counting = set(venue.counting_lines)

    def set_facility(self, zone_id, status):
        if zone_id not in self.v.gates:
            raise Rejected(f"{zone_id} is not a gate in the venue manifest")
        (self.closed.add if status == "closed" else self.closed.discard)(zone_id)

    def actuation(self):
        """What the venue (or the testbed) must apply: approved display messages and closed gates."""
        return {"displays": dict(self.eng.active), "closed": sorted(self.closed)}

    def ingest(self, batch):
        """Returns (state, changed guidance records)."""
        v = self.v
        if batch.seq <= self.seq:
            raise Rejected(f"sequence {batch.seq} already received (last {self.seq})")
        bad = [c.zone_id for c in batch.zone_counts if c.zone_id not in v.zones or not v.zones[c.zone_id]["monitored"]]
        bad += [c.line_id for c in batch.line_counts if c.line_id not in self.counting]
        if bad:
            raise Rejected(f"IDs not in the manifest as camera zones or counting lines: {bad[:5]}")
        self.seq, self.t = batch.seq, batch.t_s
        zones = self.est.update(batch.t_s, {c.zone_id: c.count for c in batch.zone_counts},
                                {c.line_id: (c.forward, c.backward) for c in batch.line_counts}, self.closed)
        self.eng.observe(batch.t_s, self.est.display_pass, self.est.line_net)
        events = []
        if self.approval != "none":
            for g in self.eng.step(batch.t_s, zones, self.closed):
                events.append(self._keep(g))
                if g["status"] == "proposed" and self.approval == "auto":
                    events.append(self.decide("approve", "rule:auto"))
        flows = {}
        for e in v.edges:
            f = self.est.rate[(e["from"], e["to"])] - self.est.rate.get((e["to"], e["from"]), 0.0)
            if abs(f) > 0.01:
                flows[e["line_id"]] = round(f, 2)
        kpis = self.est.kpis(zones)
        self.state = {
            "run_id": self.run_id, "seq": batch.seq, "t_s": batch.t_s, "ts": batch.ts, "zones": zones, "kpis": kpis,
            "facilities": {g: ("closed" if g in self.closed else "open") for g in v.gates},
            "gate_arrivals": {g: round(n, 0) for g, n in self.est.gate_in.items()}, "flows": flows,
            "displays": dict(self.eng.assigned),
            "redirected": sorted(d for d, g in self.eng.active.items() if g != self.eng.default[d]),
            "pending_guidance": self.eng.pending["id"] if self.eng.pending else None,
            "compliance": self.eng.compliance, "latency_ms": None,
        }
        return self.state, events

    def decide(self, action, by, drop_zones=()):
        g = self.eng.decide(self.t, action, by, drop_zones, self.est.display_pass, self.est.line_net)
        return self._keep(g) if g else None

    def _keep(self, g):
        self.guidance[g["id"]] = public(g)
        return self.guidance[g["id"]]
