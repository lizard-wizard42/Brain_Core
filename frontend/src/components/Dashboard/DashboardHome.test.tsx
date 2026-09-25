import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardHome } from './DashboardHome';
import { api } from '../../api/client';
import { rememberService } from '../../services/rememberService';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/client', () => ({ api: { getMe: vi.fn(), getTree: vi.fn() } }));
vi.mock('../../services/rememberService', () => ({
  rememberService: { getDay: vi.fn(), getSessions: vi.fn(), getStatus: vi.fn() },
}));
vi.mock('../Notas/NotasBoard', () => ({ NotasBoard: () => null }));
vi.mock('../Notas/useNotas', () => ({
  useNotas: () => ({
    notes: [], loading: false, error: null,
    createNote: vi.fn(), saveNote: vi.fn(), deleteNote: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMe).mockResolvedValue({ name: 'Ana' } as never);
  vi.mocked(api.getTree).mockResolvedValue({ pages: [] } as never);
  vi.mocked(rememberService.getStatus).mockResolvedValue({ state: 'stopped' } as never);
});
afterEach(() => cleanup());

describe('DashboardHome — "Memórias de hoje"', () => {
  it('dia sem gravações mostra vazio, não o último dia gravado', async () => {
    vi.mocked(rememberService.getDay).mockResolvedValue({
      date: '2026-09-07', total_seconds: 0, session_count: 0, sessions: [],
    } as never);
    // Ainda que o back devolva sessões antigas, elas NÃO devem aparecer no painel "de hoje".
    vi.mocked(rememberService.getSessions).mockResolvedValue([
      { id: 's-old', started_at: '2026-09-05T14:00:00.000Z', status: 'ready', text: 'gravação de dois dias atrás', duration_seconds: 60 },
    ] as never);

    render(<DashboardHome onOpenPage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Nenhuma gravação ainda.')).toBeInTheDocument());
    expect(screen.queryByText(/dois dias atrás/)).not.toBeInTheDocument();
  });

  it('dia com gravações lista as sessões de hoje', async () => {
    vi.mocked(rememberService.getDay).mockResolvedValue({
      date: '2026-09-07', total_seconds: 120, session_count: 1,
      sessions: [
        { id: 's-today', started_at: '2026-09-07T13:00:00.000Z', status: 'ready', text: 'gravação de hoje', duration_seconds: 120 },
      ],
    } as never);

    render(<DashboardHome onOpenPage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('gravação de hoje')).toBeInTheDocument());
  });
});
