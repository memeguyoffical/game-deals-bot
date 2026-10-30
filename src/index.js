// Game Deals Bot — Cloudflare Worker entry point.
//   fetch     → Discord interactions (slash commands + buttons)
//   scheduled → cron: scan stores and post deal alerts

import { verifyDiscordRequest } from './verify.js';
import { handleDealsCommand } from './commands/deals.js';
import { handleSubscribeButton } from './components/subscribe.js';
import { runDealEngine } from './dealEngine.js';
import { handleSetup } from './setup.js';
import { json, ephemeral } from './util.js';

// Hardening: reject oversized bodies before we ever read them into memory.
const MAX_BODY_BYTES = 128 * 1024;

// Hardening: conservative headers on every public (non-interaction) response.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  'Cache-Control': 'no-store',
};

const secured = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // One-time browser setup: registers /deals with Discord (protected by SETUP_KEY).
    if (request.method === 'GET' && url.pathname === '/setup') {
      return handleSetup(url, env, request);
    }

    if (request.method === 'GET') {
      return secured('🎮 Game Deals Bot is running. Set this URL as your Discord Interactions Endpoint.');
    }
    if (request.method !== 'POST' || url.pathname !== '/') {
      return secured('Not found', 404);
    }

    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return secured('payload too large', 413);
    }

    // Every interaction must carry a valid, recent Discord signature.
    const { ok, body } = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!ok) return secured('invalid request signature', 401);
    if (body.length > MAX_BODY_BYTES) return secured('payload too large', 413);

    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return secured('bad request body', 400);
    }

    // Discord endpoint handshake
    if (interaction.type === 1) return json({ type: 1 });

    // Slash commands
    if (interaction.type === 2 && interaction.data?.name === 'deals') {
      return handleDealsCommand(interaction, env, ctx);
    }

    // Buttons
    if (interaction.type === 3 && interaction.data?.custom_id === 'deals_subscribe') {
      return handleSubscribeButton(interaction, env);
    }

    return ephemeral('❓ Unknown interaction.');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDealEngine(env));
  },
};
