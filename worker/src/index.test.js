// Regression tests for webhook signature verification bypass (fix-001)
// These tests verify that the webhook endpoint rejects unauthenticated requests.

import { describe, it, expect } from 'vitest';

// Import the worker module
import worker from './index.js';

// Minimal env mock — intentionally missing/invalid secrets to test rejection
const baseEnv = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  PRINTFUL_API_TOKEN: 'fake-token',
  PRINTFUL_STORE_ID: '12345',
};

function makeRequest(path, { method = 'POST', headers = {}, body = '' } = {}) {
  return new Request(`https://worker.example.com${path}`, {
    method,
    headers,
    body: method !== 'GET' ? body : undefined,
  });
}

const fakeEvent = JSON.stringify({
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_fake' } },
});

describe('Webhook signature verification (fix-001)', () => {
  it('should return 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    const env = { ...baseEnv }; // no STRIPE_WEBHOOK_SECRET
    const req = makeRequest('/api/webhook', {
      body: fakeEvent,
      headers: { 'stripe-signature': 't=123,v1=abc' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Webhook secret not configured');
  });

  it('should return 401 when stripe-signature header is missing', async () => {
    const env = { ...baseEnv, STRIPE_WEBHOOK_SECRET: 'whsec_test_secret' };
    const req = makeRequest('/api/webhook', {
      body: fakeEvent,
      // No stripe-signature header
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Missing stripe-signature header');
  });

  it('should return 400 when signature is invalid', async () => {
    const env = { ...baseEnv, STRIPE_WEBHOOK_SECRET: 'whsec_test_secret' };
    const req = makeRequest('/api/webhook', {
      body: fakeEvent,
      headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=invalid_signature_hex` },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid signature');
  });

  it('should reject crafted checkout.session.completed without valid signature', async () => {
    // This is the exact attack vector: attacker sends a fake event with no auth
    const env = { ...baseEnv }; // no webhook secret = attacker scenario
    const maliciousPayload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_attacker_fake',
          metadata: { product_slug: 'sunset-walk', size: 'L' },
          shipping_details: {
            name: 'Attacker',
            address: { line1: '123 Evil St', city: 'Hackville', state: 'CA', postal_code: '90210', country: 'US' },
          },
          customer_details: { email: 'attacker@evil.com' },
        },
      },
    });
    const req = makeRequest('/api/webhook', { body: maliciousPayload });
    const res = await worker.fetch(req, env);
    // Must NOT return 200 — that would mean the event was processed
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(500); // secret not configured
  });
});
