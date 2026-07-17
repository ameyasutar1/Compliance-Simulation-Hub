from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from urllib import error, request

from .config import (
    OLLAMA_BASE_URL,
    OLLAMA_CONTEXT_WINDOW,
    OLLAMA_LARGE_MODEL,
    OLLAMA_MAX_INPUT_TOKENS,
    OLLAMA_MAX_OUTPUT_TOKENS,
    OLLAMA_SMALL_MODEL,
    OLLAMA_TIMEOUT_SECONDS,
    env_str,
)


class LLMError(RuntimeError):
    pass


def approximate_token_count(text: str) -> int:
    return max(1, len(text.split()))


def truncate_to_token_limit(text: str, max_tokens: int) -> str:
    words = text.split()
    if len(words) <= max_tokens:
        return text
    return " ".join(words[:max_tokens])


def parse_json_response(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            candidate = "\n".join(lines[1:-1]).strip()

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    start = candidate.find("{")
    if start == -1:
        raise LLMError("Model did not return valid JSON.")

    depth = 0
    in_string = False
    escaped = False
    for index, char in enumerate(candidate[start:], start):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(candidate[start : index + 1])
                except json.JSONDecodeError as exc:
                    raise LLMError("Model did not return valid JSON.") from exc
    raise LLMError("Model did not return valid JSON.")


@dataclass(frozen=True)
class GenerationRequest:
    system_prompt: str
    user_payload: dict[str, Any]
    task_size: str = "large"
    temperature: float = 0.3
    max_output_tokens: int | None = None


class LLMProvider(ABC):
    """Provider contract used by every AI feature in the application."""

    name: str

    @abstractmethod
    def generate_json(self, generation: GenerationRequest) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def status(self) -> dict[str, Any]:
        raise NotImplementedError


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self) -> None:
        self.base_url = OLLAMA_BASE_URL.rstrip("/")
        self.small_model = OLLAMA_SMALL_MODEL
        self.large_model = OLLAMA_LARGE_MODEL
        self.context_window = OLLAMA_CONTEXT_WINDOW
        self.timeout = OLLAMA_TIMEOUT_SECONDS

    def _request_json(self, path: str, payload: dict[str, Any] | None = None, timeout: int | None = None) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers={"Content-Type": "application/json"} if body else {},
            method="POST" if body else "GET",
        )
        try:
            with request.urlopen(req, timeout=timeout or self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise LLMError(f"Ollama HTTP {exc.code}: {detail or exc.reason}") from exc
        except error.URLError as exc:
            raise LLMError(f"Unable to reach Ollama at {self.base_url}: {exc.reason}") from exc
        except TimeoutError as exc:
            raise LLMError(f"Ollama request timed out at {self.base_url}") from exc

    def generate_json(self, generation: GenerationRequest) -> dict[str, Any]:
        model = self.small_model if generation.task_size == "small" else self.large_model
        compact_payload = json.dumps(generation.user_payload, separators=(",", ":"), ensure_ascii=True)
        prompt = truncate_to_token_limit(
            f"SYSTEM:\n{generation.system_prompt.strip()}\n\nUSER_PAYLOAD:\n{compact_payload}\n\nReturn only valid JSON.",
            OLLAMA_MAX_INPUT_TOKENS,
        )
        response = self._request_json(
            "/api/generate",
            {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {
                    "temperature": generation.temperature,
                    "num_ctx": self.context_window,
                    "num_predict": min(
                        generation.max_output_tokens or OLLAMA_MAX_OUTPUT_TOKENS,
                        OLLAMA_MAX_OUTPUT_TOKENS,
                    ),
                },
            },
        )
        response_text = response.get("response", "")
        parsed = parse_json_response(response_text)
        parsed["_meta"] = {
            "provider": self.name,
            "model": response.get("model", model),
            "promptTokensApprox": approximate_token_count(prompt),
            "responseTokensApprox": approximate_token_count(response_text),
            "contextWindow": self.context_window,
        }
        return parsed

    def status(self) -> dict[str, Any]:
        tags = self._request_json("/api/tags", timeout=5)
        models = [
            {
                "name": model.get("name"),
                "size": model.get("size"),
                "modifiedAt": model.get("modified_at"),
            }
            for model in tags.get("models", [])
        ]
        return {
            "provider": self.name,
            "baseUrl": self.base_url,
            "contextWindow": self.context_window,
            "smallModel": self.small_model,
            "largeModel": self.large_model,
            "models": models,
        }


@lru_cache(maxsize=1)
def get_llm_provider() -> LLMProvider:
    provider_name = env_str("LLM_PROVIDER", "ollama").lower()
    if provider_name == "ollama":
        return OllamaProvider()
    raise LLMError(
        f"Unsupported LLM_PROVIDER '{provider_name}'. Add its adapter in backend/app/llm_setup.py."
    )


def generate_json(
    *,
    system_prompt: str,
    user_payload: dict[str, Any],
    task_size: str,
    temperature: float = 0.3,
    max_output_tokens: int | None = None,
) -> dict[str, Any]:
    return get_llm_provider().generate_json(
        GenerationRequest(
            system_prompt=system_prompt,
            user_payload=user_payload,
            task_size=task_size,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
    )


def llm_status() -> dict[str, Any]:
    return get_llm_provider().status()
