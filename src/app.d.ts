import type { User, Session } from 'better-auth/minimal';
import type { Logger } from 'pino';
import type { Role } from '$lib/server/auth-types';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: User | { id: string; email: string; name: string } | null;
			session?: Session;
			roles: Set<Role>;
			requestId: string;
			logger: Logger;
			csrfToken: string;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
