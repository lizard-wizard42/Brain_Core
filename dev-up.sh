#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PORT="${BACKEND_PORT:-3002}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FRONTEND_BACKEND_ORIGIN="${FRONTEND_BACKEND_ORIGIN:-http://localhost:${BACKEND_PORT}}"

if [[ ! -d "$BACKEND_DIR" || ! -d "$FRONTEND_DIR" ]]; then
  echo "Erro: backend/ e frontend/ não encontrados em $ROOT_DIR" >&2
  exit 1
fi

cleanup() {
  echo
  echo "[brain-core] Encerrando serviços..."
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[brain-core] Subindo backend (porta ${BACKEND_PORT})..."
(
  cd "$BACKEND_DIR"
  PORT="$BACKEND_PORT" npm run dev
) &
BACKEND_PID=$!

echo "[brain-core] Subindo frontend (porta ${FRONTEND_PORT})..."
(
  cd "$FRONTEND_DIR"
  PORT="$FRONTEND_PORT" \
  VITE_DEV_BACKEND_ORIGIN="$FRONTEND_BACKEND_ORIGIN" \
  npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

echo "[brain-core] Serviços iniciados."
echo "- Frontend: http://localhost:${FRONTEND_PORT}"
echo "- Backend:  http://localhost:${BACKEND_PORT}"
echo "- Proxy API do frontend: ${FRONTEND_BACKEND_ORIGIN}"
echo "Pressione Ctrl+C para encerrar ambos."

wait -n "$BACKEND_PID" "$FRONTEND_PID"
