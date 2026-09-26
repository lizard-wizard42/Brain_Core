import logging
import os
import time

from services.memory.storage import database
from services.memory.storage.database import init_db
from services.memory.worker.diarizer import label_chunk
from services.memory.worker.transcriber import transcribe_chunk

POLL_SECONDS = float(os.environ.get("CELTWO_MEMORY_WORKER_POLL_SECONDS", "5"))
MAX_ATTEMPTS = int(os.environ.get("CELTWO_MEMORY_WORKER_MAX_ATTEMPTS", "3"))
RELABEL_MAX_ATTEMPTS = int(os.environ.get("CELTWO_MEMORY_RELABEL_MAX_ATTEMPTS", "5"))


def process_one_job() -> bool:
    job = database.next_pending_job()
    if job is None:
        return False

    database.mark_job_processing(job["id"])
    try:
        chunk = database.get_chunk(job["session_id"], job["chunk_num"])
        segments = transcribe_chunk(chunk["path"])
        database.insert_segments(job["session_id"], job["chunk_num"], segments)
        database.mark_job_done(job["id"])
        logging.info(
            "job %s (%s chunk %s) done", job["id"], job["session_id"], job["chunk_num"]
        )
    except Exception:
        logging.exception(
            "job %s (%s chunk %s) failed", job["id"], job["session_id"], job["chunk_num"]
        )
        database.mark_job_retry_or_failed(job["id"], job["attempts"], MAX_ATTEMPTS)
        return True

    # Speaker labelling is best-effort: a failure here must not fail the
    # transcription job (segments stay speaker=NULL until the next relabel).
    try:
        label_chunk(job["session_id"], job["chunk_num"])
    except Exception:
        logging.exception(
            "labelling %s chunk %s failed", job["session_id"], job["chunk_num"]
        )
        database.enqueue_relabel(job["session_id"], job["chunk_num"])
    return True


def process_one_relabel() -> bool:
    task = database.claim_next_relabel_task()
    if task is None:
        return False
    try:
        label_chunk(task["session_id"], task["chunk_num"])
    except Exception:
        logging.exception(
            "relabel %s chunk %s failed", task["session_id"], task["chunk_num"]
        )
        database.retry_relabel_task(task, RELABEL_MAX_ATTEMPTS)
        if task["attempts"] >= RELABEL_MAX_ATTEMPTS:
            logging.error("relabel %s chunk %s exhausted %s attempts; kept as failed",
                          task["session_id"], task["chunk_num"], task["attempts"])
        return True
    database.complete_relabel_task(task)
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    role = os.environ.get("CELTWO_MEMORY_WORKER_ROLE", "all")
    if role not in {"all", "relabel"}:
        raise ValueError(f"Unsupported worker role: {role}")
    init_db()
    if role == "all":
        reset_count = database.reset_stuck_jobs(MAX_ATTEMPTS)
        if reset_count > 0:
            logging.info("reset %s stuck job(s) from 'processing' back to pending/failed", reset_count)
        database.backfill_jobs()

    run_once = os.environ.get("CELTWO_MEMORY_WORKER_ONCE", "0") == "1"
    while True:
        processed = (process_one_relabel() if role == "relabel"
                     else process_one_job() or process_one_relabel())
        if not processed:
            if run_once:
                break
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
