#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
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

fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(backupRoot, 0o700);
for (const item of dataSources) {
  if (!fs.statSync(item.source, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Fonte obrigatória ausente: ${item.source}`);
  }
}

const previous = snapshotDirectories().at(-1);
fs.mkdirSync(partialDir, { recursive: false, mode: 0o700 });

try {
  run('/usr/bin/pg_dump', [
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

  if (!fs.statSync(databaseDump).size) {
    throw new Error('pg_dump produziu um arquivo vazio');
  }
  fs.chmodSync(databaseDump, 0o600);
  run('/usr/bin/pg_restore', ['--list', databaseDump], { stdio: 'ignore' });

  for (const item of dataSources) {
    const destination = path.join(partialDir, 'files', item.name);
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    const args = ['-a', '--delete'];
    if (previous) {
      args.push(`--link-dest=${path.join(backupRoot, previous, 'files', item.name)}`);
    }
    args.push(`${item.source}/`, `${destination}/`);
    run('/usr/bin/rsync', args);
  }

  const manifest = {
    formatVersion: 1,
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
