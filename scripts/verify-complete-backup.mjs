#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { withPrivatePostgres, run } from './private-postgres.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(scriptDir, '..', 'backend', 'package.json'));
const snapshot = fs.realpathSync(process.argv[2] || '');
const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'));
if (manifest.formatVersion !== 2) throw new Error('A complete formatVersion=2 backup is required');
for (const [name, digest] of Object.entries(manifest.fileHashes || {})) {
  const files = path.join(snapshot, 'files');
  const candidate = fs.realpathSync(path.join(files, name));
  if (!candidate.startsWith(`${files}${path.sep}`) || createHash('sha256').update(fs.readFileSync(candidate)).digest('hex') !== digest) {
    throw new Error('Restored file hash mismatch');
  }
}
const { Client } = require('pg');
await withPrivatePostgres(async (config) => {
  run(path.join(config.binaries, 'pg_restore'), ['--exit-on-error', '--no-owner', '--no-privileges',
    '--host', config.host, '--port', String(config.port), '--username', config.user, '--dbname', config.database,
    path.join(snapshot, 'database.dump')]);
  const client = new Client(config);
  await client.connect();
  try {
    for (const [table, count] of Object.entries(manifest.postgresCounts)) {
      if (!['users', 'pages', 'page_versions', 'remember_notes', 'uploaded_assets', 'integration_tokens', 'integration_operations', 'integration_audit', 'remember_note_versions'].includes(table)) throw new Error('Unexpected table');
      const restored = Number((await client.query(`SELECT count(*)::text AS count FROM ${table}`)).rows[0].count);
      if (restored !== count) throw new Error('PostgreSQL restoration count mismatch');
    }
    const assets = (await client.query('SELECT relative_path FROM uploaded_assets')).rows;
    for (const { relative_path } of assets) {
      const uploads = path.join(snapshot, 'files', 'uploads');
      const candidate = path.resolve(uploads, relative_path);
      if (!candidate.startsWith(`${uploads}${path.sep}`) || !fs.statSync(candidate).isFile()) throw new Error('Restored asset missing');
    }
  } finally { await client.end(); }
  if (manifest.memoryIncluded) {
    // Verify a separate restored copy, including relocation of audio references.
    const restored = path.join(config.root, 'memory');
    fs.cpSync(path.join(snapshot, 'memory'), restored, { recursive: true });
    run('python3', [path.join(scriptDir, 'snapshot-memory.py'), '--restore-paths', restored]);
  }
  console.log('Restoration verified: PostgreSQL counts, uploaded assets, SQLite and audio hashes. Disposable cluster removed on exit.');
});
