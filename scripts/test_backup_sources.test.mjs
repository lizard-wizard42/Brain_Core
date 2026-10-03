import test from 'node:test';
import assert from 'node:assert/strict';
import { backupSources } from './backup-sources.mjs';

test('backup defaults match native upload and Memory consumers', () => {
  const sources = backupSources('/opt/brain-core', {});
  assert.equal(sources.files[1].source, '/opt/brain-core/backend/uploads');
  assert.equal(sources.memoryDir, '/opt/brain-core/data/memory');
  assert.equal(sources.memoryDb, '/opt/brain-core/data/memory/memory.db');
});
test('runtime overrides and explicit backup Memory overrides have defined precedence', () => {
  const env = { UPLOADS_DIR: '/private/uploads', CELTWO_MEMORY_DATA_DIR: '/private/memory', CELTWO_MEMORY_DB_PATH: '/private/index.db' };
  let sources = backupSources('/opt/brain-core', env);
  assert.equal(sources.files[1].source, env.UPLOADS_DIR);
  assert.equal(sources.memoryDir, env.CELTWO_MEMORY_DATA_DIR);
  assert.equal(sources.memoryDb, env.CELTWO_MEMORY_DB_PATH);
  sources = backupSources('/opt/brain-core', { ...env, BRAIN_MEMORY_DIR: '/snapshot/memory', BRAIN_MEMORY_DB: '/snapshot/index.db' });
  assert.equal(sources.memoryDir, '/snapshot/memory');
  assert.equal(sources.memoryDb, '/snapshot/index.db');
});

test('relative runtime paths use the consumer working directory, not the backup caller', () => {
  const sources = backupSources('/opt/brain-core', { MD_SOURCE_PATH: '../notes', UPLOADS_DIR: 'files', CELTWO_MEMORY_DATA_DIR: 'memory-data', CELTWO_MEMORY_DB_PATH: 'index.db' });
  assert.equal(sources.files[0].source, '/opt/brain-core/notes');
  assert.equal(sources.files[1].source, '/opt/brain-core/backend/files');
  assert.equal(sources.memoryDir, '/opt/brain-core/memory-data');
  assert.equal(sources.memoryDb, '/opt/brain-core/index.db');
});
