import { query } from '../config/database';
import { config } from '../config';
import { logError, logInfo, logWarn } from '../utils/logger';

let timer: NodeJS.Timeout | null = null;
let running = false;

function getRetentionDays(): number {
  const retentionDays = Number.isFinite(config.TRASH_RETENTION_DAYS)
    ? config.TRASH_RETENTION_DAYS
    : 30;
  return Math.max(1, Math.floor(retentionDays));
}

function getCleanupIntervalMs(): number {
  const intervalMs = Number.isFinite(config.TRASH_CLEANUP_INTERVAL_MS)
    ? config.TRASH_CLEANUP_INTERVAL_MS
    : 3_600_000;
  return Math.max(60_000, Math.floor(intervalMs));
}

async function purgeExpiredTrash(): Promise<void> {
  if (running) return;

  running = true;

  try {
    const retentionDays = getRetentionDays();
    const rows = await query<{ id: string }>(
      `DELETE FROM pages
       WHERE deleted_at IS NOT NULL
         AND deleted_at < NOW() - ($1::int * INTERVAL '1 day')
       RETURNING id`,
      [retentionDays],
    );

    if (rows.length > 0) {
      logInfo('trash.cleanup.completed', {
        deletedCount: rows.length,
        retentionDays,
      });
    }

    await purgeExpiredTrustedDevices();
  } catch (error) {
    logError('trash.cleanup.failed', {
      detail: String(error),
      retentionDays: getRetentionDays(),
    });
  } finally {
    running = false;
  }
}

async function purgeExpiredTrustedDevices(): Promise<void> {
  const rows = await query<{ id: string }>(
    `DELETE FROM trusted_devices
     WHERE expires_at < NOW()
     RETURNING id`,
  );

  if (rows.length > 0) {
    logInfo('trusted_devices.cleanup.completed', {
      deletedCount: rows.length,
    });
  }
}

export function startTrashRetentionWorker(): void {
  if (timer) return;

  const retentionDays = getRetentionDays();
  const intervalMs = getCleanupIntervalMs();

  logInfo('trash.cleanup.worker_started', {
    retentionDays,
    intervalMs,
  });

  if (!Number.isFinite(config.TRASH_RETENTION_DAYS)) {
    logWarn('trash.cleanup.invalid_retention_fallback', {
      configuredRetentionDays: config.TRASH_RETENTION_DAYS,
      fallbackRetentionDays: retentionDays,
    });
  }

  void purgeExpiredTrash();
  timer = setInterval(() => {
    void purgeExpiredTrash();
  }, intervalMs);
}
