#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
CELTWO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"

cd "$CELTWO_ROOT"

exec "$SCRIPT_DIR/.venv/bin/uvicorn" services.memory.api.main:app \
    --host "${CELTWO_MEMORY_HOST:-127.0.0.1}" \
    --port "${CELTWO_MEMORY_PORT:-8765}"
