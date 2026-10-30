// /deals command: setup · settings · now

import { ROLE_NAME, ROLE_COLOR, STORES } from '../config.js';
import { json, ephemeral, deferredEphemeral, hasManageGuild, isGuildAllowed, permissionHelp, PERMISSIONS_LINE } from '../util.js';
import { findOrCreateDealsRole, sendMessage, editOriginalResponse, getBotUserId, createChannel, lockChannelToRole, unlockChannel, makeChannelReadonly, channelExists, messageExists } from '../discord.js';
import {
  getGuildSettings,
  upsertGuildSettings,
  patchGuildSettings,
  getRecentDeals,
  rowToDeal,
} from '../db.js';
import { optInMessagePayload, buildDealEmbed } from '../embeds.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const optsToMap = (sub) => Object.fromEntries((sub?.options ?? []).map((o) => [o.name, o.value]));
const storesLine = (s) =>
  Object.values(STORES).map((m) => `${s[m.enabledKey] ? '✅' : '❌'} ${m.emoji ?? ''} ${m.name}`).join('  ·  ');

export function handleDealsCommand(interaction, env, ctx) {
  const sub = interaction.data?.options?.[0];
  if (!sub) return ephemeral('❓ Unknown subcommand.');

  if (!isGuildAllowed(env, interaction.guild_id)) {
    return ephemeral('🚫 This bot is private. It only works in servers the owner added it to.');
  }

  if ((sub.name === 'setup' || sub.name === 'settings') && !hasManageGuild(interaction)) {
    return ephemeral(`🚫 You need the **Manage Server** permission to use \`/deals ${sub.name}\`.`);
  }

  switch (sub.name) {
    case 'setup':
      ctx.waitUntil(doSetup(interaction, env, sub));
      return deferredEphemeral();
    case 'settings':
      ctx.waitUntil(doSettings(interaction, env, sub));
      return deferredEphemeral();
    case 'now':
      return doNow(interaction, env);
    default:
      return ephemeral('❓ Unknown subcommand.');
  }
}

async function doSetup(interaction, env, sub) {
  const reply = (payload) => editOriginalResponse(env, interaction.token, payload);
  try {
    const guildId = interaction.guild_id;
    const o = optsToMap(sub);
    const minDiscount = clamp(o.min_discount ?? 50, 1, 100);
    const steam = o.steam ?? true;
    const epic = o.epic ?? true;
    const xbox = o.xbox ?? true;
    const steamFree = o.steam_free ?? true;
    const gog = o.gog ?? true;
    const scanMinutes = clamp(o.scan_minutes ?? 30, 5, 1440);

    // 1) create (or reuse) the 🎮 Game Deals role
    const current = await getGuildSettings(env, guildId);
    const role = await findOrCreateDealsRole(env, guildId, ROLE_NAME, ROLE_COLOR);
    const botId = await getBotUserId(env);

    // 2) alerts channel — explicit option, then the existing one, then a new one.
    // Re-running setup must not leave a trail of duplicate channels behind.
    let alertsChannelId = o.channel ?? current?.channel_id ?? null;
    if (alertsChannelId && !(await channelExists(env, alertsChannelId))) alertsChannelId = null;
    if (!alertsChannelId) alertsChannelId = (await createChannel(env, guildId, 'game-deals')).id;
    await lockChannelToRole(env, alertsChannelId, guildId, role.id, botId);
    if (current?.channel_id && current.channel_id !== alertsChannelId) {
      await unlockChannel(env, current.channel_id, guildId, current.role_id, botId);
    }

    // 3) public opt-in channel — reuse the channel and message when they still
    // exist, so a second /deals setup does not create duplicates or re-post.
    let optinChannelId = current?.optin_channel_id ?? null;
    if (optinChannelId && !(await channelExists(env, optinChannelId))) optinChannelId = null;
    if (!optinChannelId) optinChannelId = (await createChannel(env, guildId, 'get-sale-alerts')).id;
    await makeChannelReadonly(env, optinChannelId, guildId, botId);

    let optinMessageId = current?.optin_message_id ?? null;
    if (optinMessageId && !(await messageExists(env, optinChannelId, optinMessageId))) {
      optinMessageId = null;
    }
    if (!optinMessageId) {
      const optin = await sendMessage(env, optinChannelId, optInMessagePayload());
      optinMessageId = optin?.id ?? null;
    }

    // 4) save everything
    const settings = {
      guild_id: guildId,
      channel_id: alertsChannelId,
      role_id: role.id,
      min_discount: minDiscount,
      steam_enabled: steam ? 1 : 0,
      epic_enabled: epic ? 1 : 0,
      xbox_enabled: xbox ? 1 : 0,
      steam_free_enabled: steamFree ? 1 : 0,
      gog_enabled: gog ? 1 : 0,
      optin_message_id: optinMessageId,
      optin_channel_id: optinChannelId,
      scan_minutes: scanMinutes,
    };
    await upsertGuildSettings(env, settings);

    await reply({
      content: [
        '✅ **Game sale alerts are set up!**',
        '',
        `• **Alerts channel:** <#${alertsChannelId}> (only visible to members with the role)`,
        `• **Subscribe channel:** <#${optinChannelId}> (where members click 🔔 to join)`,
        `• **Alert role:** <@&${role.id}>`,
        `• **Minimum discount:** ${minDiscount}% (free games always included)`,
        `• **Stores:** ${storesLine(settings)}`,
        '',
        'Members click **🔔 Get Sale Alerts** in the subscribe channel to subscribe — the alerts channel then appears for them.',
        'The scanner runs every 5 minutes (your server interval applies to sale alerts; free games always post immediately).',
        '',
        `🔧 Bot permissions in use: ${PERMISSIONS_LINE}`,
      ].join('\n'),
    });
  } catch (err) {
    // Internal detail (status codes, channel/role IDs, API bodies) stays in logs.
    console.error('setup failed:', err);
    await reply({
      content: permissionHelp('❌ **Setup could not be finished.**'),
    });
  }
}

async function doSettings(interaction, env, sub) {
  const reply = (payload) => editOriginalResponse(env, interaction.token, payload);
  const guildId = interaction.guild_id;

  const current = await getGuildSettings(env, guildId);
  if (!current) return reply({ content: '⚠️ Sale alerts are not set up yet — run `/deals setup` first.' });

  const o = optsToMap(sub);
  const patch = {};
  if (o.channel !== undefined) {
    patch.channel_id = o.channel;
    try {
      const botId = await getBotUserId(env);
      await lockChannelToRole(env, o.channel, guildId, current.role_id, botId);
      if (current.channel_id && current.channel_id !== o.channel) {
        await unlockChannel(env, current.channel_id, guildId, current.role_id, botId);
      }
    } catch (err) {
      console.error('channel lock failed:', err);
      return reply({
        content: permissionHelp(
          '❌ **That channel could not be locked to the Game Deals role.**',
          'The bot needs **Manage Channels** and **Manage Roles** in that channel.',
        ),
      });
    }
  }
  if (o.min_discount !== undefined) patch.min_discount = clamp(o.min_discount, 1, 100);
  if (o.steam !== undefined) patch.steam_enabled = o.steam ? 1 : 0;
  if (o.epic !== undefined) patch.epic_enabled = o.epic ? 1 : 0;
  if (o.xbox !== undefined) patch.xbox_enabled = o.xbox ? 1 : 0;
  if (o.steam_free !== undefined) patch.steam_free_enabled = o.steam_free ? 1 : 0;
  if (o.gog !== undefined) patch.gog_enabled = o.gog ? 1 : 0;
  if (o.scan_minutes !== undefined) patch.scan_minutes = clamp(o.scan_minutes, 5, 1440);

  if (Object.keys(patch).length) await patchGuildSettings(env, guildId, patch);
  const s = await getGuildSettings(env, guildId);

  await reply({
    content: [
      Object.keys(patch).length ? '✅ **Settings updated.**' : '⚙️ **Current settings** (add options to change them):',
      '',
      `• **Alerts channel:** <#${s.channel_id}>`,
      `• **Role:** <@&${s.role_id}>`,
      `• **Minimum discount:** ${s.min_discount}%`,
      `• **Scan interval:** every ${s.scan_minutes ?? 30} minutes`,
      `• **Stores:** ${storesLine(s)}`,
    ].join('\n'),
  });
}

async function doNow(interaction, env) {
  const settings = await getGuildSettings(env, interaction.guild_id);
  if (!settings) {
    return ephemeral('⚠️ Sale alerts are not set up yet — an admin needs to run `/deals setup`.');
  }
  const hasRole = (interaction.member?.roles ?? []).includes(settings.role_id);
  if (!hasRole) {
    return ephemeral('🔒 `/deals now` is only for members with the **Game Deals** role. Click **🔔 Get Sale Alerts** in the subscribe channel first!');
  }
  const rows = await getRecentDeals(env);

  let deals = rows.map(rowToDeal);
  if (settings) deals = deals.filter((d) => settings[STORES[d.store]?.enabledKey]);
  const threshold = Math.min(settings?.min_discount ?? 0, 50);
  deals = deals.filter((d) => d.discountPct >= threshold).slice(0, 5);

  if (!deals.length) {
    return ephemeral('😴 No deals tracked yet — the scanner runs every 5 minutes. Check back soon!');
  }

  return json({
    type: 4,
    data: {
      content: '🎮 **Current top deals:**',
      embeds: deals.map(buildDealEmbed),
      // one action row per deal so each Buy button lines up with its embed
      components: deals.map((d) => ({
        type: 1,
        components: [{ type: 2, style: 5, label: `🛒 ${d.title}`.slice(0, 80), url: d.url }],
      })),
      flags: 64,
    },
  });
}
