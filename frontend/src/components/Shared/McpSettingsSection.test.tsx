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
});
