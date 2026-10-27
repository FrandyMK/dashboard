from contextlib import asynccontextmanager
from typing import Annotated

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException, Path as PathParam, Query
from pathlib import Path
from fastapi.staticfiles import StaticFiles

from db import (
    add_bill,
    add_exercise,
    complete_workout,
    connect,
    delete_exercise,
    init_db,
    load_month,
    load_plan,
    mark_paid,
    mark_unpaid,
    reorder_exercises,
    update_exercise,
)
from models import (
    PERIOD_PATTERN,
    ExerciseOrder,
    ExerciseUpdate,
    FinanceMonth,
    GymPlan,
    NewBill,
    NewExercise,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Dashboard API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",  # Tauri during development
        "tauri://localhost",      # Tauri as a built app
        "http://tauri.localhost",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/gym/plan")
def get_gym_plan() -> GymPlan:
    with connect() as conn:
        return load_plan(conn)


@app.patch("/gym/days/{day_id}/exercises/{exercise_id}")
def patch_exercise(day_id: str, exercise_id: str, update: ExerciseUpdate) -> GymPlan:
    with connect() as conn:
        changes = update.model_dump(exclude_none=True)
        if not update_exercise(conn, day_id, exercise_id, changes):
            raise HTTPException(status_code=404, detail="Exercise not found")
        return load_plan(conn)


@app.delete("/gym/days/{day_id}/exercises/{exercise_id}")
def remove_exercise(day_id: str, exercise_id: str) -> GymPlan:
    with connect() as conn:
        if not delete_exercise(conn, day_id, exercise_id):
            raise HTTPException(status_code=404, detail="Exercise not found")
        return load_plan(conn)


@app.post("/gym/days/{day_id}/exercises")
def post_exercise(day_id: str, new: NewExercise) -> GymPlan:
    with connect() as conn:
        if not add_exercise(conn, day_id, new.name):
            raise HTTPException(status_code=404, detail="Day not found")
        return load_plan(conn)


@app.put("/gym/days/{day_id}/order")
def put_order(day_id: str, order: ExerciseOrder) -> GymPlan:
    with connect() as conn:
        if not reorder_exercises(conn, day_id, order.exercise_ids):
            raise HTTPException(
                status_code=400,
                detail="Order must list every exercise of this day exactly once",
            )
        return load_plan(conn)


@app.post("/gym/complete")
def post_complete() -> GymPlan:
    with connect() as conn:
        complete_workout(conn)
        return load_plan(conn)


# --- Finance ---
# Every finance response is the month the client is looking at,
# so mutations take that month as ?period=2026-11.
PeriodInPath = Annotated[str, PathParam(pattern=PERIOD_PATTERN)]
PeriodInQuery = Annotated[str, Query(pattern=PERIOD_PATTERN)]


@app.get("/finance/months/{period}")
def get_finance_month(period: PeriodInPath) -> FinanceMonth:
    with connect() as conn:
        return load_month(conn, period)


@app.post("/finance/bills")
def post_bill(new: NewBill, period: PeriodInQuery) -> FinanceMonth:
    with connect() as conn:
        add_bill(conn, new.name, new.amount_cents, new.due_day)
        return load_month(conn, period)


@app.put("/finance/months/{period}/payments/{bill_id}")
def put_payment(period: PeriodInPath, bill_id: str) -> FinanceMonth:
    with connect() as conn:
        if not mark_paid(conn, bill_id, period):
            raise HTTPException(status_code=404, detail="Bill not found")
        return load_month(conn, period)


@app.delete("/finance/months/{period}/payments/{bill_id}")
def delete_payment(period: PeriodInPath, bill_id: str) -> FinanceMonth:
    with connect() as conn:
        if not mark_unpaid(conn, bill_id, period):
            raise HTTPException(status_code=404, detail="Bill not found")
        return load_month(conn, period)


# Serve the built frontend, if present (it is inside Docker, not in local dev).
# Must come last: API routes above take priority over this catch-all.
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
