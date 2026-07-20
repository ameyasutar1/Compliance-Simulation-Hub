from __future__ import annotations

import base64
import hashlib
from typing import Any

import pytest

from backend.app.connectors.base import (
    ConnectorConfigurationError,
    DocumentIngestionError,
)
from backend.app.connectors.confluence import (
    ConfluenceDocumentConnector,
    storage_html_to_text,
)


class FakeResponse:
    def __init__(self, payload: Any, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code

    def json(self) -> Any:
        return self.payload


class FakeClient:
    def __init__(self, responses: dict[str, FakeResponse | list[FakeResponse]]) -> None:
        self.responses = responses
        self.requests: list[dict[str, Any]] = []

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.requests.append({"url": url, **kwargs})
        response = self.responses[url]
        if isinstance(response, list):
            return response.pop(0)
        return response


def _page(body: str, version: int = 1) -> FakeResponse:
    return FakeResponse(
        {"body": {"storage": {"value": body}}, "version": {"number": version}}
    )


def test_confluence_scan_deduplicates_pages_converts_storage_and_preserves_metadata():
    page_url = "https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Runbook"
    api = "https://acme.atlassian.net/wiki/api/v2/pages/123"
    client = FakeClient(
        {
            api: _page(
                "<h1>Deploy &amp; verify</h1><p>Hello <strong>team</strong>.</p>"
                "<ul><li>First</li><li>Second</li></ul>"
                "<script>do not index me</script>",
                7,
            )
        }
    )
    connector = ConfluenceDocumentConnector(
        {
            "pageUrls": [page_url, "https://acme.atlassian.net/wiki/pages/123"],
            "accountEmail": "reader@example.com",
            "tokenEnvVar": "PROJECT_CONFLUENCE_TOKEN",
        },
        client=client,
        environ={"PROJECT_CONFLUENCE_TOKEN": "api-token"},
    )

    scan = connector.scan()

    assert len(scan.documents) == 1
    document = scan.documents[0]
    assert document.source_path == "confluence/123.txt"
    assert document.content == "Deploy & verify\nHello team.\n- First\n- Second"
    assert document.source_url == page_url
    assert document.revision == "7"
    assert document.size_bytes == len(document.content.encode("utf-8"))
    assert (
        document.content_hash
        == hashlib.sha256(document.content.encode("utf-8")).hexdigest()
    )
    assert client.requests[0]["params"] == {"body-format": "storage"}
    expected = base64.b64encode(b"reader@example.com:api-token").decode("ascii")
    assert client.requests[0]["headers"]["Authorization"] == f"Basic {expected}"


def test_confluence_descendants_use_bounded_cursor_pagination_and_fixed_api_urls():
    root_api = "https://acme.atlassian.net/wiki/api/v2/pages/10"
    root_children = f"{root_api}/children"
    child_11_api = "https://acme.atlassian.net/wiki/api/v2/pages/11"
    child_12_api = "https://acme.atlassian.net/wiki/api/v2/pages/12"
    client = FakeClient(
        {
            root_children: [
                FakeResponse(
                    {
                        "results": [
                            {"id": "12", "type": "page"},
                            {"id": "999", "type": "attachment"},
                        ],
                        "_links": {
                            "next": "/wiki/api/v2/pages/10/children?cursor=safe-cursor"
                        },
                    }
                ),
                FakeResponse({"results": [{"id": "11"}], "_links": {}}),
            ],
            f"{child_11_api}/children": FakeResponse({"results": [], "_links": {}}),
            f"{child_12_api}/children": FakeResponse({"results": [], "_links": {}}),
            root_api: _page("<p>Root</p>"),
            child_11_api: _page("<p>Eleven</p>", 2),
            child_12_api: _page("<p>Twelve</p>", 3),
        }
    )
    connector = ConfluenceDocumentConnector(
        {
            "pageUrl": "https://acme.atlassian.net/wiki/spaces/X/pages/10/Root",
            "includeDescendants": True,
        },
        client=client,
    )

    scan = connector.scan()

    assert [document.source_path for document in scan.documents] == [
        "confluence/10.txt",
        "confluence/11.txt",
        "confluence/12.txt",
    ]
    assert scan.documents[1].source_url == "https://acme.atlassian.net/wiki/pages/11"
    child_requests = [
        request for request in client.requests if request["url"] == root_children
    ]
    assert child_requests[0]["params"] == {"limit": "100"}
    assert child_requests[1]["params"] == {"limit": "100", "cursor": "safe-cursor"}
    assert all(
        request["url"].startswith("https://acme.atlassian.net/wiki/api/v2/")
        for request in client.requests
    )


def test_confluence_rejects_unsafe_descendant_pagination_without_following_it():
    children = "https://acme.atlassian.net/wiki/api/v2/pages/10/children"
    client = FakeClient(
        {
            children: FakeResponse(
                {
                    "results": [],
                    "_links": {
                        "next": "https://attacker.example/wiki/api/v2/pages/10/children?cursor=x"
                    },
                }
            )
        }
    )
    connector = ConfluenceDocumentConnector(
        {
            "pages": ["https://acme.atlassian.net/wiki/pages/10"],
            "includeDescendants": True,
        },
        client=client,
    )

    with pytest.raises(DocumentIngestionError, match="unsafe pagination"):
        connector.scan()

    assert [request["url"] for request in client.requests] == [children]


@pytest.mark.parametrize(
    "url",
    [
        "http://acme.atlassian.net/wiki/pages/1",
        "https://atlassian.net/wiki/pages/1",
        "https://acme.atlassian.net.evil.example/wiki/pages/1",
        "https://acme.atlassian.net/not-wiki/pages/1",
        "https://acme.atlassian.net/wiki/spaces/ENG/overview",
        "https://user:password@acme.atlassian.net/wiki/pages/1",
        "https://acme.atlassian.net/wiki/pages/1?next=https://evil.example",
    ],
)
def test_confluence_rejects_non_cloud_or_unparseable_page_urls(url: str):
    with pytest.raises(ConnectorConfigurationError):
        ConfluenceDocumentConnector({"pageUrls": [url]})


def test_confluence_requires_each_resource_to_use_one_cloud_site():
    with pytest.raises(ConnectorConfigurationError, match="same Atlassian Cloud host"):
        ConfluenceDocumentConnector(
            {
                "pageUrls": [
                    "https://acme.atlassian.net/wiki/pages/1",
                    "https://other.atlassian.net/wiki/pages/2",
                ]
            }
        )


@pytest.mark.parametrize("secret_key", ["token", "apiToken", "password", "secret"])
def test_confluence_rejects_raw_credentials(secret_key: str):
    with pytest.raises(ConnectorConfigurationError, match="raw token"):
        ConfluenceDocumentConnector(
            {
                "pageUrl": "https://acme.atlassian.net/wiki/pages/1",
                secret_key: "do-not-store-this",
            }
        )


def test_confluence_requires_email_and_approved_token_environment_together():
    page = "https://acme.atlassian.net/wiki/pages/1"
    with pytest.raises(ConnectorConfigurationError, match="both"):
        ConfluenceDocumentConnector({"pageUrl": page, "accountEmail": "a@example.com"})
    with pytest.raises(ConnectorConfigurationError, match="must start"):
        ConfluenceDocumentConnector(
            {
                "pageUrl": page,
                "accountEmail": "a@example.com",
                "tokenEnvVar": "DATABASE_URL",
            }
        )


def test_confluence_connection_failure_does_not_expose_an_authorization_value():
    connector = ConfluenceDocumentConnector(
        {
            "pageUrl": "https://acme.atlassian.net/wiki/pages/1",
            "accountEmail": "a@example.com",
            "tokenEnvVar": "CONFLUENCE_MISSING_TOKEN",
        },
        client=FakeClient({}),
        environ={},
    )

    result = connector.test_connection()

    assert result.ok is False
    assert "CONFLUENCE_MISSING_TOKEN" in result.message
    assert "Basic" not in result.message


def test_storage_html_converter_handles_cdata_tables_images_and_whitespace():
    value = (
        "<p>Before&nbsp; text</p><ac:plain-text-body><![CDATA[a < b\nline 2]]>"
        "</ac:plain-text-body><table><tr><th>A</th><td>B</td></tr></table>"
        '<p><img alt="diagram"> after</p>'
    )

    assert storage_html_to_text(value) == (
        "Before\xa0 text\na < b\nline 2\n| A | B\ndiagram after"
    )


def test_confluence_rejects_oversized_page_without_returning_partial_content(
    monkeypatch,
):
    import backend.app.connectors.confluence as confluence

    monkeypatch.setattr(confluence, "MAX_PAGE_BYTES", 3)
    api = "https://acme.atlassian.net/wiki/api/v2/pages/1"
    connector = ConfluenceDocumentConnector(
        {"pageUrl": "https://acme.atlassian.net/wiki/pages/1"},
        client=FakeClient({api: _page("four")}),
    )

    scan = connector.scan()

    assert scan.documents == ()
    assert [(item.source_path, item.reason) for item in scan.rejected] == [
        ("confluence/1.txt", "file-size-limit")
    ]
