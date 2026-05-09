import pino, { type Logger, type DestinationStream } from 'pino';

const PII_KEYS = new Set([
  'surname', 'givenName', 'firstName', 'lastName', 'fullName',
  'dateOfBirth', 'dob',
  'address', 'postalCode',
  'email', 'phone', 'phoneNumber',
  'ip', 'ipAddress',
  'userAgent', 'fingerprint',
  'fileName', 'originalFilename',
  'rawPayload',
  'raw_text', 'body', 'text'
]);

// Case-insensitive — covers HTTP header names that arrive in any casing.
const PII_KEYS_CI = new Set(['authorization', 'apikey']);

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_DIGITS_RE = /\b\d[\d\s-]{6,}\d\b/g;

export function redactPII<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactPII) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_KEYS.has(k) || PII_KEYS_CI.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string') {
      out[k] = v.replace(EMAIL_RE, '[REDACTED-EMAIL]').replace(LONG_DIGITS_RE, '[REDACTED-DIGITS]');
    } else if (v && typeof v === 'object') {
      out[k] = redactPII(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export interface CreateLoggerOpts {
  stream?: DestinationStream;
  level?: pino.LevelWithSilent;
}

export function createLogger(opts: CreateLoggerOpts = {}): Logger {
  const { stream, level = (process.env.LOG_LEVEL as pino.Level) ?? 'info' } = opts;
  return pino(
    {
      level,
      base: { app: 'cydb-submissions' },
      formatters: {
        log(obj) { return redactPII(obj); }
      },
      timestamp: pino.stdTimeFunctions.isoTime
    },
    stream
  );
}

export const logger = createLogger();
