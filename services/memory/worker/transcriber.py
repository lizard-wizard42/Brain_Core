import os
from dataclasses import dataclass
from typing import Any

_model: Any = None


@dataclass
class TranscribedSegment:
    start_ms: int
    end_ms: int
    text: str


def build_initial_prompt(session_id: str, chunk_num: int) -> str | None:
    """Glossário (CELTWO_MEMORY_WHISPER_PROMPT) + cauda do chunk anterior — o
    initial_prompt do whisper. Usado tanto pelo worker do servidor quanto
    devolvido pelo endpoint /jobs/claim pro worker da GPU."""
    from services.memory.storage import database

    glossary = os.environ.get("CELTWO_MEMORY_WHISPER_PROMPT", "").strip()
    tail = ""
    if chunk_num > 0:
        prev = database.get_segments_for_chunk(session_id, chunk_num - 1)
        if prev:
            tail = " ".join(s["text"] for s in prev[-4:])[-240:]
    return " ".join(p for p in (glossary, tail.strip()) if p) or None


def collapse_repeats(
    segments: list[TranscribedSegment], min_run: int = 3
) -> list[TranscribedSegment]:
    """Colapsa repetições consecutivas idênticas num único segmento."""
    if not segments:
        return []

    def key(s: TranscribedSegment) -> str:
        return (s.text or "").strip().lower()

    out: list[TranscribedSegment] = []
    i, n = 0, len(segments)
    while i < n:
        j = i
        k = key(segments[i])
        while j + 1 < n and key(segments[j + 1]) == k:
            j += 1
        if j - i + 1 >= min_run:
            out.append(TranscribedSegment(segments[i].start_ms, segments[j].end_ms, segments[i].text))
        else:
            out.extend(segments[i:j + 1])
        i = j + 1
    return out


def _looks_silent(path: str) -> bool:
    """True quando o chunk tem energia (RMS) abaixo do piso ou < 1s."""
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return True
    try:
        from services.memory.worker.diarizer import decode_pcm_16k_mono
        pcm = decode_pcm_16k_mono(path)
        if pcm.size < 16000:
            return True
        import numpy as np
        floor = float(os.environ.get("CELTWO_MEMORY_SILENCE_RMS", "0.005"))
        rms = float(np.sqrt(np.mean(np.square(pcm, dtype=np.float64))))
        return rms < floor
    except Exception:
        return False


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        model_name = os.environ.get("CELTWO_MEMORY_WHISPER_MODEL", "small")
        compute_type = os.environ.get("CELTWO_MEMORY_WHISPER_COMPUTE_TYPE", "int8")
        _model = WhisperModel(model_name, device="cpu", compute_type=compute_type)
    return _model


def transcribe_chunk(path: str) -> list[TranscribedSegment]:
    model = get_model()
    language = os.environ.get("CELTWO_MEMORY_WHISPER_LANGUAGE", "pt")
    vad_filter = os.environ.get("CELTWO_MEMORY_WHISPER_VAD", "1") == "1"

    segments, _info = model.transcribe(path, language=language, vad_filter=vad_filter)

    return [
        TranscribedSegment(
            start_ms=int(segment.start * 1000),
            end_ms=int(segment.end * 1000),
            text=segment.text.strip(),
        )
        for segment in segments
    ]
