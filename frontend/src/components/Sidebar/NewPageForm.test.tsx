import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NewPageForm } from './NewPageForm';
afterEach(cleanup);
it('prevents duplicate creation and cancellation while the chosen format is pending', async () => {
  let finish!: () => void;
  const onCreate = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const onCancel = vi.fn();
  render(<NewPageForm title="Fictional notebook" onTitleChange={vi.fn()} onCreate={onCreate} onCancel={onCancel} />);
  const notebook = screen.getByRole('button', { name: 'Caderno' });
  fireEvent.click(notebook); fireEvent.click(notebook);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(onCreate).toHaveBeenCalledExactlyOnceWith('notebook');
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Criando página');
  finish();
  await waitFor(() => expect(notebook).toBeEnabled());
});
it('keeps the title and permits retry when creation fails', async () => {
  const onCreate = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  render(<NewPageForm nested title="Fictional child" onTitleChange={vi.fn()} onCreate={onCreate} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Infinite' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível criar');
  expect(screen.getByRole('textbox')).toHaveValue('Fictional child');
  fireEvent.click(screen.getByRole('button', { name: 'Infinite' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(onCreate).toHaveBeenCalledTimes(2);
});
it('blocks empty titles and keeps Escape available before any request', () => {
  const onCreate = vi.fn(), onCancel = vi.fn();
  render(<NewPageForm title="   " onTitleChange={vi.fn()} onCreate={onCreate} onCancel={onCancel} />);
  for (const name of ['Nota','Infinite','Caderno']) expect(screen.getByRole('button', { name })).toBeDisabled();
  fireEvent.submit(screen.getByRole('form', { name: 'Criar página' }));
  expect(onCreate).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledOnce();
});
