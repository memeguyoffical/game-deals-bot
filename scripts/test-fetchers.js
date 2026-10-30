// Live self-test: pulls real deals from all three stores and prints a sample.
// Usage: node scripts/test-fetchers.js

import { fetchSteamDeals, fetchSteamRating } from '../src/stores/steam.js';
import { fetchEpicDeals } from '../src/stores/epic.js';
import { fetchXboxDeals } from '../src/stores/xbox.js';
import { buildDealEmbed } from '../src/embeds.js';
import { verifyDiscordRequest } from '../src/verify.js';

const show = (d) =>
  `  ${d.store.padEnd(5)} ${String(d.discountPct).padStart(3)}%  ₹${Math.round(d.originalPrice)} → ₹${Math.round(d.salePrice)}  ${d.title}${d.endsAt ? `  (ends ${d.endsAt.slice(0, 10)})` : ''}`;

let failures = 0;

for (const [name, fetcher] of [['Steam', fetchSteamDeals], ['Epic', fetchEpicDeals], ['Xbox', fetchXboxDeals]]) {
  try {
    const deals = await fetcher();
    console.log(`\n=== ${name}: ${deals.length} deals ===`);
    deals.slice(0, 3).forEach((d) => console.log(show(d)));
    if (deals.length) {
      const embed = buildDealEmbed(deals[0]);
      console.log(`  embed OK → "${embed.title}" | ${embed.description.split('\n')[0]}`);
    }
  } catch (e) {
    failures++;
    console.error(`\n=== ${name}: FAILED — ${e.message}`);
  }
}

// Steam rating enrichment
try {
  const rating = await fetchSteamRating('730'); // CS2
  console.log(`\nSteam rating lookup: ${rating ?? '(none)'}`);
} catch (e) {
  console.error(`Steam rating lookup failed: ${e.message}`);
}

// Signature verification round-trip with a real Ed25519 keypair
try {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pubHex = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = '{"type":1}';
  const sig = Buffer.from(
    await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(timestamp + body)),
  ).toString('hex');
  const req = new Request('https://example.com/', {
    method: 'POST',
    headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': timestamp },
    body,
  });
  const { ok } = await verifyDiscordRequest(req, pubHex);
  console.log(`Signature verification: ${ok ? 'OK' : 'FAILED'}`);
  if (!ok) failures++;
} catch (e) {
  failures++;
  console.error(`Signature verification failed: ${e.message}`);
}

console.log(failures ? `\n⚠️ ${failures} test(s) failed` : '\n✅ All self-tests passed');
process.exit(failures ? 1 : 0);
