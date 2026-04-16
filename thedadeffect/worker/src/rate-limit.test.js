// Regression test: rate limiting on checkout endpoint (fix-004)
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, rateLimitMap, RATE_LIMIT } from './index.js';

describe('Checkout rate limiting', () => {
  beforeEach(() => {
    rateLimitMap.clear();
  });

  it('should allow requests under the rate limit', () => {
    for (let i = 0; i < RATE_LIMIT.maxRequests; i++) {
      const result = checkRateLimit('1.2.3.4');
      expect(result.allowed).toBe(true);
    }
  });

  it('should reject requests exceeding 10 per minute per IP with 429-style response', () => {
    // Exhaust the limit
    for (let i = 0; i < RATE_LIMIT.maxRequests; i++) {
      checkRateLimit('attacker-ip');
    }
    // 11th request should be blocked
    const result = checkRateLimit('attacker-ip');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('should track different IPs independently', () => {
    // Exhaust limit for one IP
    for (let i = 0; i < RATE_LIMIT.maxRequests; i++) {
      checkRateLimit('bad-ip');
    }
    const blocked = checkRateLimit('bad-ip');
    expect(blocked.allowed).toBe(false);

    // Different IP should still be allowed
    const allowed = checkRateLimit('good-ip');
    expect(allowed.allowed).toBe(true);
  });

  it('should reset after the time window expires', () => {
    // Exhaust limit
    for (let i = 0; i < RATE_LIMIT.maxRequests; i++) {
      checkRateLimit('reset-ip');
    }
    const blocked = checkRateLimit('reset-ip');
    expect(blocked.allowed).toBe(false);

    // Simulate window expiry by manipulating the map entry
    const entry = rateLimitMap.get('reset-ip');
    entry.resetAt = Date.now() - 1;

    const allowed = checkRateLimit('reset-ip');
    expect(allowed.allowed).toBe(true);
  });

  it('should not affect normal single-checkout user flow', () => {
    // A normal user makes 1-2 checkout attempts
    const first = checkRateLimit('normal-user');
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(RATE_LIMIT.maxRequests - 1);

    const second = checkRateLimit('normal-user');
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(RATE_LIMIT.maxRequests - 2);
  });
});
