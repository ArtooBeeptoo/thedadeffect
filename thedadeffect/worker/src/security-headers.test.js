// Regression test for fix-006: Security headers on all worker responses
// Verifies X-Content-Type-Options: nosniff and X-Frame-Options: DENY are present
// on every response type (checkout, webhook, health, 404, CORS preflight, rate-limited)

import { describe, it, expect, beforeEach } from 'vitest';
import worker from './index.js';

function req(path, opts = {}) {
  return new Request(`https://worker.example.com${path}`, opts);
}

const env = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
  PRINTFUL_API_TOKEN: 'fake',
  PRINTFUL_STORE_ID: '123',
};

function assertSecurityHeaders(response) {
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('X-Frame-Options')).toBe('DENY');
}

describe('Security headers (fix-006)', () => {
  it('should include security headers on 404 responses', async () => {
    const res = await worker.fetch(req('/nonexistent'), env);
    expect(res.status).toBe(404);
    assertSecurityHeaders(res);
  });

  it('should include security headers on health endpoint', async () => {
    const res = await worker.fetch(req('/api/health'), env);
    expect(res.status).toBe(200);
    assertSecurityHeaders(res);
  });

  it('should include security headers on CORS preflight', async () => {
    const res = await worker.fetch(req('/api/checkout', { method: 'OPTIONS' }), env);
    assertSecurityHeaders(res);
    // CORS headers should still work
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('should include security headers on webhook 401 (missing signature)', async () => {
    const res = await worker.fetch(req('/api/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }), env);
    expect(res.status).toBe(401);
    assertSecurityHeaders(res);
  });

  it('should include security headers on checkout 400 (bad product)', async () => {
    const res = await worker.fetch(req('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: 'nonexistent', size: 'M' }),
    }), env);
    expect(res.status).toBe(400);
    assertSecurityHeaders(res);
  });

  it('should include X-Content-Type-Options: nosniff to prevent MIME sniffing attacks', async () => {
    const res = await worker.fetch(req('/api/health'), env);
    // This is the primary security concern — nosniff prevents browsers from
    // MIME-sniffing JSON responses as executable content
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
