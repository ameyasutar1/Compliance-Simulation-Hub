from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from statistics import mean

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .ai import (
    OllamaError,
    generate_json,
    get_policy_guidance,
    ollama_status,
)
from .db import (
    create_ai_simulation_session,
    create_ai_simulation_turn,
    create_active_attempt,
    delete_active_attempt,
    get_ai_simulation_session,
    get_active_attempt,
    get_settings,
    get_user,
    init_db,
    list_ai_simulation_turns,
    list_attempts,
    list_users,
    now_iso,
    performance_label,
    record_completed_attempt,
    reset_demo_data,
    update_ai_simulation_session,
    update_active_attempt,
    update_settings,
)
from .seed_data import load_catalog


catalog = load_catalog()
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
app = FastAPI(title="Compliance Simulation Platform API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    userId: str


class ScenarioStartRequest(BaseModel):
    userId: str


class ScenarioDecisionRequest(BaseModel):
    userId: str
    attemptId: str
    nodeId: str
    optionId: str
    reasoningId: str | None = None


class ChallengeSubmitRequest(BaseModel):
    userId: str
    answers: dict[str, str]


class RedFlagSubmitRequest(BaseModel):
    userId: str
    selectedIds: list[str]


class InvestigationStartRequest(BaseModel):
    userId: str


class InvestigationActionRequest(BaseModel):
    userId: str
    attemptId: str
    evidenceId: str


class InvestigationSubmitRequest(BaseModel):
    userId: str
    attemptId: str
    finalDecisionId: str


class PressureSubmitRequest(BaseModel):
    userId: str
    optionId: str
    reasoningId: str | None = None
    secondsRemaining: int | None = None


class SettingsUpdateRequest(BaseModel):
    dailyReminder: bool
    weeklyRecap: bool
    focusMode: bool


class AiSimulationStartRequest(BaseModel):
    userId: str
    topicId: str
    difficulty: str = "standard"
    sessionType: str = "simulation"


class AiSimulationTurnRequest(BaseModel):
    userId: str
    learnerResponse: str
    closeSession: bool = False


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def require_user(user_id: str) -> dict:
    user = get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def topic_name(topic_id: str) -> str:
    return catalog["topicsById"][topic_id]["name"]


def unique(values: list[str]) -> list[str]:
    seen = set()
    ordered = []
    for value in values:
        if value and value not in seen:
            ordered.append(value)
            seen.add(value)
    return ordered


def clamp_score(score: float) -> int:
    return int(max(0, min(100, round(score))))


def calculate_streak(attempts: list[dict]) -> int:
    completed_dates = sorted(
        {datetime.fromisoformat(attempt["completedAt"]).date() for attempt in attempts},
        reverse=True,
    )
    if not completed_dates:
        return 0
    today = datetime.now(UTC).date()
    if completed_dates[0] not in {today, today - timedelta(days=1)}:
        return 0
    streak = 1
    previous = completed_dates[0]
    for value in completed_dates[1:]:
        if (previous - value).days == 1:
            streak += 1
            previous = value
        else:
            break
    return streak


def calculate_level(total_xp: int) -> dict:
    levels = [
        (1, "Awareness", 0, 500),
        (2, "Practitioner", 500, 1200),
        (3, "Investigator", 1200, 2200),
        (4, "Risk Champion", 2200, 3400),
        (5, "Compliance Guardian", 3400, 999999),
    ]
    for number, label, lower, upper in levels:
        if lower <= total_xp < upper:
            progress = 100 if upper == 999999 else round(((total_xp - lower) / (upper - lower)) * 100)
            return {
                "number": number,
                "label": label,
                "xp": total_xp,
                "nextLevelXp": None if upper == 999999 else upper,
                "progressPercent": progress,
            }
    return {"number": 1, "label": "Awareness", "xp": total_xp, "nextLevelXp": 500, "progressPercent": 0}


def build_recent_activity(attempts: list[dict], limit: int = 6) -> list[dict]:
    items = []
    for attempt in attempts[:limit]:
        completed = datetime.fromisoformat(attempt["completedAt"])
        items.append(
            {
                "id": attempt["id"],
                "title": attempt["activityTitle"],
                "type": attempt["activityType"],
                "score": attempt["score"],
                "label": performance_label(attempt["score"]),
                "date": completed.strftime("%d %b %Y"),
                "topicNames": [topic_name(topic_id) for topic_id in attempt["topicScores"]],
            }
        )
    return items


def calculate_topic_scores(attempts: list[dict]) -> dict[str, int]:
    buckets: dict[str, list[int]] = defaultdict(list)
    for attempt in attempts:
        for topic_id, score in attempt["topicScores"].items():
            if len(buckets[topic_id]) < 5:
                buckets[topic_id].append(score)
    return {
        topic["id"]: clamp_score(mean(buckets[topic["id"]])) if buckets[topic["id"]] else 0
        for topic in catalog["topics"]
    }


def chart_history(attempts: list[dict]) -> list[dict]:
    recent = list(reversed(attempts[:8]))
    history = []
    for attempt in recent:
        completed = datetime.fromisoformat(attempt["completedAt"])
        history.append(
            {
                "label": completed.strftime("%d %b"),
                "score": attempt["score"],
                "type": attempt["activityType"],
            }
        )
    return history


def normalize_difficulty(value: str) -> str:
    allowed = {"starter", "standard", "challenging"}
    return value if value in allowed else "standard"


def learner_topic_snapshot(user_id: str, topic_id: str) -> dict:
    attempts = list_attempts(user_id)
    topic_attempts = [attempt for attempt in attempts if topic_id in attempt["topicScores"]][:4]
    average_score = clamp_score(mean([attempt["topicScores"][topic_id] for attempt in topic_attempts])) if topic_attempts else 0
    return {
        "recentAverageScore": average_score,
        "recentActivities": [
            {
                "title": attempt["activityTitle"],
                "score": attempt["topicScores"][topic_id],
                "type": attempt["activityType"],
            }
            for attempt in topic_attempts[:3]
        ],
    }


def _text_list(values: list[str], fallback: list[str]) -> list[str]:
    cleaned = [str(value).strip() for value in values if str(value).strip()]
    return cleaned[:4] if cleaned else fallback


def normalize_opening_payload(topic_id: str, topic_name_value: str, payload: dict) -> dict:
    situation = payload.get("currentSituation") or {}
    artifact = payload.get("artifact") or {}
    rubric = payload.get("rubric") or []
    normalized = {
        "title": str(payload.get("title") or f"{topic_name_value} Live Scenario"),
        "summary": str(payload.get("summary") or "A realistic compliance situation needs your judgement."),
        "currentSituation": {
            "speaker": str(situation.get("speaker") or "Stakeholder"),
            "time": str(situation.get("time") or "Now"),
            "location": str(situation.get("location") or "Operations floor"),
            "channel": str(situation.get("channel") or "Email"),
            "message": str(situation.get("message") or "A time-sensitive request has arrived and needs a compliant response."),
        },
        "artifact": {
            "type": str(artifact.get("type") or "email"),
            "title": str(artifact.get("title") or f"{topic_name_value} signal"),
            "content": str(artifact.get("content") or "No additional artifact was generated."),
        },
        "responsePrompt": str(payload.get("responsePrompt") or "What would you do next, and why?"),
        "riskSignals": _text_list(payload.get("riskSignals") or [], ["Urgency", "Ambiguity", "Potential control bypass"]),
        "learningObjectives": _text_list(payload.get("learningObjectives") or [], [f"Apply {topic_name_value} principles", "Escalate appropriately"]),
        "rubric": [
            {
                "name": str(item.get("name") or "Compliance judgement"),
                "weight": int(item.get("weight") or 25),
            }
            for item in rubric[:4]
        ]
        or [
            {"name": "Risk identification", "weight": 30},
            {"name": "Control discipline", "weight": 30},
            {"name": "Escalation judgement", "weight": 25},
            {"name": "Reasoning clarity", "weight": 15},
        ],
        "topicId": topic_id,
        "topicName": topic_name_value,
    }
    if payload.get("_meta"):
        normalized["_meta"] = payload["_meta"]
    return normalized


def normalize_turn_payload(payload: dict) -> dict:
    evaluation = payload.get("evaluation") or {}
    next_event = payload.get("nextEvent") or {}
    artifact = payload.get("artifact") or {}
    raw_status = str(payload.get("status") or "active")
    status = "completed" if raw_status == "completed" else "active"
    score = clamp_score(float(evaluation.get("score") or 0))
    normalized = {
        "evaluation": {
            "score": score,
            "label": str(evaluation.get("label") or performance_label(score)),
            "strengths": _text_list(evaluation.get("strengths") or [], ["Recognized at least one core risk signal."]),
            "gaps": _text_list(evaluation.get("gaps") or [], ["Go further on escalation steps and control checks."]),
            "policyReasoning": _text_list(evaluation.get("policyReasoning") or [], ["Ground the response in approved controls and escalation steps."]),
            "recommendedAction": str(evaluation.get("recommendedAction") or "Pause the action and escalate through the approved path."),
            "citations": _text_list(evaluation.get("citations") or [], ["Prototype policy guidance"]),
        },
        "nextEvent": {
            "speaker": str(next_event.get("speaker") or "Reviewer"),
            "time": str(next_event.get("time") or "Shortly after"),
            "location": str(next_event.get("location") or "Case workspace"),
            "channel": str(next_event.get("channel") or "Chat"),
            "message": str(next_event.get("message") or "The situation evolves and your judgement is being tested again."),
        },
        "artifact": {
            "type": str(artifact.get("type") or "note"),
            "title": str(artifact.get("title") or "Follow-up signal"),
            "content": str(artifact.get("content") or "No new artifact generated."),
        },
        "decisionPrompt": str(payload.get("decisionPrompt") or "What would you do next, and how would you justify it?"),
        "status": status,
        "summary": str(payload.get("summary") or "The scenario continues based on your latest response."),
    }
    if payload.get("_meta"):
        normalized["_meta"] = payload["_meta"]
    return normalized


def build_ai_opening(user: dict, topic: dict, difficulty: str) -> dict:
    payload = {
        "topic": {"id": topic["id"], "name": topic["name"], "description": topic["description"]},
        "user": {
            "role": user["role"],
            "department": user["department"],
            "experienceYears": user["experienceYears"],
        },
        "difficulty": difficulty,
        "policyGuidance": get_policy_guidance(topic["id"]),
        "learnerSnapshot": learner_topic_snapshot(user["id"], topic["id"]),
        "schema": {
            "title": "string",
            "summary": "string",
            "currentSituation": {"speaker": "string", "time": "string", "location": "string", "channel": "string", "message": "string"},
            "artifact": {"type": "email|chat|alert|form|note", "title": "string", "content": "string"},
            "responsePrompt": "string",
            "riskSignals": ["string"],
            "learningObjectives": ["string"],
            "rubric": [{"name": "string", "weight": 25}],
        },
    }
    result = generate_json(
        system_prompt=(
            "You generate a realistic but constrained compliance training scenario. "
            "Keep it grounded in the provided topic and policy guidance, avoid legal advice, "
            "and produce only the requested JSON fields."
        ),
        user_payload=payload,
        task_size="large",
        temperature=0.5,
    )
    return normalize_opening_payload(topic["id"], topic["name"], result)


def build_ai_turn(user: dict, topic: dict, difficulty: str, session: dict, learner_response: str, close_session: bool) -> dict:
    turns = list_ai_simulation_turns(session["id"])
    recent_turns = [
        {
            "turnIndex": turn["turnIndex"],
            "turnKind": turn["turnKind"],
            "actor": turn["actor"],
            "content": turn["content"],
            "evaluation": turn["evaluation"],
        }
        for turn in turns[-4:]
    ]
    payload = {
        "topic": {"id": topic["id"], "name": topic["name"], "description": topic["description"]},
        "user": {
            "role": user["role"],
            "department": user["department"],
            "experienceYears": user["experienceYears"],
        },
        "difficulty": difficulty,
        "policyGuidance": get_policy_guidance(topic["id"]),
        "sessionState": {
            "title": session["state"].get("title"),
            "summary": session["state"].get("summary"),
            "currentSituation": session["state"].get("currentSituation"),
            "responsePrompt": session["state"].get("responsePrompt"),
            "turnCount": session["state"].get("turnCount", 1),
            "latestAverageScore": session["state"].get("latestAverageScore", 0),
        },
        "recentTurns": recent_turns,
        "learnerResponse": learner_response,
        "closeSession": close_session,
        "schema": {
            "evaluation": {
                "score": 0,
                "label": "Strong|Developing|Needs Practice",
                "strengths": ["string"],
                "gaps": ["string"],
                "policyReasoning": ["string"],
                "recommendedAction": "string",
                "citations": ["string"],
            },
            "nextEvent": {"speaker": "string", "time": "string", "location": "string", "channel": "string", "message": "string"},
            "artifact": {"type": "email|chat|alert|form|note", "title": "string", "content": "string"},
            "decisionPrompt": "string",
            "status": "active|completed",
            "summary": "string",
        },
    }
    result = generate_json(
        system_prompt=(
            "You are evaluating a learner's compliance response and advancing a simulation by one turn. "
            "Score with the provided policy guidance, explain consequences clearly, and keep the next event realistic. "
            "If closeSession is true, you may return status completed."
        ),
        user_payload=payload,
        task_size="large",
        temperature=0.35,
    )
    return normalize_turn_payload(result)


def require_ai_session(session_id: str, user_id: str) -> dict:
    session = get_ai_simulation_session(session_id)
    if not session or session["userId"] != user_id:
        raise HTTPException(status_code=404, detail="AI simulation session not found")
    return session


def build_ai_session_response(session: dict) -> dict:
    return {
        "session": session,
        "turns": list_ai_simulation_turns(session["id"]),
    }


def weekly_completion(attempts: list[dict]) -> list[dict]:
    buckets: dict[str, list[int]] = defaultdict(list)
    for attempt in attempts[:20]:
        completed = datetime.fromisoformat(attempt["completedAt"])
        week = completed.strftime("Wk %U")
        buckets[week].append(attempt["score"])
    rows = []
    for week, scores in list(buckets.items())[-6:]:
        rows.append({"label": week, "score": clamp_score(mean(scores)), "count": len(scores)})
    return rows


def topic_breakdown(topic_scores: dict[str, int]) -> list[dict]:
    rows = []
    for topic in catalog["topics"]:
        score = topic_scores[topic["id"]]
        rows.append(
            {
                "id": topic["id"],
                "name": topic["name"],
                "score": score,
                "label": performance_label(score),
            }
        )
    return rows


def choose_recommendation_activity(topic_id: str, difficulty_preference: str | None = None) -> dict | None:
    candidates = []
    for item in catalog["libraryItems"]:
        if topic_id in item["topics"]:
            if difficulty_preference and item["difficulty"].lower() != difficulty_preference.lower():
                continue
            candidates.append(item)
    return candidates[0] if candidates else None


def build_recommendations(user_id: str, attempts: list[dict], topic_scores: dict[str, int]) -> list[dict]:
    recommendations = []
    topic_items = sorted(topic_scores.items(), key=lambda item: item[1])
    weakest_topic, weakest_score = topic_items[0]
    if weakest_score < 60:
        activity = choose_recommendation_activity(weakest_topic, "Foundational") or choose_recommendation_activity(weakest_topic)
        if activity:
            recommendations.append(
                {
                    "id": f"rec-{weakest_topic}-foundational",
                    "title": f"Strengthen {topic_name(weakest_topic)}",
                    "reason": f"{topic_name(weakest_topic)} is below 60 and needs foundational practice.",
                    "activityId": activity["id"],
                    "activityType": activity["type"],
                }
            )
    elif weakest_score < 75:
        activity = choose_recommendation_activity(weakest_topic, "Intermediate") or choose_recommendation_activity(weakest_topic)
        if activity:
            recommendations.append(
                {
                    "id": f"rec-{weakest_topic}-intermediate",
                    "title": f"Develop {topic_name(weakest_topic)} further",
                    "reason": f"{topic_name(weakest_topic)} is developing but still needs reinforcement.",
                    "activityId": activity["id"],
                    "activityType": activity["type"],
                }
            )

    pressure_scores = [attempt["score"] for attempt in attempts if attempt["activityType"] == "pressure-test"]
    scenario_scores = [attempt["score"] for attempt in attempts if attempt["activityType"] in {"simulation", "daily-challenge"}]
    if pressure_scores and scenario_scores and mean(pressure_scores) < mean(scenario_scores) - 15:
        candidate = catalog["pressureTests"][0]
        recommendations.append(
            {
                "id": "rec-pressure",
                "title": "Pressure training replay",
                "reason": "Pressure test scores trail scenario scores by more than 15 points.",
                "activityId": candidate["id"],
                "activityType": "pressure-test",
            }
        )

    red_flag_scores = [attempt["score"] for attempt in attempts if attempt["activityType"] == "red-flag"]
    if red_flag_scores and mean(red_flag_scores) < 70:
        candidate = catalog["redFlags"][0]
        recommendations.append(
            {
                "id": "rec-red-flag",
                "title": "Red Flag Lab refresher",
                "reason": "Red Flag Lab performance is below 70.",
                "activityId": candidate["id"],
                "activityType": "red-flag",
            }
        )

    if not any(attempt["activityType"] == "investigation" for attempt in attempts):
        candidate = catalog["investigations"][0]
        recommendations.append(
            {
                "id": "rec-investigation",
                "title": "Try Investigation Mode",
                "reason": "No investigation case has been completed yet.",
                "activityId": candidate["id"],
                "activityType": "investigation",
            }
        )

    if not attempts or (datetime.now(UTC) - datetime.fromisoformat(attempts[0]["completedAt"])).days >= 7:
        challenge = current_daily_challenge()
        recommendations.append(
            {
                "id": "rec-daily",
                "title": "Return with the daily challenge",
                "reason": "No recent activity has been completed in the last 7 days.",
                "activityId": challenge["id"],
                "activityType": "daily-challenge",
            }
        )

    return recommendations[:4]


def build_badges(user_id: str, attempts: list[dict], topic_scores: dict[str, int], streak: int) -> list[dict]:
    simulation_like = [attempt for attempt in attempts if attempt["activityType"] in {"simulation", "daily-challenge"}]
    investigation_count = len([attempt for attempt in attempts if attempt["activityType"] == "investigation"])
    perfect_scores = [attempt for attempt in attempts if attempt["score"] == 100]
    red_flag_perfect = len([attempt for attempt in attempts if attempt["activityType"] == "red-flag" and attempt["score"] == 100])
    pressure_scores = [attempt["score"] for attempt in attempts if attempt["activityType"] == "pressure-test"]
    aml_count = len([attempt for attempt in attempts if "aml" in attempt["topicScores"]])
    privacy_high = len([attempt for attempt in attempts if attempt["topicScores"].get("data-privacy", 0) >= 85])
    sanctions_investigation = any(
        attempt["activityType"] == "investigation"
        and "sanctions" in attempt["topicScores"]
        and attempt["score"] >= 85
        for attempt in attempts
    )
    market_strong = any(
        "market-abuse" in attempt["topicScores"] and attempt["score"] >= 85 for attempt in attempts
    )
    path_counts = defaultdict(set)
    for attempt in attempts:
        if attempt["activityType"] == "simulation" and attempt["pathSignature"]:
            path_counts[attempt["activityId"]].add(attempt["pathSignature"])

    earned_ids = set()
    if aml_count >= 3:
        earned_ids.add("BADGE-AML-STARTER")
    if topic_scores["aml"] >= 85:
        earned_ids.add("BADGE-AML-SPECIALIST")
    if privacy_high >= 3:
        earned_ids.add("BADGE-PRIVACY")
    if sanctions_investigation:
        earned_ids.add("BADGE-SANCTIONS")
    if market_strong:
        earned_ids.add("BADGE-MARKET")
    if red_flag_perfect >= 2:
        earned_ids.add("BADGE-RED-FLAG")
    if investigation_count >= 3:
        earned_ids.add("BADGE-INVESTIGATION")
    if pressure_scores and mean(pressure_scores) >= 80:
        earned_ids.add("BADGE-PRESSURE")
    if streak >= 5:
        earned_ids.add("BADGE-STREAK")
    if len(simulation_like) >= 10:
        earned_ids.add("BADGE-TEN-SCENARIOS")
    if perfect_scores:
        earned_ids.add("BADGE-PERFECT")
    if any(len(paths) >= 3 for paths in path_counts.values()):
        earned_ids.add("BADGE-PATHS")

    return [
        {
            **badge,
            "earned": badge["id"] in earned_ids,
        }
        for badge in catalog["badges"]
    ]


def user_learning_snapshot(user_id: str) -> dict:
    user = require_user(user_id)
    attempts = list_attempts(user_id=user_id)
    topic_scores = calculate_topic_scores(attempts)
    overall_score = clamp_score(mean([score for score in topic_scores.values() if score > 0])) if attempts else 0
    total_xp = sum(attempt["xpAwarded"] for attempt in attempts)
    streak = calculate_streak(attempts)
    recommendations = build_recommendations(user_id, attempts, topic_scores)
    badges = build_badges(user_id, attempts, topic_scores, streak)
    strengths = [row["name"] for row in sorted(topic_breakdown(topic_scores), key=lambda item: item["score"], reverse=True)[:3]]
    needs_practice = [row["name"] for row in sorted(topic_breakdown(topic_scores), key=lambda item: item["score"])[:3]]
    return {
        "user": user,
        "overallScore": overall_score,
        "topicScores": topic_breakdown(topic_scores),
        "strengths": strengths,
        "needsPractice": needs_practice,
        "history": chart_history(attempts),
        "weeklyCompletion": weekly_completion(attempts),
        "activityHistory": build_recent_activity(attempts, limit=12),
        "recommendations": recommendations,
        "badges": badges,
        "xp": total_xp,
        "level": calculate_level(total_xp),
        "streak": streak,
        "completedCount": len(attempts),
        "weeklyTrainingMinutes": round(sum(a["durationSeconds"] for a in attempts[:7]) / 60),
    }


def training_mode_cards() -> list[dict]:
    return [
        {"id": "Daily Challenge", "label": "Daily Challenge", "description": "One short case mapped to today's learning focus."},
        {"id": "Simulations", "label": "Scenario Simulation", "description": "Multi-step branching scenarios with consequences."},
        {"id": "Red Flag Lab", "label": "Spot the Red Flags", "description": "Click or highlight risky language in realistic content."},
        {"id": "Investigations", "label": "Investigation Mode", "description": "Review evidence before choosing a final disposition."},
        {"id": "Pressure Tests", "label": "Pressure Test", "description": "Hold the control line under time and stakeholder pressure."},
        {"id": "Compliance Coach", "label": "Compliance Coach", "description": "Static, rule-based policy explanations and reminders."},
    ]


def current_daily_challenge() -> dict:
    today = date.today().toordinal()
    index = today % len(catalog["dailyChallenges"])
    return catalog["dailyChallenges"][index]


def attempt_stats_for_activity(user_id: str, activity_id: str) -> dict:
    attempts = [attempt for attempt in list_attempts(user_id=user_id) if attempt["activityId"] == activity_id]
    if not attempts:
        return {"completed": False, "bestScore": None, "attempts": 0, "pathsExplored": 0}
    paths = {attempt["pathSignature"] for attempt in attempts if attempt["pathSignature"]}
    return {
        "completed": True,
        "bestScore": max(attempt["score"] for attempt in attempts),
        "attempts": len(attempts),
        "pathsExplored": len(paths),
        "firstAttempt": attempts[-1]["score"],
        "latestAttempt": attempts[0]["score"],
    }


def build_dashboard(user_id: str) -> dict:
    snapshot = user_learning_snapshot(user_id)
    daily = current_daily_challenge()
    challenge_stats = attempt_stats_for_activity(user_id, daily["id"])
    scored_topics = [row for row in snapshot["topicScores"] if row["score"] > 0]
    weakest_topic = min(scored_topics or snapshot["topicScores"], key=lambda row: row["score"])
    activities = build_recent_activity(list_attempts(user_id=user_id), limit=4)
    return {
        "user": snapshot["user"],
        "greeting": f"Good {'morning' if datetime.now().hour < 12 else 'afternoon'}, {snapshot['user']['name'].split()[0]}",
        "currentLearningFocus": weakest_topic,
        "dailyChallenge": {
            "id": daily["id"],
            "title": daily["title"],
            "topic": topic_name(daily["topic"]),
            "difficulty": daily["difficulty"],
            "estimatedMinutes": daily["estimatedMinutes"],
            "summary": daily["scenarioSummary"],
            "completed": challenge_stats["completed"],
            "bestScore": challenge_stats["bestScore"],
        },
        "learningSummary": {
            "overallScore": snapshot["overallScore"],
            "streak": snapshot["streak"],
            "scenariosCompleted": len([attempt for attempt in list_attempts(user_id=user_id) if attempt["activityType"] in {"simulation", "daily-challenge"}]),
            "badgesEarned": len([badge for badge in snapshot["badges"] if badge["earned"]]),
            "weeklyTrainingMinutes": snapshot["weeklyTrainingMinutes"],
            "xp": snapshot["xp"],
            "level": snapshot["level"],
        },
        "trainingModes": training_mode_cards(),
        "topicFocus": sorted(snapshot["topicScores"], key=lambda row: row["score"])[:4],
        "recentActivity": activities,
        "recommendations": snapshot["recommendations"],
    }


def normalize_library_items(user_id: str) -> list[dict]:
    attempts = list_attempts(user_id=user_id)
    topic_scores = calculate_topic_scores(attempts)
    recommendations = build_recommendations(user_id, attempts, topic_scores)
    items = []
    for item in catalog["libraryItems"]:
        stats = attempt_stats_for_activity(user_id, item["id"])
        items.append(
            {
                **item,
                "topicNames": [topic_name(topic_id) for topic_id in item["topics"]],
                "completed": stats["completed"],
                "bestScore": stats["bestScore"],
                "attempts": stats["attempts"],
                "recommended": any(rec["activityId"] == item["id"] for rec in recommendations),
            }
        )
    return items


def aggregate_users() -> list[dict]:
    users = [user for user in list_users() if not user["isManager"]]
    rows = []
    for user in users:
        snapshot = user_learning_snapshot(user["id"])
        rows.append(
            {
                "user": user,
                "snapshot": snapshot,
            }
        )
    return rows


def manager_summary_payload() -> dict:
    rows = aggregate_users()
    all_attempts = list_attempts()
    employee_attempts = [attempt for attempt in all_attempts if not require_user(attempt["userId"])["isManager"]]
    active_this_week = {
        attempt["userId"]
        for attempt in employee_attempts
        if (datetime.now(UTC) - datetime.fromisoformat(attempt["completedAt"])).days <= 7
    }
    topic_averages = {}
    for topic in catalog["topics"]:
        scores = []
        for row in rows:
            topic_row = next(item for item in row["snapshot"]["topicScores"] if item["id"] == topic["id"])
            scores.append(topic_row["score"])
        topic_averages[topic["id"]] = clamp_score(mean(scores)) if scores else 0
    top_weak_topic = min(topic_averages.items(), key=lambda item: item[1])[0]
    activity_counts = defaultdict(int)
    for attempt in employee_attempts:
        activity_counts[attempt["activityTitle"]] += 1
    most_completed = max(activity_counts.items(), key=lambda item: item[1])[0] if activity_counts else "No activity yet"
    avg_minutes = round(mean([attempt["durationSeconds"] / 60 for attempt in employee_attempts])) if employee_attempts else 0
    completion_rate = round((len({attempt["userId"] for attempt in employee_attempts}) / max(1, len(rows))) * 100)
    return {
        "totalEmployees": len(rows),
        "activeEmployeesThisWeek": len(active_this_week),
        "completionRate": completion_rate,
        "averageLearningScore": clamp_score(mean([row["snapshot"]["overallScore"] for row in rows])) if rows else 0,
        "averageDailyTrainingTime": avg_minutes,
        "topWeakTopic": topic_name(top_weak_topic),
        "mostCompletedActivity": most_completed,
    }


def manager_heatmap_payload() -> list[dict]:
    rows = aggregate_users()
    departments = defaultdict(list)
    focus_topics = ["aml", "data-privacy", "sanctions", "market-abuse", "conduct-risk"]
    for row in rows:
        departments[row["user"]["department"]].append(row["snapshot"])
    heatmap = []
    for department, snapshots in departments.items():
        metrics = {}
        for topic_id in focus_topics:
            topic_scores = []
            for snapshot in snapshots:
                for topic_row in snapshot["topicScores"]:
                    if topic_row["id"] == topic_id:
                        topic_scores.append(topic_row["score"])
            metrics[topic_id] = clamp_score(mean(topic_scores)) if topic_scores else 0
        heatmap.append({"department": department, **metrics})
    return sorted(heatmap, key=lambda item: item["department"])


def manager_gaps_payload() -> list[dict]:
    heatmap = manager_heatmap_payload()
    gaps = []
    for row in heatmap:
        lowest_topic = min(
            [(topic_id, score) for topic_id, score in row.items() if topic_id != "department"],
            key=lambda item: item[1],
        )
        gaps.append(
            {
                "department": row["department"],
                "topic": topic_name(lowest_topic[0]),
                "score": lowest_topic[1],
                "campaignRecommendation": f"{row['department']} should repeat {topic_name(lowest_topic[0])} scenarios and a matching Red Flag Lab exercise.",
            }
        )
    return sorted(gaps, key=lambda item: item["score"])


def manager_departments_payload() -> list[dict]:
    rows = aggregate_users()
    departments = defaultdict(list)
    for row in rows:
        departments[row["user"]["department"]].append(row["snapshot"])
    result = []
    for department, snapshots in departments.items():
        average_score = clamp_score(mean([snapshot["overallScore"] for snapshot in snapshots])) if snapshots else 0
        average_topics = defaultdict(list)
        for snapshot in snapshots:
            for topic_row in snapshot["topicScores"]:
                average_topics[topic_row["id"]].append(topic_row["score"])
        topic_means = {topic_id: clamp_score(mean(scores)) for topic_id, scores in average_topics.items()}
        strongest = topic_name(max(topic_means.items(), key=lambda item: item[1])[0])
        weakest = topic_name(min(topic_means.items(), key=lambda item: item[1])[0])
        result.append(
            {
                "department": department,
                "averageScore": average_score,
                "participation": len(snapshots),
                "strongestTopic": strongest,
                "weakestTopic": weakest,
                "recommendedCampaign": f"Assign a {weakest} refresher campaign and a follow-up simulation.",
            }
        )
    return sorted(result, key=lambda item: item["department"])


def manager_activity_payload() -> dict:
    attempts = [attempt for attempt in list_attempts() if not require_user(attempt["userId"])["isManager"]]
    simulations = [attempt for attempt in attempts if attempt["activityType"] == "simulation"]
    red_flags = [attempt for attempt in attempts if attempt["activityType"] == "red-flag"]
    investigations = [attempt for attempt in attempts if attempt["activityType"] == "investigation"]
    pressure = [attempt for attempt in attempts if attempt["activityType"] == "pressure-test"]
    most_failed = min(simulations, key=lambda attempt: attempt["score"])["activityTitle"] if simulations else "No scenarios yet"
    most_missed_red_flag = min(red_flags, key=lambda attempt: attempt["score"])["activityTitle"] if red_flags else "No red-flag data"
    replay_count = len([attempt for attempt in simulations if attempt["pathSignature"]])
    return {
        "mostFailedScenario": most_failed,
        "mostMissedRedFlag": most_missed_red_flag,
        "averageInvestigationScore": clamp_score(mean([attempt["score"] for attempt in investigations])) if investigations else 0,
        "pressureTestSuccessRate": round(
            (len([attempt for attempt in pressure if attempt["score"] >= 70]) / max(1, len(pressure))) * 100
        ),
        "scenarioReplays": replay_count,
    }


def simulation_preview(user_id: str, scenario: dict) -> dict:
    stats = attempt_stats_for_activity(user_id, scenario["id"])
    return {
        "id": scenario["id"],
        "title": scenario["title"],
        "description": scenario["description"],
        "difficulty": scenario["difficulty"],
        "estimatedMinutes": scenario["estimatedMinutes"],
        "topics": scenario["topics"],
        "topicNames": [topic_name(topic_id) for topic_id in scenario["topics"]],
        "roleRelevance": scenario["roleRelevance"],
        "completed": stats["completed"],
        "bestScore": stats["bestScore"],
        "attempts": stats["attempts"],
    }


def build_report(
    *,
    activity_id: str,
    activity_type: str,
    user_id: str,
    title: str,
    score: int,
    topic_scores: dict[str, int],
    started_at: str,
    completed_at: str,
    details: dict,
    path_signature: str | None = None,
) -> dict:
    duration = max(60, int((datetime.fromisoformat(completed_at) - datetime.fromisoformat(started_at)).total_seconds()))
    performance = performance_label(score)
    xp_awarded = {
        "simulation": 100,
        "daily-challenge": 50,
        "red-flag": 75,
        "investigation": 150,
        "pressure-test": 90,
    }.get(activity_type, 50)
    if score == 100:
        xp_awarded += 50
    record_completed_attempt(
        {
            "userId": user_id,
            "activityId": activity_id,
            "activityType": activity_type,
            "activityTitle": title,
            "score": score,
            "performanceLabel": performance,
            "xpAwarded": xp_awarded,
            "topicScores": topic_scores,
            "details": details,
            "pathSignature": path_signature,
            "durationSeconds": duration,
            "startedAt": started_at,
            "completedAt": completed_at,
        }
    )
    return {
        "activityId": activity_id,
        "activityType": activity_type,
        "title": title,
        "score": score,
        "performanceLabel": performance,
        "timeTakenSeconds": duration,
        "topicScores": [{"id": key, "name": topic_name(key), "score": value} for key, value in topic_scores.items()],
        "xpAwarded": xp_awarded,
        **details,
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/ai/status")
def ai_status() -> dict:
    try:
        status = ollama_status()
    except OllamaError as exc:
        return {"status": "unavailable", "detail": str(exc)}
    return {"status": "ok", **status}


@app.post("/api/ai/simulations")
def start_ai_simulation(payload: AiSimulationStartRequest) -> dict:
    user = require_user(payload.userId)
    topic = catalog["topicsById"].get(payload.topicId)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    difficulty = normalize_difficulty(payload.difficulty)
    try:
        opening = build_ai_opening(user, topic, difficulty)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    model_name = opening.get("_meta", {}).get("model", "")
    opening_turn_content = opening["currentSituation"]["message"]
    state = {
        "title": opening["title"],
        "summary": opening["summary"],
        "topicId": topic["id"],
        "topicName": topic["name"],
        "difficulty": difficulty,
        "currentSituation": opening["currentSituation"],
        "artifact": opening["artifact"],
        "responsePrompt": opening["responsePrompt"],
        "riskSignals": opening["riskSignals"],
        "learningObjectives": opening["learningObjectives"],
        "rubric": opening["rubric"],
        "turnCount": 1,
        "latestAverageScore": learner_topic_snapshot(user["id"], topic["id"])["recentAverageScore"],
    }
    session = create_ai_simulation_session(
        user["id"],
        payload.sessionType,
        topic["id"],
        difficulty,
        model_name,
        state,
    )
    create_ai_simulation_turn(
        session["id"],
        1,
        "system",
        opening["currentSituation"]["speaker"],
        opening_turn_content,
        model_name,
        artifact=opening["artifact"],
    )
    session = get_ai_simulation_session(session["id"])
    return {
        "opening": opening,
        **build_ai_session_response(session),
    }


@app.get("/api/ai/simulations/{session_id}")
def get_ai_simulation(session_id: str, userId: str = Query(...)) -> dict:
    require_user(userId)
    session = require_ai_session(session_id, userId)
    return build_ai_session_response(session)


@app.post("/api/ai/simulations/{session_id}/turns")
def submit_ai_simulation_turn(session_id: str, payload: AiSimulationTurnRequest) -> dict:
    user = require_user(payload.userId)
    session = require_ai_session(session_id, payload.userId)
    if session["status"] == "completed":
        raise HTTPException(status_code=400, detail="This AI simulation session is already complete")

    topic = catalog["topicsById"].get(session["topicId"])
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    learner_text = payload.learnerResponse.strip()
    if not learner_text:
        raise HTTPException(status_code=400, detail="Learner response is required")

    learner_turn_index = len(list_ai_simulation_turns(session_id)) + 1
    create_ai_simulation_turn(
        session_id,
        learner_turn_index,
        "learner",
        user["name"],
        learner_text,
        session["modelName"],
    )

    try:
        generated_turn = build_ai_turn(user, topic, session["difficulty"], session, learner_text, payload.closeSession)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    model_name = generated_turn.get("_meta", {}).get("model", session["modelName"])
    system_turn_index = learner_turn_index + 1
    create_ai_simulation_turn(
        session_id,
        system_turn_index,
        "system",
        generated_turn["nextEvent"]["speaker"],
        generated_turn["nextEvent"]["message"],
        model_name,
        artifact=generated_turn["artifact"],
        evaluation=generated_turn["evaluation"],
    )

    next_state = {
        **session["state"],
        "summary": generated_turn["summary"],
        "currentSituation": generated_turn["nextEvent"],
        "artifact": generated_turn["artifact"],
        "responsePrompt": generated_turn["decisionPrompt"],
        "turnCount": system_turn_index,
        "latestAverageScore": generated_turn["evaluation"]["score"],
        "lastEvaluation": generated_turn["evaluation"],
    }
    updated_session = update_ai_simulation_session(session_id, next_state, generated_turn["status"])
    return {
        "result": generated_turn,
        **build_ai_session_response(updated_session),
    }


@app.get("/api/users")
def api_users() -> list[dict]:
    return list_users()


@app.post("/api/login")
def login(payload: LoginRequest) -> dict:
    user = require_user(payload.userId)
    snapshot = user_learning_snapshot(user["id"])
    return {
        "user": user,
        "learningSummary": {
            "overallScore": snapshot["overallScore"],
            "streak": snapshot["streak"],
            "xp": snapshot["xp"],
            "level": snapshot["level"],
        },
    }


@app.get("/api/users/{user_id}")
def api_user(user_id: str) -> dict:
    user = require_user(user_id)
    return {
        "user": user,
        "settings": get_settings(user_id),
        "learningSummary": user_learning_snapshot(user_id),
    }


@app.get("/api/dashboard/{user_id}")
def dashboard(user_id: str) -> dict:
    require_user(user_id)
    return build_dashboard(user_id)


@app.get("/api/daily-challenge")
def daily_challenge(userId: str = Query(...)) -> dict:
    require_user(userId)
    challenge = current_daily_challenge()
    stats = attempt_stats_for_activity(userId, challenge["id"])
    return {
        **challenge,
        "topicName": topic_name(challenge["topic"]),
        "stats": stats,
    }


@app.post("/api/daily-challenge/{challenge_id}/submit")
def submit_daily_challenge(challenge_id: str, payload: ChallengeSubmitRequest) -> dict:
    require_user(payload.userId)
    challenge = catalog["dailyChallengesById"].get(challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    correct = 0
    journey = []
    for question in challenge["questions"]:
        selected = payload.answers.get(question["id"])
        selected_option = next((option for option in question["options"] if option["id"] == selected), None)
        correct_option = next(option for option in question["options"] if option["correct"])
        if selected_option and selected_option["correct"]:
            correct += 1
        journey.append(
            {
                "prompt": question["prompt"],
                "selected": selected_option["label"] if selected_option else "No answer selected",
                "correct": correct_option["label"],
                "explanation": question["explanation"],
            }
        )

    raw_score = correct * 30 + 10
    score = clamp_score(raw_score)
    topic_scores = {challenge["topic"]: score}
    completed_at = now_iso()
    started_at = (datetime.fromisoformat(completed_at) - timedelta(minutes=challenge["estimatedMinutes"])).isoformat()
    report = build_report(
        activity_id=challenge["id"],
        activity_type="daily-challenge",
        user_id=payload.userId,
        title=challenge["title"],
        score=score,
        topic_scores=topic_scores,
        started_at=started_at,
        completed_at=completed_at,
        details={
            "decisionJourney": journey,
            "whatYouDidWell": [f"Answered {correct} of {len(challenge['questions'])} decision points correctly."],
            "whatYouMissed": [] if correct == len(challenge["questions"]) else ["Revisit the explanations for the missed responses."],
            "keyTakeaway": challenge["learningTakeaway"],
            "actions": ["Replay Challenge", "Continue Learning", "Return Home"],
        },
    )
    return report


@app.get("/api/scenarios")
def list_scenarios(userId: str = Query(...)) -> list[dict]:
    require_user(userId)
    return [simulation_preview(userId, scenario) for scenario in catalog["simulations"]]


@app.get("/api/scenarios/{scenario_id}")
def scenario_detail(scenario_id: str, userId: str = Query(...)) -> dict:
    require_user(userId)
    scenario = catalog["simulationsById"].get(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    stats = attempt_stats_for_activity(userId, scenario_id)
    return {
        **scenario,
        "topicNames": [topic_name(topic_id) for topic_id in scenario["topics"]],
        "stats": stats,
    }


@app.get("/api/scenarios/{scenario_id}/nodes/{node_id}")
def scenario_node(scenario_id: str, node_id: str, userId: str = Query(...)) -> dict:
    require_user(userId)
    scenario = catalog["simulationsById"].get(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    node = next((entry for entry in scenario["nodes"] if entry["id"] == node_id), None)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@app.post("/api/scenarios/{scenario_id}/attempts")
def start_scenario_attempt(scenario_id: str, payload: ScenarioStartRequest) -> dict:
    require_user(payload.userId)
    scenario = catalog["simulationsById"].get(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    start_node = next(node for node in scenario["nodes"] if node["id"] == scenario["startNodeId"])
    state = {
        "scenarioId": scenario_id,
        "currentNodeId": start_node["id"],
        "score": 0,
        "journey": [],
        "selectedReasons": [],
    }
    attempt = create_active_attempt(payload.userId, scenario_id, "simulation", state)
    return {
        "attemptId": attempt["id"],
        "scenario": scenario_detail(scenario_id, payload.userId),
        "node": start_node,
        "progress": {"currentStep": 1, "totalSteps": len(scenario["nodes"])},
    }


@app.post("/api/scenarios/{scenario_id}/decisions")
def submit_scenario_decision(scenario_id: str, payload: ScenarioDecisionRequest) -> dict:
    require_user(payload.userId)
    scenario = catalog["simulationsById"].get(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    active_attempt = get_active_attempt(payload.attemptId)
    if not active_attempt or active_attempt["userId"] != payload.userId:
        raise HTTPException(status_code=404, detail="Active attempt not found")

    node = next((item for item in scenario["nodes"] if item["id"] == payload.nodeId), None)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    option = next((item for item in node["options"] if item["id"] == payload.optionId), None)
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")

    state = active_attempt["state"]
    score_delta = option["score"]
    if payload.reasoningId in {"safe", "escalate"} and option["correct"]:
        score_delta += 5
    state["score"] += score_delta
    state["selectedReasons"].append(payload.reasoningId)
    state["journey"].append(
        {
            "step": node["step"],
            "prompt": node["content"],
            "selected": option["label"],
            "consequence": option["consequence"],
            "riskLevel": option["riskLevel"],
            "correct": option["correct"],
        }
    )

    next_node = next((item for item in scenario["nodes"] if item["id"] == option["nextNodeId"]), None) if option["nextNodeId"] else None
    state["currentNodeId"] = next_node["id"] if next_node else None

    if next_node:
        update_active_attempt(payload.attemptId, state)
        return {
            "complete": False,
            "consequence": option["consequence"],
            "scoreSnapshot": clamp_score(state["score"]),
            "progress": {"currentStep": next_node["step"], "totalSteps": len(scenario["nodes"])},
            "nextNode": next_node,
        }

    completed_at = now_iso()
    final_score = clamp_score(state["score"] + 10)
    topic_scores = {topic_id: final_score for topic_id in scenario["topics"]}
    correct_steps = len([entry for entry in state["journey"] if entry["correct"]])
    report = build_report(
        activity_id=scenario["id"],
        activity_type="simulation",
        user_id=payload.userId,
        title=scenario["title"],
        score=final_score,
        topic_scores=topic_scores,
        started_at=active_attempt["startedAt"],
        completed_at=completed_at,
        path_signature=">".join(entry["selected"] for entry in state["journey"]),
        details={
            "decisionJourney": state["journey"],
            "whatYouDidWell": unique(
                [
                    f"Step {entry['step']}: {entry['selected']}"
                    for entry in state["journey"]
                    if entry["correct"]
                ]
            )[:3],
            "whatYouMissed": unique(
                [
                    f"Step {entry['step']}: {entry['selected']}"
                    for entry in state["journey"]
                    if not entry["correct"]
                ]
            )[:3],
            "whyWrongFeltReasonable": scenario["report"]["whyWrongFeltReasonable"],
            "correctDecision": scenario["report"]["correctDecision"],
            "potentialConsequences": scenario["report"]["potentialConsequences"],
            "keyTakeaway": scenario["report"]["keyTakeaway"],
            "actions": ["Replay Scenario", "Explore Another Path", "Continue Learning", "Return Home"],
            "replayInsights": {
                **attempt_stats_for_activity(payload.userId, scenario["id"]),
                "pathsAvailable": scenario["totalPaths"],
                "bestOutcomeDiscovered": final_score,
                "correctSteps": correct_steps,
            },
        },
    )
    delete_active_attempt(payload.attemptId)
    return {"complete": True, "report": report}


@app.post("/api/scenarios/{scenario_id}/complete")
def complete_scenario_manually(scenario_id: str, payload: ScenarioDecisionRequest) -> dict:
    return submit_scenario_decision(scenario_id, payload)


@app.get("/api/red-flags")
def red_flag_list(userId: str = Query(...)) -> list[dict]:
    require_user(userId)
    items = []
    for item in catalog["redFlags"]:
        stats = attempt_stats_for_activity(userId, item["id"])
        items.append(
            {
                "id": item["id"],
                "title": item["title"],
                "topic": item["topic"],
                "topicName": topic_name(item["topic"]),
                "difficulty": item["difficulty"],
                "estimatedMinutes": item["estimatedMinutes"],
                "summary": item["summary"],
                "bestScore": stats["bestScore"],
                "completed": stats["completed"],
            }
        )
    return items


@app.get("/api/red-flags/{activity_id}")
def red_flag_detail(activity_id: str, userId: str = Query(...)) -> dict:
    require_user(userId)
    item = catalog["redFlagsById"].get(activity_id)
    if not item:
        raise HTTPException(status_code=404, detail="Red flag exercise not found")
    return {**item, "topicName": topic_name(item["topic"])}


@app.post("/api/red-flags/{activity_id}/submit")
def submit_red_flags(activity_id: str, payload: RedFlagSubmitRequest) -> dict:
    require_user(payload.userId)
    item = catalog["redFlagsById"].get(activity_id)
    if not item:
        raise HTTPException(status_code=404, detail="Red flag exercise not found")
    flag_ids = {fragment["id"] for fragment in item["fragments"] if fragment["isFlag"]}
    selected_ids = set(payload.selectedIds)
    correct_found = selected_ids & flag_ids
    false_positives = selected_ids - flag_ids
    missed = flag_ids - selected_ids
    raw = len(correct_found) * 15 - len(false_positives) * 5
    if not missed:
        raw += 10
    max_raw = len(flag_ids) * 15 + 10
    score = clamp_score((raw / max_raw) * 100 if max_raw else 0)
    completed_at = now_iso()
    started_at = (datetime.fromisoformat(completed_at) - timedelta(minutes=item["estimatedMinutes"])).isoformat()
    report = build_report(
        activity_id=item["id"],
        activity_type="red-flag",
        user_id=payload.userId,
        title=item["title"],
        score=score,
        topic_scores={item["topic"]: score},
        started_at=started_at,
        completed_at=completed_at,
        details={
            "identified": [fragment for fragment in item["fragments"] if fragment["id"] in correct_found],
            "missed": [fragment for fragment in item["fragments"] if fragment["id"] in missed],
            "falsePositives": [fragment for fragment in item["fragments"] if fragment["id"] in false_positives],
            "keyTakeaway": f"Look for secrecy, pressure, verification gaps and unusual workarounds in {topic_name(item['topic'])} situations.",
            "actions": ["Try Another Exercise", "Continue Learning", "Return Home"],
        },
    )
    return report


@app.get("/api/investigations")
def investigation_list(userId: str = Query(...)) -> list[dict]:
    require_user(userId)
    items = []
    for item in catalog["investigations"]:
        stats = attempt_stats_for_activity(userId, item["id"])
        items.append(
            {
                "id": item["id"],
                "title": item["title"],
                "summary": item["summary"],
                "riskLevel": item["riskLevel"],
                "difficulty": item["difficulty"],
                "estimatedMinutes": item["estimatedMinutes"],
                "topicNames": [topic_name(topic_id) for topic_id in item["topics"]],
                "completed": stats["completed"],
                "bestScore": stats["bestScore"],
            }
        )
    return items


@app.get("/api/investigations/{case_id}")
def investigation_detail(case_id: str, userId: str = Query(...)) -> dict:
    require_user(userId)
    item = catalog["investigationsById"].get(case_id)
    if not item:
        raise HTTPException(status_code=404, detail="Investigation not found")
    return {**item, "topicNames": [topic_name(topic_id) for topic_id in item["topics"]]}


@app.post("/api/investigations/{case_id}/attempts")
def start_investigation(case_id: str, payload: InvestigationStartRequest) -> dict:
    require_user(payload.userId)
    item = catalog["investigationsById"].get(case_id)
    if not item:
        raise HTTPException(status_code=404, detail="Investigation not found")
    state = {"reviewedEvidence": [], "decisionLog": []}
    attempt = create_active_attempt(payload.userId, case_id, "investigation", state)
    return {"attemptId": attempt["id"], "case": investigation_detail(case_id, payload.userId), "state": state}


@app.post("/api/investigations/{case_id}/action")
def investigation_action(case_id: str, payload: InvestigationActionRequest) -> dict:
    require_user(payload.userId)
    item = catalog["investigationsById"].get(case_id)
    if not item:
        raise HTTPException(status_code=404, detail="Investigation not found")
    attempt = get_active_attempt(payload.attemptId)
    if not attempt or attempt["userId"] != payload.userId:
        raise HTTPException(status_code=404, detail="Investigation attempt not found")
    evidence = next((entry for entry in item["evidence"] if entry["id"] == payload.evidenceId), None)
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")
    state = attempt["state"]
    if payload.evidenceId not in state["reviewedEvidence"]:
        state["reviewedEvidence"].append(payload.evidenceId)
        state["decisionLog"].append(f"Reviewed {evidence['title']}")
        update_active_attempt(payload.attemptId, state)
    return {"state": state, "evidence": evidence}


@app.post("/api/investigations/{case_id}/submit")
def submit_investigation(case_id: str, payload: InvestigationSubmitRequest) -> dict:
    require_user(payload.userId)
    item = catalog["investigationsById"].get(case_id)
    if not item:
        raise HTTPException(status_code=404, detail="Investigation not found")
    attempt = get_active_attempt(payload.attemptId)
    if not attempt or attempt["userId"] != payload.userId:
        raise HTTPException(status_code=404, detail="Investigation attempt not found")
    state = attempt["state"]
    important = [entry for entry in item["evidence"] if entry["important"]]
    reviewed_important = [entry for entry in important if entry["id"] in state["reviewedEvidence"]]
    missed_important = [entry for entry in important if entry["id"] not in state["reviewedEvidence"]]
    final_decision = next((entry for entry in item["finalDecisions"] if entry["id"] == payload.finalDecisionId), None)
    if not final_decision:
        raise HTTPException(status_code=400, detail="Final decision not found")
    score = len(reviewed_important) * 10 - len(missed_important) * 10
    if final_decision["correct"]:
        score += 45
    elif payload.finalDecisionId == "clear":
        score -= 20
    score += 20
    final_score = clamp_score(score)
    completed_at = now_iso()
    report = build_report(
        activity_id=item["id"],
        activity_type="investigation",
        user_id=payload.userId,
        title=item["title"],
        score=final_score,
        topic_scores={topic_id: final_score for topic_id in item["topics"]},
        started_at=attempt["startedAt"],
        completed_at=completed_at,
        details={
            "decisionJourney": state["decisionLog"] + [f"Final disposition: {final_decision['label']}"],
            "whatYouDidWell": [f"Reviewed {entry['title']}" for entry in reviewed_important[:3]],
            "whatYouMissed": [f"Missed {entry['title']}" for entry in missed_important[:3]],
            "keyTakeaway": "High-quality investigations review the right evidence before the final disposition is chosen.",
            "actions": ["Replay Case", "Try Another Case", "Return Home"],
        },
    )
    delete_active_attempt(payload.attemptId)
    return report


@app.get("/api/pressure-tests")
def pressure_list(userId: str = Query(...)) -> list[dict]:
    require_user(userId)
    items = []
    for item in catalog["pressureTests"]:
        stats = attempt_stats_for_activity(userId, item["id"])
        items.append(
            {
                "id": item["id"],
                "title": item["title"],
                "topic": item["topic"],
                "topicName": topic_name(item["topic"]),
                "difficulty": item["difficulty"],
                "pressureType": item["pressureType"],
                "timerSeconds": item["timerSeconds"],
                "scenario": item["scenario"],
                "completed": stats["completed"],
                "bestScore": stats["bestScore"],
            }
        )
    return items


@app.get("/api/pressure-tests/{test_id}")
def pressure_detail(test_id: str, userId: str = Query(...)) -> dict:
    require_user(userId)
    item = catalog["pressureTestsById"].get(test_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pressure test not found")
    return {**item, "topicName": topic_name(item["topic"])}


@app.post("/api/pressure-tests/{test_id}/submit")
def submit_pressure(test_id: str, payload: PressureSubmitRequest) -> dict:
    require_user(payload.userId)
    item = catalog["pressureTestsById"].get(test_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pressure test not found")
    option = next((entry for entry in item["options"] if entry["id"] == payload.optionId), None)
    if not option:
        raise HTTPException(status_code=400, detail="Option not found")
    score = 0
    if option["correct"]:
        score += 50
        score += 20
        score += 10
    if payload.reasoningId in {"safe", "escalate"}:
        score += 10
    if payload.secondsRemaining is None or payload.secondsRemaining > 0:
        score += 10
    final_score = clamp_score(score)
    completed_at = now_iso()
    started_at = (datetime.fromisoformat(completed_at) - timedelta(minutes=max(1, round(item["timerSeconds"] / 60)))).isoformat()
    report = build_report(
        activity_id=item["id"],
        activity_type="pressure-test",
        user_id=payload.userId,
        title=item["title"],
        score=final_score,
        topic_scores={item["topic"]: final_score},
        started_at=started_at,
        completed_at=completed_at,
        details={
            "decisionJourney": [
                {"prompt": item["scenario"], "selected": option["label"], "result": "Protected the control" if option["correct"] else "Control weakened under pressure"}
            ],
            "whatYouDidWell": ["Protected the required control under pressure."] if option["correct"] else [],
            "whatYouMissed": [] if option["correct"] else ["Pressure should have triggered escalation, not a shortcut."],
            "keyTakeaway": item["keyTakeaway"],
            "actions": ["Replay Pressure Test", "Try Another Test", "Return Home"],
        },
    )
    return report


@app.get("/api/coach/topics")
def coach_topics() -> list[dict]:
    return [
        {
            "id": topic["id"],
            "name": topic["name"],
            "plainName": topic["plainName"],
            "questionCount": len(topic["questions"]),
        }
        for topic in catalog["coachTopics"]
    ]


@app.get("/api/coach/questions")
def coach_questions(topicId: str | None = None) -> list[dict]:
    topics = catalog["coachTopics"]
    if topicId:
        topics = [topic for topic in topics if topic["id"] == topicId]
    questions = []
    for topic in topics:
        for question in topic["questions"]:
            questions.append({"topicId": topic["id"], "topicName": topic["plainName"], "id": question["id"], "question": question["question"]})
    return questions


@app.get("/api/coach/answers/{question_id}")
def coach_answer(question_id: str) -> dict:
    for topic in catalog["coachTopics"]:
        for question in topic["questions"]:
            if question["id"] == question_id:
                return {
                    "topicId": topic["id"],
                    "topicName": topic["plainName"],
                    "question": question["question"],
                    "answer": question["answer"],
                    "relatedQuestions": [entry["question"] for entry in topic["questions"] if entry["id"] != question_id][:3],
                }
    raise HTTPException(status_code=404, detail="Question not found")


@app.get("/api/coach/search")
def coach_search(query: str = Query(..., min_length=1)) -> list[dict]:
    term = query.lower()
    matches = []
    for topic in catalog["coachTopics"]:
        for question in topic["questions"]:
            text = " ".join(
                [
                    question["question"],
                    question["answer"]["simpleExplanation"],
                    question["answer"]["example"],
                    question["answer"]["commonMistake"],
                    question["answer"]["recommendedAction"],
                    question["answer"]["remember"],
                ]
            ).lower()
            if term in text:
                matches.append({"topicId": topic["id"], "topicName": topic["plainName"], "id": question["id"], "question": question["question"]})
    return matches[:15]


@app.get("/api/learning/{user_id}")
def learning(user_id: str) -> dict:
    require_user(user_id)
    return user_learning_snapshot(user_id)


@app.get("/api/learning/{user_id}/recommendations")
def learning_recommendations(user_id: str) -> list[dict]:
    return user_learning_snapshot(user_id)["recommendations"]


@app.get("/api/learning/{user_id}/activity")
def learning_activity(user_id: str) -> list[dict]:
    return user_learning_snapshot(user_id)["activityHistory"]


@app.get("/api/learning/{user_id}/badges")
def learning_badges(user_id: str) -> list[dict]:
    return user_learning_snapshot(user_id)["badges"]


@app.get("/api/library")
def library(
    userId: str = Query(...),
    topic: str | None = None,
    difficulty: str | None = None,
    trainingType: str | None = None,
    completed: bool | None = None,
    recommended: bool | None = None,
    search: str | None = None,
) -> list[dict]:
    require_user(userId)
    items = normalize_library_items(userId)
    if topic:
        items = [item for item in items if topic in item["topics"]]
    if difficulty:
        items = [item for item in items if item["difficulty"].lower() == difficulty.lower()]
    if trainingType:
        items = [item for item in items if item["type"] == trainingType]
    if completed is not None:
        items = [item for item in items if item["completed"] == completed]
    if recommended is not None:
        items = [item for item in items if item["recommended"] == recommended]
    if search:
        term = search.lower()
        items = [item for item in items if term in item["title"].lower() or term in item["description"].lower()]
    return items


@app.get("/api/manager/summary")
def manager_summary() -> dict:
    return manager_summary_payload()


@app.get("/api/manager/departments")
def manager_departments() -> list[dict]:
    return manager_departments_payload()


@app.get("/api/manager/heatmap")
def manager_heatmap() -> list[dict]:
    return manager_heatmap_payload()


@app.get("/api/manager/gaps")
def manager_gaps() -> list[dict]:
    return manager_gaps_payload()


@app.get("/api/manager/activities")
def manager_activities() -> dict:
    return manager_activity_payload()


@app.get("/api/settings/{user_id}")
def settings(user_id: str) -> dict:
    require_user(user_id)
    return get_settings(user_id)


@app.put("/api/settings/{user_id}")
def settings_update(user_id: str, payload: SettingsUpdateRequest) -> dict:
    require_user(user_id)
    return update_settings(user_id, payload.model_dump())


@app.post("/api/admin/reset-demo")
def admin_reset() -> dict:
    reset_demo_data()
    return {"status": "reset"}


if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="frontend-assets")


@app.get("/", include_in_schema=False)
def serve_frontend_root():
    index_file = FRONTEND_DIST / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found")
    return FileResponse(index_file)


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_app(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    requested_file = FRONTEND_DIST / full_path
    if full_path and requested_file.exists() and requested_file.is_file():
        return FileResponse(requested_file)

    index_file = FRONTEND_DIST / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found")
    return FileResponse(index_file)
