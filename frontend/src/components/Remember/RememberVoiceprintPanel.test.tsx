import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RememberVoiceprintPanel } from './RememberVoiceprintPanel';
import { rememberService } from '../../services/rememberService';

vi.mock('../../services/rememberService', () => ({
  rememberService: {
    getVoiceprint: vi.fn(),
    enrollVoiceprint: vi.fn(),
    deleteVoiceprint: vi.fn(),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('RememberVoiceprintPanel', () => {
  it('mostra "não configurada" e o botão de gravar quando não há voiceprint', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    render(<RememberVoiceprintPanel />);
    await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
    expect(screen.getByRole('button', { name: 'Gravar minha voz' })).toBeInTheDocument();
  });

  it('mostra estado configurado e permite remover', async () => {
    vi.mocked(rememberService.getVoiceprint)
      .mockResolvedValueOnce({ enrolled: true, updated_at: '2026-08-27T10:00:00Z', sample_seconds: 20, model: 'campplus' })
      .mockResolvedValueOnce({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    vi.mocked(rememberService.deleteVoiceprint).mockResolvedValue({ enrolled: false });
    render(<RememberVoiceprintPanel />);
    await waitFor(() => expect(screen.getByText('configurada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(rememberService.deleteVoiceprint).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
  });

  it('avisa quando o navegador não permite gravar', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    render(<RememberVoiceprintPanel />);
    await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Gravar minha voz' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/não permite gravar/i));
    Object.defineProperty(navigator, 'mediaDevices', { value: original, configurable: true });
  });
});
