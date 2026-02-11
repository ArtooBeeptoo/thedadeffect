import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';

// Minimal env stub
const env = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_fake',
  PRINTFUL_API_TOKEN: 'fake_token',
  PRINTFUL_STORE_ID: '12345',
};

function makeWebhookRequest(contentType, body = '{}') {
  const headers = new Headers({
    'stripe-signature': 't=9999999999,v1=fakesig',
  });
  if (contentType !== null) {
    headers.set('content-type', contentType);
  }
  return new Request('https://worker.example.com/api/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

describe('Webhook Content-Type validation', () => {
  it('should reject requests with no Content-Type header', async () => {
    const req = makeWebhookRequest(null);
    // Remove content-type entirely
    req.headers.delete('content-type');
    const resp = await worker.fetch(req, env);
    expect(resp.status).toBe(415);
    expect(await resp.text()).toBe('Invalid Content-Type');
  });

  it('should reject requests with text/html Content-Type', async () => {
    const req = makeWebhookRequest('text/html');
    const resp = await worker.fetch(req, env);
    expect(resp.status).toBe(415);
  });

  it('should reject requests with multipart/form-data Content-Type', async () => {
    const req = makeWebhookRequest('multipart/form-data');
    const resp = await worker.fetch(req, env);
    expect(resp.status).toBe(415);
  });

  it('should reject requests with application/x-www-form-urlencoded Content-Type', async () => {
    const req = makeWebhookRequest('application/x-www-form-urlencoded');
    const resp = await worker.fetch(req, env);
    expect(resp.status).toBe(415);
  });

  it('should accept requests with application/json Content-Type', async () => {
    const req = makeWebhookRequest('application/json');
    const resp = await worker.fetch(req, env);
    // Should pass Content-Type check and fail later (missing sig is fine — we're testing the gate)
    expect(resp.status).not.toBe(415);
  });

  it('should accept requests with text/plain Content-Type', async () => {
    const req = makeWebhookRequest('text/plain');
    const resp = await worker.fetch(req, env);
    expect(resp.status).not.toBe(415);
  });

  it('should accept application/json with charset parameter', async () => {
    const req = makeWebhookRequest('application/json; charset=utf-8');
    const resp = await worker.fetch(req, env);
    expect(resp.status).not.toBe(415);
  });

  it('should accept text/plain with charset parameter', async () => {
    const req = makeWebhookRequest('text/plain;charset=utf-8');
    const resp = await worker.fetch(req, env);
    expect(resp.status).not.toBe(415);
  });
});
