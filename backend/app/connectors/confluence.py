from __future__ import annotations

import base64
import hashlib
import os
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, Mapping, Protocol, Sequence
from urllib.parse import parse_qs, quote, urlparse

from .base import (
    ConnectionTestResult,
    ConnectorConfigurationError,
    DocumentIngestionError,
    DocumentScan,
    RejectedDocument,
    SourceDocument,
)


_ENVIRONMENT_VARIABLE = re.compile(r"^(?:CONFLUENCE|PROJECT_CONFLUENCE)_[A-Z0-9_]+$")
_PAGE_PATH = re.compile(r"(?:^|/)pages/([0-9]+)(?:/|$)")
_RAW_SECRET_KEYS = {
    "accessToken",
    "access_token",
    "apiToken",
    "api_token",
    "authorization",
    "password",
    "secret",
    "token",
}

# These are deliberately fixed safety bounds rather than remotely configurable values.
MAX_PAGES = 500
MAX_PAGE_BYTES = 1_000_000
MAX_TOTAL_BYTES = 10_000_000
MAX_PAGINATION_REQUESTS = 2_000
DESCENDANT_PAGE_SIZE = 100


class HttpResponse(Protocol):
    status_code: int

    def json(self) -> Any: ...


class HttpClient(Protocol):
    def get(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        params: Mapping[str, str] | None = None,
        timeout: float,
    ) -> HttpResponse: ...


@dataclass(frozen=True)
class ConfluencePage:
    host: str
    page_id: str
    source_url: str


@dataclass(frozen=True)
class ConfluenceConnectorConfig:
    pages: tuple[ConfluencePage, ...]
    include_descendants: bool = False
    account_email: str | None = None
    token_env_var: str | None = None

    @property
    def page_urls(self) -> tuple[str, ...]:
        return tuple(page.source_url for page in self.pages)

    @classmethod
    def from_mapping(cls, config: Mapping[str, Any]) -> ConfluenceConnectorConfig:
        raw_secrets = sorted(set(config) & _RAW_SECRET_KEYS)
        if raw_secrets:
            raise ConnectorConfigurationError(
                "Confluence credentials must use tokenEnvVar; raw token configuration is not allowed"
            )

        aliases = {
            "pageUrls": "page_urls",
            "pageUrl": "page_urls",
            "pages": "page_urls",
            "page_urls": "page_urls",
            "includeDescendants": "include_descendants",
            "include_descendants": "include_descendants",
            "accountEmail": "account_email",
            "account_email": "account_email",
            "tokenEnvVar": "token_env_var",
            "token_env_var": "token_env_var",
        }
        unknown = sorted(set(config) - set(aliases) - _RAW_SECRET_KEYS)
        if unknown:
            raise ConnectorConfigurationError(
                f"Unknown Confluence connector configuration: {', '.join(unknown)}"
            )

        normalized: dict[str, Any] = {}
        for key, value in config.items():
            if key in _RAW_SECRET_KEYS:
                continue
            canonical = aliases[key]
            if canonical in normalized and normalized[canonical] != value:
                raise ConnectorConfigurationError(f"Conflicting values for {canonical}")
            normalized[canonical] = value

        pages = _parse_page_urls(normalized.pop("page_urls", None))
        include_descendants = normalized.pop("include_descendants", False)
        if not isinstance(include_descendants, bool):
            raise ConnectorConfigurationError("includeDescendants must be a boolean")

        account_email = normalized.pop("account_email", None)
        token_env_var = normalized.pop("token_env_var", None)
        if account_email is not None:
            if (
                not isinstance(account_email, str)
                or not account_email.strip()
                or len(account_email) > 320
                or any(character in account_email for character in "\r\n:")
            ):
                raise ConnectorConfigurationError(
                    "accountEmail must be a valid non-empty string"
                )
            account_email = account_email.strip()
        if token_env_var is not None:
            if not isinstance(
                token_env_var, str
            ) or not _ENVIRONMENT_VARIABLE.fullmatch(token_env_var):
                raise ConnectorConfigurationError(
                    "tokenEnvVar must start with CONFLUENCE_ or PROJECT_CONFLUENCE_"
                )
        if (account_email is None) != (token_env_var is None):
            raise ConnectorConfigurationError(
                "accountEmail and tokenEnvVar must either both be supplied or both omitted"
            )

        return cls(
            pages=pages,
            include_descendants=include_descendants,
            account_email=account_email,
            token_env_var=token_env_var,
        )


class ConfluenceDocumentConnector:
    """Read Confluence Cloud pages through the read-only REST v2 API."""

    connector_type = "confluence"

    def __init__(
        self,
        config: ConfluenceConnectorConfig | Mapping[str, Any] | Sequence[str] | str,
        *,
        client: HttpClient | None = None,
        environ: Mapping[str, str] | None = None,
        timeout: float = 15.0,
    ) -> None:
        if isinstance(config, ConfluenceConnectorConfig):
            parsed_config = config
        elif isinstance(config, str):
            parsed_config = ConfluenceConnectorConfig.from_mapping({"pageUrl": config})
        elif isinstance(config, Mapping):
            parsed_config = ConfluenceConnectorConfig.from_mapping(config)
        elif isinstance(config, Sequence) and not isinstance(
            config, (bytes, bytearray)
        ):
            parsed_config = ConfluenceConnectorConfig.from_mapping({"pageUrls": config})
        else:
            raise ConnectorConfigurationError(
                "Confluence configuration must contain pageUrls"
            )

        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or timeout <= 0
        ):
            raise ConnectorConfigurationError("timeout must be positive")
        self.config = parsed_config
        self._client = client
        self._environ = os.environ if environ is None else environ
        self._timeout = float(timeout)

    @classmethod
    def from_config(cls, config: Mapping[str, Any]) -> ConfluenceDocumentConnector:
        return cls(config)

    def test_connection(self, source_subpath: str = ".") -> ConnectionTestResult:
        try:
            _validate_source_subpath(source_subpath)
            page = self.config.pages[0]
            response = self._request_json(
                self._page_api_url(page.host, page.page_id),
                params={"body-format": "storage"},
            )
            _page_body(response)
        except DocumentIngestionError as exc:
            return ConnectionTestResult(False, str(exc))
        return ConnectionTestResult(
            True,
            f"Connected to Confluence page {self.config.pages[0].page_id}",
        )

    def scan(self, source_subpath: str = ".") -> DocumentScan:
        _validate_source_subpath(source_subpath)
        pages, rejected = self._pages_to_scan()
        accepted: list[SourceDocument] = []
        total_bytes = 0

        for page in sorted(pages.values(), key=lambda item: (item.page_id, item.host)):
            source_path = _source_path(page.page_id)
            payload = self._request_json(
                self._page_api_url(page.host, page.page_id),
                params={"body-format": "storage"},
            )
            try:
                storage_html, revision = _page_body(payload)
            except DocumentIngestionError:
                rejected.append(RejectedDocument(source_path, "invalid-response"))
                continue
            raw_size = len(storage_html.encode("utf-8"))
            if raw_size > MAX_PAGE_BYTES:
                rejected.append(RejectedDocument(source_path, "file-size-limit"))
                continue

            content = storage_html_to_text(storage_html)
            data = content.encode("utf-8")
            if len(data) > MAX_PAGE_BYTES:
                rejected.append(RejectedDocument(source_path, "file-size-limit"))
                continue
            if total_bytes + len(data) > MAX_TOTAL_BYTES:
                rejected.append(RejectedDocument(source_path, "total-size-limit"))
                continue

            total_bytes += len(data)
            accepted.append(
                SourceDocument(
                    source_path=source_path,
                    content_hash=hashlib.sha256(data).hexdigest(),
                    content=content,
                    size_bytes=len(data),
                    source_url=page.source_url,
                    revision=revision,
                )
            )

        return DocumentScan(
            tuple(accepted),
            tuple(sorted(rejected, key=lambda item: (item.source_path, item.reason))),
        )

    def _pages_to_scan(
        self,
    ) -> tuple[dict[str, ConfluencePage], list[RejectedDocument]]:
        pages: dict[str, ConfluencePage] = {}
        rejected: list[RejectedDocument] = []
        queue: list[ConfluencePage] = []
        for page in self.config.pages:
            if page.page_id in pages:
                continue
            if len(pages) >= MAX_PAGES:
                rejected.append(
                    RejectedDocument(_source_path(page.page_id), "file-count-limit")
                )
                continue
            pages[page.page_id] = page
            queue.append(page)

        if not self.config.include_descendants:
            return pages, rejected

        pagination_requests = 0
        queue_index = 0
        while queue_index < len(queue) and len(pages) < MAX_PAGES:
            parent = queue[queue_index]
            queue_index += 1
            endpoint = self._children_api_url(parent.host, parent.page_id)
            cursor: str | None = None
            seen_cursors: set[str] = set()
            while True:
                pagination_requests += 1
                if pagination_requests > MAX_PAGINATION_REQUESTS:
                    raise DocumentIngestionError(
                        "Confluence descendant pagination limit exceeded"
                    )
                params = {"limit": str(DESCENDANT_PAGE_SIZE)}
                if cursor is not None:
                    params["cursor"] = cursor
                response = self._request_json(endpoint, params=params)
                results = (
                    response.get("results") if isinstance(response, Mapping) else None
                )
                if not isinstance(results, list):
                    raise DocumentIngestionError(
                        "Confluence returned an invalid descendants response"
                    )
                children: list[ConfluencePage] = []
                for result in results:
                    child_id = result.get("id") if isinstance(result, Mapping) else None
                    if not isinstance(child_id, str) or not child_id.isdigit():
                        raise DocumentIngestionError(
                            "Confluence returned an invalid descendants response"
                        )
                    # Only page content is in scope; attachments and other entities
                    # are never downloaded by this connector.
                    child_type = result.get("type")
                    if child_type is not None and child_type != "page":
                        continue
                    children.append(
                        ConfluencePage(
                            host=parent.host,
                            page_id=child_id,
                            source_url=_canonical_page_url(parent.host, child_id),
                        )
                    )
                for child in sorted(children, key=lambda item: item.page_id):
                    if child.page_id in pages:
                        continue
                    if len(pages) >= MAX_PAGES:
                        rejected.append(
                            RejectedDocument(
                                _source_path(child.page_id), "file-count-limit"
                            )
                        )
                        continue
                    pages[child.page_id] = child
                    queue.append(child)

                cursor = _next_cursor(response, endpoint, parent.host)
                if cursor is None or len(pages) >= MAX_PAGES:
                    break
                if cursor in seen_cursors:
                    raise DocumentIngestionError(
                        "Confluence returned a repeated pagination cursor"
                    )
                seen_cursors.add(cursor)

        return pages, rejected

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "project-document-connector",
        }
        if self.config.token_env_var and self.config.account_email:
            token = self._environ.get(self.config.token_env_var)
            if not token:
                raise DocumentIngestionError(
                    "Confluence credential environment variable "
                    f"{self.config.token_env_var} is not set"
                )
            credential = base64.b64encode(
                f"{self.config.account_email}:{token}".encode("utf-8")
            ).decode("ascii")
            headers["Authorization"] = f"Basic {credential}"
        return headers

    def _request_json(
        self, url: str, *, params: Mapping[str, str] | None = None
    ) -> Any:
        client = self._client
        if client is None:
            try:
                import httpx
            except ImportError as exc:  # pragma: no cover - optional dependency path
                raise DocumentIngestionError(
                    "The Confluence connector requires the httpx package"
                ) from exc
            client = httpx.Client(follow_redirects=False)
            self._client = client
        try:
            response = client.get(
                url,
                headers=self._headers(),
                params=params,
                timeout=self._timeout,
            )
        except DocumentIngestionError:
            raise
        except Exception as exc:
            raise DocumentIngestionError("Confluence request failed") from exc
        status_code = getattr(response, "status_code", None)
        if not isinstance(status_code, int) or not 200 <= status_code < 300:
            status = status_code if isinstance(status_code, int) else "unknown"
            raise DocumentIngestionError(
                f"Confluence request failed with status {status}"
            )
        try:
            return response.json()
        except Exception as exc:
            raise DocumentIngestionError("Confluence returned invalid JSON") from exc

    @staticmethod
    def _page_api_url(host: str, page_id: str) -> str:
        return f"https://{host}/wiki/api/v2/pages/{quote(page_id, safe='')}"

    @staticmethod
    def _children_api_url(host: str, page_id: str) -> str:
        return f"https://{host}/wiki/api/v2/pages/{quote(page_id, safe='')}/children"


class _StorageTextParser(HTMLParser):
    _BLOCK_TAGS = {
        "address",
        "article",
        "aside",
        "blockquote",
        "div",
        "dl",
        "dt",
        "dd",
        "figure",
        "figcaption",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "li",
        "main",
        "nav",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "tr",
        "ul",
    }
    _IGNORED_TAGS = {"script", "style"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in self._IGNORED_TAGS:
            self._ignored_depth += 1
            return
        if self._ignored_depth:
            return
        if tag in self._BLOCK_TAGS or tag == "br":
            self.parts.append("\n")
        if tag == "li":
            self.parts.append("- ")
        elif tag in {"td", "th"}:
            self.parts.append(" | ")
        elif tag == "img":
            alt = next((value for name, value in attrs if name.lower() == "alt"), None)
            if alt:
                self.parts.append(alt)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self._IGNORED_TAGS:
            if self._ignored_depth:
                self._ignored_depth -= 1
            return
        if not self._ignored_depth and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_comment(self, data: str) -> None:
        # HTMLParser exposes the XML CDATA used by Confluence macros as a comment.
        if (
            not self._ignored_depth
            and data.startswith("[CDATA[")
            and data.endswith("]]")
        ):
            self.parts.append(data[7:-2])

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)

    def unknown_decl(self, data: str) -> None:
        # Confluence storage uses CDATA in code/plain-text macro bodies.
        if not self._ignored_depth and data.startswith("CDATA["):
            self.parts.append(data[6:])


def storage_html_to_text(value: str) -> str:
    """Convert Confluence storage-format HTML/XML to stable, readable plain text."""
    parser = _StorageTextParser()
    try:
        parser.feed(value)
        parser.close()
    except Exception as exc:
        raise DocumentIngestionError(
            "Confluence page contains invalid storage HTML"
        ) from exc
    text = "".join(parser.parts).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def _parse_page_urls(value: Any) -> tuple[ConfluencePage, ...]:
    if isinstance(value, str):
        value = (value,)
    if (
        not isinstance(value, Sequence)
        or isinstance(value, (bytes, bytearray))
        or not value
    ):
        raise ConnectorConfigurationError("pageUrls must be a non-empty list")
    if len(value) > MAX_PAGES:
        raise ConnectorConfigurationError(
            f"pageUrls cannot contain more than {MAX_PAGES} pages"
        )

    pages: list[ConfluencePage] = []
    seen_ids: set[str] = set()
    expected_host: str | None = None
    for item in value:
        page = _parse_page_url(item)
        if expected_host is None:
            expected_host = page.host
        elif page.host != expected_host:
            raise ConnectorConfigurationError(
                "All pageUrls in a Confluence resource must use the same "
                "Atlassian Cloud host; create another resource for a different site"
            )
        if page.page_id not in seen_ids:
            seen_ids.add(page.page_id)
            pages.append(page)
    return tuple(pages)


def _parse_page_url(value: Any) -> ConfluencePage:
    if not isinstance(value, str) or not value.strip() or len(value) > 2_048:
        raise ConnectorConfigurationError(
            "Each Confluence page URL must be a non-empty string"
        )
    source_url = value.strip()
    parsed = urlparse(source_url)
    host = parsed.hostname
    try:
        port = parsed.port
    except ValueError as exc:
        raise ConnectorConfigurationError(
            "Confluence page URLs must use HTTPS on an *.atlassian.net host"
        ) from exc
    if (
        parsed.scheme != "https"
        or not isinstance(host, str)
        or not host.endswith(".atlassian.net")
        or host == ".atlassian.net"
        or port not in {None, 443}
    ):
        raise ConnectorConfigurationError(
            "Confluence page URLs must use HTTPS on an *.atlassian.net host"
        )
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ConnectorConfigurationError(
            "Confluence page URLs cannot contain credentials or parameters"
        )
    if parsed.path != "/wiki" and not parsed.path.startswith("/wiki/"):
        raise ConnectorConfigurationError(
            "Confluence page URLs must have a path under /wiki"
        )
    match = _PAGE_PATH.search(parsed.path)
    if match is None:
        raise ConnectorConfigurationError(
            "Confluence page URLs must contain a /pages/{id} path"
        )
    return ConfluencePage(
        host=host.lower(), page_id=match.group(1), source_url=source_url
    )


def _page_body(payload: Any) -> tuple[str, str | None]:
    if not isinstance(payload, Mapping):
        raise DocumentIngestionError("Confluence returned an invalid page response")
    body = payload.get("body")
    storage = body.get("storage") if isinstance(body, Mapping) else None
    value = storage.get("value") if isinstance(storage, Mapping) else None
    if not isinstance(value, str):
        raise DocumentIngestionError("Confluence returned an invalid page response")
    version = payload.get("version")
    number = version.get("number") if isinstance(version, Mapping) else None
    if isinstance(number, (str, int)) and not isinstance(number, bool):
        revision = str(number)
    else:
        raise DocumentIngestionError("Confluence returned an invalid page response")
    return value, revision


def _next_cursor(payload: Mapping[str, Any], endpoint: str, host: str) -> str | None:
    links = payload.get("_links")
    next_link = links.get("next") if isinstance(links, Mapping) else None
    if next_link is None:
        return None
    if not isinstance(next_link, str) or not next_link:
        raise DocumentIngestionError("Confluence returned an invalid pagination link")
    parsed = urlparse(next_link)
    if parsed.scheme or parsed.netloc:
        try:
            port = parsed.port
        except ValueError as exc:
            raise DocumentIngestionError(
                "Confluence returned an unsafe pagination link"
            ) from exc
        if (
            parsed.scheme != "https"
            or parsed.hostname != host
            or port not in {None, 443}
            or parsed.username
            or parsed.password
        ):
            raise DocumentIngestionError(
                "Confluence returned an unsafe pagination link"
            )
    expected_path = urlparse(endpoint).path
    if parsed.path != expected_path or parsed.fragment:
        raise DocumentIngestionError("Confluence returned an unsafe pagination link")
    query = parse_qs(parsed.query, keep_blank_values=True)
    cursors = query.get("cursor")
    if not cursors or len(cursors) != 1 or not cursors[0] or len(cursors[0]) > 2_048:
        raise DocumentIngestionError("Confluence returned an invalid pagination link")
    return cursors[0]


def _canonical_page_url(host: str, page_id: str) -> str:
    return f"https://{host}/wiki/pages/{quote(page_id, safe='')}"


def _source_path(page_id: str) -> str:
    return f"confluence/{page_id}.txt"


def _validate_source_subpath(source_subpath: str) -> None:
    if source_subpath != ".":
        raise DocumentIngestionError(
            "The Confluence connector does not support source subpaths"
        )
