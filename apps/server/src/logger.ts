/**
 * Small dependency-free logger.
 *
 * Two output formats:
 *   - `pretty` (default in a terminal) — one readable line per event, colour
 *     coded, metadata as `key=value`. This is what a human running the app
 *     locally should see.
 *   - `json` (default when output is piped or in tests) — one JSON object per
 *     line, for log collectors and CI.
 * Force either with `LOG_FORMAT=pretty|json`.
 *
 * Safety rules that never change between formats:
 *   - URLs are redacted before they are logged (`redactUrl` strips query
 *     strings, which is where signed tokens live) — blueprint §9.
 *   - Secrets are never logged except the one-time ephemeral access token, which
 *     the operator cannot obtain any other way.
 */
type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const ORDER: Level[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

/** Index into ORDER; anything above the threshold is dropped. */
let threshold = 3; // info
/** 'pretty' when a human is watching, 'json' otherwise. */
let format: 'pretty' | 'json' = 'json';

export function setLogLevel(level: string): void {
  if (level === 'silent') {
    // Below every level: used by the test suite and by anyone who wants a fully
    // quiet process. (Previously this fell through to `info`, which is why tests
    // still printed startup noise.)
    threshold = -1;
    return;
  }
  const idx = ORDER.indexOf(level as Level);
  threshold = idx === -1 ? 3 : idx;
}

export function setLogFormat(value: string): void {
  if (value === 'pretty' || value === 'json') format = value;
}

/** Decide the format once, at boot, from the environment. */
export function initLogFormat(env: 'development' | 'production' | 'test'): void {
  const requested = process.env.LOG_FORMAT;
  if (requested === 'pretty' || requested === 'json') {
    format = requested;
    return;
  }
  // Development is always readable — a dev's output is for a human, even when it
  // is piped into a file or an IDE pane that does not report itself as a TTY.
  // Production and tests follow the terminal: a watching human gets lines, a log
  // collector gets JSON.
  if (env === 'development') {
    format = 'pretty';
    return;
  }
  format = Boolean(process.stdout.isTTY) && env !== 'test' ? 'pretty' : 'json';
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const redactedQuery = u.search ? '?<redacted>' : '';
    return `${u.protocol}//${u.host}${u.pathname}${redactedQuery}`;
  } catch {
    return '<unparseable-url>';
  }
}

const COLOR = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  gray: '\u001b[90m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  bold: '\u001b[1m',
} as const;

const LEVEL_COLOR: Record<Level, string> = {
  fatal: COLOR.red,
  error: COLOR.red,
  warn: COLOR.yellow,
  info: COLOR.cyan,
  debug: COLOR.gray,
  trace: COLOR.gray,
};

function useColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return format === 'pretty' && Boolean(process.stdout.isTTY);
}

function paint(text: string, color: string): string {
  return useColor() ? `${color}${text}${COLOR.reset}` : text;
}

/** `key=value`, quoting values that contain spaces; long values are truncated. */
function renderValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  let text: string;
  if (value instanceof Error) text = `${value.name}: ${value.message}`;
  else if (typeof value === 'string') text = /^https?:\/\//.test(value) ? redactUrl(value) : value;
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);

  if (text.length > 160) text = `${text.slice(0, 157)}…`;
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function renderPretty(level: Level, message: string, meta?: Record<string, unknown>): string {
  const time = new Date().toTimeString().slice(0, 8);
  const label = level.padEnd(5);
  const parts: string[] = [];
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      const rendered = renderValue(v);
      if (rendered) parts.push(`${paint(`${k}=`, COLOR.gray)}${rendered}`);
    }
  }
  const head = `${paint(time, COLOR.gray)}  ${paint(label, LEVEL_COLOR[level])} ${message}`;
  return parts.length > 0 ? `${head}  ${parts.join('  ')}` : head;
}

function renderJson(level: Level, message: string, meta?: Record<string, unknown>): string {
  const record: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    msg: message,
  };
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v === undefined) continue;
      if (v instanceof Error) record[k] = { name: v.name, message: v.message };
      else if (typeof v === 'string' && /^https?:\/\//.test(v)) record[k] = redactUrl(v);
      else record[k] = v;
    }
  }
  return JSON.stringify(record);
}

function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (ORDER.indexOf(level) > threshold) return;
  const line = format === 'pretty' ? renderPretty(level, message, meta) : renderJson(level, message, meta);
  if (level === 'error' || level === 'fatal') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  fatal: (msg: string, meta?: Record<string, unknown>) => emit('fatal', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  trace: (msg: string, meta?: Record<string, unknown>) => emit('trace', msg, meta),
};
