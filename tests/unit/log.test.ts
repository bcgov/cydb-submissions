import { describe, expect, it, vi } from 'vitest';
import { createLogger, redactPII } from '../../src/lib/server/log';

describe('redactPII', () => {
  it('redacts email-shaped strings', () => {
    expect(redactPII({ msg: 'sent to alice@example.com' })).toEqual(
      { msg: 'sent to [REDACTED-EMAIL]' }
    );
  });
  it('redacts long digit runs (potential PHN/SIN)', () => {
    expect(redactPII({ note: 'PHN 9999 999 998' })).toEqual(
      { note: 'PHN [REDACTED-DIGITS]' }
    );
  });
  it('redacts known PII keys regardless of value', () => {
    expect(redactPII({ surname: 'Tremblay', dateOfBirth: '2018-04-12', submissionId: 'sub_abc' }))
      .toEqual({ surname: '[REDACTED]', dateOfBirth: '[REDACTED]', submissionId: 'sub_abc' });
  });
  it('passes through non-PII objects untouched', () => {
    expect(redactPII({ submissionId: 'sub_1', status: 'submitted' }))
      .toEqual({ submissionId: 'sub_1', status: 'submitted' });
  });
});

describe('createLogger', () => {
  it('emits NDJSON to provided stream', () => {
    const writes: string[] = [];
    const stream = { write: (s: string) => { writes.push(s); return true; } } as any;
    const log = createLogger({ stream, level: 'info' });
    log.info({ submissionId: 'sub_42' }, 'submission accepted');
    const line = JSON.parse(writes[0]);
    expect(line.msg).toBe('submission accepted');
    expect(line.submissionId).toBe('sub_42');
    expect(line.level).toBe(30); // pino info level
  });
  it('redacts PII in emitted lines', () => {
    const writes: string[] = [];
    const stream = { write: (s: string) => { writes.push(s); return true; } } as any;
    const log = createLogger({ stream, level: 'info' });
    log.info({ surname: 'Smith', email: 'a@b.ca' }, 'should redact');
    const line = JSON.parse(writes[0]);
    expect(line.surname).toBe('[REDACTED]');
    expect(line.email).toBe('[REDACTED]');
  });
});
