import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText('Nenhuma gravação ainda.')).toBeInTheDocument();
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
});
