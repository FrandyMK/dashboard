from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import connect, init_db, load_plan
from models import GymPlan


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()  # runs once when the server starts
    yield


app = FastAPI(title="Dashboard API", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/gym/plan")
def get_gym_plan() -> GymPlan:
    with connect() as conn:
        return load_plan(conn)
