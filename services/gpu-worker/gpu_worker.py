"""Worker de transcrição rodado no notebook (GPU). Requer: faster-whisper, httpx.

Denoise opcional: deepfilternet + torch + torchaudio.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import gc
from functools import lru_cache
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time


_AUDIO_NAME = re.compile(r"^audio-[A-Za-z0-9_-]+\.opus(?:\.denoised\.wav)?$")


@contextmanager
def private_audio_dir():
    """Own the worker's private scratch space and clear interrupted jobs."""
    path = Path(tempfile.gettempdir()) / f"celtwo-gpu-worker-{os.getuid()}"
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError(f"unsafe GPU worker audio directory: {path}")
    lock_fd = os.open(path / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        lock_info = os.fstat(lock_fd)
        if (not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != os.getuid()
                or stat.S_IMODE(lock_info.st_mode) != 0o600):
            raise RuntimeError("unsafe GPU worker lock file")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for entry in path.iterdir():
            if _AUDIO_NAME.fullmatch(entry.name) and not entry.is_dir():
                entry.unlink()
        yield path
    finally:
        os.close(lock_fd)


def parse_args(argv):
    p = argparse.ArgumentParser(description="Celtwo GPU transcription worker")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="processa 1 job e sai")
    mode.add_argument("--loop", action="store_true", help="fica rodando (polling)")
    p.add_argument("--poll", type=float, default=10.0, help="segundos entre claims no --loop")
    return p.parse_args(argv)


def segments_payload(fw_segments, model):
    out = []
    for s in fw_segments:
        text = (s.text or "").strip()
        if not text:
            continue
        out.append(
            {
                "start_ms": int(round(s.start * 1000)),
                "end_ms": int(round(s.end * 1000)),
                "text": text,
            }
        )
    return {"segments": out, "model": model, "completed": True}


def _vad_options():
    return {
        "threshold": float(os.environ.get("CELTWO_GPU_VAD_THRESHOLD", "0.35")),
        "min_silence_duration_ms": int(
            os.environ.get("CELTWO_GPU_VAD_MIN_SILENCE_MS", "1500")
        ),
    }


def _audio_stats(path):
    import numpy as np
    from faster_whisper.audio import decode_audio

    pcm = np.asarray(decode_audio(path, sampling_rate=16000), dtype=np.float32)
    if pcm.size == 0:
        return 0.0, 0.0
    duration = pcm.size / 16000
    rms = float(np.sqrt(np.mean(np.square(pcm, dtype=np.float64))))
    return duration, rms


def _should_retry_without_vad(path):
    max_seconds = float(
        os.environ.get("CELTWO_GPU_VAD_FALLBACK_MAX_SECONDS", "15")
    )
    silence_rms = float(os.environ.get("CELTWO_GPU_SILENCE_RMS", "0.005"))
    try:
        duration, rms = _audio_stats(path)
    except Exception as exc:
        print(f"nao foi possivel medir audio para fallback ({exc})", file=sys.stderr)
        return False
    return 1.0 <= duration <= max_seconds and rms >= silence_rms


def _transcribe_model(model, name, path, initial_prompt, *, vad_filter):
    segs, _info = model.transcribe(
        path,
        language=os.environ.get("CELTWO_MEMORY_WHISPER_LANGUAGE", "pt"),
        vad_filter=vad_filter,
        vad_parameters=_vad_options() if vad_filter else None,
        beam_size=1,
        no_speech_threshold=float(
            os.environ.get("CELTWO_GPU_NO_SPEECH_THRESHOLD", "0.6")
        ),
        condition_on_previous_text=False,
        initial_prompt=initial_prompt,
    )
    return segments_payload(segs, name)


def _transcribe_with_fallback(model, name, path, initial_prompt):
    result = _transcribe_model(
        model, name, path, initial_prompt, vad_filter=True
    )
    if result["segments"] or not _should_retry_without_vad(path):
        return result
    print("VAD nao encontrou fala curta; tentando uma vez sem VAD")
    return _transcribe_model(
        model, name, path, initial_prompt, vad_filter=False
    )


SUPPORTED_MODELS = {
    "medium": "medium",
    "large-v3-turbo": "large-v3-turbo",
    "turbo": "large-v3-turbo",
    "large-v3": "large-v3",
    "large": "large-v3",
}
DEFAULT_MODEL = "medium"


def resolve_whisper_model() -> str:
    """Resolve o modelo configurado via env CELTWO_GPU_WHISPER_MODEL com fallback para 'medium'."""
    raw = os.environ.get("CELTWO_GPU_WHISPER_MODEL", "").strip().lower()
    if not raw:
        return DEFAULT_MODEL
    return SUPPORTED_MODELS.get(raw, raw)


def get_account_vocabulary(account_id: str | None) -> str:
    """Recupera vocabulário configurado estritamente para a conta informada."""
    if not account_id:
        return ""
    # 1. Mapeamento JSON em CELTWO_GPU_ACCOUNT_PROMPTS
    raw_json = os.environ.get("CELTWO_GPU_ACCOUNT_PROMPTS", "").strip()
    if raw_json:
        try:
            data = json.loads(raw_json)
            if isinstance(data, dict):
                vocab = data.get(account_id) or data.get(account_id.lower())
                if isinstance(vocab, str) and vocab.strip():
                    return vocab.strip()
        except Exception as exc:
            print(
                f"Aviso: falha ao interpretar CELTWO_GPU_ACCOUNT_PROMPTS ({exc})",
                file=sys.stderr,
            )

    # 2. Variável individual CELTWO_GPU_PROMPT_<SANITIZED_ID>
    sanitized = "".join(c if c.isalnum() else "_" for c in str(account_id)).upper()
    env_key = f"CELTWO_GPU_PROMPT_{sanitized}"
    val = os.environ.get(env_key, "").strip()
    if val:
        return val

    return ""


def resolve_job_prompt(job: dict) -> str | None:
    """Resolve o prompt inicial para a transcrição com isolamento estrito por conta.

    Garante que vocabulários personalizados pertençam apenas à conta dona do job
    e que nenhum termo vaze entre contas diferentes ou jobs consecutivos.
    """
    server_prompt = (job.get("initial_prompt") or "").strip()
    account_id = (
        job.get("owner_user_id")
        or job.get("account_id")
        or job.get("user_id")
    )
    if account_id:
        account_id = str(account_id).strip()

    account_vocab = get_account_vocabulary(account_id)

    parts = []
    if server_prompt:
        parts.append(server_prompt)
    if account_vocab and account_vocab not in server_prompt:
        parts.append(account_vocab)

    if not parts:
        return None
    return " ".join(parts).strip() or None


def _default_transcribe():
    from faster_whisper import WhisperModel

    target_name = resolve_whisper_model()
    device = os.environ.get("CELTWO_GPU_WHISPER_DEVICE", "cuda").strip() or "cuda"
    compute = (
        os.environ.get("CELTWO_GPU_WHISPER_COMPUTE_TYPE", "int8_float16").strip()
        or "int8_float16"
    )

    try:
        model = WhisperModel(target_name, device=device, compute_type=compute)
        active_name = target_name
    except Exception as exc:
        if target_name != DEFAULT_MODEL:
            print(
                f"Aviso: Falha ao carregar modelo '{target_name}' ({exc}). "
                f"Utilizando fallback para '{DEFAULT_MODEL}'.",
                file=sys.stderr,
            )
            model = WhisperModel(DEFAULT_MODEL, device=device, compute_type=compute)
            active_name = DEFAULT_MODEL
        else:
            raise

    def _run(path, initial_prompt):
        return _transcribe_with_fallback(model, active_name, path, initial_prompt)

    return _run


@lru_cache(maxsize=1)
def _default_enhance():
    dev = os.environ.get("CELTWO_GPU_DENOISE_DEVICE", "cpu")
    if dev == "cpu":
        os.environ["CUDA_VISIBLE_DEVICES"] = ""  # torch/DF no CPU; o whisper ja carregou
        os.environ["DEVICE"] = "cpu"  # DeepFilterNet usa esta configuracao diretamente

    import numpy as np
    import torch
    import torchaudio
    from df.enhance import enhance as df_enhance, init_df

    model, df_state, _ = init_df()
    if dev == "cpu":
        model = model.to("cpu")
    target = df_state.sr()

    def _run(audio, rate):
        t = torch.from_numpy(np.ascontiguousarray(audio, dtype="float32")).unsqueeze(0)
        if rate != target:
            t = torchaudio.functional.resample(t, rate, target)
        out = df_enhance(model, df_state, t)
        if rate != target:
            out = torchaudio.functional.resample(out, target, rate)
        return out.squeeze(0).detach().cpu().numpy()

    return _run


def maybe_denoise(in_path, *, enhance=None):
    if os.environ.get("CELTWO_GPU_DENOISE", "0") == "0":
        return in_path
    if enhance is None:
        try:
            enhance = _default_enhance()
        except Exception as exc:
            print(
                f"denoise indisponivel ({exc}) - usando audio cru",
                file=sys.stderr,
            )
            return in_path
    import wave

    import numpy as np
    from faster_whisper.audio import decode_audio

    pcm = np.asarray(decode_audio(in_path, sampling_rate=16000), dtype=np.float32)
    clean = np.asarray(enhance(pcm, 16000), dtype=np.float32)
    out_path = in_path + ".denoised.wav"
    fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as output, wave.open(output, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes((np.clip(clean, -1, 1) * 32767).astype("<i2").tobytes())
    return out_path


def _wav_to_ogg_bytes(wav_path):
    import io

    import av

    with av.open(wav_path) as ic:
        istream = ic.streams.audio[0]
        buf = io.BytesIO()
        with av.open(buf, mode="w", format="ogg") as oc:
            ostream = oc.add_stream("libopus", rate=16000)
            ostream.layout = "mono"
            for frame in ic.decode(istream):
                frame.pts = None
                for pkt in ostream.encode(frame):
                    oc.mux(pkt)
            for pkt in ostream.encode(None):
                oc.mux(pkt)
        return buf.getvalue()


def _client_factory():
    import httpx

    base = os.environ["CELTWO_MEMORY_API_URL"].rstrip("/")
    token = os.environ["CELTWO_MEMORY_API_TOKEN"]
    return httpx.Client(
        base_url=base,
        headers={"Authorization": f"Bearer {token}"},
        transport=httpx.HTTPTransport(retries=3),
        timeout=120.0,
    )


def run(args, *, client_factory=_client_factory, transcribe=None):
    with private_audio_dir() as audio_dir:
        return _run_with_audio_dir(args, audio_dir, client_factory=client_factory, transcribe=transcribe)


def _run_with_audio_dir(args, audio_dir, *, client_factory, transcribe):
    done = 0
    owns_model = False
    idle_since = None
    idle_seconds = max(0.0, float(os.environ.get("CELTWO_GPU_MODEL_IDLE_SECONDS", "60")))
    with client_factory() as client:
        while True:
            r = client.post("/jobs/claim", json={"worker": "gpu"})
            if r.status_code == 204:
                if args.loop:
                    if owns_model and idle_since is not None and time.monotonic() - idle_since >= idle_seconds:
                        transcribe = None
                        owns_model = False
                        idle_since = None
                        gc.collect()
                        print("modelo GPU liberado apos periodo ocioso")
                    time.sleep(args.poll)
                    continue
                break
            r.raise_for_status()
            idle_since = None
            job = r.json()
            jid = job["job_id"]
            tmp = den = None
            denoise_seconds = transcribe_seconds = None
            server_result = {}
            try:
                try:
                    audio = client.get(
                        f"/chunks/{job['session_id']}/{job['chunk_num']}/audio"
                    )
                    audio.raise_for_status()
                    with tempfile.NamedTemporaryFile(prefix="audio-", suffix=".opus", dir=audio_dir, delete=False) as fh:
                        fh.write(audio.content)
                        tmp = fh.name
                    denoise_started = time.perf_counter()
                    den = maybe_denoise(tmp)
                    denoise_seconds = time.perf_counter() - denoise_started
                    transcribe_started = time.perf_counter()
                    if transcribe is None:
                        transcribe = _default_transcribe()
                        owns_model = True
                    job_prompt = resolve_job_prompt(job)
                    body = transcribe(den, job_prompt)
                    transcribe_seconds = time.perf_counter() - transcribe_started
                    if isinstance(body, dict) and "completed" not in body:
                        body["completed"] = True

                    sr = client.post(f"/jobs/{jid}/segments", json=body)
                    sr.raise_for_status()
                    server_result = sr.json()
                    done += 1
                    print(
                        f"job {jid}  {job['session_id']} chunk {job['chunk_num']}  -> {server_result}"
                    )
                    if denoise_seconds is not None and transcribe_seconds is not None:
                        print(
                            f"tempos: denoise {denoise_seconds:.1f}s | "
                            f"transcricao {transcribe_seconds:.1f}s"
                        )
                    if den and tmp and den != tmp:
                        try:
                            up = client.post(
                                f"/chunks/{job['session_id']}/{job['chunk_num']}/denoised",
                                content=_wav_to_ogg_bytes(den),
                                headers={"Content-Type": "audio/ogg"},
                            )
                            up.raise_for_status()
                        except Exception as exc:
                            print(
                                f"job {jid}: upload denoised falhou ({exc})",
                                file=sys.stderr,
                            )
                except Exception as exc:
                    print(
                        f"job {jid}: erro ({exc}) - notificando falha ao servidor",
                        file=sys.stderr,
                    )
                    fail_body = {
                        "error_type": type(exc).__name__,
                        "message": str(exc)[:200],
                        "worker": "gpu",
                    }
                    try:
                        fr = client.post(f"/jobs/{jid}/fail", json=fail_body)
                        fr.raise_for_status()
                        server_result = fr.json()
                        print(f"job {jid} falha registrada -> {server_result}")
                    except Exception as fail_exc:
                        print(
                            f"job {jid}: falha ao notificar /jobs/{jid}/fail ({fail_exc})",
                            file=sys.stderr,
                        )
            finally:
                for p in {tmp, den} - {None}:
                    try:
                        os.unlink(p)
                    except OSError:
                        pass
                if owns_model:
                    idle_since = time.monotonic()
            if server_result.get("status") in ("retry", "pending"):
                print("servidor pediu retry; encerrando para preservar tentativas")
                break
            if args.once:
                break
    return done


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    n = run(args)
    print(f"{n} job(s) processado(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
