"""Módulo de Análise Conversacional e Dinâmica Emocional do Brain Core.

Avalia:
1. Turnos de diálogo e métricas de participação (% tempo de fala, contagem de turnos).
2. Detecção e classificação de sobreposições/interrupções:
   - Barge-in: interrupção que quebra ou assume a fala do outro locutor.
   - Backchannel: interjeição breve de apoio/escuta ativa (ex: 'sim', 'aham', 'entendi').
3. Acústica & Prosódia (quando áudio disponível ou aproximado via WPM/energia):
   - Taxa de elocução (WPM - Words Per Minute).
   - Pitch fundamental F0 e picos de elevação de tom / tensão vocal.
4. Relatório sintético da dinâmica relacional (ex: equilíbrio, tensão, escuta ativa).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Any

import numpy as np

# Interjeições curtas típicas de apoio / escuta ativa (backchannels)
_BACKCHANNEL_REGEX = re.compile(
    r"^(sim|aham|uhum|uh-hum|hum|entendi|ok|tá|certo|claro|isso|pois é|exato|beleza|perfeito)[.!?…]*$",
    re.IGNORECASE,
)


@dataclass
class ConversationEvent:
    event_type: str  # 'barge_in', 'backchannel', 'elevated_tone', 'rapid_turn'
    timestamp_ms: int
    duration_ms: int
    speaker: str
    target_speaker: str | None
    text: str
    description: str


def compute_wpm(text: str, duration_ms: int) -> float:
    """Calcula palavras por minuto para um segmento de fala."""
    if duration_ms <= 0:
        return 0.0
    words = len(text.strip().split())
    minutes = duration_ms / 60000.0
    return round(words / minutes, 1) if minutes > 0 else 0.0


def estimate_pitch_f0(pcm: np.ndarray, sample_rate: int = 16000) -> float | None:
    """Estima F0 (pitch em Hz) via autocorrelação no espectro de voz humana (75Hz a 400Hz)."""
    if pcm.size < sample_rate // 20:  # menos de 50ms
        return None

    lag_min = max(1, sample_rate // 400)   # ~40 amostras a 16kHz
    lag_max = min(pcm.size - 1, sample_rate // 75)  # ~213 amostras a 16kHz

    if lag_max <= lag_min:
        return None

    center = pcm[len(pcm) // 4 : 3 * len(pcm) // 4]
    if center.size == 0 or np.all(center == 0):
        return None

    corr = np.correlate(pcm, center, mode="full")
    corr = corr[len(corr) // 2 :]

    if len(corr) <= lag_max:
        return None

    search_region = corr[lag_min:lag_max]
    if search_region.size == 0:
        return None

    peak_idx = int(np.argmax(search_region)) + lag_min
    if corr[peak_idx] <= 0:
        return None

    f0 = sample_rate / peak_idx
    return round(float(f0), 1)


def analyze_conversation_dynamics(
    turns: list[dict[str, Any]],
    pcm_audio: np.ndarray | None = None,
    audio_sample_rate: int = 16000,
) -> dict[str, Any]:
    """Analisa uma sequência de turnos transcritos e retorna as métricas de dinâmica."""
    if not turns:
        return {
            "total_turns": 0,
            "total_speech_ms": 0,
            "speakers": {},
            "events": [],
            "interruption_stats": {"barge_ins": 0, "backchannels": 0},
            "summary": "Nenhuma fala registrada na sessão.",
        }

    parsed_turns = []
    for t in turns:
        s_ms = t.get("start_ms")
        e_ms = t.get("end_ms")
        if s_ms is None and t.get("start_at") and t.get("end_at"):
            try:
                from datetime import datetime
                s_dt = datetime.fromisoformat(t["start_at"].replace("Z", "+00:00"))
                e_dt = datetime.fromisoformat(t["end_at"].replace("Z", "+00:00"))
                dur = int((e_dt - s_dt).total_seconds() * 1000)
                s_ms = 0
                e_ms = dur
            except Exception:
                s_ms, e_ms = 0, 0
        s_ms = int(s_ms or 0)
        e_ms = int(e_ms or (s_ms + 1000))
        dur_ms = max(0, e_ms - s_ms)

        spk = t.get("voice_label") or (
            "Eu (provável)" if t.get("voice_is_me_probable")
            else t.get("voice") or t.get("speaker") or "Desconhecido"
        )
        parsed_turns.append({
            "id": t.get("id"),
            "speaker": spk,
            "text": (t.get("text") or "").strip(),
            "start_ms": s_ms,
            "end_ms": e_ms,
            "duration_ms": dur_ms,
            "wpm": compute_wpm(t.get("text") or "", dur_ms),
        })

    speaker_stats: dict[str, dict[str, Any]] = {}
    total_speech_ms = 0

    for pt in parsed_turns:
        spk = pt["speaker"]
        dur = pt["duration_ms"]
        total_speech_ms += dur
        if spk not in speaker_stats:
            speaker_stats[spk] = {
                "turn_count": 0,
                "total_duration_ms": 0,
                "percentage": 0.0,
                "barge_ins_done": 0,
                "barge_ins_suffered": 0,
                "backchannels_done": 0,
                "elevated_tone_count": 0,
                "wpm_list": [],
            }
        st = speaker_stats[spk]
        st["turn_count"] += 1
        st["total_duration_ms"] += dur
        if pt["wpm"] > 0:
            st["wpm_list"].append(pt["wpm"])

    for spk, st in speaker_stats.items():
        if total_speech_ms > 0:
            st["percentage"] = round((st["total_duration_ms"] / total_speech_ms) * 100, 1)
        st["avg_wpm"] = round(float(np.mean(st["wpm_list"])), 1) if st["wpm_list"] else 0.0

    events: list[ConversationEvent] = []
    barge_ins_count = 0
    backchannels_count = 0

    for i in range(1, len(parsed_turns)):
        prev = parsed_turns[i - 1]
        curr = parsed_turns[i]

        if curr["speaker"] != prev["speaker"] and curr["start_ms"] < prev["end_ms"]:
            overlap_ms = prev["end_ms"] - curr["start_ms"]
            is_backchannel = (
                curr["duration_ms"] <= 1400 and bool(_BACKCHANNEL_REGEX.match(curr["text"]))
            )

            if is_backchannel:
                backchannels_count += 1
                if curr["speaker"] in speaker_stats:
                    speaker_stats[curr["speaker"]]["backchannels_done"] += 1
                events.append(ConversationEvent(
                    event_type="backchannel",
                    timestamp_ms=curr["start_ms"],
                    duration_ms=curr["duration_ms"],
                    speaker=curr["speaker"],
                    target_speaker=prev["speaker"],
                    text=curr["text"],
                    description=f"{curr['speaker']} fez escuta ativa/apoio durante a fala de {prev['speaker']}",
                ))
            else:
                barge_ins_count += 1
                if curr["speaker"] in speaker_stats:
                    speaker_stats[curr["speaker"]]["barge_ins_done"] += 1
                if prev["speaker"] in speaker_stats:
                    speaker_stats[prev["speaker"]]["barge_ins_suffered"] += 1
                events.append(ConversationEvent(
                    event_type="barge_in",
                    timestamp_ms=curr["start_ms"],
                    duration_ms=overlap_ms,
                    speaker=curr["speaker"],
                    target_speaker=prev["speaker"],
                    text=curr["text"],
                    description=f"{curr['speaker']} interrompeu {prev['speaker']} (sobreposição de {overlap_ms}ms)",
                ))

        spk_avg = speaker_stats.get(curr["speaker"], {}).get("avg_wpm", 120.0)
        if curr["wpm"] >= max(180.0, spk_avg * 1.45) and curr["duration_ms"] >= 1500:
            if curr["speaker"] in speaker_stats:
                speaker_stats[curr["speaker"]]["elevated_tone_count"] += 1
            events.append(ConversationEvent(
                event_type="elevated_tone",
                timestamp_ms=curr["start_ms"],
                duration_ms=curr["duration_ms"],
                speaker=curr["speaker"],
                target_speaker=None,
                text=curr["text"],
                description=f"{curr['speaker']} elevou o ritmo/intensidade de fala ({curr['wpm']} WPM vs média {spk_avg})",
            ))

    if pcm_audio is not None and pcm_audio.size > 0:
        for pt in parsed_turns:
            a = max(0, int(pt["start_ms"] * audio_sample_rate / 1000))
            b = min(pcm_audio.size, int(pt["end_ms"] * audio_sample_rate / 1000))
            if b - a > audio_sample_rate // 10:
                pt["pitch_f0"] = estimate_pitch_f0(pcm_audio[a:b], audio_sample_rate)

    summary_lines = []
    speakers_sorted = sorted(speaker_stats.items(), key=lambda kv: kv[1]["total_duration_ms"], reverse=True)
    if len(speakers_sorted) >= 2:
        top1, top2 = speakers_sorted[0], speakers_sorted[1]
        summary_lines.append(
            f"Participação: {top1[0]} falou {top1[1]['percentage']}% do tempo e {top2[0]} falou {top2[1]['percentage']}%."
        )
    elif speakers_sorted:
        summary_lines.append(f"Participação: {speakers_sorted[0][0]} falou {speakers_sorted[0][1]['percentage']}% do tempo.")

    if barge_ins_count == 0:
        summary_lines.append("Nenhuma interrupção brusca detectada; a alternância de turnos foi fluida e equilibrada.")
    else:
        interruption_details = [
            f"{spk} interrompeu {st['barge_ins_done']}x"
            for spk, st in speaker_stats.items()
            if st["barge_ins_done"] > 0
        ]
        summary_lines.append(
            f"Interrupções: {barge_ins_count} interrupções registradas ({', '.join(interruption_details)})."
        )

    if backchannels_count > 0:
        summary_lines.append(f"Escuta ativa: {backchannels_count} interjeições de apoio registradas.")

    elevated_total = sum(st["elevated_tone_count"] for st in speaker_stats.values())
    if elevated_total > 0:
        summary_lines.append(f"Tensão / Ênfase: {elevated_total} momento(s) com ritmo acelerado ou intensidade elevada detectados.")

    return {
        "total_turns": len(parsed_turns),
        "total_speech_ms": total_speech_ms,
        "speakers": {
            spk: {
                "turn_count": st["turn_count"],
                "total_duration_ms": st["total_duration_ms"],
                "percentage": st["percentage"],
                "avg_wpm": st["avg_wpm"],
                "barge_ins_done": st["barge_ins_done"],
                "barge_ins_suffered": st["barge_ins_suffered"],
                "backchannels_done": st["backchannels_done"],
                "elevated_tone_count": st["elevated_tone_count"],
            }
            for spk, st in speaker_stats.items()
        },
        "interruption_stats": {
            "barge_ins": barge_ins_count,
            "backchannels": backchannels_count,
        },
        "events": [asdict(e) for e in events],
        "summary": " ".join(summary_lines),
    }
