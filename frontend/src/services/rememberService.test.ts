import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { rememberService } from './rememberService';
import { activeBrowserUserId } from '../api/browserSession';

vi.mock('../api/client', () => ({ apiRequest: vi.fn() }));
vi.mock('../api/browserSession', () => ({ activeBrowserUserId: vi.fn(() => 'owner-a') }));

describe('rememberService', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(activeBrowserUserId).mockReturnValue('owner-a'); });

  it('centraliza status e start no backend Brain Core', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ state: 'stopped' });
    await rememberService.getStatus();
    await rememberService.start();
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/remember/memory/status');
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/remember/memory/start', { method: 'POST' });
  });

  it('desembrulha nós cronológicos lazy', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ years: [2026] }).mockResolvedValueOnce({ months: [8] }).mockResolvedValueOnce({ days: ['2026-08-26'] });
    await expect(rememberService.getYears()).resolves.toEqual([2026]);
    await expect(rememberService.getMonths(2026)).resolves.toEqual([8]);
    await expect(rememberService.getDays(2026, 8)).resolves.toEqual(['2026-08-26']);
  });

  it('monta a URL de busca com q, limit e speaker', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ query: 'reuniao', results: [] });
    await rememberService.search('reuniao');
    await rememberService.search('café & bolo', 5, 'me');
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/remember/memory/search?q=reuniao');
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/remember/memory/search?q=caf%C3%A9%20%26%20bolo&limit=5&speaker=me');
  });

  it('uses the viewer timezone for history and the local day for search links', async () => {
    const zone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    vi.mocked(apiRequest).mockResolvedValue({ sessions: [], results: [] });
    await rememberService.getDay('2026-01-01');
    expect(apiRequest).toHaveBeenLastCalledWith(`/api/remember/memory/days/2026-01-01?time_zone=${zone}`);
    const instant = new Date(2026, 0, 1, 23, 30);
    vi.mocked(apiRequest).mockResolvedValue({ query: 'test', results: [{ started_at: instant.toISOString(), date: 'wrong' }] });
    expect((await rememberService.search('test')).results[0].date).toBe('2026-01-01');
  });

  it('endereça os endpoints de voiceprint', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ enrolled: false });
    await rememberService.getVoiceprint();
    await rememberService.deleteVoiceprint();
    await rememberService.enrollVoiceprint(new Blob(['x'], { type: 'audio/webm' }), 'synthetic-owner');
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/remember/memory/voiceprint');
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/remember/memory/voiceprint', { method: 'DELETE' });
    expect(vi.mocked(apiRequest).mock.calls[2][0]).toBe('/api/remember/memory/voiceprint?owner_user_id=synthetic-owner');
    expect(vi.mocked(apiRequest).mock.calls[2][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'audio/webm' } });
  });

  it('serializa consultas de segmentos e continua após falha', async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
      .mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ decision: null, suggestions: [] });
    const first = rememberService.getSegmentParticipants('session', 1);
    const second = rememberService.getSegmentParticipants('session', 2);
    const secondResult = expect(second).rejects.toThrow('network');
    const third = rememberService.getSegmentParticipants('session', 3);
    await Promise.resolve();
    expect(apiRequest).toHaveBeenCalledTimes(1);
    complete({ decision: null, suggestions: [] });
    await first; await secondResult; await third;
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it('descarta resultado em voo e consultas pendentes quando a conta muda', async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const first = rememberService.getSegmentParticipants('session', 1);
    const second = rememberService.getSegmentParticipants('session', 2);
    const firstResult = expect(first).rejects.toThrow('Conta alterada');
    const secondResult = expect(second).rejects.toThrow('Conta alterada');
    await Promise.resolve();
    vi.mocked(activeBrowserUserId).mockReturnValue('owner-b');
    complete({ decision: null, suggestions: [] });
    await firstResult; await secondResult;
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
