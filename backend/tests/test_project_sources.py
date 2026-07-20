from copy import deepcopy

import pytest
from fastapi import HTTPException

from backend.app import project_api
from backend.app.project_documents import DocumentScan, SourceDocument
from backend.app.project_service import ProjectService, ProjectSourceConfigError
from backend.app.project_store import PostgresProjectStore


MANAGER = {"id": "manager-1", "isManager": True}


class SourceStore:
    def __init__(self):
        self.project = {
            "id": "project-1",
            "name": "Project One",
            "description": "",
            "sourceSubpath": ".",
            "sourceType": "local",
            "sourceConfig": {},
            "manifestHash": "old-manifest",
            "lastSyncedAt": "2026-07-19T00:00:00+00:00",
            "documentCount": 1,
            "totalBytes": 4,
            "courses": [],
            "assignments": [],
            "documents": [],
        }
        self.update_calls = []

    def get_project(self, project_id, user_id, is_manager):
        return deepcopy(self.project) if project_id == self.project["id"] else None

    def list_projects(self, user_id, is_manager):
        return [deepcopy(self.project)]

    def update_source(self, project_id, source_type, source_config):
        self.update_calls.append((project_id, source_type, deepcopy(source_config)))
        self.project.update(
            sourceType=source_type,
            sourceConfig=deepcopy(source_config),
            manifestHash=None,
            lastSyncedAt=None,
        )
        return deepcopy(self.project)

    def replace_documents(self, project_id, documents, manifest_hash):
        self.project.update(
            manifestHash=manifest_hash,
            lastSyncedAt="2026-07-19T01:00:00+00:00",
            documentCount=len(documents),
        )
        return {
            "documentCount": len(documents),
            "manifestHash": manifest_hash,
            "syncedAt": self.project["lastSyncedAt"],
        }


class RecordingConnector:
    def __init__(self, source_type, config):
        self.source_type = source_type
        self.config = config
        self.scanned_subpaths = []
        self.tested_subpaths = []

    def scan(self, source_subpath="."):
        self.scanned_subpaths.append(source_subpath)
        return DocumentScan(
            documents=(SourceDocument("README.md", "digest", "hello", 5),),
            rejected=(),
        )

    def test_connection(self, source_subpath="."):
        self.tested_subpaths.append(source_subpath)
        return {"reachable": True, "repository": self.config.get("repository")}


def test_project_row_includes_persisted_source_shape():
    project = PostgresProjectStore._project_row(
        {
            "id": "project-1",
            "name": "Project One",
            "description": "",
            "source_subpath": ".",
            "source_type": "github",
            "source_config_json": '{"repository":"org/repo","tokenEnvVar":"GITHUB_TOKEN"}',
        }
    )

    assert project["sourceType"] == "github"
    assert project["sourceConfig"] == {
        "repository": "org/repo",
        "tokenEnvVar": "GITHUB_TOKEN",
    }


def test_source_update_rejects_raw_credentials_before_persistence():
    store = SourceStore()
    service = ProjectService(store, connector_resolver=lambda source_type, config: None)

    with pytest.raises(ProjectSourceConfigError, match="tokenEnvVar"):
        service.update_source(
            "project-1",
            "github",
            {"repository": "org/repo", "token": "raw-secret"},
            MANAGER,
        )

    assert store.update_calls == []


def test_source_update_allows_env_reference_and_invalidates_manifest():
    store = SourceStore()
    service = ProjectService(store, connector_resolver=lambda source_type, config: None)

    result = service.update_source(
        "project-1",
        "github",
        {"repository": "org/repo", "tokenEnvVar": "GITHUB_TOKEN"},
        MANAGER,
    )

    assert store.update_calls[0][1:] == (
        "github",
        {"repository": "org/repo", "tokenEnvVar": "GITHUB_TOKEN"},
    )
    assert result["sourceSummary"]["digest"] is None
    assert result["sourceSummary"]["lastSyncedAt"] is None


def test_test_and_sync_resolve_connector_from_project_configuration():
    store = SourceStore()
    store.project.update(
        sourceType="github",
        sourceConfig={"repository": "org/repo", "tokenEnvVar": "GITHUB_TOKEN"},
    )
    resolved = []

    def resolver(source_type, config):
        resolved.append((source_type, deepcopy(config)))
        return RecordingConnector(source_type, config)

    service = ProjectService(store, connector_resolver=resolver)

    tested = service.test_source("project-1", MANAGER)
    synced = service.sync("project-1", MANAGER)

    assert resolved == [
        ("github", store.project["sourceConfig"]),
        ("github", store.project["sourceConfig"]),
    ]
    assert tested["status"] == "connected"
    assert synced["sourceSummary"]["documentCount"] == 1


def test_source_api_requires_manager(monkeypatch):
    monkeypatch.setattr(
        project_api,
        "get_user",
        lambda user_id: {"id": user_id, "isManager": False},
    )

    with pytest.raises(HTTPException) as error:
        project_api.update_project_source(
            "project-1",
            project_api.SourceUpdateRequest(
                userId="employee-1",
                sourceType="local",
                sourceConfig={},
            ),
        )

    assert error.value.status_code == 403


def test_api_connector_catalog_is_manager_only_and_registry_backed(monkeypatch):
    monkeypatch.setattr(
        project_api,
        "get_user",
        lambda user_id: {"id": user_id, "isManager": user_id == "manager-1"},
    )

    result = project_api.list_project_connectors("manager-1")

    assert result["count"] == len(result["connectors"])
    assert {"local", "github"} <= {item["type"] for item in result["connectors"]}
    with pytest.raises(HTTPException) as error:
        project_api.list_project_connectors("employee-1")
    assert error.value.status_code == 403


def test_api_resolver_rejects_server_root_override_and_unknown_github_fields():
    with pytest.raises(ProjectSourceConfigError, match="Unknown local"):
        project_api._resolve_connector("local", {"root": "/etc"})
    with pytest.raises(ProjectSourceConfigError, match="Unknown GitHub"):
        project_api._resolve_connector("github", {"repository": "acme/docs", "apiUrl": "https://example.com"})


def test_local_source_subpath_is_used_for_test_and_sync():
    store = SourceStore()
    store.project.update(
        sourceType="local",
        sourceConfig={"sourceSubpath": "architecture"},
        sourceSubpath="architecture",
    )
    connectors = []

    def resolver(source_type, config):
        connector = RecordingConnector(source_type, config)
        connectors.append(connector)
        return connector

    service = ProjectService(store, connector_resolver=resolver)

    service.test_source("project-1", MANAGER)
    service.sync("project-1", MANAGER)

    assert connectors[0].tested_subpaths == ["architecture"]
    assert connectors[1].scanned_subpaths == ["architecture"]
