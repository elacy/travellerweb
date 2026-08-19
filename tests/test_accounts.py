"""Account-based persistence endpoints.

The Postgres-backed db_* functions in app/main.py are monkeypatched here so
the API layer is tested without a real database.
"""

import sys
from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

import main as app_main  # noqa: E402

AUTH_HEADERS = {
    "X-Authentik-Uid": "user-42",
    "X-Authentik-Username": "alice",
    "X-Authentik-Name": "Alice Example",
    "X-Authentik-Email": "alice@example.com",
}


@pytest.fixture
def client():
    return TestClient(app_main.app)


# --- /api/me ----------------------------------------------------------------


def test_me_anonymous_401(client):
    r = client.get("/api/me")
    assert r.status_code == 401
    assert r.json() == {"detail": "not authenticated"}


def test_me_authenticated_200(client):
    r = client.get("/api/me", headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == {
        "uid": "user-42",
        "username": "alice",
        "name": "Alice Example",
        "email": "alice@example.com",
    }


def test_me_headers_case_insensitive(client):
    r = client.get(
        "/api/me",
        headers={
            "x-authentik-uid": "user-42",
            "x-authentik-username": "alice",
            "x-authentik-name": "Alice Example",
            "x-authentik-email": "alice@example.com",
        },
    )
    assert r.status_code == 200
    assert r.json()["uid"] == "user-42"
    assert r.json()["username"] == "alice"
    assert r.json()["name"] == "Alice Example"
    assert r.json()["email"] == "alice@example.com"


def test_me_empty_uid_is_anonymous(client):
    r = client.get("/api/me", headers={"X-Authentik-Uid": "  "})
    assert r.status_code == 401


# --- /api/games -------------------------------------------------------------


def test_games_anonymous_401(client):
    assert client.get("/api/games").status_code == 401
    assert client.put("/api/games", json={}).status_code == 401
    assert client.delete("/api/games/foo").status_code == 401


def test_games_get_empty_map(client, monkeypatch):
    monkeypatch.setattr(app_main, "db_get_games", lambda uid: {})
    r = client.get("/api/games", headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == {}


def test_games_put_then_get_roundtrips_exact_map(client, monkeypatch):
    store = {}

    def fake_get(uid):
        return store.get(uid, {})

    def fake_put(uid, data_map):
        store[uid] = data_map

    monkeypatch.setattr(app_main, "db_get_games", fake_get)
    monkeypatch.setattr(app_main, "db_put_games", fake_put)

    games = {
        "Pirates of Drinax": {
            "fleet": {
                "name": "Vhurg",
                "ships": [
                    {
                        "name": "Far Trader A2",
                        "cargo": 65,
                        "monthly_maint": 4353.5,
                        "berths": [{"type": "low", "number": 8}, {"type": "standard", "number": 10}],
                        "accepts_passengers": False,
                        "notes": None,
                    }
                ],
            },
            "start": {"sector": "Trojan Reach", "hex": "2221"},
            "capital": 15800985,
            "enabled": True,
            "tags": ["campaign", "poct", "nested:list"],
            "meta": {"nested": {"deep": [1, 2, {"three": 3.0}], "flag": False, "nothing": None}},
        },
        "A Light in the Dark": {"notes": "tbd", "enabled": False},
    }
    r = client.put("/api/games", json=games, headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r = client.get("/api/games", headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == games


def test_games_delete_removes_key(client, monkeypatch):
    store = {}

    def fake_get(uid):
        return store.get(uid, {})

    def fake_put(uid, data_map):
        store[uid] = data_map

    def fake_delete(uid, name):
        store.get(uid, {}).pop(name, None)

    monkeypatch.setattr(app_main, "db_get_games", fake_get)
    monkeypatch.setattr(app_main, "db_put_games", fake_put)
    monkeypatch.setattr(app_main, "db_delete_game", fake_delete)

    r = client.put(
        "/api/games", json={"alpha": {"v": 1}, "beta": {"v": 2}}, headers=AUTH_HEADERS
    )
    assert r.status_code == 200

    r = client.delete("/api/games/alpha", headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r = client.get("/api/games", headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == {"beta": {"v": 2}}


def test_games_delete_url_decodes_name(client, monkeypatch):
    store = {}

    def fake_get(uid):
        return store.get(uid, {})

    def fake_put(uid, data_map):
        store[uid] = data_map

    def fake_delete(uid, name):
        store.get(uid, {}).pop(name, None)

    monkeypatch.setattr(app_main, "db_get_games", fake_get)
    monkeypatch.setattr(app_main, "db_put_games", fake_put)
    monkeypatch.setattr(app_main, "db_delete_game", fake_delete)

    client.put("/api/games", json={"my game": {"v": 1}}, headers=AUTH_HEADERS)
    r = client.delete("/api/games/" + quote("my game"), headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r = client.get("/api/games", headers=AUTH_HEADERS)
    assert r.json() == {}


def test_games_db_unavailable_503(client, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("db unreachable")

    monkeypatch.setattr(app_main, "db_get_games", boom)
    monkeypatch.setattr(app_main, "db_put_games", boom)
    monkeypatch.setattr(app_main, "db_delete_game", boom)

    r = client.get("/api/games", headers=AUTH_HEADERS)
    assert r.status_code == 503
    r = client.put("/api/games", json={"a": 1}, headers=AUTH_HEADERS)
    assert r.status_code == 503
    r = client.delete("/api/games/foo", headers=AUTH_HEADERS)
    assert r.status_code == 503
