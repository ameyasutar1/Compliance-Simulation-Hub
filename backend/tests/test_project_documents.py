from pathlib import Path

import pytest

from backend.app.project_documents import DocumentIngestionError, LocalDocumentConnector


def test_local_connector_ingests_supported_files_and_tracks_sources(tmp_path: Path):
    (tmp_path / "architecture").mkdir()
    (tmp_path / "overview.md").write_text("# Overview\nA grounded overview.", encoding="utf-8")
    (tmp_path / "architecture" / "runbook.txt").write_text("Safe operational steps.", encoding="utf-8")
    (tmp_path / "metadata.json").write_text("{}", encoding="utf-8")

    scan = LocalDocumentConnector(tmp_path).scan()

    assert [item.source_path for item in scan.documents] == ["architecture/runbook.txt", "overview.md"]
    assert all(len(item.content_hash) == 64 for item in scan.documents)
    assert scan.skipped_unsupported == 1
    assert len(scan.manifest_hash) == 64


def test_local_connector_rejects_links_large_files_and_traversal(tmp_path: Path):
    docs = tmp_path / "docs"
    docs.mkdir()
    outside = tmp_path / "outside.md"
    outside.write_text("outside", encoding="utf-8")
    (docs / "large.md").write_text("x" * 20, encoding="utf-8")
    (docs / "linked.md").symlink_to(outside)

    scan = LocalDocumentConnector(docs, max_file_bytes=10).scan()

    assert {(item.source_path, item.reason) for item in scan.rejected} == {
        ("large.md", "file-size-limit"),
        ("linked.md", "symlink"),
    }
    with pytest.raises(DocumentIngestionError):
        LocalDocumentConnector(docs).scan("../")


def test_local_connector_rejects_symlinked_source_directory(tmp_path: Path):
    real = tmp_path / "real"
    real.mkdir()
    (real / "source.md").write_text("safe", encoding="utf-8")
    (tmp_path / "linked").symlink_to(real, target_is_directory=True)

    with pytest.raises(DocumentIngestionError, match="symlink"):
        LocalDocumentConnector(tmp_path).scan("linked")
