// Registro de partidas: escucha los resultados de economy y publica cada
// partida en el canal de log configurado (config.logChannel).
const { gameEvents } = require('./economy');
const { fmt } = require('./format');
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

module.exports = { attach };
