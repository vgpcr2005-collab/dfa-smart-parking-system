from __future__ import annotations

import pytest

import app as parking


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(parking, "DATABASE", tmp_path / "parking-test.db")
    parking.initialize_database()
    parking.app.config.update(TESTING=True)
    with parking.app.test_client() as test_client:
        yield test_client


def test_dfa_is_complete_and_recognizes_simplified_pattern():
    assert all(set(row) == set(parking.ALPHABET) for row in parking.TRANSITIONS.values())
    assert all(
        target in parking.TRANSITIONS
        for row in parking.TRANSITIONS.values()
        for target in row.values()
    )
    assert parking.run_dfa("TS09AB1234")["valid"] is True
    assert parking.run_dfa("KA01A1234")["valid"] is True
    assert parking.run_dfa(" ts-09 ab 1234 ")["plate"] == "TS09AB1234"
    assert parking.run_dfa("TS9AB123")["valid"] is False
    assert parking.run_dfa("1234TSAB09")["valid"] is False
    assert parking.run_dfa("TS09ABC1234")["valid"] is False
    assert parking.run_dfa("TS09A12345")["valid"] is False
    assert parking.run_dfa("TS09A12X4")["failure"]["position"] == 8


def test_validation_and_test_suite_endpoints_use_real_dfa(client):
    response = client.post("/api/validate", json={"plate": "TS09AB1234"})
    assert response.status_code == 200
    assert response.json["valid"] is True
    assert response.json["final_state"] == "q10"
    assert len(response.json["steps"]) == 10

    invalid = client.post("/api/validate", json={"plate": "TS09AB12X4"})
    assert invalid.json["valid"] is False
    assert invalid.json["failure"]["position"] == 9
    suite = client.get("/api/test-cases")
    assert suite.status_code == 200
    assert suite.json["all_passed"] is True


def test_entry_requires_valid_format_and_operator_approval(client):
    denied = client.post("/api/entries", json={"plate": "TS09AB1234"})
    assert denied.status_code == 400
    assert "approval" in denied.json["error"].lower()

    invalid = client.post(
        "/api/entries",
        json={"plate": "TS9AB123", "operator_approved": True},
    )
    assert invalid.status_code == 422
    assert invalid.json["validation"]["valid"] is False
    assert client.get("/api/dashboard").json["stats"]["occupied_slots"] == 0


def test_entry_exit_duplicate_prevention_and_live_dashboard(client):
    created = client.post(
        "/api/entries",
        json={"plate": "ts-09 ab 1234", "operator_approved": True},
    )
    assert created.status_code == 201
    assert created.json["entry"]["plate"] == "TS09AB1234"
    assert created.json["entry"]["slot"] == "A-01"

    duplicate = client.post(
        "/api/entries",
        json={"plate": "TS09AB1234", "operator_approved": True},
    )
    assert duplicate.status_code == 409

    occupied = client.get("/api/dashboard").json
    assert occupied["stats"]["occupied_slots"] == 1
    assert occupied["stats"]["available_slots"] == 23
    assert occupied["stats"]["active_vehicles"] == 1
    assert len(occupied["daily"]) == 7
    assert occupied["slots"][0]["plate"] == "TS09AB1234"

    departed = client.post("/api/exits", json={"plate": "ts-09 ab 1234"})
    assert departed.status_code == 200
    assert departed.json["entry"]["slot"] == "A-01"
    assert departed.json["entry"]["exited_at"]

    released = client.get("/api/dashboard").json
    assert released["stats"]["occupied_slots"] == 0
    assert released["stats"]["available_slots"] == 24
    assert released["stats"]["active_vehicles"] == 0
    assert released["slots"][0]["plate"] is None


def test_full_lot_refuses_entry_and_reports_full_status(client):
    for district in range(24):
        response = client.post(
            "/api/entries",
            json={
                "plate": f"TS{district:02d}A1234",
                "operator_approved": True,
            },
        )
        assert response.status_code == 201

    full = client.get("/api/dashboard").json
    assert full["stats"]["is_full"] is True
    assert full["stats"]["available_slots"] == 0
    assert full["stats"]["occupancy_percent"] == 100

    refused = client.post(
        "/api/entries",
        json={"plate": "KA01A1234", "operator_approved": True},
    )
    assert refused.status_code == 409
    assert "full" in refused.json["error"].lower()
