from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest

from backend.app.project_documents import LocalDocumentConnector, SourceDocument
from backend.app.project_service import ProjectConflictError, ProjectService, public_course


MANAGER = {"id": "manager-1", "isManager": True}
EMPLOYEE = {"id": "employee-1", "isManager": False}


class MemoryProjectStore:
    def __init__(self):
        self.project = {
            "id": "inovaare-onboarding",
            "name": "Revamped Knowledge Base",
            "description": "Source-grounded onboarding",
            "sourceSubpath": ".",
            "manifestHash": None,
            "lastSyncedAt": None,
            "documentCount": 0,
            "totalBytes": 0,
            "courses": [],
            "assignments": [],
            "documents": [],
        }
        self.documents = []
        self.attempt = None

    def list_projects(self, user_id, is_manager):
        return [deepcopy(self.project)]

    def get_project(self, project_id, user_id, is_manager):
        return deepcopy(self.project) if project_id == self.project["id"] else None

    def replace_documents(self, project_id, documents: tuple[SourceDocument, ...], manifest_hash):
        self.documents = [
            {
                "source_path": item.source_path,
                "content_hash": item.content_hash,
                "content": item.content,
                "size_bytes": item.size_bytes,
            }
            for item in documents
        ]
        self.project.update(
            manifestHash=manifest_hash,
            lastSyncedAt="2026-07-19T00:00:00+00:00",
            documentCount=len(documents),
            totalBytes=sum(item.size_bytes for item in documents),
        )
        return {
            "documentCount": len(documents),
            "manifestHash": manifest_hash,
            "syncedAt": self.project["lastSyncedAt"],
        }

    def get_documents(self, project_id):
        return deepcopy(self.documents)

    def create_course(self, course):
        existing = next((item for item in self.project["courses"] if item["id"] == course["id"]), None)
        if existing:
            return deepcopy(existing)
        stored = {**deepcopy(course), "status": "draft", "publishedBy": None, "publishedAt": None}
        self.project["courses"].insert(0, stored)
        return deepcopy(stored)

    def publish_course(self, project_id, course_id, published_by):
        course = next((item for item in self.project["courses"] if item["id"] == course_id), None)
        if not course or course["status"] != "draft":
            return None
        course.update(status="published", publishedBy=published_by, publishedAt="2026-07-19T01:00:00+00:00")
        return deepcopy(course)

    def assign_course(self, project_id, course_id, employee_ids, assigned_by):
        assignments = [
            {
                "id": f"assignment-{employee_id}",
                "projectId": project_id,
                "courseId": course_id,
                "employeeId": employee_id,
                "assignedBy": assigned_by,
                "status": "assigned",
            }
            for employee_id in employee_ids
        ]
        self.project["assignments"].extend(assignments)
        return deepcopy(assignments)

    def create_attempt(self, project_id, user_id):
        course = next(item for item in self.project["courses"] if item["status"] == "published")
        self.attempt = {
            "id": "attempt-1",
            "assignmentId": f"assignment-{user_id}",
            "projectId": project_id,
            "courseId": course["id"],
            "userId": user_id,
            "status": "in-progress",
            "answers": {},
            "score": None,
            "startedAt": "2026-07-19T01:00:00+00:00",
            "completedAt": None,
            "courseTitle": course["title"],
            "courseContent": deepcopy(course["content"]),
        }
        return deepcopy(self.attempt)

    def get_attempt(self, project_id, attempt_id, user_id):
        return deepcopy(self.attempt)

    def complete_attempt(self, attempt_id, answers, score, completed_at):
        self.attempt.update(status="completed", answers=answers, score=score, completedAt=completed_at)
        return deepcopy(self.attempt)


def _service(tmp_path: Path):
    (tmp_path / "CODE_WALKTHROUGH.md").write_text(
        "# Code Walkthrough\nThe retrieval pipeline enriches records before ranking results.", encoding="utf-8"
    )
    (tmp_path / "architecture").mkdir()
    (tmp_path / "architecture" / "overview.md").write_text(
        "# Architecture Overview\nServices use bounded requests and traceable source records.", encoding="utf-8"
    )
    (tmp_path / "concepts_seed.json").write_text("{}", encoding="utf-8")
    store = MemoryProjectStore()

    def completed_training(_user_id):
        return [{"status": "completed", "activityType": "simulation"}]

    return ProjectService(store, LocalDocumentConnector(tmp_path), completed_training), store


def test_sync_reports_inventory_and_generation_is_deterministic(tmp_path: Path):
    service, store = _service(tmp_path)

    sync = service.sync("inovaare-onboarding", MANAGER)
    first = service.generate_course("inovaare-onboarding", MANAGER)["course"]
    second = service.generate_course("inovaare-onboarding", MANAGER)["course"]

    assert sync["sourceSummary"]["documentCount"] == 2
    assert sync["sourceSummary"]["skippedUnsupported"] == 1
    assert sync["sourceSummary"]["totalBytes"] > 0
    assert first["id"] == second["id"]
    assert first["content"] == second["content"]
    assert first["sourceManifest"]["documents"][0]["sourcePath"] == "CODE_WALKTHROUGH.md"
    assert first["status"] == "draft"
    assert store.project["courses"][0]["status"] == "draft"


def test_publish_assign_attempt_and_submit_records_completion(tmp_path: Path, monkeypatch):
    service, store = _service(tmp_path)
    service.sync("inovaare-onboarding", MANAGER)
    course = service.generate_course("inovaare-onboarding", MANAGER)["course"]
    service.publish_course("inovaare-onboarding", course["id"], MANAGER)
    next_draft = service.generate_course("inovaare-onboarding", MANAGER)["course"]
    assignment = service.assign("inovaare-onboarding", [EMPLOYEE["id"]], MANAGER)
    started = service.start_attempt("inovaare-onboarding", EMPLOYEE)["attempt"]
    captured = []
    monkeypatch.setattr("backend.app.project_service.record_completed_attempt", captured.append)
    original = next(item for item in store.project["courses"] if item["id"] == course["id"])
    answers = {
        question["id"]: question["correctOptionId"]
        for question in original["content"]["test"]["questions"]
    }

    result = service.submit_attempt("inovaare-onboarding", started["id"], EMPLOYEE, answers)

    assert assignment["assignedCount"] == 1
    assert next_draft["status"] == "draft"
    assert next_draft["id"] != course["id"]
    assert all("correctOptionId" not in question for question in started["courseContent"]["test"]["questions"])
    assert result["score"] == 100
    assert captured[0]["activityType"] == "project-course"
    assert captured[0]["topicScores"] == {}
    assert captured[0]["details"]["projectAttemptId"] == "attempt-1"


def test_public_course_does_not_mutate_review_copy():
    course = {"content": {"test": {"questions": [{"correctOptionId": "a", "explanation": "because"}]}}}

    employee_copy = public_course(course)

    assert "correctOptionId" not in employee_copy["content"]["test"]["questions"][0]
    assert course["content"]["test"]["questions"][0]["correctOptionId"] == "a"


def test_attempt_requires_standard_training_completion(tmp_path: Path):
    service, store = _service(tmp_path)
    service.eligibility_checker = lambda _user_id: [
        {"status": "completed", "activityType": "project-course"},
        {"status": "in-progress", "activityType": "simulation"},
    ]

    with pytest.raises(ProjectConflictError, match="standard training"):
        service.start_attempt("inovaare-onboarding", EMPLOYEE)


def test_submission_rejects_incomplete_answers(tmp_path: Path):
    service, store = _service(tmp_path)
    service.sync("inovaare-onboarding", MANAGER)
    course = service.generate_course("inovaare-onboarding", MANAGER)["course"]
    service.publish_course("inovaare-onboarding", course["id"], MANAGER)
    service.assign("inovaare-onboarding", [EMPLOYEE["id"]], MANAGER)
    started = service.start_attempt("inovaare-onboarding", EMPLOYEE)["attempt"]

    with pytest.raises(ProjectConflictError, match="unanswered"):
        service.submit_attempt("inovaare-onboarding", started["id"], EMPLOYEE, {})

    assert store.attempt["status"] == "in-progress"


def test_stale_course_cannot_be_published_or_assigned_after_source_changes(tmp_path: Path):
    service, store = _service(tmp_path)
    service.sync("inovaare-onboarding", MANAGER)
    course = service.generate_course("inovaare-onboarding", MANAGER)["course"]
    original_manifest = store.project["manifestHash"]

    store.project["manifestHash"] = "new-source-manifest"
    with pytest.raises(ProjectConflictError, match="currently synchronized"):
        service.publish_course("inovaare-onboarding", course["id"], MANAGER)

    store.project["manifestHash"] = original_manifest
    service.publish_course("inovaare-onboarding", course["id"], MANAGER)
    store.project["manifestHash"] = "new-source-manifest"
    with pytest.raises(ProjectConflictError, match="currently synchronized"):
        service.assign("inovaare-onboarding", [EMPLOYEE["id"]], MANAGER)
