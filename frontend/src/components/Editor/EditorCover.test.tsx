import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CoverImage } from './EditorCover';
import { api } from '../../api/client';
vi.mock('../../api/client', () => ({ api: { patchPage: vi.fn(), removeCover: vi.fn(), coverUrl: (p: string) => p } }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it('forwards a cover URL acknowledgement so text saves retain the right revision', async () => {
  const saved = { id: 'fictional', revision: 4, cover_url: 'https://example.test/demo.png' } as Awaited<ReturnType<typeof api.patchPage>>;
  vi.mocked(api.patchPage).mockResolvedValue(saved);
  const onMetadataSaved = vi.fn();
  render(<CoverImage pageId="fictional" coverUrl={null} coverPositionY={50} onUpdate={vi.fn()} onMetadataSaved={onMetadataSaved} />);
  fireEvent.click(screen.getByRole('button', { name: /Adicionar capa/ }));
  fireEvent.change(screen.getByPlaceholderText('https://...'), { target: { value: saved.cover_url } });
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(onMetadataSaved).toHaveBeenCalledWith(saved));
});
it('forwards the acknowledged revision when removing a cover', async () => {
  const saved = { id: 'fictional', revision: 5, cover_url: null } as Awaited<ReturnType<typeof api.removeCover>>;
  vi.mocked(api.removeCover).mockResolvedValue(saved);
  const onMetadataSaved = vi.fn();
  render(<CoverImage pageId="fictional" coverUrl="https://example.test/demo.png" coverPositionY={50} onUpdate={vi.fn()} onMetadataSaved={onMetadataSaved} />);
  fireEvent.click(screen.getByRole('button', { name: /Remover/ }));
  await waitFor(() => expect(onMetadataSaved).toHaveBeenCalledWith(saved));
});
