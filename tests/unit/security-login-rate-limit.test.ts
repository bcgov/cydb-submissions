import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	createLoginThrottle,
	type LoginThrottle
} from '$lib/server/security/login-throttle';

describe('createLoginThrottle — login brute-force defence (3.3)', () => {
	let throttle: LoginThrottle;

	beforeEach(() => {
		vi.useFakeTimers();
		throttle = createLoginThrottle({
			maxFailuresPerKey: 5,
			windowMs: 15 * 60_000,
			lockoutMs: 15 * 60_000
		});
	});
	afterEach(() => vi.useRealTimers());

	it('permits the first attempt and the first failure', () => {
		expect(throttle.check('1.2.3.4', 'a@x')).toEqual({ allowed: true });
		throttle.recordFailure('1.2.3.4', 'a@x');
		expect(throttle.check('1.2.3.4', 'a@x')).toEqual({ allowed: true });
	});

	it('blocks after maxFailuresPerKey consecutive failures', () => {
		for (let i = 0; i < 5; i++) throttle.recordFailure('1.2.3.4', 'a@x');
		const decision = throttle.check('1.2.3.4', 'a@x');
		expect(decision.allowed).toBe(false);
		expect(decision.retryAfterMs).toBeGreaterThan(0);
	});

	it('clears the counter on a successful login (recordSuccess)', () => {
		for (let i = 0; i < 4; i++) throttle.recordFailure('1.2.3.4', 'a@x');
		throttle.recordSuccess('1.2.3.4', 'a@x');
		// Fresh slate — five more failures should be needed to block again.
		for (let i = 0; i < 4; i++) throttle.recordFailure('1.2.3.4', 'a@x');
		expect(throttle.check('1.2.3.4', 'a@x').allowed).toBe(true);
	});

	it('keys are scoped by ip+email; blocking one email does not block another from the same IP', () => {
		for (let i = 0; i < 5; i++) throttle.recordFailure('1.2.3.4', 'a@x');
		expect(throttle.check('1.2.3.4', 'a@x').allowed).toBe(false);
		expect(throttle.check('1.2.3.4', 'b@x').allowed).toBe(true);
	});

	it('blocks per-IP regardless of email after a higher IP-only threshold', () => {
		// Distributed-credential-stuffing defence: cycling many emails from one
		// IP should still trip a coarser threshold.
		for (let i = 0; i < 20; i++) throttle.recordFailure('1.2.3.4', `u${i}@x`);
		expect(throttle.check('1.2.3.4', 'new@x').allowed).toBe(false);
	});

	it('expires the lockout after lockoutMs', () => {
		for (let i = 0; i < 5; i++) throttle.recordFailure('1.2.3.4', 'a@x');
		expect(throttle.check('1.2.3.4', 'a@x').allowed).toBe(false);
		vi.advanceTimersByTime(15 * 60_000 + 1);
		expect(throttle.check('1.2.3.4', 'a@x').allowed).toBe(true);
	});

	it('discards failures older than the sliding window', () => {
		for (let i = 0; i < 4; i++) throttle.recordFailure('1.2.3.4', 'a@x');
		vi.advanceTimersByTime(15 * 60_000 + 1);
		// Old failures dropped → a new attempt is allowed and the next failure
		// is treated as the first within the new window.
		expect(throttle.check('1.2.3.4', 'a@x').allowed).toBe(true);
	});
});
