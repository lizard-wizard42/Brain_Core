FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CELTWO_ENV=production \
    CELTWO_MEMORY_DATA_DIR=/data/memory \
    HF_HOME=/data/memory/models/huggingface \
    XDG_CACHE_HOME=/data/memory/cache

WORKDIR /app
RUN apt-get update \
    && apt-get install --no-install-recommends -y libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/memory-requirements.txt
RUN pip install --no-cache-dir -r /tmp/memory-requirements.txt \
    && groupadd --system --gid 10001 memory \
    && useradd --system --uid 10001 --gid memory --home-dir /data/memory memory \
    && mkdir -p /data/memory /app/services/memory \
    && chown -R memory:memory /data/memory
COPY . /app/services/memory/

USER 10001:10001
EXPOSE 8765
