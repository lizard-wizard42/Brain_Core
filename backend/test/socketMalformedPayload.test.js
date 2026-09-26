const assert = require('node:assert/strict');
const test = require('node:test');

const { registerSocketHandlers } = require('../dist/services/socketService');

function connectedSocket(role) {
  const handlers = new Map();
  const emitted = [];
  const left = [];
  const socket = {
    id: `socket-${role}`,
    data: { userId: 'user-1', role },
    on(event, handler) { handlers.set(event, handler); },
    emit(event, payload) { emitted.push({ event, payload }); },
    leave(room) { left.push(room); },
  };
  const io = {
    sockets: { sockets: new Map() },
    use() {},
    on(event, handler) {
      if (event === 'connection') handler(socket);
    },
  };
  registerSocketHandlers(io);
  return { handlers, emitted, left };
}

test('malformed authenticated socket events are ignored without throwing or acting on rooms', async () => {
  const { handlers, left } = connectedSocket('owner');
  const events = [
    'page:join', 'page:leave', 'page:save',
    'terminal:create', 'terminal:attach', 'terminal:input',
    'terminal:resize', 'terminal:close', 'terminal:navigate',
  ];
  for (const event of events) {
    for (const payload of [undefined, null, false, 42, 'bad', []]) {
      await assert.doesNotReject(async () => handlers.get(event)(payload), `${event}: ${String(payload)}`);
    }
  }
  assert.deepEqual(left, []);
});

test('terminal authorization still rejects a non-owner before handling malformed input', () => {
  const { handlers, emitted } = connectedSocket('member');
  for (const event of ['terminal:create', 'terminal:attach', 'terminal:input',
    'terminal:resize', 'terminal:close', 'terminal:navigate']) {
    assert.doesNotThrow(() => handlers.get(event)(null));
  }
  assert.equal(emitted.filter(({ event }) => event === 'terminal:error').length, 6);
});
