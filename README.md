# Parkwise — DFA Smart Parking

A responsive Flask and SQLite academic demonstration of a deterministic finite automaton (DFA) used to validate vehicle registration **formats** and control a small operator-approved parking workflow.

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000>. The SQLite database is created at `data/parking.db` on first run. Set `PARKING_DATABASE` to use a different database file, or `PORT` to change the HTTP port.

## Simplified demonstration language

The application accepts `LL DD L{1,2} DDDD`: two ASCII letters, two digits, one or two letters, and four digits. For example, `TS09AB1234` and `KA01A1234` are accepted. Input is uppercased; spaces, tabs, and hyphens are removed before validation. This is an intentionally simplified pattern, not a complete specification of Indian registration formats.

The transition function has 12 states: `q0` through accepting `q10`, plus the rejecting sink `qDead`. It is total over the symbol classes `LETTER`, `DIGIT`, and `OTHER`, and the same server-side function powers plate checks, the animated trace, the built-in test suite, and the entry gate. No government records are queried: format validity does not establish official registration, ownership, or identity.

## Parking workflow

1. Validate a registration format using the DFA.
2. Have an operator explicitly approve the demo entry.
3. The server assigns the first free numbered space and persists the visit in SQLite.
4. Record a vehicle exit from its active record to release the space.

An active-registration database index prevents duplicate concurrent entries. Occupancy, recent activity, daily counts, and charts are derived from the database.

## Project layout

- `app.py` — DFA, database setup, and Flask JSON endpoints.
- `templates/index.html` — single-page application screens.
- `static/css/app.css` — responsive dashboard UI and themes.
- `static/js/app.js` — navigation, live charts, forms, and DFA visualization.
