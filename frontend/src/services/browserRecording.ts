import { apiRequest } from '../api/client';
import { activeBrowserUserId } from '../api/browserSession';

type Phase = 'idle' | 'recording' | 'saving';
interface SessionRecord { id: string; startedAt: string; status: 'recording' | 'stopped'; uploadedChunks: number; ownerUserId?: string }
interface ChunkRecord { sessionId: string; chunkNum: number; startedAt: string; chunkStartedAt?: string; audio: Blob }
export interface BrowserRecordingState { phase: Phase; startedAt: string | null; message: string | null; pending: number; unassigned: number }

const DATABASE = 'brain-core-browser-recordings';
const CHUNK_MS = 30_000;
const listeners = new Set<(state: BrowserRecordingState) => void>();
let state: BrowserRecordingState = { phase: 'idle', startedAt: null, message: null, pending: 0, unassigned: 0 };
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let session: SessionRecord | null = null;
let chunkNum = 0;
let chunkStartedAt = '';
let timer: number | null = null;
let rotation: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
let starting = false;
let accountGeneration = 0;
let sessionGeneration = 0;

function publish(next: Partial<BrowserRecordingState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener(state));
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('sessions', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: ['sessionId', 'chunkNum'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll<T>(store: string): Promise<T[]> {
  const db = await openDatabase();
  try { return await requestResult(db.transaction(store, 'readonly').objectStore(store).getAll()) as T[]; }
  finally { db.close(); }
}

async function put(store: string, value: SessionRecord | ChunkRecord): Promise<void> {
  const db = await openDatabase();
  try { await requestResult(db.transaction(store, 'readwrite').objectStore(store).put(value)); }
  finally { db.close(); }
}

async function remove(store: string, key: string | [string, number]): Promise<void> {
  const db = await openDatabase();
  try { await requestResult(db.transaction(store, 'readwrite').objectStore(store).delete(key)); }
  finally { db.close(); }
}

async function refreshPending() {
  const chunks = await readAll<ChunkRecord>('chunks');
  const sessions = await readAll<SessionRecord>('sessions');
  const owner = activeBrowserUserId();
  const sessionMap = new Map(sessions.map((entry) => [entry.id, entry]));

  const ownedSessionIds = new Set(
    owner ? sessions.filter((entry) => entry.ownerUserId && entry.ownerUserId === owner).map((entry) => entry.id) : []
  );

  const ownedChunksCount = owner
    ? chunks.filter((entry) => ownedSessionIds.has(entry.sessionId)).length
    : 0;
  const ownedStoppedSessionsCount = owner
    ? sessions.filter((entry) => entry.ownerUserId === owner && entry.status === 'stopped').length
    : 0;

  const unassignedChunksCount = chunks.filter((entry) => {
    const s = sessionMap.get(entry.sessionId);
    return !s || !s.ownerUserId;
  }).length;

  const unassignedSessionsCount = sessions.filter(
    (entry) => !entry.ownerUserId && ((entry.uploadedChunks || 0) > 0 || chunks.some((chunk) => chunk.sessionId === entry.id))
  ).length;

  publish({
    pending: ownedChunksCount + ownedStoppedSessionsCount,
    unassigned: unassignedChunksCount + unassignedSessionsCount,
  });
}

async function authenticatedOwner(ownerUserId: string, generation: number): Promise<boolean> {
  if (accountGeneration !== generation || activeBrowserUserId() !== ownerUserId) return false;
  const user = await apiRequest<{ id: string }>('/api/auth/me');
  return accountGeneration === generation && activeBrowserUserId() === ownerUserId && user.id === ownerUserId;
}

async function performFlush(): Promise<void> {
  const ownerUserId = activeBrowserUserId();
  if (!ownerUserId) return;
  const generation = accountGeneration;
  const current = () => accountGeneration === generation && activeBrowserUserId() === ownerUserId;

  const chunks = await readAll<ChunkRecord>('chunks');
  chunks.sort((a, b) =>
    (a.chunkStartedAt || a.startedAt).localeCompare(b.chunkStartedAt || b.startedAt) || a.chunkNum - b.chunkNum);
  for (const chunk of chunks) {
    if (!current()) return;
    const saved = (await readAll<SessionRecord>('sessions')).find((entry) => entry.id === chunk.sessionId);
    if (saved?.ownerUserId !== ownerUserId) continue;
    if (!await authenticatedOwner(ownerUserId, generation)) return;

    const params = new URLSearchParams({
      session_id: chunk.sessionId,
      chunk_num: String(chunk.chunkNum),
      started_at: saved.startedAt,
      owner_user_id: ownerUserId,
    });
    if (chunk.chunkStartedAt) params.set('chunk_started_at', chunk.chunkStartedAt);
    await apiRequest(`/api/remember/memory/browser/chunks?${params}`, {
      method: 'POST',
      body: chunk.audio,
      headers: { 'Content-Type': chunk.audio.type.split(';')[0] || 'audio/webm' },
    });
    // A successful response may arrive after an account switch. Keep the local
    // copy so the original account can safely retry an idempotent upload.
    if (!current()) return;
    await put('sessions', { ...saved, uploadedChunks: (saved.uploadedChunks || 0) + 1 });
    await remove('chunks', [chunk.sessionId, chunk.chunkNum]);
    await refreshPending();
  }

  for (const saved of await readAll<SessionRecord>('sessions')) {
    if (!current()) return;
    if (saved.status !== 'stopped' || saved.ownerUserId !== ownerUserId) continue;
    const remainingChunks = await readAll<ChunkRecord>('chunks');
    if (remainingChunks.some((chunk) => chunk.sessionId === saved.id)) continue;
    if (!await authenticatedOwner(ownerUserId, generation)) return;

    const params = new URLSearchParams({ owner_user_id: ownerUserId });
    await apiRequest(`/api/remember/memory/browser/sessions/${saved.id}/complete?${params}`, { method: 'POST' });
    if (!current()) return;
    await remove('sessions', saved.id);
  }
  await refreshPending();
}

function flush(): Promise<void> {
  const previous = flushing;
  const next = (async () => {
    if (previous) {
      try { await previous; } catch { /* A later retry may succeed. */ }
    }
    try { await performFlush(); }
    finally { await refreshPending(); }
  })();
  flushing = next;
  const clear = () => { if (flushing === next) flushing = null; };
  void next.then(clear, clear);
  return next;
}

function audioType(): string {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
  throw new Error('Este navegador não oferece gravação de áudio compatível.');
}

function startChunk() {
  if (!stream || !session) return;
  if (sessionGeneration !== accountGeneration || session.ownerUserId !== activeBrowserUserId()) {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    const currentSession = session;
    session = null;
    void put('sessions', { ...currentSession, status: 'stopped' }).then(refreshPending);
    publish({ phase: 'idle', startedAt: null, message: 'A gravação foi interrompida porque a conta mudou. O áudio salvo permanece neste navegador.' });
    return;
  }
  chunkNum += 1;
  chunkStartedAt = new Date().toISOString();
  recorder = new MediaRecorder(stream, { mimeType: audioType() });
  recorder.start();
  timer = window.setTimeout(() => {
    rotation = rotate();
    void rotation.catch(async (error) => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (session) {
        try { await put('sessions', { ...session, status: 'stopped' }); } catch { /* report below */ }
      }
      session = null;
      publish({ phase: 'idle', startedAt: null, message: `Gravação interrompida: ${String(error)}. Verifique o áudio pendente.` });
    });
  }, CHUNK_MS);
}

function finishChunk(): Promise<ChunkRecord | null> {
  const active = recorder;
  recorder = null;
  if (!active || active.state === 'inactive' || !session) return Promise.resolve(null);
  const currentSession = session;
  const currentNum = chunkNum;
  const startedAt = chunkStartedAt;
  return new Promise((resolve, reject) => {
    const blobs: Blob[] = [];
    active.ondataavailable = (event) => { if (event.data.size) blobs.push(event.data); };
    active.onerror = () => reject(new Error('O gravador do navegador falhou.'));
    active.onstop = () => {
      const audio = new Blob(blobs, { type: active.mimeType });
      resolve(audio.size ? { sessionId: currentSession.id, chunkNum: currentNum,
        startedAt: currentSession.startedAt, chunkStartedAt: startedAt, audio } : null);
    };
    active.stop();
  });
}

async function rotate() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (!session) return;
  const owner = session.ownerUserId;
  const chunk = await finishChunk();
  if (chunk) {
    await put('chunks', chunk);
    await refreshPending();
  }
  if (sessionGeneration !== accountGeneration || activeBrowserUserId() !== owner) {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (session) {
      await put('sessions', { ...session, status: 'stopped' });
    }
    session = null;
    await refreshPending();
    publish({ phase: 'idle', startedAt: null, message: 'A gravação foi interrompida porque a conta mudou. O áudio salvo permanece neste navegador.' });
    return;
  }
  if (state.phase === 'recording') startChunk();
  void flush().catch(() => publish({ message: 'Áudio salvo neste navegador; o envio será tentado novamente.' }));
}

export const browserRecording = {
  getState: () => state,
  subscribe(listener: (next: BrowserRecordingState) => void) {
    listeners.add(listener);
    listener(state);
    return () => { listeners.delete(listener); };
  },
  async recover() {
    if (state.phase !== 'idle') return;
    const currentUserId = activeBrowserUserId();
    if (!currentUserId) {
      await refreshPending();
      return;
    }
    let lostFinalPart = false;
    for (const saved of await readAll<SessionRecord>('sessions')) {
      if (saved.status !== 'recording' || !saved.ownerUserId || saved.ownerUserId !== currentUserId) continue;
      const chunks = await readAll<ChunkRecord>('chunks');
      if (!chunks.some((chunk) => chunk.sessionId === saved.id) && !saved.uploadedChunks) {
        await remove('sessions', saved.id);
        lostFinalPart = true;
      } else {
        await put('sessions', { ...saved, status: 'stopped' });
      }
    }
    await refreshPending();
    if (state.pending) publish({ message: `${state.pending} item(ns) salvo(s) neste navegador. Tentando sincronizar…` });
    try {
      await flush();
      if (state.pending === 0 && activeBrowserUserId() === currentUserId) {
        publish({ message: lostFinalPart ? 'A última parte de uma gravação interrompida não pôde ser recuperada.' : null });
      }
    } catch {
      publish({ message: 'Áudio guardado neste navegador. Use “Reenviar áudio” quando o PC estiver acessível.' });
    }
  },
  async start() {
    if (state.phase !== 'idle' || starting) return;
    const ownerUserId = activeBrowserUserId();
    if (!ownerUserId) throw new Error('Entre na sua conta antes de gravar.');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('A gravação precisa de HTTPS ou localhost e de um navegador com acesso ao microfone.');
    }
    const mimeType = audioType();
    starting = true;
    let acquired: MediaStream;
    try { acquired = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (error) { starting = false; throw error; }
    try {
      if (ownerUserId !== activeBrowserUserId()) throw new Error('A conta mudou durante a permissão do microfone. Inicie outra gravação.');
      await openDatabase().then((db) => db.close());
      if (ownerUserId !== activeBrowserUserId()) throw new Error('A conta mudou durante o início da gravação.');
      stream = acquired;
      session = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), status: 'recording', uploadedChunks: 0, ownerUserId };
      sessionGeneration = accountGeneration;
      await put('sessions', session);
      if (ownerUserId !== activeBrowserUserId()) throw new Error('A conta mudou durante o início da gravação.');
      chunkNum = 0;
      new MediaRecorder(stream, { mimeType }); // Validate support before changing UI state.
      publish({ phase: 'recording', startedAt: session.startedAt, message: null });
      startChunk();
    } catch (error) {
      acquired.getTracks().forEach((track) => track.stop());
      stream = null;
      if (session) {
        try { await remove('sessions', session.id); } catch { /* ignore */ }
      }
      session = null;
      throw error;
    } finally {
      starting = false;
    }
  },
  async stop(saveOnly = false) {
    if (state.phase !== 'recording' || !session) return;
    const stoppedSession = session;
    const sessionOwner = stoppedSession.ownerUserId;
    const generation = accountGeneration;
    publish({ phase: 'saving', message: 'Salvando e enviando áudio…' });
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    let hadFinalAudio = false;
    try {
      if (rotation) await rotation;
      const chunk = await finishChunk();
      if (chunk) { await put('chunks', chunk); hadFinalAudio = true; }
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      const saved = (await readAll<SessionRecord>('sessions')).find((entry) => entry.id === stoppedSession.id);
      const savedChunks = await readAll<ChunkRecord>('chunks');
      const hasAudio = hadFinalAudio || savedChunks.some((entry) => entry.sessionId === stoppedSession.id)
        || (saved?.uploadedChunks || 0) > 0;
      if (!hasAudio) {
        await remove('sessions', stoppedSession.id);
        publish({ message: 'Nenhum áudio foi capturado. Tente gravar por alguns segundos.' });
      } else {
        await put('sessions', { ...(saved || stoppedSession), status: 'stopped' });
      }
      session = null;
      await refreshPending();
      publish({ phase: 'idle', startedAt: null });
      hadFinalAudio = hasAudio;
    }
    if (!hadFinalAudio) return;

    const currentUser = activeBrowserUserId();
    if (saveOnly || generation !== accountGeneration || !currentUser || currentUser !== sessionOwner) {
      publish({ message: 'Áudio salvo neste navegador para a conta que o gravou. Entre nela para concluir o envio.' });
      return;
    }

    try {
      await flush();
      const pendingSession = (await readAll<SessionRecord>('sessions')).some((entry) => entry.id === stoppedSession.id);
      publish({ message: pendingSession
        ? 'Áudio salvo neste navegador para a conta que o gravou. Entre nela para concluir o envio.'
        : 'Áudio enviado. A transcrição será processada no PC.' });
    } catch {
      publish({ message: 'Áudio salvo neste navegador. Use “Reenviar áudio” para concluir o envio.' });
    }
  },
  async retry() {
    await this.recover();
  },
  async claimUnassigned() {
    const ownerUserId = activeBrowserUserId();
    if (!ownerUserId) throw new Error('Entre na sua conta antes de atribuir gravações.');
    const chunks = await readAll<ChunkRecord>('chunks');
    let conflicts = 0;
    for (const saved of await readAll<SessionRecord>('sessions')) {
      if (activeBrowserUserId() !== ownerUserId) {
        throw new Error('A conta mudou durante a atribuição de gravações.');
      }
      if (saved.ownerUserId || (!saved.uploadedChunks && !chunks.some((chunk) => chunk.sessionId === saved.id))) continue;
      const params = new URLSearchParams({ owner_user_id: ownerUserId, started_at: saved.startedAt });
      try {
        await apiRequest(`/api/remember/memory/browser/sessions/${saved.id}/claim?${params}`, { method: 'POST' });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('API 409:')) { conflicts += 1; continue; }
        throw error;
      }
      if (activeBrowserUserId() !== ownerUserId) {
        throw new Error('A conta mudou durante a atribuição de gravações.');
      }
      await put('sessions', { ...saved, ownerUserId, status: 'stopped' });
    }
    await refreshPending();
    if (activeBrowserUserId() === ownerUserId) {
      await flush();
    }
    if (conflicts) throw new Error(`${conflicts} gravação(ões) já pertencem a outra conta e permaneceram preservadas neste navegador.`);
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('brain-core:session-ended', () => {
    accountGeneration += 1;
    if (state.phase === 'recording') void browserRecording.stop(true).catch(() => {
      publish({ message: 'A gravação foi interrompida ao sair da conta. O áudio salvo permanece neste navegador.' });
    });
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'brain-core:active-user-id' && event.oldValue !== event.newValue) accountGeneration += 1;
  });
  window.addEventListener('beforeunload', (event) => {
    if (state.phase !== 'recording') return;
    event.preventDefault();
  });
  window.addEventListener('online', () => { void browserRecording.recover().catch(() => {
    publish({ message: 'Não foi possível verificar o áudio pendente neste navegador.' });
  }); });
}
