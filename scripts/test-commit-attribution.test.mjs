import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasAgentAttribution } from './check-commit-attribution.mjs';

test('rejects known agent co-authors, including historical Claude and mixed-case trailers', () => {
  for (const trailer of ['Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>',
    'co-authored-by: Agent <123+Copilot@users.noreply.github.com>',
    'Co-authored-by: Agent <copilot@github.com>']) {
    assert.equal(hasAgentAttribution(`Change\n\n${trailer}\n`), true);
  }
});

test('preserves human attribution and ordinary references in prose', () => {
  for (const message of ['Change\n\nCo-authored-by: Contributor <contributor@users.noreply.github.com>',
    'Change\n\nCo-authored-by: Claude Human <claude-human@users.noreply.github.com>',
    'Disable the legacy Claude attribution setting.']) {
    assert.equal(hasAgentAttribution(message), false);
  }
});
