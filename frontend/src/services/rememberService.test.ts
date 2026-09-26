import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { rememberService } from './rememberService';

vi.mock('../api/client', () => ({ apiRequest: vi.fn() }));

describe('rememberService', () => {
  beforeEach(() => vi.clearAllMocks());

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

  it('endereça os endpoints de voiceprint', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ enrolled: false });
    await rememberService.getVoiceprint();
    await rememberService.deleteVoiceprint();
    await rememberService.enrollVoiceprint(new Blob(['x'], { type: 'audio/webm' }));
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/remember/memory/voiceprint');
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/remember/memory/voiceprint', { method: 'DELETE' });
    expect(vi.mocked(apiRequest).mock.calls[2][0]).toBe('/api/remember/memory/voiceprint');
    expect(vi.mocked(apiRequest).mock.calls[2][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'audio/webm' } });
  });
});
