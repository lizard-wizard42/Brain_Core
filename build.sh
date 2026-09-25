#!/usr/bin/env bash
# Gera o backend e os bundles do frontend.
set -euo pipefail

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

echo "=== Build backend ==="
(cd "$PROJECT_ROOT/backend" && npm run build)

echo "=== Build frontend ==="
(cd "$PROJECT_ROOT/frontend" && npm run build)

echo "=== Builds concluídos ==="
echo "Builds concluídos com sucesso."
