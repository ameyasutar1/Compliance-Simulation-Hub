# Compliance Simulation Platform

Compliance training platform with a React shell, an embedded Phaser office mission hub, a FastAPI backend, PostgreSQL persistence, and an Ollama-powered AI simulation engine.

## What is included

- Employee login with seeded users
- Employee home with role-based pending and completed game training
- JSON-authored game levels with validated maps, furniture, conditions and branching decisions
- AI-assisted game routing constrained to scenario-authored branch candidates
- Grounded Policy Coach chatbot with approved-guidance fallback
- Learning profile with topic scores, recommendations, activity history and badges
- Scenario Library for launching interactive game levels
- Manager Dashboard with aggregate analytics
- Settings and demo reset
- Ollama-backed AI simulation endpoints with free-text turn handling
- Isometric Phaser environments with keyboard movement, walking characters, ambient music and consequence feedback
- Server-authoritative game decisions with PostgreSQL-backed scores, learning history and XP
- Validated scenario contracts that can safely accept reviewed AI-generated content later
- Project-specific onboarding sourced from multiple local folders, GitHub repositories, and Confluence Cloud page sets
- Manager-controlled project source sync, draft generation, review, publishing and assignment

## Project structure

- `frontend/`: Vite + React application and embedded Phaser mission player
- `backend/`: FastAPI backend
- `backend/app/game_scenarios.py`: validated game-level schema and JSON loader
- `backend/app/game_levels/`: drop-in JSON game-level definitions
- `backend/app/llm_setup.py`: provider-neutral LLM adapter, currently configured for Ollama
- `game-poc/`: standalone Phaser experimentation sandbox
- PostgreSQL is now the persistence layer

## Project-specific onboarding POC

The `/projects` workspace adds project-specific learning after standard compliance training. Its
explicit connector registry supports approved local directories, read-only GitHub repositories,
and read-only Confluence Cloud pages. A project can combine multiple named resources of each type.
All connectors normalize content into the same source contract, so the downstream course and evaluation
engine remains source-independent.

The default POC source is:

```text
~/inovaare_1/revamped_KB/docs
```

Override it with `PROJECT_DOCS_ROOT`. A manager can sync the source, generate a traceable draft,
review and publish it, then assign it to employees. Employees must have at least one completed
standard training activity before starting project learning. Project scores are recorded in the
learning history without changing standard compliance-topic scores.

The lifecycle is:

```text
local/GitHub/Confluence resources -> aggregate sync + revision/hash manifest -> draft course -> manager publish -> assignment -> assessment
```

Private repositories use a read-only fine-grained token from an environment variable beginning
with `GITHUB_` or `PROJECT_GITHUB_`. Only the variable name is saved; token values are never stored.
Confluence Cloud uses an Atlassian account email plus an API-token environment variable beginning
with `CONFLUENCE_` or `PROJECT_CONFLUENCE_`, and likewise stores only the variable name.

The UI is available at `http://127.0.0.1:8000/projects`; APIs are under `/api/projects`.
See `docs/project-onboarding-poc.md` for the connector contract, endpoints, persistence model and
test strategy.

## Backend setup

The backend now expects PostgreSQL through `DATABASE_URL`.
It can also load Ollama settings from the repository-level `.env`.

Example:

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://compliance_user:compliance_password@127.0.0.1:5432/compliance_platform
python -m uvicorn app.main:app --reload
```

If you want to use the default local AI setup, copy `.env.example` to `.env` and keep Ollama running with:

```bash
ollama list
```

Expected defaults:

```text
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_SMALL_MODEL=gemma3:270m
OLLAMA_LARGE_MODEL=gemma3:4b
OLLAMA_CONTEXT_WINDOW=2048
```

`LLM_PROVIDER=ollama` is the current provider. To add OpenAI or Google later, implement another `LLMProvider` adapter in `backend/app/llm_setup.py`; simulation and game orchestration do not need to change.

## Add a game level

Create a `.json` file in `backend/app/game_levels/`. Use
`backend/app/game_levels/kyc-welcome-desk.json` as the complete example.

Each level can define:

- employee role and department assignments
- title, topic, difficulty, duration and objective
- player and mission-character positions
- room labels, walls, furniture and environment colors
- dialogue nodes, artifacts, decisions, score/risk effects and consequences
- deterministic branches or constrained `ai-assisted` branch candidates

The backend validates every JSON file at startup. AI routing can select only from
`possibleNextNodeIds`; invalid AI output or an unavailable model automatically uses
the authored `nextNodeId` fallback.

The included Deutsche Bank-themed levels are fictional training prototypes based
on public business descriptions and general compliance principles. They are not
official Deutsche Bank policy, controls or training content.

When the backend runs inside Docker, it automatically defaults Ollama to:

```text
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

The backend runs on `http://127.0.0.1:8000` by default.

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

The frontend expects the backend at `http://127.0.0.1:8000/api`.

Optional override:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000/api npm run dev
```

## Build

```bash
cd frontend
npm run build
```

## Docker

Build one image that serves:

- the FastAPI backend
- the built frontend
- a local PostgreSQL server inside the same container

Build the image:

```bash
docker build -t compliance-simulation-platform .
```

Run it on port `8000`:

```bash
docker run --rm -p 8000:8000 compliance-simulation-platform
```

On macOS with Ollama running on the host, the container will automatically try
`http://host.docker.internal:11434` for AI calls after rebuilding the image.

If you want to set it explicitly:

```bash
docker run --rm -p 8000:8000 \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  compliance-simulation-platform
```

On Linux, add the host gateway mapping:

```bash
docker run --rm -p 8000:8000 \
  --add-host=host.docker.internal:host-gateway \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  compliance-simulation-platform
```

Then open:

- `http://127.0.0.1:8000` for the frontend
- `http://127.0.0.1:8000/api/health` for the API health check

The container boots PostgreSQL first, creates the database and user if needed, then starts FastAPI.

Default in-container PostgreSQL values:

```text
POSTGRES_DB=compliance_platform
POSTGRES_USER=compliance_user
POSTGRES_PASSWORD=compliance_password
```

You can override them:

```bash
docker run --rm -p 8000:8000 \
  -e POSTGRES_DB=compliance_platform \
  -e POSTGRES_USER=compliance_user \
  -e POSTGRES_PASSWORD=compliance_password \
  compliance-simulation-platform
```

If you want Postgres data to persist across container restarts, mount `PGDATA`:

```bash
docker run --rm -p 8000:8000 \
  -v "$(pwd)/.pgdata:/var/lib/postgresql/data" \
  compliance-simulation-platform
```

## Notes

- Seed content is defined in `backend/app/seed_data.py`.
- Mutable progress is stored in PostgreSQL through `backend/app/db.py`.
- AI orchestration lives in `backend/app/ai.py` and `backend/app/main.py`; model transport and provider selection live only in `backend/app/llm_setup.py`.
- Phaser mission endpoints:
  - `GET /api/training/assignments`
  - `GET /api/game/scenarios`
  - `POST /api/game/sessions`
  - `GET /api/game/sessions/{attempt_id}`
  - `POST /api/game/sessions/{attempt_id}/decisions`
- Policy Coach endpoint:
  - `POST /api/coach/chat`
- Initial AI endpoints:
  - `GET /api/ai/status`
  - `POST /api/ai/simulations`
  - `GET /api/ai/simulations/{session_id}`
  - `POST /api/ai/simulations/{session_id}/turns`
- Demo reset removes live attempts and resets settings while keeping seeded history.
# Compliance-Simulation-Hub
