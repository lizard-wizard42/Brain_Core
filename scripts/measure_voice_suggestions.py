#!/usr/bin/env python3
"""Read-only measurement of Memory speaker-suggestion coverage and separability.

Opens the Memory database read-only and prints aggregate numbers only: no
transcript text, identifiers, audio or embeddings are printed or written.

    CELTWO_MEMORY_DATA_DIR=data/memory \
    services/memory/.venv/bin/python scripts/measure_voice_suggestions.py [--sample 200]

Sections:
  1. Coverage: how many transcript segments are long enough (3-60 s) and free of
     overlap to receive a suggestion today, and how many more would qualify if
     neighbouring segments closer than --gap-ms were merged.
  2. Separability: cosine similarity of sampled eligible segments to each
     account's enrolled voice. A clearly two-humped histogram means "me" and
     "others" can be separated; a single hump means thresholds alone will not work.
  3. Accuracy: leave-one-out check against manual confirmations, when enough exist.
"""
from __future__ import annotations

import argparse
import random
import sqlite3
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.memory.storage.database import get_db_path  # noqa: E402
from services.memory.worker.diarizer import decode_pcm_16k_mono  # noqa: E402
from services.memory.worker.embedder import EMBED_MODEL_NAME, get_embedder  # noqa: E402

MIN_MS, MAX_MS, SR = 3000, 60000, 16000
MIN_LABELS = 5


def pct(n: int, d: int) -> str:
    return f"{100 * n / d:.0f}%" if d else "n/a"


def percentiles(values: list[int]) -> str:
    if not values:
        return "n/a"
    p = np.percentile(values, [10, 25, 50, 75, 90]) / 1000
    return " ".join(f"p{q}={v:.1f}s" for q, v in zip((10, 25, 50, 75, 90), p))


def merged_durations(segs: list[sqlite3.Row], gap_ms: int) -> list[int]:
    """Durations after joining consecutive segments of one chunk separated by < gap_ms."""
    out: list[int] = []
    cur = None
    for s in segs:
        if cur and s["chunk_key"] == cur[0] and s["start_ms"] - cur[2] < gap_ms:
            cur[2] = max(cur[2], s["end_ms"])
        else:
            if cur:
                out.append(cur[2] - cur[1])
            cur = [s["chunk_key"], s["start_ms"], s["end_ms"]]
    if cur:
        out.append(cur[2] - cur[1])
    return out


def coverage(conn: sqlite3.Connection, owner: str, gap_ms: int) -> list[sqlite3.Row]:
    segs = conn.execute(
        "SELECT ts.id, ts.start_ms, ts.end_ms, ts.session_id || ':' || ts.chunk_num AS chunk_key "
        "FROM transcript_segments ts JOIN sessions s ON s.id=ts.session_id AND s.owner_user_id=? "
        "ORDER BY ts.session_id, ts.chunk_num, ts.start_ms", (owner,)).fetchall()
    durs = [s["end_ms"] - s["start_ms"] for s in segs]
    ok = sum(MIN_MS <= d <= MAX_MS for d in durs)
    merged = merged_durations(segs, gap_ms)
    ok_merged = sum(MIN_MS <= d <= MAX_MS for d in merged)
    print(f"  segments: {len(segs)}   durations: {percentiles(durs)}")
    print(f"  eligible today (3-60 s): {ok} ({pct(ok, len(segs))})")
    print(f"  after merging gaps < {gap_ms} ms: {ok_merged} of {len(merged)} units ({pct(ok_merged, len(merged))})")
    return segs


def load_clip(conn: sqlite3.Connection, seg_id: int):
    row = conn.execute(
        "SELECT ts.start_ms, ts.end_ms, c.path, c.audio_purged_at FROM transcript_segments ts "
        "JOIN chunks c ON c.session_id=ts.session_id AND c.chunk_num=ts.chunk_num WHERE ts.id=?",
        (seg_id,)).fetchone()
    if row is None or row["audio_purged_at"] or not Path(row["path"]).is_file():
        return None
    pcm = decode_pcm_16k_mono(row["path"], max_samples=300 * SR)
    clip = pcm[round(row["start_ms"] * SR / 1000):round(row["end_ms"] * SR / 1000)]
    if clip.size < MIN_MS * SR // 1000 or float(np.sqrt(np.mean(clip ** 2))) < 0.01:
        return None
    return clip


def embed(embedder, clip) -> np.ndarray:
    v = np.asarray(embedder.embed(clip), dtype=np.float32)
    return v / (np.linalg.norm(v) or 1)


def separability(conn, owner, segs, embedder, sample: int, seed: int) -> None:
    vp = conn.execute("SELECT embedding FROM account_voiceprints WHERE owner_user_id=? AND model=?",
                      (owner, EMBED_MODEL_NAME)).fetchone()
    if vp is None:
        print("  no enrolled voice for this account; skipping separability")
        return
    ref = np.frombuffer(vp["embedding"], dtype=np.float32)
    ref = ref / (np.linalg.norm(ref) or 1)
    pool = [s["id"] for s in segs if MIN_MS <= s["end_ms"] - s["start_ms"] <= MAX_MS]
    random.Random(seed).shuffle(pool)
    sims = []
    for seg_id in pool[:sample]:
        clip = load_clip(conn, seg_id)
        if clip is not None:
            sims.append(float(np.dot(embed(embedder, clip), ref)))
    if len(sims) < 10:
        print(f"  only {len(sims)} usable samples; skipping separability")
        return
    sims_a = np.array(sims)
    hist, edges = np.histogram(sims_a, bins=np.arange(-0.2, 1.01, 0.1))
    print(f"  similarity to enrolled voice, n={len(sims)} (sampled eligible segments)")
    for count, lo in zip(hist, edges):
        print(f"    {lo:5.2f}..{lo + 0.1:4.2f} {'#' * int(round(40 * count / hist.max())):<40} {count}")
    print(f"  >=0.55: {pct(int((sims_a >= .55).sum()), len(sims))}   "
          f"<=0.25: {pct(int((sims_a <= .25).sum()), len(sims))}   "
          f"ambiguous: {pct(int(((sims_a > .25) & (sims_a < .55)).sum()), len(sims))}")


def accuracy(conn, owner, embedder) -> None:
    rows = conn.execute(
        "SELECT t.identity_id, t.embedding, t.source_segment_id FROM voice_templates t "
        "WHERE t.owner_user_id=? AND t.model=? AND t.deleted_at IS NULL",
        (owner, EMBED_MODEL_NAME)).fetchall()
    if len(rows) < MIN_LABELS or len({r["identity_id"] for r in rows}) < 2:
        print(f"  not enough confirmed references for leave-one-out "
              f"({len(rows)} templates, need >= {MIN_LABELS} across >= 2 participants)")
        return
    refs = [(r["identity_id"], np.frombuffer(r["embedding"], dtype=np.float32), r["source_segment_id"]) for r in rows]
    hits = total = 0
    for ident, vec, seg_id in refs:
        others = [(i, v) for i, v, s in refs if s != seg_id]
        if len({i for i, _ in others}) < 2:
            continue
        best = max(others, key=lambda iv: float(np.dot(vec, iv[1]) / (np.linalg.norm(iv[1]) or 1)))
        total += 1
        hits += best[0] == ident
    print(f"  leave-one-out top-1 accuracy: {hits}/{total} ({pct(hits, total)})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sample", type=int, default=200, help="max segments embedded per account")
    ap.add_argument("--gap-ms", type=int, default=800, help="merge neighbours closer than this")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    path = get_db_path()
    if not path.is_file():
        print(f"database not found: {path}", file=sys.stderr)
        return 1
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    owners = [r[0] for r in conn.execute(
        "SELECT DISTINCT owner_user_id FROM sessions WHERE owner_user_id IS NOT NULL ORDER BY 1")]
    embedder = get_embedder()
    for n, owner in enumerate(owners, 1):
        print(f"\nAccount #{n}")
        print("[coverage]")
        segs = coverage(conn, owner, args.gap_ms)
        print("[separability]")
        separability(conn, owner, segs, embedder, args.sample, args.seed)
        print("[accuracy]")
        accuracy(conn, owner, embedder)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
