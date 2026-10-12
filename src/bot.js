'use strict';
const {
  Client, GatewayIntentBits, Partials, Events,
  SlashCommandBuilder, EmbedBuilder, MessageFlags
} = require('discord.js');
const db = require('./db');
const keys = require('./keys');

const ADMINS = (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ADMIN_ROLE = process.env.ADMIN_ROLE_ID || '';
const GUILD = (process.env.GUILD_ID || '').trim();
const EP = { flags: MessageFlags.Ephemeral };

/* ── definición de comandos ─────────────────────────── */
function buildCommands() {
  return [
    new SlashCommandBuilder().setName('gen').setDescription('Generar keys de licencia')
      .addIntegerOption((o) => o.setName('amount').setDescription('Cantidad (1-50)').setMinValue(1).setMaxValue(50))
      .addStringOption((o) => o.setName('plan').setDescription('Plan').addChoices(
        { name: 'trial (1 día)', value: 'trial' },
        { name: 'week (7 días)', value: 'week' },
        { name: 'month (30 días)', value: 'month' },
        { name: 'lifetime', value: 'lifetime' }))
      .addStringOption((o) => o.setName('duration').setDescription('Duración custom: 12h, 3d, 2w, 1mo'))
      .addUserOption((o) => o.setName('user').setDescription('Dueño de la key'))
      .addStringOption((o) => o.setName('note').setDescription('Nota')),

    new SlashCommandBuilder().setName('keys').setDescription('Listar keys')
      .addStringOption((o) => o.setName('status').setDescription('active | revoked')),

    new SlashCommandBuilder().setName('revoke').setDescription('Revocar una key')
      .addStringOption((o) => o.setName('key').setDescription('LOST-XXXX-XXXX-XXXX').setRequired(true)),

    new SlashCommandBuilder().setName('reset').setDescription('Resetear el HWID de una key')
      .addStringOption((o) => o.setName('key').setDescription('LOST-XXXX-XXXX-XXXX').setRequired(true)),

    new SlashCommandBuilder().setName('extend').setDescription('Extender una key')
      .addStringOption((o) => o.setName('key').setDescription('LOST-XXXX-XXXX-XXXX').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('12h, 3d, 2w...').setRequired(true)),

    new SlashCommandBuilder().setName('delete').setDescription('Eliminar una key')
      .addStringOption((o) => o.setName('key').setDescription('LOST-XXXX-XXXX-XXXX').setRequired(true))
  ];
}

async function isAdmin(i) {
  if (ADMINS.includes(i.user.id)) return true;
  if (!ADMIN_ROLE) return false;
  const member = (i.member && i.member.roles) ? i.member : await i.guild.members.fetch(i.user.id).catch(() => null);
  return !!(member && member.roles.cache.has(ADMIN_ROLE));
}

/* ── registro de comandos ───────────────────────────── */
async function register(client) {
  const body = buildCommands().map((c) => c.toJSON());
  await client.application.fetch();

  if (GUILD) {
    const guild = await client.guilds.fetch(GUILD).catch(() => null);
    if (!guild) throw new Error(`GUILD_ID ${GUILD} inválido o el bot no está en ese server`);
    await guild.commands.set(body);
    await client.application.commands.set([]); // limpia globales para no duplicar
    console.log(`[bot] ${body.length} comandos registrados en guild "${guild.name}" (instantáneo)`);
  } else {
    await client.application.commands.set(body);
    console.log(`[bot] ${body.length} comandos GLOBALES (pueden tardar hasta 1 hora)`);
  }

  const invite = `https://discord.com/oauth2/authorize?client_id=${client.user.id}` +
    `&scope=bot%20applications.commands&permissions=18432`;
  console.log('[bot] Invitá al bot con ESTE link (scope applications.commands):');
  console.log('      ' + invite);
}

/* ── handlers ───────────────────────────────────────── */
function wire(client) {
  client.once(Events.ClientReady, async () => {
    console.log(`[bot] conectado como ${client.user.tag}`);
    try { await register(client); }
    catch (e) { console.error('[bot] registro de comandos falló:', e.message); }
  });

  client.on(Events.Error, (e) => console.error('[bot] error:', e.message));
  client.on(Events.Warn, (m) => console.warn('[bot] warn:', m));

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand()) return;
    if (!(await isAdmin(i))) return i.reply({ content: 'No tenés permiso.', ...EP });

    const cmd = i.commandName;
    try {
      if (cmd === 'gen') {
        const amount = i.options.getInteger('amount') || 1;
        const plan = i.options.getString('plan') || 'month';
        const dur = i.options.getString('duration');
        const owner = i.options.getUser('user');
        const ms = dur ? keys.parseDuration(dur) : (keys.PLANS[plan] ?? null) * 864e5;
        if (ms === undefined) return i.reply({ content: 'Duración inválida.', ...EP });

        const made = [];
        for (let n = 0; n < amount; n++) {
          const key = keys.gen();
          await db.insertKey({
            key, plan, created_at: Date.now(),
            expires_at: ms == null ? null : Date.now() + ms,
            owner: owner ? owner.id : null,
            avatar: owner ? owner.displayAvatarURL({ size: 128 }) : null,
            note: i.options.getString('note') || null,
            created_by: i.user.id
          });
          made.push(key);
        }
        const emb = new EmbedBuilder()
          .setTitle(`${made.length} key(s) generada(s)`)
          .setColor(0x6d8bff)
          .setDescription(made.map((k) => '`' + k + '`').join('\n').slice(0, 4000));
        return i.reply({ embeds: [emb], ...EP });
      }

      if (cmd === 'keys') {
        const { rows } = await db.listKeys({ status: i.options.getString('status'), perPage: 15 });
        const emb = new EmbedBuilder().setTitle('Keys').setColor(0x6d8bff)
          .setDescription(rows.map((r) => `\`${r.key}\` · ${r.plan} · ${r.status} · ${r.hwid ? 'bound' : 'free'}`).join('\n').slice(0, 4000) || 'ninguna');
        return i.reply({ embeds: [emb], ...EP });
      }

      const k = keys.normalize(i.options.getString('key'));

      if (cmd === 'revoke') {
        await db.updateKey(k, { status: 'revoked' });
        await db.dropKeySessions(k);
        await db.log(k, 'revoke', i.user.id);
        return i.reply({ content: 'Revocada `' + k + '`', ...EP });
      }
      if (cmd === 'reset') {
        await db.updateKey(k, { hwid: null });
        await db.dropKeySessions(k);
        await db.log(k, 'reset-hwid', i.user.id);
        return i.reply({ content: 'HWID reseteado para `' + k + '`', ...EP });
      }
      if (cmd === 'extend') {
        const rec = await db.getKey(k);
        const ms = keys.parseDuration(i.options.getString('duration'));
        if (!rec || !ms) return i.reply({ content: 'Key o duración inválida.', ...EP });
        await db.updateKey(k, { expires_at: Math.max(Date.now(), Number(rec.expires_at) || 0) + ms, status: 'active' });
        await db.log(k, 'extend', i.options.getString('duration'));
        return i.reply({ content: 'Extendida `' + k + '`', ...EP });
      }
      if (cmd === 'delete') {
        await db.dropKeySessions(k);
        await db.deleteKey(k);
        await db.log(k, 'delete', i.user.id);
        return i.reply({ content: 'Eliminada `' + k + '`', ...EP });
      }
    } catch (e) {
      console.error('[bot] interaction', e);
      const body = { content: 'Error: ' + e.message, ...EP };
      if (i.replied || i.deferred) i.followUp(body).catch(() => {});
      else i.reply(body).catch(() => {});
    }
  });
}

/* ── init ───────────────────────────────────────────── */
async function initBot() {
  const TOKEN = (process.env.DISCORD_TOKEN || '').trim();
  if (!TOKEN) return console.log('[bot] off (sin DISCORD_TOKEN)');

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember]
  });
  wire(client);

  await client.login(TOKEN).catch((e) => console.error('[bot] login falló:', e.message));
}

module.exports = { initBot };
