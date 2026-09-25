import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, hasSessionHint } from './client';

describe('api client auth/session behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('sets session hint on successful login without 2FA', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        requiresTwoFactor: false,
        expiresIn: '1h',
        user: { id: '1', email: 'a@a.com', name: null },
      }),
    } as Response);

    const result = await api.login('a@a.com', 'pass');

    expect(result.requiresTwoFactor).toBe(false);
    expect(hasSessionHint()).toBe(true);
  });

  it('does not set session hint when login requires 2FA', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        requiresTwoFactor: true,
        pendingToken: 'pending',
        expiresIn: '5m',
      }),
    } as Response);

    const result = await api.login('a@a.com', 'pass');

    expect(result.requiresTwoFactor).toBe(true);
    expect(hasSessionHint()).toBe(false);
  });

  it('sets session hint after successful login 2FA verification', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        requiresTwoFactor: false,
        expiresIn: '1h',
        user: { id: '1', email: 'a@a.com', name: null },
      }),
    } as Response);

    await api.verifyLoginTwoFactor('pending', '123456');
    expect(hasSessionHint()).toBe(true);
  });

  it('clears session hint on logout even if request fails', async () => {
    sessionStorage.setItem('brain-core:session-hint', '1');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));

    await expect(api.logout()).rejects.toThrow('network');

    expect(hasSessionHint()).toBe(false);
  });

  it('redirects to login and clears hint on 401 responses', async () => {
    sessionStorage.setItem('brain-core:session-hint', '1');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as Response);

    await expect(api.getMe()).rejects.toThrow('API 401: unauthorized');
    expect(hasSessionHint()).toBe(false);
  });

  it('builds subpage filter query params correctly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await api.getSubPagesFiltered('page-1', {
      status: 'open',
      tag: 'urgent',
      due_from: '2026-01-01',
      due_to: '2026-01-31',
    });

    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/pages/page-1/subpages?');
    expect(calledUrl).toContain('status=open');
    expect(calledUrl).toContain('tag=urgent');
    expect(calledUrl).toContain('due_from=2026-01-01');
    expect(calledUrl).toContain('due_to=2026-01-31');
  });

  it('uploadImage returns base-prefixed URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: '/uploads/a.png' }),
    } as Response);

    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const url = await api.uploadImage(file);

    expect(url).toContain('/uploads/a.png');
  });

  it('uploadFile parses backend error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'arquivo invalido' }),
    } as Response);

    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    await expect(api.uploadFile(file)).rejects.toThrow('arquivo invalido');
  });

  it('uploadFile falls back to status + raw text when error is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'server exploded',
    } as Response);

    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    await expect(api.uploadFile(file)).rejects.toThrow('Upload failed: 500 - server exploded');
  });

  it('login error uses fallback message when backend has no error field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as Response);

    await expect(api.login('a@a.com', 'wrong')).rejects.toThrow('Credenciais inválidas');
  });

  it('normalizes custom emoji URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emojis: [{ id: '1', name: 'ok', url: '/uploads/e.png' }] }),
    } as Response);

    const result = await api.listCustomEmojis();

    expect(result[0].url).toContain('/uploads/e.png');
  });
});
