export interface LoginThrottleOpts {
	maxFailuresPerKey: number;
	windowMs: number;
	lockoutMs: number;
	ipMaxFailures?: number;
}

export interface LoginThrottleDecision {
	allowed: boolean;
	retryAfterMs?: number;
}

export interface LoginThrottle {
	check(ip: string, email: string): LoginThrottleDecision;
	recordFailure(ip: string, email: string): void;
	recordSuccess(ip: string, email: string): void;
}

interface Bucket {
	failures: number[];
	lockedUntil: number;
}

const compositeKey = (ip: string, email: string) => `${ip}|${email.toLowerCase()}`;
const ipKey = (ip: string) => `ip|${ip}`;

export function createLoginThrottle(opts: LoginThrottleOpts): LoginThrottle {
	const buckets = new Map<string, Bucket>();
	const ipMax = opts.ipMaxFailures ?? opts.maxFailuresPerKey * 4;

	function pruneAndGet(key: string, now: number): Bucket {
		let b = buckets.get(key);
		if (!b) {
			b = { failures: [], lockedUntil: 0 };
			buckets.set(key, b);
		}
		b.failures = b.failures.filter((t) => t > now - opts.windowMs);
		return b;
	}

	function decide(key: string, max: number, now: number): LoginThrottleDecision {
		const b = pruneAndGet(key, now);
		if (b.lockedUntil > now) return { allowed: false, retryAfterMs: b.lockedUntil - now };
		if (b.failures.length >= max) {
			b.lockedUntil = now + opts.lockoutMs;
			return { allowed: false, retryAfterMs: opts.lockoutMs };
		}
		return { allowed: true };
	}

	return {
		check(ip, email) {
			const now = Date.now();
			const perKey = decide(compositeKey(ip, email), opts.maxFailuresPerKey, now);
			if (!perKey.allowed) return perKey;
			return decide(ipKey(ip), ipMax, now);
		},

		recordFailure(ip, email) {
			const now = Date.now();
			pruneAndGet(compositeKey(ip, email), now).failures.push(now);
			pruneAndGet(ipKey(ip), now).failures.push(now);
		},

		recordSuccess(ip, email) {
			buckets.delete(compositeKey(ip, email));
			// Don't clear the IP bucket on a single success — distributed brute-force
			// can include a real password by coincidence; the IP-level signal stays.
		}
	};
}
