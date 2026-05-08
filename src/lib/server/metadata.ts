import type { RequestEvent } from '@sveltejs/kit';

export interface ExtraMetadata {
  browserFingerprint?: string;
  csrfTokenEcho?: string;
  sessionId?: string;
}

export interface SubmissionMetadata {
  ipAddress: string | null;
  userAgent: string | null;
  acceptLanguage: string | null;
  referer: string | null;
  requestMethod: string;
  tlsVersion: string | null;
  sessionId: string | null;
  browserFingerprint: string | null;
  csrfTokenEcho: string | null;
  submissionTimestamp: string;
}

export function extractMetadata(evt: RequestEvent, extra: ExtraMetadata): SubmissionMetadata {
  const h = evt.request.headers;
  return {
    ipAddress: safeClientAddress(evt),
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    referer: h.get('referer'),
    requestMethod: evt.request.method,
    tlsVersion: h.get('x-forwarded-proto'),
    sessionId: extra.sessionId ?? null,
    browserFingerprint: extra.browserFingerprint ?? null,
    csrfTokenEcho: extra.csrfTokenEcho ?? null,
    submissionTimestamp: new Date().toISOString()
  };
}

function safeClientAddress(evt: RequestEvent): string | null {
  try { return evt.getClientAddress(); } catch { return null; }
}
