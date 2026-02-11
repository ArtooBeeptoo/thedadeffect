# Stripe Webhook IP Allowlisting (Cloudflare WAF)

Optional but recommended: restrict `/api/webhook` to Stripe's published IP ranges using Cloudflare WAF rules.

## Stripe's Webhook IPs

Stripe publishes their webhook source IPs at:
https://stripe.com/docs/ips#webhook-notifications

As of 2025, these include:
- `3.18.12.63`
- `3.130.192.163`
- `13.235.14.237`
- `13.235.122.149`
- `18.211.135.69`
- `35.154.171.200`
- `52.15.183.38`
- `54.88.130.119`
- `54.88.130.237`
- `54.187.174.169`
- `54.187.205.235`
- `54.187.216.72`

**Always check the official docs** — these IPs can change.

## Cloudflare WAF Rule Setup

1. Go to **Cloudflare Dashboard → Security → WAF → Custom Rules**
2. Create a new rule:
   - **Name:** `Block non-Stripe webhook requests`
   - **Expression:**
     ```
     (http.request.uri.path eq "/api/webhook" and not ip.src in {3.18.12.63 3.130.192.163 13.235.14.237 13.235.122.149 18.211.135.69 35.154.171.200 52.15.183.38 54.88.130.119 54.88.130.237 54.187.174.169 54.187.205.235 54.187.216.72})
     ```
   - **Action:** Block

3. Deploy the rule.

## Why This Matters

Even with signature verification, IP allowlisting adds defense-in-depth:
- Reduces attack surface (blocks probing/fuzzing from non-Stripe IPs)
- Prevents potential timing attacks against signature verification
- Stops resource waste from processing bogus payloads

## Maintenance

Subscribe to Stripe's IP change notifications or check periodically.
Update the WAF rule when Stripe adds/removes IPs.
