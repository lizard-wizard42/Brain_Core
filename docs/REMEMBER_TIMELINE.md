# Timeline, recording, and transcription

**Timeline** groups recorded sessions by date. Once the optional memory service is connected, it can show transcription progress, searchable text, speaker turns, and reviewed participant names. A user can turn part of a transcript into a Brain Core note or reminder.

## How audio enters the system

- The browser recorder starts only after a user presses its control and grants microphone access.
- The [Android companion](../android/README.md) records locally in short `.m4a` chunks. Its account-bound queue survives restarts and network loss. The backend verifies the chunk digest before confirming an upload.
- The backend sends authorized audio and session metadata to the separately configured memory service. The service stores the corpus and can process transcription locally; a GPU worker is optional.

The standard Docker Compose installation sets `CELTWO_MEMORY_MODE=offline`. This keeps a new installation useful for notes and attachments without starting an audio-processing service. Recording on a phone does not automatically enable server transcription.

## Enable the local CPU transcription service

The optional Compose file starts a private API and a CPU worker. If you used
the standard quick start, first create `.env.docker`: the commands below use
it even though the initial installation does not require it. Keep any CORS or
secure-cookie changes you already made in that file. Then create an ignored
Memory environment file and set a unique token:

```bash
test -e .env.docker || cp .env.docker.example .env.docker
test -e .env.memory || cp .env.memory.example .env.memory
chmod 600 .env.memory
openssl rand -hex 32
```

Paste the generated value after `CELTWO_MEMORY_TOKEN=` in `.env.memory`. Then
start the same stack with the optional file:

```bash
docker compose --env-file .env.docker --env-file .env.memory -f compose.yaml -f compose.memory.yaml up --build -d
docker compose --env-file .env.docker --env-file .env.memory -f compose.yaml -f compose.memory.yaml ps
```

The `memory-api` and `memory-worker` services have no published host port. The
backend connects to the API over the private Compose network. Recordings,
transcripts, the SQLite index, and downloaded models persist in the
`brain-core-memory` volume. The first transcription downloads a Whisper model;
it needs network access, disk space, and CPU time. The default model is `small`
with Portuguese as the selected language. Change those settings in
`.env.memory` if needed. Keep the token and volume out of Git and protect backups.

For an NVIDIA GPU on the Docker host, see the [optional GPU worker setup](../services/gpu-worker/README.md).
It includes a loopback-only API override, Python/CUDA dependencies, model
selection and a CPU fallback. The default worker is always CPU; setting a GPU
environment variable on the default container does not enable GPU processing.

Check the backend health and service logs after enabling it:

```bash
docker compose --env-file .env.docker --env-file .env.memory -f compose.yaml -f compose.memory.yaml logs --tail=80 backend memory-api memory-worker
```

To stop the worker and API while keeping their data, run `docker compose
--env-file .env.docker --env-file .env.memory -f compose.yaml -f compose.memory.yaml down` and start
the regular `docker compose --env-file .env.docker up -d` stack. Do not add `-v`: that would delete
all Compose volumes. For phone access, expose only the Brain Core web entrypoint
through your HTTPS reverse proxy or [Tailscale Serve](ANDROID.md).

## Review and ownership

Transcripts may propose speaker labels. Review or correct each segment rather than treating a voice sample as proof of identity. The backend ties mobile devices and sessions to the linked account. The memory service requires a bearer token and scopes history, search, and transcript reads to the account ID supplied by the authenticated backend.

Voice recordings and transcripts can contain sensitive information about other people. Obtain consent before recording, choose a retention period, and protect the device, memory storage, and backups. Do not commit recordings, database files, tokens, voiceprints, or real server addresses to Git.


## Account settings and processing limits

Settings offers automatic, scheduled and manual transcription, **run now** and **pause** for the current account. Scheduled windows can be 2, 4, 8 or 12 hours, using UTC or America/Sao_Paulo. CPU and GPU apply the same admission policy and claim jobs atomically. Pause stops new claims; an active transcription can finish. Uploading a recording and allowing transcription are separate actions.

Audio retention supports 30, 90, 180 or 365 days. Automatic deletion is opt-in; manual cleanup previews eligible completed/transcribed chunks. Purging removes raw audio while keeping transcript text and session metadata. It does not remove copies already held in backups. Android also has a device-local retention policy.

Voice enrollment accepts 8–60 seconds and up to 25 MiB. The session-based endpoint shares that byte/sample budget across at most 128 chunks; oversized sessions are rejected, not silently truncated. One enrollment runs per Memory process, off the API event loop.

Participant templates require a manually confirmed, nonoverlapping segment of 3–60 seconds and a locally available embedding model. Participant processing accepts chunks up to 300 seconds of decoded audio and allows one inference operation per process. Oversized or busy requests are refused; existing templates and transcription remain available. Expensive processing happens outside the shared SQLite write lock, with source and manual decision rechecked before saving. Similarity scores are suggestions, not calibrated identity probabilities.

Offline checks with fictional audio:

```bash
python -m pip install -r services/memory/requirements-test.txt
CELTWO_MEMORY_EMBEDDER=stub python -m pytest services/memory/tests -q
```

These tests use temporary databases and generated samples, without a microphone, personal recordings or a downloaded voice model.
