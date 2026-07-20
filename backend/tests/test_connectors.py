from __future__ import annotations

import base64
import hashlib
from pathlib import Path
from typing import Any

import pytest

from backend.app.connectors import (
    CONNECTOR_REGISTRY,
    ConnectorConfigurationError,
    GitHubDocumentConnector,
    LocalDocumentConnector,
    create_connector,
)


class FakeResponse:
    def __init__(self, payload: Any, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code

    def json(self) -> Any:
        return self.payload


class FakeClient:
    def __init__(self, responses: dict[str, FakeResponse]) -> None:
        self.responses = responses
        self.requests: list[dict[str, Any]] = []

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.requests.append({"url": url, **kwargs})
        return self.responses[url]


def _blob(content: bytes) -> FakeResponse:
    return FakeResponse(
        {
            "encoding": "base64",
            "content": base64.b64encode(content).decode("ascii"),
        }
    )


def test_packaged_local_connector_matches_existing_document_contract(tmp_path: Path):
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested" / "guide.md").write_text("# Guide", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("notes", encoding="utf-8")
    (tmp_path / "ignored.json").write_text("{}", encoding="utf-8")

    scan = LocalDocumentConnector(tmp_path).scan()

    assert [document.source_path for document in scan.documents] == [
        "nested/guide.md",
        "notes.txt",
    ]
    assert scan.skipped_unsupported == 1
    assert scan.documents[0].content_hash == hashlib.sha256(b"# Guide").hexdigest()
    assert bool(LocalDocumentConnector(tmp_path).test_connection()) is True


def test_registry_is_explicit_and_rejects_unknown_connectors(tmp_path: Path):
    assert CONNECTOR_REGISTRY.names == ("confluence", "github", "local")
    assert isinstance(create_connector("local", {"root": str(tmp_path)}), LocalDocumentConnector)
    with pytest.raises(ConnectorConfigurationError, match="Unknown connector type"):
        create_connector("gitlab", {})


def test_github_connector_scans_in_stable_order_with_filters_and_bounds():
    api = "https://api.github.com/repos/acme/handbook"
    tree = {
        "truncated": False,
        "tree": [
            {"path": "z.txt", "type": "blob", "sha": "z", "size": 1},
            {"path": "private/secret.md", "type": "blob", "sha": "secret", "size": 6},
            {"path": "a.md", "type": "blob", "sha": "a", "size": 3},
            {"path": "bad.md", "type": "blob", "sha": "bad", "size": 1},
            {"path": "large.md", "type": "blob", "sha": "large", "size": 100},
            {"path": "metadata.json", "type": "blob", "sha": "json", "size": 2},
        ],
    }
    client = FakeClient(
        {
            f"{api}/commits/main": FakeResponse(
                {"sha": "commit-123", "commit": {"tree": {"sha": "tree-123"}}}
            ),
            f"{api}/git/trees/tree-123": FakeResponse(tree),
            f"{api}/git/blobs/a": _blob(b"aaa"),
            f"{api}/git/blobs/bad": _blob(b"\xff"),
            f"{api}/git/blobs/z": _blob(b"z"),
        }
    )
    connector = GitHubDocumentConnector(
        {
            "repositoryUrl": "https://github.com/acme/handbook.git",
            "ref": "main",
            "include": ["**/*"],
            "exclude": ["private/**"],
            "maxFileBytes": 10,
        },
        client=client,
    )

    scan = connector.scan()

    assert [document.source_path for document in scan.documents] == ["a.md", "z.txt"]
    assert [(item.source_path, item.reason) for item in scan.rejected] == [
        ("bad.md", "invalid-utf8"),
        ("large.md", "file-size-limit"),
    ]
    assert scan.skipped_unsupported == 1
    assert scan.documents[0].revision == "commit-123"
    assert scan.documents[0].source_url == (
        "https://github.com/acme/handbook/blob/commit-123/a.md"
    )
    assert all("Authorization" not in request["headers"] for request in client.requests)
    assert scan.manifest_hash == connector.scan().manifest_hash


def test_github_connector_uses_only_token_environment_variable_and_tests_connection():
    api = "https://api.github.com/repos/acme/docs"
    client = FakeClient({api: FakeResponse({"full_name": "acme/docs"})})
    connector = GitHubDocumentConnector(
        {
            "owner": "acme",
            "repo": "docs",
            "tokenEnvVar": "PROJECT_GITHUB_TOKEN",
        },
        client=client,
        environ={"PROJECT_GITHUB_TOKEN": "not-stored-in-config"},
    )

    result = connector.test_connection()

    assert result.ok is True
    assert connector.config.token_env_var == "PROJECT_GITHUB_TOKEN"
    assert not hasattr(connector.config, "token")
    assert client.requests[0]["headers"]["Authorization"] == "Bearer not-stored-in-config"


def test_github_connector_accepts_ui_configuration_shape():
    connector = GitHubDocumentConnector(
        {
            "repository": "acme/docs",
            "includePaths": [],
            "excludePaths": ["archive/**"],
        },
        client=FakeClient({}),
    )

    assert connector.config.repository_url == "https://github.com/acme/docs"
    assert connector.config.include == ("**/*.md", "**/*.txt")
    assert connector.config.exclude == ("archive/**",)


@pytest.mark.parametrize("secret_key", ["token", "accessToken", "password"])
def test_github_connector_rejects_raw_credentials(secret_key: str):
    with pytest.raises(ConnectorConfigurationError, match="raw token"):
        GitHubDocumentConnector({"owner": "acme", "repo": "docs", secret_key: "secret"})


def test_github_connection_failure_is_sanitized_when_token_env_var_is_missing():
    connector = GitHubDocumentConnector(
        {"owner": "acme", "repo": "docs", "tokenEnvVar": "GITHUB_MISSING_TOKEN"},
        client=FakeClient({}),
        environ={},
    )

    result = connector.test_connection()

    assert result.ok is False
    assert "GITHUB_MISSING_TOKEN" in result.message
    assert "Bearer" not in result.message


def test_github_connector_rejects_unrelated_environment_variables_and_traversal_globs():
    with pytest.raises(ConnectorConfigurationError, match="must start"):
        GitHubDocumentConnector(
            {"owner": "acme", "repo": "docs", "tokenEnvVar": "DATABASE_URL"}
        )
    with pytest.raises(ConnectorConfigurationError, match="glob pattern"):
        GitHubDocumentConnector(
            {"owner": "acme", "repo": "docs", "includePaths": ["../*.md"]}
        )
