"""Testbed process for the live demo: `python -m testbed.run --api http://127.0.0.1:8010 --run-id <id> --config '<RunControl json>'`.
M2 starts this when the dashboard asks for a run; it can also be started by hand."""
import argparse

from contracts.schemas import RunControl
from testbed.runner import HttpLink, run_scenario

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8010")
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--config", default="{}")
    a = ap.parse_args()
    s = run_scenario(RunControl.model_validate_json(a.config), HttpLink(a.api, a.run_id), a.run_id, realtime=True)
    print({k: s[k] for k in ("exited", "t90_s", "over_threshold_zone_seconds", "density_mae", "true_compliance", "estimated_compliance")})
