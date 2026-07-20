from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from .base import ConnectorConfigurationError, DocumentConnector
from .confluence import ConfluenceDocumentConnector
from .github import GitHubDocumentConnector
from .local import LocalDocumentConnector


ConnectorFactory = Callable[[Mapping[str, Any]], DocumentConnector]


class ConnectorRegistry:
    """An explicit, inspectable mapping of connector names to factories."""

    def __init__(self, factories: Mapping[str, ConnectorFactory] | None = None) -> None:
        self._factories: dict[str, ConnectorFactory] = dict(factories or {})

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._factories))

    def register(self, name: str, factory: ConnectorFactory) -> None:
        if not name or name in self._factories:
            raise ConnectorConfigurationError(f"Connector is already registered: {name}")
        self._factories[name] = factory

    def create(
        self, connector_type: str, config: Mapping[str, Any] | None = None
    ) -> DocumentConnector:
        try:
            factory = self._factories[connector_type]
        except KeyError as exc:
            raise ConnectorConfigurationError(f"Unknown connector type: {connector_type}") from exc
        return factory(config or {})


CONNECTOR_REGISTRY = ConnectorRegistry(
    {
        "confluence": ConfluenceDocumentConnector.from_config,
        "github": GitHubDocumentConnector.from_config,
        "local": LocalDocumentConnector.from_config,
    }
)


def connector_descriptors() -> tuple[dict[str, Any], ...]:
    """Return public, non-secret metadata used to build the manager UI."""
    return (
        {
            "type": "local",
            "label": "Local project folder",
            "configurationFields": ["sourceSubpath"],
            "requirements": [],
        },
        {
            "type": "github",
            "label": "GitHub repository",
            "configurationFields": [
                "repository",
                "ref",
                "includePaths",
                "excludePaths",
                "tokenEnvVar",
            ],
            "requirements": ["httpx==0.28.1"],
        },
        {
            "type": "confluence",
            "label": "Confluence Cloud pages",
            "configurationFields": [
                "pageUrls",
                "includeDescendants",
                "accountEmail",
                "tokenEnvVar",
            ],
            "requirements": ["httpx==0.28.1"],
        },
    )


def create_connector(
    connector_type: str, config: Mapping[str, Any] | None = None
) -> DocumentConnector:
    return CONNECTOR_REGISTRY.create(connector_type, config)
