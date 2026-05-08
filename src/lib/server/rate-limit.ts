export interface RateLimiterOpts { max: number; windowMs: number; }
export interface RateLimiter { check(key: string): boolean; }

interface Bucket { count: number; resetAt: number; }

export function createRateLimiter(opts: RateLimiterOpts): RateLimiter {
  const buckets = new Map<string, Bucket>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
        return true;
      }
      if (b.count >= opts.max) return false;
      b.count += 1;
      return true;
    }
  };
}
