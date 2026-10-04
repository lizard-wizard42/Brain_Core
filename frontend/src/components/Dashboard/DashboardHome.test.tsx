import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardHome } from './DashboardHome';
import { api } from '../../api/client';
import { rememberService } from '../../services/rememberService';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/client', () => ({ api: { getMe: vi.fn(), getTree: vi.fn() } }));
vi.mock('../../services/rememberService', () => ({ rememberService: { getDay: vi.fn() } }));
vi.mock('../Notas/NotasBoard', () => ({ NotasBoard: () => null }));
vi.mock('../Notas/useNotas', () => ({
  useNotas: () => ({ notes: [], loading: false, error: null, createNote: vi.fn(), saveNote: vi.fn(), deleteNote: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMe).mockResolvedValue({ name: 'Teste' } as never);
  vi.mocked(api.getTree).mockResolvedValue({ pages: [] } as never);
});
afterEach(() => cleanup());

describe('DashboardHome', () => {
  it('não mostra gravações de ontem no painel de hoje', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const old = new Date(`${yesterday}T23:30:00-03:00`).toISOString();
    vi.mocked(rememberService.getDay).mockImplementation(async (date) => ({
      date, total_seconds: 0, session_count: 0,
      sessions: date === old.slice(0, 10)
        ? [{ id: 'old', started_at: old, ended_at: old, device_id: null, status: 'ready', text: 'Gravação de ontem' }]
        : [],
    }));

    render(<DashboardHome onOpenPage={vi.fn()} />);

    await waitFor(() => expect(rememberService.getDay).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Nenhuma gravação ainda.')).toBeInTheDocument();
    expect(screen.queryByText('Gravação de ontem')).not.toBeInTheDocument();
  });

  it('inclui uma gravação no fim do dia de São Paulo, mesmo quando já é o dia seguinte em UTC', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const late = new Date(`${today}T23:00:00-03:00`).toISOString();
    const lateUtcDay = late.slice(0, 10);
    vi.mocked(rememberService.getDay).mockImplementation(async (date) => ({
      date, total_seconds: 0, session_count: 0,
      sessions: date === lateUtcDay
        ? [{ id: 'late', started_at: late, ended_at: new Date(Date.parse(late) + 120000).toISOString(), device_id: null, status: 'ready', text: 'Gravação desta noite' }]
        : [],
    }));

    render(<DashboardHome onOpenPage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Gravação desta noite')).toBeInTheDocument());
    expect(screen.getByText('1', { selector: 'p' })).toBeInTheDocument();
  });

  it('não duplica gravações quando o mesmo id vem nos dois dias UTC e rotula o status para leitores de tela', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const startedAt = new Date(`${today}T12:00:00-03:00`).toISOString();
    const session = { id: 'same', started_at: startedAt, ended_at: new Date(Date.parse(startedAt) + 60000).toISOString(), device_id: null, status: 'ready' as const, text: 'Gravação única' };
    vi.mocked(rememberService.getDay).mockImplementation(async (date) => ({ date, total_seconds: 0, session_count: 1, sessions: [session] }));

    render(<DashboardHome onOpenPage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Gravação única')).toBeInTheDocument());
    expect(screen.getAllByText('Gravação única')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Transcrição pronta' })).toBeInTheDocument();
    expect(screen.getByText('Gravações hoje')).toBeInTheDocument();
    expect(screen.queryByText(/\.md$/)).not.toBeInTheDocument();
  });
});


describe('dashboard loading and recovery', () => {
  it('does not claim there are no recordings or pages while requests are pending', async () => {
    vi.mocked(rememberService.getDay).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.getTree).mockImplementation(() => new Promise(() => {}));
    await act(async () => { render(<DashboardHome onOpenPage={vi.fn()} />); });
    expect(screen.getByText('Carregando memórias…')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma gravação ainda.')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhuma página editada recentemente.')).not.toBeInTheDocument();
  });

  it('shows a recording load failure and recovers through a dedicated retry', async () => {
    vi.mocked(rememberService.getDay).mockRejectedValue(new Error('Synthetic network failure'));
    render(<DashboardHome onOpenPage={vi.fn()} />);
    expect(await screen.findByText('Não foi possível carregar as gravações de hoje.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma gravação ainda.')).not.toBeInTheDocument();
    expect(screen.getByText('Gravações indisponíveis')).toBeInTheDocument();
    vi.mocked(rememberService.getDay).mockImplementation(async date => ({ date, sessions: [], total_seconds: 0, session_count: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar gravações novamente' }));
    expect(await screen.findByText('Nenhuma gravação ainda.')).toBeInTheDocument();
    expect(screen.queryByText('Gravações indisponíveis')).not.toBeInTheDocument();
    expect(api.getTree).toHaveBeenCalledTimes(1);
  });

  it('recovers a page error and lets the user continue on the most recently edited page', async () => {
    vi.mocked(rememberService.getDay).mockImplementation(async date => ({ date, sessions: [], total_seconds: 0, session_count: 0 }));
    vi.mocked(api.getTree).mockRejectedValueOnce(new Error('Synthetic network failure'));
    const onOpenPage = vi.fn();
    render(<DashboardHome onOpenPage={onOpenPage} />);
    expect(await screen.findByText('Não foi possível carregar as páginas recentes.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma página editada recentemente.')).not.toBeInTheDocument();
    const newest = { id: 'recent', title: 'Página recente', updated_at: new Date().toISOString() };
    vi.mocked(api.getTree).mockResolvedValueOnce({ pages: [{ id: 'old', title: 'Antiga', updated_at: '2020-01-01T00:00:00Z' }, newest] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar páginas novamente' }));
    const resume = await screen.findByRole('button', { name: /Continue daqui/ });
    expect(resume).toHaveTextContent('Página recente');
    fireEvent.click(resume);
    expect(onOpenPage).toHaveBeenCalledWith(newest);
    expect(rememberService.getDay).toHaveBeenCalledTimes(2);
  });

  it.each(['', 'Trecho parcial'])('shows a failed transcription as an error, including with text %s', async text => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const started_at = new Date(`${today}T12:00:00-03:00`).toISOString();
    vi.mocked(rememberService.getDay).mockImplementation(async date => ({
      date, total_seconds: 0, session_count: 1,
      sessions: [{ id: 'failed', started_at, ended_at: started_at, device_id: null, status: 'error', text }],
    }));
    render(<DashboardHome onOpenPage={vi.fn()} />);
    expect(await screen.findByText(/Erro na transcrição/)).toBeInTheDocument();
    expect(screen.queryByText('Processando…')).not.toBeInTheDocument();
    if (text) expect(screen.getByText(text)).toBeInTheDocument();
  });
});
