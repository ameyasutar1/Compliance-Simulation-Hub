# Compliance Game POC

Standalone Phaser experimentation sandbox for preloaded compliance scenarios. The production hybrid implementation is embedded in `frontend/src/game/` and records decisions through FastAPI.

## Run

```bash
cd game-poc
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

## Build

```bash
cd game-poc
npm run build
```

## Current Game Loop

- Pick a preloaded compliance case.
- Read the artifact and live event.
- Choose the control action before the timer expires.
- Receive consequence feedback and control score changes.
- Continue through data privacy, AML, and third-party risk cases.

## Integrated Mission Hub

Run the main application to use the top-down office experience with movement, animated NPCs, spoken scenarios and persistent results:

```bash
docker build -t compliance-simulation-platform .
docker run --rm -p 8000:8000 -v "$(pwd)/.pgdata:/var/lib/postgresql/data" compliance-simulation-platform
```
