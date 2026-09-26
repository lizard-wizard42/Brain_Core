import os
import asyncio
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI

from services.memory.storage.database import init_db
from services.memory.api.chunks import router as chunks_router
from services.memory.api.transcripts import router as transcripts_router
from services.memory.api.control import router as control_router
from services.memory.api.session_transcript import router as session_transcript_router
from services.memory.api.history import router as history_router
from services.memory.api.search import router as search_router
from services.memory.api.voiceprint import router as voiceprint_router
from services.memory.api.jobs import router as jobs_router
from services.memory.api.audio_retention import router as audio_retention_router, automatic_cleanup_loop
from services.memory.api.transcription_policy import router as transcription_policy_router
from services.memory.api.participants import router as participants_router

APP_VERSION = "0.1.0"
START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    env = os.environ.get("CELTWO_ENV", "production").strip().lower()
    token = os.environ.get("CELTWO_MEMORY_API_TOKEN", "").strip()
    if env == "production" and not token:
        raise RuntimeError(
            "CELTWO_MEMORY_API_TOKEN is required in production environment"
        )
    init_db()
    cleanup_task = asyncio.create_task(automatic_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Celtwo Memory", lifespan=lifespan)
app.include_router(chunks_router)
app.include_router(jobs_router)
app.include_router(audio_retention_router)
app.include_router(transcription_policy_router)
app.include_router(transcripts_router)
app.include_router(control_router)
app.include_router(session_transcript_router)
app.include_router(history_router)
app.include_router(search_router)
app.include_router(voiceprint_router)
app.include_router(participants_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/v1/status")
def status() -> dict:
    return {
        "version": APP_VERSION,
        "uptime_seconds": round(time.time() - START_TIME, 3),
        "recording": False,
        "last_sync": None,
    }
