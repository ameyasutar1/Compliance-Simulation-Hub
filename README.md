# Compliance Simulation Platform

Rule-based compliance training prototype with a React frontend and a FastAPI backend backed by PostgreSQL persistence.

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

## Project structure

- `Compliance AI Agent/`: Vite + React frontend
- `backend/`: FastAPI backend
- PostgreSQL is now the persistence layer

## Backend setup

The backend now expects PostgreSQL through `DATABASE_URL`.

Example:

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://compliance_user:compliance_password@127.0.0.1:5432/compliance_platform
python -m uvicorn app.main:app --reload
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
- Demo reset removes live attempts and resets settings while keeping seeded history.
# Compliance-Simulation-Hub
