from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path
from typing import Any, Mapping

from .base import (
    ConnectionTestResult,
    ConnectorConfigurationError,
    DocumentIngestionError,
    DocumentScan,
    RejectedDocument,
    SourceDocument,
)


DEFAULT_PROJECT_DOCS_ROOT = Path.home() / "inovaare_1" / "revamped_KB" / "docs"
SUPPORTED_DOCUMENT_SUFFIXES = {".md", ".txt"}


class LocalDocumentConnector:
    """Read a bounded set of local Markdown/text files without following links."""

    connector_type = "local"

    def __init__(
        self,
        root: Path | str = DEFAULT_PROJECT_DOCS_ROOT,
        *,
        max_file_bytes: int = 1_000_000,
        max_total_bytes: int = 10_000_000,
        max_files: int = 500,
    ) -> None:
        self.root = Path(root).expanduser()
        self.max_file_bytes = _positive_limit("max_file_bytes", max_file_bytes)
        self.max_total_bytes = _positive_limit("max_total_bytes", max_total_bytes)
        self.max_files = _positive_limit("max_files", max_files)

    @classmethod
    def from_config(cls, config: Mapping[str, Any]) -> LocalDocumentConnector:
        aliases = {
            "root": "root",
            "maxFileBytes": "max_file_bytes",
            "max_file_bytes": "max_file_bytes",
            "maxTotalBytes": "max_total_bytes",
            "max_total_bytes": "max_total_bytes",
            "maxFiles": "max_files",
            "max_files": "max_files",
        }
        unknown = sorted(set(config) - set(aliases))
        if unknown:
            raise ConnectorConfigurationError(
                f"Unknown local connector configuration: {', '.join(unknown)}"
            )
        normalized: dict[str, Any] = {}
        for key, value in config.items():
            canonical = aliases[key]
            if canonical in normalized and normalized[canonical] != value:
                raise ConnectorConfigurationError(f"Conflicting values for {canonical}")
            normalized[canonical] = value
        return cls(
            normalized.get("root", DEFAULT_PROJECT_DOCS_ROOT),
            max_file_bytes=normalized.get("max_file_bytes", 1_000_000),
            max_total_bytes=normalized.get("max_total_bytes", 10_000_000),
            max_files=normalized.get("max_files", 500),
        )

    def _source_root(self, source_subpath: str) -> tuple[Path, Path]:
        relative_source = Path(source_subpath)
        if not source_subpath or relative_source.is_absolute() or ".." in relative_source.parts:
            raise DocumentIngestionError("Document source must be a relative path")
        try:
            configured_root = self.root.resolve(strict=True)
            candidate = configured_root
            for component in relative_source.parts:
                candidate = candidate / component
                if candidate.is_symlink():
                    raise DocumentIngestionError("Document source cannot contain symlinks")
            source_root = (configured_root / source_subpath).resolve(strict=True)
            source_root.relative_to(configured_root)
        except DocumentIngestionError:
            raise
        except (FileNotFoundError, RuntimeError, ValueError) as exc:
            raise DocumentIngestionError(
                "Document source is missing or outside the configured root"
            ) from exc
        if not source_root.is_dir():
            raise DocumentIngestionError("Document source must be a directory")
        return configured_root, source_root

    def test_connection(self, source_subpath: str = ".") -> ConnectionTestResult:
        try:
            self._source_root(source_subpath)
        except DocumentIngestionError as exc:
            return ConnectionTestResult(False, str(exc))
        return ConnectionTestResult(True, "Local document root is readable")

    def scan(self, source_subpath: str = ".") -> DocumentScan:
        configured_root, source_root = self._source_root(source_subpath)
        accepted: list[SourceDocument] = []
        rejected: list[RejectedDocument] = []
        total_bytes = 0
        skipped_unsupported = 0

        for directory, directory_names, file_names in os.walk(source_root, followlinks=False):
            directory_path = Path(directory)
            safe_directories = []
            for name in sorted(directory_names):
                candidate = directory_path / name
                if candidate.is_symlink():
                    rejected.append(
                        RejectedDocument(self._display_path(candidate, configured_root), "symlink")
                    )
                else:
                    safe_directories.append(name)
            directory_names[:] = safe_directories

            for name in sorted(file_names):
                candidate = directory_path / name
                if candidate.suffix.lower() not in SUPPORTED_DOCUMENT_SUFFIXES:
                    skipped_unsupported += 1
                    continue
                display_path = self._display_path(candidate, configured_root)
                if len(accepted) >= self.max_files:
                    rejected.append(RejectedDocument(display_path, "file-count-limit"))
                    continue
                try:
                    if candidate.is_symlink():
                        raise DocumentIngestionError("symlink")
                    resolved = candidate.resolve(strict=True)
                    resolved.relative_to(source_root)
                    file_stat = resolved.stat(follow_symlinks=False)
                    if not stat.S_ISREG(file_stat.st_mode):
                        raise DocumentIngestionError("not-a-regular-file")
                    if file_stat.st_size > self.max_file_bytes:
                        raise DocumentIngestionError("file-size-limit")
                    if total_bytes + file_stat.st_size > self.max_total_bytes:
                        raise DocumentIngestionError("total-size-limit")
                    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                    descriptor = os.open(resolved, flags)
                    try:
                        chunks = []
                        remaining = self.max_file_bytes + 1
                        while remaining:
                            chunk = os.read(descriptor, min(65_536, remaining))
                            if not chunk:
                                break
                            chunks.append(chunk)
                            remaining -= len(chunk)
                        data = b"".join(chunks)
                        opened_stat = os.fstat(descriptor)
                    finally:
                        os.close(descriptor)
                    if not stat.S_ISREG(opened_stat.st_mode) or len(data) > self.max_file_bytes:
                        raise DocumentIngestionError("file-size-limit")
                    if total_bytes + len(data) > self.max_total_bytes:
                        raise DocumentIngestionError("total-size-limit")
                    content = data.decode("utf-8")
                except UnicodeDecodeError:
                    rejected.append(RejectedDocument(display_path, "invalid-utf8"))
                    continue
                except (
                    DocumentIngestionError,
                    FileNotFoundError,
                    OSError,
                    RuntimeError,
                    ValueError,
                ) as exc:
                    rejected.append(RejectedDocument(display_path, str(exc) or "unsafe-file"))
                    continue

                total_bytes += len(data)
                accepted.append(
                    SourceDocument(
                        source_path=display_path,
                        content_hash=_sha256(data),
                        content=content,
                        size_bytes=len(data),
                    )
                )

        accepted.sort(key=lambda item: item.source_path)
        rejected.sort(key=lambda item: item.source_path)
        return DocumentScan(tuple(accepted), tuple(rejected), skipped_unsupported)

    @staticmethod
    def _display_path(path: Path, configured_root: Path) -> str:
        try:
            return path.relative_to(configured_root).as_posix()
        except ValueError:
            return path.name


def _positive_limit(name: str, value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ConnectorConfigurationError(f"{name} must be a positive integer")
    return value


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
