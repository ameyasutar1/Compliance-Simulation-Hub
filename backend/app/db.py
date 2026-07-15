from __future__ import annotations

import json
import os
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

from psycopg import connect
from psycopg.rows import dict_row

from .seed_data import load_catalog


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://compliance_user:compliance_password@127.0.0.1:5432/compliance_platform",
)


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def days_ago_iso(days: int, hour: int = 9) -> str:
    value = datetime.now(UTC).replace(microsecond=0, hour=hour, minute=0, second=0) - timedelta(days=days)
    return value.isoformat()


@contextmanager
def get_connection():
    connection = connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield connection
    finally:
        connection.close()


def _ensure_tables(connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                department TEXT NOT NULL,
                experience_years INTEGER NOT NULL,
                is_manager BOOLEAN NOT NULL DEFAULT FALSE
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                daily_reminder BOOLEAN NOT NULL DEFAULT TRUE,
                weekly_recap BOOLEAN NOT NULL DEFAULT TRUE,
                focus_mode BOOLEAN NOT NULL DEFAULT FALSE
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS activity_attempts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                activity_id TEXT NOT NULL,
                activity_type TEXT NOT NULL,
                activity_title TEXT NOT NULL,
                score INTEGER NOT NULL,
                performance_label TEXT NOT NULL,
                xp_awarded INTEGER NOT NULL,
                topic_scores_json JSONB NOT NULL,
                details_json JSONB NOT NULL,
                path_signature TEXT,
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'completed',
                started_at TIMESTAMPTZ NOT NULL,
                completed_at TIMESTAMPTZ NOT NULL,
                is_seeded BOOLEAN NOT NULL DEFAULT FALSE
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS active_attempts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                activity_id TEXT NOT NULL,
                activity_type TEXT NOT NULL,
                state_json JSONB NOT NULL,
                started_at TIMESTAMPTZ NOT NULL
            )
            """
        )
    connection.commit()


def _seed_users(connection) -> None:
    catalog = load_catalog()
    with connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) AS count FROM users")
        existing = cursor.fetchone()["count"]
        if existing:
            return

        user_rows = [
            (
                user["id"],
                user["name"],
                user["role"],
                user["department"],
                user["experienceYears"],
                user["isManager"],
            )
            for user in catalog["users"]
        ]
        cursor.executemany(
            """
            INSERT INTO users (id, name, role, department, experience_years, is_manager)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            user_rows,
        )
        cursor.executemany(
            """
            INSERT INTO settings (user_id, daily_reminder, weekly_recap, focus_mode)
            VALUES (%s, TRUE, TRUE, FALSE)
            """,
            [(user["id"],) for user in catalog["users"]],
        )
    connection.commit()


def _seed_attempts(connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) AS count FROM activity_attempts")
        existing = cursor.fetchone()["count"]
        if existing:
            return

    catalog = load_catalog()
    simulations = catalog["simulations"]
    red_flags = catalog["redFlags"]
    investigations = catalog["investigations"]
    pressure_tests = catalog["pressureTests"]
    daily_challenges = catalog["dailyChallenges"]

    department_bias = {
        "Operations": {"aml": 72, "data-privacy": 61, "sanctions": 66, "market-abuse": 81, "conduct-risk": 74, "third-party-risk": 63, "information-security": 69, "kyc": 76, "conflicts": 70, "regulatory-reporting": 72},
        "Technology": {"aml": 74, "data-privacy": 86, "sanctions": 71, "market-abuse": 73, "conduct-risk": 79, "third-party-risk": 68, "information-security": 84, "kyc": 70, "conflicts": 67, "regulatory-reporting": 76},
        "Sales": {"aml": 68, "data-privacy": 72, "sanctions": 62, "market-abuse": 66, "conduct-risk": 70, "third-party-risk": 58, "information-security": 65, "kyc": 69, "conflicts": 64, "regulatory-reporting": 68},
        "Finance": {"aml": 79, "data-privacy": 74, "sanctions": 73, "market-abuse": 78, "conduct-risk": 75, "third-party-risk": 64, "information-security": 72, "kyc": 77, "conflicts": 68, "regulatory-reporting": 80},
        "Compliance": {"aml": 85, "data-privacy": 81, "sanctions": 83, "market-abuse": 84, "conduct-risk": 82, "third-party-risk": 77, "information-security": 78, "kyc": 84, "conflicts": 80, "regulatory-reporting": 81},
    }

    users = [user for user in catalog["users"] if not user["isManager"]]
    attempt_rows = []

    for user_index, user in enumerate(users):
        bias = department_bias[user["department"]]
        templates = [
            ("simulation", simulations[user_index % len(simulations)]),
            ("daily-challenge", daily_challenges[user_index % len(daily_challenges)]),
            ("red-flag", red_flags[user_index % len(red_flags)]),
            ("investigation", investigations[user_index % len(investigations)]),
            ("pressure-test", pressure_tests[user_index % len(pressure_tests)]),
            ("simulation", simulations[(user_index + 2) % len(simulations)]),
        ]

        for offset, (activity_type, activity) in enumerate(templates, start=1):
            topic_ids = activity["topics"] if "topics" in activity else [activity["topic"]]
            base = round(sum(bias.get(topic_id, 72) for topic_id in topic_ids) / max(1, len(topic_ids)))
            adjustment = ((user_index + offset) % 5) * 3 - 6
            score = max(48, min(96, base + adjustment))
            perfect = 100 if (user_index + offset) % 19 == 0 else score
            score = perfect
            topic_scores = {topic_id: score for topic_id in topic_ids}
            xp_awarded = _xp_for_attempt(activity_type, score)
            completed_at = days_ago_iso(18 - ((user_index + offset) % 18), hour=9 + (offset % 6))
            started_at = (datetime.fromisoformat(completed_at) - timedelta(minutes=activity.get("estimatedMinutes", 5))).isoformat()
            attempt_rows.append(
                (
                    str(uuid.uuid4()),
                    user["id"],
                    activity["id"],
                    activity_type,
                    activity["title"],
                    score,
                    performance_label(score),
                    xp_awarded,
                    json.dumps(topic_scores),
                    json.dumps(
                        {
                            "seeded": True,
                            "activityType": activity_type,
                            "decisionJourney": [],
                            "takeaway": activity.get("learningTakeaway") or activity.get("keyTakeaway"),
                        }
                    ),
                    f"{activity['id']}-path-{(user_index + offset) % 3}",
                    activity.get("estimatedMinutes", 5) * 60,
                    "completed",
                    started_at,
                    completed_at,
                    True,
                )
            )

    with connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO activity_attempts (
                id, user_id, activity_id, activity_type, activity_title, score,
                performance_label, xp_awarded, topic_scores_json, details_json,
                path_signature, duration_seconds, status, started_at, completed_at, is_seeded
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s::jsonb, %s::jsonb,
                %s, %s, %s, %s, %s, %s
            )
            """,
            attempt_rows,
        )
    connection.commit()


def init_db() -> None:
    with get_connection() as connection:
        _ensure_tables(connection)
        _seed_users(connection)
        _seed_attempts(connection)


def performance_label(score: int) -> str:
    if score >= 85:
        return "Strong"
    if score >= 70:
        return "Developing"
    return "Needs Practice"


def _xp_for_attempt(activity_type: str, score: int) -> int:
    base = {
        "daily-challenge": 50,
        "simulation": 100,
        "red-flag": 75,
        "investigation": 150,
        "pressure-test": 90,
    }.get(activity_type, 50)
    if score == 100:
        base += 50
    return base


def list_users() -> list[dict]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, name, role, department, experience_years, is_manager FROM users ORDER BY is_manager, name"
            )
            rows = cursor.fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "role": row["role"],
            "department": row["department"],
            "experienceYears": row["experience_years"],
            "isManager": bool(row["is_manager"]),
        }
        for row in rows
    ]


def get_user(user_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, name, role, department, experience_years, is_manager FROM users WHERE id = %s",
                (user_id,),
            )
            row = cursor.fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "role": row["role"],
        "department": row["department"],
        "experienceYears": row["experience_years"],
        "isManager": bool(row["is_manager"]),
    }


def get_settings(user_id: str) -> dict:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT daily_reminder, weekly_recap, focus_mode FROM settings WHERE user_id = %s",
                (user_id,),
            )
            row = cursor.fetchone()
            if not row:
                cursor.execute(
                    """
                    INSERT INTO settings (user_id, daily_reminder, weekly_recap, focus_mode)
                    VALUES (%s, TRUE, TRUE, FALSE)
                    ON CONFLICT (user_id) DO NOTHING
                    """,
                    (user_id,),
                )
                connection.commit()
                return {"dailyReminder": True, "weeklyRecap": True, "focusMode": False}

    return {
        "dailyReminder": bool(row["daily_reminder"]),
        "weeklyRecap": bool(row["weekly_recap"]),
        "focusMode": bool(row["focus_mode"]),
    }


def update_settings(user_id: str, settings: dict) -> dict:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO settings (user_id, daily_reminder, weekly_recap, focus_mode)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT(user_id) DO UPDATE SET
                    daily_reminder = EXCLUDED.daily_reminder,
                    weekly_recap = EXCLUDED.weekly_recap,
                    focus_mode = EXCLUDED.focus_mode
                """,
                (
                    user_id,
                    bool(settings.get("dailyReminder", True)),
                    bool(settings.get("weeklyRecap", True)),
                    bool(settings.get("focusMode", False)),
                ),
            )
        connection.commit()
    return get_settings(user_id)


def create_active_attempt(user_id: str, activity_id: str, activity_type: str, state: dict) -> dict:
    attempt_id = str(uuid.uuid4())
    started_at = now_iso()
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO active_attempts (id, user_id, activity_id, activity_type, state_json, started_at)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s)
                """,
                (attempt_id, user_id, activity_id, activity_type, json.dumps(state), started_at),
            )
        connection.commit()
    return {
        "id": attempt_id,
        "userId": user_id,
        "activityId": activity_id,
        "activityType": activity_type,
        "state": state,
        "startedAt": started_at,
    }


def get_active_attempt(attempt_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, user_id, activity_id, activity_type, state_json, started_at FROM active_attempts WHERE id = %s",
                (attempt_id,),
            )
            row = cursor.fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "activityId": row["activity_id"],
        "activityType": row["activity_type"],
        "state": row["state_json"] if isinstance(row["state_json"], dict) else json.loads(row["state_json"]),
        "startedAt": row["started_at"].isoformat() if hasattr(row["started_at"], "isoformat") else row["started_at"],
    }


def update_active_attempt(attempt_id: str, state: dict) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE active_attempts SET state_json = %s::jsonb WHERE id = %s",
                (json.dumps(state), attempt_id),
            )
        connection.commit()


def delete_active_attempt(attempt_id: str) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM active_attempts WHERE id = %s", (attempt_id,))
        connection.commit()


def record_completed_attempt(record: dict) -> dict:
    attempt_id = record.get("id") or str(uuid.uuid4())
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO activity_attempts (
                    id, user_id, activity_id, activity_type, activity_title, score,
                    performance_label, xp_awarded, topic_scores_json, details_json,
                    path_signature, duration_seconds, status, started_at, completed_at, is_seeded
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s, %s, %s)
                """,
                (
                    attempt_id,
                    record["userId"],
                    record["activityId"],
                    record["activityType"],
                    record["activityTitle"],
                    record["score"],
                    record["performanceLabel"],
                    record["xpAwarded"],
                    json.dumps(record["topicScores"]),
                    json.dumps(record["details"]),
                    record.get("pathSignature"),
                    record.get("durationSeconds", 0),
                    "completed",
                    record["startedAt"],
                    record["completedAt"],
                    False,
                ),
            )
        connection.commit()
    record["id"] = attempt_id
    return record


def list_attempts(user_id: str | None = None, activity_type: str | None = None) -> list[dict]:
    query = """
        SELECT id, user_id, activity_id, activity_type, activity_title, score, performance_label,
               xp_awarded, topic_scores_json, details_json, path_signature, duration_seconds,
               status, started_at, completed_at, is_seeded
        FROM activity_attempts
    """
    clauses = []
    params: list[str] = []
    if user_id:
        clauses.append("user_id = %s")
        params.append(user_id)
    if activity_type:
        clauses.append("activity_type = %s")
        params.append(activity_type)
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY completed_at DESC"

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()

    return [
        {
            "id": row["id"],
            "userId": row["user_id"],
            "activityId": row["activity_id"],
            "activityType": row["activity_type"],
            "activityTitle": row["activity_title"],
            "score": row["score"],
            "performanceLabel": row["performance_label"],
            "xpAwarded": row["xp_awarded"],
            "topicScores": row["topic_scores_json"] if isinstance(row["topic_scores_json"], dict) else json.loads(row["topic_scores_json"]),
            "details": row["details_json"] if isinstance(row["details_json"], dict) else json.loads(row["details_json"]),
            "pathSignature": row["path_signature"],
            "durationSeconds": row["duration_seconds"],
            "status": row["status"],
            "startedAt": row["started_at"].isoformat() if hasattr(row["started_at"], "isoformat") else row["started_at"],
            "completedAt": row["completed_at"].isoformat() if hasattr(row["completed_at"], "isoformat") else row["completed_at"],
            "isSeeded": bool(row["is_seeded"]),
        }
        for row in rows
    ]


def reset_demo_data() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM active_attempts")
            cursor.execute("DELETE FROM activity_attempts WHERE is_seeded = FALSE")
            cursor.execute("UPDATE settings SET daily_reminder = TRUE, weekly_recap = TRUE, focus_mode = FALSE")
        connection.commit()
