import { query } from '../config/database';
import { config } from '../config';
import { logError, logInfo } from '../utils/logger';

interface DueReminderRow {
  id: string;
  title: string;
  body: string;
  checklist: Array<{ text: string; checked: boolean }>;
  reminder_label: string | null;
  reminder_date: string | null;
  reminder_time: string | null;
  reminder_repeat_daily: boolean;
  telegram_chat_id: string;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

function padTimePart(value: number): string {
  return String(value).padStart(2, '0');
}

function getLocalReminderWindow(now: Date): { currentDate: string; currentTime: string } {
  const currentDate = [
    now.getFullYear(),
    padTimePart(now.getMonth() + 1),
    padTimePart(now.getDate()),
  ].join('-');
  const currentTime = [
    padTimePart(now.getHours()),
    padTimePart(now.getMinutes()),
  ].join(':');

  return { currentDate, currentTime };
}

function buildReminderMessage(row: DueReminderRow): string {
  const title = row.title || 'Nota sem título';
  const body = row.body ? row.body.slice(0, 280) : '';
  const pendingChecklist = Array.isArray(row.checklist)
    ? row.checklist.filter((item) => item && item.checked !== true).slice(0, 4).map((item) => `• ${item.text}`)
    : [];

  const lines = [
    'Lembrete do Brain Core',
    '',
    title,
  ];

  if (row.reminder_label) lines.push(`Quando: ${row.reminder_label}`);
  if (row.reminder_time) lines.push(`Hora: ${row.reminder_time.slice(0, 5)}`);
  if (body) lines.push('', body);
  if (pendingChecklist.length) lines.push('', ...pendingChecklist);

  return lines.join('\n');
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = config.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed: ${response.status} ${detail}`);
  }
}

async function dispatchDueReminders(): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) return;
  if (running) return;

  running = true;

  try {
    const now = new Date();
    const { currentDate, currentTime } = getLocalReminderWindow(now);

    const rows = await query<DueReminderRow>(
      `SELECT rn.id, rn.title, rn.body, rn.checklist, rn.reminder_label, rn.reminder_date::text, rn.reminder_time::text, rn.reminder_repeat_daily, u.telegram_chat_id
       FROM remember_notes rn
       JOIN users u ON u.id::text = rn.user_id
       WHERE rn.reminder_date IS NOT NULL
         AND rn.reminder_date <= $1::date
         AND (rn.reminder_time IS NULL OR rn.reminder_time <= $2::time)
         AND rn.reminder_sent_at IS NULL
         AND u.telegram_notifications_enabled = TRUE
         AND u.telegram_chat_id IS NOT NULL
         AND u.telegram_chat_id <> ''
       ORDER BY rn.reminder_date ASC, rn.updated_at DESC
       LIMIT 25`,
      [currentDate, currentTime],
    );

    for (const row of rows) {
      try {
        await sendTelegramMessage(row.telegram_chat_id, buildReminderMessage(row));
        if (row.reminder_repeat_daily === true) {
          await query(
            `UPDATE remember_notes
             SET reminder_date = COALESCE(reminder_date, CURRENT_DATE) + INTERVAL '1 day',
                 reminder_sent_at = NULL
             WHERE id = $1`,
            [row.id],
          );
        } else {
          await query(
            `UPDATE remember_notes
             SET reminder_sent_at = NOW()
             WHERE id = $1`,
            [row.id],
          );
        }
        logInfo('remember.reminder.sent', { noteId: row.id, reminderDate: row.reminder_date });
      } catch (error) {
        logError('remember.reminder.send_failed', {
          noteId: row.id,
          detail: String(error),
        });
      }
    }
  } finally {
    running = false;
  }
}

export function startRememberReminderWorker(): void {
  if (timer) return;

  void dispatchDueReminders();
  timer = setInterval(() => {
    void dispatchDueReminders();
  }, Math.max(15000, config.REMEMBER_REMINDER_INTERVAL_MS));
}
