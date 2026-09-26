# Optional transcription worker on a GPU computer

The standard [Memory installation](../../docs/REMEMBER_TIMELINE.md) runs a
transcription worker on the CPU inside Docker. This directory provides a
separate worker that claims the same jobs through the Memory API and runs
faster-whisper on a GPU. The supported setup below is Linux with an NVIDIA
GPU on the **same computer** as the Docker stack. The Memory API binds only to
`127.0.0.1` in this setup; never publish it to the internet.

Models, recordings, tokens, benchmarks and virtual environments are not
included in Git. The worker downloads its model on first use. It temporarily
downloads each claimed audio chunk, deletes the temporary copy when the job
finishes, and returns transcript segments to the Memory API.

## 1. Start Brain Core and the Memory API

Complete the [Docker quick start](../../README.md#quick-start), then create
`.env.memory` as described in the [timeline guide](../../docs/REMEMBER_TIMELINE.md).
From the repository root:

```bash
# Stop an existing CPU transcription worker before switching to the GPU worker.
docker compose --env-file .env.docker --env-file .env.memory \
  -f compose.yaml -f compose.memory.yaml stop memory-worker

docker compose --env-file .env.docker --env-file .env.memory \
  -f compose.yaml -f compose.memory.yaml -f compose.memory.gpu.yaml \
  up --build -d

docker compose --env-file .env.docker --env-file .env.memory \
  -f compose.yaml -f compose.memory.yaml -f compose.memory.gpu.yaml ps
```

The GPU override leaves `memory-worker` in an inactive Compose profile and
binds `memory-api` to `127.0.0.1:8765` on the host. If that port is occupied,
set `CELTWO_MEMORY_API_HOST_PORT` to a free local port in `.env.memory` and use
the same port in `CELTWO_MEMORY_API_URL` below. The API still requires its
private bearer token. Check the local health endpoint with
`curl -fsS http://127.0.0.1:8765/health`. Keep `.env.memory` private.

## 2. Prepare the NVIDIA runtime and Python environment

Install a compatible NVIDIA driver for your Linux distribution and check
`nvidia-smi`. This host Python worker does **not** need the NVIDIA Container
Toolkit or a full system CUDA toolkit. It uses the CUDA 12 cuBLAS and cuDNN 9
libraries installed by `requirements-nvidia.txt`. Use Python 3.9 or newer.
From the repository root:

```bash
cd services/gpu-worker
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-nvidia.txt

# The CUDA libraries from pip must be discoverable before Python starts.
export LD_LIBRARY_PATH="$(python -c 'import os, nvidia.cublas.lib, nvidia.cudnn.lib; print(":".join((os.path.dirname(nvidia.cublas.lib.__file__), os.path.dirname(nvidia.cudnn.lib.__file__))))')${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
python -c 'import ctranslate2; print(ctranslate2.get_supported_compute_types("cuda"))'
```

If the last command cannot see CUDA, check the driver and the
[faster-whisper GPU requirements](https://github.com/SYSTRAN/faster-whisper#gpu).
The available compute types depend on the actual GPU and runtime. Do not
assume a particular model will fit solely from its name.

## 3. Configure and start the worker

In the same activated terminal, set the API address and enter the token from
your private `.env.memory` without putting it in shell history:

```bash
export CELTWO_MEMORY_API_URL=http://127.0.0.1:8765
read -rsp 'Memory API token: ' CELTWO_MEMORY_API_TOKEN; echo
export CELTWO_MEMORY_API_TOKEN

# Start with a smaller model, then adjust to your GPU and quality needs.
export CELTWO_GPU_WHISPER_DEVICE=cuda
export CELTWO_GPU_WHISPER_MODEL=small
export CELTWO_GPU_WHISPER_COMPUTE_TYPE=int8_float16
python gpu_worker.py --loop
```

The default model in code is `medium`; setting `small` explicitly gives a
lower resource starting point. Other faster-whisper model names can be set in
`CELTWO_GPU_WHISPER_MODEL`, such as `medium`, `large-v3-turbo` or `large-v3`.
Try `float16` if supported and enough GPU memory is available. On a memory
allocation error, return to `small` or use `int8_float16`. The worker loads
its model when it receives a job and releases it after an idle period
(`CELTWO_GPU_MODEL_IDLE_SECONDS`, default 60 seconds). Stop it with Ctrl+C.

`CELTWO_MEMORY_WHISPER_LANGUAGE` defaults to `pt`; set it to another supported
language code if your recordings use a different language. Optional audio
denoising is off by default. Enabling `CELTWO_GPU_DENOISE=1` additionally
requires a compatible PyTorch, torchaudio and DeepFilterNet installation;
their versions and GPU requirements depend on your platform. First verify
transcription with denoising off.

The GPU worker needs a running process. If you make it a system service,
provide the same environment, use a private service account, and keep the
token outside the unit file and repository. Verify actual transcript progress
in Brain Core with a short fictional test recording before relying on it.

## CPU, other GPUs and remote computers

For any machine without a compatible NVIDIA CUDA setup, keep the default
Docker CPU worker from the [timeline guide](../../docs/REMEMBER_TIMELINE.md).
This is the supported path for AMD and Intel GPUs in this repository. The
faster-whisper/CTranslate2 CUDA path above has not been validated here for
ROCm, oneAPI, macOS, or Windows; their CPU execution may still work through
the standard Compose worker.

A GPU computer on another host cannot use `127.0.0.1` on the Brain Core host.
Give it access only through a private network or authenticated tunnel, keep
the Memory API off public interfaces, and use its private HTTPS address as
`CELTWO_MEMORY_API_URL`. This repo does not ship a remote API exposure recipe;
review network access, TLS, token storage, and host firewall rules before
enabling that topology.

To switch back to CPU transcription, stop the host GPU worker, then recreate
the standard Memory stack **without** the GPU override:

```bash
docker compose --env-file .env.docker --env-file .env.memory \
  -f compose.yaml -f compose.memory.yaml up --build -d
```

Confirm `memory-worker` is running, and confirm the Memory API is no longer
published on the host. Never use `down -v` unless you intend to erase the
Memory volume and its recordings and transcripts.

## Reference documentation

- [faster-whisper requirements and compute types](https://github.com/SYSTRAN/faster-whisper#gpu)
- [CTranslate2 supported compute types](https://opennmt.net/CTranslate2/quantization.html)
- [NVIDIA Linux driver installation](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/)
