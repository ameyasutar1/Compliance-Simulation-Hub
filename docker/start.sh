#!/bin/sh

set -eu

export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
export POSTGRES_DB="${POSTGRES_DB:-compliance_platform}"
export POSTGRES_USER="${POSTGRES_USER:-compliance_user}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-compliance_password}"
export POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"

mkdir -p "$PGDATA" /var/run/postgresql
chown -R postgres:postgres "$PGDATA" /var/run/postgresql

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  su postgres -s /bin/sh -c "initdb -D '$PGDATA' --auth-local=trust --auth-host=scram-sha-256"
  su postgres -s /bin/sh -c "pg_ctl -D '$PGDATA' -o \"-c listen_addresses='127.0.0.1' -p $POSTGRES_PORT\" -w start"
  su postgres -s /bin/sh -c "psql --dbname=postgres -v ON_ERROR_STOP=1 -c \"DO \\\$\\\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$POSTGRES_USER') THEN CREATE ROLE $POSTGRES_USER LOGIN PASSWORD '$POSTGRES_PASSWORD'; ELSE ALTER ROLE $POSTGRES_USER WITH LOGIN PASSWORD '$POSTGRES_PASSWORD'; END IF; END \\\$\\\$;\""
  if ! su postgres -s /bin/sh -c "psql --dbname=postgres -tAc \"SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'\"" | grep -q 1; then
    su postgres -s /bin/sh -c "createdb -O $POSTGRES_USER $POSTGRES_DB"
  fi
  su postgres -s /bin/sh -c "pg_ctl -D '$PGDATA' -m fast -w stop"
fi

su postgres -s /bin/sh -c "pg_ctl -D '$PGDATA' -o \"-c listen_addresses='127.0.0.1' -p $POSTGRES_PORT\" -w start"

export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"

cleanup() {
  su postgres -s /bin/sh -c "pg_ctl -D '$PGDATA' -m fast -w stop" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

exec uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
