const test = require('node:test');
const assert = require('node:assert/strict');
const { cosineSimilarity, chunkText } = require('../dist/services/embeddingService');

test('cosineSimilarity calculates expected score', () => {
  // Identical vectors -> similarity = 1.0
  const v1 = [1, 0, 0];
  const v2 = [1, 0, 0];
  assert.equal(Math.round(cosineSimilarity(v1, v2) * 100) / 100, 1);

  // Orthogonal vectors -> similarity = 0.0
  const v3 = [0, 1, 0];
  assert.equal(Math.round(cosineSimilarity(v1, v3) * 100) / 100, 0);

  // Opposite vectors -> similarity = -1.0
  const v4 = [-1, 0, 0];
  assert.equal(Math.round(cosineSimilarity(v1, v4) * 100) / 100, -1);

  // Mismatched or empty lengths
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1], [1, 2]), 0);
});

test('chunkText splits text respecting chunkSize and overlap', () => {
  const shortText = 'Esta é uma nota curta com poucas palavras.';
  const chunksShort = chunkText(shortText, 20, 5);
  assert.equal(chunksShort.length, 1);
  assert.equal(chunksShort[0], shortText);

  const words = Array.from({ length: 100 }, (_, i) => `palavra${i + 1}`).join(' ');
  const chunks = chunkText(words, 40, 10);
  assert.ok(chunks.length >= 3);
  // Verify overlap: end of chunk 0 should appear in chunk 1
  const chunk0Words = chunks[0].split(' ');
  const chunk1Words = chunks[1].split(' ');
  assert.equal(chunk0Words[chunk0Words.length - 1], chunk1Words[9]);
});
