// Stripe → Printful fulfillment bridge for thedadeffect.com
// Cloudflare Worker — no npm dependencies, pure fetch

// Product → Printful sync variant mapping
const PRODUCTS = {
  'sunset-walk': {
    name: 'The Dad Effect — Sunset Walk',
    price: 2899, // cents
    variants: {
      'S': 5171585280, 'M': 5171585281, 'L': 5171585282,
      'XL': 5171585283, '2XL': 5171585284
    }
  },
  'raising-legends': {
    name: 'The Dad Effect — Raising Legends',
    price: 2899,
    variants: {
      'S': 5171599590, 'M': 5171599591, 'L': 5171599592,
      'XL': 5171599593, '2XL': 5171599594
    }
  },
  'every-father': {
    name: 'The Dad Effect — Every Father',
    price: 2899,
    variants: {
      'S': 5171599672, 'M': 5171599673, 'L': 5171599674,
      'XL': 5171599675, '2XL': 5171599676
    }
  }
};

// --- Rate limiting (per-isolate, in-memory) ---

const RATE_LIMIT = {
  maxRequests: 10,    // max requests per window
  windowMs: 60_000,   // 1 minute window
};

// Map<string, { count: number, resetAt: number }>
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  // Clean up expired entries periodically (every 100 checks)
  if (Math.random() < 0.01) {
    for (const [key, val] of rateLimitMap) {
      if (val.resetAt <= now) rateLimitMap.delete(key);
    }
  }

  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1 };
  }

  entry.count++;
  if (entry.count > RATE_LIMIT.maxRequests) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  return { allowed: true, remaining: RATE_LIMIT.maxRequests - entry.count };
}

// Exported for testing
export { checkRateLimit, rateLimitMap, RATE_LIMIT };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://thedadeffect.com',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// --- Stripe helpers (raw fetch, no SDK) ---

async function stripeRequest(env, method, endpoint, body) {
  const resp = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method,
    headers: {
      'Authorization': `Basic ${btoa(env.STRIPE_SECRET_KEY + ':')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  return resp.json();
}

async function createCheckoutSession(env, product, size) {
  const params = {
    'mode': 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': product.price.toString(),
    'line_items[0][price_data][product_data][name]': `${product.name} (${size})`,
    'line_items[0][price_data][product_data][description]': 'Premium Bella + Canvas 3001 tee. DTG printed on black. Ships in 3-7 business days.',
    'line_items[0][quantity]': '1',
    'shipping_address_collection[allowed_countries][0]': 'US',
    'shipping_address_collection[allowed_countries][1]': 'CA',
    'shipping_address_collection[allowed_countries][2]': 'GB',
    'shipping_address_collection[allowed_countries][3]': 'AU',
    'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
    'shipping_options[0][shipping_rate_data][fixed_amount][amount]': '499',
    'shipping_options[0][shipping_rate_data][fixed_amount][currency]': 'usd',
    'shipping_options[0][shipping_rate_data][display_name]': 'Standard Shipping (3-7 business days)',
    'shipping_options[1][shipping_rate_data][type]': 'fixed_amount',
    'shipping_options[1][shipping_rate_data][fixed_amount][amount]': '0',
    'shipping_options[1][shipping_rate_data][fixed_amount][currency]': 'usd',
    'shipping_options[1][shipping_rate_data][display_name]': 'Free Shipping (orders $75+)',
    'metadata[product_slug]': Object.keys(PRODUCTS).find(k => PRODUCTS[k] === product),
    'metadata[size]': size,
    'success_url': 'https://thedadeffect.com/shop/?thanks=1',
    'cancel_url': 'https://thedadeffect.com/shop/',
  };
  return stripeRequest(env, 'POST', '/checkout/sessions', params);
}

async function retrieveCheckoutSession(env, sessionId) {
  return stripeRequest(env, 'GET', `/checkout/sessions/${sessionId}?expand[]=line_items&expand[]=shipping_details`);
}

// --- Constant-time string comparison (timing attack mitigation) ---

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Length mismatch is immediately wrong, but we still do constant-time work
  // to avoid leaking which input was shorter via timing
  const lengthMatch = a.length === b.length ? 1 : 0;
  // Always compare using a's length worth of iterations
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  }
  return lengthMatch === 1 && mismatch === 0;
}

// --- Stripe webhook signature verification (Web Crypto) ---

async function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = {};
  for (const item of sigHeader.split(',')) {
    const [key, value] = item.split('=');
    parts[key.trim()] = value.trim();
  }
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return null;

  // Check timestamp (reject if > 5 min old)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return null;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (!timingSafeEqual(expected, signature)) return null;
  return JSON.parse(payload);
}

// --- Printful helpers ---

async function createPrintfulOrder(env, session) {
  const slug = session.metadata?.product_slug;
  const size = session.metadata?.size;
  const product = PRODUCTS[slug];
  if (!product) throw new Error(`Unknown product: ${slug}`);
  const variantId = product.variants[size];
  if (!variantId) throw new Error(`Unknown size: ${size} for ${slug}`);

  const shipping = session.shipping_details || session.shipping;
  const address = shipping?.address || {};
  const name = shipping?.name || session.customer_details?.name || 'Customer';

  const orderData = {
    recipient: {
      name,
      address1: address.line1 || '',
      address2: address.line2 || '',
      city: address.city || '',
      state_code: address.state || '',
      zip: address.postal_code || '',
      country_code: address.country || 'US',
      email: session.customer_details?.email || '',
    },
    items: [{
      sync_variant_id: variantId,
      quantity: 1,
      retail_price: (product.price / 100).toFixed(2),
    }],
  };

  const resp = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.PRINTFUL_API_TOKEN}`,
      'X-PF-Store-Id': env.PRINTFUL_STORE_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderData),
  });

  const result = await resp.json();
  if (result.code !== 200) {
    throw new Error(`Printful error: ${JSON.stringify(result)}`);
  }
  return result;
}

// --- Request handler ---

async function handleCheckout(request, env) {
  // Rate limit by client IP
  const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const rateCheck = checkRateLimit(clientIP);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
      status: 429,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Retry-After': String(rateCheck.retryAfter),
      }
    });
  }

  const { product: slug, size } = await request.json();
  const product = PRODUCTS[slug];
  if (!product) {
    return new Response(JSON.stringify({ error: 'Unknown product' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  if (!product.variants[size]) {
    return new Response(JSON.stringify({ error: 'Invalid size' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const session = await createCheckoutSession(env, product, size);
  return new Response(JSON.stringify({ url: session.url }), {
    status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function handleWebhook(request, env) {
  const payload = await request.text();

  // SECURITY: Always require webhook secret to be configured
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return new Response('Webhook secret not configured', { status: 500 });
  }

  // SECURITY: Always require signature header
  const sigHeader = request.headers.get('stripe-signature');
  if (!sigHeader) {
    return new Response('Missing stripe-signature header', { status: 401 });
  }

  // Verify signature — rejects invalid/expired signatures
  const event = await verifyStripeSignature(payload, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!event) {
    return new Response('Invalid signature', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    try {
      const session = await retrieveCheckoutSession(env, event.data.object.id);
      const result = await createPrintfulOrder(env, session);
      console.log('Printful order created:', JSON.stringify(result));
    } catch (err) {
      console.error('Printful order failed:', JSON.stringify({
        error: err.message,
        event_id: event.id,
        session_id: event.data.object.id,
        timestamp: new Date().toISOString(),
      }));
      // Return 500 so Stripe retries the webhook — prevents silent order loss
      return new Response('Fulfillment failed', { status: 500 });
    }
  }

  return new Response('OK', { status: 200 });
}

// --- Worker entry point ---

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Routes
    if (url.pathname === '/api/checkout' && request.method === 'POST') {
      return handleCheckout(request, env);
    }
    if (url.pathname === '/api/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', products: Object.keys(PRODUCTS) }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};
