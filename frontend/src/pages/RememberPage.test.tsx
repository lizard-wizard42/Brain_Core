import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RememberPage } from './RememberPage';

vi.mock('../api/client', () => ({
  api: { listRememberNotes: vi.fn().mockResolvedValue({ notes: [] }), createRememberNote: vi.fn() },
}));

vi.mock('../services/rememberService', () => ({
  rememberService: {
    getStatus: vi.fn().mockResolvedValue({ state: 'stopped', started_at: null, last_communication_at: null, device_id: null }),
    getDay: vi.fn().mockResolvedValue({ date: '2026-08-26', total_seconds: 0, session_count: 0, sessions: [] }),
    getVoiceprint: vi.fn().mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null }),
    start: vi.fn(), stop: vi.fn(),
  },
}));

function renderPage(path = '/remember') {
  return render(<MemoryRouter initialEntries={[path]}><RememberPage /></MemoryRouter>);
}

describe('RememberPage (Memória)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('mostra o painel de memória cronológica', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Memória' })).toBeInTheDocument());
    expect(screen.getByText('Memória cronológica')).toBeInTheDocument();
  });
});
