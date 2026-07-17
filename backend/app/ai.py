from __future__ import annotations

from typing import Any

from .llm_setup import LLMError, generate_json, llm_status


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


OllamaError = LLMError


def get_policy_guidance(topic_id: str) -> list[str]:
    return POLICY_GUIDANCE.get(topic_id, POLICY_GUIDANCE["conduct-risk"])


def ollama_status() -> dict[str, Any]:
    return llm_status()
