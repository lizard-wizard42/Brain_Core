#!/usr/bin/env bash
set -euo pipefail

failures=0

fail() {
  printf 'PUBLIC RELEASE CHECK: %s\n' "$1" >&2
  failures=1
}

# These paths are instance data or machine configuration, never source code for
# the public repository. Examples remain allowed because they contain no value.
blocked_paths="$(git ls-files | grep -E '(^|/)(backups/|uploads/|data/memory/|\.env($|\.)|.*\.(pem|key|p12|pfx|db|sqlite|sqlite3|m4a|wav|webm|ogg|opus|apk|aab|jks|keystore)$)' | grep -Ev '(^|/)\.env[^/]*\.example$' || true)"
if [[ -n "$blocked_paths" ]]; then
  printf '%s\n' "$blocked_paths" >&2
  fail 'tracked instance data, environment, database, or key file detected'
fi

# Fast defense-in-depth check. It complements GitHub secret scanning; it does
# not replace a review of any new configuration or integration.
if git grep -n -I -E 'BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]+' -- .; then
  fail 'credential-like value detected'
fi

if git grep -n -I -E '/home/[^/]+/|192\.168\.[0-9]{1,3}\.[0-9]{1,3}' -- ':!scripts/public-release-check.sh'; then
  fail 'machine-specific path or private IP detected'
fi

if (( failures )); then
  exit 1
fi

printf 'Public-release check passed.\n'
