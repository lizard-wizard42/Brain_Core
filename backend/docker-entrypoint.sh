#!/bin/sh
set -eu

# Named volumes are created as root by Docker. Keep upload data writable by the
# unprivileged application process without requiring a host-side chmod.
mkdir -p /app/uploads
chown node:node /app/uploads

# Compose creates these values once in a private named volume. Explicit
# environment variables still take precedence for advanced deployments.
secret_dir="/run/brain-core-secrets"
if [ -z "${DB_PASSWORD:-}" ] && [ -s "$secret_dir/postgres_password" ]; then
  export DB_PASSWORD="$(cat "$secret_dir/postgres_password")"
fi
if [ -z "${JWT_SECRET:-}" ]; then
  jwt_file="$secret_dir/jwt_secret"
  mkdir -p "$secret_dir"
  if [ ! -s "$jwt_file" ]; then
    umask 077
    if [ -n "${BRAIN_CORE_JWT_SECRET:-}" ]; then
      printf '%s' "$BRAIN_CORE_JWT_SECRET" > "$jwt_file"
    else
      head -c 48 /dev/urandom | base64 | tr -d '\n' > "$jwt_file"
    fi
  fi
  export JWT_SECRET="$(cat "$jwt_file")"
fi

exec runuser -u node -- "$@"
