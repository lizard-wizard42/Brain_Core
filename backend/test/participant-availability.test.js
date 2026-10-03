const test = require('node:test');
const assert = require('node:assert/strict');
const { participants, getSegmentParticipants } = require('../dist/remember/service');
const { CeltwoUnavailableError } = require('../dist/remember/celtwoClient');

test('matcher failures preserve manual decisions; access and transport failures propagate', async () => {
  const original = { ...participants };
  const decision = { identity_id: 'synthetic', action: 'confirm', created_at: 'now' };
  participants.decision = async () => decision;
  try {
    for (const status of [429, 400, 413]) {
      participants.suggestions = async () => { throw new CeltwoUnavailableError('synthetic', status); };
      assert.deepEqual(await getSegmentParticipants('owner', 'session', 1), {
        decision, suggestions: [], suggestions_status: status === 429 ? 'busy' : 'unavailable',
      });
    }
    for (const status of [401, 404, 503]) {
      participants.suggestions = async () => { throw new CeltwoUnavailableError('synthetic', status); };
      await assert.rejects(getSegmentParticipants('owner', 'session', 1), { statusCode: status });
    }
    participants.decision = async () => { throw new CeltwoUnavailableError('synthetic', 404); };
    await assert.rejects(getSegmentParticipants('owner', 'session', 1), { statusCode: 404 });
  } finally { Object.assign(participants, original); }
});
