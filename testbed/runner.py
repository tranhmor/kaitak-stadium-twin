"""Runs one testbed scenario against a twin, either in-process (LocalLink, for batch experiments) or
through the M2 HTTP API (HttpLink, for the live demo). The testbed keeps the ground truth and scores the
twin; the twin only ever receives sensor batches and facility changes."""
import time
from datetime import datetime, timedelta, timezone

import numpy as np

from contracts.schemas import FORECAST_HORIZON_S, FRUIN_F, REPORT_INTERVAL_S, ReadingBatch, RunControl
from contracts.venue import Venue, preset_dir
from testbed.meso import MesoTestbed

SOURCE = "testbed:meso"
MAX_T_S = 3600.0


class LocalLink:
    def __init__(self, session):
        self.s = session

    def set_facility(self, zone_id, status):
        self.s.set_facility(zone_id, status)

    def send(self, batch):
        state, _ = self.s.ingest(ReadingBatch(**batch))
        return {"state": state, "actuation": self.s.actuation()}

    def evaluate(self, record):
        pass

    def finish(self, summary):
        pass


class HttpLink:
    def __init__(self, api, run_id):
        import httpx
        self.c, self.run_id = httpx.Client(base_url=api, timeout=10.0), run_id

    def _call(self, method, url, **kw):
        r = self.c.request(method, url, **kw)
        r.raise_for_status()
        return r.json()

    def set_facility(self, zone_id, status):
        self._call("PUT", f"/api/facilities/{zone_id}", json={"status": status, "by": "venue-ops"})

    def send(self, batch):
        return self._call("POST", "/api/readings", json=batch)

    def evaluate(self, record):
        self._call("POST", f"/api/runs/{self.run_id}/evaluation", json=record)

    def finish(self, summary):
        self._call("POST", f"/api/runs/{self.run_id}/result", json=summary)

    def stopped(self):
        return self._call("GET", f"/api/runs/{self.run_id}")["status"] != "running"


def run_scenario(cfg: RunControl, link, run_id, venue=None, realtime=False, on_step=None):
    v = venue or Venue(preset_dir(cfg.layout))           # the stage preset chosen for the run
    tb = MesoTestbed(seed=cfg.seed, p_follow=cfg.p_follow, venue=v)
    walking = [z for z in v.zone_ids if v.is_walking(z)]
    blind = [z for z in v.zone_ids if not v.zones[z]["monitored"]]
    start = datetime.now(timezone.utc).astimezone()
    err, err_blind, err_fc, pending_fc = [], [], [], []
    over_s = {z: 0 for z in walking}
    peak = {z: 0.0 for z in walking}
    hit = miss = false_alarm = 0
    seq, closed_sent, wall0 = 0, False, time.time()
    while tb.exited() < tb.n and tb.t < MAX_T_S:
        if cfg.close_gate and not closed_sent and tb.t >= cfg.close_at_s:
            link.set_facility(cfg.close_gate, "closed")
            tb.set_closed([cfg.close_gate])
            closed_sent = True
        tb.step(1.0)
        truth = tb.true_counts()
        dens = {z: truth[z] / v.area[z] for z in v.zone_ids}
        for z in walking:
            over_s[z] += dens[z] > FRUIN_F
            peak[z] = max(peak[z], dens[z])
        if tb.t % REPORT_INTERVAL_S:
            continue
        dropped = cfg.drop_zones if cfg.drop_from_s <= tb.t < cfg.drop_to_s else ()
        zc, lc = tb.sensor_batch(dropped)
        reply = link.send({"run_id": run_id, "seq": seq, "t_s": tb.t, "ts": (start + timedelta(seconds=tb.t)).isoformat(timespec="seconds"),
                           "source": SOURCE, "zone_counts": zc, "line_counts": lc, "sent_wall": time.time()})
        seq += 1
        state, act = reply["state"], reply["actuation"]
        tb.set_guidance(act["displays"])
        tb.set_closed(act["closed"])
        e = {z: abs(state["zones"][z]["density"] - dens[z]) for z in walking}
        err.append(list(e.values()))
        err_blind.append([e[z] for z in blind])
        while pending_fc and pending_fc[0][0] <= tb.t:
            _, fc = pending_fc.pop(0)
            err_fc.append([abs(fc[z] - dens[z]) for z in walking])
            for z in walking:
                a, b = fc[z] > FRUIN_F, dens[z] > FRUIN_F
                hit, miss, false_alarm = hit + (a and b), miss + (b and not a), false_alarm + (a and not b)
        pending_fc.append((tb.t + FORECAST_HORIZON_S, {z: state["zones"][z]["forecast_density"] for z in walking}))
        link.evaluate({"seq": seq - 1, "t_s": tb.t, "exited": tb.exited(), "true_max_density": round(max(dens[z] for z in walking), 3),
                       "true_zones_over": sum(dens[z] > FRUIN_F for z in walking), "mean_abs_error": round(float(np.mean(err[-1])), 4),
                       "max_abs_error": round(float(np.max(err[-1])), 4),
                       "blind": {z: {"true": round(dens[z], 3), "estimated": state["zones"][z]["density"]} for z in blind}})
        if on_step:
            on_step(tb, state)
        if realtime:
            if seq % 4 == 0 and link.stopped():
                break
            time.sleep(max(0.0, wall0 + tb.t / cfg.speed - time.time()))
    s = tb.summary()
    err, err_fc = np.array(err), np.array(err_fc) if err_fc else np.zeros((1, 1))
    summary = {
        **s, "run_id": run_id, "label": cfg.label, "p_follow": cfg.p_follow, "seed": cfg.seed, "close_gate": cfg.close_gate,
        "approval": cfg.approval, "completed": tb.exited() == tb.n, "sim_time_s": tb.t,
        "over_threshold_zone_seconds": int(sum(over_s.values())), "zones_ever_over": sorted(z for z, n in over_s.items() if n),
        "peak_density": round(max(peak.values()), 2), "peak_zone": max(peak, key=peak.get),
        "density_mae": round(float(err.mean()), 4), "density_p95_error": round(float(np.quantile(err, 0.95)), 4),
        "density_max_error": round(float(err.max()), 4),
        "blind_zone_mae": round(float(np.mean(err_blind)), 4), "blind_zone_max_error": round(float(np.max(err_blind)), 4),
        "forecast_mae": round(float(err_fc.mean()), 4), "forecast_p95_error": round(float(np.quantile(err_fc, 0.95)), 4),
        "forecast_hits": int(hit), "forecast_misses": int(miss), "forecast_false_alarms": int(false_alarm),
        "estimated_compliance": state.get("compliance"),
    }
    link.finish(summary)
    return summary
