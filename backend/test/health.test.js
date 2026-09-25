const assert = require('node:assert/strict');
const test = require('node:test');

const { pool } = require('../dist/config/database');
const healthRouter = require('../dist/routes/health').default;
const { healthFailureResponse } = require('../dist/routes/health');

const healthHandler = healthRouter.stack.find((layer) => layer.route?.path === '/health').route.stack[0].handle;

test('health failure response is generic and contains no database detail', () => {
  const response = healthFailureResponse();
  assert.deepEqual(response, {
    status: 'error',
    service: 'brain-core-backend',
    db: 'disconnected',
  });
  assert.equal(Object.hasOwn(response, 'error'), false);
  assert.equal(JSON.stringify(response).includes('password'), false);
});

test('health handler preserves 200/503 while keeping database detail server-side', async () => {
  const originalQuery = pool.query;
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (line) => { logs.push(String(line)); };

  const invoke = async () => {
    let status = 200;
    let body;
    await healthHandler({}, {
      status(code) { status = code; return this; },
      json(value) { body = value; },
    });
    return { status, body };
  };

  try {
    pool.query = async () => ({ rows: [] });
    assert.deepEqual(await invoke(), {
      status: 200,
      body: { status: 'ok', service: 'brain-core-backend', db: 'connected' },
    });

    pool.query = async () => { throw new Error('password=sentinel host=private-db'); };
    const failure = await invoke();
    assert.equal(failure.status, 503);
    assert.deepEqual(failure.body, healthFailureResponse());
    assert.equal(JSON.stringify(failure.body).includes('sentinel'), false);
    assert.equal(logs.some((line) => line.includes('health.database.unavailable') && line.includes('sentinel')), true);
  } finally {
    pool.query = originalQuery;
    console.error = originalConsoleError;
  }
});
