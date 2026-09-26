import { celtwoRequest } from '../remember/celtwoClient';

export const PC_RETENTION_DAYS = [30, 90, 180, 365] as const;
export interface AudioRetentionPolicy { automatic: boolean; days: number }
export interface AudioCleanupStats { files: number; bytes: number }

function path(userId: string): string {
  return `/api/v1/audio-retention/${encodeURIComponent(userId)}`;
}

export function getPcAudioRetention(userId: string): Promise<AudioRetentionPolicy> {
  return celtwoRequest<AudioRetentionPolicy>(path(userId));
}

export function putPcAudioRetention(userId: string, body: AudioRetentionPolicy): Promise<AudioRetentionPolicy> {
  return celtwoRequest<AudioRetentionPolicy>(path(userId), { method: 'PUT', body: JSON.stringify(body) });
}

export function previewPcAudioCleanup(userId: string, days: number): Promise<AudioCleanupStats> {
  return celtwoRequest<AudioCleanupStats>(`${path(userId)}/preview?days=${days}`);
}

export function runPcAudioCleanup(userId: string, days: number): Promise<AudioCleanupStats> {
  return celtwoRequest<AudioCleanupStats>(`${path(userId)}/cleanup?days=${days}`, { method: 'POST' });
}
