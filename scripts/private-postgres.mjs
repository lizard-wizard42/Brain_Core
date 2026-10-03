import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status})`);
  return result.stdout;
}

// Disposable Unix-socket-only cluster: no production connection or TCP listener.
export async function withPrivatePostgres(callback) {
  const binaries = run('pg_config', ['--bindir']).trim();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-core-restore-'));
  fs.chmodSync(root, 0o700);
  const data = path.join(root, 'postgres');
  const socket = path.join(root, 'socket'); fs.mkdirSync(socket, { mode: 0o700 });
  const log = path.join(root, 'postgres.log');
  let started = false;
  try {
    run(path.join(binaries, 'initdb'), ['-D', data, '-U', 'brain_restore', '--auth=trust', '--no-locale', '--encoding=UTF8']);
    run(path.join(binaries, 'pg_ctl'), ['-D', data, '-l', log, '-o', `-k ${socket} -h '' -p 55439`, '-w', 'start']);
    started = true;
    return await callback({ root, host: socket, port: 55439, user: 'brain_restore', database: 'postgres', binaries });
  } finally {
    if (started) run(path.join(binaries, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
