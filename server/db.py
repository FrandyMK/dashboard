import os
import sqlite3
from contextlib import contextmanager

from models import Exercise, GymPlan, WorkoutDay

DB_PATH = os.environ.get("DASHBOARD_DB", "dashboard.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS workout_days (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exercises (
    id TEXT NOT NULL,
    day_id TEXT NOT NULL REFERENCES workout_days(id),
    name TEXT NOT NULL,
    weight REAL NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    position INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (day_id, id)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

# (id, name, weight, sets, reps, active) — only used to fill an empty database.
SEED = [
    ("push", "Push day", [
        ("bench", "Bench press", 80, 3, 5, True),
        ("ohp", "Overhead press", 45, 3, 8, True),
        ("incline", "Incline dumbbell press", 26, 3, 10, False),
        ("dips", "Dips", 0, 3, 10, False),
    ]),
    ("pull", "Pull day", [
        ("row", "Barbell row", 70, 3, 8, True),
        ("pullup", "Pull-ups", 0, 3, 8, True),
        ("curl", "Bicep curl", 12, 3, 10, False),
    ]),
    ("legs", "Leg day", [
        ("squat", "Squat", 100, 3, 5, True),
        ("rdl", "Romanian deadlift", 80, 3, 8, False),
    ]),
]


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # rows behave like dicts: row["name"]
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with connect() as conn:
        conn.executescript(SCHEMA)
        count = conn.execute("SELECT COUNT(*) FROM workout_days").fetchone()[0]
        if count == 0:
            seed(conn)


def seed(conn):
    for day_pos, (day_id, day_name, exercises) in enumerate(SEED):
        conn.execute(
            "INSERT INTO workout_days (id, name, position) VALUES (?, ?, ?)",
            (day_id, day_name, day_pos),
        )
        for ex_pos, (ex_id, name, weight, sets, reps, active) in enumerate(exercises):
            conn.execute(
                """INSERT INTO exercises
                   (id, day_id, name, weight, sets, reps, position, active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (ex_id, day_id, name, weight, sets, reps, ex_pos, int(active)),
            )
    conn.execute("INSERT INTO settings (key, value) VALUES ('next_day_index', '0')")


def load_plan(conn) -> GymPlan:
    days = conn.execute(
        "SELECT id, name FROM workout_days ORDER BY position"
    ).fetchall()
    exercises = conn.execute(
        "SELECT id, day_id, name, weight, sets, reps, active "
        "FROM exercises ORDER BY position"
    ).fetchall()
    setting = conn.execute(
        "SELECT value FROM settings WHERE key = 'next_day_index'"
    ).fetchone()

    return GymPlan(
        next_day_index=int(setting["value"]) if setting else 0,
        days=[
            WorkoutDay(
                id=d["id"],
                name=d["name"],
                exercises=[
                    Exercise(
                        id=e["id"],
                        name=e["name"],
                        weight=e["weight"],
                        sets=e["sets"],
                        reps=e["reps"],
                        active=bool(e["active"]),
                    )
                    for e in exercises
                    if e["day_id"] == d["id"]
                ],
            )
            for d in days
        ],
    )
