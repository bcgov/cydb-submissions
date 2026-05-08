import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter } from '../../src/lib/server/rate-limit';

describe('rate limiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows up to N requests per window per IP', () => {
    const rl = createRateLimiter({ max: 3, windowMs: 1000 });
    expect(rl.check('1.1.1.1')).toBe(true);
    expect(rl.check('1.1.1.1')).toBe(true);
    expect(rl.check('1.1.1.1')).toBe(true);
    expect(rl.check('1.1.1.1')).toBe(false);
  });
  it('isolates IPs', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.check('1.1.1.1')).toBe(true);
    expect(rl.check('2.2.2.2')).toBe(true);
    expect(rl.check('1.1.1.1')).toBe(false);
  });
  it('refills after window passes', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.check('1.1.1.1')).toBe(true);
    expect(rl.check('1.1.1.1')).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rl.check('1.1.1.1')).toBe(true);
  });
});
