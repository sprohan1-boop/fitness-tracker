from contextlib import asynccontextmanager
from pathlib import Path
from datetime import date, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import models, schemas
from .database import Base, engine, get_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Fitness Tracker API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_targets(db: Session) -> models.NutritionTargets | None:
    return db.get(models.NutritionTargets, 1)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/targets", response_model=schemas.TargetsRead | None)
def read_targets(db: Session = Depends(get_db)):
    return get_targets(db)


@app.put("/api/targets", response_model=schemas.TargetsRead)
def update_targets(payload: schemas.TargetsUpdate, db: Session = Depends(get_db)):
    targets = get_targets(db)
    if targets is None:
        targets = models.NutritionTargets(id=1)
        db.add(targets)
    for field, value in payload.model_dump().items():
        setattr(targets, field, value)
    db.commit()
    db.refresh(targets)
    return targets


@app.get("/api/foods", response_model=list[schemas.FoodRead])
def list_foods(search: str | None = Query(default=None, max_length=120), db: Session = Depends(get_db)):
    statement = select(models.Food).order_by(models.Food.name)
    if search and search.strip():
        statement = statement.where(models.Food.name.ilike(f"%{search.strip()}%"))
    return db.scalars(statement).all()


@app.post("/api/foods", response_model=schemas.FoodRead, status_code=status.HTTP_201_CREATED)
def create_food(payload: schemas.FoodCreate, db: Session = Depends(get_db)):
    food = models.Food(**payload.model_dump(), source="user-entered", is_verified=False)
    db.add(food)
    db.commit()
    db.refresh(food)
    return food


@app.put("/api/foods/{food_id}", response_model=schemas.FoodRead)
def update_food(food_id: int, payload: schemas.FoodCreate, db: Session = Depends(get_db)):
    food = db.get(models.Food, food_id)
    if food is None:
        raise HTTPException(status_code=404, detail="Food not found.")
    for field, value in payload.model_dump().items():
        setattr(food, field, value)
    db.commit()
    db.refresh(food)
    return food


@app.delete("/api/foods/{food_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_food(food_id: int, db: Session = Depends(get_db)):
    food = db.get(models.Food, food_id)
    if food is None:
        raise HTTPException(status_code=404, detail="Food not found.")
    if food.meal_logs:
        raise HTTPException(status_code=409, detail="This food has meal history and cannot be deleted.")
    db.delete(food)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/meals", response_model=list[schemas.MealRead])
def list_meals(
    on_date: date = Query(alias="date"),
    db: Session = Depends(get_db),
):
    meals = db.scalars(
        select(models.MealLog)
        .options(selectinload(models.MealLog.food))
        .where(models.MealLog.date == on_date)
        .order_by(models.MealLog.created_at.desc(), models.MealLog.id.desc())
    ).all()
    return [
        {
            "id": meal.id,
            "food_id": meal.food_id,
            "food_name": meal.food_name,
            "preparation": meal.preparation,
            "date": meal.date,
            "meal_type": meal.meal_type,
            "portion_g": meal.portion_g,
            "calories": meal.calories,
            "protein_g": meal.protein_g,
            "carbohydrates_g": meal.carbohydrates_g,
            "fat_g": meal.fat_g,
            "fiber_g": meal.fiber_g,
        }
        for meal in meals
    ]


@app.post("/api/meals", response_model=schemas.MealRead, status_code=status.HTTP_201_CREATED)
def create_meal(payload: schemas.MealCreate, db: Session = Depends(get_db)):
    food = db.get(models.Food, payload.food_id)
    if food is None:
        raise HTTPException(status_code=404, detail="Food not found. Refresh the food library and try again.")

    factor = payload.portion_g / 100
    meal = models.MealLog(
        food_id=food.id,
        food_name=food.name,
        preparation=food.preparation,
        date=payload.date,
        meal_type=payload.meal_type,
        portion_g=payload.portion_g,
        calories=food.calories_per_100g * factor,
        protein_g=food.protein_g_per_100g * factor,
        carbohydrates_g=food.carbohydrates_g_per_100g * factor,
        fat_g=food.fat_g_per_100g * factor,
        fiber_g=food.fiber_g_per_100g * factor,
    )
    db.add(meal)
    db.commit()
    db.refresh(meal)
    return {
        "id": meal.id,
        "food_id": meal.food_id,
        "food_name": meal.food_name,
        "preparation": meal.preparation,
        "date": meal.date,
        "meal_type": meal.meal_type,
        "portion_g": meal.portion_g,
        "calories": meal.calories,
        "protein_g": meal.protein_g,
        "carbohydrates_g": meal.carbohydrates_g,
        "fat_g": meal.fat_g,
        "fiber_g": meal.fiber_g,
    }


@app.delete("/api/meals/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(meal_id: int, db: Session = Depends(get_db)):
    meal = db.get(models.MealLog, meal_id)
    if meal is None:
        raise HTTPException(status_code=404, detail="Meal log not found.")
    db.delete(meal)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/workouts", response_model=list[schemas.WorkoutRead])
def list_workouts(
    on_date: date | None = Query(default=None, alias="date"),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    statement = (
        select(models.WorkoutLog)
        .options(selectinload(models.WorkoutLog.sets))
        .order_by(models.WorkoutLog.date.desc(), models.WorkoutLog.id.desc())
        .limit(limit)
    )
    if on_date:
        statement = statement.where(models.WorkoutLog.date == on_date)
    return db.scalars(statement).all()


@app.post("/api/workouts", response_model=schemas.WorkoutRead, status_code=status.HTTP_201_CREATED)
def create_workout(payload: schemas.WorkoutCreate, db: Session = Depends(get_db)):
    workout = models.WorkoutLog(name=payload.name.strip(), date=payload.date, notes=payload.notes)
    workout.sets = [
        models.WorkoutSet(**set_data.model_dump())
        for set_data in payload.sets
    ]
    db.add(workout)
    db.commit()
    db.refresh(workout)
    return workout


@app.delete("/api/workouts/{workout_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workout(workout_id: int, db: Session = Depends(get_db)):
    workout = db.get(models.WorkoutLog, workout_id)
    if workout is None:
        raise HTTPException(status_code=404, detail="Workout not found.")
    db.delete(workout)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/dashboard")
def dashboard(
    on_date: date = Query(alias="date"),
    db: Session = Depends(get_db),
):
    day_meals = db.scalars(
        select(models.MealLog).where(models.MealLog.date == on_date)
    ).all()
    day_workouts = db.scalars(
        select(models.WorkoutLog)
        .options(selectinload(models.WorkoutLog.sets))
        .where(models.WorkoutLog.date == on_date)
        .order_by(models.WorkoutLog.id.desc())
    ).all()
    week_start = on_date - timedelta(days=on_date.weekday())
    week_end = week_start + timedelta(days=6)
    week_workouts = db.scalars(
        select(models.WorkoutLog).where(
            models.WorkoutLog.date >= week_start,
            models.WorkoutLog.date <= week_end,
        )
    ).all()
    week_meals = db.scalars(
        select(models.MealLog).where(
            models.MealLog.date >= week_start,
            models.MealLog.date <= week_end,
        )
    ).all()
    targets = get_targets(db)

    totals = {
        "calories": sum(meal.calories for meal in day_meals),
        "protein_g": sum(meal.protein_g for meal in day_meals),
        "carbohydrates_g": sum(meal.carbohydrates_g for meal in day_meals),
        "fat_g": sum(meal.fat_g for meal in day_meals),
        "fiber_g": sum(meal.fiber_g for meal in day_meals),
    }
    target_values = {
        "calories": targets.calories if targets else None,
        "protein_g": targets.protein_g if targets else None,
        "carbohydrates_g": targets.carbohydrates_g if targets else None,
        "fat_g": targets.fat_g if targets else None,
        "fiber_g": targets.fiber_g if targets else None,
    }
    remaining = {
        field: max(target - totals[field], 0) if target is not None else None
        for field, target in target_values.items()
    }
    # Included after `remaining` so the form round-trips it without it being treated as a macro.
    target_values["workouts_per_week"] = targets.workouts_per_week if targets else None
    remaining["workouts_per_week"] = None
    weekly_days = []
    for offset in range(7):
        current = week_start + timedelta(days=offset)
        current_meals = [meal for meal in week_meals if meal.date == current]
        current_workouts = [workout for workout in week_workouts if workout.date == current]
        weekly_days.append(
            {
                "date": current.isoformat(),
                "label": current.strftime("%a"),
                "calories": sum(meal.calories for meal in current_meals),
                "workouts": len(current_workouts),
            }
        )

    return {
        "date": on_date,
        "totals": totals,
        "targets": target_values,
        "remaining": remaining,
        "workouts_today": [schemas.WorkoutRead.model_validate(item).model_dump(mode="json") for item in day_workouts],
        "weekly": {
            "start": week_start,
            "end": week_end,
            "workout_count": len(week_workouts),
            "workout_target": targets.workouts_per_week if targets else None,
            "days": weekly_days,
        },
    }


@app.get("/api/export")
def export_data(db: Session = Depends(get_db)):
    foods = db.scalars(select(models.Food).order_by(models.Food.id)).all()
    meals = db.scalars(
        select(models.MealLog)
        .options(selectinload(models.MealLog.food))
        .order_by(models.MealLog.date, models.MealLog.id)
    ).all()
    workouts = db.scalars(
        select(models.WorkoutLog)
        .options(selectinload(models.WorkoutLog.sets))
        .order_by(models.WorkoutLog.date, models.WorkoutLog.id)
    ).all()
    targets = get_targets(db)
    return {
        "format_version": 1,
        "targets": schemas.TargetsRead.model_validate(targets).model_dump(mode="json") if targets else None,
        "foods": [schemas.FoodRead.model_validate(food).model_dump(mode="json") for food in foods],
        "meals": [
            {
                **schemas.MealRead.model_validate(
                    {
                        "id": meal.id,
                        "food_id": meal.food_id,
                        "food_name": meal.food_name,
                        "preparation": meal.preparation,
                        "date": meal.date,
                        "meal_type": meal.meal_type,
                        "portion_g": meal.portion_g,
                        "calories": meal.calories,
                        "protein_g": meal.protein_g,
                        "carbohydrates_g": meal.carbohydrates_g,
                        "fat_g": meal.fat_g,
                        "fiber_g": meal.fiber_g,
                    }
                ).model_dump(mode="json")
            }
            for meal in meals
        ],
        "workouts": [
            schemas.WorkoutRead.model_validate(workout).model_dump(mode="json")
            for workout in workouts
        ],
    }


# Serve the built frontend (`npm run build` -> dist/) from the same server, so one
# process on one port handles both the app and the API. Mounted last so /api routes win.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "dist"
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
