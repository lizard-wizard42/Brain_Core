#!/usr/bin/env bash
# User-systemd installation: pause Memory writers so audio and SQLite agree.
set -euo pipefail
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
root="${BRAIN_PROJECT_ROOT:-$(CDPATH= cd -- "$script_dir/.." && pwd)}"
# Also serialize manual and timer runs before stopping any service.
mkdir -p "$root/backups"
chmod 700 "$root/backups"
exec 9>"$root/backups/.complete-backup.lock"
flock -n 9 || { echo 'Backup already running' >&2; exit 1; }
active=()
for unit in brain-core-gpu-worker.service brain-core-relabel.service brain-core-memory.service; do
  if systemctl --user is-active --quiet "$unit"; then active+=("$unit"); fi
done
restore_services() {
  local status=$?
  if ((${#active[@]})); then systemctl --user start "${active[@]}" || status=1; fi
  return "$status"
}
trap restore_services EXIT
if ((${#active[@]})); then systemctl --user stop "${active[@]}"; fi
export BRAIN_MEMORY_QUIESCED=true
cd "$root"
exec_node_status=0
node "$script_dir/backup-brain-core.mjs" || exec_node_status=$?
exit "$exec_node_status"
