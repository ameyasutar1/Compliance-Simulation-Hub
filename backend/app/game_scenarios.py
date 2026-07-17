from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class WorldPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: int = Field(ge=80, le=1120)
    y: int = Field(ge=100, le=640)


class WorldCoordinate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0.4, le=13.6)
    y: float = Field(ge=0.4, le=9.6)


class SceneWall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x1: float = Field(ge=0, le=14)
    y1: float = Field(ge=0, le=10)
    x2: float = Field(ge=0, le=14)
    y2: float = Field(ge=0, le=10)


class SceneRoom(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0, le=14)
    y: float = Field(ge=0, le=10)
    label: str
    accent: str = "#4f70df"


class SceneFurniture(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["desk", "meeting-table", "server", "plant"]
    x: float = Field(ge=0, le=14)
    y: float = Field(ge=0, le=10)
    accent: str | None = None


class MissionScene(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = "Office floor"
    backdrop: str = "#86b8a8"
    backdropAccent: str = "#a7cec0"
    playerSpawn: WorldCoordinate = Field(default_factory=lambda: WorldCoordinate(x=7, y=5))
    walls: list[SceneWall] = Field(default_factory=list, max_length=24)
    rooms: list[SceneRoom] = Field(default_factory=list, max_length=8)
    furniture: list[SceneFurniture] = Field(default_factory=list, max_length=30)


class MissionWorld(BaseModel):
    model_config = ConfigDict(extra="forbid")

    room: str
    accent: str
    npc: WorldPoint
    missionSpot: WorldCoordinate | None = None
    scene: MissionScene | None = None


class MissionArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["email", "payment", "chat", "access-request", "trade-alert"]
    title: str
    body: str


class MissionChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    scoreDelta: int = Field(ge=-40, le=40)
    riskDelta: int = Field(ge=-40, le=40)
    consequence: str
    nextNodeId: str | None = None
    possibleNextNodeIds: list[str] = Field(default_factory=list, max_length=4)


class MissionNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    speaker: str
    message: str
    prompt: str
    artifact: MissionArtifact | None = None
    choices: list[MissionChoice] = Field(min_length=2, max_length=4)


class GameMission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["1.0", "1.1"] = "1.0"
    id: str
    title: str
    topicId: str
    topicName: str
    difficulty: Literal["Foundational", "Intermediate", "Advanced"]
    estimatedMinutes: int = Field(ge=2, le=20)
    brief: str
    objective: str
    startNodeId: str
    navigationMode: Literal["rules", "ai-assisted"] = "rules"
    assignmentRoles: list[str] = Field(default_factory=list)
    assignmentDepartments: list[str] = Field(default_factory=list)
    dueInDays: int = Field(default=14, ge=1, le=365)
    world: MissionWorld
    nodes: list[MissionNode] = Field(min_length=1, max_length=8)


MISSION_DATA = [
    {
        "id": "game-data-export",
        "title": "The Unapproved Export",
        "topicId": "data-privacy",
        "topicName": "Data Privacy",
        "difficulty": "Foundational",
        "estimatedMinutes": 5,
        "brief": "A senior sales director wants client data sent outside approved channels before a meeting.",
        "objective": "Protect the client data while preserving a workable business path.",
        "startNodeId": "privacy-brief",
        "world": {"room": "Operations Desk", "accent": "#4f7cff", "npc": {"x": 265, "y": 235}},
        "nodes": [
            {
                "id": "privacy-brief",
                "speaker": "Helen Park, Sales Director",
                "message": "The board call starts in ten minutes. Send the complete client export to my personal email because corporate mail is delayed.",
                "prompt": "How do you respond to the request?",
                "artifact": {
                    "type": "email",
                    "title": "Urgent client export request",
                    "body": "Attachment includes account numbers, phone numbers, email addresses and relationship notes.",
                },
                "choices": [
                    {
                        "id": "send-now",
                        "label": "Send it now because the requester is senior.",
                        "scoreDelta": -28,
                        "riskDelta": 34,
                        "consequence": "The file leaves the controlled environment and creates a reportable data exposure.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "secure-route",
                        "label": "Verify need and offer the approved secure transfer route.",
                        "scoreDelta": 26,
                        "riskDelta": -20,
                        "consequence": "You protect the data and keep the business request moving through an approved channel.",
                        "nextNodeId": "privacy-pressure",
                    },
                    {
                        "id": "silent-refusal",
                        "label": "Refuse without explanation and close the ticket.",
                        "scoreDelta": 4,
                        "riskDelta": -4,
                        "consequence": "The immediate leak is blocked, but the business has no safe route and pressure increases.",
                        "nextNodeId": "privacy-pressure",
                    },
                ],
            },
            {
                "id": "privacy-pressure",
                "speaker": "Helen Park, Sales Director",
                "message": "If the meeting fails, Operations will be named as the reason. I need a decision right now.",
                "prompt": "What control do you apply under pressure?",
                "choices": [
                    {
                        "id": "document-escalate",
                        "label": "Document the pressure and escalate to the data owner.",
                        "scoreDelta": 30,
                        "riskDelta": -24,
                        "consequence": "The request becomes auditable and the accountable owner approves a secure transfer.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "partial-send",
                        "label": "Send only half the file to the personal address.",
                        "scoreDelta": -18,
                        "riskDelta": 22,
                        "consequence": "Data minimization does not make an unapproved channel safe.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "deletion-promise",
                        "label": "Ask for a promise that the file will be deleted later.",
                        "scoreDelta": -12,
                        "riskDelta": 16,
                        "consequence": "An informal promise cannot replace authorization and channel controls.",
                        "nextNodeId": None,
                    },
                ],
            },
        ],
    },
    {
        "id": "game-payment-release",
        "title": "Two-Minute Payment",
        "topicId": "aml",
        "topicName": "AML",
        "difficulty": "Intermediate",
        "estimatedMinutes": 6,
        "brief": "A valuable client threatens to leave unless a payment with unusual beneficiary details is released.",
        "objective": "Resolve the payment risk without allowing urgency to override AML controls.",
        "startNodeId": "payment-alert",
        "world": {"room": "Compliance Desk", "accent": "#ef9c37", "npc": {"x": 625, "y": 220}},
        "nodes": [
            {
                "id": "payment-alert",
                "speaker": "Marco Bell, Relationship Manager",
                "message": "This is our biggest client. Release the payment now and we can investigate the alert after close of business.",
                "prompt": "Choose the release decision.",
                "artifact": {
                    "type": "payment",
                    "title": "Beneficiary mismatch alert",
                    "body": "Amount is 4.8x the usual pattern. Beneficiary country changed today. Purpose states consulting support.",
                },
                "choices": [
                    {
                        "id": "release-later-review",
                        "label": "Release now and review after close of business.",
                        "scoreDelta": -32,
                        "riskDelta": 38,
                        "consequence": "The transaction exits before the open AML indicators are resolved.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "hold-investigate",
                        "label": "Hold release, request support and escalate the alert.",
                        "scoreDelta": 28,
                        "riskDelta": -22,
                        "consequence": "The payment remains controlled while evidence is collected.",
                        "nextNodeId": "payment-evidence",
                    },
                    {
                        "id": "relationship-check",
                        "label": "Ask whether the relationship manager trusts the client.",
                        "scoreDelta": 2,
                        "riskDelta": 8,
                        "consequence": "Relationship context is not evidence and the beneficiary mismatch remains unresolved.",
                        "nextNodeId": "payment-evidence",
                    },
                ],
            },
            {
                "id": "payment-evidence",
                "speaker": "Payment Operations",
                "message": "The client supplied a new invoice with different wording, but the beneficiary account is unchanged.",
                "prompt": "What evidence do you require before release?",
                "choices": [
                    {
                        "id": "invoice-enough",
                        "label": "Accept the replacement invoice because the amount matches.",
                        "scoreDelta": -16,
                        "riskDelta": 18,
                        "consequence": "Document volume does not resolve ownership, purpose or source-of-funds concerns.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "ownership-purpose",
                        "label": "Verify ownership, payment purpose and source of funds.",
                        "scoreDelta": 32,
                        "riskDelta": -28,
                        "consequence": "The review identifies an unsupported intermediary and the payment is escalated correctly.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "client-message",
                        "label": "Tell the client that compliance is personally blocking them.",
                        "scoreDelta": -8,
                        "riskDelta": 12,
                        "consequence": "The message is uncontrolled and does not advance the investigation.",
                        "nextNodeId": None,
                    },
                ],
            },
        ],
    },
    {
        "id": "game-insider-signal",
        "title": "The Elevator Tip",
        "topicId": "market-abuse",
        "topicName": "Market Abuse",
        "difficulty": "Advanced",
        "estimatedMinutes": 7,
        "brief": "A colleague shares likely acquisition information and suggests acting before the market opens.",
        "objective": "Recognize inside information, restrict it and escalate without spreading it further.",
        "startNodeId": "tip-arrives",
        "world": {"room": "Trading Floor", "accent": "#dc5a6f", "npc": {"x": 925, "y": 505}},
        "nodes": [
            {
                "id": "tip-arrives",
                "speaker": "Alex Reid, Senior Trader",
                "message": "I heard legal discussing a takeover in the lift. Buy before open and we will be ahead of everyone.",
                "prompt": "What is your immediate response?",
                "artifact": {
                    "type": "trade-alert",
                    "title": "Unusual pre-open instruction",
                    "body": "Proposed order is 9x normal size in an issuer currently on the watch list.",
                },
                "choices": [
                    {
                        "id": "place-order",
                        "label": "Place the order because the information is only a rumour.",
                        "scoreDelta": -36,
                        "riskDelta": 40,
                        "consequence": "Potential inside information is used to trade, creating severe market-abuse exposure.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "stop-restrict",
                        "label": "Stop the order, restrict the information and contact Compliance.",
                        "scoreDelta": 34,
                        "riskDelta": -30,
                        "consequence": "Trading is stopped and the information is contained for formal review.",
                        "nextNodeId": "tip-followup",
                    },
                    {
                        "id": "ask-around",
                        "label": "Ask other traders whether they heard the same thing.",
                        "scoreDelta": -14,
                        "riskDelta": 20,
                        "consequence": "The potentially sensitive information spreads across the floor.",
                        "nextNodeId": "tip-followup",
                    },
                ],
            },
            {
                "id": "tip-followup",
                "speaker": "Alex Reid, Senior Trader",
                "message": "Do not make this formal. I was testing whether you could move quickly.",
                "prompt": "How do you preserve the evidence?",
                "choices": [
                    {
                        "id": "document-report",
                        "label": "Record the instruction and report through the approved channel.",
                        "scoreDelta": 30,
                        "riskDelta": -24,
                        "consequence": "The instruction is preserved without further disclosure and can be investigated.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "informal-warning",
                        "label": "Give an informal warning and keep no record.",
                        "scoreDelta": -12,
                        "riskDelta": 16,
                        "consequence": "The control failure remains invisible and the conduct can recur.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "group-chat",
                        "label": "Post a warning in the trading-floor group chat.",
                        "scoreDelta": -18,
                        "riskDelta": 24,
                        "consequence": "The warning distributes sensitive details to more people.",
                        "nextNodeId": None,
                    },
                ],
            },
        ],
    },
    {
        "id": "game-vendor-override",
        "title": "Weekend Access Override",
        "topicId": "third-party-risk",
        "topicName": "Third-Party Risk",
        "difficulty": "Intermediate",
        "estimatedMinutes": 6,
        "brief": "A vendor requests privileged access during a production outage but is missing from the approved roster.",
        "objective": "Restore service using a controlled emergency-access path.",
        "startNodeId": "vendor-access",
        "world": {"room": "Technology Support", "accent": "#20a486", "npc": {"x": 335, "y": 515}},
        "nodes": [
            {
                "id": "vendor-access",
                "speaker": "Priya Nair, Production Lead",
                "message": "The outage is growing. Give the vendor our shared admin account for eight hours so they can fix it.",
                "prompt": "Which access path do you choose?",
                "artifact": {
                    "type": "access-request",
                    "title": "Emergency privileged access",
                    "body": "Engineer is not on the current support roster. Request includes admin rights and file export permission.",
                },
                "choices": [
                    {
                        "id": "shared-admin",
                        "label": "Provide shared admin credentials and monitor later.",
                        "scoreDelta": -30,
                        "riskDelta": 36,
                        "consequence": "Shared access removes accountability during a high-risk production change.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "named-emergency",
                        "label": "Use named emergency access with limits, approval and logging.",
                        "scoreDelta": 32,
                        "riskDelta": -26,
                        "consequence": "Service restoration can proceed while actions remain attributable and scoped.",
                        "nextNodeId": "vendor-logs",
                    },
                    {
                        "id": "wait-monday",
                        "label": "Deny all vendor involvement until Monday.",
                        "scoreDelta": 4,
                        "riskDelta": 2,
                        "consequence": "Controls remain intact, but a valid emergency route was not used and impact grows.",
                        "nextNodeId": "vendor-logs",
                    },
                ],
            },
            {
                "id": "vendor-logs",
                "speaker": "Vendor Engineer",
                "message": "I need to export diagnostic logs containing customer identifiers to my laptop.",
                "prompt": "What handling requirements do you apply?",
                "choices": [
                    {
                        "id": "full-export",
                        "label": "Approve the full export to speed analysis.",
                        "scoreDelta": -18,
                        "riskDelta": 22,
                        "consequence": "Customer data leaves the controlled environment without minimization.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "masked-approved",
                        "label": "Minimize and mask logs, then use approved transfer.",
                        "scoreDelta": 28,
                        "riskDelta": -24,
                        "consequence": "The engineer receives the necessary diagnostics without uncontrolled customer data.",
                        "nextNodeId": None,
                    },
                    {
                        "id": "chat-promise",
                        "label": "Ask the vendor to promise in chat that they will be careful.",
                        "scoreDelta": -10,
                        "riskDelta": 14,
                        "consequence": "Informal assurance is not a data-handling control.",
                        "nextNodeId": None,
                    },
                ],
            },
        ],
    },
]


def _validate_mission(raw_mission: dict) -> GameMission:
    mission = GameMission.model_validate(raw_mission)
    node_ids = {node.id for node in mission.nodes}
    if len(node_ids) != len(mission.nodes):
        raise ValueError(f"Mission {mission.id} contains duplicate node ids")
    if mission.startNodeId not in node_ids:
        raise ValueError(f"Mission {mission.id} has an invalid startNodeId")
    for node in mission.nodes:
        choice_ids = {choice.id for choice in node.choices}
        if len(choice_ids) != len(node.choices):
            raise ValueError(f"Mission {mission.id} node {node.id} contains duplicate choice ids")
        for choice in node.choices:
            if choice.nextNodeId is not None and choice.nextNodeId not in node_ids:
                raise ValueError(f"Mission {mission.id} choice {choice.id} has an invalid nextNodeId")
            invalid_candidates = set(choice.possibleNextNodeIds) - node_ids
            if invalid_candidates:
                raise ValueError(
                    f"Mission {mission.id} choice {choice.id} has invalid AI branch candidates: "
                    f"{sorted(invalid_candidates)}"
                )
    return mission


def _load_json_missions() -> list[dict]:
    level_directory = Path(__file__).with_name("game_levels")
    if not level_directory.exists():
        return []

    missions = []
    for level_path in sorted(level_directory.glob("*.json")):
        payload = json.loads(level_path.read_text(encoding="utf-8"))
        entries = payload if isinstance(payload, list) else payload.get("missions", [payload])
        if not isinstance(entries, list):
            raise ValueError(f"Game level file {level_path.name} must contain a mission or missions list")
        missions.extend(entries)
    return missions


GAME_MISSIONS = [_validate_mission(item) for item in [*MISSION_DATA, *_load_json_missions()]]
if len({mission.id for mission in GAME_MISSIONS}) != len(GAME_MISSIONS):
    raise ValueError("Game mission ids must be unique across Python and JSON level definitions")
GAME_MISSIONS_BY_ID = {mission.id: mission for mission in GAME_MISSIONS}


def list_game_missions() -> list[dict]:
    return [mission.model_dump() for mission in GAME_MISSIONS]


def get_game_mission(mission_id: str) -> dict | None:
    mission = GAME_MISSIONS_BY_ID.get(mission_id)
    return mission.model_dump() if mission else None
