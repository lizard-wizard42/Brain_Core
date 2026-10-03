import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('snapshot_memory', Path(__file__).with_name('snapshot-memory.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'source'
        source.mkdir()
        audio = source / 'audio' / 'test.opus'
        audio.parent.mkdir()
        audio.write_bytes(b'synthetic audio')
        conn = sqlite3.connect(source / 'memory.db')
        conn.executescript('''CREATE TABLE schema_version(id INTEGER, version INTEGER);
          INSERT INTO schema_version VALUES(1,12);
          CREATE TABLE chunks(session_id TEXT,chunk_num INTEGER,path TEXT,denoised_path TEXT,sha256 TEXT,audio_purged_at TEXT);
          CREATE TABLE sessions(id TEXT); CREATE TABLE jobs(id TEXT); CREATE TABLE transcript_segments(id TEXT);''')
        conn.execute('INSERT INTO chunks VALUES (?,?,?,?,?,NULL)', ('synthetic',0,str(audio),None,hashlib.sha256(audio.read_bytes()).hexdigest()))
        conn.commit()
        conn.close()
        return source, audio

    def test_snapshot_restore_and_tampering(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, audio = self.fixture(root)
            destination = root / 'snapshot'
            module.snapshot(source, source / 'memory.db', destination, root)
            self.assertEqual(module.verify(destination)['counts']['chunks'], 1)
            conn = sqlite3.connect(destination / 'memory.db')
            self.assertEqual(conn.execute('SELECT path FROM chunks').fetchone()[0], 'audio/test.opus')
            conn.close()
            module.restore_paths(destination)
            conn = sqlite3.connect(destination / 'memory.db')
            self.assertEqual(conn.execute('SELECT path FROM chunks').fetchone()[0], str(destination / 'audio/test.opus'))
            conn.close()
            self.assertEqual(audio.read_bytes(), b'synthetic audio')

    def test_hash_and_escape_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, audio = self.fixture(root)
            destination = root / 'snapshot'
            module.snapshot(source, source / 'memory.db', destination, root)
            (destination / 'audio/test.opus').write_bytes(b'changed')
            with self.assertRaises(ValueError):
                module.verify(destination)
            outside = root / 'outside.opus'
            outside.write_bytes(audio.read_bytes())
            conn = sqlite3.connect(source / 'memory.db')
            conn.execute('UPDATE chunks SET path=?', (str(outside),))
            conn.commit()
            conn.close()
            with self.assertRaises(ValueError):
                module.snapshot(source, source / 'memory.db', root / 'unsafe', root)


if __name__ == '__main__':
    unittest.main()
