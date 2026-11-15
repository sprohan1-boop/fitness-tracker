from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TargetsUpdate(BaseModel):
    calories: int | None = Field(default=None, gt=0)
    protein_g: float | None = Field(default=None, gt=0)
    carbohydrates_g: float | None = Field(default=None, gt=0)
    fat_g: float | None = Field(default=None, gt=0)
    fiber_g: float | None = Field(default=None, gt=0)
    workouts_per_week: int | None = Field(default=None, gt=0)


class TargetsRead(TargetsUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: int = 1


class FoodBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    brand: str | None = Field(default=None, max_length=120)
    preparation: Literal["raw", "cooked", "packaged", "unspecified"]
    calories_per_100g: float = Field(ge=0)
    protein_g_per_100g: float = Field(ge=0)
    carbohydrates_g_per_100g: float = Field(ge=0)
    fat_g_per_100g: float = Field(ge=0)
    fiber_g_per_100g: float = Field(ge=0)
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Food name cannot be blank.")
        return value


class FoodCreate(FoodBase):
    pass


class FoodRead(FoodBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source: str
    is_verified: bool


class MealCreate(BaseModel):
    food_id: int = Field(gt=0)
    date: date
    meal_type: Literal["breakfast", "lunch", "dinner", "snack"]
    portion_g: float = Field(gt=0, le=10000)


class MealRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    food_id: int
    food_name: str
    preparation: str
    date: date
    meal_type: str
    portion_g: float
    calories: float
    protein_g: float
    carbohydrates_g: float
    fat_g: float
    fiber_g: float


class WorkoutSetCreate(BaseModel):
    exercise_name: str = Field(min_length=1, max_length=120)
    set_number: int = Field(ge=1, le=100)
    reps: int = Field(ge=1, le=1000)
    weight_kg: float = Field(ge=0, le=10000)

    @field_validator("exercise_name")
    @classmethod
    def exercise_name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Exercise name cannot be blank.")
        return value


class WorkoutCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    date: date
    notes: str | None = None
    sets: list[WorkoutSetCreate] = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def workout_name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Workout name cannot be blank.")
        return value


class WorkoutSetRead(WorkoutSetCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


class WorkoutRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    date: date
    notes: str | None
    sets: list[WorkoutSetRead]
