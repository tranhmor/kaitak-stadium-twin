"""M2: data service of the indoor twin (roadmap v7.5 section 4).

FastAPI + MongoDB + WebSocket. Receives reading batches, validates them against the M1 manifest, stores
them, runs M3 and M4 on each batch, publishes the state, and carries approvals back to the venue/testbed.

  docker compose up -d
  .venv/bin/uvicorn m2_service.app:app --port 8010
"""
import asyncio
import json
import os
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pymongo import AsyncMongoClient
from pymongo.errors import DuplicateKeyError

from contracts.schemas import CONTRACT_VERSION, FORECAST_HORIZON_S, FRUIN_F, REPORT_INTERVAL_S, STALE_AFTER_S, Decision, FacilityStatus, ReadingBatch, RunControl
from contracts.venue import M1_OUT, Venue
from m2_service.core import Rejected, TwinSession

ROOT = Path(__file__).resolve().parent.parent
MONGO_URL = os.environ.get("KAITAK_MONGO_URL", "mongodb://127.0.0.1:27027")
DB_NAME = os.environ.get("KAITAK_MONGO_DB", "kaitak_stadium_twin")
API_URL = os.environ.get("KAITAK_API_URL", "http://127.0.0.1:8010")
DIST = ROOT / "m5_dashboard" / "dist"


class Hub:
    def __init__(self):
        self.venue = Venue()
        self.session = None
        self.run = None
        self.proc = None
        self.sockets = set()
        self.latency = []
        self.lock = asyncio.Lock()

    async def publish(self, kind, data):
        msg = json.dumps({"type": kind, "data": data})
        for ws in list(self.sockets):
            try:
                await ws.send_text(msg)
            except Exception:
                self.sockets.discard(ws)


hub = Hub()
db = None


def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds")


def clean(doc):
    if doc:
        doc.pop("_id", None)
    return doc


@asynccontextmanager
async def lifespan(app):
    global db
    client = AsyncMongoClient(MONGO_URL, serverSelectionTimeoutMS=3000)
    db = client[DB_NAME]
    await db.readings.create_index([("run_id", 1), ("seq", 1)], unique=True)
    await db.states.create_index([("run_id", 1), ("seq", 1)], unique=True)
    await db.evaluations.create_index([("run_id", 1), ("seq", 1)])
    await db.guidance.create_index([("run_id", 1), ("version", 1)])
    m = hub.venue.manifest
    await db.venue.replace_one({"_id": "current"}, {"_id": "current", "loaded_at": now(), **m}, upsert=True)
    await db.runs.update_many({"status": "running"}, {"$set": {"status": "interrupted", "ended_at": now()}})
    yield
    if hub.proc and hub.proc.poll() is None:
        hub.proc.terminate()
    await client.close()


app = FastAPI(title="Kai Tak Stadium Twin · M2", version=CONTRACT_VERSION, lifespan=lifespan)


# ---------------------------------------------------------------------------------------- venue (M1)
@app.get("/api/health")
async def health():
    await db.command("ping")
    return {"ok": True, "contract": CONTRACT_VERSION, "manifest": hub.venue.manifest["manifest_version"],
            "manifest_status": hub.venue.manifest["status"], "run": hub.run and hub.run["run_id"], "clients": len(hub.sockets)}


@app.get("/api/venue")
async def venue():
    return {**hub.venue.manifest, "constants": {"fruin_f": FRUIN_F, "report_interval_s": REPORT_INTERVAL_S,
                                                 "stale_after_s": STALE_AFTER_S, "forecast_horizon_s": FORECAST_HORIZON_S}}


# ---------------------------------------------------------------------------------------- runs
async def end_run(status):
    run, hub.run = hub.run, None
    if hub.proc and hub.proc.poll() is None:
        hub.proc.terminate()
    hub.proc = None
    if run and run["status"] == "running":
        run["status"], run["ended_at"] = status, now()
        await db.runs.update_one({"run_id": run["run_id"]}, {"$set": {"status": status, "ended_at": run["ended_at"]}})
        await hub.publish("run", run)


@app.post("/api/runs")
async def start_run(cfg: RunControl):
    if cfg.close_gate and cfg.close_gate not in hub.venue.gates:
        raise HTTPException(422, f"{cfg.close_gate} is not a gate in the manifest")
    async with hub.lock:
        await end_run("stopped")
        run_id = "run-" + datetime.now().strftime("%Y%m%d-%H%M%S")
        hub.session = TwinSession(hub.venue, run_id, cfg.approval)
        hub.latency = []
        hub.run = {"run_id": run_id, "status": "running", "started_at": now(), "ended_at": None, "config": cfg.model_dump(),
                   "manifest_version": hub.venue.manifest["manifest_version"], "manifest_sha": hub.venue.manifest["source"]["source_sha256"][:16],
                   "contract": CONTRACT_VERSION, "result": None}
        await db.runs.insert_one(dict(hub.run))
        if cfg.launch:
            hub.proc = subprocess.Popen([sys.executable, "-m", "testbed.run", "--api", API_URL, "--run-id", run_id,
                                         "--config", cfg.model_dump_json()], cwd=ROOT)
        await hub.publish("run", hub.run)
        return hub.run


@app.post("/api/runs/{run_id}/stop")
async def stop_run(run_id: str):
    async with hub.lock:
        if hub.run and hub.run["run_id"] == run_id:
            await end_run("stopped")
    return clean(await db.runs.find_one({"run_id": run_id}))


@app.get("/api/runs")
async def list_runs(limit: int = 20):
    return [clean(r) async for r in db.runs.find().sort("started_at", -1).limit(limit)]


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    r = clean(await db.runs.find_one({"run_id": run_id}))
    if not r:
        raise HTTPException(404, "unknown run")
    return r


def active(run_id):
    if not hub.run or hub.run["run_id"] != run_id:
        raise HTTPException(409, f"run {run_id} is not the active run")
    return hub.session


# ---------------------------------------------------------------------------------------- readings in, state out
@app.post("/api/readings")
async def readings(batch: ReadingBatch):
    async with hub.lock:
        s = active(batch.run_id)
        received = time.time()
        try:
            state, events = s.ingest(batch)
        except Rejected as e:
            await db.rejects.insert_one({"run_id": batch.run_id, "seq": batch.seq, "received_at": now(), "reason": str(e)})
            raise HTTPException(422, str(e))
        try:
            await db.readings.insert_one({**batch.model_dump(), "received_at": now()})
        except DuplicateKeyError:
            raise HTTPException(409, "batch already stored")
        for g in events:
            await db.guidance.replace_one({"id": g["id"]}, g, upsert=True)
            await hub.publish("guidance", g)
        if batch.sent_wall:
            hub.latency = (hub.latency + [(time.time() - batch.sent_wall) * 1000])[-200:]
            state["latency_ms"] = round(hub.latency[-1], 1)
            state["kpis"]["latency_p95_ms"] = round(float(np.quantile(hub.latency, 0.95)), 1)
        state["kpis"]["processing_ms"] = round((time.time() - received) * 1000, 1)
        await db.states.insert_one(dict(state))
        state.pop("_id", None)
        await hub.publish("state", state)
        return {"state": state, "actuation": s.actuation()}


@app.get("/api/state")
async def latest_state():
    return {"run": hub.run, "state": hub.session.state if hub.session else None,
            "guidance": list(hub.session.guidance.values()) if hub.session else []}


@app.get("/api/runs/{run_id}/series")
async def series(run_id: str):
    """Compact history for charts: one row per batch."""
    rows = []
    async for s in db.states.find({"run_id": run_id}, {"_id": 0, "t_s": 1, "kpis": 1, "compliance": 1}).sort("seq", 1):
        rows.append({"t_s": s["t_s"], "max_density": s["kpis"]["max_density"], "max_forecast_density": s["kpis"]["max_forecast_density"],
                     "exited_share": s["kpis"]["exited_share"], "zones_over_now": s["kpis"]["zones_over_now"], "compliance": s.get("compliance")})
    return rows


# ---------------------------------------------------------------------------------------- guidance (M4) and facilities
@app.get("/api/guidance")
async def guidance(run_id: str):
    return [clean(g) async for g in db.guidance.find({"run_id": run_id}).sort("version", 1)]


@app.post("/api/guidance/{guidance_id}/decision")
async def decide(guidance_id: str, d: Decision):
    async with hub.lock:
        s = hub.session
        if not s or not s.eng.pending or s.eng.pending["id"] != guidance_id:
            raise HTTPException(409, "this proposal is no longer pending")
        g = s.decide(d.action, d.by, d.drop_zones)
        await db.guidance.replace_one({"id": g["id"]}, g, upsert=True)
        await hub.publish("guidance", g)
        return g


@app.put("/api/facilities/{zone_id}")
async def facility(zone_id: str, f: FacilityStatus):
    async with hub.lock:
        if not hub.session:
            raise HTTPException(409, "no active run")
        try:
            hub.session.set_facility(zone_id, f.status)
        except Rejected as e:
            raise HTTPException(422, str(e))
        ev = {"run_id": hub.run["run_id"], "zone_id": zone_id, "status": f.status, "by": f.by, "t_s": hub.session.t, "at": now()}
        await db.facility_events.insert_one(dict(ev))
        await hub.publish("facility", ev)
        return ev


# ---------------------------------------------------------------------------------------- testbed evaluation (ground truth)
@app.post("/api/runs/{run_id}/evaluation")
async def evaluation(run_id: str, record: dict):
    """Ground truth from the testbed. Stored and shown for evaluation only; M3 and M4 never read it."""
    record["run_id"] = run_id
    await db.evaluations.insert_one(dict(record))
    await hub.publish("evaluation", record)
    return {"ok": True}


@app.post("/api/runs/{run_id}/result")
async def result(run_id: str, summary: dict):
    async with hub.lock:
        await db.runs.update_one({"run_id": run_id}, {"$set": {"result": summary}})
        if hub.run and hub.run["run_id"] == run_id:
            hub.run["result"] = summary
            hub.proc = None
            await end_run("completed" if summary.get("completed") else "stopped")
    return {"ok": True}


# ---------------------------------------------------------------------------------------- live channel and static files
@app.websocket("/ws")
async def ws(sock: WebSocket):
    await sock.accept()
    hub.sockets.add(sock)
    try:
        await sock.send_text(json.dumps({"type": "hello", "data": await latest_state()}))
        while True:
            await sock.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.sockets.discard(sock)


app.mount("/m1", StaticFiles(directory=M1_OUT), name="m1")
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
