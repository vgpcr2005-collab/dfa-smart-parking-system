"""Flask application for a DFA-driven smart parking demonstration."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request


BASE_DIR = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("PARKING_DATABASE", BASE_DIR / "data" / "parking.db"))
SLOT_COUNT = 24
ALPHABET = ("LETTER", "DIGIT", "OTHER")
ACCEPTING_STATE = "q10"
DEAD_STATE = "qDead"

# Each state defines a transition for every symbol class in the alphabet.
TRANSITIONS: dict[str, dict[str, str]] = {
    "q0": {"LETTER": "q1", "DIGIT": DEAD_STATE, "OTHER": DEAD_STATE},
    "q1": {"LETTER": "q2", "DIGIT": DEAD_STATE, "OTHER": DEAD_STATE},
    "q2": {"LETTER": DEAD_STATE, "DIGIT": "q3", "OTHER": DEAD_STATE},
    "q3": {"LETTER": DEAD_STATE, "DIGIT": "q4", "OTHER": DEAD_STATE},
    "q4": {"LETTER": "q5", "DIGIT": DEAD_STATE, "OTHER": DEAD_STATE},
    "q5": {"LETTER": "q6", "DIGIT": "q7", "OTHER": DEAD_STATE},
    "q6": {"LETTER": DEAD_STATE, "DIGIT": "q7", "OTHER": DEAD_STATE},
    "q7": {"LETTER": DEAD_STATE, "DIGIT": "q8", "OTHER": DEAD_STATE},
    "q8": {"LETTER": DEAD_STATE, "DIGIT": "q9", "OTHER": DEAD_STATE},
    "q9": {"LETTER": DEAD_STATE, "DIGIT": "q10", "OTHER": DEAD_STATE},
    ACCEPTING_STATE: {"LETTER": DEAD_STATE, "DIGIT": DEAD_STATE, "OTHER": DEAD_STATE},
    DEAD_STATE: {"LETTER": DEAD_STATE, "DIGIT": DEAD_STATE, "OTHER": DEAD_STATE},
}

TEST_CASES = (
    {"plate": "TS09AB1234", "expected": True, "note": "Two region letters, two digits, two series letters, four digits."},
    {"plate": "KA01A1234", "expected": True, "note": "The series may contain one letter."},
    {"plate": "TS9AB123", "expected": False, "note": "The district needs two digits and the suffix needs four."},
    {"plate": "1234TSAB09", "expected": False, "note": "The registration must begin with two letters."},
    {"plate": "TS09ABC1234", "expected": False, "note": "The series may contain no more than two letters."},
    {"plate": "TS09AB12345", "expected": False, "note": "The registration must end with exactly four digits."},
    {"plate": "TS09A1234", "expected": True, "note": "A one-letter series is valid."},
    {"plate": "TS09AB12X4", "expected": False, "note": "A letter is not allowed in the four-digit suffix."},
)


def get_connection() -> sqlite3.Connection:
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS slots (
                id INTEGER PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                current_entry_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plate TEXT NOT NULL,
                slot_id INTEGER NOT NULL REFERENCES slots(id),
                entered_at TEXT NOT NULL,
                exited_at TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_entry_per_plate
                ON entries(plate) WHERE exited_at IS NULL;
            CREATE INDEX IF NOT EXISTS entries_by_time ON entries(entered_at);
            """
        )
        existing = connection.execute("SELECT COUNT(*) FROM slots").fetchone()[0]
        if existing == 0:
            connection.executemany(
                "INSERT INTO slots(code) VALUES (?)",
                [(f"A-{number:02d}",) for number in range(1, SLOT_COUNT + 1)],
            )


def symbol_class(character: str) -> str:
    if character.isascii() and character.isalpha():
        return "LETTER"
    if character.isascii() and character.isdigit():
        return "DIGIT"
    return "OTHER"


def normalize_plate(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return "".join(character for character in value.upper() if character not in " -\t\r\n")


def run_dfa(value: Any) -> dict[str, Any]:
    original = value if isinstance(value, str) else ""
    plate = normalize_plate(original)
    state = "q0"
    steps: list[dict[str, Any]] = []
    failure: dict[str, Any] | None = None

    for index, character in enumerate(plate):
        previous_state = state
        input_class = symbol_class(character)
        state = TRANSITIONS[state][input_class]
        steps.append(
            {
                "position": index + 1,
                "character": character,
                "symbol_class": input_class,
                "from_state": previous_state,
                "to_state": state,
            }
        )
        if state == DEAD_STATE and failure is None:
            failure = {
                "position": index + 1,
                "character": character,
                "reason": (
                    f"Character '{character}' at position {index + 1} does not match "
                    "the expected pattern at this point."
                ),
            }

    valid = state == ACCEPTING_STATE
    if not valid and failure is None:
        if not plate:
            reason = "Enter a vehicle number to begin validation."
            position = 1
        elif state == "q5":
            reason = "The series letter must be followed by exactly four digits."
            position = len(plate) + 1
        elif state == "q6":
            reason = "The two-letter series must be followed by exactly four digits."
            position = len(plate) + 1
        elif state == "q10":
            reason = "The registration has extra characters after its four-digit suffix."
            position = len(plate)
        else:
            expected = {
                "q0": "two letters for the region",
                "q1": "a second region letter",
                "q2": "two district digits",
                "q3": "a second district digit",
                "q4": "at least one series letter",
                "q7": "three more suffix digits",
                "q8": "two more suffix digits",
                "q9": "one more suffix digit",
            }.get(state, "the next character")
            reason = f"The registration ended early; expected {expected}."
            position = len(plate) + 1
        failure = {"position": position, "character": "", "reason": reason}

    return {
        "plate": plate,
        "valid": valid,
        "final_state": state,
        "steps": steps,
        "failure": failure,
        "pattern": "LL DD L{1,2} DDDD",
        "example": "TS09AB1234",
    }


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def get_dashboard_data() -> dict[str, Any]:
    today_date = datetime.now().astimezone().date()
    today = today_date.isoformat()
    with get_connection() as connection:
        total = connection.execute("SELECT COUNT(*) FROM slots").fetchone()[0]
        occupied = connection.execute(
            "SELECT COUNT(*) FROM slots WHERE current_entry_id IS NOT NULL"
        ).fetchone()[0]
        today_entries = connection.execute(
            "SELECT COUNT(*) FROM entries WHERE substr(entered_at, 1, 10) = ?",
            (today,),
        ).fetchone()[0]
        active = connection.execute(
            """
            SELECT e.id, e.plate, e.entered_at, s.code AS slot
            FROM entries e JOIN slots s ON e.slot_id = s.id
            WHERE e.exited_at IS NULL ORDER BY e.entered_at DESC
            """
        ).fetchall()
        recent = connection.execute(
            """
            SELECT e.id, e.plate, e.entered_at, e.exited_at, s.code AS slot
            FROM entries e JOIN slots s ON e.slot_id = s.id
            ORDER BY e.id DESC LIMIT 8
            """
        ).fetchall()
        slots = connection.execute(
            """
            SELECT s.code, e.plate, e.entered_at
            FROM slots s LEFT JOIN entries e ON e.id = s.current_entry_id
            ORDER BY s.id
            """
        ).fetchall()
        hourly_rows = connection.execute(
            """
            SELECT CAST(substr(entered_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS count
            FROM entries WHERE substr(entered_at, 1, 10) = ?
            GROUP BY hour ORDER BY hour
            """,
            (today,),
        ).fetchall()
        first_day = (today_date - timedelta(days=6)).isoformat()
        daily_rows = connection.execute(
            """
            SELECT substr(entered_at, 1, 10) AS day, COUNT(*) AS count
            FROM entries WHERE substr(entered_at, 1, 10) >= ?
            GROUP BY day ORDER BY day
            """,
            (first_day,),
        ).fetchall()

    hours = {row["hour"]: row["count"] for row in hourly_rows}
    days = {row["day"]: row["count"] for row in daily_rows}
    return {
        "stats": {
            "total_slots": total,
            "available_slots": total - occupied,
            "occupied_slots": occupied,
            "active_vehicles": len(active),
            "entries_today": today_entries,
            "occupancy_percent": round(occupied / total * 100) if total else 0,
            "is_full": total > 0 and occupied == total,
        },
        "active_vehicles": [row_to_dict(row) for row in active],
        "recent_activity": [row_to_dict(row) for row in recent],
        "slots": [row_to_dict(row) for row in slots],
        "hourly": [{"hour": hour, "count": hours.get(hour, 0)} for hour in range(24)],
        "daily": [
            {
                "day": (today_date - timedelta(days=offset)).isoformat(),
                "count": days.get(
                    (today_date - timedelta(days=offset)).isoformat(), 0
                ),
            }
            for offset in range(6, -1, -1)
        ],
    }


app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
initialize_database()


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/dashboard")
def dashboard():
    return jsonify(get_dashboard_data())


@app.post("/api/validate")
def validate():
    payload = request.get_json(silent=True) or {}
    return jsonify(run_dfa(payload.get("plate", "")))


@app.post("/api/entries")
def create_entry():
    payload = request.get_json(silent=True) or {}
    result = run_dfa(payload.get("plate", ""))
    if not result["valid"]:
        return jsonify({"error": "Invalid registration format.", "validation": result}), 422
    if payload.get("operator_approved") is not True:
        return jsonify({"error": "Operator approval is required before entry."}), 400

    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            duplicate = connection.execute(
                "SELECT id FROM entries WHERE plate = ? AND exited_at IS NULL",
                (result["plate"],),
            ).fetchone()
            if duplicate:
                return jsonify({"error": f"{result['plate']} already has an active parking entry."}), 409
            slot = connection.execute(
                "SELECT id, code FROM slots WHERE current_entry_id IS NULL ORDER BY id LIMIT 1"
            ).fetchone()
            if slot is None:
                return jsonify({"error": "The parking lot is full. No entry was created."}), 409
            entered_at = datetime.now().astimezone().isoformat(timespec="seconds")
            cursor = connection.execute(
                "INSERT INTO entries(plate, slot_id, entered_at) VALUES (?, ?, ?)",
                (result["plate"], slot["id"], entered_at),
            )
            entry_id = cursor.lastrowid
            connection.execute(
                "UPDATE slots SET current_entry_id = ? WHERE id = ?",
                (entry_id, slot["id"]),
            )
    except sqlite3.IntegrityError:
        return jsonify({"error": "This vehicle already has an active parking entry."}), 409

    return jsonify(
        {
            "message": "Entry approved and parking slot assigned.",
            "entry": {
                "id": entry_id,
                "plate": result["plate"],
                "slot": slot["code"],
                "entered_at": entered_at,
            },
        }
    ), 201


@app.post("/api/exits")
def exit_vehicle():
    payload = request.get_json(silent=True) or {}
    plate = normalize_plate(payload.get("plate", ""))
    if not plate:
        return jsonify({"error": "Enter a registration number to find the active vehicle."}), 400

    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        entry = connection.execute(
            """
            SELECT e.id, e.plate, e.entered_at, s.id AS slot_id, s.code AS slot
            FROM entries e JOIN slots s ON e.slot_id = s.id
            WHERE e.plate = ? AND e.exited_at IS NULL
            """,
            (plate,),
        ).fetchone()
        if entry is None:
            return jsonify({"error": f"No active parking record found for {plate}."}), 404
        exited_at = datetime.now().astimezone().isoformat(timespec="seconds")
        connection.execute("UPDATE entries SET exited_at = ? WHERE id = ?", (exited_at, entry["id"]))
        connection.execute("UPDATE slots SET current_entry_id = NULL WHERE id = ?", (entry["slot_id"],))

    return jsonify(
        {
            "message": "Vehicle exit recorded and parking slot released.",
            "entry": {
                "id": entry["id"],
                "plate": entry["plate"],
                "slot": entry["slot"],
                "entered_at": entry["entered_at"],
                "exited_at": exited_at,
            },
        }
    )


@app.get("/api/test-cases")
def test_cases():
    cases = []
    for case in TEST_CASES:
        result = run_dfa(case["plate"])
        cases.append(
            {
                **case,
                "valid": result["valid"],
                "passed": result["valid"] == case["expected"],
            }
        )
    return jsonify({"cases": cases, "all_passed": all(case["passed"] for case in cases)})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)
