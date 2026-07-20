from __future__ import annotations

from copy import deepcopy

import pytest

from backend.app.project_documents import DocumentIngestionError, DocumentScan, SourceDocument
from backend.app.project_service import ProjectService, ProjectSourceConfigError


MANAGER = {"id": "manager-1", "isManager": True}


class MultiSourceStore:
    def __init__(self):
        self.project = {
            "id": "project-1",
            "name": "Project One",
            "description": "",
            "manifestHash": "old-manifest",
            "lastSyncedAt": "old-time",
            "documentCount": 2,
            "totalBytes": 8,
            "courses": [],
            "assignments": [],
            "documents": [],
            "sources": [
                {
                    "id": "source-a",
                    "projectId": "project-1",
                    "name": "Handbook",
                    "connectorType": "local",
                    "config": {"sourceSubpath": "handbook"},
                    "enabled": True,
                },
                {
                    "id": "source-b",
                    "projectId": "project-1",
                    "name": "Runbooks",
                    "connectorType": "github",
                    "config": {"repository": "acme/runbooks"},
                    "enabled": True,
                },
            ],
        }
        self.documents = {
            "source-a": ["Handbook/README.md"],
            "source-b": ["Runbooks/README.md"],
        }
        self.replace_calls = []

    def get_project(self, project_id, user_id, is_manager):
        return deepcopy(self.project) if project_id == "project-1" else None

    def list_projects(self, user_id, is_manager):
        return [deepcopy(self.project)]

    def list_sources(self, project_id):
        return deepcopy(self.project["sources"])

    def replace_documents(self, project_id, documents, manifest_hash, source_metadata=None):
        self.replace_calls.append((documents, manifest_hash, deepcopy(source_metadata)))
        self.project.update(
            manifestHash=manifest_hash,
            lastSyncedAt="new-time",
            documentCount=len(documents),
            totalBytes=sum(item.size_bytes for item in documents),
        )
        return {
            "documentCount": len(documents),
            "manifestHash": manifest_hash,
            "syncedAt": "new-time",
        }

    def replace_source_documents(
        self, project_id, source_id, source_name, documents, update_manifest=True
    ):
        self.documents[source_id] = [item.source_path for item in documents]
        self.project.update(
            manifestHash="source-sync-manifest" if update_manifest else None,
            lastSyncedAt="source-time" if update_manifest else None,
        )
        return {
            "documentCount": len(documents),
            "manifestHash": "source-sync-manifest" if update_manifest else None,
            "syncedAt": "source-time",
        }

    def create_source(self, project_id, name, connector_type, config):
        source = {
            "id": "source-c",
            "projectId": project_id,
            "name": name,
            "connectorType": connector_type,
            "config": deepcopy(config),
            "enabled": True,
        }
        self.project["sources"].append(source)
        self.project.update(manifestHash=None, lastSyncedAt=None)
        return deepcopy(source)

    def update_project_source(self, project_id, source_id, changes):
        source = next(item for item in self.project["sources"] if item["id"] == source_id)
        source.update(deepcopy(changes))
        self.documents[source_id] = []
        self.project.update(manifestHash=None, lastSyncedAt=None)
        return deepcopy(source)

    def delete_source(self, project_id, source_id):
        self.project["sources"] = [
            item for item in self.project["sources"] if item["id"] != source_id
        ]
        self.documents.pop(source_id, None)
        self.project.update(manifestHash=None, lastSyncedAt=None)
        return True


class StaticConnector:
    def __init__(self, label, fail=False):
        self.label = label
        self.fail = fail

    def scan(self, source_subpath="."):
        if self.fail:
            raise DocumentIngestionError(f"{self.label} failed")
        return DocumentScan(
            documents=(
                SourceDocument("README.md", f"hash-{self.label}", self.label, len(self.label)),
            ),
            rejected=(),
        )

    def test_connection(self, source_subpath="."):
        return {"ok": True, "message": f"{self.label} reachable"}


def _service(store, *, failing=None):
    def resolve(connector_type, config):
        label = config.get("repository", config.get("sourceSubpath", connector_type))
        return StaticConnector(label, fail=label == failing)

    return ProjectService(store, connector_resolver=resolve)


def test_project_sync_aggregates_enabled_sources_with_identity_and_safe_paths():
    store = MultiSourceStore()
    result = _service(store).sync("project-1", MANAGER)

    documents, _, metadata = store.replace_calls[0]
    assert [item.source_path for item in documents] == [
        "Handbook/README.md",
        "Runbooks/README.md",
    ]
    assert metadata["Handbook/README.md"] == {
        "sourceId": "source-a",
        "sourceName": "Handbook",
    }
    assert result["sourceSummary"]["documentCount"] == 2
    assert [item["sourceId"] for item in result["sources"]] == ["source-a", "source-b"]


def test_project_sync_is_atomic_when_a_later_source_fails():
    store = MultiSourceStore()

    with pytest.raises(DocumentIngestionError, match="failed"):
        _service(store, failing="acme/runbooks").sync("project-1", MANAGER)

    assert store.replace_calls == []
    assert store.project["manifestHash"] == "old-manifest"


def test_source_lifecycle_invalidates_manifest_and_only_removes_affected_documents():
    store = MultiSourceStore()
    service = _service(store)

    created = service.create_source("project-1", "Policies", "local", {}, MANAGER)
    assert created["source"]["name"] == "Policies"
    service.update_named_source(
        "project-1", "source-a", {"name": "Employee Handbook"}, MANAGER
    )
    assert store.documents["source-a"] == []
    assert store.documents["source-b"] == ["Runbooks/README.md"]
    service.delete_named_source("project-1", "source-b", MANAGER)
    assert "source-b" not in store.documents
    assert store.project["manifestHash"] is None


def test_named_source_rejects_raw_secrets_and_supports_individual_sync():
    store = MultiSourceStore()
    service = _service(store)

    with pytest.raises(ProjectSourceConfigError, match="tokenEnvVar"):
        service.create_source(
            "project-1",
            "Private repo",
            "github",
            {"repository": "acme/private", "token": "raw"},
            MANAGER,
        )

    result = service.sync_named_source("project-1", "source-a", MANAGER)
    assert store.documents["source-a"] == ["Handbook/README.md"]
    assert result["source"]["sourceName"] == "Handbook"
    assert result["source"]["lastSyncedAt"] == "source-time"
    assert store.project["manifestHash"] is None


def test_employee_project_payload_hides_resource_configuration_and_locations():
    store = MultiSourceStore()
    store.project.update(
        sourceConfig={"repository": "acme/private", "tokenEnvVar": "GITHUB_TOKEN"},
        sourceSubpath="private-docs",
        connectorType="github",
        config={"repository": "acme/private"},
    )
    service = _service(store)

    listed = service.list_projects({"id": "employee-1", "isManager": False})[0]
    detailed = service.get_project(
        "project-1", {"id": "employee-1", "isManager": False}
    )

    for payload in (listed, detailed):
        assert not (set(payload) & {"sources", "sourceConfig", "sourceSubpath", "config"})
        assert "GITHUB_TOKEN" not in repr(payload)
