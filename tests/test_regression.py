"""The simplified testbed drives the live demo. Its results must not move while the twin is being worked on:
reruns are compared field by field with a frozen copy of the batch results (tests/data/meso_runs_v0.1.csv).

The reference is a copy, not testbed/results/runs.csv itself, because `python -m testbed.experiment` rewrites
that file: a changed testbed followed by a rerun of the experiment would otherwise always pass. Replace the
copy only on purpose, when a change to the demo numbers has been agreed."""
import csv
from pathlib import Path

import pytest

from contracts.venue import Venue
from testbed.experiment import GATE, one

RUNS = Path(__file__).resolve().parent / "data" / "meso_runs_v0.1.csv"
REFERENCE = list(csv.DictReader(open(RUNS)))


@pytest.fixture(scope="module")
def venue():
    return Venue()


def rerun(venue, ref):
    p, approval = float(ref["p_follow"]), ref["approval"]
    return one(venue, ref["label"], int(ref["seed"]), p, approval, close=ref["close_gate"] or None)


def differences(summary, ref):
    cell = lambda v: "" if v is None else str(v)
    return {k: (cell(summary.get(k)), ref[k]) for k in ref if cell(summary.get(k)) != ref[k]}


QUICK = [r for r in REFERENCE if r["seed"] == "1" and r["label"] in ("open-no-guidance", "closed-no-guidance", "closed-guided-p0.50")]


@pytest.mark.parametrize("ref", QUICK, ids=lambda r: f"{r['label']}-s{r['seed']}")
def test_demo_testbed_matches_committed_results(venue, ref):
    assert ref["close_gate"] in ("", GATE)
    assert differences(rerun(venue, ref), ref) == {}


@pytest.mark.slow
@pytest.mark.parametrize("ref", REFERENCE, ids=lambda r: f"{r['label']}-s{r['seed']}")
def test_all_committed_runs_reproduce(venue, ref):
    assert differences(rerun(venue, ref), ref) == {}
