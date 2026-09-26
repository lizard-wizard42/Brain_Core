import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("gpu_worker", Path(__file__).with_name("gpu_worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class PrivateAudioTests(unittest.TestCase):
    def test_stale_audio_only_is_removed(self):
        with tempfile.TemporaryDirectory() as root, patch.object(worker.tempfile, "gettempdir", return_value=root):
            with worker.private_audio_dir() as directory:
                raw = directory / "audio-test_1.opus"
                den = directory / "audio-test_1.opus.denoised.wav"
                unrelated = directory / "notes.txt"
                outside = Path(root) / "outside.txt"
                for path in (raw, den, unrelated, outside):
                    path.write_bytes(b"synthetic")
                self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
            with worker.private_audio_dir():
                self.assertFalse(raw.exists())
                self.assertFalse(den.exists())
                self.assertTrue(unrelated.exists())
                self.assertTrue(outside.exists())

    def test_rejects_symlink_directory(self):
        with tempfile.TemporaryDirectory() as root, patch.object(worker.tempfile, "gettempdir", return_value=root):
            target = Path(root) / "target"
            target.mkdir()
            (Path(root) / f"celtwo-gpu-worker-{os.getuid()}").symlink_to(target)
            with self.assertRaises(RuntimeError):
                with worker.private_audio_dir():
                    pass

    def test_active_worker_prevents_cleanup(self):
        with tempfile.TemporaryDirectory() as root, patch.object(worker.tempfile, "gettempdir", return_value=root):
            with worker.private_audio_dir() as directory:
                raw = directory / "audio-active.opus"
                raw.write_bytes(b"synthetic")
                with self.assertRaises(BlockingIOError):
                    with worker.private_audio_dir():
                        pass
                self.assertTrue(raw.exists())


if __name__ == "__main__":
    unittest.main()
