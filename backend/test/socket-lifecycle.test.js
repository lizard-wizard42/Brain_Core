const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const jwt = require('jsonwebtoken');
const database = require('../dist/config/database');
const { config } = require('../dist/config');
const { registerSocketHandlers, disconnectAccountSockets } = require('../dist/services/socketService');

test('malformed handshake cookies cannot cause an unhandled rejection', () => {
  for (const cookie of ['bad=%', 'bad=%GG', 'bad=%E0%A4%A', 'bad=valid']) {
    const code = `const {registerSocketHandlers}=require('./dist/services/socketService');
      let authenticate;registerSocketHandlers({use(fn){authenticate=fn},on(){}});
      authenticate({handshake:{headers:{cookie:${JSON.stringify(cookie)}}}},error=>{
        if(!error)process.exit(2);
      });setTimeout(()=>process.exit(0),30);`;
    const result = spawnSync(process.execPath, ['-e', code], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('socket packets, idle expiry and account revocation enforce active sessions', async () => {
  const originalQuery = database.query;
  let version = 1;
  database.query = async sql => sql.includes('session_version') ? [{ session_version: version }] : [{ role: 'owner' }];
  let handshake, connect;
  const io = { sockets: { sockets: new Map() }, use(fn) { handshake = fn; }, on(_event, fn) { connect = fn; } };
  registerSocketHandlers(io);
  async function open(id, expiresIn = 60) {
    const handlers = new Map();
    const token = jwt.sign({ sub: 'synthetic-owner', sv: version, type: 'access' }, config.JWT_SECRET, { expiresIn });
    const socket = { id, data: {}, connected: true, handshake: { headers: { authorization: `Bearer ${token}` } },
      on(event, fn) { handlers.set(event, fn); }, use(fn) { socket.packet = fn; }, emit() {},
      disconnect() { socket.connected = false; handlers.get('disconnect')?.(); io.sockets.sockets.delete(id); },
    };
    await handshake(socket, error => assert.equal(error, undefined));
    io.sockets.sockets.set(id, socket); connect(socket);
    return socket;
  }
  const packet = socket => new Promise(resolve => socket.packet(['terminal:input', {}], resolve));
  try {
    const active = await open('active');
    assert.equal(await packet(active), undefined);
    version++;
    assert.equal((await packet(active)).message, 'Unauthorized');
    assert.equal(active.connected, false);
    const revoked = await open('revoked');
    disconnectAccountSockets('other-account');
    assert.equal(revoked.connected, true);
    disconnectAccountSockets('synthetic-owner');
    assert.equal(revoked.connected, false);
    const expired = await open('idle', 1);
    await new Promise(resolve => setTimeout(resolve, expired.data.expiresAt - Date.now() + 40));
    assert.equal(expired.connected, false);
  } finally {
    for (const socket of io.sockets.sockets.values()) socket.disconnect(true);
    database.query = originalQuery;
  }
});
