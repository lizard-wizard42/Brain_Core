import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TranscriptDialogue } from './TranscriptDialogue';

const session = {
  id: 'dialogue-1', started_at: '2026-09-24T08:00:00Z', ended_at: '2026-09-24T08:05:00Z',
  device_id: null, status: 'ready' as const, text: 'Oi. Olá.',
  turns: [{ speaker: 'me' as const, text: 'Oi.', start_at: '2026-09-24T08:00:12Z' },
    { speaker: 'other' as const, text: 'Olá.', start_at: '2026-09-24T08:00:18Z' }],
};

describe('TranscriptDialogue', () => {
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
    expect(screen.queryByText('Olá.')).not.toBeInTheDocument();
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
});
