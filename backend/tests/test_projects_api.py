import pytest
from fastapi import HTTPException

from backend.app import project_api
from backend.app.main import app


class ListService:
    def list_projects(self, user):
        return [{"id": "inovaare-onboarding", "name": "Revamped Knowledge Base"}]


def test_project_routes_are_registered():
    paths = app.openapi()["paths"]

    assert "/api/projects" in paths
    assert "/api/project-connectors" in paths
    assert "/api/projects/{project_id}/attempts/{attempt_id}/submit" in paths
    assert "/api/projects/{project_id}/sources" in paths
    assert "/api/projects/{project_id}/sources/{source_id}" in paths
    assert "/api/projects/{project_id}/sources/{source_id}/test" in paths
    assert "/api/projects/{project_id}/sources/{source_id}/sync" in paths


def test_project_list_has_ui_friendly_envelope(monkeypatch):
    monkeypatch.setattr(project_api, "_service", ListService())
    monkeypatch.setattr(
        project_api,
        "get_user",
        lambda user_id: {"id": user_id, "isManager": False},
    )

    result = project_api.list_projects("employee-1")

    assert result["count"] == 1
    assert result["projects"][0]["id"] == "inovaare-onboarding"


def test_manager_operations_reject_employee_before_service_call(monkeypatch):
    monkeypatch.setattr(
        project_api,
        "get_user",
        lambda user_id: {"id": user_id, "isManager": False},
    )

    with pytest.raises(HTTPException) as error:
        project_api.sync_project("inovaare-onboarding", project_api.UserRequest(userId="employee-1"))

    assert error.value.status_code == 403


class SourceApiService:
    def list_sources(self, project_id, manager):
        return [{"id": "source-1", "name": "Primary"}]

    def create_source(self, project_id, name, connector_type, config, manager):
        return {"projectId": project_id, "source": {"name": name, "connectorType": connector_type}}

    def update_named_source(self, project_id, source_id, changes, manager):
        return {"projectId": project_id, "sourceId": source_id, "changes": changes}

    def delete_named_source(self, project_id, source_id, manager):
        return {"projectId": project_id, "sourceId": source_id, "status": "deleted"}

    def test_named_source(self, project_id, source_id, manager):
        return {"projectId": project_id, "sourceId": source_id, "ok": True}

    def sync_named_source(self, project_id, source_id, manager):
        return {"projectId": project_id, "source": {"sourceId": source_id, "documentCount": 1}}


def test_source_manager_routes_delegate_by_source_id(monkeypatch):
    monkeypatch.setattr(project_api, "_service", SourceApiService())
    monkeypatch.setattr(
        project_api,
        "get_user",
        lambda user_id: {"id": user_id, "isManager": True},
    )

    listed = project_api.list_project_sources("project-1", "manager-1")
    created = project_api.create_project_source(
        "project-1",
        project_api.SourceCreateRequest(
            userId="manager-1", name="Runbooks", connectorType="github", config={}
        ),
    )
    updated = project_api.update_project_source_by_id(
        "project-1",
        "source-1",
        project_api.SourceUpdateByIdRequest(userId="manager-1", enabled=False),
    )
    tested = project_api.test_project_source_by_id(
        "project-1", "source-1", project_api.UserRequest(userId="manager-1")
    )
    synced = project_api.sync_project_source_by_id(
        "project-1", "source-1", project_api.UserRequest(userId="manager-1")
    )
    deleted = project_api.delete_project_source("project-1", "source-1", "manager-1")

    assert listed["count"] == 1
    assert created["source"]["name"] == "Runbooks"
    assert updated["changes"] == {"enabled": False}
    assert tested["ok"] is True
    assert synced["source"]["documentCount"] == 1
    assert deleted["status"] == "deleted"
