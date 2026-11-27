"""M2 stage-preset endpoints: /api/layouts, /api/venue?layout= and runs started on a preset.
Needs the local MongoDB (docker compose up -d) and is skipped without it. It uses its own database, which it drops,
and never starts the testbed (launch=False)."""
import os

import pymongo
import pytest

URL = os.environ.get("KAITAK_MONGO_URL", "mongodb://127.0.0.1:27027")
TEST_DB = "kaitak_twin_test_api"
try:
    pymongo.MongoClient(URL, serverSelectionTimeoutMS=500).admin.command("ping")
except Exception:
    pytest.skip("MongoDB is not running", allow_module_level=True)
os.environ["KAITAK_MONGO_DB"] = TEST_DB          # read by m2_service.app at import

from fastapi.testclient import TestClient  # noqa: E402

from m2_service.app import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c
    pymongo.MongoClient(URL).drop_database(TEST_DB)


def test_layouts_list_the_built_presets(client):
    r = client.get("/api/layouts").json()
    assert [x["preset_id"] for x in r][0] == "north_end" and "south_end" in [x["preset_id"] for x in r]
    south = next(x for x in r if x["preset_id"] == "south_end")
    assert (south["mode"], south["status"], south["capacity"], south["recommended_close_gate"]) == ("mirror", "hypothetical", 9974, "L2-W-G-E")
    assert south["closed_seating"] == [f"L2-W-S{i}" for i in (12, 13, 14, 15)]


def test_venue_by_layout(client):
    v = client.get("/api/venue", params={"layout": "south_end"}).json()
    assert v["layout"] == "south_end" and v["asset_base"] == "/m1/presets/south_end" and v["stage"]["mode"] == "mirror"
    assert client.get(f"{v['asset_base']}/{v['files']['zones']}").status_code == 200        # served by the /m1 mount
    assert client.get("/m1/presets/south_end/../../venue_lite.glb").status_code == 200       # shared mesh, as the dashboard asks for it
    assert client.get("/api/venue", params={"layout": "nowhere"}).status_code == 404


def test_run_on_a_preset_sets_the_live_venue(client):
    assert client.post("/api/runs", json={"layout": "nowhere", "launch": False}).status_code == 422
    assert client.post("/api/runs", json={"layout": "south_end", "close_gate": "L2-W-G-X", "launch": False}).status_code == 422
    run = client.post("/api/runs", json={"layout": "south_end", "approval": "none", "launch": False}).json()
    try:
        assert run["layout"] == "south_end" and run["config"]["layout"] == "south_end"
        assert client.get("/api/venue").json()["layout"] == "south_end"                       # default = the live preset
        assert client.get("/api/health").json()["layout"] == "south_end"
        assert [x["preset_id"] for x in client.get("/api/layouts").json() if x["current"]] == ["south_end"]
    finally:
        client.post(f"/api/runs/{run['run_id']}/stop")
