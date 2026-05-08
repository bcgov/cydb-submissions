import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { nanoid } from 'nanoid';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { logger } from '$lib/server/log';
import { createRateLimiter } from '$lib/server/rate-limit';
import { env } from '$env/dynamic/private';

const rl = createRateLimiter({
	max: Number(env.RATE_LIMIT_PER_IP ?? 3),
	windowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? 900_000)
});

const CSRF_COOKIE = 'cydb_csrf';

const handlePhase1: Handle = async ({ event, resolve }) => {
	event.locals.requestId = nanoid(12);

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
	event.locals.logger.info(
		{ event: 'request_completed', status: res.status },
		'response'
	);
	return res;
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = sequence(handlePhase1, handleBetterAuth);
