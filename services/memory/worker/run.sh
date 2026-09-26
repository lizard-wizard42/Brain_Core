#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
CELTWO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)"

cd "$CELTWO_ROOT"

exec "$SCRIPT_DIR/../.venv/bin/python" -m services.memory.worker.worker
