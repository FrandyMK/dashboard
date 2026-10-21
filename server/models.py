from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    # Python uses next_day_index, TypeScript uses nextDayIndex.
    # This converts automatically, so each side keeps its own convention.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Exercise(CamelModel):
    id: str
    name: str
    weight: float
    sets: int
    reps: int
    active: bool


class WorkoutDay(CamelModel):
    id: str
    name: str
    exercises: list[Exercise]


class GymPlan(CamelModel):
    days: list[WorkoutDay]
    next_day_index: int
