"""Single reader for testbed/jps_params.yaml, shared by the JuPedSim testbed and the verification suite.

Importing this module does not import jupedsim, so it works in the Python 3.10 environment too."""
from pathlib import Path

import yaml

PARAMS_FILE = Path(__file__).with_name("jps_params.yaml")


def load_params(path=PARAMS_FILE):
    return yaml.safe_load(open(path))


def model_kwargs(params=None):
    """Keyword arguments for jupedsim.CollisionFreeSpeedModel(**model_kwargs())."""
    return dict((params or load_params())["model_params"])


def gate_clear_width(params=None, override=None):
    """Calibrated clear width of a gate opening. Rigs that calibrate it pass `override`."""
    w = override if override is not None else (params or load_params())["gate_clear_width_m"]
    if w is None:
        raise ValueError("gate_clear_width_m is not calibrated yet (execution plan 2.3.2); pass an explicit width")
    return float(w)
