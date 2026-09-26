import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RememberMemoryPanel } from './RememberMemoryPanel';
import { emitRememberStatus } from './rememberEvents';
import { rememberService } from '../../services/rememberService';
import type { RememberDay } from '../../types';

vi.mock('../../services/rememberService', () => ({
  rememberService: {
    getStatus: vi.fn().mockResolvedValue({ state: 'stopped', started_at: null, last_communication_at: null, device_id: null }),
    getDay: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    search: vi.fn().mockResolvedValue({ query: '', results: [] }),
    getTranscript: vi.fn(),
    getVoiceprint: vi.fn().mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null }),
    enrollVoiceprint: vi.fn(),
    deleteVoiceprint: vi.fn(),
  },
}));

const emptyDay = (date: string): RememberDay => ({ date, total_seconds: 0, session_count: 0, sessions: [] });

function renderPanel(path = '/remember') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RememberMemoryPanel />
    </MemoryRouter>,
  );
}

describe('RememberMemoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rememberService.getDay).mockImplementation(async (date: string) => emptyDay(date));
  });
  afterEach(() => cleanup());

  it('carrega o dia a partir do parâmetro ?date da rota', async () => {
    renderPanel('/remember?date=2026-08-20');
    await waitFor(() => expect(rememberService.getDay).toHaveBeenCalledWith('2026-08-20'));
  });

  it('recarrega a timeline quando o status de captura muda', async () => {
    renderPanel('/remember?date=2026-08-20');
    await waitFor(() => expect(rememberService.getDay).toHaveBeenCalledWith('2026-08-20'));
    vi.mocked(rememberService.getDay).mockClear();

    emitRememberStatus({ state: 'stopped', started_at: null, last_communication_at: null, device_id: null });

    await waitFor(() => expect(rememberService.getDay).toHaveBeenCalledWith('2026-08-20'));
  });

  it('troca de dia escrevendo o parâmetro na rota', async () => {
    renderPanel('/remember?date=2026-08-20');
    await waitFor(() => expect(rememberService.getDay).toHaveBeenCalledWith('2026-08-20'));

    fireEvent.change(screen.getByLabelText(/Visualizar dia/), { target: { value: '2026-08-19' } });

    await waitFor(() => expect(rememberService.getDay).toHaveBeenCalledWith('2026-08-19'));
  });

  it('troca a timeline pelos resultados quando ?q= tem 2+ caracteres', async () => {
    vi.mocked(rememberService.search).mockResolvedValue({
      query: 'reuniao',
      results: [{
        session_id: 's1', date: '2026-08-20', started_at: '2026-08-20T09:00:00Z',
        status: 'ready', snippet: 'trecho', match_count: 1,
      }],
    });
    renderPanel('/remember?date=2026-08-20&q=reuniao');
    await waitFor(() => expect(rememberService.search).toHaveBeenCalledWith('reuniao'));
    expect(screen.getByText('trecho')).toBeInTheDocument();
    // the day's empty-timeline message is replaced by the results
    expect(screen.queryByText(/ainda não possui sessões/i)).not.toBeInTheDocument();
  });

  it('volta para a timeline do dia ao limpar a busca', async () => {
    renderPanel('/remember?date=2026-08-20&q=reuniao');
    await waitFor(() => expect(rememberService.search).toHaveBeenCalledWith('reuniao'));

    fireEvent.change(screen.getByLabelText('Buscar nas memórias'), { target: { value: '' } });

    await waitFor(() => expect(screen.getByText(/ainda não possui sessões/i)).toBeInTheDocument());
  });

  it('renderiza turnos com rótulo de falante e filtra "só minhas falas"', async () => {
    vi.mocked(rememberService.getDay).mockResolvedValue({
      date: '2026-08-20', total_seconds: 120, session_count: 1,
      sessions: [{
        id: 's9', started_at: '2026-08-20T09:00:00Z', ended_at: '2026-08-20T09:02:00Z',
        device_id: 'd', status: 'ready', text: 'oi tudo bem',
        progress: { total: 1, done: 1, processing: 0, pending: 0, failed: 0, percent: 100, models: ['large-v3-turbo'] },
        turns: [
          { speaker: 'me', text: 'oi' },
          { speaker: 'other', text: 'tudo bem' },
        ],
      }],
    });
    renderPanel('/remember?date=2026-08-20');
    await waitFor(() => expect(screen.getByText('oi')).toBeInTheDocument());
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByText('Participante')).toBeInTheDocument();
    expect(screen.getByText('Transcrito no PC com large-v3-turbo')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Só minhas falas'));
    expect(screen.getByText('oi')).toBeInTheDocument();
    expect(screen.queryByText('tudo bem')).not.toBeInTheDocument();
  });
});
