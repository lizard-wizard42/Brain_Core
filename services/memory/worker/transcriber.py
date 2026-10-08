import os
import re
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

_TERMINAL = re.compile(r"[.!?…]\s*$")
_WORDS = re.compile(r"[^\W_]", re.UNICODE)


def _env_ms(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, default)))
    except ValueError:
        return default


def tidy_segments(
    segments: list[TranscribedSegment],
    *,
    gap_ms: int | None = None,
    short_ms: int | None = None,
    max_ms: int | None = None,
) -> list[TranscribedSegment]:
    """Reduz a fragmentação do Whisper sem perder texto de fala.

    - Pontuação solta (sem letras/dígitos) é anexada ao trecho anterior; no
      início do chunk é descartada.
    - Trechos vizinhos são unidos quando o intervalo é curto e o anterior não
      terminou uma frase, ou quando qualquer um dos dois é curto demais para
      ser um turno de fala. Nunca ultrapassa ``max_ms`` por trecho.
    A união é conservadora (intervalo pequeno): turnos de pessoas diferentes
    costumam ter pausa maior, e a separação por voz acontece depois.
    """
    gap_ms = _env_ms("CELTWO_MEMORY_MERGE_GAP_MS", 600) if gap_ms is None else gap_ms
    short_ms = _env_ms("CELTWO_MEMORY_MERGE_SHORT_MS", 1500) if short_ms is None else short_ms
    max_ms = _env_ms("CELTWO_MEMORY_MERGE_MAX_MS", 20000) if max_ms is None else max_ms

    out: list[TranscribedSegment] = []
    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        if not _WORDS.search(text):
            if out:
                out[-1] = TranscribedSegment(out[-1].start_ms, max(out[-1].end_ms, seg.end_ms),
                                             out[-1].text + text)
            continue
        prev = out[-1] if out else None
        if prev is not None:
            gap = seg.start_ms - prev.end_ms
            joined = seg.end_ms - prev.start_ms
            fragment = (prev.end_ms - prev.start_ms) < short_ms or (seg.end_ms - seg.start_ms) < short_ms
            if gap <= gap_ms and joined <= max_ms and (fragment or not _TERMINAL.search(prev.text)):
                out[-1] = TranscribedSegment(prev.start_ms, max(prev.end_ms, seg.end_ms),
                                             f"{prev.text} {text}")
                continue
        out.append(TranscribedSegment(seg.start_ms, seg.end_ms, text))
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
