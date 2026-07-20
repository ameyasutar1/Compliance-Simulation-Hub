from __future__ import annotations

import base64
import binascii
import fnmatch
import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Mapping, Protocol, Sequence
from urllib.parse import quote, urlparse

from .base import (
    ConnectionTestResult,
    ConnectorConfigurationError,
    DocumentIngestionError,
    DocumentScan,
    RejectedDocument,
    SourceDocument,
)
from .local import SUPPORTED_DOCUMENT_SUFFIXES, _positive_limit


GITHUB_API_URL = "https://api.github.com"
DEFAULT_INCLUDE_PATTERNS = ("**/*.md", "**/*.txt")
_ENVIRONMENT_VARIABLE = re.compile(r"^(?:GITHUB|PROJECT_GITHUB)_[A-Z0-9_]+$")
_RAW_SECRET_KEYS = {
    "accessToken",
    "access_token",
    "authorization",
    "password",
    "secret",
    "token",
}


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
class GitHubConnectorConfig:
    owner: str
    repo: str
    ref: str = "main"
    include: tuple[str, ...] = DEFAULT_INCLUDE_PATTERNS
    exclude: tuple[str, ...] = ()
    token_env_var: str | None = None
    max_file_bytes: int = 1_000_000
    max_total_bytes: int = 10_000_000
    max_files: int = 500

    @property
    def repository_url(self) -> str:
        return f"https://github.com/{self.owner}/{self.repo}"

    @classmethod
    def from_mapping(cls, config: Mapping[str, Any]) -> GitHubConnectorConfig:
        raw_secrets = sorted(set(config) & _RAW_SECRET_KEYS)
        if raw_secrets:
            raise ConnectorConfigurationError(
                "GitHub credentials must use tokenEnvVar; raw token configuration is not allowed"
            )

        aliases = {
            "repository": "repository_url",
            "repositoryUrl": "repository_url",
            "repoUrl": "repository_url",
            "repository_url": "repository_url",
            "repo_url": "repository_url",
            "owner": "owner",
            "repo": "repo",
            "ref": "ref",
            "include": "include",
            "includePaths": "include",
            "exclude": "exclude",
            "excludePaths": "exclude",
            "tokenEnvVar": "token_env_var",
            "token_env_var": "token_env_var",
            "maxFileBytes": "max_file_bytes",
            "max_file_bytes": "max_file_bytes",
            "maxTotalBytes": "max_total_bytes",
            "max_total_bytes": "max_total_bytes",
            "maxFiles": "max_files",
            "max_files": "max_files",
        }
        unknown = sorted(set(config) - set(aliases) - _RAW_SECRET_KEYS)
        if unknown:
            raise ConnectorConfigurationError(
                f"Unknown GitHub connector configuration: {', '.join(unknown)}"
            )

        normalized: dict[str, Any] = {}
        for key, value in config.items():
            if key in _RAW_SECRET_KEYS:
                continue
            canonical = aliases[key]
            if canonical in normalized and normalized[canonical] != value:
                raise ConnectorConfigurationError(f"Conflicting values for {canonical}")
            normalized[canonical] = value

        repository_url = normalized.pop("repository_url", None)
        url_owner: str | None = None
        url_repo: str | None = None
        if repository_url is not None:
            url_owner, url_repo = _parse_repository_url(repository_url)
        owner = _identifier("owner", normalized.pop("owner", url_owner))
        repo = _identifier("repo", normalized.pop("repo", url_repo))
        if url_owner and (owner != url_owner or repo != url_repo):
            raise ConnectorConfigurationError(
                "repositoryUrl and owner/repo must identify the same repository"
            )

        ref = normalized.pop("ref", "main")
        if not isinstance(ref, str) or not ref.strip() or len(ref) > 255:
            raise ConnectorConfigurationError("ref must be a non-empty string")
        include_value = normalized.pop("include", DEFAULT_INCLUDE_PATTERNS)
        # An empty UI field means "all supported document types", not "no files".
        if include_value == [] or include_value == ():
            include_value = DEFAULT_INCLUDE_PATTERNS
        include = _patterns("include", include_value)
        exclude = _patterns("exclude", normalized.pop("exclude", ()), allow_empty=True)
        token_env_var = normalized.pop("token_env_var", None)
        if token_env_var is not None:
            if not isinstance(token_env_var, str) or not _ENVIRONMENT_VARIABLE.fullmatch(
                token_env_var
            ):
                raise ConnectorConfigurationError(
                    "tokenEnvVar must start with GITHUB_ or PROJECT_GITHUB_"
                )

        return cls(
            owner=owner,
            repo=repo,
            ref=ref.strip(),
            include=include,
            exclude=exclude,
            token_env_var=token_env_var,
            max_file_bytes=_positive_limit(
                "max_file_bytes", normalized.pop("max_file_bytes", 1_000_000)
            ),
            max_total_bytes=_positive_limit(
                "max_total_bytes", normalized.pop("max_total_bytes", 10_000_000)
            ),
            max_files=_positive_limit("max_files", normalized.pop("max_files", 500)),
        )


class GitHubDocumentConnector:
    """Read Markdown/text blobs from a GitHub repository without modifying it."""

    connector_type = "github"

    def __init__(
        self,
        config: GitHubConnectorConfig | Mapping[str, Any] | str | None = None,
        *,
        repository_url: str | None = None,
        owner: str | None = None,
        repo: str | None = None,
        ref: str = "main",
        include: Sequence[str] = DEFAULT_INCLUDE_PATTERNS,
        exclude: Sequence[str] = (),
        token_env_var: str | None = None,
        max_file_bytes: int = 1_000_000,
        max_total_bytes: int = 10_000_000,
        max_files: int = 500,
        client: HttpClient | None = None,
        environ: Mapping[str, str] | None = None,
        timeout: float = 15.0,
    ) -> None:
        if isinstance(config, GitHubConnectorConfig):
            if any(value is not None for value in (repository_url, owner, repo)):
                raise ConnectorConfigurationError(
                    "Pass either a GitHubConnectorConfig or individual repository fields"
                )
            parsed_config = config
        else:
            if isinstance(config, str):
                if repository_url is not None:
                    raise ConnectorConfigurationError("Repository URL was provided twice")
                repository_url = config
                config = None
            if config is not None:
                if any(value is not None for value in (repository_url, owner, repo)):
                    raise ConnectorConfigurationError(
                        "Pass either a configuration mapping or individual repository fields"
                    )
                parsed_config = GitHubConnectorConfig.from_mapping(config)
            else:
                parsed_config = GitHubConnectorConfig.from_mapping(
                    {
                        **({"repositoryUrl": repository_url} if repository_url else {}),
                        **({"owner": owner} if owner else {}),
                        **({"repo": repo} if repo else {}),
                        "ref": ref,
                        "include": include,
                        "exclude": exclude,
                        **({"tokenEnvVar": token_env_var} if token_env_var else {}),
                        "maxFileBytes": max_file_bytes,
                        "maxTotalBytes": max_total_bytes,
                        "maxFiles": max_files,
                    }
                )

        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0:
            raise ConnectorConfigurationError("timeout must be positive")
        self.config = parsed_config
        self._client = client
        self._environ = os.environ if environ is None else environ
        self._timeout = float(timeout)

    @classmethod
    def from_config(cls, config: Mapping[str, Any]) -> GitHubDocumentConnector:
        return cls(config)

    def test_connection(self, source_subpath: str = ".") -> ConnectionTestResult:
        try:
            _source_prefix(source_subpath)
            repository = self._request_json(self._repository_api_url())
            if not isinstance(repository, Mapping):
                raise DocumentIngestionError("GitHub returned an invalid repository response")
        except DocumentIngestionError as exc:
            return ConnectionTestResult(False, str(exc))
        return ConnectionTestResult(
            True,
            f"Connected to {self.config.owner}/{self.config.repo}",
        )

    def scan(self, source_subpath: str = ".") -> DocumentScan:
        prefix = _source_prefix(source_subpath)
        revision = self._resolve_revision()
        tree_url = (
            f"{self._repository_api_url()}/git/trees/"
            f"{quote(revision['tree_sha'], safe='')}"
        )
        tree_response = self._request_json(tree_url, params={"recursive": "1"})
        if not isinstance(tree_response, Mapping) or not isinstance(
            tree_response.get("tree"), list
        ):
            raise DocumentIngestionError("GitHub returned an invalid tree response")
        if tree_response.get("truncated") is True:
            raise DocumentIngestionError("GitHub repository tree is truncated")

        candidates: list[tuple[str, str, int]] = []
        skipped_unsupported = 0
        for entry in tree_response["tree"]:
            if not isinstance(entry, Mapping) or entry.get("type") != "blob":
                continue
            path = entry.get("path")
            sha = entry.get("sha")
            size = entry.get("size")
            if not _safe_repository_path(path) or not isinstance(sha, str):
                continue
            if prefix and path != prefix and not path.startswith(f"{prefix}/"):
                continue
            if not _matches(path, self.config.include) or _matches(path, self.config.exclude):
                continue
            if PurePosixPath(path).suffix.lower() not in SUPPORTED_DOCUMENT_SUFFIXES:
                skipped_unsupported += 1
                continue
            candidates.append((path, sha, size if isinstance(size, int) else -1))

        accepted: list[SourceDocument] = []
        rejected: list[RejectedDocument] = []
        total_bytes = 0
        for path, sha, advertised_size in sorted(candidates, key=lambda item: item[0]):
            if len(accepted) >= self.config.max_files:
                rejected.append(RejectedDocument(path, "file-count-limit"))
                continue
            if advertised_size < 0:
                rejected.append(RejectedDocument(path, "missing-size"))
                continue
            if advertised_size > self.config.max_file_bytes:
                rejected.append(RejectedDocument(path, "file-size-limit"))
                continue
            if total_bytes + advertised_size > self.config.max_total_bytes:
                rejected.append(RejectedDocument(path, "total-size-limit"))
                continue

            blob = self._request_json(
                f"{self._repository_api_url()}/git/blobs/{quote(sha, safe='')}"
            )
            try:
                if not isinstance(blob, Mapping) or blob.get("encoding") != "base64":
                    raise ValueError
                encoded_content = blob.get("content")
                if not isinstance(encoded_content, str):
                    raise ValueError
                compact_content = "".join(encoded_content.split())
                data = base64.b64decode(compact_content, validate=True)
            except (ValueError, binascii.Error):
                rejected.append(RejectedDocument(path, "invalid-response"))
                continue
            if len(data) > self.config.max_file_bytes:
                rejected.append(RejectedDocument(path, "file-size-limit"))
                continue
            if total_bytes + len(data) > self.config.max_total_bytes:
                rejected.append(RejectedDocument(path, "total-size-limit"))
                continue
            try:
                content = data.decode("utf-8")
            except UnicodeDecodeError:
                rejected.append(RejectedDocument(path, "invalid-utf8"))
                continue

            total_bytes += len(data)
            accepted.append(
                SourceDocument(
                    source_path=path,
                    content_hash=hashlib.sha256(data).hexdigest(),
                    content=content,
                    size_bytes=len(data),
                    source_url=(
                        f"{self.config.repository_url}/blob/"
                        f"{quote(revision['commit_sha'], safe='')}/{quote(path, safe='/')}"
                    ),
                    revision=revision["commit_sha"],
                )
            )

        return DocumentScan(tuple(accepted), tuple(rejected), skipped_unsupported)

    def _resolve_revision(self) -> dict[str, str]:
        response = self._request_json(
            f"{self._repository_api_url()}/commits/{quote(self.config.ref, safe='')}"
        )
        try:
            commit_sha = response["sha"]
            tree_sha = response["commit"]["tree"]["sha"]
        except (KeyError, TypeError):
            raise DocumentIngestionError("GitHub returned an invalid revision response")
        if not isinstance(commit_sha, str) or not isinstance(tree_sha, str):
            raise DocumentIngestionError("GitHub returned an invalid revision response")
        return {"commit_sha": commit_sha, "tree_sha": tree_sha}

    def _repository_api_url(self) -> str:
        return (
            f"{GITHUB_API_URL}/repos/{quote(self.config.owner, safe='')}"
            f"/{quote(self.config.repo, safe='')}"
        )

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "project-document-connector",
        }
        if self.config.token_env_var:
            token = self._environ.get(self.config.token_env_var)
            if not token:
                raise DocumentIngestionError(
                    f"GitHub credential environment variable {self.config.token_env_var} is not set"
                )
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _request_json(
        self, url: str, *, params: Mapping[str, str] | None = None
    ) -> Any:
        client = self._client
        if client is None:
            try:
                import httpx
            except ImportError as exc:  # pragma: no cover - exercised only without optional deps
                raise DocumentIngestionError(
                    "The GitHub connector requires the httpx package"
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
            raise DocumentIngestionError("GitHub request failed") from exc
        status_code = getattr(response, "status_code", None)
        if not isinstance(status_code, int) or not 200 <= status_code < 300:
            status = status_code if isinstance(status_code, int) else "unknown"
            raise DocumentIngestionError(f"GitHub request failed with status {status}")
        try:
            return response.json()
        except Exception as exc:
            raise DocumentIngestionError("GitHub returned invalid JSON") from exc


def _parse_repository_url(value: Any) -> tuple[str, str]:
    if not isinstance(value, str):
        raise ConnectorConfigurationError("repository must be a GitHub URL or owner/repo")
    repository = value.strip()
    if "://" not in repository:
        parts = repository.removesuffix(".git").split("/")
        if len(parts) != 2:
            raise ConnectorConfigurationError("repository must identify an owner and repository")
        return _identifier("owner", parts[0]), _identifier("repo", parts[1])
    parsed = urlparse(repository)
    if parsed.scheme != "https" or parsed.hostname not in {"github.com", "www.github.com"}:
        raise ConnectorConfigurationError("repositoryUrl must be a github.com HTTPS URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ConnectorConfigurationError("repositoryUrl cannot contain credentials or parameters")
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) != 2:
        raise ConnectorConfigurationError("repositoryUrl must identify an owner and repository")
    owner, repo = parts
    if repo.endswith(".git"):
        repo = repo[:-4]
    return _identifier("owner", owner), _identifier("repo", repo)


def _identifier(name: str, value: Any) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 100
        or value in {".", ".."}
        or not re.fullmatch(r"[A-Za-z0-9_.-]+", value)
    ):
        raise ConnectorConfigurationError(f"{name} is required and contains invalid characters")
    return value


def _patterns(name: str, value: Any, *, allow_empty: bool = False) -> tuple[str, ...]:
    if isinstance(value, str):
        value = (value,)
    if not isinstance(value, Sequence) or isinstance(value, (bytes, bytearray)):
        raise ConnectorConfigurationError(f"{name} must be a list of glob patterns")
    if len(value) > 100:
        raise ConnectorConfigurationError(f"{name} contains too many glob patterns")
    result: list[str] = []
    for pattern in value:
        if (
            not isinstance(pattern, str)
            or not pattern
            or len(pattern) > 256
            or pattern.startswith("/")
            or "\\" in pattern
            or ".." in PurePosixPath(pattern).parts
        ):
            raise ConnectorConfigurationError(f"{name} contains an invalid glob pattern")
        result.append(pattern)
    if not result and not allow_empty:
        raise ConnectorConfigurationError(f"{name} must contain at least one glob pattern")
    return tuple(result)


def _matches(path: str, patterns: Sequence[str]) -> bool:
    for pattern in patterns:
        if fnmatch.fnmatchcase(path, pattern):
            return True
        if pattern.startswith("**/") and fnmatch.fnmatchcase(path, pattern[3:]):
            return True
    return False


def _safe_repository_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or value.startswith("/"):
        return False
    return all(part not in {"", ".", ".."} for part in value.split("/"))


def _source_prefix(source_subpath: str) -> str:
    if not isinstance(source_subpath, str) or not source_subpath:
        raise DocumentIngestionError("Document source must be a relative path")
    normalized = source_subpath.rstrip("/")
    if normalized in {"", "."}:
        return ""
    if not _safe_repository_path(normalized):
        raise DocumentIngestionError("Document source must be a relative path")
    return normalized
