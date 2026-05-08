import type { Handle } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { nanoid } from 'nanoid';
import { getAuth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { logger } from '$lib/server/log';
import { createRateLimiter } from '$lib/server/rate-limit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { parseBypassConfig, applyBypass } from '$lib/server/dev-bypass';
import { getUserRoles } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import type { Role } from '$lib/server/auth-types';

// Surface crashes that would otherwise produce the bare
// 'triggerUncaughtException' line with no stack. SvelteKit's adapter-node
// catches request errors but background-task rejections are silent without
// these.
if (!building) {
	process.on('uncaughtException', (err) => {
		logger.fatal({ event: 'uncaught_exception', err: serializeErr(err) }, 'uncaught exception');
	});
	process.on('unhandledRejection', (reason) => {
		logger.fatal(
			{ event: 'unhandled_rejection', reason: serializeErr(reason) },
			'unhandled rejection'
		);
	});
}

function serializeErr(e: unknown) {
	if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
	return { value: String(e) };
}

const rl = createRateLimiter({
	max: Number(env.RATE_LIMIT_PER_IP ?? 3),
	windowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? 900_000)
});

const CSRF_COOKIE = 'cydb_csrf';

const handlePhase1: Handle = async ({ event, resolve }) => {
	event.locals.requestId = nanoid(12);
	event.locals.roles = new Set<Role>();

	let token = event.cookies.get(CSRF_COOKIE);
	if (!token) {
		token = nanoid(32);
		event.cookies.set(CSRF_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: env.NODE_ENV === 'production'
		});
	}
	event.locals.csrfToken = token;

	event.locals.logger = logger.child({
		requestId: event.locals.requestId,
		route: event.url.pathname
	});

	if (event.url.pathname === '/' && event.request.method === 'POST') {
		const ip = (() => {
			try {
				return event.getClientAddress();
			} catch {
				return 'unknown';
			}
		})();
		if (!rl.check(ip)) {
			event.locals.logger.warn({ event: 'rate_limited' }, 'submission rate-limited');
			return new Response('Too Many Requests', { status: 429 });
		}
	}

	event.locals.logger.info(
		{ event: 'request_received', method: event.request.method },
		'request'
	);
	const res = await resolve(event);
	event.locals.logger.info({ event: 'request_completed', status: res.status }, 'response');
	return res;
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const auth = getAuth();
	if (!auth) return resolve(event); // Phase 1: no auth configured.

	const session = await auth.api.getSession({ headers: event.request.headers });
	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}
	return svelteKitHandler({ event, resolve, auth, building });
};

const BYPASS_COOKIE = 'cydb_bypass';

const handlePopulateRoles: Handle = async ({ event, resolve }) => {
	if (event.locals.user?.id) {
		event.locals.roles = await getUserRoles(db, event.locals.user.id);
		return resolve(event);
	}

	if (env.NODE_ENV !== 'production') {
		const cfg = parseBypassConfig(env.DEV_AUTH_BYPASS);
		if (cfg) {
			const requested =
				event.url.searchParams.get('bypass') ?? event.cookies.get(BYPASS_COOKIE) ?? undefined;
			const result = await applyBypass(db, cfg, requested);
			if (result) {
				event.locals.user = result.user;
				event.locals.roles = result.roles;
				if (event.url.searchParams.get('bypass')) {
					event.cookies.set(BYPASS_COOKIE, event.url.searchParams.get('bypass')!, {
						path: '/',
						httpOnly: true,
						sameSite: 'lax'
					});
				}
				auditLog(
					'auth_bypass_applied',
					{
						actorUserId: result.user.id,
						actorRole: [...result.roles][0],
						route: event.url.pathname,
						requestId: event.locals.requestId
					},
					event.locals.logger
				);
			}
		}
	}

	return resolve(event);
};

const ROUTE_RULES: Array<{ prefix: string; roles: Role[] }> = [
	{ prefix: '/admin', roles: ['admin'] },
	{ prefix: '/clinician', roles: ['clinician'] },
	{ prefix: '/submissions', roles: ['admin', 'cfd_worker'] },
	{ prefix: '/attachments', roles: ['admin', 'cfd_worker'] }
];

const handleRoleGuard: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const rule = ROUTE_RULES.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`));
	if (!rule) return resolve(event);

	if (!event.locals.user) {
		throw redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);
	}
	const allowed = rule.roles.some((r) => event.locals.roles.has(r));
	if (!allowed) {
		auditLog(
			'role_denied',
			{
				actorUserId: event.locals.user.id,
				route: path,
				requestId: event.locals.requestId,
				reason: `requires one of: ${rule.roles.join(', ')}`
			},
			event.locals.logger
		);
		throw error(403, 'forbidden');
	}
	return resolve(event);
};

export const handle: Handle = sequence(
	handlePhase1,
	handleBetterAuth,
	handlePopulateRoles,
	handleRoleGuard
);
