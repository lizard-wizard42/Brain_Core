# Optional GPU worker source

This directory contains the optional transcription worker. No model weights,
audio, database, benchmark fixtures, virtual environment or credentials are
bundled. Configure `CELTWO_MEMORY_API_URL` and `CELTWO_MEMORY_API_TOKEN` for a
private Memory API, and validate the GPU runtime before starting the worker.
The default Docker Compose installation does not run this service.
