import os
import subprocess


class RemoteCommandError(Exception):
    pass


def run_remote_command(command: str) -> str:
    ssh_bin = os.environ.get("CELTWO_MEMORY_SSH_BIN", "ssh")
    target = os.environ.get("CELTWO_SSH_TARGET", "a7")
    timeout = float(os.environ.get("CELTWO_MEMORY_SSH_TIMEOUT_SECONDS", "15"))

    try:
        result = subprocess.run(
            [ssh_bin, "-o", "BatchMode=yes", "-o", f"ConnectTimeout={int(timeout)}", target, command],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise RemoteCommandError(f"timed out after {timeout}s running: {command}") from exc
    except OSError as exc:
        raise RemoteCommandError(f"failed to run {ssh_bin}: {exc}") from exc

    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RemoteCommandError(f"command exited {result.returncode}: {detail}")

    return result.stdout
