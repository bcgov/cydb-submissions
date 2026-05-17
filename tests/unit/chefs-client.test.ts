import { describe, it, expect, vi } from 'vitest';
import { listSubmissions, downloadFile, basicAuthHeader } from '$lib/server/chefs/client';
import { ChefsClientError, type ChefsConfig } from '$lib/server/chefs/types';

const cfg: ChefsConfig = {
  formId: 'form-uuid',
  apiToken: 'tok',
  version: '0',
  baseUrl: 'https://chefs.test',
  fileComponents: ['simplefile'],
  apiParams: {},
  pollerEnabled: false,
  pollIntervalMs: 60_000
};

describe('basicAuthHeader', () => {
  it('returns base64(formId:apiToken) prefixed with "Basic "', () => {
    const h = basicAuthHeader(cfg);
    expect(h).toBe('Basic ' + Buffer.from('form-uuid:tok').toString('base64'));
  });
});

describe('listSubmissions', () => {
  it('GETs /app/api/v1/forms/{id}/export with format=json&type=submissions', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => []
    });
    await listSubmissions(cfg, { fetch: fakeFetch as unknown as typeof fetch });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = fakeFetch.mock.calls[0];
    expect(url).toContain('https://chefs.test/app/api/v1/forms/form-uuid/export');
    expect(url).toContain('format=json');
    expect(url).toContain('type=submissions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: basicAuthHeader(cfg) });
  });

  it('merges apiParams into the query string', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const withParams: ChefsConfig = {
      ...cfg,
      apiParams: { status: 'COMPLETED', deleted: false, preference: { minDate: '2026-01-01T00:00:00Z' } }
    };
    await listSubmissions(withParams, { fetch: fakeFetch as unknown as typeof fetch });
    const [url] = fakeFetch.mock.calls[0];
    expect(url).toContain('status=COMPLETED');
    expect(url).toContain('deleted=false');
    expect(url).toContain(encodeURIComponent('preference[minDate]') + '=' + encodeURIComponent('2026-01-01T00:00:00Z'));
  });

  it('throws Unauthorized on 401', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'denied'
    });
    await expect(
      listSubmissions(cfg, { fetch: fakeFetch as unknown as typeof fetch })
    ).rejects.toMatchObject({ name: 'ChefsClientError', errorClass: 'Unauthorized', status: 401 });
  });

  it('throws BadResponse when the body is not a JSON array', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: 'oops' })
    });
    await expect(
      listSubmissions(cfg, { fetch: fakeFetch as unknown as typeof fetch })
    ).rejects.toMatchObject({ name: 'ChefsClientError', errorClass: 'BadResponse' });
  });

  it('throws ConfigMissing when formId or apiToken is empty', async () => {
    const empty: ChefsConfig = { ...cfg, formId: '' };
    await expect(
      listSubmissions(empty, { fetch: vi.fn() as unknown as typeof fetch })
    ).rejects.toMatchObject({ name: 'ChefsClientError', errorClass: 'ConfigMissing' });
  });
});

describe('downloadFile', () => {
  it('GETs /app/api/v1/files/{fileId} and returns the binary buffer + mime', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/pdf' : null) },
      arrayBuffer: async () => bytes.buffer
    });
    const out = await downloadFile(cfg, 'file-uuid', { fetch: fakeFetch as unknown as typeof fetch });
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://chefs.test/app/api/v1/files/file-uuid',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: basicAuthHeader(cfg) }) })
    );
    expect(out.mimeType).toBe('application/pdf');
    expect(out.bytes).toEqual(Buffer.from(bytes));
  });

  it('throws NotFound on 404', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found'
    });
    await expect(
      downloadFile(cfg, 'missing', { fetch: fakeFetch as unknown as typeof fetch })
    ).rejects.toMatchObject({ errorClass: 'NotFound', status: 404 });
  });
});
