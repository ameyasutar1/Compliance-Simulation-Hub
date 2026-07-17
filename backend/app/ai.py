from __future__ import annotations

from typing import Any

from .llm_setup import LLMError, generate_json, llm_status


POLICY_GUIDANCE = {
    "aml": [
        "Pause the activity and investigate unusual payments, beneficiary changes, or attempts to avoid verification.",
        "These indicators may show that the transaction purpose or customer behavior does not match known activity.",
        "The purpose, beneficiary, source of funds, or customer behavior remains unexplained after review.",
    ],
    "kyc": [
        "Resolve material gaps in ownership, source of funds, and customer purpose before proceeding.",
        "Missing or inconsistent onboarding information prevents a complete, evidence-based customer assessment.",
        "Ownership, source of funds, identity, or the purpose of the relationship cannot be verified.",
    ],
    "data-privacy": [
        "Keep confidential or personal data in approved channels and share only what is necessary with authorized people.",
        "Personal email, informal messaging, and uncontrolled downloads can expose client information outside bank controls.",
        "The recipient, purpose, data classification, authorization, or transfer channel is unclear.",
    ],
    "sanctions": [
        "Hold the activity and review names, jurisdictions, beneficiaries, ownership, and supporting documents.",
        "A deadline or client assurance does not resolve a potential restricted-party or geographic exposure.",
        "The alert, beneficial ownership, geographic exposure, or supporting evidence remains unresolved.",
    ],
    "market-abuse": [
        "Do not trade, share, or act on potentially non-public price-sensitive information until it is cleared.",
        "Using or spreading restricted information can create market-abuse and information-barrier risk.",
        "You observe suspicious trading, unusual information requests, selective disclosure, or an accidental wall crossing.",
    ],
    "conduct-risk": [
        "Do not bypass the control; explain the concern, preserve evidence, and propose an approved route forward.",
        "Seniority, commercial value, and urgency do not transfer accountability or make a control optional.",
        "Pressure continues, the requester rejects the controlled route, or the required approval is absent.",
    ],
    "information-security": [
        "Use approved systems, named access, secure storage, and the minimum permissions required for the task.",
        "Shared credentials, uncontrolled environments, and informal file movement reduce accountability and expose data.",
        "An access request is suspicious, excessively privileged, unapproved, or requires a security-control workaround.",
    ],
    "third-party-risk": [
        "Verify the vendor, business need, approval, access scope, expiry, and monitoring before granting access.",
        "External access creates accountability, data-handling, concentration, and security risks that urgency does not remove.",
        "Vendor access is privileged, unmonitored, broader than necessary, shared, unapproved, or outside agreed terms.",
    ],
    "conflicts": [
        "Disclose relevant personal investments, accounts, outside activities, and relationships through the approved employee process.",
        "Personal financial interests can create an actual or perceived conflict and may also be subject to pre-clearance or trading restrictions.",
        "Disclosure or pre-clearance requirements are unclear, or you may hold restricted information.",
    ],
    "regulatory-reporting": [
        "Stop and assess any unresolved data-quality issue before submitting or certifying the report.",
        "A timely report is not compliant if material data is guessed, omitted, unsupported, or misleading.",
        "Evidence is missing, validation fails, a material omission exists, or accurate and timely submission is at risk.",
    ],
}


OllamaError = LLMError


def get_policy_guidance(topic_id: str) -> list[str]:
    return POLICY_GUIDANCE.get(topic_id, POLICY_GUIDANCE["conduct-risk"])


def ollama_status() -> dict[str, Any]:
    return llm_status()
