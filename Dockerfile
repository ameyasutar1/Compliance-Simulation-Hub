FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql postgresql-client \
    && POSTGRES_BIN_DIR="$(dirname "$(find /usr/lib/postgresql -type f -path '*/bin/postgres' -print -quit)")" \
    && ln -s "${POSTGRES_BIN_DIR}"/postgres /usr/local/bin/postgres \
    && ln -s "${POSTGRES_BIN_DIR}"/pg_ctl /usr/local/bin/pg_ctl \
    && ln -s "${POSTGRES_BIN_DIR}"/initdb /usr/local/bin/initdb \
    && ln -s "${POSTGRES_BIN_DIR}"/psql /usr/local/bin/psql \
    && ln -s "${POSTGRES_BIN_DIR}"/createdb /usr/local/bin/createdb \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
COPY backend/requirements-connectors-github.txt /app/backend/requirements-connectors-github.txt
COPY backend/requirements-connectors-confluence.txt /app/backend/requirements-connectors-confluence.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
COPY docker/start.sh /app/docker/start.sh

RUN chmod +x /app/docker/start.sh

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
    CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/api/health', timeout=2)"

CMD ["/app/docker/start.sh"]
