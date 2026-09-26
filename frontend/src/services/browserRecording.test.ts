import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserRecording } from './browserRecording';
import { apiRequest } from '../api/client';

vi.mock('../api/client', () => ({ apiRequest: vi.fn(async (path: string) =>
  path === '/api/auth/me'
    ? { id: localStorage.getItem('brain-core:active-user-id') }
    : { status: 'stored' }) }));

const databaseName = 'brain-core-browser-recordings';
const sessionA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const sessionB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

function mutationCalls(): string[] {
  return vi.mocked(apiRequest).mock.calls.map(([path]) => String(path)).filter((path) => path !== '/api/auth/me');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' });
      request.result.createObjectStore('chunks', { keyPath: ['sessionId', 'chunkNum'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePending(id: string, ownerUserId?: string, uploadedChunks = 0, hasChunk = true): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(['sessions', 'chunks'], 'readwrite');
  transaction.objectStore('sessions').put({ id, ownerUserId, startedAt: '2026-09-24T12:00:00.000Z', status: 'stopped', uploadedChunks });
  if (hasChunk) transaction.objectStore('chunks').put({ sessionId: id, chunkNum: 1, startedAt: '2026-09-24T12:00:00.000Z', audio: new NodeBlob(['audio'], { type: 'audio/webm' }) });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function savePendingMultiChunks(id: string, ownerUserId?: string, chunkCount = 2, uploadedChunks = 0): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(['sessions', 'chunks'], 'readwrite');
  transaction.objectStore('sessions').put({ id, ownerUserId, startedAt: '2026-09-24T12:00:00.000Z', status: 'stopped', uploadedChunks });
  for (let i = 1; i <= chunkCount; i++) {
    transaction.objectStore('chunks').put({
      sessionId: id,
      chunkNum: i,
      startedAt: '2026-09-24T12:00:00.000Z',
      chunkStartedAt: `2026-09-24T12:00:${String(i * 10).padStart(2, '0')}.000Z`,
      audio: new NodeBlob([`audio-chunk-${i}`], { type: 'audio/webm' }),
    });
  }
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function storedSessions(): Promise<Array<{ id: string; ownerUserId?: string; uploadedChunks?: number; status?: string }>> {
  const db = await openDatabase();
  const transaction = db.transaction('sessions', 'readonly');
  const request = transaction.objectStore('sessions').getAll();
  const result = await new Promise<Array<{ id: string; ownerUserId?: string; uploadedChunks?: number; status?: string }>>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function storedChunks(): Promise<Array<{ sessionId: string; chunkNum: number; startedAt: string; chunkStartedAt?: string }>> {
  const db = await openDatabase();
  const transaction = db.transaction('chunks', 'readonly');
  const request = transaction.objectStore('chunks').getAll();
  const result = await new Promise<Array<{ sessionId: string; chunkNum: number; startedAt: string; chunkStartedAt?: string }>>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

describe('browser recording ownership and account isolation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockImplementation(async (path) => path === '/api/auth/me'
      ? { id: localStorage.getItem('brain-core:active-user-id') }
      : { status: 'stored' });
    localStorage.clear();
    const db = await openDatabase();
    db.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });

  it('preserva o áudio de A sem enviá-lo quando B entra na mesma origem', async () => {
    await savePending(sessionA, 'user-a');
    localStorage.setItem('brain-core:active-user-id', 'user-b');

    await browserRecording.recover();

    expect(apiRequest).not.toHaveBeenCalled();
    expect((await storedSessions()).map((entry) => entry.id)).toEqual([sessionA]);
    expect(browserRecording.getState().pending).toBe(0);
  });

  it('envia apenas as gravações da conta ativa e conclui na mesma conta', async () => {
    await savePending(sessionA, 'user-a');
    await savePending(sessionB, 'user-b');
    localStorage.setItem('brain-core:active-user-id', 'user-b');

    await browserRecording.recover();

    const calls = mutationCalls();
    expect(calls).toHaveLength(2);
    expect(calls.every((path) => path.includes(sessionB) && path.includes('owner_user_id=user-b'))).toBe(true);
    expect((await storedSessions()).map((entry) => entry.id)).toEqual([sessionA]);

    localStorage.setItem('brain-core:active-user-id', 'user-a');
    await browserRecording.recover();
    expect((await storedSessions())).toEqual([]);
  });

  it('permite que a conta de origem recupere e conclua a gravação após alternância de contas', async () => {
    await savePending(sessionA, 'user-a');

    // Usuário B entra: não envia nada de A
    localStorage.setItem('brain-core:active-user-id', 'user-b');
    await browserRecording.recover();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(browserRecording.getState().pending).toBe(0);

    // Usuário A retorna: recupera e conclui na conta A
    localStorage.setItem('brain-core:active-user-id', 'user-a');
    await browserRecording.recover();
    expect(mutationCalls()).toHaveLength(2); // chunk + complete
    expect(mutationCalls().every((url) => url.includes('owner_user_id=user-a'))).toBe(true);
    expect((await storedSessions())).toEqual([]);
    expect((await storedChunks())).toEqual([]);
  });

  it('interrompe o envio se a conta mudar durante o upload de blocos e preserva os dados para a conta de origem', async () => {
    await savePendingMultiChunks(sessionA, 'user-a', 2, 0);
    localStorage.setItem('brain-core:active-user-id', 'user-a');

    // Quando o primeiro chunk for enviado, a conta é trocada para user-b
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === '/api/auth/me') return { id: localStorage.getItem('brain-core:active-user-id') };
      if (String(path).includes('/chunks?')) localStorage.setItem('brain-core:active-user-id', 'user-b');
      return { status: 'stored' };
    });

    await browserRecording.recover();

    // Apenas o primeiro chunk deve ter sido enviado sob a conta user-a
    expect(mutationCalls()).toHaveLength(1);
    const firstCallUrl = mutationCalls()[0];
    expect(firstCallUrl).toContain('owner_user_id=user-a');
    expect(firstCallUrl).toContain('chunk_num=1');

    // O segundo chunk e a sessão devem permanecer preservados no IndexedDB sob a conta user-a
    const sessions = await storedSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].ownerUserId).toBe('user-a');
    expect(sessions[0].uploadedChunks).toBe(0);

    const chunks = await storedChunks();
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.chunkNum)).toEqual([1, 2]);

    // Sob a conta B, nada é enviado
    await browserRecording.recover();
    expect(mutationCalls()).toHaveLength(1);

    // Quando a conta A retorna, o segundo chunk e a conclusão são finalizados com sucesso
    localStorage.setItem('brain-core:active-user-id', 'user-a');
    vi.mocked(apiRequest).mockImplementation(async (path) => path === '/api/auth/me'
      ? { id: localStorage.getItem('brain-core:active-user-id') }
      : { status: 'stored' });
    await browserRecording.recover();

    expect(mutationCalls()).toHaveLength(4); // first attempt, two idempotent chunks, complete
    expect((await storedSessions())).toEqual([]);
    expect((await storedChunks())).toEqual([]);
  });

  it('mantém a gravação intacta no IndexedDB após falha de rede e a recupera quando o servidor volta', async () => {
    await savePending(sessionA, 'user-a');
    localStorage.setItem('brain-core:active-user-id', 'user-a');

    // Falha de rede no envio do chunk
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network error / PC offline'));

    await browserRecording.recover();

    // Dados continuam íntegros no IndexedDB
    expect((await storedSessions()).map((s) => s.id)).toEqual([sessionA]);
    expect((await storedChunks()).map((c) => c.sessionId)).toEqual([sessionA]);
    expect(browserRecording.getState().pending).toBe(2);

    // Servidor voltou a responder
    vi.mocked(apiRequest).mockImplementation(async (path) => path === '/api/auth/me'
      ? { id: localStorage.getItem('brain-core:active-user-id') }
      : { status: 'stored' });
    await browserRecording.retry();

    expect((await storedSessions())).toEqual([]);
    expect((await storedChunks())).toEqual([]);
    expect(browserRecording.getState().pending).toBe(0);
  });

  it('não envia áudio quando a conta autenticada diverge da conta local', async () => {
    await savePending(sessionA, 'user-a');
    localStorage.setItem('brain-core:active-user-id', 'user-a');
    vi.mocked(apiRequest).mockImplementation(async (path) => path === '/api/auth/me'
      ? { id: 'user-b' }
      : { status: 'stored' });

    await browserRecording.recover();

    expect(mutationCalls()).toEqual([]);
    expect((await storedSessions()).map((entry) => entry.id)).toEqual([sessionA]);
    expect((await storedChunks()).map((entry) => entry.sessionId)).toEqual([sessionA]);
  });

  it('preserva uma conclusão em trânsito quando a conta muda e a repete ao retornar', async () => {
    await savePending(sessionA, 'user-a', 1, false);
    localStorage.setItem('brain-core:active-user-id', 'user-a');
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === '/api/auth/me') return { id: 'user-a' };
      localStorage.setItem('brain-core:active-user-id', 'user-b');
      return { status: 'processing' };
    });

    await browserRecording.recover();
    expect(mutationCalls()).toHaveLength(1);
    expect(mutationCalls()[0]).toContain('/complete?owner_user_id=user-a');
    expect((await storedSessions()).map((entry) => entry.id)).toEqual([sessionA]);
    expect(browserRecording.getState().pending).toBe(0);

    localStorage.setItem('brain-core:active-user-id', 'user-a');
    vi.mocked(apiRequest).mockImplementation(async (path) => path === '/api/auth/me'
      ? { id: 'user-a' }
      : { status: 'processing' });
    await browserRecording.recover();
    expect(mutationCalls()).toHaveLength(2);
    expect((await storedSessions())).toEqual([]);
  });

  it('envia início da sessão e início real de cada bloco separadamente', async () => {
    await savePendingMultiChunks(sessionA, 'user-a');
    localStorage.setItem('brain-core:active-user-id', 'user-a');

    await browserRecording.recover();

    const firstChunk = new URLSearchParams(mutationCalls()[0].split('?')[1]);
    const secondChunk = new URLSearchParams(mutationCalls()[1].split('?')[1]);
    expect(firstChunk.get('started_at')).toBe('2026-09-24T12:00:00.000Z');
    expect(secondChunk.get('started_at')).toBe('2026-09-24T12:00:00.000Z');
    expect(firstChunk.get('chunk_started_at')).toBe('2026-09-24T12:00:10.000Z');
    expect(secondChunk.get('chunk_started_at')).toBe('2026-09-24T12:00:20.000Z');
  });

  it('não inventa início do bloco para gravações legadas', async () => {
    await savePending(sessionA, 'user-a');
    localStorage.setItem('brain-core:active-user-id', 'user-a');

    await browserRecording.recover();

    const chunk = new URLSearchParams(mutationCalls()[0].split('?')[1]);
    expect(chunk.get('started_at')).toBe('2026-09-24T12:00:00.000Z');
    expect(chunk.has('chunk_started_at')).toBe(false);
  });

  it('salva uma gravação ativa ao sair da conta sem enviar seus blocos para outra conta', async () => {
    const stopped = vi.fn();
    class FakeRecorder {
      static isTypeSupported = () => true;
      state = 'recording';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {}
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['recorded audio'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: stopped }] }),
    } });
    localStorage.setItem('brain-core:active-user-id', 'user-a');

    await browserRecording.start();
    expect(browserRecording.getState().phase).toBe('recording');
    window.dispatchEvent(new Event('brain-core:session-ended'));
    localStorage.setItem('brain-core:active-user-id', 'user-b');
    await vi.waitFor(() => expect(browserRecording.getState().phase).toBe('idle'));

    expect(stopped).toHaveBeenCalled();
    expect(mutationCalls()).toEqual([]);
    expect((await storedSessions())[0].ownerUserId).toBe('user-a');
    expect((await storedChunks())).toHaveLength(1);
    expect((await storedChunks())[0].chunkStartedAt).toBeTruthy();
    await browserRecording.recover();
    expect(mutationCalls()).toEqual([]);
  });

  it('mantém gravações antigas sem proprietário em quarentena', async () => {
    await savePending(sessionA);
    localStorage.setItem('brain-core:active-user-id', 'user-b');

    await browserRecording.recover();

    expect(apiRequest).not.toHaveBeenCalled();
    expect((await storedSessions()).map((entry) => entry.id)).toEqual([sessionA]);
    expect(browserRecording.getState().unassigned).toBe(2);
  });

  it('trata registros legados com upload terminado mas conclusão pendente como não atribuídos', async () => {
    // uploadedChunks = 2, sem blocos pendentes no IndexedDB, mas sem ownerUserId
    await savePending(sessionA, undefined, 2, false);
    localStorage.setItem('brain-core:active-user-id', 'user-a');

    await browserRecording.recover();

    // Não deve enviar /complete automaticamente para user-a
    expect(apiRequest).not.toHaveBeenCalled();
    expect((await storedSessions()).map((s) => s.id)).toEqual([sessionA]);
    expect(browserRecording.getState().unassigned).toBe(1);

    // Atribuição explícita valida e conclui a sessão
    await browserRecording.claimUnassigned();
    expect(mutationCalls()).toHaveLength(2); // claim + complete
    expect((await storedSessions())).toEqual([]);
    expect(browserRecording.getState().unassigned).toBe(0);
  });

  it('só atribui gravações antigas após uma ação explícita', async () => {
    await savePending(sessionA);
    localStorage.setItem('brain-core:active-user-id', 'user-b');

    await browserRecording.recover();
    expect(apiRequest).not.toHaveBeenCalled();
    await browserRecording.claimUnassigned();

    expect(mutationCalls()).toHaveLength(3);
    expect((await storedSessions())).toEqual([]);
  });

  it('conclui uma sessão antiga com upload parcial depois de validar o proprietário no servidor', async () => {
    await savePending(sessionA, undefined, 1, false);
    localStorage.setItem('brain-core:active-user-id', 'user-a');

    await browserRecording.claimUnassigned();

    const paths = mutationCalls();
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('/claim?owner_user_id=user-a');
    expect(paths[1]).toContain('/complete?owner_user_id=user-a');
    expect((await storedSessions())).toEqual([]);
  });

  it('preserva uma sessão antiga quando o servidor a reconhece como pertencente a outra conta', async () => {
    await savePending(sessionA, undefined, 1, false);
    localStorage.setItem('brain-core:active-user-id', 'user-b');
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('API 409: outra conta'));

    await expect(browserRecording.claimUnassigned()).rejects.toThrow('outra conta');

    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(1);
    expect((await storedSessions()).map((entry) => entry.id)).toEqual([sessionA]);
  });

  it('abandona a captura se a conta mudar enquanto o microfone pede permissão', async () => {
    let resolveMicrophone!: (stream: MediaStream) => void;
    const stopped = vi.fn();
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { resolveMicrophone = resolve; }));
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    localStorage.setItem('brain-core:active-user-id', 'user-a');

    const starting = browserRecording.start();
    localStorage.setItem('brain-core:active-user-id', 'user-b');
    resolveMicrophone({ getTracks: () => [{ stop: stopped }] } as unknown as MediaStream);

    await expect(starting).rejects.toThrow('A conta mudou');
    expect(stopped).toHaveBeenCalledOnce();
    expect((await storedSessions())).toEqual([]);
  });
});
