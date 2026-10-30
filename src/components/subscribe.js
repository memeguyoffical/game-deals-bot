// 🔔 Get Sale Alerts button — toggles the Game Deals role.

import { ephemeral } from '../util.js';
import { getGuildSettings } from '../db.js';
import { addMemberRole, removeMemberRole } from '../discord.js';
import { isGuildAllowed, permissionHelp } from '../util.js';

export async function handleSubscribeButton(interaction, env) {
  if (!isGuildAllowed(env, interaction.guild_id)) {
    return ephemeral('🚫 This bot is private.');
  }
  const settings = await getGuildSettings(env, interaction.guild_id);
  if (!settings) {
    return ephemeral('⚠️ Sale alerts are not set up in this server yet — ask an admin to run `/deals setup`.');
  }

  const userId = interaction.member?.user?.id;
  const hasRole = (interaction.member?.roles ?? []).includes(settings.role_id);

  try {
    if (hasRole) {
      await removeMemberRole(env, interaction.guild_id, userId, settings.role_id);
      return ephemeral('🔕 **Unsubscribed** — the Game Deals role was removed. You will no longer get sale pings.');
    }
    await addMemberRole(env, interaction.guild_id, userId, settings.role_id);
    return ephemeral('🔔 **Subscribed!** You now have the Game Deals role and will be pinged when games go on sale. The alerts channel should now be visible to you. Click the button again anytime to unsubscribe.');
  } catch (err) {
    // Internal Discord error details stay server-side.
    console.error('role toggle failed:', err);
    return ephemeral(
      permissionHelp(
        '❌ **Could not update your role.**',
        'The bot needs **Manage Roles**, and its role must sit above the Game Deals role.',
      ),
    );
  }
}
