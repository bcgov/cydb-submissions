import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { getEffectiveConfig, redactForClient, saveConfig, rotateApiToken } from '$lib/server/chefs/config';
import { listSubmissions, downloadFile } from '$lib/server/chefs/client';
import { runOneSync } from '$lib/server/chefs/sync';
import { logger } from '$lib/server/log';
import { getSystemState, clearSystemState } from '$lib/server/ocr/system-state';
import { isAllowedChefsBaseUrl } from '$lib/server/security/url-safety';
import type { SyncResult } from '$lib/server/chefs/types';

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
  return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const load: PageServerLoad = async ({ locals }) => {
  requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
  return {
    config: redactForClient(db, env as Record<string, string | undefined>),
    lastSync: getSystemState<SyncResult>(db, 'chefs.lastSync'),
    failureCount: getSystemState<number>(db, 'chefs.failureCount') ?? 0,
    halted: getSystemState<{ trippedAt: string; threshold: number; lastErrorClass: string | null }>(
      db,
      'chefs.halted'
    )
  };
};

export const actions: Actions = {
  save: async ({ request, locals, url, cookies }) => {
    requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
    const form = await request.formData();
    if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
      return fail(403, { action: 'save', error: 'CSRF token mismatch' });
    }
    const apiParamsRaw = String(form.get('apiParams') ?? '').trim();
    let apiParams: Record<string, unknown> | undefined;
    if (apiParamsRaw) {
      try {
        apiParams = JSON.parse(apiParamsRaw);
      } catch {
        return fail(400, { action: 'save', error: 'apiParams must be valid JSON' });
      }
    }
    const fileComponentsRaw = String(form.get('fileComponents') ?? '');
    const fileComponents = fileComponentsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const baseUrl = String(form.get('baseUrl') ?? '').trim() || undefined;
    if (baseUrl && !isAllowedChefsBaseUrl(baseUrl)) {
      return fail(400, {
        action: 'save',
        error:
          'baseUrl must be an HTTPS URL on the gov.bc.ca apex (e.g. https://submit.digital.gov.bc.ca)'
      });
    }
    saveConfig(db, {
      formId: String(form.get('formId') ?? '').trim() || undefined,
      version: String(form.get('version') ?? '').trim() || undefined,
      baseUrl,
      fileComponents: fileComponents.length > 0 ? fileComponents : undefined,
      apiParams,
      pollerEnabled: form.get('pollerEnabled') === 'on',
      pollIntervalMs: Number(form.get('pollIntervalMs')) || undefined
    });
    auditLog(
      'chefs_config_saved',
      {
        actorUserId: locals.user!.id,
        actorRole: 'admin',
        route: url.pathname,
        requestId: locals.requestId
      },
      locals.logger
    );
    return { action: 'save', success: 'Configuration saved.' };
  },

  rotateToken: async ({ request, locals, url, cookies }) => {
    requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
    const form = await request.formData();
    if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
      return fail(403, { action: 'rotateToken', error: 'CSRF token mismatch' });
    }
    const token = String(form.get('apiToken') ?? '');
    if (!token) return fail(400, { action: 'rotateToken', error: 'apiToken is required' });
    rotateApiToken(db, token);
    auditLog(
      'chefs_token_rotated',
      {
        actorUserId: locals.user!.id,
        actorRole: 'admin',
        route: url.pathname,
        requestId: locals.requestId
      },
      locals.logger
    );
    return { action: 'rotateToken', success: 'API token rotated.' };
  },

  test: async ({ locals, url, cookies, request }) => {
    requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
    const form = await request.formData();
    if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
      return fail(403, { action: 'test', error: 'CSRF token mismatch' });
    }
    const cfg = getEffectiveConfig(db, env as Record<string, string | undefined>);
    try {
      const rows = await listSubmissions(cfg, { fetch });
      auditLog(
        'chefs_test_connection',
        {
          actorUserId: locals.user!.id,
          actorRole: 'admin',
          route: url.pathname,
          requestId: locals.requestId,
          reason: `ok rows=${rows.length}`
        },
        locals.logger
      );
      return { action: 'test', success: `OK — server returned ${rows.length} submission(s).` };
    } catch (e) {
      auditLog(
        'chefs_test_connection',
        {
          actorUserId: locals.user!.id,
          actorRole: 'admin',
          route: url.pathname,
          requestId: locals.requestId,
          reason: `error ${(e as Error).message}`
        },
        locals.logger
      );
      return fail(400, { action: 'test', error: (e as Error).message });
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  syncNow: async ({ locals, url, cookies, request }) => {
    requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
    const form = await request.formData();
    if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
      return fail(403, { action: 'syncNow', error: 'CSRF token mismatch' });
    }
    const cfg = getEffectiveConfig(db, env as Record<string, string | undefined>);
    try {
      const res = await runOneSync(db, cfg, {
        list: (c) => listSubmissions(c, { fetch }),
        download: (fileId) => downloadFile(cfg, fileId, { fetch }, logger),
        attachmentsDir: env.ATTACHMENTS_DIR ?? './attachments',
        logger: locals.logger,
        actorUserId: locals.user!.id
      });
      return {
        action: 'syncNow',
        success: `Synced: fetched=${res.fetched}, ingested=${res.ingested}, invalid=${res.invalid}, skipped=${res.skippedDuplicate}.`
      };
    } catch (e) {
      return fail(500, { action: 'syncNow', error: (e as Error).message });
    }
  },

  resume: async ({ locals, url, cookies, request }) => {
    requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
    const form = await request.formData();
    if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
      return fail(403, { action: 'resume', error: 'CSRF token mismatch' });
    }
    clearSystemState(db, 'chefs.halted');
    clearSystemState(db, 'chefs.failureCount');
    auditLog(
      'queue_resumed',
      {
        actorUserId: locals.user!.id,
        actorRole: 'admin',
        route: url.pathname,
        requestId: locals.requestId,
        reason: 'manual resume via admin UI'
      },
      locals.logger
    );
    return { action: 'resume', success: 'CHEFS poller resumed.' };
  }
};
