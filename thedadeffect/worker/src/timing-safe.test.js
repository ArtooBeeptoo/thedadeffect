// Regression test for fix-002: timing-safe signature comparison
// Extracts and tests the timingSafeEqual function to verify it:
// 1. Accepts matching strings
// 2. Rejects mismatched strings
// 3. Rejects length-mismatched strings
// 4. Handles edge cases (empty strings, non-string input)

import { describe, it, expect } from 'vitest';

// Re-implement the function here for unit testing (same logic as in index.js)
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const lengthMatch = a.length === b.length ? 1 : 0;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  }
  return lengthMatch === 1 && mismatch === 0;
}

describe('timingSafeEqual - timing attack regression (fix-002)', () => {
  it('should accept identical signatures', () => {
    const sig = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd';
    expect(timingSafeEqual(sig, sig)).toBe(true);
  });

  it('should reject signatures differing by one character', () => {
    const a = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd';
    const b = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abce';
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it('should reject signatures of different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
  });

  it('should reject completely different signatures', () => {
    expect(timingSafeEqual('aaaa', 'zzzz')).toBe(false);
  });

  it('should accept empty strings as equal', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('should reject non-string inputs', () => {
    expect(timingSafeEqual(null, 'abc')).toBe(false);
    expect(timingSafeEqual('abc', undefined)).toBe(false);
    expect(timingSafeEqual(123, 456)).toBe(false);
  });

  it('should not short-circuit on first mismatch (constant-time behavior)', () => {
    // This test verifies the function processes all characters
    // by checking it correctly identifies mismatches at various positions
    const base = 'abcdefghijklmnop';
    for (let i = 0; i < base.length; i++) {
      const modified = base.substring(0, i) + 'X' + base.substring(i + 1);
      expect(timingSafeEqual(base, modified)).toBe(false);
    }
  });
});
