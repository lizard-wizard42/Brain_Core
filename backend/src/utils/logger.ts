type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

function writeLog(level: LogLevel, event: string, payload: LogPayload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function logInfo(event: string, payload?: LogPayload) {
  writeLog('info', event, payload);
}

export function logWarn(event: string, payload?: LogPayload) {
  writeLog('warn', event, payload);
}

export function logError(event: string, payload?: LogPayload) {
  writeLog('error', event, payload);
}
