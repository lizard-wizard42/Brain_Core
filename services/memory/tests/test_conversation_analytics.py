"""Testes unitários para análise conversacional, dinâmica emocional e interrupções."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from services.memory.analytics.conversation import (
    analyze_conversation_dynamics,
    compute_wpm,
    estimate_pitch_f0,
)
from services.memory.api.session_transcript import router
from services.memory.storage import database


def test_compute_wpm():
    assert compute_wpm("olá mundo teste", 3000) == 60.0
    assert compute_wpm("", 1000) == 0.0
    assert compute_wpm("palavra", 0) == 0.0


def test_estimate_pitch_f0():
    # Sinal senoidal de 200 Hz a 16 kHz
    sr = 16000
    t = np.arange(sr * 0.5) / sr
    sine_200 = (0.5 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)
    f0 = estimate_pitch_f0(sine_200, sr)
    assert f0 is not None
    assert 190.0 <= f0 <= 210.0


def test_barge_in_and_backchannel_detection():
    turns = [
        {
            "id": 1,
            "voice_label": "Locutor 1",
            "text": "Eu estava pensando em resolver aquele problema da casa hoje.",
            "start_ms": 0,
            "end_ms": 4000,
        },
        # Sobreposição em 3500ms (overlap 500ms): interrupção assertiva de Locutor 2
        {
            "id": 2,
            "voice_label": "Locutor 2",
            "text": "Não faça isso agora porque vai chover!",
            "start_ms": 3500,
            "end_ms": 6500,
        },
        # Sobreposição em 6000ms: escuta ativa curta de Locutor 1 ("Uhum.")
        {
            "id": 3,
            "voice_label": "Locutor 1",
            "text": "Uhum.",
            "start_ms": 6000,
            "end_ms": 6800,
        },
    ]

    result = analyze_conversation_dynamics(turns)

    assert result["total_turns"] == 3
    assert result["interruption_stats"]["barge_ins"] == 1
    assert result["interruption_stats"]["backchannels"] == 1

    events = result["events"]
    barge_ins = [e for e in events if e["event_type"] == "barge_in"]
    assert len(barge_ins) == 1
    assert barge_ins[0]["speaker"] == "Locutor 2"
    assert barge_ins[0]["target_speaker"] == "Locutor 1"
    assert barge_ins[0]["duration_ms"] == 500

    backchannels = [e for e in events if e["event_type"] == "backchannel"]
    assert len(backchannels) == 1
    assert backchannels[0]["speaker"] == "Locutor 1"
    assert backchannels[0]["target_speaker"] == "Locutor 2"

    # Verificar cálculo de porcentagem de fala
    speakers = result["speakers"]
    assert "Locutor 2" in speakers
    assert "Locutor 1" in speakers
    assert speakers["Locutor 2"]["barge_ins_done"] == 1
    assert speakers["Locutor 1"]["barge_ins_suffered"] == 1
    assert speakers["Locutor 1"]["backchannels_done"] == 1
    assert "Interrupções: 1 interrupções registradas" in result["summary"]


def test_dynamics_api_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    monkeypatch.setenv("CELTWO_MEMORY_API_TOKEN", "test-token")
    database.init_db()

    import uuid
    session_id = "test-session-dyn"
    owner = str(uuid.uuid4())
    database.create_session_if_missing(session_id, "title", "2026-01-01T00:00:00Z", owner)

    client = TestClient(router)
    res = client.get(
        f"/sessions/{session_id}/dynamics?owner_user_id={owner}",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == session_id
    assert "dynamics" in data
    assert data["dynamics"]["total_turns"] == 0
