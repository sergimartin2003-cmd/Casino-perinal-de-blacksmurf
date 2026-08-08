// Tablero del jackpot: un único mensaje fijo en un canal (config.jackpot.displayChannel)
// que muestra el bote EN VIVO y se autoedita cuando cambia.
const db = require('../database/db');
const { base } = require('./embeds');
const { fmt } = require('./format');
const { getJackpot, getLastJackpotWin } = require('./economy');
const config = require('../config');

const getBoardStmt = db.prepare('SELECT channel_id, message_id FROM jackpot_board WHERE id = 1');
const setBoardStmt = db.prepare(
  `INSERT INTO jackpot_board (id, channel_id, message_id) VALUES (1, ?, ?)
   ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`
);

let timer = null;
let lastShown = null;

function buildEmbed() {
  const sym = config.currency.symbol;
  const pct = Math.round(config.jackpot.contribution * 100);
  const embed = base(config.colors.gold)
    .setTitle('🏆  JACKPOT PROGRESIVO  🎰')
    .setDescription(
      `Bote **común** del servidor. Cada tirada de \`/slots\` aporta un **${pct}%** de la apuesta.\n` +
        'Lo revienta quien saque **💎💎💎** en la línea central.'
    )
    .addFields({ name: '💰 Bote actual', value: `# ${fmt(getJackpot())} ${sym}` });

  const last = getLastJackpotWin();
  if (last) {
    embed.addFields({
      name: '👑 Último ganador',
      value: `<@${last.user_id}> · **${fmt(last.amount)}** ${sym} · <t:${Math.floor(last.won_at / 1000)}:R>`,
    });
  }
  return embed;
}

async function ensureMessage(client) {
  const channelId = config.jackpot.displayChannel;
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  const saved = getBoardStmt.get();
  if (saved && saved.channel_id === channelId && saved.message_id) {
    const existing = await channel.messages.fetch(saved.message_id).catch(() => null);
    if (existing) return existing;
  }

  const msg = await channel.send({ embeds: [buildEmbed()] }).catch(() => null);
  if (msg) setBoardStmt.run(channelId, msg.id);
  return msg;
}

/** Refresca el mensaje del bote ya mismo (p. ej. tras ganarlo). */
async function refresh(client) {
  if (!config.jackpot.displayChannel) return;
  try {
    const msg = await ensureMessage(client);
    if (!msg) return;
    lastShown = getJackpot();
    await msg.edit({ embeds: [buildEmbed()] });
  } catch {
    // Sin permisos o mensaje borrado: se reintenta en el próximo ciclo.
  }
}

/** Arranca el tablero: publica/reutiliza el mensaje y lo refresca en bucle. */
function start(client) {
  if (!config.jackpot.displayChannel) return;
  refresh(client);
  timer = setInterval(() => {
    if (getJackpot() !== lastShown) refresh(client);
  }, config.jackpot.boardRefreshMs);
  if (timer.unref) timer.unref();
}

module.exports = { start, refresh, buildEmbed };
