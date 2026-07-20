from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


class DocumentIngestionError(ValueError):
    """Raised when a configured document source cannot be read safely."""


class ConnectorConfigurationError(ValueError):
    """Raised when connector configuration is invalid or unsafe."""


@dataclass(frozen=True)
class SourceDocument:
    source_path: str
    content_hash: str
    content: str
    size_bytes: int
    source_url: str | None = None
    revision: str | None = None


@dataclass(frozen=True)
class RejectedDocument:
    source_path: str
    reason: str


@dataclass(frozen=True)
class DocumentScan:
    documents: tuple[SourceDocument, ...]
    rejected: tuple[RejectedDocument, ...]
    skipped_unsupported: int = 0

    @property
    def manifest_hash(self) -> str:
        digest = hashlib.sha256()
        for document in sorted(self.documents, key=lambda item: item.source_path):
            digest.update(document.source_path.encode("utf-8"))
            digest.update(b"\0")
            digest.update(document.content_hash.encode("ascii"))
            digest.update(b"\0")
        return digest.hexdigest()


@dataclass(frozen=True)
class ConnectionTestResult:
    ok: bool
    message: str

    @property
    def success(self) -> bool:
        """A readable alias for callers that prefer ``success``."""
        return self.ok

    def __bool__(self) -> bool:
        return self.ok


@runtime_checkable
class DocumentConnector(Protocol):
    connector_type: str

    def test_connection(self, source_subpath: str = ".") -> ConnectionTestResult: ...

    def scan(self, source_subpath: str = ".") -> DocumentScan: ...
