"""Synthetic compressed audio exercises limits before embedding or persistence."""
import io
import asyncio
import threading
import uuid
import os

import av
import httpx
import numpy as np
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from services.memory.api import voiceprint
from services.memory.storage import database
from services.memory.worker.diarizer import AudioSampleLimitExceeded, decode_pcm_16k_mono

OWNER = str(uuid.uuid4())
AUTH = {"Authorization": "Bearer synthetic-token"}


def flac(seconds):
    output = io.BytesIO()
    with av.open(output, mode="w", format="flac") as container:
        stream = container.add_stream("flac", rate=16000)
        for _ in range(seconds):
            frame = av.AudioFrame.from_ndarray(np.zeros((1, 16000), dtype=np.int16), format="s16", layout="mono")
            frame.sample_rate = 16000
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    return output.getvalue()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    monkeypatch.setenv("CELTWO_MEMORY_API_TOKEN", "synthetic-token")
    monkeypatch.setenv("CELTWO_MEMORY_EMBEDDER", "stub")
    database.init_db()
    app = FastAPI()
    app.include_router(voiceprint.router)
    return TestClient(app)


def test_compressed_long_upload_is_rejected_without_changing_reference(client):
    url = f"/voiceprint?owner_user_id={OWNER}"
    good = client.post(url, headers=AUTH, content=flac(8))
    assert good.status_code == 201
    before = database.get_voiceprint(OWNER)
    oversized = flac(61)
    assert len(oversized) < 25000  # Tiny input can decode to over the duration budget.
    response = client.post(url, headers=AUTH, content=oversized)
    assert response.status_code == 413
    assert database.get_voiceprint(OWNER) == before


def test_exact_duration_limit_and_decoder_default_remain_supported(client, tmp_path):
    path = tmp_path / "synthetic.flac"
    path.write_bytes(flac(61))
    assert decode_pcm_16k_mono(str(path)).size == 61 * 16000
    with pytest.raises(AudioSampleLimitExceeded):
        decode_pcm_16k_mono(str(path), max_samples=60 * 16000)
    response = client.post(f"/voiceprint?owner_user_id={OWNER}", headers=AUTH, content=flac(60))
    assert response.status_code == 201
    assert response.json()["sample_seconds"] == 60


def test_store_checks_budget_before_embedding(client, monkeypatch):
    def unexpected(*args):
        pytest.fail("oversized sample reached embedding")
    monkeypatch.setattr(voiceprint, "_embed_windowed", unexpected)
    with pytest.raises(HTTPException) as error:
        voiceprint._store(np.zeros(60 * 16000 + 1, dtype=np.float32), owner_user_id=OWNER)
    assert error.value.status_code == 413
    assert database.get_voiceprint(OWNER) is None


def seed_session(tmp_path, bodies):
    session = str(uuid.uuid4())
    database.create_session_if_missing(session, "synthetic-device", "2026-10-03T00:00:00Z", OWNER)
    for index, body in enumerate(bodies, 1):
        path = tmp_path / f"{session}-{index}.audio"
        path.write_bytes(body)
        database.insert_chunk(session, index, "synthetic-digest", len(body), str(path))
    return session


@pytest.mark.parametrize("seconds", [(61,), (30, 31)])
def test_session_duration_budget_is_shared_and_limit_errors_are_not_skipped(client, tmp_path, seconds):
    session = seed_session(tmp_path, [flac(s) for s in seconds])
    response = client.post(f"/voiceprint/from-session/{session}?owner_user_id={OWNER}", headers=AUTH)
    assert response.status_code == 413
    assert database.get_voiceprint(OWNER) is None


def test_session_corrupt_chunk_and_owner_isolation_preserve_legitimate_enrollment(client, tmp_path):
    session = seed_session(tmp_path, [b"invalid audio", flac(8)])
    assert client.post(f"/voiceprint/from-session/{session}?owner_user_id={uuid.uuid4()}", headers=AUTH).status_code == 404
    response = client.post(f"/voiceprint/from-session/{session}?owner_user_id={OWNER}", headers=AUTH)
    assert response.status_code == 201
    assert response.json()["sample_seconds"] == 8
    assert response.json()["model"].endswith("+session")


def test_partially_decoded_corrupt_chunks_consume_the_shared_budget(client, tmp_path):
    corrupt = bytearray(flac(59))
    corrupt[-20] ^= 255
    # Real PyAV emits nearly 59s before encountering the corrupted final frame.
    session = seed_session(tmp_path, [bytes(corrupt), bytes(corrupt), flac(8)])
    response = client.post(f"/voiceprint/from-session/{session}?owner_user_id={OWNER}", headers=AUTH)
    assert response.status_code == 413
    assert database.get_voiceprint(OWNER) is None


def test_session_total_byte_and_chunk_limits_apply_before_embedding(client, tmp_path, monkeypatch):
    body = flac(8)
    session = seed_session(tmp_path, [body, body])
    monkeypatch.setattr(voiceprint, "_MAX_BYTES", len(body) + 1)
    assert client.post(f"/voiceprint/from-session/{session}?owner_user_id={OWNER}", headers=AUTH).status_code == 413
    many = seed_session(tmp_path, [b"invalid"] * 129)
    assert client.post(f"/voiceprint/from-session/{many}?owner_user_id={OWNER}", headers=AUTH).status_code == 413
    assert database.get_voiceprint(OWNER) is None


def test_streamed_upload_byte_limit_without_content_length(client, monkeypatch):
    monkeypatch.setattr(voiceprint, "_MAX_BYTES", 8)
    def unexpected(*args):
        pytest.fail("oversized body reached decode")
    monkeypatch.setattr(voiceprint, "_decode_and_store", unexpected)

    async def scenario():
        async def blocks():
            yield b"12345"
            yield b"67890"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url="http://synthetic") as api:
            response = await api.post(f"/voiceprint?owner_user_id={OWNER}", headers=AUTH, content=blocks())
            assert "content-length" not in response.request.headers
            assert response.status_code == 413
    asyncio.run(scenario())
    assert not voiceprint._enrollment_lock.locked()


def test_request_cancellation_keeps_worker_slot_and_file_until_completion(client, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    paths = []
    def work(path, owner):
        paths.append(path)
        entered.set()
        assert release.wait(3)
        assert os.path.exists(path)
        return {"enrolled": True}
    monkeypatch.setattr(voiceprint, "_decode_and_store", work)

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url="http://synthetic") as api:
            first = asyncio.create_task(api.post(f"/voiceprint?owner_user_id={OWNER}", headers=AUTH, content=b"synthetic-audio"))
            try:
                assert await asyncio.to_thread(entered.wait, 2)
                first.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await first
                assert voiceprint._enrollment_lock.locked()
                assert os.path.exists(paths[0])
                assert (await api.post(f"/voiceprint?owner_user_id={OWNER}", headers=AUTH, content=b"audio")).status_code == 429
            finally:
                release.set()
                await asyncio.gather(*voiceprint._enrollment_tasks, return_exceptions=True)
            assert not voiceprint._enrollment_lock.locked()
            assert not os.path.exists(paths[0])
    asyncio.run(scenario())
    assert database.get_voiceprint(OWNER) is None


def test_decode_and_embedding_do_not_block_other_requests_and_jobs_do_not_queue(client, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    loop_thread = threading.get_ident()
    real_decode = voiceprint.decode_pcm_16k_mono
    def decode(*args, **kwargs):
        assert threading.get_ident() != loop_thread
        return real_decode(*args, **kwargs)
    def embed(pcm):
        assert threading.get_ident() != loop_thread
        entered.set()
        assert release.wait(3), "test did not release inference"
        return np.ones(32, dtype=np.float32)
    monkeypatch.setattr(voiceprint, "decode_pcm_16k_mono", decode)
    monkeypatch.setattr(voiceprint, "_embed_windowed", embed)
    @client.app.get("/synthetic-heartbeat")
    async def heartbeat():
        return {"ready": True}

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url="http://synthetic") as api:
            first = asyncio.create_task(api.post(f"/voiceprint?owner_user_id={OWNER}", headers=AUTH, content=flac(8)))
            try:
                assert await asyncio.to_thread(entered.wait, 2)
                assert not first.done()
                ping = await asyncio.wait_for(api.get("/synthetic-heartbeat"), timeout=0.5)
                assert ping.status_code == 200
                second = await api.post(f"/voiceprint?owner_user_id={uuid.uuid4()}", headers=AUTH, content=b"audio")
                assert second.status_code == 429
            finally:
                release.set()
                response = await first
            assert response.status_code == 201
    asyncio.run(scenario())
    assert not voiceprint._enrollment_lock.locked()


@pytest.mark.parametrize("flush", [False, True])
def test_decoder_checks_every_frame_before_array_or_concatenation(monkeypatch, flush):
    class Frame:
        samples = 5
        def to_ndarray(self):
            pytest.fail("overflow frame allocated an array")
    class Resampler:
        def __init__(self, **kwargs):
            pass
        def resample(self, frame):
            return [Frame()] if (frame is None) == flush else []
    class Container:
        streams = type("Streams", (), {"audio": [object()]})()
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def decode(self, stream):
            yield object()
    monkeypatch.setattr(av, "open", lambda path: Container())
    monkeypatch.setattr(av, "AudioResampler", Resampler)
    with pytest.raises(AudioSampleLimitExceeded):
        decode_pcm_16k_mono("synthetic.audio", max_samples=4)
