const assert = require('node:assert/strict');
const test = require('node:test');

const { buildTerminalEnvironment } = require('../dist/services/terminalService');

test('keeps shell essentials without backend secrets or agent capabilities', () => {
  const source = {
    HOME: '/home/tester',
    USER: 'tester',
    LOGNAME: 'tester',
    SHELL: '/bin/bash',
    PATH: '/custom/bin:/usr/bin:/bin',
    LANG: 'pt_BR.UTF-8',
    LC_TIME: 'pt_BR.UTF-8',
    JWT_SECRET: 'jwt-secret',
    DB_PASSWORD: 'db-secret',
    OPENAI_API_KEY: 'api-secret',
    TELEGRAM_BOT_TOKEN: 'telegram-secret',
    CELTWO_MEMORY_TOKEN: 'memory-secret',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    ARBITRARY_SECRET: 'unknown-secret',
  };

  const result = buildTerminalEnvironment(source);

  assert.deepEqual(result, {
    HOME: '/home/tester',
    USER: 'tester',
    LOGNAME: 'tester',
    SHELL: '/bin/bash',
    PATH: '/custom/bin:/usr/bin:/bin',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'pt_BR.UTF-8',
    LC_TIME: 'pt_BR.UTF-8',
  });
  assert.equal(source.JWT_SECRET, 'jwt-secret');
});

test('uses safe fallbacks and does not copy arbitrary variables', () => {
  const result = buildTerminalEnvironment({ USER: 'tester' });

  assert.equal(result.USER, 'tester');
  assert.equal(result.LOGNAME, 'tester');
  assert.equal(result.SHELL, '/bin/sh');
  assert.equal(result.PATH, '/usr/local/bin:/usr/bin:/bin');
  assert.equal(result.TERM, 'xterm-256color');
  assert.equal(result.COLORTERM, 'truecolor');
  assert.equal(Object.hasOwn(result, 'JWT_SECRET'), false);
});
