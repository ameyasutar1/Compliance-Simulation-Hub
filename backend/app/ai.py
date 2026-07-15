from __future__ import annotations

import json
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
)


POLICY_GUIDANCE = {
    "aml": [
        "Investigate unusual payments, beneficiary changes, and attempts to avoid customer verification.",
        "Escalate when transaction purpose or customer behavior does not align with known activity.",
        "Do not let urgency override due diligence or alert review steps.",
    ],
    "kyc": [
        "Validate ownership, source of funds, and customer purpose before proceeding.",
        "Missing or inconsistent onboarding information should trigger further review.",
        "Do not assume a familiar client is automatically low risk.",
    ],
    "data-privacy": [
        "Share confidential or personal data only through approved channels and on a need-to-know basis.",
        "Personal email, informal messaging, and uncontrolled downloads increase data leakage risk.",
        "When unsure, classify the data conservatively and escalate before sharing.",
    ],
    "sanctions": [
        "Review names, jurisdictions, beneficiaries, and supporting documents when alerts trigger.",
        "Do not override sanctions controls based only on business pressure or client urgency.",
        "Escalate when beneficial ownership or geographic exposure is unclear.",
    ],
    "market-abuse": [
        "Treat non-public price-sensitive information as restricted until cleared.",
        "Escalate suspicious trading behavior, unusual information requests, or selective disclosures.",
        "Do not discuss confidential deal or issuer information with unauthorized parties.",
    ],
    "conduct-risk": [
        "Challenge requests to bypass controls even when they come from senior stakeholders.",
        "Document concerns and use approved escalation channels under pressure.",
        "Short-term convenience is not a reason to weaken the control environment.",
    ],
    "information-security": [
        "Use approved systems, access paths, and storage locations for sensitive work.",
        "Avoid shared credentials, uncontrolled environments, and informal file movement.",
        "Escalate suspicious access requests or unexpected system workarounds.",
    ],
    "third-party-risk": [
        "Validate vendor need, access scope, approval, and monitoring before granting access.",
        "Temporary urgency does not remove onboarding or data handling requirements.",
        "Limit external access to the minimum necessary and review evidence carefully.",
    ],
    "conflicts": [
        "Disclose personal, financial, and relationship conflicts before acting.",
        "Avoid participating in decisions that could be influenced by personal interests.",
        "Escalate gifts, entertainment, and outside relationships when independence is at risk.",
    ],
    "regulatory-reporting": [
        "Reports must be complete, accurate, and timely, even under deadline pressure.",
        "Never guess, smooth over gaps, or defer validation until after submission.",
        "Escalate data quality issues early rather than accepting a misleading report.",
    ],
}


class OllamaError(RuntimeError):
    pass


def approximate_token_count(text: str) -> int:
    return max(1, len(text.split()))


def truncate_to_token_limit(text: str, max_tokens: int) -> str:
    words = text.split()
    if len(words) <= max_tokens:
        return text
    return " ".join(words[:max_tokens])


def compact_json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


def choose_model(task_size: str) -> str:
    return OLLAMA_SMALL_MODEL if task_size == "small" else OLLAMA_LARGE_MODEL


def get_policy_guidance(topic_id: str) -> list[str]:
    return POLICY_GUIDANCE.get(topic_id, POLICY_GUIDANCE["conduct-risk"])


def build_prompt(system_prompt: str, user_payload: dict[str, Any]) -> str:
    sections = [
        "SYSTEM:",
        system_prompt.strip(),
        "",
        "USER_PAYLOAD:",
        compact_json(user_payload),
        "",
        "Return only valid JSON.",
    ]
    prompt = "\n".join(sections)
    return truncate_to_token_limit(prompt, OLLAMA_MAX_INPUT_TOKENS)


def _post_json(path: str, payload: dict[str, Any], timeout: int = OLLAMA_TIMEOUT_SECONDS) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        f"{OLLAMA_BASE_URL}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise OllamaError(f"Ollama HTTP {exc.code}: {detail or exc.reason}") from exc
    except error.URLError as exc:
        raise OllamaError(f"Unable to reach Ollama at {OLLAMA_BASE_URL}: {exc.reason}") from exc


def _get_json(path: str, timeout: int = 5) -> dict[str, Any]:
    req = request.Request(f"{OLLAMA_BASE_URL}{path}", method="GET")
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise OllamaError(f"Ollama HTTP {exc.code}: {detail or exc.reason}") from exc
    except error.URLError as exc:
        raise OllamaError(f"Unable to reach Ollama at {OLLAMA_BASE_URL}: {exc.reason}") from exc


def parse_json_response(text: str) -> dict[str, Any]:
    candidate = text.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(candidate[start : end + 1])
    raise OllamaError("Model did not return valid JSON.")


def generate_json(
    *,
    system_prompt: str,
    user_payload: dict[str, Any],
    task_size: str,
    temperature: float = 0.3,
    max_output_tokens: int | None = None,
) -> dict[str, Any]:
    model = choose_model(task_size)
    prompt = build_prompt(system_prompt, user_payload)
    response = _post_json(
        "/api/generate",
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_ctx": OLLAMA_CONTEXT_WINDOW,
                "num_predict": min(max_output_tokens or OLLAMA_MAX_OUTPUT_TOKENS, OLLAMA_MAX_OUTPUT_TOKENS),
            },
        },
    )
    parsed = parse_json_response(response.get("response", ""))
    parsed["_meta"] = {
        "model": response.get("model", model),
        "promptTokensApprox": approximate_token_count(prompt),
        "responseTokensApprox": approximate_token_count(response.get("response", "")),
        "contextWindow": OLLAMA_CONTEXT_WINDOW,
    }
    return parsed


def ollama_status() -> dict[str, Any]:
    tags = _get_json("/api/tags")
    models = [
        {"name": model.get("name"), "size": model.get("size"), "modifiedAt": model.get("modified_at")}
        for model in tags.get("models", [])
    ]
    return {
        "baseUrl": OLLAMA_BASE_URL,
        "contextWindow": OLLAMA_CONTEXT_WINDOW,
        "smallModel": OLLAMA_SMALL_MODEL,
        "largeModel": OLLAMA_LARGE_MODEL,
        "models": models,
    }
