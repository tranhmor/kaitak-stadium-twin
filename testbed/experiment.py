"""Batch experiment for the roadmap v7.5 success criteria (section 6), in-process (no database needed).

  .venv/bin/python -m testbed.experiment            # full sweep -> testbed/results/
  .venv/bin/python -m testbed.experiment --quick    # one seed

Scenarios: gate D closes 120 s into egress. Arms: no guidance, and guidance with batch approval at
compliance p = 0.2 ... 0.8. Paired by seed (same crowd, same pre-movement times, same sensor noise)."""
import argparse
import csv
import json
from pathlib import Path

import numpy as np

from contracts.schemas import RunControl
from contracts.venue import Venue
from m2_service.core import TwinSession
from testbed.runner import LocalLink, run_scenario

OUT = Path(__file__).parent / "results"
GATE = "L2-W-G-D"
P_VALUES = (0.2, 0.35, 0.5, 0.65, 0.8)


def one(venue, label, seed, p, approval, close=GATE):
    cfg = RunControl(p_follow=p, seed=seed, close_gate=close, approval=approval, label=label, launch=False)
    rid = f"exp-{label}-s{seed}"
    return run_scenario(cfg, LocalLink(TwinSession(venue, rid, approval)), rid, venue)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    seeds = (1,) if ap.parse_args().quick else (1, 2, 3, 4, 5)
    venue, rows = Venue(), []
    for seed in seeds:
        rows.append(one(venue, "open-no-guidance", seed, 0.0, "none", close=None))
        rows.append(one(venue, "closed-no-guidance", seed, 0.0, "none"))
        for p in P_VALUES:
            rows.append(one(venue, f"closed-guided-p{p:.2f}", seed, p, "auto"))
        print(f"seed {seed} done")
    OUT.mkdir(exist_ok=True)
    keys = ["label", "seed", "p_follow", "approval", "close_gate", "people", "exited", "t50_s", "t90_s", "t100_s", "over_threshold_zone_seconds",
            "peak_density", "peak_zone", "density_mae", "density_p95_error", "density_max_error", "blind_zone_mae", "blind_zone_max_error",
            "forecast_mae", "forecast_p95_error", "forecast_hits", "forecast_misses", "forecast_false_alarms", "guided", "followed",
            "true_compliance", "estimated_compliance"]
    with open(OUT / "runs.csv", "w", newline="") as f:
        w = csv.DictWriter(f, keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    labels = list(dict.fromkeys(r["label"] for r in rows))
    table = {}
    for lab in labels:
        rs = [r for r in rows if r["label"] == lab]
        m = lambda k: float(np.mean([r[k] for r in rs if r[k] is not None])) if any(r[k] is not None for r in rs) else None
        table[lab] = {k: m(k) for k in ("t90_s", "t100_s", "over_threshold_zone_seconds", "peak_density", "density_mae", "density_max_error",
                                        "blind_zone_mae", "blind_zone_max_error", "forecast_mae", "true_compliance", "estimated_compliance")}
        table[lab]["runs"] = len(rs)
    base = table["closed-no-guidance"]
    wins = {}
    for p in P_VALUES:                                   # criterion (c): guidance beats no guidance in every seed
        lab = f"closed-guided-p{p:.2f}"
        pairs = [(g, b) for g in rows if g["label"] == lab for b in rows if b["label"] == "closed-no-guidance" and b["seed"] == g["seed"]]
        wins[p] = all(g["t90_s"] < b["t90_s"] and g["over_threshold_zone_seconds"] < b["over_threshold_zone_seconds"] for g, b in pairs)
    summary = {"seeds": list(seeds), "scenario": f"{GATE} closed at 120 s", "by_arm": table,
               "criterion_a_density_error_max": max(r["density_max_error"] for r in rows),
               "criterion_b_guided_better_every_seed": wins,
               "criterion_c_lowest_effective_p": min((p for p, ok in wins.items() if ok), default=None)}
    json.dump(summary, open(OUT / "summary.json", "w"), indent=1)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 3, figsize=(15, 4.2))
    xs = list(P_VALUES)
    for a, key, title in ((ax[0], "t90_s", "T90: time for 90% to exit (s)"), (ax[1], "over_threshold_zone_seconds", "Zone-seconds above 2.2 persons/m²")):
        ys = [[r[key] for r in rows if r["label"] == f"closed-guided-p{p:.2f}"] for p in xs]
        a.plot(xs, [np.mean(y) for y in ys], "o-", c="#1f77b4", label="Gate D closed, guided")
        a.fill_between(xs, [min(y) for y in ys], [max(y) for y in ys], color="#1f77b4", alpha=0.15)
        a.axhline(base[key], c="#d62728", ls="--", label="Gate D closed, no guidance")
        a.axhline(table["open-no-guidance"][key], c="#888", ls=":", label="All gates open, no guidance")
        a.set_xlabel("Compliance p")
        a.set_title(title)
        a.legend(fontsize=8)
    ax[2].plot(xs, xs, c="#888", ls=":")
    ax[2].plot(xs, [table[f"closed-guided-p{p:.2f}"]["estimated_compliance"] for p in xs], "o-", c="#2ca02c")
    ax[2].set_xlabel("True compliance in the testbed")
    ax[2].set_title("Compliance estimated by the twin from counting lines")
    fig.savefig(OUT / "summary.png", dpi=120, bbox_inches="tight")
    print(json.dumps(summary, indent=1))
