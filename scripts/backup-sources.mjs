import path from 'node:path';

// Resolve after dotenv has loaded, using the same native defaults as consumers.
export function backupSources(projectRoot, env = process.env) {
  const memoryDir = path.resolve(projectRoot, env.BRAIN_MEMORY_DIR || env.CELTWO_MEMORY_DATA_DIR || path.join(projectRoot, 'data', 'memory'));
  return {
    files: [
      { name: 'markdown', source: path.resolve(projectRoot, 'backend', env.MD_SOURCE_PATH || path.join(projectRoot, 'data', 'markdown')) },
      { name: 'uploads', source: path.resolve(projectRoot, 'backend', env.UPLOADS_DIR || path.join(projectRoot, 'backend', 'uploads')) },
    ],
    memoryDir,
    memoryDb: path.resolve(projectRoot, env.BRAIN_MEMORY_DB || env.CELTWO_MEMORY_DB_PATH || path.join(memoryDir, 'memory.db')),
  };
}
