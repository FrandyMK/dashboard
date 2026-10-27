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


# A month written as "2026-11". Used to validate the period in URLs.
PERIOD_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


class Payment(CamelModel):
    amount_cents: int
    paid_at: str


class MonthBill(CamelModel):
    # A bill as seen in one particular month: the bill itself,
    # plus that month's payment if there is one.
    id: str
    name: str
    amount_cents: int
    due_day: int
    active: bool
    payment: Payment | None


class FinanceMonth(CamelModel):
    period: str
    bills: list[MonthBill]


class NewBill(CamelModel):
    name: str = Field(min_length=1)
    amount_cents: int = Field(ge=0)
    due_day: int = Field(ge=1, le=31)
