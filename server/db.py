import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4

from models import (
    Bill,
    Exercise,
    FinanceMonth,
    GymPlan,
    MonthBill,
    Payment,
    Recap,
    User,
    WorkoutDay,
)

DB_PATH = os.environ.get("DASHBOARD_DB", "dashboard.db")

# The person who already had the dashboard before it had users.
OWNER_ID = "owner"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tailscale_login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    can_finance INTEGER NOT NULL DEFAULT 0,
    next_day_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workout_days (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
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
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (day_id, id)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    due_day INTEGER NOT NULL,
    position INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    start_period TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
    bill_id TEXT NOT NULL REFERENCES bills(id),
    period TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    paid_at TEXT NOT NULL,
    PRIMARY KEY (bill_id, period)
);
CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    day_id TEXT NOT NULL,
    day_name TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    recap TEXT
);
CREATE TABLE IF NOT EXISTS workout_exercises (
    workout_id INTEGER NOT NULL REFERENCES workouts(id),
    exercise_id TEXT NOT NULL,
    exercise_name TEXT NOT NULL,
    position INTEGER NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    weight REAL NOT NULL,
    note TEXT NOT NULL,
    PRIMARY KEY (workout_id, exercise_id)
);
CREATE INDEX IF NOT EXISTS workout_exercises_by_exercise
    ON workout_exercises (exercise_id);
"""

# The starter days for everyone. The exercises (id, name, weight, sets, reps,
# active) are only added for the owner of a brand-new database.
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
        migrate(conn)
        if not day_ids(conn, OWNER_ID):
            seed_plan(conn, OWNER_ID, with_exercises=True)


def migrate(conn):
    # Databases created before a column existed don't get it from SCHEMA,
    # because CREATE TABLE IF NOT EXISTS skips existing tables.
    ensure_owner(conn)

    # Everything that existed before users belongs to the owner.
    for table in ("workout_days", "workouts"):
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if "user_id" not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
            conn.execute(f"UPDATE {table} SET user_id = ?", (OWNER_ID,))

    columns = {row["name"] for row in conn.execute("PRAGMA table_info(exercises)")}
    if "note" not in columns:
        conn.execute("ALTER TABLE exercises ADD COLUMN note TEXT NOT NULL DEFAULT ''")

    # The LLM-written recap of a logged workout. NULL until it's written,
    # and stays NULL if the model was unavailable.
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(workouts)")}
    if "recap" not in columns:
        conn.execute("ALTER TABLE workouts ADD COLUMN recap TEXT")

    # The first month a bill exists in, so earlier months don't list it as unpaid.
    # Existing bills start in the first month they were paid, or else this month.
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(bills)")}
    if "start_period" not in columns:
        conn.execute("ALTER TABLE bills ADD COLUMN start_period TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """UPDATE bills SET start_period = COALESCE(
                   (SELECT MIN(period) FROM payments WHERE bill_id = bills.id), ?)""",
            (datetime.now(timezone.utc).strftime("%Y-%m"),),
        )


def ensure_owner(conn):
    # Runs on every startup. The first time, it creates the owner and takes over
    # next_day_index from settings; after that it only refreshes the name and
    # login from the environment, so a wrong login is fixed by editing .env and
    # restarting.
    login = os.environ.get("DASHBOARD_OWNER_LOGIN") or "owner@localhost"
    name = os.environ.get("DASHBOARD_OWNER_NAME") or "Owner"
    row = conn.execute(
        "SELECT value FROM settings WHERE key = 'next_day_index'"
    ).fetchone()
    conn.execute(
        """INSERT INTO users (id, name, tailscale_login, can_finance, next_day_index)
           VALUES (?, ?, ?, 1, ?)
           ON CONFLICT (id) DO UPDATE SET
               name = excluded.name, tailscale_login = excluded.tailscale_login""",
        (OWNER_ID, name, login, int(row["value"]) if row else 0),
    )


def find_user(conn, login: str) -> User | None:
    row = conn.execute(
        "SELECT id, name, can_finance FROM users WHERE tailscale_login = ?", (login,)
    ).fetchone()
    if row is None:
        return None
    return User(id=row["id"], name=row["name"], can_finance=bool(row["can_finance"]))


def seed_plan(conn, user_id: str, with_exercises: bool = False) -> None:
    # A starter plan for someone with no days yet: the SEED days, empty, so a
    # new person fills them with their own exercises (added ones start at 0 kg).
    # with_exercises also adds the example exercises; only used for the owner
    # of a brand-new database, so a fresh install has something to show.
    # Fresh random ids, not the readable ones in SEED: workout_days.id is unique
    # across all users, and the workout log looks exercises up by id, so ids
    # must never be shared.
    for day_pos, (_, day_name, exercises) in enumerate(SEED):
        day_id = uuid4().hex
        conn.execute(
            "INSERT INTO workout_days (id, user_id, name, position) VALUES (?, ?, ?, ?)",
            (day_id, user_id, day_name, day_pos),
        )
        if not with_exercises:
            continue
        for ex_pos, (_, name, weight, sets, reps, active) in enumerate(exercises):
            conn.execute(
                """INSERT INTO exercises
                   (id, day_id, name, weight, sets, reps, position, active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (uuid4().hex, day_id, name, weight, sets, reps, ex_pos, int(active)),
            )
    set_next_index(conn, user_id, 0)


# --- Gym: every function only sees the days of the given user. ---
# Exercises have no user_id of their own: they belong to whoever owns their day,
# so checking the day is enough.


def day_ids(conn, user_id: str) -> list[str]:
    return [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM workout_days WHERE user_id = ? ORDER BY position",
            (user_id,),
        )
    ]


def owns_day(conn, user_id: str, day_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM workout_days WHERE id = ? AND user_id = ?", (day_id, user_id)
    ).fetchone()
    return row is not None


def get_next_index(conn, user_id: str) -> int:
    row = conn.execute(
        "SELECT next_day_index FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return row["next_day_index"] if row else 0


def set_next_index(conn, user_id: str, index: int) -> None:
    conn.execute("UPDATE users SET next_day_index = ? WHERE id = ?", (index, user_id))


def load_plan(conn, user_id: str) -> GymPlan:
    days = conn.execute(
        "SELECT id, name FROM workout_days WHERE user_id = ? ORDER BY position",
        (user_id,),
    ).fetchall()
    exercises = conn.execute(
        """SELECT e.id, e.day_id, e.name, e.weight, e.sets, e.reps, e.active, e.note
           FROM exercises e JOIN workout_days d ON d.id = e.day_id
           WHERE d.user_id = ?
           ORDER BY e.position""",
        (user_id,),
    ).fetchall()

    # Clamped so a stale index can never point past the last day.
    next_day_index = get_next_index(conn, user_id)
    return GymPlan(
        next_day_index=next_day_index % len(days) if days else 0,
        last_recap=load_last_recap(conn, user_id),
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
                        note=e["note"],
                    )
                    for e in exercises
                    if e["day_id"] == d["id"]
                ],
            )
            for d in days
        ],
    )


EDITABLE_COLUMNS = {"name", "weight", "sets", "reps", "active", "note"}


def update_exercise(
    conn, user_id: str, day_id: str, exercise_id: str, changes: dict
) -> bool:
    if not owns_day(conn, user_id, day_id):
        return False

    fields = {k: v for k, v in changes.items() if k in EDITABLE_COLUMNS}
    if "active" in fields:
        fields["active"] = int(fields["active"])

    if not fields:
        row = conn.execute(
            "SELECT 1 FROM exercises WHERE day_id = ? AND id = ?",
            (day_id, exercise_id),
        ).fetchone()
        return row is not None

    assignments = ", ".join(f"{column} = ?" for column in fields)
    cursor = conn.execute(
        f"UPDATE exercises SET {assignments} WHERE day_id = ? AND id = ?",
        (*fields.values(), day_id, exercise_id),
    )
    return cursor.rowcount == 1


def add_exercise(conn, user_id: str, day_id: str, name: str) -> bool:
    if not owns_day(conn, user_id, day_id):
        return False

    next_position = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM exercises WHERE day_id = ?",
        (day_id,),
    ).fetchone()[0]
    conn.execute(
        """INSERT INTO exercises
           (id, day_id, name, weight, sets, reps, position, active)
           VALUES (?, ?, ?, 0, 3, 8, ?, 0)""",
        (uuid4().hex, day_id, name, next_position),
    )
    return True


def delete_exercise(conn, user_id: str, day_id: str, exercise_id: str) -> bool:
    if not owns_day(conn, user_id, day_id):
        return False
    cursor = conn.execute(
        "DELETE FROM exercises WHERE day_id = ? AND id = ?",
        (day_id, exercise_id),
    )
    return cursor.rowcount == 1


def reorder_exercises(conn, user_id: str, day_id: str, exercise_ids: list[str]) -> bool:
    if not owns_day(conn, user_id, day_id):
        return False
    existing = {
        row["id"]
        for row in conn.execute(
            "SELECT id FROM exercises WHERE day_id = ?", (day_id,)
        )
    }
    # The new order must contain every exercise of the day exactly once.
    if len(exercise_ids) != len(existing) or set(exercise_ids) != existing:
        return False

    for position, exercise_id in enumerate(exercise_ids):
        conn.execute(
            "UPDATE exercises SET position = ? WHERE day_id = ? AND id = ?",
            (position, day_id, exercise_id),
        )
    return True


def add_day(conn, user_id: str, name: str) -> None:
    # A new day goes at the end of this user's rotation, with an empty pool.
    next_position = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM workout_days WHERE user_id = ?",
        (user_id,),
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO workout_days (id, user_id, name, position) VALUES (?, ?, ?, ?)",
        (uuid4().hex, user_id, name, next_position),
    )


def rename_day(conn, user_id: str, day_id: str, name: str) -> bool:
    # The user_id in WHERE is the ownership check: another person's day changes nothing.
    cursor = conn.execute(
        "UPDATE workout_days SET name = ? WHERE id = ? AND user_id = ?",
        (name, day_id, user_id),
    )
    return cursor.rowcount == 1


def delete_day(conn, user_id: str, day_id: str) -> str | None:
    # Returns None on success, or why it couldn't be deleted.
    days = day_ids(conn, user_id)
    if day_id not in days:
        return "not found"
    if len(days) == 1:
        return "last day"

    current = get_next_index(conn, user_id) % len(days)
    deleted = days.index(day_id)
    # next_day_index is a position, so removing a day before the current one
    # shifts the current day down by one. If the current day itself is
    # deleted, the day after it slides into its place.
    if deleted < current:
        current -= 1
    current %= len(days) - 1

    # The workout log keeps its own copies of names, so history survives.
    conn.execute("DELETE FROM exercises WHERE day_id = ?", (day_id,))
    conn.execute("DELETE FROM workout_days WHERE id = ?", (day_id,))
    set_next_index(conn, user_id, current)
    return None


def reorder_days(conn, user_id: str, new_order: list[str]) -> bool:
    days = day_ids(conn, user_id)
    # The new order must contain every one of this user's days exactly once.
    if len(new_order) != len(days) or set(new_order) != set(days):
        return False

    # next_day_index is a position, so remember which day it points to
    # and look that day up again in the new order.
    next_day = days[get_next_index(conn, user_id) % len(days)]

    for position, day_id in enumerate(new_order):
        conn.execute(
            "UPDATE workout_days SET position = ? WHERE id = ?", (position, day_id)
        )
    set_next_index(conn, user_id, new_order.index(next_day))
    return True


def log_workout(conn, day_id: str) -> int:
    # A snapshot of what was done today. Later changes to the plan
    # (weights, names, deleting an exercise) never rewrite these rows.
    # The user and the day's name are copied from the day itself.
    cursor = conn.execute(
        """INSERT INTO workouts (user_id, day_id, day_name, completed_at)
           SELECT user_id, id, name, ? FROM workout_days WHERE id = ?""",
        (datetime.now(timezone.utc).isoformat(timespec="seconds"), day_id),
    )
    conn.execute(
        """INSERT INTO workout_exercises
           (workout_id, exercise_id, exercise_name, position, sets, reps, weight, note)
           SELECT ?, id, name, position, sets, reps, weight, note
           FROM exercises
           WHERE day_id = ? AND active = 1""",
        (cursor.lastrowid, day_id),
    )
    return cursor.lastrowid


def complete_workout(conn, user_id: str, day_id: str | None = None) -> int | None:
    # Logs the given day (or, without one, the next day in the rotation)
    # and makes the day after it the next one. Returns the new log's id, or
    # None if the day doesn't exist or belongs to someone else.
    days = day_ids(conn, user_id)
    if not days:
        return None

    if day_id is None:
        current = get_next_index(conn, user_id) % len(days)
    elif day_id in days:
        current = days.index(day_id)
    else:
        return None

    workout_id = log_workout(conn, days[current])
    set_next_index(conn, user_id, (current + 1) % len(days))
    return workout_id


# --- Workout recap ---
# The numbers are worked out here, in code. The LLM (recap.py) only turns
# these facts into a sentence or two, because small models get arithmetic wrong.

# How many earlier sessions of an exercise to compare with.
HISTORY_LENGTH = 4


def kg(weight: float) -> str:
    # 82.5 -> "82.5 kg", 80.0 -> "80 kg"
    return f"{weight:g} kg"


def progress_facts(conn, workout_id: int) -> tuple[str, list[str]] | None:
    # The day's name, and one plain-English fact per exercise in this log
    # comparing it with that person's earlier logs of the same exercise.
    # None if the log doesn't exist.
    workout = conn.execute(
        "SELECT user_id, day_name FROM workouts WHERE id = ?", (workout_id,)
    ).fetchone()
    if workout is None:
        return None

    exercises = conn.execute(
        """SELECT exercise_id, exercise_name, sets, reps, weight, note
           FROM workout_exercises WHERE workout_id = ? ORDER BY position""",
        (workout_id,),
    ).fetchall()

    facts = []
    for ex in exercises:
        # Earlier logs of this exercise by the same person, newest first.
        # Ids only go up, so a smaller id is an earlier log. Filtering on
        # user_id keeps one person's history out of another's recap.
        history = conn.execute(
            """SELECT we.sets, we.reps, we.weight
               FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
               WHERE we.exercise_id = ? AND w.user_id = ? AND w.id < ?
               ORDER BY w.id DESC LIMIT ?""",
            (ex["exercise_id"], workout["user_id"], workout_id, HISTORY_LENGTH),
        ).fetchall()

        name = ex["exercise_name"]
        now = f"{ex['sets']} x {ex['reps']} at {kg(ex['weight'])}"
        if not history:
            fact = f"{name}: {now}, first time logged."
        else:
            last = history[0]
            change = ex["weight"] - last["weight"]
            if change > 0:
                fact = f"{name}: {now}, up {kg(change)} from last time."
            elif change < 0:
                fact = f"{name}: {now}, down {kg(-change)} from last time."
            else:
                # How many sessions in a row, today included, used this weight.
                same = 1
                for earlier in history:
                    if earlier["weight"] != ex["weight"]:
                        break
                    same += 1
                # With only HISTORY_LENGTH earlier logs looked at, a full run
                # could be longer than we can see.
                at_least = "at least " if same > HISTORY_LENGTH else ""
                fact = f"{name}: {now}, same weight for {at_least}{same} sessions in a row."
            if (ex["sets"], ex["reps"]) != (last["sets"], last["reps"]):
                fact += f" Last time was {last['sets']} x {last['reps']}."
        if ex["note"]:
            fact += f' Note: "{ex["note"]}"'
        facts.append(fact)

    return workout["day_name"], facts


def save_recap(conn, workout_id: int, text: str) -> None:
    conn.execute("UPDATE workouts SET recap = ? WHERE id = ?", (text, workout_id))


def load_last_recap(conn, user_id: str) -> Recap | None:
    # The newest of this person's logs that has a recap.
    row = conn.execute(
        """SELECT day_name, completed_at, recap FROM workouts
           WHERE user_id = ? AND recap IS NOT NULL
           ORDER BY id DESC LIMIT 1""",
        (user_id,),
    ).fetchone()
    if row is None:
        return None
    return Recap(day_name=row["day_name"], completed_at=row["completed_at"], text=row["recap"])


# --- Finance ---


def load_month(conn, period: str) -> FinanceMonth:
    rows = conn.execute(
        """SELECT b.id, b.name, b.amount_cents, b.due_day, b.active,
                  p.amount_cents AS paid_cents, p.paid_at
           FROM bills b
           LEFT JOIN payments p ON p.bill_id = b.id AND p.period = ?
           WHERE (b.active = 1 AND b.start_period <= ?) OR p.bill_id IS NOT NULL
           ORDER BY p.bill_id IS NOT NULL, p.paid_at, b.due_day, b.position""",
        (period, period),
    ).fetchall()
    inactive = conn.execute(
        """SELECT id, name, amount_cents, due_day FROM bills
           WHERE active = 0
           ORDER BY name COLLATE NOCASE"""
    ).fetchall()

    return FinanceMonth(
        period=period,
        bills=[
            MonthBill(
                id=r["id"],
                name=r["name"],
                amount_cents=r["amount_cents"],
                due_day=r["due_day"],
                active=bool(r["active"]),
                payment=(
                    Payment(amount_cents=r["paid_cents"], paid_at=r["paid_at"])
                    if r["paid_at"] is not None
                    else None
                ),
            )
            for r in rows
        ],
        inactive=[
            Bill(
                id=r["id"],
                name=r["name"],
                amount_cents=r["amount_cents"],
                due_day=r["due_day"],
            )
            for r in inactive
        ],
    )


def add_bill(conn, name: str, amount_cents: int, due_day: int, start_period: str) -> None:
    next_position = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM bills"
    ).fetchone()[0]
    conn.execute(
        """INSERT INTO bills (id, name, amount_cents, due_day, position, active, start_period)
           VALUES (?, ?, ?, ?, ?, 1, ?)""",
        (uuid4().hex, name, amount_cents, due_day, next_position, start_period),
    )


def mark_paid(conn, bill_id: str, period: str) -> bool:
    bill = conn.execute(
        "SELECT amount_cents FROM bills WHERE id = ?", (bill_id,)
    ).fetchone()
    if bill is None:
        return False

    # Already paid? Then keep the existing payment as it is.
    conn.execute(
        """INSERT INTO payments (bill_id, period, amount_cents, paid_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (bill_id, period) DO NOTHING""",
        (
            bill_id,
            period,
            bill["amount_cents"],
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
        ),
    )
    return True


def mark_unpaid(conn, bill_id: str, period: str) -> bool:
    bill = conn.execute("SELECT 1 FROM bills WHERE id = ?", (bill_id,)).fetchone()
    if bill is None:
        return False

    # Deleting a payment that doesn't exist is fine: it's already unpaid.
    conn.execute(
        "DELETE FROM payments WHERE bill_id = ? AND period = ?",
        (bill_id, period),
    )
    return True


BILL_EDITABLE_COLUMNS = {"name", "amount_cents", "due_day", "active"}


def update_bill(conn, bill_id: str, changes: dict) -> bool:
    fields = {k: v for k, v in changes.items() if k in BILL_EDITABLE_COLUMNS}
    if "active" in fields:
        fields["active"] = int(fields["active"])

    if not fields:
        row = conn.execute("SELECT 1 FROM bills WHERE id = ?", (bill_id,)).fetchone()
        return row is not None

    assignments = ", ".join(f"{column} = ?" for column in fields)
    cursor = conn.execute(
        f"UPDATE bills SET {assignments} WHERE id = ?",
        (*fields.values(), bill_id),
    )
    return cursor.rowcount == 1
