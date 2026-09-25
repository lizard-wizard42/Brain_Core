#!/bin/sh
set -eu

# This volume is private to the Compose project. Generate the database password
# once, before the official PostgreSQL entrypoint initializes the database.
secret_file="${POSTGRES_PASSWORD_FILE:-/run/brain-core-secrets/postgres_password}"
if [ ! -s "$secret_file" ]; then
  umask 077
  mkdir -p "$(dirname "$secret_file")"
  if [ -n "${BRAIN_CORE_POSTGRES_PASSWORD:-}" ]; then
    printf '%s' "$BRAIN_CORE_POSTGRES_PASSWORD" > "$secret_file"
  else
    head -c 48 /dev/urandom | base64 | tr -d '\n' > "$secret_file"
  fi
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
