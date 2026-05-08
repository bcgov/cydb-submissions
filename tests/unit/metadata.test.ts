import { describe, expect, it } from 'vitest';
import { extractMetadata } from '../../src/lib/server/metadata';

function fakeRequest(headers: Record<string, string>, ip = '203.0.113.7') {
  const r = new Request('https://example.org/', { method: 'POST', headers });
  return { request: r, getClientAddress: () => ip } as any;
}

describe('extractMetadata', () => {
  it('captures all expected headers and timing', () => {
    const evt = fakeRequest({
      'user-agent': 'Mozilla/5.0',
      'accept-language': 'en-CA',
      'referer': 'https://example.org/start',
      'x-forwarded-proto': 'https'
    });
    const m = extractMetadata(evt, { browserFingerprint: 'fp1', csrfTokenEcho: 'tok1', sessionId: undefined });
    expect(m.ipAddress).toBe('203.0.113.7');
    expect(m.userAgent).toBe('Mozilla/5.0');
    expect(m.acceptLanguage).toBe('en-CA');
    expect(m.referer).toBe('https://example.org/start');
    expect(m.requestMethod).toBe('POST');
    expect(m.tlsVersion).toBe('https');
    expect(m.browserFingerprint).toBe('fp1');
    expect(m.csrfTokenEcho).toBe('tok1');
    expect(m.submissionTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
