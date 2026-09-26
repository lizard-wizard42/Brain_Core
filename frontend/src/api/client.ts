// BASE_URL é o base path do Vite (/ em LAN e Tailnet)
// Garante prefixo correto tanto para API quanto para redirects
import type { InfiniteDoc, TiptapDoc } from '../types';
import { clearBrowserSession, prepareBrowserSession } from './browserSession';

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, ''); // ex: "" ou "/brain"
// Host absoluto do backend — necessário porque front (8001) e backend (3001)
// são serviços/portas separados sem mais um nginx unificando os dois em um só
// origin. Vazio quando servidos atrás de um proxy que já une tudo (ex: /brain/).
const API_HOST = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
// Uploads devem respeitar o base path quando servidos via gateway (/brain)
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';

const AUTH_HINT_KEY = 'brain-core:session-hint';

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function setSessionHint(): void {
  const storage = getSessionStorage();
  storage?.setItem(AUTH_HINT_KEY, '1');
}

function clearSessionHint(): void {
  const storage = getSessionStorage();
  storage?.removeItem(AUTH_HINT_KEY);
}

export function invalidateLocalSession(): void {
  clearSessionHint();
  clearBrowserSession();
}

export function hasSessionHint(): boolean {
  const storage = getSessionStorage();
  return storage?.getItem(AUTH_HINT_KEY) === '1';
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_HOST}${BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    if (res.status === 401) {
      invalidateLocalSession();
      window.location.href = `${BASE_URL}/login`;
    }
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const request = apiRequest;
// Revisions are scoped to the current browser session. A stale save receives 409.
const pageRevisions = new Map<string, number>();
async function readPageRevision(id: string): Promise<number> {
  const cached = pageRevisions.get(id);
  if (cached !== undefined) return cached;
  const page = await request<import('../types').Page>(`/api/pages/${id}`);
  pageRevisions.set(id, page.revision);
  return page.revision;
}
async function writePageRevision(id: string, method: 'PUT' | 'PATCH', body: object, keepalive?: boolean) {
  const revision = await readPageRevision(id);
  const page = await request<import('../types').Page>(`/api/pages/${id}`, {
    method, body: JSON.stringify({ ...body, revision }), keepalive,
  });
  pageRevisions.set(id, page.revision);
  return page;
}


/** True when a page save was rejected because someone else saved a newer revision (HTTP 409). */
export function isRevisionConflict(error: unknown): boolean {
  return /API 409\b/.test(String(error));
}

export function isNotFoundError(error: unknown): boolean {
  return /API 404\b/.test(String(error));
}

const BASE_UPLOAD = API_HOST ? `${API_HOST}${BASE_URL}` : (ORIGIN ? `${ORIGIN}${BASE_URL}` : BASE_URL);

/** Absolute backend URL for media elements that cannot use the fetch wrapper. */
export function apiUrl(path: string): string {
  return `${BASE_UPLOAD}${path}`;
}

export interface PersistedTerminalTab {
  request_key: string;
  title: string;
  cwd: string | null;
  is_active: boolean;
  last_seen_at: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'member';
  telegram_chat_id: string | null;
  telegram_notifications_enabled: boolean;
  two_factor_enabled: boolean;
  two_factor_setup_pending: boolean;
}

export interface MobileDevice {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface LoginSuccessResponse {
  requiresTwoFactor: false;
  expiresIn: string;
  user: AuthenticatedUser;
}

export interface LoginTwoFactorPendingResponse {
  requiresTwoFactor: true;
  pendingToken: string;
  expiresIn: string;
}

export interface InitialSetupStatus {
  setupRequired: boolean;
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────
  login: async (email: string, password: string): Promise<LoginSuccessResponse | LoginTwoFactorPendingResponse> => {
    const res = await fetch(`${API_HOST}${BASE_URL}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Credenciais inválidas');
    }
    const data = await res.json() as LoginSuccessResponse | LoginTwoFactorPendingResponse;
    if (!data.requiresTwoFactor) {
      prepareBrowserSession(data.user.id);
      setSessionHint();
    }
    return data;
  },

  getInitialSetupStatus: () => request<InitialSetupStatus>('/api/auth/setup'),

  completeInitialSetup: async (name: string, email: string, password: string): Promise<{ user: AuthenticatedUser; expiresIn: string }> => {
    const res = await fetch(`${API_HOST}${BASE_URL}/api/auth/setup`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Não foi possível concluir a configuração inicial');
    }
    const data = await res.json() as { user: AuthenticatedUser; expiresIn: string };
    prepareBrowserSession(data.user.id);
    setSessionHint();
    return data;
  },

  verifyLoginTwoFactor: async (pendingToken: string, code: string, rememberDevice = true): Promise<LoginSuccessResponse> => {
    const res = await fetch(`${API_HOST}${BASE_URL}/api/auth/login-2fa`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingToken, code, rememberDevice }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Código 2FA inválido');
    }
    const data = await res.json() as LoginSuccessResponse;
    prepareBrowserSession(data.user.id);
    setSessionHint();
    return data;
  },

  logout: async () => {
    const res = await fetch(`${API_HOST}${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok && res.status !== 401) throw new Error(`Não foi possível sair (HTTP ${res.status}).`);
    invalidateLocalSession();
  },

  getMe: () =>
    request<CurrentUser>('/api/auth/me'),

  listMobileDevices: () =>
    request<{ devices: MobileDevice[] }>('/api/mobile/devices'),

  revokeMobileDevice: (deviceId: string) =>
    request<{ revoked: boolean }>(`/api/mobile/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),

  changePassword: async (currentPassword: string, newPassword: string) => {
    const data = await request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return data;
  },

  updateTelegramSettings: (telegramChatId: string, telegramNotificationsEnabled: boolean) =>
    request<CurrentUser>('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ telegramChatId, telegramNotificationsEnabled }),
    }),

  beginTwoFactorSetup: (currentPassword: string) =>
    request<{ secret: string; otpauthUri: string }>('/api/auth/2fa/setup', {
      method: 'POST',
      body: JSON.stringify({ currentPassword }),
    }),

  confirmTwoFactorSetup: (code: string) =>
    request<{ ok: boolean; two_factor_enabled: boolean; two_factor_setup_pending: boolean }>('/api/auth/2fa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  disableTwoFactor: (currentPassword: string, code: string) =>
    request<{ ok: boolean; two_factor_enabled: boolean; two_factor_setup_pending: boolean }>('/api/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, code }),
    }),

  isAuthenticated: () => hasSessionHint(),

  // ── Pages ───────────────────────────────────────────────────────────────
  getTree: () =>
    request<{ pages: import('../types').PageSummary[] }>('/api/folders'),

  getPage: async (id: string) => {
    const page = await request<import('../types').Page>(`/api/pages/${id}`);
    pageRevisions.set(id, page.revision);
    return page;
  },

  getSharedPages: (direction: 'received' | 'sent') =>
    request<import('../types').SharedPageSummary[]>(`/api/pages/shared?direction=${direction}`),

  getPageGrants: (id: string) =>
    request<import('../types').PageGrant[]>(`/api/pages/${id}/grants`),

  setPageGrant: (id: string, userId: string, role: 'editor' | 'viewer') =>
    request<import('../types').PageGrant>(`/api/pages/${id}/grants/${userId}`, {
      method: 'PUT', body: JSON.stringify({ role }),
    }),

  removePageGrant: (id: string, userId: string) =>
    request<{ revoked: boolean }>(`/api/pages/${id}/grants/${userId}`, { method: 'DELETE' }),

  // ── Contacts (pedidos de amizade entre usuários Brain Core) ─────────────
  listContacts: () =>
    request<import('../types').ContactLists>('/api/contacts'),

  requestContact: (email: string) =>
    request<import('../types').ContactSummary>('/api/contacts', {
      method: 'POST', body: JSON.stringify({ email }),
    }),

  acceptContact: (id: string) =>
    request<{ accepted: boolean }>(`/api/contacts/${id}/accept`, { method: 'POST' }),

  removeContact: (id: string) =>
    request<{ removed: boolean }>(`/api/contacts/${id}`, { method: 'DELETE' }),

  getSubPages: (id: string) =>
    request<import('../types').PageSummary[]>(`/api/pages/${id}/subpages`),

  getSubPagesFiltered: (id: string, filters?: { status?: string; tag?: string; due_from?: string; due_to?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.tag) params.set('tag', filters.tag);
    if (filters?.due_from) params.set('due_from', filters.due_from);
    if (filters?.due_to) params.set('due_to', filters.due_to);
    const qs = params.toString();
    return request<import('../types').PageSummary[]>(`/api/pages/${id}/subpages${qs ? `?${qs}` : ''}`);
  },

  getReferences: (id: string) =>
    request<import('../types').PageReferences>(`/api/pages/${id}/references`),

  getPageVersions: (id: string, limit = 30) =>
    request<{ versions: import('../types').PageVersion[] }>(`/api/pages/${id}/versions?limit=${Math.max(1, Math.min(100, limit))}`),

  restorePageVersion: (id: string, versionId: string) =>
    request<import('../types').Page>(`/api/pages/${id}/versions/${versionId}/restore`, { method: 'POST' }),

  createPage: (body: { parent_page_id?: string | null; title: string; slug: string; is_section?: boolean; type?: 'note' | 'infinite' }) =>
    request<import('../types').Page>('/api/pages', { method: 'POST', body: JSON.stringify(body) }),

  savePage: (id: string, body: { content: TiptapDoc | InfiniteDoc; title?: string }, options?: { keepalive?: boolean }) =>
    writePageRevision(id, 'PUT', body, options?.keepalive),

  deletePage: (id: string) =>
    request<{ deleted: boolean }>(`/api/pages/${id}`, { method: 'DELETE' }),

  renamePage: (id: string, title: string) => writePageRevision(id, 'PATCH', { title }),

  patchPage: (id: string, data: { icon?: string; cover_url?: string | null; cover_position_y?: number; title?: string; sort_order?: number; parent_page_id?: string | null; status?: string | null; due_date?: string | null; tags?: string[]; working_directory?: string | null; content?: TiptapDoc | InfiniteDoc }) =>
    writePageRevision(id, 'PATCH', data),

  uploadCover: async (id: string, file: File): Promise<import('../types').Page> => {
    const formData = new FormData();
    formData.append('cover', file);
    const res = await fetch(`${BASE_UPLOAD}/api/pages/${id}/cover`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },

  removeCover: (id: string) =>
    request<import('../types').Page>(`/api/pages/${id}/cover`, { method: 'DELETE' }),

  coverUrl: (path: string) => `${BASE_UPLOAD}${path}`,

  getTrash: () =>
    request<import('../types').PageSummary[]>('/api/pages/trash'),

  restorePage: (id: string) =>
    request<import('../types').Page>(`/api/pages/${id}/restore`, { method: 'POST' }),

  permanentDeletePage: (id: string) =>
    request<{ deleted: boolean }>(`/api/pages/${id}/permanent`, { method: 'DELETE' }),

  emptyTrash: () =>
    request<{ deleted: boolean }>('/api/pages/trash', { method: 'DELETE' }),

  uploadImage: async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(`${API_HOST}${BASE_URL}/api/upload/image`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const data = await res.json() as { url: string };
    return data.url;
  },

  uploadFile: async (file: File): Promise<{ url: string; name: string; size: number; mimeType: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_HOST}${BASE_URL}/api/upload/file`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let message = `Upload failed: ${res.status}`;
      try {
        const data = JSON.parse(raw) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        if (raw) message = `${message} - ${raw}`;
      }
      throw new Error(message);
    }
    const data = await res.json() as { url: string; name: string; size: number; mimeType: string };
    return data;
  },

  listCustomEmojis: async (): Promise<import('../types').CustomEmoji[]> => {
    const data = await request<{ emojis: import('../types').CustomEmoji[] }>('/api/emojis/custom');
    return data.emojis.map(emoji => ({
      ...emoji,
      url: emoji.url.startsWith('http') ? emoji.url : `${BASE_URL}${emoji.url}`,
    }));
  },

  uploadCustomEmoji: async (file: File, name?: string): Promise<import('../types').CustomEmoji> => {
    const formData = new FormData();
    formData.append('emoji', file);
    if (name?.trim()) formData.append('name', name.trim());

    const res = await fetch(`${API_HOST}${BASE_URL}/api/emojis/custom`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new Error(raw || `Upload de emoji falhou: ${res.status}`);
    }
    const data = await res.json() as import('../types').CustomEmoji;
    return {
      ...data,
      url: data.url.startsWith('http') ? data.url : `${BASE_URL}${data.url}`,
    };
  },

  listTerminalTabs: () =>
    request<{ tabs: PersistedTerminalTab[] }>('/api/terminal/tabs'),

  upsertTerminalTab: (body: { requestKey: string; title: string; cwd?: string | null; isActive?: boolean }) =>
    request<{ ok: boolean }>('/api/terminal/tabs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  closeTerminalTab: (requestKey: string) =>
    request<{ closed: string[] }>(`/api/terminal/tabs/${encodeURIComponent(requestKey)}`, {
      method: 'DELETE',
    }),

  listRememberNotes: () =>
    request<{ notes: import('../types').RememberNote[] }>('/api/remember'),

  getPcAudioRetention: () =>
    request<{ automatic: boolean; days: number }>('/api/remember/audio-retention'),
  setPcAudioRetention: (automatic: boolean, days: number) =>
    request<{ automatic: boolean; days: number }>('/api/remember/audio-retention', {
      method: 'PUT', body: JSON.stringify({ automatic, days }),
    }),
  previewPcAudioCleanup: (days: number) =>
    request<{ files: number; bytes: number }>(`/api/remember/audio-retention/preview?days=${days}`),
  cleanPcAudio: (days: number) =>
    request<{ files: number; bytes: number }>('/api/remember/audio-retention/cleanup', {
      method: 'POST', body: JSON.stringify({ days }),
    }),
  getTranscriptionPolicy: () =>
    request<{ mode: 'automatic' | 'scheduled' | 'manual'; start_time: string; window_hours: number; timezone: string; manual_active: number; paused: number }>('/api/remember/transcription-policy'),
  setTranscriptionPolicy: (body: { mode: 'automatic' | 'scheduled' | 'manual'; start_time: string; window_hours: number; timezone: string }) =>
    request<{ mode: 'automatic' | 'scheduled' | 'manual'; start_time: string; window_hours: number; timezone: string; manual_active: number; paused: number }>('/api/remember/transcription-policy', {
      method: 'PUT', body: JSON.stringify(body),
    }),
  runTranscriptionNow: () =>
    request<{ manual_active: number; paused: number }>('/api/remember/transcription-policy/run', { method: 'POST' }),
  pauseTranscription: () =>
    request<{ manual_active: number; paused: number }>('/api/remember/transcription-policy/pause', { method: 'POST' }),

  createRememberNote: (body: {
    title: string;
    body: string;
    color: import('../types').RememberNote['color'];
    checklist: import('../types').RememberChecklistItem[];
    tags: string[];
    reminder_date?: string | null;
    reminder_time?: string | null;
    reminder_label?: string | null;
    reminder_repeat_daily?: boolean;
  }) =>
    request<import('../types').RememberNote>('/api/remember', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateRememberNote: (id: string, body: {
    title: string;
    body: string;
    color: import('../types').RememberNote['color'];
    checklist: import('../types').RememberChecklistItem[];
    tags: string[];
    reminder_date?: string | null;
    reminder_time?: string | null;
    reminder_label?: string | null;
    reminder_repeat_daily?: boolean;
  }) =>
    request<import('../types').RememberNote>(`/api/remember/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteRememberNote: (id: string) =>
    request<{ deleted: boolean }>(`/api/remember/${id}`, {
      method: 'DELETE',
    }),
};
