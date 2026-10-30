// Browser-based command registration — replaces the terminal script for
// zero-install setups. After deploying, the owner visits:
//   https://<worker>.workers.dev/setup?key=<SETUP_KEY>
// and this route registers /deals with Discord using the stored secrets.
//
// Hardening: constant-time key comparison, per-IP rate limiting, security
// headers, and an optional SETUP_DONE kill-switch that disables the route for good.

import { DEALS_COMMAND } from './commands/definitions.js';
import { PERMISSIONS_LINE } from './util.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  'Cache-Control': 'no-store',
};

const text = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  });

// Constant-time compare: hash both sides first (so length doesn't leak either),
// then XOR the digests so there is no early exit on the first differing byte.
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a ?? '')),
    crypto.subtle.digest('SHA-256', enc.encode(b ?? '')),
  ]);
  const A = new Uint8Array(ha);
  const B = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

// Simple in-memory token bucket: 5 attempts per 10 minutes per IP.
// Per-isolate (not global) — a speed bump against casual hammering.
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 10 * 60_000;
const attempts = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) ?? { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + ATTEMPT_WINDOW_MS;
  }
  entry.count += 1;
  attempts.set(ip, entry);

  // Opportunistic cleanup so the map can't grow without bound.
  if (attempts.size > 1000) {
    for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
  }
  return { blocked: entry.count > ATTEMPT_LIMIT, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
}

// Exactly the permissions the bot uses — no more. Kept in sync with BOT_ALLOW
// in discord.js and the text in util.js (PERMISSIONS_LINE).
const INVITE_PERMISSIONS =
  (1 << 10) + // View Channels
  (1 << 11) + // Send Messages
  (1 << 14) + // Embed Links
  (1 << 16) + // Read Message History
  (1 << 17) + // Mention @everyone, @here and All Roles
  (1 << 4) + //  Manage Channels (create + lock the two channels)
  (1 << 28); // Manage Roles (create and assign the Game Deals role)

export async function handleSetup(url, env, request) {
  // Kill-switch: once you're done registering commands, set SETUP_DONE=1 and
  // this route stops working entirely (delete the variable to re-enable).
  if (env.SETUP_DONE === '1' || env.SETUP_DONE === 'true') {
    return text(
      '🔒 Setup is disabled on this bot.\n\n(Set the SETUP_DONE variable to anything other than "1" in Cloudflare to re-enable it.)',
      403,
    );
  }

  if (!env.SETUP_KEY) {
    return text(
      '⚠️ SETUP_KEY is not configured.\n\nAdd it in the Cloudflare dashboard:\nWorker → Settings → Variables and Secrets → Add → type "Secret" → name SETUP_KEY → any random value.',
      500,
    );
  }

  const ip =
    request?.headers?.get('cf-connecting-ip') ??
    request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const limit = rateLimited(ip);
  if (limit.blocked) {
    return text(
      `⏳ Too many attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      429,
      { 'Retry-After': String(Math.max(1, limit.retryAfter)) },
    );
  }

  const provided = url.searchParams.get('key') ?? '';
  if (!(await safeEqual(provided, env.SETUP_KEY))) {
    return text('❌ Forbidden — missing or wrong ?key= parameter.', 403);
  }

  const res = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`,
    {
      method: 'PUT',
      headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([DEALS_COMMAND]),
    },
  );
  const body = await res.text();

  if (!res.ok) {
    // Keep the raw Discord response server-side; never echo it to the browser.
    console.error(`setup: command registration failed — HTTP ${res.status}: ${body.slice(0, 500)}`);
    return text(
      [
        `❌ Command registration failed (HTTP ${res.status}).`,
        '',
        'Check the **DISCORD_TOKEN** and **DISCORD_APPLICATION_ID** secrets in',
        'Cloudflare → your Worker → Settings → Variables and Secrets.',
        'If you recently reset the bot token, update DISCORD_TOKEN and try again.',
      ].join('\n'),
      500,
    );
  }

  const invite =
    `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_APPLICATION_ID}` +
    `&scope=bot+applications.commands&permissions=${INVITE_PERMISSIONS}`;

  return text([
    '✅ /deals command registered with Discord!',
    '',
    'Next steps:',
    `1. Invite the bot to your server: ${invite}`,
    '2. In your server, run: /deals setup',
    '3. Members click 🔔 Get Sale Alerts to subscribe.',
    '',
    'Bot permissions to enable on the bot role:',
    PERMISSIONS_LINE,
    '',
    '🔒 Recommended: set a SETUP_DONE variable to "1" in Cloudflare to close this page off.',
    'Note: global commands can take up to 1 hour to appear in Discord.',
  ].join('\n'));
}