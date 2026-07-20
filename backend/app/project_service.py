from __future__ import annotations

import hashlib
import inspect
import re
import uuid
from copy import deepcopy
from collections.abc import Callable
from pathlib import PurePosixPath
from typing import Any

from .db import list_attempts, now_iso, performance_label, record_completed_attempt
from .project_documents import DocumentConnector, SourceDocument
from .project_store import ProjectStore


class ProjectNotFoundError(LookupError):
    pass


class ProjectConflictError(ValueError):
    pass


class ProjectSourceConfigError(ValueError):
    pass


ConnectorResolver = Callable[[str, dict], DocumentConnector]

_SOURCE_TYPE_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
_SOURCE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$")
_SECRET_CONFIG_KEYS = {
    "apikey",
    "authorization",
    "credential",
    "credentials",
    "password",
    "privatekey",
    "secret",
    "token",
}

_MANAGER_ONLY_PROJECT_KEYS = {
    "config",
    "connectorType",
    "documents",
    "sourceConfig",
    "sourceSubpath",
    "sources",
}


def _employee_project(project: dict) -> dict:
    """Remove connector locations, credential references, and document inventory."""
    safe = deepcopy(project)
    for key in _MANAGER_ONLY_PROJECT_KEYS:
        safe.pop(key, None)
    return safe


def _validated_source(source_type: str, source_config: dict) -> tuple[str, dict]:
    normalized_type = source_type.strip().lower()
    if not _SOURCE_TYPE_PATTERN.fullmatch(normalized_type):
        raise ProjectSourceConfigError("Source type is invalid")
    if not isinstance(source_config, dict):
        raise ProjectSourceConfigError("Source configuration must be an object")

    def reject_secrets(value: Any) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                normalized_key = re.sub(r"[^a-z0-9]", "", str(key).lower())
                if normalized_key != "tokenenvvar" and (
                    normalized_key in _SECRET_CONFIG_KEYS
                    or normalized_key.endswith("token")
                    or normalized_key.endswith("password")
                    or normalized_key.endswith("secret")
                    or normalized_key.endswith("apikey")
                ):
                    raise ProjectSourceConfigError(
                        "Source credentials cannot be stored; configure tokenEnvVar instead"
                    )
                reject_secrets(nested)
        elif isinstance(value, list):
            for nested in value:
                reject_secrets(nested)

    reject_secrets(source_config)
    return normalized_type, deepcopy(source_config)


def _validated_source_name(name: str) -> str:
    normalized = name.strip() if isinstance(name, str) else ""
    if not _SOURCE_NAME_PATTERN.fullmatch(normalized):
        raise ProjectSourceConfigError(
            "Source name must start with a letter or number and use only letters, numbers, spaces, '.', '_' or '-'"
        )
    return normalized


def _source_subpath(source_type: str, source_config: dict, fallback: str = ".") -> str:
    value = source_config.get("sourceSubpath", fallback) if source_type == "local" else "."
    if not isinstance(value, str):
        raise ProjectSourceConfigError("Source subpath must be a relative path")
    normalized = value.strip().replace("\\", "/")
    path = PurePosixPath(normalized)
    if (
        not normalized
        or normalized.startswith("/")
        or ".." in path.parts
        or any(character in normalized for character in "*?[]{}")
    ):
        raise ProjectSourceConfigError("Source subpath must be a safe relative path")
    return normalized


def _plain_text(content: str) -> str:
    content = re.sub(r"```.*?```", " ", content, flags=re.DOTALL)
    content = re.sub(r"[>#*_`|\[\](){}]", " ", content)
    return re.sub(r"\s+", " ", content).strip()


def _excerpt(content: str, limit: int = 360) -> str:
    plain = _plain_text(content)
    if len(plain) <= limit:
        return plain
    boundary = plain.rfind(". ", 0, limit)
    return plain[: boundary + 1 if boundary > 100 else limit].strip()


def _title(source_path: str, content: str) -> str:
    heading = re.search(r"^\s*#\s+(.+?)\s*$", content, flags=re.MULTILINE)
    if heading:
        return heading.group(1).strip()
    stem = source_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return stem.replace("-", " ").replace("_", " ").title()


def public_course(course: dict) -> dict:
    """Remove answer keys from a course delivered to an employee."""
    result = deepcopy(course)
    questions = result.get("content", {}).get("test", {}).get("questions", [])
    for question in questions:
        question.pop("correctOptionId", None)
        question.pop("explanation", None)
    return result


class ProjectService:
    def __init__(
        self,
        store: ProjectStore,
        connector: DocumentConnector | None = None,
        eligibility_checker: Callable[[str], list[dict]] = list_attempts,
        *,
        connector_resolver: ConnectorResolver | None = None,
    ) -> None:
        if connector_resolver is None:
            if connector is None:
                raise TypeError("A connector or connector_resolver is required")
            if callable(connector) and not hasattr(connector, "scan"):
                connector_resolver = connector
            else:
                def fixed_connector(
                    _source_type: str, _source_config: dict
                ) -> DocumentConnector:
                    return connector

                connector_resolver = fixed_connector
        self.store = store
        self.connector = connector
        self.connector_resolver = connector_resolver
        self.eligibility_checker = eligibility_checker

    def list_projects(self, user: dict) -> list[dict]:
        projects = self.store.list_projects(user["id"], user["isManager"])
        if user["isManager"]:
            return projects
        return [_employee_project(project) for project in projects]

    def get_project(self, project_id: str, user: dict) -> dict:
        project = self.store.get_project(project_id, user["id"], user["isManager"])
        if not project:
            raise ProjectNotFoundError("Project not found")
        if not user["isManager"]:
            project = deepcopy(project)
            project["courses"] = [public_course(course) for course in project.get("courses", [])]
        sources = project.get("sources")
        if sources is None:
            list_sources = getattr(self.store, "list_sources", None)
            if callable(list_sources):
                sources = list_sources(project_id)
            else:
                legacy_type = project.get("sourceType", "local")
                legacy_config = deepcopy(project.get("sourceConfig", {}))
                if legacy_type == "local" and "sourceSubpath" not in legacy_config:
                    legacy_config["sourceSubpath"] = project.get("sourceSubpath", ".")
                sources = [
                    {
                        "id": "primary",
                        "projectId": project_id,
                        "name": "Primary",
                        "connectorType": legacy_type,
                        "config": legacy_config,
                        "enabled": True,
                    }
                ]
        project["sources"] = sources
        if sources:
            primary = sources[0]
            project["sourceType"] = primary["connectorType"]
            project["sourceConfig"] = deepcopy(primary.get("config", {}))
            project["sourceSubpath"] = project["sourceConfig"].get(
                "sourceSubpath", project.get("sourceSubpath", ".")
            )
        project["sourceSummary"] = {
            "documentCount": project.get("documentCount", 0),
            "totalBytes": project.get("totalBytes", 0),
            "digest": project.get("manifestHash"),
            "lastSyncedAt": project.get("lastSyncedAt"),
        }
        return project if user["isManager"] else _employee_project(project)

    @staticmethod
    def _source_summary(source: dict, scan) -> dict:
        return {
            "sourceId": source["id"],
            "sourceName": source["name"],
            "connectorType": source["connectorType"],
            "documentCount": len(scan.documents),
            "totalBytes": sum(document.size_bytes for document in scan.documents),
            "digest": scan.manifest_hash,
            "skippedUnsupported": scan.skipped_unsupported,
            "rejectedCount": len(scan.rejected),
            "rejected": [
                {"sourcePath": item.source_path, "reason": item.reason}
                for item in scan.rejected
            ],
        }

    def _scan_source(self, source: dict):
        source_type, config = _validated_source(
            source["connectorType"], source.get("config", {})
        )
        connector = self.connector_resolver(source_type, config)
        return connector.scan(_source_subpath(source_type, config))

    @staticmethod
    def _documents_for_source(source: dict, scan, prefix: bool) -> tuple[SourceDocument, ...]:
        prefix_value = f'{source["name"]}/' if prefix else ""
        return tuple(
            SourceDocument(
                source_path=f"{prefix_value}{item.source_path}",
                content_hash=item.content_hash,
                content=item.content,
                size_bytes=item.size_bytes,
                source_url=item.source_url,
                revision=item.revision,
            )
            for item in scan.documents
        )

    def _replace_all_documents(
        self,
        project_id: str,
        documents: tuple[SourceDocument, ...],
        manifest_hash: str,
        metadata: dict[str, dict],
    ) -> dict:
        replace = self.store.replace_documents
        parameters = inspect.signature(replace).parameters.values()
        supports_metadata = any(
            item.name == "source_metadata" or item.kind == inspect.Parameter.VAR_KEYWORD
            for item in parameters
        )
        if supports_metadata:
            return replace(project_id, documents, manifest_hash, source_metadata=metadata)
        return replace(project_id, documents, manifest_hash)

    def sync(self, project_id: str, manager: dict) -> dict:
        project = self.get_project(project_id, manager)
        enabled_sources = [source for source in project["sources"] if source.get("enabled", True)]
        if not enabled_sources:
            raise ProjectConflictError("Enable at least one project source before syncing")

        # Do not write until every connector has completed successfully.
        scans = [(source, self._scan_source(source)) for source in enabled_sources]
        use_prefix = len(enabled_sources) > 1
        documents: list[SourceDocument] = []
        metadata: dict[str, dict] = {}
        summaries = []
        for source, scan in scans:
            source_documents = self._documents_for_source(source, scan, use_prefix)
            documents.extend(source_documents)
            for document in source_documents:
                if document.source_path in metadata:
                    raise ProjectConflictError(
                        f"Sources produce the same document path: {document.source_path}"
                    )
                metadata[document.source_path] = {
                    "sourceId": source["id"],
                    "sourceName": source["name"],
                }
            summaries.append(self._source_summary(source, scan))

        manifest = hashlib.sha256()
        for source, scan in scans:
            manifest.update(f'{source["id"]}:{scan.manifest_hash}\n'.encode("utf-8"))
        source = self._replace_all_documents(
            project_id, tuple(documents), manifest.hexdigest(), metadata
        )
        for summary in summaries:
            summary.update(status="synced", lastSyncedAt=source["syncedAt"])
        total_bytes = sum(document.size_bytes for document in documents)
        skipped = sum(summary["skippedUnsupported"] for summary in summaries)
        rejected_count = sum(summary["rejectedCount"] for summary in summaries)
        return {
            "projectId": project_id,
            "status": "synced",
            "sourceSummary": {
                "documentCount": source["documentCount"],
                "totalBytes": total_bytes,
                "digest": source["manifestHash"],
                "lastSyncedAt": source["syncedAt"],
                "skippedUnsupported": skipped,
                "rejectedCount": rejected_count,
            },
            "sources": summaries,
            "rejected": [
                {
                    **item,
                    "sourceId": summary["sourceId"],
                    "sourceName": summary["sourceName"],
                }
                for summary in summaries
                for item in summary["rejected"]
            ],
        }

    def list_sources(self, project_id: str, manager: dict) -> list[dict]:
        return deepcopy(self.get_project(project_id, manager)["sources"])

    def create_source(
        self, project_id: str, name: str, connector_type: str, config: dict, manager: dict
    ) -> dict:
        project = self.get_project(project_id, manager)
        safe_name = _validated_source_name(name)
        if any(item["name"] == safe_name for item in project["sources"]):
            raise ProjectConflictError("A project source with this name already exists")
        safe_type, safe_config = _validated_source(connector_type, config)
        _source_subpath(safe_type, safe_config)
        self.connector_resolver(safe_type, safe_config)
        source = self.store.create_source(project_id, safe_name, safe_type, safe_config)
        if not source:
            raise ProjectNotFoundError("Project not found")
        return {"projectId": project_id, "status": "created", "source": source}

    def update_named_source(
        self, project_id: str, source_id: str, changes: dict, manager: dict
    ) -> dict:
        project = self.get_project(project_id, manager)
        current = next((item for item in project["sources"] if item["id"] == source_id), None)
        if not current:
            raise ProjectNotFoundError("Project source not found")
        safe_name = _validated_source_name(changes.get("name", current["name"]))
        if any(item["id"] != source_id and item["name"] == safe_name for item in project["sources"]):
            raise ProjectConflictError("A project source with this name already exists")
        safe_type, safe_config = _validated_source(
            changes.get("connectorType", current["connectorType"]),
            changes.get("config", current.get("config", {})),
        )
        _source_subpath(safe_type, safe_config)
        self.connector_resolver(safe_type, safe_config)
        enabled = changes.get("enabled", current.get("enabled", True))
        if not isinstance(enabled, bool):
            raise ProjectSourceConfigError("Source enabled must be a boolean")
        source = self.store.update_project_source(
            project_id,
            source_id,
            {"name": safe_name, "connectorType": safe_type, "config": safe_config, "enabled": enabled},
        )
        if not source:
            raise ProjectNotFoundError("Project source not found")
        return {"projectId": project_id, "status": "updated", "source": source}

    def delete_named_source(self, project_id: str, source_id: str, manager: dict) -> dict:
        project = self.get_project(project_id, manager)
        if not any(item["id"] == source_id for item in project["sources"]):
            raise ProjectNotFoundError("Project source not found")
        if not self.store.delete_source(project_id, source_id):
            raise ProjectNotFoundError("Project source not found")
        return {"projectId": project_id, "sourceId": source_id, "status": "deleted"}

    def sync_named_source(self, project_id: str, source_id: str, manager: dict) -> dict:
        project = self.get_project(project_id, manager)
        source = next((item for item in project["sources"] if item["id"] == source_id), None)
        if not source:
            raise ProjectNotFoundError("Project source not found")
        if not source.get("enabled", True):
            raise ProjectConflictError("Enable the project source before syncing")
        scan = self._scan_source(source)
        enabled_sources = [
            item for item in project["sources"] if item.get("enabled", True)
        ]
        documents = self._documents_for_source(source, scan, len(enabled_sources) > 1)
        replace_source = getattr(self.store, "replace_source_documents", None)
        if callable(replace_source):
            parameters = inspect.signature(replace_source).parameters.values()
            supports_update_manifest = any(
                item.name == "update_manifest"
                or item.kind == inspect.Parameter.VAR_KEYWORD
                for item in parameters
            )
            if supports_update_manifest:
                stored = replace_source(
                    project_id,
                    source_id,
                    source["name"],
                    documents,
                    update_manifest=len(enabled_sources) == 1,
                )
            else:
                stored = replace_source(project_id, source_id, source["name"], documents)
        elif len(project["sources"]) == 1:
            stored = self._replace_all_documents(
                project_id,
                documents,
                scan.manifest_hash,
                {item.source_path: {"sourceId": source_id, "sourceName": source["name"]} for item in documents},
            )
        else:
            raise ProjectConflictError("The project store does not support per-source sync")
        summary = self._source_summary(source, scan)
        summary["lastSyncedAt"] = stored["syncedAt"]
        return {"projectId": project_id, "status": "synced", "source": summary}

    def update_source(
        self,
        project_id: str,
        source_type: str,
        source_config: dict,
        manager: dict,
    ) -> dict:
        self.get_project(project_id, manager)
        safe_type, safe_config = _validated_source(source_type, source_config)
        _source_subpath(safe_type, safe_config)
        # Constructing validates connector-specific fields without making a
        # network request. Invalid settings must not replace a working source.
        self.connector_resolver(safe_type, safe_config)
        updated = self.store.update_source(project_id, safe_type, safe_config)
        if not updated:
            raise ProjectNotFoundError("Project not found")
        return {
            "projectId": project_id,
            "status": "updated",
            "sourceType": updated["sourceType"],
            "sourceConfig": updated["sourceConfig"],
            "sourceSummary": {
                "documentCount": updated.get("documentCount", 0),
                "totalBytes": updated.get("totalBytes", 0),
                "digest": updated.get("manifestHash"),
                "lastSyncedAt": updated.get("lastSyncedAt"),
            },
        }

    def test_source(
        self,
        project_id: str,
        manager: dict,
        source_type: str | None = None,
        source_config: dict | None = None,
    ) -> dict:
        project = self.get_project(project_id, manager)
        safe_type, safe_config = _validated_source(
            source_type if source_type is not None else project.get("sourceType", "local"),
            source_config if source_config is not None else project.get("sourceConfig", {}),
        )
        connector = self.connector_resolver(safe_type, safe_config)
        source_subpath = _source_subpath(
            safe_type,
            safe_config,
            project.get("sourceSubpath", "."),
        )
        test_connection = getattr(connector, "test_connection", None)
        if callable(test_connection):
            tested = test_connection(source_subpath)
            if hasattr(tested, "ok"):
                ok = bool(tested.ok)
                message = str(tested.message)
                details = {"ok": ok, "message": message}
            elif isinstance(tested, dict):
                details = tested
                ok = bool(tested.get("ok", tested.get("success", True)))
                message = str(tested.get("message", "Connection test completed"))
            else:
                ok = bool(tested)
                message = "Connection test completed"
                details = {"result": tested}
        else:
            scan = connector.scan(source_subpath)
            ok = True
            message = "Source is readable"
            details = {
                "documentCount": len(scan.documents),
                "skippedUnsupported": scan.skipped_unsupported,
                "rejectedCount": len(scan.rejected),
            }
        return {
            "projectId": project_id,
            "status": "connected" if ok else "unavailable",
            "ok": ok,
            "message": message,
            "sourceType": safe_type,
            "details": details,
        }

    def test_named_source(self, project_id: str, source_id: str, manager: dict) -> dict:
        project = self.get_project(project_id, manager)
        source = next((item for item in project["sources"] if item["id"] == source_id), None)
        if not source:
            raise ProjectNotFoundError("Project source not found")
        result = self.test_source(
            project_id, manager, source["connectorType"], source.get("config", {})
        )
        result.update(sourceId=source_id, sourceName=source["name"])
        return result

    @staticmethod
    def _ordered_documents(documents: list[dict]) -> list[dict]:
        priorities = {
            "CODE_WALKTHROUGH.md": 0,
            "analysis.md": 1,
            "architecture/overview.md": 2,
            "architecture/operational-runbook.md": 3,
            "kt-retrieval-enrichment-pipeline.md": 4,
        }
        return sorted(documents, key=lambda item: (priorities.get(item["source_path"], 99), item["source_path"]))

    def generate_course(self, project_id: str, manager: dict) -> dict:
        project = self.get_project(project_id, manager)
        if not project.get("manifestHash"):
            raise ProjectConflictError("Sync source documents before generating a course")
        documents = self._ordered_documents(self.store.get_documents(project_id))
        if not documents:
            raise ProjectConflictError("Sync source documents before generating a course")

        manifest = []
        for item in documents:
            reference = {
                "sourcePath": item["source_path"],
                "contentHash": item["content_hash"],
            }
            if item.get("source_url"):
                reference["sourceUrl"] = item["source_url"]
            if item.get("revision"):
                reference["revision"] = item["revision"]
            if item.get("source_id"):
                reference["sourceId"] = item["source_id"]
            if item.get("source_name"):
                reference["sourceName"] = item["source_name"]
            manifest.append(reference)
        manifest_digest = hashlib.sha256(
            "\n".join(f"{item['sourcePath']}:{item['contentHash']}" for item in manifest).encode("utf-8")
        ).hexdigest()
        selected = [item for item in documents if _plain_text(item["content"])][:5]
        if not selected:
            raise ProjectConflictError("Synced documents do not contain usable text")
        lessons = []
        questions = []
        for index, document in enumerate(selected, start=1):
            source_reference = {
                "sourcePath": document["source_path"],
                "contentHash": document["content_hash"],
            }
            if document.get("source_url"):
                source_reference["sourceUrl"] = document["source_url"]
            if document.get("revision"):
                source_reference["revision"] = document["revision"]
            if document.get("source_id"):
                source_reference["sourceId"] = document["source_id"]
            if document.get("source_name"):
                source_reference["sourceName"] = document["source_name"]
            body = _excerpt(document["content"])
            lesson_title = _title(document["source_path"], document["content"])
            lessons.append(
                {
                    "id": f"lesson-{index}",
                    "title": lesson_title,
                    "body": body,
                    "sourceReferences": [source_reference],
                }
            )
            correct_id = f"q{index}-supported"
            questions.append(
                {
                    "id": f"question-{index}",
                    "prompt": f"Which statement is directly supported by {document['source_path']}?",
                    "options": [
                        {"id": correct_id, "text": body[:220]},
                        {"id": f"q{index}-manual", "text": "The workflow requires every result to be entered manually."},
                        {"id": f"q{index}-bypass", "text": "Production controls can be bypassed when a request is urgent."},
                    ],
                    "correctOptionId": correct_id,
                    "explanation": f"The supported statement is derived from {document['source_path']}.",
                    "sourceReference": source_reference,
                }
            )

        published_revisions = sum(
            1
            for item in project.get("courses", [])
            if item["status"] == "published"
            and item.get("sourceManifest", {}).get("digest") == manifest_digest
        )
        course_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"project-course:{project_id}:{manifest_digest}:revision:{published_revisions}",
            )
        )
        course = self.store.create_course(
            {
                "id": course_id,
                "projectId": project_id,
                "title": f"{project['name']} Onboarding",
                "content": {
                    "summary": f"A source-grounded introduction to {project['name']}.",
                    "estimatedMinutes": max(10, len(lessons) * 5),
                    "lessons": lessons,
                    "test": {"passingScore": 70, "questions": questions},
                },
                "sourceManifest": {
                    "digest": manifest_digest,
                    "sourceSyncDigest": project["manifestHash"],
                    "documents": manifest,
                },
                "generatedBy": manager["id"],
                "createdAt": now_iso(),
            }
        )
        return {"projectId": project_id, "status": course["status"], "course": course}

    def publish_course(self, project_id: str, course_id: str, manager: dict) -> dict:
        project = self.get_project(project_id, manager)
        course_to_publish = next(
            (course for course in project.get("courses", []) if course["id"] == course_id),
            None,
        )
        if (
            not course_to_publish
            or course_to_publish.get("sourceManifest", {}).get("sourceSyncDigest")
            != project.get("manifestHash")
        ):
            raise ProjectConflictError(
                "Generate a new course from the currently synchronized source before publishing"
            )
        course = self.store.publish_course(project_id, course_id, manager["id"])
        if not course:
            raise ProjectConflictError("Only a draft course can be published")
        return {"projectId": project_id, "status": "published", "course": course}

    def assign(self, project_id: str, employee_ids: list[str], manager: dict) -> dict:
        project = self.get_project(project_id, manager)
        published = [
            course
            for course in project.get("courses", [])
            if course["status"] == "published"
            and course.get("sourceManifest", {}).get("sourceSyncDigest")
            == project.get("manifestHash")
        ]
        if not published:
            raise ProjectConflictError(
                "Publish a course generated from the currently synchronized source before assigning employees"
            )
        course = published[0]
        assignments = self.store.assign_course(project_id, course["id"], employee_ids, manager["id"])
        return {
            "projectId": project_id,
            "courseId": course["id"],
            "assignedCount": len(assignments),
            "assignments": assignments,
        }

    def start_attempt(self, project_id: str, employee: dict) -> dict:
        standard_completions = [
            attempt
            for attempt in self.eligibility_checker(employee["id"])
            if attempt.get("status") == "completed" and attempt.get("activityType") != "project-course"
        ]
        if not standard_completions:
            raise ProjectConflictError(
                "Complete at least one standard training activity before starting project onboarding"
            )
        attempt = self.store.create_attempt(project_id, employee["id"])
        if not attempt:
            raise ProjectConflictError("No active published-course assignment was found")
        result = deepcopy(attempt)
        result["courseContent"] = public_course({"content": result["courseContent"]})["content"]
        return {"projectId": project_id, "attempt": result}

    def submit_attempt(self, project_id: str, attempt_id: str, employee: dict, answers: dict[str, str]) -> dict:
        attempt = self.store.get_attempt(project_id, attempt_id, employee["id"])
        if not attempt:
            raise ProjectNotFoundError("Attempt not found")
        if attempt["status"] != "in-progress":
            raise ProjectConflictError("Attempt has already been submitted")
        questions = attempt["courseContent"].get("test", {}).get("questions", [])
        expected_ids = {question["id"] for question in questions}
        provided_ids = set(answers)
        missing_ids = expected_ids - provided_ids
        unknown_ids = provided_ids - expected_ids
        if missing_ids:
            raise ProjectConflictError(f"Answer every question before submitting ({len(missing_ids)} unanswered)")
        if unknown_ids:
            raise ProjectConflictError("Submission contains unknown question answers")
        for question in questions:
            option_ids = {option["id"] for option in question.get("options", [])}
            if answers[question["id"]] not in option_ids:
                raise ProjectConflictError(f"Invalid answer for {question['id']}")
        correct = sum(1 for question in questions if answers.get(question["id"]) == question["correctOptionId"])
        score = round((correct / max(1, len(questions))) * 100)
        completed_at = now_iso()
        completed = self.store.complete_attempt(attempt_id, answers, score, completed_at)
        label = performance_label(score)
        xp_awarded = 100 if score == 100 else 50
        record_completed_attempt(
            {
                "userId": employee["id"],
                "activityId": attempt["courseId"],
                "activityType": "project-course",
                "activityTitle": attempt["courseTitle"],
                "score": score,
                "performanceLabel": label,
                "xpAwarded": xp_awarded,
                "topicScores": {},
                "details": {
                    "projectId": project_id,
                    "projectAttemptId": attempt_id,
                    "correctAnswers": correct,
                    "questionCount": len(questions),
                },
                "pathSignature": f"{attempt['courseId']}:{attempt_id}",
                "durationSeconds": 0,
                "startedAt": attempt["startedAt"],
                "completedAt": completed_at,
            }
        )
        return {
            "projectId": project_id,
            "attemptId": completed["id"],
            "status": "completed",
            "score": score,
            "performanceLabel": label,
            "correctAnswers": correct,
            "questionCount": len(questions),
            "xpAwarded": xp_awarded,
            "completedAt": completed_at,
        }
