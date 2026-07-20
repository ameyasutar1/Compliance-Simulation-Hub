from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Query
from pydantic import AliasChoices, BaseModel, Field

from .db import get_user
from .project_documents import DocumentIngestionError
from .project_service import (
    ProjectConflictError,
    ProjectNotFoundError,
    ProjectService,
    ProjectSourceConfigError,
)
from .project_store import PostgresProjectStore


router = APIRouter(prefix="/api/projects", tags=["projects"])
connector_router = APIRouter(prefix="/api/project-connectors", tags=["project-connectors"])


class UserRequest(BaseModel):
    userId: str


class AssignmentRequest(UserRequest):
    employeeIds: list[str] = Field(min_length=1)


class SubmissionRequest(UserRequest):
    answers: dict[str, str]


class SourceUpdateRequest(UserRequest):
    connectorType: str = Field(
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("connectorType", "sourceType"),
    )
    config: dict = Field(
        default_factory=dict,
        validation_alias=AliasChoices("config", "sourceConfig"),
    )


class SourceTestRequest(UserRequest):
    connectorType: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("connectorType", "sourceType"),
    )


class SourceCreateRequest(UserRequest):
    name: str = Field(min_length=1, max_length=120)
    connectorType: str = Field(min_length=1, max_length=64)
    config: dict = Field(default_factory=dict)


class SourceUpdateByIdRequest(UserRequest):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    connectorType: str | None = Field(default=None, min_length=1, max_length=64)
    enabled: bool | None = None
    config: dict | None = Field(
        default=None,
        validation_alias=AliasChoices("config", "sourceConfig"),
    )


def _resolve_connector(source_type: str, source_config: dict):
    # Kept at the API composition boundary so the connector package can evolve
    # without coupling project persistence and orchestration to its internals.
    from .connectors import ConnectorConfigurationError, create_connector

    connector_config = dict(source_config)
    if source_type == "local":
        unknown = sorted(set(connector_config) - {"sourceSubpath"})
        if unknown:
            raise ProjectSourceConfigError(
                f"Unknown local source configuration: {', '.join(unknown)}"
            )
        connector_config.pop("sourceSubpath", None)
        configured_root = os.getenv("PROJECT_DOCS_ROOT")
        if configured_root:
            connector_config["root"] = configured_root
    elif source_type == "github":
        allowed = {"repository", "ref", "includePaths", "excludePaths", "tokenEnvVar"}
        unknown = sorted(set(connector_config) - allowed)
        if unknown:
            raise ProjectSourceConfigError(
                f"Unknown GitHub source configuration: {', '.join(unknown)}"
            )
        repository = connector_config.pop("repository", None)
        if repository:
            if "://" in repository:
                connector_config["repositoryUrl"] = repository
            else:
                owner, separator, repo = repository.partition("/")
                if not separator or not owner or not repo or "/" in repo:
                    raise ProjectSourceConfigError(
                        "GitHub repository must be an owner/repository pair or URL"
                    )
                connector_config.update(owner=owner, repo=repo)
        if "includePaths" in connector_config:
            connector_config["include"] = connector_config.pop("includePaths")
        if "excludePaths" in connector_config:
            connector_config["exclude"] = connector_config.pop("excludePaths")
    try:
        return create_connector(source_type, connector_config)
    except ConnectorConfigurationError as exc:
        raise ProjectSourceConfigError(str(exc)) from exc


_service = ProjectService(PostgresProjectStore(), connector_resolver=_resolve_connector)


def _require_user(user_id: str) -> dict:
    user = get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _require_manager(user_id: str) -> dict:
    user = _require_user(user_id)
    if not user["isManager"]:
        raise HTTPException(status_code=403, detail="Manager access is required")
    return user


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ProjectNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, DocumentIngestionError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, ProjectSourceConfigError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, (ProjectConflictError, ValueError)):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=500, detail="Project operation failed")


@connector_router.get("")
def list_project_connectors(userId: str = Query(...)) -> dict:
    _require_manager(userId)
    from .connectors import connector_descriptors

    connectors = list(connector_descriptors())
    return {"connectors": connectors, "count": len(connectors)}


@router.get("")
def list_projects(userId: str = Query(...)) -> dict:
    user = _require_user(userId)
    projects = _service.list_projects(user)
    return {"projects": projects, "count": len(projects)}


@router.get("/{project_id}")
def project_detail(project_id: str, userId: str = Query(...)) -> dict:
    user = _require_user(userId)
    try:
        return _service.get_project(project_id, user)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/{project_id}/sources")
def list_project_sources(project_id: str, userId: str = Query(...)) -> dict:
    manager = _require_manager(userId)
    try:
        sources = _service.list_sources(project_id, manager)
        return {"projectId": project_id, "sources": sources, "count": len(sources)}
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/sources", status_code=201)
def create_project_source(project_id: str, payload: SourceCreateRequest) -> dict:
    manager = _require_manager(payload.userId)
    try:
        return _service.create_source(
            project_id, payload.name, payload.connectorType, payload.config, manager
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.put("/{project_id}/sources/{source_id}")
def update_project_source_by_id(
    project_id: str, source_id: str, payload: SourceUpdateByIdRequest
) -> dict:
    manager = _require_manager(payload.userId)
    changes = payload.model_dump(exclude_unset=True, exclude={"userId"})
    try:
        return _service.update_named_source(project_id, source_id, changes, manager)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.delete("/{project_id}/sources/{source_id}")
def delete_project_source(
    project_id: str, source_id: str, userId: str = Query(...)
) -> dict:
    manager = _require_manager(userId)
    try:
        return _service.delete_named_source(project_id, source_id, manager)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/sources/{source_id}/test")
def test_project_source_by_id(
    project_id: str, source_id: str, payload: UserRequest
) -> dict:
    manager = _require_manager(payload.userId)
    try:
        return _service.test_named_source(project_id, source_id, manager)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/sources/{source_id}/sync")
def sync_project_source_by_id(
    project_id: str, source_id: str, payload: UserRequest
) -> dict:
    manager = _require_manager(payload.userId)
    try:
        return _service.sync_named_source(project_id, source_id, manager)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/sync")
def sync_project(project_id: str, payload: UserRequest) -> dict:
    manager = _require_manager(payload.userId)
    try:
        return _service.sync(project_id, manager)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.put("/{project_id}/source")
def update_project_source(project_id: str, payload: SourceUpdateRequest) -> dict:
    manager = _require_manager(payload.userId)
    try:
        return _service.update_source(
            project_id,
            payload.connectorType,
            payload.config,
            manager,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/source/test")
def test_project_source(project_id: str, payload: SourceTestRequest) -> dict:
    manager = _require_manager(payload.userId)
    try:
        return _service.test_source(
            project_id,
            manager,
            payload.connectorType,
            payload.config,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/courses/generate")
def generate_project_course(project_id: str, payload: UserRequest) -> dict:
    manager = _require_manager(payload.userId)
    try:
        return _service.generate_course(project_id, manager)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/courses/{course_id}/publish")
def publish_project_course(project_id: str, course_id: str, payload: UserRequest) -> dict:
    manager = _require_manager(payload.userId)
    try:
        return _service.publish_course(project_id, course_id, manager)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/assignments")
def assign_project_course(project_id: str, payload: AssignmentRequest) -> dict:
    manager = _require_manager(payload.userId)
    employee_ids = list(dict.fromkeys(payload.employeeIds))
    for employee_id in employee_ids:
        employee = _require_user(employee_id)
        if employee["isManager"]:
            raise HTTPException(status_code=422, detail=f"{employee_id} is not an employee")
    try:
        return _service.assign(project_id, employee_ids, manager)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/attempts")
def start_project_attempt(project_id: str, payload: UserRequest) -> dict:
    employee = _require_user(payload.userId)
    if employee["isManager"]:
        raise HTTPException(status_code=403, detail="Assigned employee access is required")
    try:
        return _service.start_attempt(project_id, employee)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/{project_id}/attempts/{attempt_id}/submit")
def submit_project_attempt(project_id: str, attempt_id: str, payload: SubmissionRequest) -> dict:
    employee = _require_user(payload.userId)
    if employee["isManager"]:
        raise HTTPException(status_code=403, detail="Assigned employee access is required")
    try:
        return _service.submit_attempt(project_id, attempt_id, employee, payload.answers)
    except Exception as exc:
        raise _translate_error(exc) from exc
