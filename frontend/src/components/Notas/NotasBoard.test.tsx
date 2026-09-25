import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotasBoard } from './NotasBoard';
import type { RememberNote } from '../../types';

function makeNote(overrides: Partial<RememberNote> = {}): RememberNote {
  return {
    id: 'n1', title: 'Comprar café', body: 'No mercado', color: 'sand',
    checklist: [], tags: [], reminder_date: null, reminder_time: null,
    reminder_label: null, reminder_repeat_daily: false, reminder_sent_at: null,
    created_at: '2026-05-14T10:00:00.000Z', updated_at: '2026-05-14T10:00:00.000Z',
    ...overrides,
  };
}

function setup(notes: RememberNote[]) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  render(<NotasBoard notes={notes} loading={false} error={null} onCreate={onCreate} onSave={onSave} onDelete={onDelete} />);
  return { onCreate, onSave, onDelete };
}

describe('NotasBoard', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renderiza as notas', () => {
    setup([makeNote({ title: 'Planejar sprint' })]);
    expect(screen.getByText('Planejar sprint')).toBeInTheDocument();
  });

  it('filtra por busca', () => {
    setup([makeNote({ title: 'Planejar sprint' })]);
    fireEvent.change(screen.getByPlaceholderText('Buscar notas...'), { target: { value: 'inexistente' } });
    expect(screen.getByText('Nenhuma nota encontrada para "inexistente".')).toBeInTheDocument();
  });

  it('cria uma nota pelo composer', async () => {
    const { onCreate } = setup([]);
    fireEvent.click(screen.getByText('Escreva uma nota…'));
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'Nova nota' } });
    fireEvent.click(screen.getByRole('button', { name: '📝 Criar nota' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ title: 'Nova nota' });
  });

  it('edita e apaga uma nota', async () => {
    const { onSave, onDelete } = setup([makeNote({ id: 'n3', title: 'Titulo antigo' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar nota' }));
    fireEvent.change(screen.getByDisplayValue('Titulo antigo'), { target: { value: 'Titulo novo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'n3' }), expect.objectContaining({ title: 'Titulo novo' })));

    fireEvent.click(screen.getByRole('button', { name: 'Editar nota' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'n3' })));
  });
});
