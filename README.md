# Compliance Simulation Platform

Compliance training prototype with a React frontend and a FastAPI backend backed by PostgreSQL persistence. The platform now also includes the first Ollama-powered AI simulation foundation alongside the original static flows.

## What is included

- Employee login with seeded users
- Home dashboard with daily challenge, topic focus and recommendations
- API-backed scenario simulations with branching decisions and replay insights
- Red Flag Lab exercises
- Investigation Mode with evidence review and final dispositions
- Pressure Tests
- Static Compliance Coach with topic browsing and search
- Learning profile with topic scores, recommendations, activity history and badges
- Scenario Library with filters
- Manager Dashboard with aggregate analytics
- Settings and demo reset
- Ollama-backed AI simulation endpoints with free-text turn handling

## Project structure

- `Compliance AI Agent/`: Vite + React frontend
- `backend/`: FastAPI backend
- PostgreSQL is now the persistence layer

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

The backend runs on `http://127.0.0.1:8000` by default.

## Frontend setup

```bash
cd "Compliance AI Agent"
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
cd "Compliance AI Agent"
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
- Ollama integration, token guards, and AI simulation orchestration live in `backend/app/ai.py` and `backend/app/main.py`.
- Initial AI endpoints:
  - `GET /api/ai/status`
  - `POST /api/ai/simulations`
  - `GET /api/ai/simulations/{session_id}`
  - `POST /api/ai/simulations/{session_id}/turns`
- Demo reset removes live attempts and resets settings while keeping seeded history.
# Compliance-Simulation-Hub
