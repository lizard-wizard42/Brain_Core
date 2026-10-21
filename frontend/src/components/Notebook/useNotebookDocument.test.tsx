import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotebookDocument } from './useNotebookDocument';
import { newNotebook } from './notebookModel';
import { api } from '../../api/client';
import { notebookDrafts } from './notebookDrafts';
import type { Page } from '../../types';

vi.mock('../../api/client', () => ({ api: { patchPage: vi.fn() }, isRevisionConflict: (e: unknown) => String(e).includes('API 409') }));
vi.mock('../../api/browserSession', () => ({ activeBrowserUserId: () => 'test-account' }));
vi.mock('./notebookDrafts', () => ({ notebookDrafts: { read: vi.fn(), write: vi.fn(), remove: vi.fn() } }));
const page = (): Page => ({ id: 'synthetic-page', title: 'Study', slug: 'study', revision: 3, type: 'notebook', content: newNotebook(), sort_order: 0, updated_at: '' });
const changed = () => { const doc = newNotebook(); doc.sheets[0].paper = 'grid'; return doc; };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(notebookDrafts.read).mockResolvedValue(undefined);
  vi.mocked(notebookDrafts.write).mockResolvedValue('ok');
  vi.mocked(notebookDrafts.remove).mockResolvedValue(undefined);
  vi.mocked(api.patchPage).mockResolvedValue({ ...page(), revision: 4 });
});
afterEach(() => cleanup());

describe('Notebook autosave and recovery', () => {
  it('serializes saves and acknowledges only the snapshot actually written', async () => {
    let resolve!: (p: Page) => void;
    vi.mocked(api.patchPage).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useNotebookDocument(page(), false));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const first = changed(), second = changed(); second.sheets[0].tint = '#ffffff';
    act(() => { result.current.apply(first); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.flush(); });
    expect(api.patchPage).toHaveBeenCalledTimes(1);
    act(() => { result.current.apply(second); });
    await act(async () => { await result.current.flush(); });
    expect(api.patchPage).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ...page(), revision: 4 }); await pending; });
    await waitFor(() => expect(api.patchPage).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.patchPage).mock.calls[1][1]).toMatchObject({ content: second });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(result.current.document).toEqual(second);
  });

  it('keeps unsent writing on failure and lets retry save it', async () => {
    vi.mocked(api.patchPage).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useNotebookDocument(page(), false));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const doc = changed(); act(() => { result.current.apply(doc); });
    await act(async () => { await result.current.flush(); });
    expect(result.current.status).toBe('error'); expect(result.current.document).toEqual(doc);
    await waitFor(() => expect(notebookDrafts.write).toHaveBeenCalledWith('test-account:synthetic-page', expect.objectContaining({ document: doc, baseRevision: 3 })));
    expect(notebookDrafts.remove).not.toHaveBeenCalled();
    await act(async () => { await result.current.flush(); });
    expect(result.current.status).toBe('saved');
  });

  it('does not force a conflicted snapshot over another session', async () => {
    vi.mocked(api.patchPage).mockRejectedValue(new Error('API 409'));
    const { result } = renderHook(() => useNotebookDocument(page(), false));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const doc = changed(); act(() => { result.current.apply(doc); });
    await act(async () => { await result.current.flush(); });
    expect(result.current.locked).toBe(true); expect(result.current.status).toBe('conflict');
    act(() => { result.current.apply(newNotebook()); });
    await act(async () => { await result.current.flush(); });
    expect(api.patchPage).toHaveBeenCalledTimes(1); expect(result.current.document).toEqual(doc);
  });

  it('offers matching draft recovery instead of silently replacing the server page', async () => {
    const server = page(), doc = changed();
    vi.mocked(notebookDrafts.read).mockResolvedValue({ document: doc, title: 'Draft', baseRevision: 3 });
    const { result } = renderHook(() => useNotebookDocument(server, false));
    await waitFor(() => expect(result.current.recoverable).not.toBeNull());
    expect(result.current.document).toEqual(server.content); expect(result.current.locked).toBe(true);
    act(() => { result.current.recover(); });
    expect(result.current.document).toEqual(doc); expect(result.current.title).toBe('Draft');
    await act(async () => { await result.current.flush(); });
    expect(result.current.status).toBe('saved');
  });

  it('does not recover a draft based on an older server revision', async () => {
    vi.mocked(notebookDrafts.read).mockResolvedValue({ document: changed(), title: 'Old draft', baseRevision: 1 });
    const server = page(); const { result } = renderHook(() => useNotebookDocument(server, false));
    await waitFor(() => expect(result.current.recoverable).not.toBeNull());
    act(() => { result.current.recover(); });
    expect(result.current.document).toEqual(server.content); expect(api.patchPage).not.toHaveBeenCalled();
    act(() => { result.current.dismissRecovery(); }); expect(result.current.locked).toBe(false);
  });

  it('never writes viewer content or replaces malformed data with an empty document', async () => {
    const p = page();
    const viewer = renderHook(() => useNotebookDocument(p, true));
    await waitFor(() => expect(viewer.result.current.ready).toBe(true));
    act(() => { viewer.result.current.apply(changed()); });
    await act(async () => { await viewer.result.current.flush(); });
    expect(api.patchPage).not.toHaveBeenCalled(); expect(notebookDrafts.read).not.toHaveBeenCalled();
    viewer.unmount();
    const invalid = renderHook(() => useNotebookDocument({ ...p, content: { notebook: true, version: 99 } as unknown as Page['content'] }, false));
    await waitFor(() => expect(invalid.result.current.ready).toBe(true));
    expect(invalid.result.current.document).toBeNull(); expect(api.patchPage).not.toHaveBeenCalled();
  });

  it('undo and redo restore paper and content together, not just a rendered image', async () => {
    const p = page(); const { result } = renderHook(() => useNotebookDocument(p, false));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const doc = changed(); act(() => { result.current.apply(doc); });
    act(() => { result.current.undo(); }); expect(result.current.document).toEqual(p.content);
    act(() => { result.current.redo(); }); expect(result.current.document).toEqual(doc);
  });

  it('merges quick consecutive edits of one field into a single undo step', async () => {
    const p = page(); const { result } = renderHook(() => useNotebookDocument(p, false));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let now = 1_000_000; const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const doc = result.current.document!;
    for (const text of ['A', 'Ab', 'Abc']) { act(() => { result.current.apply(doc, text, true, 'title'); }); now += 200; }
    expect(result.current.title).toBe('Abc');
    act(() => { result.current.undo(); });
    expect(result.current.title).toBe('Study');
    expect(result.current.canUndo).toBe(false);
    act(() => { result.current.redo(); }); expect(result.current.title).toBe('Abc');
    // A pause longer than the window, or another field, starts a new step.
    now += 2000; act(() => { result.current.apply(doc, 'Abcd', true, 'title'); });
    act(() => { result.current.apply(doc, 'Abcd!', true, 'other'); });
    act(() => { result.current.undo(); }); expect(result.current.title).toBe('Abcd');
    act(() => { result.current.undo(); }); expect(result.current.title).toBe('Abc');
    clock.mockRestore();
  });

  it('does not leave an undo step for changes made with remember=false', async () => {
    const p = page(); const { result } = renderHook(() => useNotebookDocument(p, false));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => { result.current.apply(changed(), undefined, false); });
    expect(result.current.canUndo).toBe(false);
  });
});
