"""Checks of the M1 outputs, the M2 contract and the closed loop. Run: .venv/bin/python -m pytest -q"""
import json

import pytest

from contracts.schemas import FRUIN_F, ReadingBatch, RunControl
from contracts.venue import M1_OUT, Venue
from m2_service.core import Rejected, TwinSession
from testbed.runner import LocalLink, run_scenario

GATE_D = "L2-W-G-D"


@pytest.fixture(scope="module")
def venue():
    return Venue()


def run(venue, **kw):
    cfg = RunControl(launch=False, **kw)
    return run_scenario(cfg, LocalLink(TwinSession(venue, "t", cfg.approval)), "t", venue)


def test_m1_ids_are_consistent_across_files(venue):
    zones = {f["id"] for f in json.load(open(M1_OUT / "zones.geojson"))["features"]}
    lines = {f["id"] for f in json.load(open(M1_OUT / "lines.geojson"))["features"]}
    assert zones == set(venue.zones) and lines == set(venue.lines)
    assert all(e["from"] in zones and e["to"] in zones and e["line_id"] in lines for e in venue.edges)
    assert all(d["zone"] in zones and d["at_line"] in lines and set(d["serves"]) <= zones for d in venue.displays.values())
    assert "FAIL" not in (M1_OUT / "qa_report.md").read_text().split("## Zones")[0].replace("0 failed", "")


def test_m2_rejects_unknown_ids_and_repeats(venue):
    s = TwinSession(venue, "t")
    ok = dict(run_id="t", seq=0, t_s=5, ts="2026-11-24T22:00:05+08:00", source="test", zone_counts=[], line_counts=[])
    s.ingest(ReadingBatch(**ok))
    with pytest.raises(Rejected):
        s.ingest(ReadingBatch(**ok))                                             # same sequence number again
    with pytest.raises(Rejected):
        s.ingest(ReadingBatch(**{**ok, "seq": 1, "zone_counts": [{"zone_id": "L9-X-C99", "count": 3}]}))
    with pytest.raises(Rejected):                                                # zone exists but has no camera
        s.ingest(ReadingBatch(**{**ok, "seq": 1, "zone_counts": [{"zone_id": "L2-W-C03", "count": 3}]}))


def test_density_estimate_within_roadmap_target(venue):
    r = run(venue, approval="none", close_gate=GATE_D)
    assert r["density_max_error"] <= 0.5 and r["blind_zone_max_error"] <= 0.5


def test_guidance_shortens_egress_and_compliance_is_recovered(venue):
    base = run(venue, approval="none", close_gate=GATE_D)
    guided = run(venue, approval="auto", close_gate=GATE_D, p_follow=0.5)
    assert guided["t90_s"] < base["t90_s"]
    assert guided["over_threshold_zone_seconds"] < base["over_threshold_zone_seconds"]
    assert abs(guided["estimated_compliance"] - guided["true_compliance"]) < 0.1


def test_nothing_changes_without_approval(venue):
    base = run(venue, approval="none", close_gate=GATE_D)
    ignored = run(venue, approval="manual", close_gate=GATE_D, p_follow=0.8)     # proposals made, nobody approves
    assert ignored["guided"] == 0 and ignored["t90_s"] == base["t90_s"]


def test_camera_outage_is_marked_stale_and_estimated(venue):
    cfg = RunControl(launch=False, approval="none", drop_zones=["L2-W-C10"], drop_from_s=200, drop_to_s=320)
    session, seen = TwinSession(venue, "t", "none"), []
    r = run_scenario(cfg, LocalLink(session), "t", venue, on_step=lambda tb, st: seen.append((tb.t, st["zones"]["L2-W-C10"])))
    during = [z for t, z in seen if 215 <= t < 320]
    assert all(z["stale"] and z["basis"] == "estimated" for z in during)
    assert not [z for t, z in seen if t >= 330 and z["stale"]]
    assert r["density_max_error"] <= 0.5


def test_reject_partial_approval_and_expiry(venue):
    cfg = RunControl(launch=False, approval="manual", close_gate=GATE_D, p_follow=0.5)
    session, done = TwinSession(venue, "t", "manual"), {}

    def expired():
        return any(g["status"] == "superseded" and g["decided_by"] == "rule:expired" for g in session.guidance.values())

    def on_step(tb, state):
        pending = session.guidance.get(state["pending_guidance"])
        if not pending:
            return
        if "rejected" not in done:
            done["rejected"] = session.decide("reject", "test")
            assert session.actuation()["displays"] == {}                      # a rejected proposal changes nothing
        elif "partial" not in done and len(pending["messages"]) > 1 and expired():      # the one before was left undecided
            dropped = venue.displays[pending["messages"][0]["display_id"]]
            done["partial"] = (session.decide("approve", "test", drop_zones=dropped["serves"]), dropped["id"], len(pending["messages"]))

    run_scenario(cfg, LocalLink(session), "t", venue, on_step=on_step)
    assert done["rejected"]["status"] == "rejected"
    approved, dropped_id, proposed = done["partial"]
    shown = {m["display_id"] for m in approved["messages"]}
    assert approved["status"] == "approved" and dropped_id not in shown and 0 < len(shown) < proposed
    assert dropped_id not in session.actuation()["displays"]
    assert expired()


def test_compliance_estimate_holds_when_only_one_proposal_is_approved(venue):
    cfg = RunControl(launch=False, approval="manual", close_gate=GATE_D, p_follow=0.5)
    session, approved, seen = TwinSession(venue, "t", "manual"), [], []

    def on_step(tb, state):
        seen.append(state["compliance"])
        if state["pending_guidance"] and not approved:
            approved.append(session.decide("approve", "test"))

    r = run_scenario(cfg, LocalLink(session), "t", venue, on_step=on_step)
    assert approved and approved[0]["status"] == "approved"
    assert all(abs(c - r["true_compliance"]) < 0.1 for c in seen if c is not None)
