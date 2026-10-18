import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotesPage } from './NotesPage';
import { api } from '../api/client';
import type { RememberNote } from '../types';
vi.mock('../api/client', () => ({ api: {
  listRememberNotes: vi.fn(), listTrashedRememberNotes: vi.fn(), restoreRememberNote: vi.fn(),
  createRememberNote: vi.fn(), updateRememberNote: vi.fn(), deleteRememberNote: vi.fn(), checkRememberNoteItem: vi.fn(),
} }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
it('loads trash on demand, restores a note and toggles its checklist from the board', async () => {
  const note: RememberNote = { id: 'synthetic', title: 'Lista fictícia', body: '', color: 'sage', tags: ['keep'],
    checklist: [{ id: 'item', text: 'Revisar', checked: false }], reminder_date: null, reminder_label: null,
    created_at: '2026-10-18T12:00:00Z', updated_at: '2026-10-18T12:00:00Z' };
  vi.mocked(api.listRememberNotes).mockResolvedValue({ notes: [] });
  vi.mocked(api.listTrashedRememberNotes).mockResolvedValue({ notes: [{ ...note, deleted_at: '2026-10-18T13:00:00Z' }] });
  vi.mocked(api.restoreRememberNote).mockResolvedValue(note);
  vi.mocked(api.checkRememberNoteItem).mockResolvedValue({ ...note, checklist: [{ ...note.checklist[0], checked: true }] });
  render(<MemoryRouter><NotesPage /></MemoryRouter>);
  await screen.findByText('Suas ideias começam aqui. Escreva sua primeira nota acima.');
  expect(api.listTrashedRememberNotes).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Lixeira', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Lista fictícia' }));
  await screen.findByText('Nota restaurada em Minhas notas.');
  fireEvent.click(screen.getByRole('button', { name: 'Minhas notas', exact: true }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Revisar' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Revisar' })).toBeChecked());
  expect(api.checkRememberNoteItem).toHaveBeenCalledWith('synthetic', 'item', true);
  expect(api.createRememberNote).not.toHaveBeenCalled();
});
