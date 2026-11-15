from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class NutritionTargets(Base):
    __tablename__ = "nutrition_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    calories: Mapped[int | None] = mapped_column(Integer, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbohydrates_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    workouts_per_week: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Food(Base):
    __tablename__ = "foods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    brand: Mapped[str | None] = mapped_column(String(120), nullable=True)
    preparation: Mapped[str] = mapped_column(String(16), default="unspecified")
    calories_per_100g: Mapped[float] = mapped_column(Float)
    protein_g_per_100g: Mapped[float] = mapped_column(Float)
    carbohydrates_g_per_100g: Mapped[float] = mapped_column(Float)
    fat_g_per_100g: Mapped[float] = mapped_column(Float)
    fiber_g_per_100g: Mapped[float] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(24), default="user-entered")
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    meal_logs: Mapped[list["MealLog"]] = relationship(back_populates="food")


class MealLog(Base):
    __tablename__ = "meal_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    food_id: Mapped[int] = mapped_column(ForeignKey("foods.id", ondelete="RESTRICT"), index=True)
    food_name: Mapped[str] = mapped_column(String(120))
    preparation: Mapped[str] = mapped_column(String(16))
    date: Mapped[date] = mapped_column(Date, index=True)
    meal_type: Mapped[str] = mapped_column(String(16))
    portion_g: Mapped[float] = mapped_column(Float)
    calories: Mapped[float] = mapped_column(Float)
    protein_g: Mapped[float] = mapped_column(Float)
    carbohydrates_g: Mapped[float] = mapped_column(Float)
    fat_g: Mapped[float] = mapped_column(Float)
    fiber_g: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    food: Mapped[Food] = relationship(back_populates="meal_logs")


class WorkoutLog(Base):
    __tablename__ = "workout_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    date: Mapped[date] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    sets: Mapped[list["WorkoutSet"]] = relationship(
        back_populates="workout",
        cascade="all, delete-orphan",
        order_by="WorkoutSet.id",
    )


class WorkoutSet(Base):
    __tablename__ = "workout_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workout_id: Mapped[int] = mapped_column(ForeignKey("workout_logs.id", ondelete="CASCADE"), index=True)
    exercise_name: Mapped[str] = mapped_column(String(120))
    set_number: Mapped[int] = mapped_column(Integer)
    reps: Mapped[int] = mapped_column(Integer)
    weight_kg: Mapped[float] = mapped_column(Float)

    workout: Mapped[WorkoutLog] = relationship(back_populates="sets")
