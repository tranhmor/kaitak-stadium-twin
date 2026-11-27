"""Interface contract v0.2 between the testbed, M2, M3, M4 and M5.

All IDs come from m1_venue/out/venue_manifest.json. Times: `t_s` is seconds since the start of the run
(simulated clock), `ts` is the matching ISO 8601 timestamp with offset. Counts are people; density is persons/m².
v0.2 only adds RunControl fields with defaults (testbed, layout, record_trajectory, scale); v0.1 callers are unchanged.
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field

CONTRACT_VERSION = "0.2"
REPORT_INTERVAL_S = 5.0
STALE_AFTER_S = 10.0
FRUIN_F = 2.2          # persons/m², roadmap v7.5 trigger
FORECAST_HORIZON_S = 120.0


class ZoneCount(BaseModel):
    zone_id: str
    count: int = Field(ge=0)


class LineCount(BaseModel):
    """People who crossed a counting line since the previous batch. forward = `from` -> `to` in the manifest."""
    line_id: str
    forward: int = Field(ge=0)
    backward: int = Field(ge=0)


class ReadingBatch(BaseModel):
    run_id: str
    seq: int = Field(ge=0)
    t_s: float = Field(ge=0)
    ts: str
    source: str                      # e.g. "testbed:meso", "testbed:jupedsim"
    sent_wall: Optional[float] = None    # sender's wall clock (epoch seconds), for the latency indicator
    zone_counts: list[ZoneCount]
    line_counts: list[LineCount]


class ZoneState(BaseModel):
    count: float
    density: float
    forecast_density: float
    basis: Literal["measured", "estimated"]
    stale: bool = False
    age_s: float = 0.0


class TwinState(BaseModel):
    run_id: str
    seq: int
    t_s: float
    ts: str
    zones: dict[str, ZoneState]
    kpis: dict[str, float]
    facilities: dict[str, Literal["open", "closed"]]
    gate_arrivals: dict[str, float]      # cumulative people counted into each gate
    flows: dict[str, float]              # line_id -> smoothed net flow, persons/s, positive = from -> to
    displays: dict[str, str]             # display_id -> gate zone currently shown
    redirected: list[str]                # displays showing an approved redirection
    pending_guidance: Optional[str] = None
    compliance: Optional[float] = None   # share of redirected people who followed, estimated from counting lines
    latency_ms: Optional[float] = None   # sender clock to state published


class Assignment(BaseModel):
    zone_id: str
    from_gate: str
    to_gate: str
    people: int


class DisplayMessage(BaseModel):
    display_id: str
    gate_id: str
    gate_ref: str
    text: str
    bearing_deg: float               # direction to walk along the concourse, degrees from east in the local frame


class Guidance(BaseModel):
    id: str
    run_id: str
    version: int
    status: Literal["proposed", "approved", "rejected", "superseded"]   # superseded = expired undecided
    created_t_s: float
    decided_t_s: Optional[float] = None
    decided_by: Optional[str] = None     # "manager", "rule:auto" or "rule:expired"
    trigger_zone: str
    trigger_forecast: float
    reason: str
    assignments: list[Assignment]
    messages: list[DisplayMessage]


class Decision(BaseModel):
    action: Literal["approve", "reject"]
    by: str = "manager"
    drop_zones: list[str] = []           # manager edit: zones removed from the proposal before approval


class FacilityStatus(BaseModel):
    status: Literal["open", "closed"]
    by: str = "manager"


class RunControl(BaseModel):
    """Scenario for one testbed run, sent by the dashboard or the command line."""
    p_follow: float = Field(0.6, ge=0, le=1)       # true compliance in the testbed; the twin is not told
    seed: int = 1
    speed: float = Field(10.0, gt=0, le=200)       # simulated seconds per wall second
    close_gate: Optional[str] = None               # gate zone id closed during the run
    close_at_s: float = 120.0
    approval: Literal["manual", "auto", "none"] = "manual"   # none = no guidance (baseline)
    drop_zones: list[str] = []                     # cameras that stop reporting between drop_from_s and drop_to_s
    drop_from_s: float = 0.0
    drop_to_s: float = 0.0
    launch: bool = True                            # M2 starts the testbed process itself
    label: str = ""
    testbed: Literal["meso", "jupedsim"] = "meso"
    layout: str = "north_end"                      # stage preset: m1_venue/out, or m1_venue/out/presets/<id>
    record_trajectory: bool = False                # jupedsim only
    scale: float = Field(1.0, gt=0, le=1)          # testbed smoke tests only; the twin still assumes a full house, not for evaluation
