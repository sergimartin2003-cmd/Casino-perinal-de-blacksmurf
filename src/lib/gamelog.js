// Registro de partidas: escucha los resultados de economy y publica cada
// partida en el canal de log configurado (config.logChannel).
const { gameEvents } = require('./economy');
const { fmt } = require('./format');
const { base } = require('./embeds');
const config = require('../config');

const GAME_LABEL = {
  slots: '🎰 Slots',
  ruleta: '🎡 Ruleta',
  blackjack: '🃏 Blackjack',
  poker: '🎴 Póker',
  mines: '💣 Mines',
  hilo: '🔼 Hi-Lo',
  dados: '🎲 Dados',
  carrera: '🏇 Carrera',
  cripto: '📈 Cripto',
  coinflip: '🪙 Coinflip',
};

/** Engancha el log al cliente. Llamar una vez en ClientReady. */
function attach(client) {
  gameEvents.on('result', async (r) => {
    const channelId = config.logChannel;
    if (!channelId) return; // log desactivado

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;

      const sym = config.currency.symbol;
      const label = GAME_LABEL[r.game] || (r.game ? r.game : '🎲 Juego');
      const outcome =
        r.net > 0 ? `🟢 **+${fmt(r.net)}**` : r.net < 0 ? `🔴 **${fmt(r.net)}**` : '⚪ **0**';
      const now = Math.floor(Date.now() / 1000);

      const line =
        `${label} · <@${r.userId}> · apuesta ${fmt(r.wagered)} ${sym} · ` +
        `${outcome} ${sym} · saldo ${fmt(r.balance)} ${sym} · <t:${now}:t>`;

      // parse: [] => se ve el nombre del usuario pero NO le hace ping.
      await channel.send({ content: line, allowedMentions: { parse: [] } });
    } catch {
      // Sin permisos o canal borrado: no rompemos el juego por un fallo de log.
    }
  });
}

/**
 * Anuncia públicamente que alguien reventó el jackpot progresivo de /slots.
 * Publica en el canal de log (config.logChannel) y hace ping al ganador.
 * Nunca lanza: un fallo de log no debe romper la partida.
 */
async function announceJackpot(client, { userId, amount }) {
  const channelId = config.logChannel;
  if (!channelId) return; // log desactivado

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const sym = config.currency.symbol;
    const embed = base(config.colors.gold)
      .setTitle('🏆  ¡JACKPOT REVENTADO!  🎰')
      .setDescription(
        `<@${userId}> ha reventado el bote progresivo de las tragaperras ` +
          `y se lleva **${fmt(amount)}** ${sym} 💥`
      )
      .addFields({
        name: 'Nuevo bote',
        value: `Arranca de nuevo en **${fmt(config.jackpot.seed)}** ${sym} y volverá a crecer con cada tirada.`,
      });

    await channel.send({
      content: `🎉 <@${userId}>`,
      embeds: [embed],
      allowedMentions: { users: [userId] },
    });
  } catch {
    // Sin permisos o canal borrado: no rompemos el juego por un fallo de log.
  }
}

module.exports = { attach, announceJackpot };
