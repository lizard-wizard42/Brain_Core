import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { Highlight, UnifiedSearchResults } from './UnifiedSearchResults';
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../api/client', () => ({ api: { searchNotes: vi.fn() } }));
const item = { id: 'synthetic', title: 'Investigação', kind: 'page' as const, type: 'note' as const, icon: null,
  updated_at: '', parent_page_id: null, snippet: 'Uma descoberta lunar', path: [{ id: 'parent', title: 'Estudos' }] };
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

it('highlights accented text as text, and opens pages with their paths', async () => {
  vi.mocked(api.searchNotes).mockResolvedValue({ items: [item], next_offset: null });
  const open = vi.fn(); render(<UnifiedSearchResults query="investigacao" onPageClick={open} />);
  expect(await screen.findByText('Estudos')).toBeInTheDocument();
  expect(screen.getByText('Investigação').tagName).toBe('MARK');
  fireEvent.click(screen.getByRole('button', { name: /Investigação/ }));
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'synthetic', children: [] }));
  const { container } = render(<Highlight text="<script>Olá</script>" query="ola" />);
  expect(container.querySelector('script')).toBeNull();
});

it('filters collections, loads further results and opens the specific quick note', async () => {
  vi.mocked(api.searchNotes).mockResolvedValueOnce({ items: [item], next_offset: 20 })
    .mockResolvedValueOnce({ items: [{ ...item, id: 'two', title: 'Segunda' }], next_offset: null })
    .mockResolvedValue({ items: [{ ...item, kind: 'note' }], next_offset: null });
  render(<UnifiedSearchResults query="lunar" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais resultados' }));
  expect(await screen.findByText('Segunda')).toBeInTheDocument(); expect(screen.getByText('Investigação')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Pesquisar em'), { target: { value: 'notes' } });
  fireEvent.click(await screen.findByRole('button', { name: /Nota rápida/ }));
  expect(navigate).toHaveBeenCalledWith('/notes?note=synthetic');
  expect(api.searchNotes).toHaveBeenLastCalledWith('lunar', 'notes', 0, expect.any(AbortSignal));
});

it('distinguishes failed searches from empty results and retries', async () => {
  vi.mocked(api.searchNotes).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [], next_offset: null });
  render(<UnifiedSearchResults query="lunar" />);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText(/Nenhuma correspondência/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByText(/Nenhuma correspondência/)).toBeInTheDocument();
});

it('ignores an older response after the search changes', async () => {
  let finish!: (value: { items: typeof item[]; next_offset: null }) => void;
  vi.mocked(api.searchNotes).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ items: [{ ...item, title: 'Atual' }], next_offset: null });
  const { rerender } = render(<UnifiedSearchResults query="antigo" />);
  await waitFor(() => expect(api.searchNotes).toHaveBeenCalledOnce());
  rerender(<UnifiedSearchResults query="atual" />);
  expect(await screen.findByText('Atual')).toBeInTheDocument();
  finish({ items: [item], next_offset: null });
  await waitFor(() => expect(screen.queryByText('Investigação')).not.toBeInTheDocument());
});
