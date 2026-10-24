import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTextEditorPersistence } from './useTextEditorPersistence';
import { textEditorDrafts } from './textEditorDrafts';
import { api } from '../../api/client';
import type { Page, TiptapDoc } from '../../types';

vi.mock('./textEditorDrafts', () => ({ textEditorDrafts: { read: vi.fn(), write: vi.fn(), remove: vi.fn() } }));
vi.mock('../../api/client', () => ({ api: { savePage: vi.fn() }, isRevisionConflict: (e: unknown) => String(e).includes('409') }));
let account: string | null = 'account-a';
vi.mock('../../api/browserSession', () => ({ activeBrowserUserId: () => account }));
const doc = (text: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const page = (): Page => ({ id: 'fictional-page', type: 'note', title: 'Study', content: doc('Saved'), revision: 3, slug: 'study', sort_order: 0, updated_at: '' });
const draft = () => ({ content: doc('Unsent'), title: 'Local study', baseRevision: 3 });
const key = 'account-a:fictional-page';
const setup = async () => {
  const hook = renderHook(() => useTextEditorPersistence(page()));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
};
beforeEach(() => {
  account = 'account-a'; vi.resetAllMocks();
  vi.mocked(textEditorDrafts.read).mockResolvedValue(undefined);
  vi.mocked(textEditorDrafts.write).mockResolvedValue(undefined);
  vi.mocked(textEditorDrafts.remove).mockResolvedValue(undefined);
  vi.mocked(api.savePage).mockResolvedValue({ ...page(), revision: 4 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Text editor persistence', () => {
  it('writes a local draft immediately and debounces the server save', async () => {
    const { result } = await setup(); vi.useFakeTimers();
    act(() => { result.current.change(doc('Typed'), 'New title'); });
    await act(async () => { await Promise.resolve(); });
    expect(textEditorDrafts.write).toHaveBeenCalledWith(key, { content: doc('Typed'), title: 'New title', baseRevision: 3 });
    expect(api.savePage).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(api.savePage).toHaveBeenCalledWith('fictional-page', { content: doc('Typed'), title: 'New title', revision: 3 }, { keepalive: false });
    expect(result.current.status).toBe('saved'); expect(textEditorDrafts.remove).toHaveBeenCalledWith(key);
  });
  it('keeps a failed draft for reopening and allows retry', async () => {
    vi.mocked(api.savePage).mockRejectedValueOnce(new Error('offline'));
    const { result, unmount } = await setup();
    await act(async () => { await result.current.saveNow(doc('Offline'), 'Offline title'); });
    expect(result.current.status).toBe('error'); expect(textEditorDrafts.remove).not.toHaveBeenCalled();
    await act(async () => { await result.current.flush(); });
    expect(result.current.status).toBe('saved');
    unmount();
    vi.mocked(textEditorDrafts.read).mockResolvedValue(draft());
    const reopened = await setup();
    expect(reopened.result.current.recoverable).toEqual(draft());
    expect(api.savePage).toHaveBeenCalledTimes(2);
  });
  it('waits for the draft read and never saves over an unresolved recovery choice', async () => {
    let resolve!: (d: ReturnType<typeof draft>) => void;
    vi.mocked(textEditorDrafts.read).mockImplementation(() => new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useTextEditorPersistence(page()));
    act(() => { result.current.change(doc('Unexpected update'), 'Unexpected'); });
    expect(result.current.ready).toBe(false); expect(api.savePage).not.toHaveBeenCalled();
    await act(async () => { resolve(draft()); });
    expect(result.current.recoverable).toEqual(draft());
    await act(async () => { await result.current.flush(); });
    expect(api.savePage).not.toHaveBeenCalled(); expect(textEditorDrafts.write).not.toHaveBeenCalled();
    act(() => { expect(result.current.recover()).toEqual(draft()); });
    await act(async () => { await result.current.flush(); });
    expect(api.savePage).toHaveBeenCalledWith('fictional-page', expect.objectContaining({ title: 'Local study' }), expect.anything());
  });
  it('preserves a newer edit while an older request is pending and serializes writes', async () => {
    let resolve!: (p: Page) => void;
    vi.mocked(api.savePage).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const { result } = await setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.saveNow(doc('First'), 'First'); });
    await waitFor(() => expect(api.savePage).toHaveBeenCalledTimes(1));
    act(() => { result.current.change(doc('Second'), 'Second'); });
    await act(async () => { resolve({ ...page(), revision: 4 }); await pending; });
    expect(textEditorDrafts.remove).not.toHaveBeenCalled();
    expect(textEditorDrafts.write).toHaveBeenLastCalledWith(key, { content: doc('Second'), title: 'Second', baseRevision: 4 });
    await act(async () => { await result.current.flush(); });
    expect(api.savePage).toHaveBeenLastCalledWith('fictional-page', expect.objectContaining({ title: 'Second', revision: 4 }), expect.anything());
    expect(result.current.status).toBe('saved');
  });
  it('blocks stale recovered drafts and server conflicts without deleting either draft', async () => {
    vi.mocked(textEditorDrafts.read).mockResolvedValue({ ...draft(), baseRevision: 2 });
    const { result } = await setup();
    act(() => { result.current.recover(); });
    expect(result.current.conflict).toBe(true);
    await act(async () => { await result.current.flush(); });
    expect(api.savePage).not.toHaveBeenCalled(); expect(textEditorDrafts.remove).not.toHaveBeenCalled();
    await act(async () => { await result.current.discard(page()); });
    vi.mocked(api.savePage).mockRejectedValueOnce(new Error('API 409'));
    await act(async () => { await result.current.saveNow(doc('Conflict'), 'Conflict'); });
    expect(result.current.conflict).toBe(true); expect(result.current.status).toBe('conflict');
  });
  it('warns when local persistence fails but can still save online', async () => {
    vi.mocked(textEditorDrafts.read).mockRejectedValue(new Error('unavailable'));
    vi.mocked(textEditorDrafts.write).mockRejectedValue(new Error('quota'));
    const { result } = await setup();
    expect(result.current.draftWarning).toBe(true);
    await act(async () => { await result.current.saveNow(doc('Online'), 'Online'); });
    expect(result.current.status).toBe('saved');
  });
  it('flushes on pagehide and unmount, but never sends under a different account', async () => {
    const { result, unmount } = await setup();
    act(() => { result.current.change(doc('Closing'), 'Closing'); window.dispatchEvent(new Event('pagehide')); });
    await waitFor(() => expect(api.savePage).toHaveBeenCalledTimes(1));
    act(() => { result.current.change(doc('Unmount'), 'Unmount'); });
    unmount();
    await waitFor(() => expect(api.savePage).toHaveBeenCalledTimes(2));
    const next = await setup(); account = 'account-b';
    await act(async () => { await next.result.current.saveNow(doc('Wrong account'), 'Wrong'); });
    expect(api.savePage).toHaveBeenCalledTimes(2);
  });
  it('removes an already saved draft without asking for recovery', async () => {
    vi.mocked(textEditorDrafts.read).mockResolvedValue({ content: page().content as TiptapDoc, title: page().title, baseRevision: 2 });
    const { result } = await setup();
    expect(result.current.recoverable).toBeNull();
    expect(textEditorDrafts.remove).toHaveBeenCalledWith(key);
  });
  it('retains an edit reverted to the saved text while an older save is in flight', async () => {
    let resolve!: (p: Page) => void;
    vi.mocked(api.savePage).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const { result } = await setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.saveNow(doc('In flight'), 'Changed'); });
    await waitFor(() => expect(api.savePage).toHaveBeenCalledTimes(1));
    act(() => { result.current.change(doc('Saved'), 'Study'); });
    await waitFor(() => expect(textEditorDrafts.write).toHaveBeenLastCalledWith(key, { content: doc('Saved'), title: 'Study', baseRevision: 3 }));
    expect(textEditorDrafts.remove).not.toHaveBeenCalled();
    await act(async () => { resolve({ ...page(), revision: 4 }); await pending; await result.current.flush(); });
    expect(api.savePage).toHaveBeenLastCalledWith('fictional-page', expect.objectContaining({ content: doc('Saved') }), expect.anything());
  });
  it('does not report saved if another edit arrives during draft cleanup', async () => {
    let finishCleanup!: () => void;
    vi.mocked(textEditorDrafts.remove).mockImplementationOnce(() => new Promise<void>(r => { finishCleanup = r; }));
    const { result } = await setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.saveNow(doc('First'), 'First'); });
    await waitFor(() => expect(textEditorDrafts.remove).toHaveBeenCalledTimes(1));
    act(() => { result.current.change(doc('Latest'), 'Latest'); });
    await act(async () => { finishCleanup(); await pending; });
    expect(result.current.status).toBe('saving');
    expect(textEditorDrafts.write).toHaveBeenLastCalledWith(key, { content: doc('Latest'), title: 'Latest', baseRevision: 4 });
  });

  it('accepts metadata-only acknowledgements without hiding a content conflict', async () => {
    const { result } = await setup();
    act(() => { result.current.change(doc('Typing'), 'Study'); });
    act(() => { result.current.acceptMetadata({ ...page(), icon: '📘', revision: 4 }); });
    await act(async () => { await result.current.flush(); });
    expect(api.savePage).toHaveBeenLastCalledWith('fictional-page', expect.objectContaining({ revision: 4 }), expect.anything());
    act(() => { result.current.acceptMetadata({ ...page(), content: doc('Someone else'), revision: 9 }); });
    await act(async () => { await result.current.saveNow(doc('More typing'), 'Study'); });
    expect(api.savePage).toHaveBeenLastCalledWith('fictional-page', expect.objectContaining({ revision: 4 }), expect.anything());
  });

  it('blocks network saves when the browser session ends', async () => {
    const { result } = await setup();
    act(() => { result.current.change(doc('Pending logout'), 'Pending logout'); window.dispatchEvent(new Event('brain-core:session-ended')); });
    await act(async () => { await result.current.flush(); });
    expect(api.savePage).not.toHaveBeenCalled();
    await waitFor(() => expect(textEditorDrafts.write).toHaveBeenCalledWith(key, expect.objectContaining({ title: 'Pending logout' })));
  });
  it('does not read or save another account when no account is active', async () => {
    account = null;
    const { result } = await setup();
    expect(result.current.draftWarning).toBe(true);
    await act(async () => { await result.current.saveNow(doc('Unlinked'), 'Unlinked'); });
    expect(textEditorDrafts.read).not.toHaveBeenCalled(); expect(api.savePage).not.toHaveBeenCalled();
  });

});
