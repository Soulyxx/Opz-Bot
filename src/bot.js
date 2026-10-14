'use strict';
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Events
} = require('discord.js');

const clean = (s) => String(s || '-').replace(/`/g, "'").slice(0, 60);

function startBot(store) {
  const TOKEN = process.env.DISCORD_TOKEN;
  const OWNER = process.env.OWNER_ID;
  const CHAN = process.env.PANEL_CHANNEL_ID;
  const ADMINS = String(process.env.ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);

  if (!TOKEN || !OWNER || !CHAN) {
    console.warn('[bot] faltan DISCORD_TOKEN / OWNER_ID / PANEL_CHANNEL_ID -> bot desactivado');
    return Promise.resolve(null);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  const isStaff = (id) => id === OWNER || ADMINS.includes(id);
  const getChannel = async () => client.channels.fetch(CHAN).catch(() => null);

  const embedFor = (u) => new EmbedBuilder()
    .setTitle('Hook Slx - Access Request')
    .addFields(
      { name: 'HWID', value: '`' + u.hwid + '`' },
      { name: 'User', value: clean(u.name), inline: true },
      { name: 'Version', value: clean(u.version), inline: true },
      { name: 'Status', value: String(u.status || 'pending'), inline: true }
    )
    .setColor(u.status === 'approved' ? 0x22c26e : (u.status === 'denied' || u.status === 'blacklist') ? 0xff4d5e : 0xf0a72c)
    .setFooter({ text: 'Hook Slx Auth' })
    .setTimestamp(new Date());

  const row = (hwid, done) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('acc:' + hwid).setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(!!done),
    new ButtonBuilder().setCustomId('den:' + hwid).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(!!done)
  );

  async function notifyNew(u) {
    const ch = await getChannel();
    if (!ch) { console.error('[bot] canal ' + CHAN + ' no encontrado'); return; }
    await ch.send({ content: `<@${OWNER}> nueva solicitud`, embeds: [embedFor(u)], components: [row(u.hwid)] })
      .catch((e) => console.error('[bot] post:', e.message));
  }

  client.on(Events.Error, (e) => console.error('[bot] client error:', e.message));
  client.on(Events.Warn, (m) => console.warn('[bot] warn:', m));

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (!i.isButton()) return;
      if (!isStaff(i.user.id)) return i.reply({ content: 'Solo el owner.', ephemeral: true });
      const [act, hwid] = i.customId.split(':');
      if (!store.get(hwid)) return i.reply({ content: 'No existe.', ephemeral: true });
      store.set(hwid, {
        status: act === 'acc' ? 'approved' : 'denied',
        decidedAt: Date.now(),
        decidedBy: i.user.tag
      });
      await i.update({ embeds: [embedFor(store.get(hwid))], components: [row(hwid, true)] }).catch(() => {});
    } catch (e) { console.error('[bot] interaction:', e.message); }
  });

  client.on(Events.MessageCreate, async (m) => {
    try {
      if (m.author.bot || !m.content.startsWith('!')) return;
      if (!isStaff(m.author.id) && m.channelId !== CHAN) return;
      const [cmd, ...args] = m.content.trim().slice(1).split(/\s+/);
      const arg = (args[0] || '').toUpperCase();
      const say = (t) => m.reply(t).catch(() => {});

      switch (cmd) {
        case 'help':
          return say([
            '**Hook Slx Auth**',
            '`!panel` resumen',
            '`!pending` pendientes',
            '`!users` todos',
            '`!active` aprobados',
            '`!blacklist` en blacklist',
            '`!find <texto>` buscar',
            '`!accept <HWID>` / `!deny <HWID>`',
            '`!black <HWID>` / `!unblack <HWID>` / `!remove <HWID>`',
            '`!reset <HWID>` volver a pendiente'
          ].join('\n'));
        case 'panel': {
          const ch = await getChannel(); if (!ch) return say('Canal no encontrado.');
          const u = store.list();
          const c = (s) => u.filter((x) => x.status === s).length;
          return ch.send({ embeds: [new EmbedBuilder()
            .setTitle('Hook Slx - Auth Panel')
            .setDescription(`Total: **${u.length}**\nAprobados: **${c('approved')}**\nPendientes: **${c('pending')}**\nDenegados: **${c('denied')}**\nBlacklist: **${c('blacklist')}**`)
            .setColor(0x3ea6ff).setTimestamp(new Date())] });
        }
        case 'pending': { const l = store.list().filter((x) => x.status === 'pending');
          return say(l.length ? l.map((x) => `\`${x.hwid}\` - ${clean(x.name)}`).join('\n') : 'Nada pendiente.'); }
        case 'users': { const l = store.list();
          return say(l.length ? l.slice(0, 40).map((x) => `\`${x.hwid}\` ${x.status}`).join('\n') : 'Vacio.'); }
        case 'active': { const l = store.list().filter((x) => x.status === 'approved');
          return say(l.length ? l.map((x) => `\`${x.hwid}\` ${clean(x.name)}`).join('\n') : 'Vacio.'); }
        case 'blacklist': { const l = store.list().filter((x) => x.status === 'blacklist');
          return say(l.length ? l.map((x) => `\`${x.hwid}\``).join('\n') : 'Vacio.'); }
        case 'find': {
          const q = args.join(' ').toUpperCase();
          const l = store.list().filter((x) => x.hwid.includes(q) || String(x.name || '').toUpperCase().includes(q));
          return say(l.length ? l.map((x) => `\`${x.hwid}\` ${clean(x.name)} ${x.status}`).join('\n') : 'Nada.');
        }
        case 'accept': case 'deny': case 'remove': case 'black': case 'unblack': case 'reset': {
          if (!arg) return say('Uso: !' + cmd + ' <HWID>');
          if (!store.get(arg) && cmd !== 'black') return say('No existe: ' + arg);
          if (cmd === 'accept') store.set(arg, { status: 'approved' });
          if (cmd === 'deny') store.set(arg, { status: 'denied' });
          if (cmd === 'reset') store.set(arg, { status: 'pending' });
          if (cmd === 'remove') { store.remove(arg); return say('OK: remove ' + arg); }
          if (cmd === 'black') store.set(arg, { status: 'blacklist' });
          if (cmd === 'unblack') store.set(arg, { status: 'pending' });
          return say('OK: ' + cmd + ' ' + arg);
        }
        default: return;
      }
    } catch (e) { console.error('[bot] message:', e.message); }
  });

  client.once(Events.ClientReady, async (c) => {
    console.log('[bot] logueado como ' + c.user.tag);
    const ch = await getChannel();
    if (!ch) console.warn('[bot] OJO: no encuentro el canal ' + CHAN + ' (revisa PANEL_CHANNEL_ID y que el bot este en ese server)');
    else console.log('[bot] canal de panel OK: #' + ch.name);
  });

  return client.login(TOKEN).then(() => ({ notifyNew }));
}

module.exports = { startBot };