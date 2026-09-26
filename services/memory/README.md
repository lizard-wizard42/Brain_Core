# Optional Memory service source

This directory contains the Memory API and CPU worker used for recording uploads,
transcription, search, participant review and audio retention. The default Docker
Compose installation leaves this service offline. The API must run on a private
network with `CELTWO_MEMORY_API_TOKEN` set; the Brain Core backend uses the same
value as `CELTWO_MEMORY_TOKEN` and `CELTWO_MEMORY_URL` to connect. Never expose the
Memory API directly to the internet.

Audio, transcripts, the SQLite database, models and virtual environments are
runtime data. Set `CELTWO_MEMORY_DATA_DIR` to a persistent directory outside the
source tree and keep it out of Git. The model worker can download third-party
models on first use. Review the model license, hardware requirements and storage
capacity before enabling it. No models or recordings are bundled here.

This is source code, not a production-ready Compose deployment. The API and
worker require the Python packages in `requirements.txt` and an explicitly
configured runtime. Keep `CELTWO_MEMORY_MODE=offline` until both services have
been installed and verified for your environment.
