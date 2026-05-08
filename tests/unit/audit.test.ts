import { describe, it, expect } from 'vitest';
import { auditLog } from '$lib/server/audit';
import { createLogger } from '$lib/server/log';

function captureLogger() {
  const lines: string[] = [];
  const log = createLogger({
    stream: { write: (s: string) => { lines.push(s); return true; } } as never
  });
  return { log, lines };
}

describe('auditLog', () => {
  it('emits with the expected base shape', () => {
    const { log, lines } = captureLogger();
    auditLog('submission_viewed', {
      submissionUuid: 'sub-1',
      actorUserId: 'u-1',
      actorRole: 'cfd_worker',
      route: '/submissions/sub-1',
      requestId: 'req-1'
    }, log);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      event: 'submission_viewed',
      submissionUuid: 'sub-1',
      actorUserId: 'u-1',
      actorRole: 'cfd_worker'
    });
    expect(entry.msg).toBe('audit');
  });

  it('throws when called with an event name not on the allow-list', () => {
    const { log } = captureLogger();
    expect(() =>
      // @ts-expect-error — intentional unknown event
      auditLog('totally_made_up', { actorUserId: 'u', actorRole: 'admin', route: '/', requestId: 'r' }, log)
    ).toThrow(/unknown audit event/i);
  });
});
