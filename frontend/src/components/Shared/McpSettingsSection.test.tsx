import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpSettingsSection } from './McpSettingsSection';
import { mcpApi } from '../../api/client';

vi.mock('../../api/client', () => ({ mcpApi: {
  get: vi.fn(), setEnabled: vi.fn(), createCredential: vi.fn(), revokeCredential: vi.fn(), revokeAll: vi.fn(),
} }));
const initial = { enabled: true, tokens: [], audit: [] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(mcpApi.get).mockResolvedValue(initial); });
afterEach(cleanup);

describe('MCP settings', () => {
  it('switches off only after the server confirms; a failure preserves the status', async () => {
    vi.mocked(mcpApi.setEnabled).mockRejectedValueOnce(new Error('offline'));
    render(<McpSettingsSection />);
    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(toggle);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    vi.mocked(mcpApi.setEnabled).mockResolvedValue({ enabled: false });
    vi.mocked(mcpApi.get).mockResolvedValue({ ...initial, enabled: false });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(mcpApi.setEnabled).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Criar credencial' })).toBeDisabled();
  });

  it('creates scoped credentials, displays the secret once and keeps it out of client configuration', async () => {
    vi.mocked(mcpApi.createCredential).mockResolvedValue({ credential: {
      id: 'test', name: 'Agente local', scopes: ['pages:read'], expires_at: '2026-10-10', created_at: '2026-10-03',
    }, secret: 'synthetic-secret' });
    render(<McpSettingsSection />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar credencial' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Notas rápidas'), { target: { value: 'off' } });
    fireEvent.change(screen.getByLabelText('Validade da credencial'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar credencial' }));
    expect(await screen.findByLabelText('Nova credencial MCP')).toHaveValue('synthetic-secret');
    expect(mcpApi.createCredential).toHaveBeenCalledWith('Agente local', ['pages:read'], 7);
    expect(screen.getByLabelText('Configuração do cliente MCP')).not.toHaveValue(expect.stringContaining('synthetic-secret'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar credencial' }));
    expect(screen.queryByLabelText('Nova credencial MCP')).not.toBeInTheDocument();
  });

  it('revokes all credentials only after explicit confirmation and clears a displayed secret', async () => {
    vi.mocked(mcpApi.get).mockResolvedValue({ ...initial, tokens: [{ id: 'one', name: 'Agente', scopes: ['pages:read'],
      expires_at: '2026-10-10', revoked_at: null, created_at: '2026-10-03', valid: true }] });
    vi.mocked(mcpApi.revokeAll).mockResolvedValue({ revoked: 1 });
    render(<McpSettingsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar todas as credenciais' }));
    expect(mcpApi.revokeAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar revogação de todas' }));
    await waitFor(() => expect(mcpApi.revokeAll).toHaveBeenCalledOnce());
  });

  it('switches between persistent Codex setup and JSON without changing credential access', async () => {
    vi.mocked(mcpApi.get).mockResolvedValue({ ...initial, connection: {
      server_path: '/opt/Brain Core/mcp/src/server.mjs', backend_url: 'http://127.0.0.1:8080',
    } });
    render(<McpSettingsSection />);
    await waitFor(() => expect(screen.getByLabelText('Arquivo do servidor MCP')).toHaveValue('/opt/Brain Core/mcp/src/server.mjs'));
    const config = screen.getByLabelText('Configuração do cliente MCP') as HTMLTextAreaElement;
    expect(config.value).toContain('[mcp_servers.brain-core]');
    expect(config.value).toContain('args = ["/opt/Brain Core/mcp/src/server.mjs"]');
    fireEvent.change(screen.getByLabelText('Arquivo privado da credencial'), { target: { value: '/private/notes "local".txt' } });
    const encoded = config.value.split('BRAIN_CORE_TOKEN_FILE = ')[1];
    expect(JSON.parse(encoded)).toBe('/private/notes "local".txt');
    fireEvent.change(screen.getByLabelText('Onde conectar'), { target: { value: 'json' } });
    const json = JSON.parse(config.value).mcpServers['brain-core'];
    expect(json.args).toEqual(['/opt/Brain Core/mcp/src/server.mjs']);
    expect(json.env).toEqual({ BRAIN_CORE_URL: 'http://127.0.0.1:8080', BRAIN_CORE_TOKEN_FILE: '/private/notes "local".txt' });
    expect(mcpApi.createCredential).not.toHaveBeenCalled();
    expect(mcpApi.setEnabled).not.toHaveBeenCalled();
  });

  it('shows remote prerequisites instead of suggesting that localhost connects ChatGPT', async () => {
    render(<McpSettingsSection />);
    await screen.findByText('MCP ligado');
    fireEvent.change(screen.getByLabelText('Onde conectar'), { target: { value: 'chatgpt' } });
    expect(screen.queryByLabelText('Configuração do cliente MCP')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copiar configuração' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir guia oficial do Secure MCP Tunnel' })).toHaveAttribute('href', 'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels');
    fireEvent.change(screen.getByLabelText('Onde conectar'), { target: { value: 'codex' } });
    expect(screen.getByLabelText('Configuração do cliente MCP')).toBeInTheDocument();
  });

});
