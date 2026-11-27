"""M1 stage presets (m1_venue/config.yaml `stage_presets`): north_end, the .blend layout built into m1_venue/out,
and south_end, mirrored about the centre of the concert floor, in m1_venue/out/presets/south_end.

Run: .venv/bin/python -m pytest -q tests/test_presets.py"""
import json

import numpy as np
import pytest
from shapely import contains_xy
from shapely.geometry import Polygon

from contracts.schemas import RunControl
from contracts.venue import DEFAULT_LAYOUT, Venue, list_presets, preset_dir
from m2_service.core import TwinSession
from testbed.runner import LocalLink, run_scenario

PRESETS = ("north_end", "south_end")


@pytest.fixture(scope="module")
def venues():
    return {p: Venue(preset_dir(p)) for p in PRESETS}


def test_presets_are_built_and_pass_qa():
    assert list_presets()[0] == DEFAULT_LAYOUT and set(PRESETS) <= set(list_presets())
    for p in PRESETS:
        qa = (preset_dir(p) / "qa_report.md").read_text().split("## Zones")[0]
        assert ", 0 failed," in qa and "[FAIL]" not in qa, p


def test_every_preset_has_the_same_ids(venues):
    n, s = venues["north_end"], venues["south_end"]
    assert set(n.zones) == set(s.zones) and set(n.lines) == set(s.lines) and set(n.displays) == set(s.displays)
    assert [(e["from"], e["to"], e["line_id"]) for e in n.edges] == [(e["from"], e["to"], e["line_id"]) for e in s.edges]


def test_stage_metadata(venues):
    for p, v in venues.items():
        st, frame = v.manifest["stage"], v.manifest["frame"]
        assert st["preset_id"] == p and st["busiest_gate"] in v.gates and st["recommended_close_gate"] in v.gates
        assert frame["pitch_centre"] == [189.98, -195.19]
        assert sum(st["gate_load"].values()) == v.manifest["scope"]["capacity"]
    assert venues["north_end"].manifest["stage"]["recommended_close_gate"] == "L2-W-G-D"     # the demo scenario
    assert venues["south_end"].manifest["files"]["mesh"] == "../../venue_lite.glb"        # shared, not copied
    assert not (preset_dir("south_end") / "venue_lite.glb").exists()


def test_spawn_points_lie_in_their_zones(venues):
    for p, v in venues.items():
        spawn = json.load(open(preset_dir(p) / "spawn.json"))["zones"]
        geo = {f["id"]: Polygon([c[:2] for c in f["geometry"]["coordinates"][0]])
               for f in json.load(open(preset_dir(p) / "zones.geojson"))["features"]}
        assert sum(map(len, spawn.values())) == v.manifest["scope"]["capacity"]
        for z, pts in spawn.items():
            assert len(pts) == v.zones[z]["capacity"], (p, z)
            if pts:
                xy = np.array(pts)
                assert contains_xy(geo[z].buffer(0.05), xy[:, 0], xy[:, 1]).all(), (p, z)


def test_south_end_seats_match_the_plan(venues):
    """Execution plan 2.6.1: the mirrored wall closes S12-S15 and leaves 314 of 371 seats in S11."""
    v = venues["south_end"]
    lower = {z: x["capacity"] for z, x in v.zones.items() if x["type"] == "seating"}
    assert sum(lower.values()) == 3874 and lower["L2-W-S11"] == 314
    assert sorted(z for z, x in v.zones.items() if x.get("closed_for_concert")) == [f"L2-W-S{i}" for i in (12, 13, 14, 15)]
    assert sum(x["capacity"] for x in v.zones.values() if x["type"] == "floor") == 6100
    assert v.manifest["scope"]["capacity"] == 9974
    assert v.manifest["stage"]["busiest_gate"] == "L2-W-G-F"                            # the bottleneck moves north


def test_closed_loop_runs_on_south_end(venues):
    v = venues["south_end"]
    cfg = RunControl(launch=False, approval="none", layout="south_end", close_gate=v.manifest["stage"]["recommended_close_gate"])
    r = run_scenario(cfg, LocalLink(TwinSession(v, "t", cfg.approval)), "t", v)
    assert r["completed"] and r["exited"] == r["people"] == 9974
    assert r["density_max_error"] <= 0.5
