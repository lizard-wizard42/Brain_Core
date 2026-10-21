import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NotasTrash } from './NotasTrash';
import type { RememberNote } from '../../types';

afterEach(cleanup);
const note: RememberNote = { id: 'synthetic', title: 'Recuperar', body: 'Texto fictício', color: 'sand', tags: [], checklist: [], reminder_date: null, reminder_label: null, created_at: 'now', updated_at: 'now' };
it('shows empty trash and offers retry after a load failure', () => {
  const reload = vi.fn();
  const { rerender } = render(<NotasTrash notes={[]} loading={false} error={null} onReload={reload} onRestore={vi.fn()} />);
  expect(screen.getByText('Nenhuma nota na lixeira.')).toBeInTheDocument();
  rerender(<NotasTrash notes={[]} loading={false} error="Falha de rede" onReload={reload} onRestore={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(reload).toHaveBeenCalled();
});
it('restores a selected note and keeps failure visible for retry', async () => {
  const restore = vi.fn().mockRejectedValueOnce(new Error('Sem conexão'));
  render(<NotasTrash notes={[note]} loading={false} error={null} onReload={vi.fn()} onRestore={restore} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restaurar Recuperar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
  fireEvent.click(screen.getByRole('button', { name: 'Restaurar Recuperar' }));
  await waitFor(() => expect(restore).toHaveBeenCalledTimes(2));
  expect(restore).toHaveBeenLastCalledWith(note);
});
