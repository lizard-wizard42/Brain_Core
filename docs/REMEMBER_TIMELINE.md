# Timeline, recording, and transcription

**Timeline** groups recorded sessions by date. Once the optional memory service is connected, it can show transcription progress, searchable text, speaker turns, and reviewed participant names. A user can turn part of a transcript into a Brain Core note or reminder.

## How audio enters the system

- The browser recorder starts only after a user presses its control and grants microphone access.
- The [Android companion](../android/README.md) records locally in short `.m4a` chunks. Its account-bound queue survives restarts and network loss. The backend verifies the chunk digest before confirming an upload.
- The backend sends authorized audio and session metadata to the separately configured memory service. The service stores the corpus and can process transcription locally; a GPU worker is optional.

The standard Docker Compose installation sets `CELTWO_MEMORY_MODE=offline`. This keeps a new installation useful for notes and attachments without starting an audio-processing service. Recording on a phone does not automatically enable server transcription. To use transcripts, configure the memory service, its storage, and the same private bearer token in the backend and service. Keep its port private; expose only the Brain Core web entrypoint through your HTTPS reverse proxy or [Tailscale Serve](ANDROID.md).

## Review and ownership

Transcripts may propose speaker labels. Review or correct each segment rather than treating a voice sample as proof of identity. The backend ties mobile devices and sessions to the linked account. The memory service requires a bearer token and scopes history, search, and transcript reads to the account ID supplied by the authenticated backend.

Voice recordings and transcripts can contain sensitive information about other people. Obtain consent before recording, choose a retention period, and protect the device, memory storage, and backups. Do not commit recordings, database files, tokens, voiceprints, or real server addresses to Git.
