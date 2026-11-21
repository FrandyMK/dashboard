import os
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi.middleware.cors import CORSMiddleware
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    FastAPI,
    HTTPException,
    Path as PathParam,
    Query,
    Request,
)
from pathlib import Path
from fastapi.staticfiles import StaticFiles

from db import (
    add_bill,
    add_day,
    add_exercise,
    complete_workout,
    connect,
    delete_day,
    delete_exercise,
    find_user,
    init_db,
    load_month,
    load_plan,
    mark_paid,
    mark_unpaid,
    reorder_days,
    rename_day,
    reorder_exercises,
    update_bill,
    update_exercise,
)
from models import (
    PERIOD_PATTERN,
    BillUpdate,
    CompletedWorkout,
    DayOrder,
    DayUpdate,
    ExerciseOrder,
    ExerciseUpdate,
    FinanceMonth,
    GymPlan,
    NewBill,
    NewDay,
    NewExercise,
    User,
)
from recap import write_recap


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


# --- Who is asking ---
# tailscale serve adds this header to every request, from the Tailscale login
# of the device that sent it. This is the only place that knows identity comes
# from Tailscale; swapping in real logins later means changing just this.
def current_user(request: Request) -> User:
    login = request.headers.get("Tailscale-User-Login") or os.environ.get("DASHBOARD_DEV_USER")
    if not login:
        raise HTTPException(status_code=401, detail="Not signed in")
    with connect() as conn:
        user = find_user(conn, login)
    if user is None:
        raise HTTPException(status_code=401, detail="Unknown user")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def finance_user(user: CurrentUser) -> User:
    if not user.can_finance:
        raise HTTPException(status_code=403, detail="No access to finance")
    return user


@app.get("/me")
def get_me(user: CurrentUser) -> User:
    return user


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/gym/plan")
def get_gym_plan(user: CurrentUser) -> GymPlan:
    with connect() as conn:
        return load_plan(conn, user.id)


@app.post("/gym/days")
def post_day(user: CurrentUser, new: NewDay) -> GymPlan:
    with connect() as conn:
        name = new.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name can't be empty")
        add_day(conn, user.id, name)
        return load_plan(conn, user.id)


@app.put("/gym/days/order")
def put_day_order(user: CurrentUser, order: DayOrder) -> GymPlan:
    with connect() as conn:
        if not reorder_days(conn, user.id, order.day_ids):
            raise HTTPException(
                status_code=400, detail="Order must list every day exactly once"
            )
        return load_plan(conn, user.id)


@app.patch("/gym/days/{day_id}")
def patch_day(user: CurrentUser, day_id: str, update: DayUpdate) -> GymPlan:
    with connect() as conn:
        name = update.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name can't be empty")
        if not rename_day(conn, user.id, day_id, name):
            raise HTTPException(status_code=404, detail="Day not found")
        return load_plan(conn, user.id)


@app.delete("/gym/days/{day_id}")
def remove_day(user: CurrentUser, day_id: str) -> GymPlan:
    with connect() as conn:
        problem = delete_day(conn, user.id, day_id)
        if problem == "not found":
            raise HTTPException(status_code=404, detail="Day not found")
        if problem == "last day":
            raise HTTPException(status_code=400, detail="Can't delete the last day")
        return load_plan(conn, user.id)


@app.patch("/gym/days/{day_id}/exercises/{exercise_id}")
def patch_exercise(
    user: CurrentUser, day_id: str, exercise_id: str, update: ExerciseUpdate
) -> GymPlan:
    with connect() as conn:
        changes = update.model_dump(exclude_none=True)
        if "name" in changes:
            changes["name"] = changes["name"].strip()
            if not changes["name"]:
                raise HTTPException(status_code=422, detail="Name can't be empty")
        if not update_exercise(conn, user.id, day_id, exercise_id, changes):
            raise HTTPException(status_code=404, detail="Exercise not found")
        return load_plan(conn, user.id)


@app.delete("/gym/days/{day_id}/exercises/{exercise_id}")
def remove_exercise(user: CurrentUser, day_id: str, exercise_id: str) -> GymPlan:
    with connect() as conn:
        if not delete_exercise(conn, user.id, day_id, exercise_id):
            raise HTTPException(status_code=404, detail="Exercise not found")
        return load_plan(conn, user.id)


@app.post("/gym/days/{day_id}/exercises")
def post_exercise(user: CurrentUser, day_id: str, new: NewExercise) -> GymPlan:
    with connect() as conn:
        if not add_exercise(conn, user.id, day_id, new.name):
            raise HTTPException(status_code=404, detail="Day not found")
        return load_plan(conn, user.id)


@app.put("/gym/days/{day_id}/order")
def put_order(user: CurrentUser, day_id: str, order: ExerciseOrder) -> GymPlan:
    with connect() as conn:
        if not reorder_exercises(conn, user.id, day_id, order.exercise_ids):
            raise HTTPException(
                status_code=400,
                detail="Order must list every exercise of this day exactly once",
            )
        return load_plan(conn, user.id)


@app.post("/gym/complete")
def post_complete(
    user: CurrentUser,
    background_tasks: BackgroundTasks,
    completed: CompletedWorkout | None = None,
) -> GymPlan:
    with connect() as conn:
        day_id = completed.day_id if completed else None
        workout_id = complete_workout(conn, user.id, day_id)
        if workout_id is None:
            raise HTTPException(status_code=404, detail="Day not found")
        plan = load_plan(conn, user.id)
    # Runs after the response has been sent, and after the log above is
    # committed, so the slow local model never makes "Complete workout" wait.
    # The recap shows up on the dashboard's next refresh.
    background_tasks.add_task(write_recap, workout_id)
    return plan


# --- Finance ---
# Every finance response is the month the client is looking at,
# so mutations take that month as ?period=2026-11.
PeriodInPath = Annotated[str, PathParam(pattern=PERIOD_PATTERN)]
PeriodInQuery = Annotated[str, Query(pattern=PERIOD_PATTERN)]

# Every route on this router checks finance access first.
finance = APIRouter(prefix="/finance", dependencies=[Depends(finance_user)])


@finance.get("/months/{period}")
def get_finance_month(period: PeriodInPath) -> FinanceMonth:
    with connect() as conn:
        return load_month(conn, period)


@finance.post("/bills")
def post_bill(new: NewBill, period: PeriodInQuery) -> FinanceMonth:
    with connect() as conn:
        # A bill starts in the month it was added from: adding one while
        # looking at December schedules it from December on.
        add_bill(conn, new.name, new.amount_cents, new.due_day, period)
        return load_month(conn, period)


@finance.patch("/bills/{bill_id}")
def patch_bill(bill_id: str, update: BillUpdate, period: PeriodInQuery) -> FinanceMonth:
    with connect() as conn:
        changes = update.model_dump(exclude_none=True)
        if not update_bill(conn, bill_id, changes):
            raise HTTPException(status_code=404, detail="Bill not found")
        return load_month(conn, period)


@finance.put("/months/{period}/payments/{bill_id}")
def put_payment(period: PeriodInPath, bill_id: str) -> FinanceMonth:
    with connect() as conn:
        if not mark_paid(conn, bill_id, period):
            raise HTTPException(status_code=404, detail="Bill not found")
        return load_month(conn, period)


@finance.delete("/months/{period}/payments/{bill_id}")
def delete_payment(period: PeriodInPath, bill_id: str) -> FinanceMonth:
    with connect() as conn:
        if not mark_unpaid(conn, bill_id, period):
            raise HTTPException(status_code=404, detail="Bill not found")
        return load_month(conn, period)


app.include_router(finance)


# Serve the built frontend, if present (it is inside Docker, not in local dev).
# Must come last: API routes above take priority over this catch-all.
class FrontendFiles(StaticFiles):
    # Vite puts a hash of each file's contents in its name under assets/, so a
    # new build means new names: those files can be cached forever. Everything
    # else (index.html above all) must be checked with the server on every
    # visit, or the phone keeps showing an old version.
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/", FrontendFiles(directory=STATIC_DIR, html=True), name="frontend")
