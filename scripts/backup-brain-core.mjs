#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(process.env.BRAIN_PROJECT_ROOT || path.join(scriptDir, '..'));
const backendRequire = createRequire(path.join(projectRoot, 'backend', 'package.json'));
const dotenv = backendRequire('dotenv');

const envFile = path.join(projectRoot, 'backend', '.env');
const loaded = dotenv.config({ path: envFile });
if (loaded.error) {
  throw new Error(`Não foi possível carregar ${envFile}: ${loaded.error.message}`);
}

const backupRoot = path.resolve(process.env.BRAIN_BACKUP_DIR || path.join(projectRoot, 'backups', 'brain-core'));
const retention = Math.min(Math.max(Number.parseInt(process.env.BRAIN_BACKUP_RETENTION || '14', 10) || 14, 1), 365);
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const snapshotName = `brain-core-${os.hostname()}-${timestamp}`;
const partialDir = path.join(backupRoot, `.partial-${snapshotName}`);
const finalDir = path.join(backupRoot, snapshotName);
const databaseDump = path.join(partialDir, 'database.dump');

const db = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || '5432',
  name: process.env.DB_NAME || 'brain_core_db',
  user: process.env.DB_USER || 'brain_core_app',
  password: process.env.DB_PASSWORD || '',
};

const dataSources = [
  {
    name: 'markdown',
    source: path.resolve(process.env.MD_SOURCE_PATH || path.join(projectRoot, 'data', 'markdown')),
  },
  { name: 'uploads', source: path.join(projectRoot, 'uploads') },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} terminou com código ${result.status}`);
  }
}

function snapshotDirectories() {
  if (!fs.existsSync(backupRoot)) return [];
  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^brain-core-.+-\d{8}T\d{6}Z$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function fileHashes(directory, prefix = '') {
  const hashes = {};
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlink in file backup; use a concrete data directory');
    if (entry.isDirectory()) Object.assign(hashes, fileHashes(file, name));
    else if (entry.isFile()) hashes[name] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return hashes;
}

fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(backupRoot, 0o700);
for (const item of dataSources) {
  if (!fs.statSync(item.source, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Fonte obrigatória ausente: ${item.source}`);
  }
}

const memoryDir = path.resolve(process.env.BRAIN_MEMORY_DIR || path.join(projectRoot, 'data', 'memory'));
const memoryDb = path.resolve(process.env.BRAIN_MEMORY_DB || path.join(memoryDir, 'memory.db'));
const memoryEnabled = fs.existsSync(memoryDb);
if (memoryEnabled && process.env.BRAIN_MEMORY_QUIESCED !== 'true') {
  throw new Error('Pare os writers da Memory e use BRAIN_MEMORY_QUIESCED=true; instalações user-systemd podem usar run-complete-backup.sh');
}
const previous = snapshotDirectories().at(-1);
fs.mkdirSync(partialDir, { recursive: false, mode: 0o700 });

try {
  const { Client } = backendRequire('pg');
  const connection = new Client({ host: db.host, port: Number(db.port), database: db.name, user: db.user, password: db.password });
  await connection.connect();
  let postgresCounts;
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await connection.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    postgresCounts = {};
    const includedTables = ['users', 'pages', 'page_versions', 'remember_notes', 'uploaded_assets',
      'integration_tokens', 'integration_settings', 'integration_operations', 'integration_audit', 'remember_note_versions'];
    for (const table of includedTables) {
      if (!(await connection.query('SELECT to_regclass($1) AS relation', [table])).rows[0].relation) continue;
      postgresCounts[table] = Number((await connection.query(`SELECT count(*)::text AS count FROM ${table}`)).rows[0].count);
    }
    run('/usr/bin/pg_dump', [
    '--snapshot', snapshot,
    '--host', db.host,
    '--port', db.port,
    '--username', db.user,
    '--dbname', db.name,
    '--format=custom',
    '--compress=9',
    '--no-owner',
    '--no-privileges',
    '--file', databaseDump,
  ], {
    env: { ...process.env, PGPASSWORD: db.password, PGAPPNAME: 'brain-core-backup' },
  });

    await connection.query('COMMIT');
  } finally { await connection.end(); }

  if (!fs.statSync(databaseDump).size) {
    throw new Error('pg_dump produziu um arquivo vazio');
  }
  fs.chmodSync(databaseDump, 0o600);
  run('/usr/bin/pg_restore', ['--list', databaseDump], { stdio: 'ignore' });

  for (const item of dataSources) {
    const destination = path.join(partialDir, 'files', item.name);
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    const args = ['-a', '--checksum', '--delete'];
    if (previous) {
      args.push(`--link-dest=${path.join(backupRoot, previous, 'files', item.name)}`);
    }
    args.push(`${item.source}/`, `${destination}/`);
    run('/usr/bin/rsync', args);
  }

  if (memoryEnabled) {
    run(process.env.BRAIN_MEMORY_PYTHON || 'python3', [path.join(scriptDir, 'snapshot-memory.py'),
      '--data-dir', memoryDir, '--db', memoryDb, '--source-root', projectRoot,
      '--destination', path.join(partialDir, 'memory')]);
  }
  const manifest = {
    formatVersion: 2,
    postgresCounts,
    memoryIncluded: memoryEnabled,
    fileHashes: fileHashes(path.join(partialDir, 'files')),
    createdAt: new Date().toISOString(),
    hostname: os.hostname(),
    database: db.name,
    databaseFormat: 'pg_dump custom',
    sources: dataSources.map((item) => path.relative(projectRoot, item.source)),
    retentionSnapshots: retention,
    previousSnapshot: previous || null,
  };
  const manifestPath = path.join(partialDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  fs.renameSync(partialDir, finalDir);
  const nextLink = path.join(backupRoot, '.latest.tmp');
  fs.rmSync(nextLink, { force: true });
  fs.symlinkSync(snapshotName, nextLink);
  fs.renameSync(nextLink, path.join(backupRoot, 'latest'));

  const expired = snapshotDirectories().reverse().slice(retention);
  for (const name of expired) {
    fs.rmSync(path.join(backupRoot, name), { recursive: true });
    console.log(`[backup] removido por retenção: ${name}`);
  }

  const size = fs.statSync(path.join(finalDir, 'database.dump')).size;
  console.log(`[backup] concluído: ${finalDir}`);
  console.log(`[backup] dump PostgreSQL validado: ${size} bytes`);
  console.log(`[backup] snapshots mantidos: ${snapshotDirectories().length}/${retention}`);
} catch (error) {
  fs.rmSync(partialDir, { recursive: true, force: true });
  console.error(`[backup] falha: ${error.message}`);
  process.exitCode = 1;
}
