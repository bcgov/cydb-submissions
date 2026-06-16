import type { Logger } from 'pino';
import { ChefsClientError, type ChefsConfig } from './types';

export interface Deps {
  fetch: typeof fetch;
}

export function basicAuthHeader(cfg: ChefsConfig): string {
  const raw = `${cfg.formId}:${cfg.apiToken}`;
  return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

function assertConfigured(cfg: ChefsConfig): void {
  if (!cfg.formId || !cfg.apiToken) {
    throw new ChefsClientError('ConfigMissing', 'CHEFS form_id and api_token are required');
  }
}

function classifyStatus(status: number, body: string): ChefsClientError {
  if (status === 401 || status === 403) {
    return new ChefsClientError('Unauthorized', `auth rejected (${status})`, status, body.slice(0, 200));
  }
  if (status === 404) {
    return new ChefsClientError('NotFound', `not found (${status})`, status, body.slice(0, 200));
  }
  return new ChefsClientError('BadResponse', `unexpected status ${status}`, status, body.slice(0, 200));
}

function flattenParams(params: Record<string, unknown>, prefix?: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenParams(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      for (const item of v) out.push([key, String(item)]);
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

export async function listSubmissions(
  cfg: ChefsConfig,
  deps: Deps
): Promise<unknown[]> {
  assertConfigured(cfg);
  const url = new URL(`${cfg.baseUrl}/app/api/v1/forms/${cfg.formId}/export`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('type', 'submissions');
  if (cfg.version) url.searchParams.set('version', cfg.version);
  for (const [k, v] of flattenParams(cfg.apiParams)) url.searchParams.append(k, v);

  let res: Response;
  try {
    res = await deps.fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: basicAuthHeader(cfg), Accept: 'application/json' }
    });
  } catch (e) {
    throw new ChefsClientError('NetworkError', `fetch failed: ${(e as Error).message}`);
  }

  if (!res.ok) {
    const body = await safeText(res);
    throw classifyStatus(res.status, body);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    throw new ChefsClientError('BadResponse', `invalid JSON: ${(e as Error).message}`, res.status);
  }
  if (!Array.isArray(data)) {
    throw new ChefsClientError('BadResponse', 'expected JSON array', res.status);
  }
  return data;
}

export interface DownloadedFile {
  bytes: Buffer;
  mimeType: string;
}

export async function downloadFile(
  cfg: ChefsConfig,
  fileId: string,
  deps: Deps,
  logger: Logger
): Promise<DownloadedFile> {
  assertConfigured(cfg);
  const url = `${cfg.baseUrl}/app/api/v1/files/${encodeURIComponent(fileId)}`;
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: 'GET',
      headers: { Authorization: basicAuthHeader(cfg) }
    });
  } catch (e) {
    logger.error(
      { event: 'chefs_download_file_failed', message: (e as Error).message },
      'NetworkError: not able to download file from chefs'
    );
    throw new ChefsClientError('NetworkError', `fetch failed: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = await safeText(res);
    logger.error(
      { event: 'chefs_download_file_failed', message: `HTTP ${res.status} -> ${body}` },
      'HTTP error: not able to download file from chefs'
    );
    throw classifyStatus(res.status, body);
  }
  const ab = await res.arrayBuffer();
  return {
    bytes: Buffer.from(ab),
    mimeType: res.headers.get('content-type') ?? 'application/octet-stream'
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
