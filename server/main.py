from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException

from db import (
    add_exercise,
    complete_workout,
    connect,
    init_db,
    load_plan,
    reorder_exercises,
    update_exercise,
)
from models import ExerciseOrder, ExerciseUpdate, GymPlan, NewExercise


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
