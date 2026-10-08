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

Transcripts are tidied after Whisper runs: fragments of one utterance are merged when the pause is short (`CELTWO_MEMORY_MERGE_GAP_MS`, default 600 ms) and the previous text did not end a sentence, or when either part is shorter than `CELTWO_MEMORY_MERGE_SHORT_MS` (1500 ms); a segment never exceeds `CELTWO_MEMORY_MERGE_MAX_MS` (20 s). Punctuation-only fragments are attached to the previous segment. Existing sessions are not rewritten.

Voice enrollment accepts 8–60 seconds and up to 25 MiB. The session-based endpoint shares that byte/sample budget across at most 128 chunks; oversized sessions are rejected, not silently truncated. One enrollment runs per Memory process, off the API event loop.

Participant templates require a manually confirmed, nonoverlapping segment of 3–60 seconds and a locally available embedding model. Participant processing accepts chunks up to 300 seconds of decoded audio and allows one inference operation per process. Oversized or busy requests are refused; existing templates and transcription remain available. Expensive processing happens outside the shared SQLite write lock, with source and manual decision rechecked before saving. Similarity scores are suggestions, not calibrated identity probabilities.

Offline checks with fictional audio:

```bash
python -m pip install -r services/memory/requirements-test.txt
CELTWO_MEMORY_EMBEDDER=stub python -m pytest services/memory/tests -q
```

These tests use temporary databases and generated samples, without a microphone, personal recordings or a downloaded voice model.

## Enrolled voice and participant review

The current account’s enrolled sample feeds suggestions for **Minha voz**, alongside references extracted from manually confirmed segments. The virtual owner participant is available in the correction list before any segment has been confirmed; confirming it creates a persistent account-scoped identity. Suggestions use compatible models and dimensions and never write a decision. Replacing or deleting the enrolled sample during inference discards its stale suggestion. A saved manual decision remains explicit user input.

Segments shorter than 3 seconds, longer than 60 seconds, overlapping, purged or unsuitable for voice comparison have no suggestion; manual review remains available. Requests without compatible references skip inference. Web and Android clients serialize segment reads. If inference is busy or the local model is unavailable, the backend returns saved decisions with `suggestions_status` (`busy` or `unavailable`); clients allow manual correction and refreshing suggestions. Authentication and ownership errors still fail the request.

Android 1.1.1 adds creation of a named participant from **Corrigir**, including the first participant, and attempts template extraction after confirmation or correction. A short or unsuitable segment can save the decision without producing a voice reference. Server-side enrolled-voice suggestions are compatible with 1.1.0; install the updated APK for the complete native creation flow and clearer processing status.

Confirmed participant decisions update the web card heading and **Só minhas falas**
filter. The server supplies `is_owner` by identity ID, so naming another participant
“Minha voz” does not classify them as the account owner. Undo returns to the
previous transcript/local label. Segment controls remain available after confirmation.
This display fix does not change speaker thresholds or make suggestions automatic.


### Conversation layout

The web timeline shows the account owner as **Eu**, with outgoing bubbles on the
right and other speakers on the left. **Identificar fala** / **Alterar participante**
expands the segment review controls; saved decisions still load while collapsed.
The voice setup section is named **Perfil de voz**. These labels do not rename
stored identities or change recognition thresholds.

**Criar nota** opens a draft. **Copiar conversa** copies Markdown to the clipboard;
it does not send data to an AI service. **Mais ações** contains Markdown download,
a reminder draft, and voice-reference setup. Copy/download include the whole
session even when the only-me filter is active, using the currently displayed
speaker labels and without a duplicate plain-text transcript. Clipboard failure
shows an error and leaves download as an explicit choice.

Voice-reference setup explains that it replaces the enrolled sample and requires
an 8–60 second recording with only the account owner speaking. Opening the setup
does not enroll audio; the explicit **Usar esta gravação** action does. Segment
confirmation remains separate from voice enrollment.
