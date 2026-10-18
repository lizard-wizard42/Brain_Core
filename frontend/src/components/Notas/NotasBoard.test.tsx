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

  it('busca sem acentos e combina os filtros com a pesquisa', () => {
    setup([
      makeNote({ id: 'a', title: 'Reunião', reminder_date: '2026-06-01' }),
      makeNote({ id: 'b', title: 'Reunião da equipe', checklist: [{ id: 'c', text: 'Pauta', checked: false }] }),
    ]);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar notas' }), { target: { value: 'reuniao' } });
    expect(screen.getByText('Reunião')).toBeInTheDocument();
    expect(screen.getByText('Reunião da equipe')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lembretes' }));
    expect(screen.getByText('Reunião')).toBeInTheDocument();
    expect(screen.queryByText('Reunião da equipe')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Listas' }));
    expect(screen.queryByText('Reunião', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('Reunião da equipe')).toBeInTheDocument();
  });

  it('ordena por título sem mudar os dados e permite limpar uma busca vazia', () => {
    const notes = [makeNote({ id: 'b', title: 'Zebra' }), makeNote({ id: 'a', title: 'Abacate' })];
    setup(notes);
    fireEvent.change(screen.getByRole('combobox', { name: 'Ordenar' }), { target: { value: 'title' } });
    const cards = [...document.querySelectorAll('[id^="quick-note-"]')];
    expect(cards.map(card => card.id)).toEqual(['quick-note-a', 'quick-note-b']);
    expect(notes.map(note => note.id)).toEqual(['b', 'a']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByText('Abacate')).toBeInTheDocument();
    expect(screen.getByText('Zebra')).toBeInTheDocument();
  });

  it('limita a primeira renderização e permite carregar o restante', () => {
    setup(Array.from({ length: 30 }, (_, index) => makeNote({ id: `n${index}`, title: `Nota ${index}` })));
    expect(screen.getAllByRole('button', { name: 'Editar nota' })).toHaveLength(24);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar mais notas (6)' }));
    expect(screen.getAllByRole('button', { name: 'Editar nota' })).toHaveLength(30);
    expect(screen.queryByRole('button', { name: /Mostrar mais notas/ })).not.toBeInTheDocument();
  });

  it('mantém acessível uma nota antiga aberta por link direto', () => {
    const notes = Array.from({ length: 30 }, (_, index) => makeNote({ id: `n${index}`, title: `Nota ${index}` }));
    render(<NotasBoard notes={notes} focusedNoteId="n29" loading={false} error={null} onCreate={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Nota 29')).toBeInTheDocument();
    expect(document.getElementById('quick-note-n29')).toHaveFocus();
  });

  it('mostra apenas seis notas recentes na prévia sem o botão flutuante', () => {
    const notes = Array.from({ length: 10 }, (_, index) => makeNote({ id: `n${index}`, title: `Nota ${index}`, updated_at: `2026-05-${String(index + 1).padStart(2, '0')}T10:00:00Z` }));
    render(<NotasBoard preview notes={notes} loading={false} error={null} onCreate={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Editar nota' })).toHaveLength(6);
    expect(screen.getByText('Nota 9')).toBeInTheDocument();
    expect(screen.queryByText('Nota 0')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar nota' })).not.toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole('button', { name: 'Editar nota' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'n3' })));
  });

  it('mostra falha de criação sem perder o rascunho e permite tentar novamente', async () => {
    const { onCreate } = setup([]);
    onCreate.mockRejectedValueOnce(new Error('Falha de conexão'));
    fireEvent.click(screen.getByText('Escreva uma nota…'));
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'Rascunho de teste' } });
    fireEvent.click(screen.getByRole('button', { name: '📝 Criar nota' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de conexão');
    expect(screen.getByDisplayValue('Rascunho de teste')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '📝 Criar nota' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it('mostra falha de edição sem fechar o editor e permite tentar novamente', async () => {
    const { onSave } = setup([makeNote()]);
    onSave.mockRejectedValueOnce(new Error('Não foi possível salvar'));
    fireEvent.click(screen.getByRole('button', { name: 'Editar nota' }));
    fireEvent.change(screen.getByDisplayValue('Comprar café'), { target: { value: 'Edição de teste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar');
    expect(screen.getByDisplayValue('Edição de teste')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(onSave).toHaveBeenCalledTimes(2);
  });

});
