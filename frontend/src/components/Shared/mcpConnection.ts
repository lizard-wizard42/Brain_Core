export type McpClient = 'codex' | 'json' | 'chatgpt';

export function mcpConfiguration(client: McpClient, scriptPath: string, tokenPath: string, backendUrl: string) {
  if (client === 'chatgpt') return '';
  if (client === 'codex') return [
    '[mcp_servers.brain-core]',
    'command = "node"',
    `args = [${JSON.stringify(scriptPath)}]`,
    '',
    '[mcp_servers.brain-core.env]',
    `BRAIN_CORE_URL = ${JSON.stringify(backendUrl)}`,
    `BRAIN_CORE_TOKEN_FILE = ${JSON.stringify(tokenPath)}`,
  ].join('\n');
  return JSON.stringify({ mcpServers: { 'brain-core': { command: 'node', args: [scriptPath],
    env: { BRAIN_CORE_URL: backendUrl, BRAIN_CORE_TOKEN_FILE: tokenPath } } } }, null, 2);
}
