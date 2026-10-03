#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Match known agent identities, while preserving attribution to human collaborators.
export function hasAgentAttribution(message) {
  return message.split(/\r?\n/).some(line => /^Co-authored-by:/i.test(line) &&
    /<(?:noreply@anthropic\.com|claude@anthropic\.com|noreply@openai\.com|copilot@github\.com|(?:\d+\+)?(?:claude|codex|chatgpt|copilot)(?:\[bot\])?@users\.noreply\.github\.com)>/i.test(line));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const message = fs.readFileSync(process.argv[2] || 0, 'utf8');
  if (hasAgentAttribution(message)) {
    console.error('Automated agent co-author attribution is disabled for this repository.');
    process.exitCode = 1;
  }
}
