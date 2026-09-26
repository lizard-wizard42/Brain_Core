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
