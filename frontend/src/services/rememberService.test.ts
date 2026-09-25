import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { rememberService } from './rememberService';

vi.mock('../api/client', () => ({ apiRequest: vi.fn(), apiUrl: (path: string) => `http://backend${path}` }));

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

  it('setCluster monta o PATCH /clusters com a action e os opts', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ status: 'confirmed' });
    await rememberService.setCluster('s9', 2, 'confirm_person', { personId: 4 });
    await rememberService.setCluster('s9', 3, 'confirm_new', { name: 'João' });
    await rememberService.setCluster('s9', 1, 'reject');
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/remember/memory/clusters', {
      method: 'PATCH',
      body: JSON.stringify({ session_id: 's9', cluster: 2, action: 'confirm_person', person_id: 4 }),
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/remember/memory/clusters', {
      method: 'PATCH',
      body: JSON.stringify({ session_id: 's9', cluster: 3, action: 'confirm_new', name: 'João' }),
    });
    expect(apiRequest).toHaveBeenNthCalledWith(3, '/api/remember/memory/clusters', {
      method: 'PATCH',
      body: JSON.stringify({ session_id: 's9', cluster: 1, action: 'reject' }),
    });
  });

  it('CRUD de pessoas e backfill', async () => {
    vi.mocked(apiRequest).mockResolvedValue({});
    await rememberService.getPeople();
    await rememberService.renamePerson(5, 'Ana');
    await rememberService.mergePeople(5, 8);
    await rememberService.deletePerson(8);
    await rememberService.backfillSpeakers('s1');
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/remember/memory/people');
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/remember/memory/people/5', { method: 'PATCH', body: JSON.stringify({ name: 'Ana' }) });
    expect(apiRequest).toHaveBeenNthCalledWith(3, '/api/remember/memory/people/merge', { method: 'POST', body: JSON.stringify({ into_id: 5, from_id: 8 }) });
    expect(apiRequest).toHaveBeenNthCalledWith(4, '/api/remember/memory/people/8', { method: 'DELETE' });
    expect(apiRequest).toHaveBeenNthCalledWith(5, '/api/remember/memory/sessions/s1/backfill-speakers', { method: 'POST' });
  });

  it('segmentAudioUrl aponta pro proxy do backend', () => {
    expect(rememberService.segmentAudioUrl(42)).toContain('/api/remember/memory/segments/42/audio');
  });

  it('clusterSampleUrl monta o endpoint multi-id e descarta ids inválidos', () => {
    expect(rememberService.clusterSampleUrl([11, 12, -1, 13.5, 13]))
      .toContain('/api/remember/memory/segments/audio?ids=11%2C12%2C13');
  });
});
