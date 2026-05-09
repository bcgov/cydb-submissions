import { describe, it, expect } from 'vitest';
import { backoffMs, MAX_ATTEMPTS, nextAttemptAt } from '$lib/server/ocr/retry';

describe('backoffMs', () => {
	it('attempt 1 → 15s, 2 → 60s, 3 → 300s', () => {
		expect(backoffMs(1)).toBe(15_000);
		expect(backoffMs(2)).toBe(60_000);
		expect(backoffMs(3)).toBe(300_000);
	});
	it('clamps to the max for higher attempts', () => {
		expect(backoffMs(99)).toBe(300_000);
	});
	it('floor for non-positive attempts is the smallest interval', () => {
		expect(backoffMs(0)).toBe(15_000);
	});
	it('exposes a default MAX_ATTEMPTS=3', () => {
		expect(MAX_ATTEMPTS).toBe(3);
	});
});

describe('nextAttemptAt', () => {
	it('is a valid ISO 8601 timestamp in the future', () => {
		const now = new Date('2026-05-08T00:00:00Z');
		expect(nextAttemptAt(1, now)).toBe('2026-05-08T00:00:15.000Z');
	});
});
