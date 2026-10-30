// Discord request signature verification (Ed25519) using Web Crypto —
// works in both Cloudflare Workers and Node 18+ (wrangler dev).

// Discord's recommendation: reject requests older than 5 minutes so a captured
// valid request can never be replayed later.
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

function hexToBytes(hex) {
  if (!hex || typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function verifyDiscordRequest(request, publicKeyHex) {
  const signature = hexToBytes(request.headers.get('x-signature-ed25519'));
  const timestamp = request.headers.get('x-signature-timestamp');
  const publicKey = hexToBytes(publicKeyHex);
  const body = await request.text();

  if (!signature || !timestamp || !publicKey) return { ok: false, body };

  // Replay protection: the timestamp must be recent (Discord sends seconds).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { ok: false, body };
  }

  try {
    const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      signature,
      new TextEncoder().encode(timestamp + body),
    );
    return { ok, body };
  } catch {
    return { ok: false, body };
  }
}