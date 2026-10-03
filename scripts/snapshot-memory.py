#!/usr/bin/env python3
"""Consistent SQLite snapshot plus verified audio; run with Memory writers stopped."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3


def snapshot(data_dir, db_path, destination, source_root):
    data_dir = Path(data_dir).resolve()
    db_path = Path(db_path).resolve()
    destination = Path(destination).resolve()
    if destination.is_relative_to(data_dir):
        raise ValueError('Backup destination must be outside Memory data')
    destination.mkdir(parents=True, mode=0o700, exist_ok=False)
    source = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    target = sqlite3.connect(destination / 'memory.db')
    try:
        source.backup(target)
        if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity check failed')
        files = {}
        for row in target.execute('SELECT session_id,chunk_num,path,denoised_path,sha256,audio_purged_at FROM chunks'):
            session, number, raw, denoised, expected_hash, purged = row
            if purged:
                continue
            for column, stored, expected in [('path', raw, expected_hash), ('denoised_path', denoised, None)]:
                if not stored:
                    continue
                path = Path(stored)
                if not path.is_absolute():
                    path = Path(source_root) / path
                path = path.resolve(strict=True)
                relative = path.relative_to(data_dir)
                output = destination / relative
                output.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
                shutil.copy2(path, output)
                output.chmod(0o600)
                digest = hashlib.sha256(output.read_bytes()).hexdigest()
                if expected and digest != expected:
                    raise ValueError('Stored audio hash does not match file')
                files[str(relative)] = digest
                # Portable paths in the backup, never point a restored DB at live audio.
                target.execute(f'UPDATE chunks SET {column}=? WHERE session_id=? AND chunk_num=?',
                               (str(relative), session, number))
        target.commit()
        result = {'schema': target.execute('SELECT version FROM schema_version WHERE id=1').fetchone()[0],
                  'counts': {t: target.execute(f'SELECT count(*) FROM {t}').fetchone()[0]
                             for t in ['sessions', 'chunks', 'jobs', 'transcript_segments']},
                  'files': files, 'pathsRelativeTo': 'memory snapshot directory'}
        (destination / 'manifest.json').write_text(json.dumps(result, indent=2)+'\n')
        (destination / 'manifest.json').chmod(0o600)
        (destination / 'memory.db').chmod(0o600)
        return result
    finally:
        target.close()
        source.close()


def verify(directory):
    directory = Path(directory).resolve()
    manifest = json.loads((directory / 'manifest.json').read_text())
    conn = sqlite3.connect(f'file:{directory / "memory.db"}?mode=ro', uri=True)
    try:
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity check failed')
        for table, count in manifest['counts'].items():
            if table not in ['sessions', 'chunks', 'jobs', 'transcript_segments']:
                raise ValueError('Invalid manifest table')
            if conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0] != count:
                raise ValueError('SQLite restoration count mismatch')
        for name, digest in manifest['files'].items():
            file = (directory / name).resolve(strict=True)
            if not file.is_relative_to(directory):
                raise ValueError('Unsafe snapshot path')
            if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
                raise ValueError('Audio hash mismatch')
        for raw, denoised, purged in conn.execute('SELECT path,denoised_path,audio_purged_at FROM chunks'):
            if purged:
                continue
            for stored in [raw, denoised]:
                if stored and stored not in manifest['files']:
                    raise ValueError('Unverified audio reference')
        return manifest
    finally:
        conn.close()


def restore_paths(directory):
    """Only use on the restored copy; keep the portable backup unchanged."""
    directory = Path(directory).resolve()
    result = verify(directory)
    conn = sqlite3.connect(directory / 'memory.db')
    try:
        for session, number, raw, denoised, purged in conn.execute('SELECT session_id,chunk_num,path,denoised_path,audio_purged_at FROM chunks').fetchall():
            if purged:
                continue
            for column, stored in [('path', raw), ('denoised_path', denoised)]:
                if stored:
                    conn.execute(f'UPDATE chunks SET {column}=? WHERE session_id=? AND chunk_num=?',
                                 (str(directory / stored), session, number))
        conn.commit()
        for raw, denoised, purged in conn.execute('SELECT path,denoised_path,audio_purged_at FROM chunks'):
            if not purged:
                for stored in [raw, denoised]:
                    if stored and not Path(stored).is_file():
                        raise ValueError('Restored audio reference missing')
        return result
    finally:
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify')
    parser.add_argument('--restore-paths')
    parser.add_argument('--data-dir')
    parser.add_argument('--db')
    parser.add_argument('--destination')
    parser.add_argument('--source-root', default='.')
    args = parser.parse_args()
    if args.restore_paths:
        result = restore_paths(args.restore_paths)
    elif args.verify:
        result = verify(args.verify)
    else:
        if not all([args.data_dir, args.db, args.destination]):
            parser.error('data-dir, db and destination required')
        result = snapshot(args.data_dir, args.db, args.destination, args.source_root)
    print(json.dumps({'counts': result['counts'], 'verifiedFiles': len(result['files'])}))
