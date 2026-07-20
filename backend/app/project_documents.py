"""Backward-compatible imports for the project document connector API.

New connector implementations live in :mod:`backend.app.connectors`.  This
module remains as a stable facade for existing callers and stored POC tests.
"""

from .connectors import (
    DEFAULT_PROJECT_DOCS_ROOT,
    ConnectionTestResult,
    ConfluenceConnectorConfig,
    ConfluenceDocumentConnector,
    ConnectorConfigurationError,
    DocumentConnector,
    DocumentIngestionError,
    DocumentScan,
    GitHubConnectorConfig,
    GitHubDocumentConnector,
    LocalDocumentConnector,
    RejectedDocument,
    SourceDocument,
    create_connector,
)

__all__ = [
    "DEFAULT_PROJECT_DOCS_ROOT",
    "ConnectionTestResult",
    "ConfluenceConnectorConfig",
    "ConfluenceDocumentConnector",
    "ConnectorConfigurationError",
    "DocumentConnector",
    "DocumentIngestionError",
    "DocumentScan",
    "GitHubConnectorConfig",
    "GitHubDocumentConnector",
    "LocalDocumentConnector",
    "RejectedDocument",
    "SourceDocument",
    "create_connector",
]
