import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptDialogue } from './TranscriptDialogue';
import { rememberService } from '../../services/rememberService';

vi.mock('../../services/rememberService', () => ({ rememberService: {
  getSegmentParticipants: vi.fn(), getParticipantIdentities: vi.fn(),
  decideSegment: vi.fn(), createParticipantTemplate: vi.fn(), createParticipantIdentity: vi.fn(),
} }));

const session = {
  id: 'dialogue-1', started_at: '2026-09-24T08:00:00Z', ended_at: '2026-09-24T08:05:00Z',
  device_id: null, status: 'ready' as const, text: 'Oi. Olá.',
  turns: [{ speaker: 'me' as const, text: 'Oi.', start_at: '2026-09-24T08:00:12Z' },
    { speaker: 'other' as const, text: 'Olá.', start_at: '2026-09-24T08:00:18Z' }],
};

describe('TranscriptDialogue', () => {
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.clear();
    vi.mocked(rememberService.getSegmentParticipants).mockResolvedValue({ decision: null, suggestions: [] });
    vi.mocked(rememberService.getParticipantIdentities).mockResolvedValue([]);
  });
  afterEach(() => cleanup());
  it('mostra turnos cronológicos e permite renomear o participante', () => {
    localStorage.clear();
    render(<TranscriptDialogue session={session} onlyMe={false} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getAllByText(/\d{2}:\d{2}/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Renomear Participante' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Novo nome para Participante' }), { target: { value: 'Professor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText('Professor')).toBeInTheDocument();
    expect(localStorage.getItem('brain-core:speaker-aliases:dialogue-1')).toContain('Professor');
  });

  it('filtra apenas a fala identificada como minha', () => {
    render(<TranscriptDialogue session={session} onlyMe />);
    expect(screen.getByText('Oi.')).toBeInTheDocument();
    expect(screen.getByText('Olá.')).not.toBeVisible();
  });

  it('permite reatribuir o falante de um turno', () => {
    localStorage.clear();
    render(<TranscriptDialogue session={session} onlyMe={false} />);
    const buttons = screen.getAllByRole('button', { name: '→ Outro' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    // The turn originally labeled "Você" is now reassigned to other
    expect(localStorage.getItem('brain-core:turn-speakers:dialogue-1')).toContain('"0":"other"');
  });

  it('mantém a correção no mesmo segmento quando novos turnos entram antes dele', () => {
    localStorage.clear();
    const original = { ...session, turns: [
      { id: 42, speaker: 'other' as const, text: 'Fala corrigida' },
    ] };
    const view = render(<TranscriptDialogue session={original} onlyMe={false} />);
    fireEvent.click(screen.getByRole('button', { name: '→ Minha fala' }));
    expect(localStorage.getItem('brain-core:turn-speakers-by-id:dialogue-1')).toContain('"42":"me"');
    view.unmount();
    const updated = { ...session, turns: [
      { id: 41, speaker: 'other' as const, text: 'Fala nova' },
      { id: 42, speaker: 'other' as const, text: 'Fala corrigida' },
    ] };
    render(<TranscriptDialogue session={updated} onlyMe={false} />);
    expect(screen.getByText('Fala nova').closest('li')).toHaveAttribute('data-speaker', 'other');
    expect(screen.getByText('Fala corrigida').closest('li')).toHaveAttribute('data-speaker', 'me');
  });

  it('suporta múltiplos falantes distintos e formata Pessoa N', () => {
    const multiSession = {
      id: 'dialogue-multi',
      started_at: '2026-09-24T08:00:00Z',
      ended_at: '2026-09-24T08:05:00Z',
      device_id: null,
      status: 'ready' as const,
      text: null,
      turns: [
        { speaker: 'speaker_0' as unknown as import('../../types').RememberSpeaker, text: 'Primeira fala', start_at: '2026-09-24T08:00:01Z' },
        { speaker: 'speaker_1' as unknown as import('../../types').RememberSpeaker, text: 'Segunda fala', start_at: '2026-09-24T08:00:05Z' },
        { speaker: 'me' as const, text: 'Minha resposta', start_at: '2026-09-24T08:00:10Z' },
      ],
    };
    render(<TranscriptDialogue session={multiSession} onlyMe={false} />);
    expect(screen.getByText('Pessoa 1')).toBeInTheDocument();
    expect(screen.getByText('Pessoa 2')).toBeInTheDocument();
    expect(screen.getByText('Você')).toBeInTheDocument();
  });

  it('permite identificar manualmente e atualizar quando a inferência está ocupada', async () => {
    vi.mocked(rememberService.getSegmentParticipants)
      .mockResolvedValueOnce({ decision: null, suggestions: [], suggestions_status: 'busy' })
      .mockResolvedValueOnce({ decision: null, suggestions: [], suggestions_status: 'ready' });
    render(<TranscriptDialogue session={{ ...session, turns: [{ id: 42, speaker: 'unknown', text: 'Sintético' }] }} onlyMe={false} />);
    expect(await screen.findByText(/Sugestões em processamento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corrigir' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar identificação' }));
    await waitFor(() => expect(screen.queryByText(/Sugestões em processamento/)).not.toBeInTheDocument());
    expect(rememberService.getSegmentParticipants).toHaveBeenCalledTimes(2);
  });

  it('confirma a sugestão da própria voz sem perder a decisão quando o template falha', async () => {
    vi.mocked(rememberService.getSegmentParticipants).mockResolvedValue({ decision: null, suggestions: [{ identity_id: 'owner-identity', display_name: 'Minha voz', similarity: 0.8 }] });
    vi.mocked(rememberService.decideSegment).mockResolvedValue({ action: 'confirm', identity_id: 'owner-identity', display_name: 'Minha voz', is_owner: true, created_at: 'now' });
    vi.mocked(rememberService.createParticipantTemplate).mockRejectedValue(new Error('short segment'));
    render(<TranscriptDialogue session={{ ...session, turns: [{ id: 42, speaker: 'unknown', text: 'Sintético' }] }} onlyMe={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Identificado neste segmento: Minha voz')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Decisão salva');
    expect(screen.queryByText('Não identificado')).not.toBeInTheDocument();
    expect(screen.getByText('Sintético').closest('li')).toHaveAttribute('data-speaker', 'me');
    expect(rememberService.decideSegment).toHaveBeenCalledWith('dialogue-1', 42, 'confirm', 'owner-identity');
  });
  it('uses a persisted owner decision in the heading and only-me filter, and supports undo', async () => {
    vi.mocked(rememberService.getSegmentParticipants).mockResolvedValue({ decision: { action: 'confirm', identity_id: 'owner', display_name: 'Minha voz', is_owner: true, created_at: 'now' }, suggestions: [] });
    vi.mocked(rememberService.decideSegment).mockResolvedValue({ action: 'undo', identity_id: null, is_owner: false, created_at: 'later' });
    render(<TranscriptDialogue session={{ ...session, turns: [{ id: 42, speaker: 'unknown', text: 'Trecho fictício' }] }} onlyMe />);
    await waitFor(() => expect(screen.getByText('Trecho fictício')).toBeVisible());
    expect(screen.getByText('Minha voz')).toBeVisible();
    expect(screen.queryByText('Não identificado')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(screen.getByText('Trecho fictício')).not.toBeVisible());
    expect(screen.getByText('Nenhuma fala sua nesta sessão.')).toBeVisible();
  });

  it('does not infer account ownership from a participant name or an unconfirmed suggestion', async () => {
    vi.mocked(rememberService.getSegmentParticipants).mockResolvedValue({ decision: { action: 'correct', identity_id: 'another', display_name: 'Minha voz', is_owner: false, created_at: 'now' }, suggestions: [] });
    const view = render(<TranscriptDialogue session={{ ...session, turns: [{ id: 42, speaker: 'me', text: 'Outro participante' }] }} onlyMe />);
    await waitFor(() => expect(screen.getByText('Outro participante')).not.toBeVisible());
    vi.mocked(rememberService.getSegmentParticipants).mockResolvedValue({ decision: null, suggestions: [{ identity_id: 'owner', display_name: 'Minha voz', similarity: 0.9 }] });
    view.rerender(<TranscriptDialogue session={{ ...session, id: 'different-session', turns: [{ id: 42, speaker: 'unknown', text: 'Outra sessão' }] }} onlyMe />);
    await waitFor(() => expect(screen.getByText('Nenhuma fala sua nesta sessão.')).toBeVisible());
    expect(screen.getByText('Outra sessão')).not.toBeVisible();
  });

});
