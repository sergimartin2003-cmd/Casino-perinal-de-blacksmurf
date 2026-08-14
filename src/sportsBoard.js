// Panel clickable de apuestas deportivas.
// - Publica un mensaje por evento activo en el canal configurado, con botones
//   (Local / Empate / Visitante) y sus cuotas.
// - Al pulsar un boton pide la cantidad (modal) y coloca la apuesta.
// - Borra el mensaje cuando el evento termina o deja de estar activo.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const db = require('./database/db');
const SportsCache = require('./sportsCache');
const SportsBetting = require('./sportsBetting');
const { resolveBet } = require('./lib/bet');
const { getUser } = require('./lib/economy');
const config = require('./config');

const DB_PATH = './data/casino.db';
const cache = new SportsCache(DB_PATH);
const betting = new SportsBetting(DB_PATH);

const S = () => config.sports || {};

// --- Estado del panel (mensaje por evento) ---
const allBoardStmt = db.prepare('SELECT event_id, message_id FROM sports_board');
const oneBoardStmt = db.prepare('SELECT message_id FROM sports_board WHERE event_id = ?');
const upsertBoardStmt = db.prepare(
  `INSERT INTO sports_board (event_id, channel_id, message_id) VALUES (?, ?, ?)
   ON CONFLICT(event_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`
);
const delBoardStmt = db.prepare('DELETE FROM sports_board WHERE event_id = ?');

const sportEmoji = (s) => (s === 'football' ? '⚽' : s === 'basketball' ? '🏀' : s === 'tennis' ? '🎾' : '🏟️');

/** Saca las cuotas moneyline (del primer bookmaker) de un evento. */
function moneyline(eventId) {
  const odds = cache.getFormattedOdds(eventId);
  if (!odds || !odds.markets) return {};
  const bk = Object.keys(odds.markets)[0];
  return (bk && odds.markets[bk].moneyline) || {};
}

// Formatea una cuota (1.85) o pone '—' si no hay.
const odd = (v) => (v ? Number(v).toFixed(2) : '—');

/** Construye el embed + botones de un evento. */
function renderEvent(event) {
  const ml = moneyline(event.id);
  const when = event.start_time ? new Date(event.start_time).toLocaleString('es-ES') : 'Por confirmar';
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`${sportEmoji(event.sport)} ${event.home_team} vs ${event.away_team}`)
    .setDescription(`🏷️ ${event.league || 'Liga'}\n📅 ${when}`)
    .setFooter({ text: `Evento ${event.id}` });

  const row = new ActionRowBuilder();
  if (ml.home) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`sbet:home:${event.id}`).setLabel(`1 · ${event.home_team} (${odd(ml.home)})`.slice(0, 80)).setStyle(ButtonStyle.Success)
    );
  }
  if (ml.draw) {
    row.addComponents(new ButtonBuilder().setCustomId(`sbet:draw:${event.id}`).setLabel(`X · Empate (${odd(ml.draw)})`.slice(0, 80)).setStyle(ButtonStyle.Secondary));
  }
  if (ml.away) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`sbet:away:${event.id}`).setLabel(`2 · ${event.away_team} (${odd(ml.away)})`.slice(0, 80)).setStyle(ButtonStyle.Primary)
    );
  }
  if (row.components.length === 0) {
    embed.addFields({ name: '💸 Cuotas', value: '_Aún sin cuotas. En cuanto la casa las publique, aparecerán los botones para apostar._' });
    return { embeds: [embed], components: [] };
  }
  // Muestra las cuotas también en el texto y explica cómo apostar (más claro).
  const cuotas = [
    `**1** (gana ${event.home_team}): \`${odd(ml.home)}\``,
    ml.draw ? `**X** (empate): \`${odd(ml.draw)}\`` : null,
    `**2** (gana ${event.away_team}): \`${odd(ml.away)}\``,
  ].filter(Boolean).join('\n');
  embed.addFields(
    { name: '💸 Cuotas (moneyline)', value: cuotas },
    { name: 'ℹ️ Cómo apostar', value: 'Pulsa un botón (1 / X / 2), escribe cuánto y listo. Si aciertas cobras **apuesta × cuota**.' }
  );
  return { embeds: [embed], components: [row] };
}

/** Sincroniza el panel: publica nuevos, refresca existentes y borra los que ya no van. */
async function sync(client) {
  const channelId = S().boardChannel;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const active = cache.getActiveEvents(null, 25);
  const activeIds = new Set(active.map((e) => e.id));

  // 1) Borra mensajes de eventos que ya NO están activos (terminados/pasados).
  for (const row of allBoardStmt.all()) {
    if (!activeIds.has(row.event_id)) {
      await channel.messages.delete(row.message_id).catch(() => {});
      delBoardStmt.run(row.event_id);
    }
  }

  // 2) Publica o refresca los eventos activos.
  for (const event of active) {
    const view = renderEvent(event);
    const existing = oneBoardStmt.get(event.id);
    if (existing?.message_id) {
      const msg = await channel.messages.fetch(existing.message_id).catch(() => null);
      if (msg) {
        await msg.edit(view).catch(() => {});
        continue;
      }
    }
    const msg = await channel.send(view).catch(() => null);
    if (msg) upsertBoardStmt.run(event.id, channelId, msg.id);
  }
}

/** Arranca el panel (llamar en ClientReady). */
function start(client) {
  if (!S().boardChannel) return;
  const tick = () => sync(client).catch((e) => console.error('[SportsBoard] Error:', e.message));
  tick();
  const timer = setInterval(tick, S().boardRefreshMs || 120000);
  if (timer.unref) timer.unref();
}

// --- Interacciones (botón -> modal -> apuesta) ---
// customId boton: sbet:<seleccion>:<eventId>   (eventId puede llevar ':')
function parseId(customId) {
  const parts = customId.split(':');
  return { selection: parts[1], eventId: parts.slice(2).join(':') };
}

async function handleBetButton(interaction) {
  const { selection, eventId } = parseId(interaction.customId);
  const event = cache.getEventById(eventId);
  if (!event || event.status === 'finished' || event.status === 'cancelled') {
    return interaction.reply({ content: '❌ Este evento ya no admite apuestas.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const modal = new ModalBuilder().setCustomId(`sbetamt:${selection}:${eventId}`).setTitle('Apostar');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('¿Cuánto apuestas? (monedas)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(15)
        .setPlaceholder('Ej: 100, all, half')
    )
  );
  return interaction.showModal(modal).catch(() => {});
}

async function handleBetModal(interaction) {
  const { selection, eventId } = parseId(interaction.customId);
  const event = cache.getEventById(eventId);
  if (!event || event.status === 'finished' || event.status === 'cancelled') {
    return interaction.reply({ content: '❌ Este evento ya no admite apuestas.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const ml = moneyline(eventId);
  const oddValue = ml[selection];
  if (!oddValue) {
    return interaction.reply({ content: '❌ Cuota no disponible para esa selección.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  getUser(interaction.user.id); // crea el usuario con saldo inicial si es su primera vez
  const balance = betting.getUserBalance(interaction.user.id);
  const r = resolveBet(interaction.fields.getTextInputValue('amount'), balance);
  if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral }).catch(() => {});

  try {
    const bet = betting.placeBet(interaction.user.id, eventId, 'moneyline', selection, oddValue, r.amount);
    const selName = selection === 'home' ? event.home_team : selection === 'away' ? event.away_team : 'Empate';
    return interaction
      .reply({
        content: `✅ Apostado **${r.amount}** a **${selName}** @${oddValue} (${event.home_team} vs ${event.away_team}).\n💰 Ganancia potencial: **${bet.potentialWinnings}** · Apuesta #${bet.betId}`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  } catch (e) {
    return interaction.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

module.exports = { start, sync, renderEvent, handleBetButton, handleBetModal };
