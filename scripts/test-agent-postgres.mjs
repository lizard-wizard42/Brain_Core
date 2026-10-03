#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withPrivatePostgres } from './private-postgres.mjs';

await withPrivatePostgres(async (config) => {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', fileURLToPath(new URL('../backend/test/agent-postgres.integration.cjs', import.meta.url))], {
      stdio: 'inherit', env: { ...process.env, DB_HOST: config.host, DB_PORT: String(config.port), DB_USER: config.user,
        DB_NAME: config.database, DB_PASSWORD: '', JWT_SECRET: 'synthetic-agent-test-key-not-a-deployment-secret-0123456789',
        BRAIN_AGENT_DISPOSABLE: 'true', UPLOADS_DIR: `${config.root}/empty-uploads` },
    });
    child.once('error', reject); child.once('exit', resolve);
  });
  if (code !== 0) throw new Error('Agent integration tests failed');
});
