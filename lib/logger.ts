type Level = 'debug' | 'info' | 'warn' | 'error';

function currentLevel(): Level {
  const env = (process.env.WORKER_LOG_LEVEL || 'info').toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') return env;
  return 'info';
}

function levelValue(l: Level): number {
  switch (l) {
    case 'debug':
      return 10;
    case 'info':
      return 20;
    case 'warn':
      return 30;
    case 'error':
      return 40;
  }
}

function enabled(target: Level): boolean {
  return levelValue(target) >= levelValue(currentLevel());
}

export function log(level: Level, msg: string, meta: Record<string, unknown> = {}) {
  if (!enabled(level)) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta)
};

