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
    enrollVoiceprintFromSession: vi.fn(),
    getPeople: vi.fn().mockResolvedValue([]),
    setCluster: vi.fn().mockResolvedValue({ status: 'confirmed' }),
    segmentAudioUrl: vi.fn((id: number) => `/api/remember/memory/segments/${id}/audio`),
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
        speakers: [
          { cluster: 0, status: 'confirmed', person_id: null, name: null, is_me: true, suggested: null, sample_segment_id: null, total_ms: 1000, turn_count: 1 },
          { cluster: 1, status: 'confirmed', person_id: 2, name: 'Ana', is_me: false, suggested: null, sample_segment_id: 5, total_ms: 2000, turn_count: 1 },
        ],
        turns: [
          { speaker: 'me', text: 'oi', cluster: 0, start_ms: 1000, end_ms: 2500 },
          { speaker: 'other', text: 'tudo bem', cluster: 1, start_ms: 3000, end_ms: 5000 },
        ],
      }],
    });
    renderPanel('/remember?date=2026-08-20');
    await waitFor(() => expect(screen.getByText('oi')).toBeInTheDocument());
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('06:00:01')).toBeInTheDocument();
    expect(screen.getByText('06:00:03')).toBeInTheDocument();
    expect(screen.getByLabelText('Ordem da linha do tempo')).toHaveTextContent('mais recentes primeiro');
    expect(screen.getByText(/Início da sessão/)).toBeInTheDocument();
    expect(screen.getByText(/Fim da sessão/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Só minhas falas'));
    expect(screen.getByText('oi')).toBeInTheDocument();
    expect(screen.queryByText('tudo bem')).not.toBeInTheDocument();
  });

  it('abre o modal pelo nome do falante e cadastra uma nova pessoa', async () => {
    vi.mocked(rememberService.getDay).mockResolvedValue({
      date: '2026-08-20', total_seconds: 60, session_count: 1,
      sessions: [{
        id: 's1', started_at: '2026-08-20T09:00:00Z', ended_at: '2026-08-20T09:01:00Z',
        device_id: 'd', status: 'ready', text: 'olá',
        speakers: [{ cluster: 1, status: 'pending', person_id: null, name: null, is_me: false, suggested: null, sample_segment_id: 7, sample_segment_ids: [7, 8, 9], total_ms: 1000, turn_count: 1 }],
        turns: [{ speaker: 'other', text: 'olá', cluster: 1 }],
      }],
    });
    renderPanel('/remember?date=2026-08-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Falante A' }));
    expect(screen.getByRole('dialog', { name: /quem é falante a/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Exemplo de voz 1')).toHaveAttribute('src', '/api/remember/memory/segments/7/audio');
    expect(screen.getByLabelText('Exemplo de voz 3')).toHaveAttribute('src', '/api/remember/memory/segments/9/audio');
    fireEvent.change(screen.getByLabelText(/novo nome/i), { target: { value: 'Sandra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(rememberService.setCluster).toHaveBeenCalledWith('s1', 1, 'confirm_new', { name: 'Sandra' }));
  });

  it('pré-nomeia sugestão de 95% ou mais sem confirmar automaticamente', async () => {
    vi.mocked(rememberService.getDay).mockResolvedValue({
      date: '2026-08-20', total_seconds: 30, session_count: 1,
      sessions: [{
        id: 's2', started_at: '2026-08-20T09:00:00Z', ended_at: '2026-08-20T09:00:30Z',
        device_id: 'd', status: 'ready', text: 'oi',
        speakers: [{ cluster: 1, status: 'pending', person_id: null, name: null, is_me: false, suggested: { person_id: 8, name: 'Sandra', score: 0.96 }, sample_segment_id: 7, total_ms: 1000, turn_count: 1 }],
        turns: [{ speaker: 'other', text: 'oi', cluster: 1 }],
      }],
    });
    renderPanel('/remember?date=2026-08-20');
    const suggestedName = await screen.findByRole('button', { name: /Sandra.*provável.*96.*%/i });
    expect(suggestedName).toBeInTheDocument();
    expect(rememberService.setCluster).not.toHaveBeenCalled();
  });

  it('dados pré-Fase-8 (sem speakers, cluster nulo) ainda rotulam Você / Outra pessoa', async () => {
    vi.mocked(rememberService.getDay).mockResolvedValue({
      date: '2026-08-20', total_seconds: 60, session_count: 1,
      sessions: [{
        id: 's9', started_at: '2026-08-20T09:00:00Z', ended_at: '2026-08-20T09:01:00Z',
        device_id: 'd', status: 'ready', text: 'oi tudo bem',
        speakers: undefined,
        turns: [
          { speaker: 'other', text: 'tudo bem', cluster: null },
          { speaker: 'me', text: 'oi', cluster: null },
        ],
      }],
    });
    renderPanel('/remember?date=2026-08-20');
    await waitFor(() => expect(screen.getByText('oi')).toBeInTheDocument());
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByText('Outra pessoa')).toBeInTheDocument();
  });

  it('rotula o turno pelo nome quando o cluster está confirmado, e "Falante A" quando pendente', async () => {
    vi.mocked(rememberService.getDay).mockResolvedValue({
      date: '2026-08-20', total_seconds: 120, session_count: 1,
      sessions: [{
        id: 's9', started_at: '2026-08-20T09:00:00Z', ended_at: '2026-08-20T09:02:00Z',
        device_id: 'd', status: 'ready', text: 'oi tudo bem',
        speakers: [
          { cluster: 1, status: 'confirmed', person_id: 3, name: 'Cláudio', is_me: false, suggested: null, sample_segment_id: 11, total_ms: 3000, turn_count: 1 },
          { cluster: 2, status: 'pending', person_id: null, name: null, is_me: false, suggested: null, sample_segment_id: 12, total_ms: 2000, turn_count: 1 },
        ],
        turns: [
          { speaker: 'other', text: 'oi', segment_ids: [11], cluster: 1 },
          { speaker: 'other', text: 'tudo bem', segment_ids: [12], cluster: 2 },
        ],
      }],
    });
    renderPanel('/remember?date=2026-08-20');
    expect(await screen.findByText('Cláudio')).toBeInTheDocument();
    expect(screen.getByText('Falante B')).toBeInTheDocument();
    expect(screen.queryByTitle('Corrigir quem falou')).not.toBeInTheDocument();
  });

  it('mostra o botão de Falantes com badge da contagem de pendentes do dia', async () => {
    vi.mocked(rememberService.getDay).mockResolvedValue({
      date: '2026-08-20', total_seconds: 0, session_count: 1,
      sessions: [{
        id: 's9', started_at: '2026-08-20T09:00:00Z', ended_at: null, device_id: 'd', status: 'ready', text: null,
        speakers: [
          { cluster: 1, status: 'pending', person_id: null, name: null, is_me: false, suggested: null, sample_segment_id: 11, total_ms: 0, turn_count: 0 },
          { cluster: 2, status: 'pending', person_id: null, name: null, is_me: false, suggested: null, sample_segment_id: 12, total_ms: 0, turn_count: 0 },
        ],
        turns: [],
      }],
    });
    renderPanel('/remember?date=2026-08-20');
    expect(await screen.findByRole('button', { name: /falantes/i })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
