type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getCurrentLogLevel(): LogLevel {
  const raw = (process.env.E2E_LOG_LEVEL || 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  const current = getCurrentLogLevel();
  return LEVELS[level] >= LEVELS[current];
}

export function logDebug(...args: unknown[]): void {
  if (shouldLog('debug')) {
    console.debug(...args);
  }
}

export function logInfo(...args: unknown[]): void {
  if (shouldLog('info')) {
    console.log(...args);
  }
}

export function logWarn(...args: unknown[]): void {
  if (shouldLog('warn')) {
    console.warn(...args);
  }
}

export function logError(...args: unknown[]): void {
  if (shouldLog('error')) {
    console.error(...args);
  }
}

