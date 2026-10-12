'use strict';
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('./db');
const keys = require('./keys');

const ADMINS = (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ADMIN_ROLE = process.env.ADMIN_ROLE_ID || '';
const ep = { flags: MessageFlags.Ephemeral };
const isAdmin = (i) => ADMINS.includes(i.user.id) || (ADMIN_ROLE && i.member && i.member.roles.cache.has(ADMIN_ROLE));

async function initBot() {
  const TOKEN = process.env.DISCORD_TOKEN;
  if (!TOKEN) return console.log('[bot] off');
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], partials: [Partials.GuildMember] });
  const cmds = [
    new SlashCommandBuilder().setName('gen').setDescription('Generate keys')
      .addIntegerOption((o) => o.setName('amount').setDescription('How many').setMinValue(1).setMaxValue(50))
      .addStringOption((o) => o.setName('plan').setDescription('Plan').addChoices(
        { name: 'trial (1d)', value: 'trial' }, { name: 'week (7d)', value: 'week' },
        { name: 'month (30d)', value: 'month' }, { name: 'lifetime', value: 'lifetime' }))
      .addStringOption((o) => o.setName('duration').setDescription('Custom e.g. 12h, 3d, 2w'))
      .addUserOption((o) => o.setName('user').setDescription('Owner'))
      .addStringOption((o) => o.setName('note').setDescription('Note')),
    new SlashCommandBuilder().setName('keys').setDescription('List keys').addStringOption((o) => o.setName('status').setDescription('status')),
    new SlashCommandBuilder().setName('revoke').setDescription('Revoke a key').addStringOption((o) => o.setName('key').setRequired(true)),
    new SlashCommandBuilder().setName('reset').setDescription('Reset HWID').addStringOption((o) => o.setName('key').setRequired(true)),
    new SlashCommandBuilder().setName('extend').setDescription('Extend a key').addStringOption((o) => o.setName('key').setRequired(true)).addStringOption((o) => o.setName('duration').setRequired(true))
  ];

  client.once('ready', async () => {
    const guild = process.env.GUILD_ID;
    if (guild) await client.application.commands.set(cmds, guild).catch(() => {});
    else await client.application.commands.set(cmds).catch(() => {});
    console.log('[bot] ' + client.user.tag);
  });

  client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    if (!isAdmin(i)) return i.reply({ content: 'No permission', ...ep });
    const cmd = i.commandName;
    try {
      if (cmd === 'gen') {
        const amount = i.options.getInteger('amount') || 1;
        const plan = i.options.getString('plan') || 'month';
        const dur = i.options.getString('duration');
        const owner = i.options.getUser('user');
        const ms = dur ? keys.parseDuration(dur) : (keys.PLANS[plan] ?? null) * 864e5;
        if (ms === undefined) return i.reply({ content: 'Bad duration', ...ep });
        const made = [];
        for (let n = 0; n < amount; n++) {
          const key = keys.gen();
          await db.insertKey({ key, plan, created_at: Date.now(), expires_at: ms == null ? null : Date.now() + ms,
            owner: owner ? owner.id : null, avatar: owner ? owner.displayAvatarURL({ size: 128 }) : null,
            note: i.options.getString('note') || null, created_by: i.user.id });
          made.push(key);
        }
        const emb = new EmbedBuilder().setTitle(`${made.length} key(s) generated`).setColor(0x6d8bff)
          .setDescription(made.map((k) => '`' + k + '`').join('\n').slice(0, 4000));
        i.reply({ embeds: [emb], ...ep });
      } else if (cmd === 'keys') {
        const { rows } = await db.listKeys({ status: i.options.getString('status'), perPage: 15 });
        const emb = new EmbedBuilder().setTitle('Keys').setColor(0x6d8bff)
          .setDescription(rows.map((r) => `\`${r.key}\` · ${r.plan} · ${r.status} · ${r.hwid ? 'bound' : 'free'}`).join('\n').slice(0, 4000) || 'none');
        i.reply({ embeds: [emb], ...ep });
      } else if (cmd === 'revoke') {
        const k = keys.normalize(i.options.getString('key'));
        await db.updateKey(k, { status: 'revoked' }); await db.dropKeySessions(k); await db.log(k, 'revoke', i.user.id);
        i.reply({ content: 'Revoked `' + k + '`', ...ep });
      } else if (cmd === 'reset') {
        const k = keys.normalize(i.options.getString('key'));
        await db.updateKey(k, { hwid: null }); await db.dropKeySessions(k); await db.log(k, 'reset-hwid', i.user.id);
        i.reply({ content: 'HWID reset for `' + k + '`', ...ep });
      } else if (cmd === 'extend') {
        const k = keys.normalize(i.options.getString('key'));
        const rec = await db.getKey(k);
        const ms = keys.parseDuration(i.options.getString('duration'));
        if (!rec || !ms) return i.reply({ content: 'Bad key/duration', ...ep });
        await db.updateKey(k, { expires_at: Math.max(Date.now(), Number(rec.expires_at) || 0) + ms, status: 'active' });
        i.reply({ content: 'Extended `' + k + '`', ...ep });
      }
    } catch (e) { i.reply({ content: 'Error: ' + e.message, ...ep }).catch(() => {}); }
  });

  await client.login(TOKEN).catch((e) => console.error('[bot]', e.message));
}

module.exports = { initBot };