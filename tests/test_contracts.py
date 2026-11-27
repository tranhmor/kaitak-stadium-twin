"""Contract v0.2 additions: new RunControl fields default to the v0.1 behaviour; presets resolve to M1 folders."""
import pytest

from contracts.schemas import CONTRACT_VERSION, RunControl
from contracts.venue import DEFAULT_LAYOUT, M1_OUT, Venue, list_presets, preset_dir
from testbed.jps_config import gate_clear_width, load_params, model_kwargs


def test_run_control_defaults():
    cfg = RunControl()
    assert CONTRACT_VERSION == "0.2"
    assert (cfg.testbed, cfg.layout, cfg.record_trajectory, cfg.scale) == ("meso", "north_end", False, 1.0)
    with pytest.raises(ValueError):
        RunControl(scale=0)
    with pytest.raises(ValueError):
        RunControl(testbed="vadere")


def test_presets():
    assert preset_dir() == M1_OUT == preset_dir(DEFAULT_LAYOUT)
    assert preset_dir("south_end") == M1_OUT / "presets" / "south_end"
    assert list_presets()[0] == DEFAULT_LAYOUT
    assert Venue(preset_dir()).out_dir == M1_OUT


def test_jps_params():
    p = load_params()
    assert p["v_free_mps"] == 1.34 and p["row_speed_mps"] == 0.6
    assert set(model_kwargs(p)) == {"strength_neighbor_repulsion", "range_neighbor_repulsion",
                                    "strength_geometry_repulsion", "range_geometry_repulsion"}
    assert gate_clear_width(p, override=4.2) == 4.2
    if p["gate_clear_width_m"] is None:
        with pytest.raises(ValueError):
            gate_clear_width(p)


def test_jps_params_are_library_defaults():
    jps = pytest.importorskip("jupedsim")
    p = load_params()
    assert jps.__version__ == p["jupedsim_version"]
    default = jps.CollisionFreeSpeedModel()
    assert all(getattr(default, k) == v for k, v in model_kwargs(p).items())
    agent = jps.CollisionFreeSpeedModelAgentParameters()
    assert (agent.time_gap, agent.radius) == (p["time_gap_s"], p["radius_m"])
