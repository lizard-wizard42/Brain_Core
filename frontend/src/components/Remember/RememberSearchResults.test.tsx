import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RememberSearchResults } from './RememberSearchResults';
import { rememberService } from '../../services/rememberService';

vi.mock('../../services/rememberService', () => ({
  rememberService: {
    search: vi.fn(),
    getTranscript: vi.fn(),
  },
}));

const STX = String.fromCharCode(2);
const ETX = String.fromCharCode(3);

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('RememberSearchResults', () => {
  it('renderiza resultados com trecho destacado', async () => {
    vi.mocked(rememberService.search).mockResolvedValue({
      query: 'orcamento',
      results: [{
        session_id: 's1', date: '2026-08-27', started_at: '2026-08-27T09:00:00Z',
        status: 'ready', snippet: `falamos de ${STX}orcamento${ETX} hoje`, match_count: 2,
      }],
    });
    render(<RememberSearchResults query="orcamento" onOpenDay={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('orcamento')).toBeInTheDocument());
    expect(screen.getByText('orcamento').tagName).toBe('MARK');
  });

  it('mostra estado vazio', async () => {
    vi.mocked(rememberService.search).mockResolvedValue({ query: 'xyz', results: [] });
    render(<RememberSearchResults query="xyz" onOpenDay={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/nenhuma mem[óo]ria encontrada/i)).toBeInTheDocument());
  });

  it('clicar no resultado chama onOpenDay', async () => {
    const onOpenDay = vi.fn();
    vi.mocked(rememberService.search).mockResolvedValue({
      query: 'a', results: [{
        session_id: 's1', date: '2026-08-27', started_at: '2026-08-27T09:00:00Z',
        status: 'ready', snippet: 'texto', match_count: 1,
      }],
    });
    render(<RememberSearchResults query="reuniao" onOpenDay={onOpenDay} />);
    await waitFor(() => expect(screen.getByText('texto')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /27 de agosto/i }));
    expect(onOpenDay).toHaveBeenCalledWith('2026-08-27', 's1');
  });

  it('expande e busca a transcrição uma única vez', async () => {
    vi.mocked(rememberService.search).mockResolvedValue({
      query: 'a', results: [{
        session_id: 's1', date: '2026-08-27', started_at: '2026-08-27T09:00:00Z',
        status: 'ready', snippet: 'texto', match_count: 1,
      }],
    });
    vi.mocked(rememberService.getTranscript).mockResolvedValue({
      session_id: 's1', status: 'ready', text: 'transcrição completa aqui',
    });
    render(<RememberSearchResults query="reuniao" onOpenDay={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('texto')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /ver transcri/i }));
    await waitFor(() => expect(screen.getByText('transcrição completa aqui')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /ocultar transcri/i }));
    fireEvent.click(screen.getByRole('button', { name: /ver transcri/i }));
    expect(rememberService.getTranscript).toHaveBeenCalledTimes(1);
  });
});
