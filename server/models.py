from pydantic import BaseModel, ConfigDict, Field
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


class ExerciseUpdate(CamelModel):
    # Every field is optional: send only what you're changing.
    name: str | None = Field(default=None, min_length=1)
    weight: float | None = Field(default=None, ge=0)
    sets: int | None = Field(default=None, ge=1)
    reps: int | None = Field(default=None, ge=1)
    active: bool | None = None


class NewExercise(CamelModel):
    name: str = Field(min_length=1)


class ExerciseOrder(CamelModel):
    exercise_ids: list[str]
