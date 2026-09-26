import os
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException

from services.memory.api.chunks import require_token
from services.memory.remote import RemoteCommandError, run_remote_command
from services.memory.storage import database

router = APIRouter()

_ANDROID_SERVICE_COMPONENT_DEFAULT = "com.celtwo.memoryrecorder/.recorder.MemoryRecorderService"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _generate_session_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    suffix = random.randint(10000, 99999)
    return f"{timestamp}-{suffix}"


def _android_service_component() -> str:
    return os.environ.get("CELTWO_MEMORY_ANDROID_SERVICE", _ANDROID_SERVICE_COMPONENT_DEFAULT)


def _send_recorder_action(action: str, session_id: str) -> None:
    component = _android_service_component()
    command = (
        f'su -c "am start-foreground-service -n {component} '
        f'--es action com.celtwo.memory.{action} --es session_id {session_id}"'
    )
    output = run_remote_command(command)
    if "Starting service" not in output:
        raise RemoteCommandError(f"unexpected output from am start-foreground-service: {output!r}")


def _status_response() -> dict:
    state = database.get_recording_state()
    if state["active_session_id"] is not None:
        return {
            "state": "recording",
            "started_at": state["started_at"],
            "last_communication_at": _now_iso(),
            "device_id": state["device_id"],
        }
    return {
        "state": "stopped",
        "started_at": None,
        "last_communication_at": _now_iso(),
        "device_id": None,
    }


@router.get("/status")
def remember_status() -> dict:
    return _status_response()


@router.post("/start")
def start_recording(authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)

    if database.get_recording_state()["active_session_id"] is not None:
        return _status_response()

    device_id = os.environ.get("CELTWO_MEMORY_DEVICE_ID", "galaxy-a7")
    session_id = _generate_session_id()

    try:
        _send_recorder_action("START", session_id)
    except RemoteCommandError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    database.set_recording_state(session_id, device_id, _now_iso())
    return _status_response()


@router.post("/stop")
def stop_recording(authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)

    state = database.get_recording_state()
    if state["active_session_id"] is None:
        return _status_response()

    try:
        _send_recorder_action("STOP", state["active_session_id"])
    except RemoteCommandError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    database.clear_recording_state()
    return _status_response()
