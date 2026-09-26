# Timeline, recording, and transcription

**Timeline** groups recorded sessions by date. Once the optional memory service is connected, it can show transcription progress, searchable text, speaker turns, and reviewed participant names. A user can turn part of a transcript into a Brain Core note or reminder.

## How audio enters the system

- The browser recorder starts only after a user presses its control and grants microphone access.
- The [Android companion](../android/README.md) records locally in short `.m4a` chunks. Its account-bound queue survives restarts and network loss. The backend verifies the chunk digest before confirming an upload.
- The backend sends authorized audio and session metadata to the separately configured memory service. The service stores the corpus and can process transcription locally; a GPU worker is optional.

The standard Docker Compose installation sets `CELTWO_MEMORY_MODE=offline`. This keeps a new installation useful for notes and attachments without starting an audio-processing service. Recording on a phone does not automatically enable server transcription.

## Enable the local CPU transcription service

The optional Compose file starts a private API and a CPU worker. On the host,
create an ignored environment file and set a unique token:

```bash
cp .env.memory.example .env.memory
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
