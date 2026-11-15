import os
import shutil
import tempfile
from pathlib import Path

import pytest

TEST_DIRECTORY = Path(tempfile.mkdtemp(prefix="fitness-tracker-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TEST_DIRECTORY / 'test.db').as_posix()}"

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.database import engine


@pytest.fixture(scope="module", autouse=True)
def remove_test_database():
    yield
    engine.dispose()
    shutil.rmtree(TEST_DIRECTORY)


def test_food_meal_workout_dashboard_and_export():
    with TestClient(app) as client:
        targets_response = client.put(
            "/api/targets",
            json={
                "calories": 2100,
                "protein_g": 130,
                "carbohydrates_g": 240,
                "fat_g": 70,
                "fiber_g": 30,
                "workouts_per_week": 3,
            },
        )
        assert targets_response.status_code == 200

        food_response = client.post(
            "/api/foods",
            json={
                "name": "Test oats",
                "brand": None,
                "preparation": "raw",
                "calories_per_100g": 250,
                "protein_g_per_100g": 10,
                "carbohydrates_g_per_100g": 40,
                "fat_g_per_100g": 5,
                "fiber_g_per_100g": 7,
                "notes": None,
            },
        )
        assert food_response.status_code == 201
        food = food_response.json()
        assert food["is_verified"] is False
        assert food["source"] == "user-entered"

        meal_response = client.post(
            "/api/meals",
            json={
                "food_id": food["id"],
                "date": "2026-11-15",
                "meal_type": "breakfast",
                "portion_g": 80,
            },
        )
        assert meal_response.status_code == 201
        meal = meal_response.json()
        assert meal["calories"] == 200
        assert meal["protein_g"] == 8
        assert meal["carbohydrates_g"] == 32
        assert meal["fat_g"] == 4
        assert meal["fiber_g"] == pytest.approx(5.6)

        updated_food = {
            **food,
            "name": "Test oats cooked",
            "preparation": "cooked",
            "calories_per_100g": 120,
        }
        updated_food.pop("id")
        updated_food.pop("source")
        updated_food.pop("is_verified")
        assert client.put(f"/api/foods/{food['id']}", json=updated_food).status_code == 200
        history_meal = client.get("/api/meals?date=2026-11-15").json()[0]
        assert history_meal["food_name"] == "Test oats"
        assert history_meal["preparation"] == "raw"
        assert history_meal["calories"] == 200

        workout_response = client.post(
            "/api/workouts",
            json={
                "name": "Strength",
                "date": "2026-11-15",
                "sets": [
                    {"exercise_name": "Squat", "set_number": 1, "reps": 8, "weight_kg": 40},
                    {"exercise_name": "Squat", "set_number": 2, "reps": 8, "weight_kg": 42.5},
                ],
            },
        )
        assert workout_response.status_code == 201

        dashboard = client.get("/api/dashboard?date=2026-11-15").json()
        assert dashboard["totals"]["calories"] == 200
        assert dashboard["remaining"]["calories"] == 1900
        assert dashboard["targets"]["workouts_per_week"] == 3
        assert dashboard["weekly"]["workout_count"] == 1
        assert sum(day["calories"] for day in dashboard["weekly"]["days"]) == 200
        assert dashboard["workouts_today"][0]["sets"][1]["weight_kg"] == 42.5

        invalid_food = client.post(
            "/api/foods",
            json={
                "name": "Invalid",
                "preparation": "raw",
                "calories_per_100g": -1,
                "protein_g_per_100g": 0,
                "carbohydrates_g_per_100g": 0,
                "fat_g_per_100g": 0,
                "fiber_g_per_100g": 0,
            },
        )
        assert invalid_food.status_code == 422
        assert client.delete(f"/api/foods/{food['id']}").status_code == 409

        export = client.get("/api/export")
        assert export.status_code == 200
        assert len(export.json()["meals"]) == 1
        assert len(export.json()["workouts"]) == 1
