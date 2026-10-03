# Optional Memory service

This directory contains the Memory API and CPU worker used for recording uploads,
transcription, search, participant review and audio retention. The default Docker
Compose installation leaves this service offline. The optional
[`compose.memory.yaml`](../../compose.memory.yaml) starts the API and worker on
the private Compose network. It does not publish a host port. Both the API and
Brain Core backend use the same private bearer token.

See [the timeline guide](../../docs/REMEMBER_TIMELINE.md) for setup. Audio,
transcripts, the SQLite database, and downloaded models live in the
`brain-core-memory` Docker volume, outside the source tree. Protect and back up
this volume; removing it destroys the recordings and transcripts. The worker
downloads third-party models on first use. Review their licenses, CPU and memory
needs, network access, and storage capacity before enabling it. No models or
recordings are bundled here.

The API is an internal service. Keep the web entrypoint behind your HTTPS
reverse proxy or Tailscale Serve and do not publish the Memory API port.

Voice enrollment accepts 8–60 seconds of decoded audio and at most 25 MiB.
Enrollment from a session shares the same total duration/byte budget and accepts
at most 128 chunks. Larger inputs receive 413 without truncating the sample or
replacing the existing reference. Decode/inference run outside the API event
loop; simultaneous enrollment jobs receive 429. These limits do not apply to
normal recording/transcription duration. Completion updates require a matching
session owner in SQLite; an omitted owner matches only unowned legacy sessions.

For offline regression tests with fictional audio and temporary SQLite databases:

```sh
python -m pip install -r services/memory/requirements-test.txt
CELTWO_MEMORY_DATA_DIR=/tmp/brain-core-synthetic-memory CELTWO_MEMORY_EMBEDDER=stub python -m pytest services/memory/tests -q
```

## Existing Linux installation

All Memory and GPU source code lives in this repository. Generic user-systemd
templates are in `deploy/systemd/`; adjust their installation and interpreter
paths locally. Install the Memory requirements in `services/memory/.venv` and
prepare the GPU environment in `services/gpu-worker/.venv` as described in
the GPU worker guide. GPU library
paths depend on the local environment and belong in a private service override.

Keep the host API configuration in ignored `private-data/memory.env`, readable
only by the service account. It uses `CELTWO_MEMORY_API_TOKEN`,
`CELTWO_MEMORY_API_URL`, `CELTWO_MEMORY_DATA_DIR` and `CELTWO_MEMORY_DB_PATH`.
The backend's `CELTWO_MEMORY_TOKEN` must match the API token. These host-service
settings differ from Compose's environment-variable wiring. The API binds to
loopback; only the Brain Core web entrypoint should be reachable remotely.

Before switching an existing installation, stop its API and workers and make
a consistent SQLite backup, preserve its audio directory and private service
configuration, then test migration on a private copy. Confirm transcript text,
session ownership, row counts and database integrity before starting workers.
Version 12 clears uncalibrated legacy `me`/`other` speaker labels; it preserves
transcript text. Unowned historical sessions require an explicit ownership
review rather than assigning all recordings to an arbitrary account. Keep the
previous code and database backup together for rollback. Never run two APIs or
two GPU workers against the same installation while switching.

When relocating existing audio, update both `chunks.path` and
`chunks.denoised_path` to the new location and verify each stored file hash.
Relative paths are resolved against the service working directory, so changing
that directory without moving the files can break audio access even when
transcript reads still work. Use an absolute private data directory in the
service configuration. Recreate or validate relocated Python environments;
console-script shebangs and GPU library paths can retain their old location.
