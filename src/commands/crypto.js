const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getUser, placeBet } = require('../lib/economy');
const { resolveBet } = require('../lib/bet');
const antifraud = require('../lib/antifraud');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const { COINS, fetchPrice, fmtPrice, addPending } = require('../lib/cryptoRounds');
const config = require('../config');

// Duración de la ventana en segundos.
const DURATIONS = {
  '30s': 30,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cripto')
    .setDescription('📈 Predice si una cripto subirá o bajará en un tiempo real de mercado.')
    .addStringOption((o) =>
      o
        .setName('moneda')
        .setDescription('¿Qué cripto?')
        .setRequired(true)
        .addChoices(
          { name: '₿ Bitcoin', value: 'btc' },
          { name: 'Ξ Ethereum', value: 'eth' },
          { name: '◎ Solana', value: 'sol' },
          { name: '🟡 BNB', value: 'bnb' },
          { name: '🐕 Dogecoin', value: 'doge' }
        )
    )
    .addStringOption((o) =>
      o
        .setName('direccion')
        .setDescription('¿Subirá o bajará?')
        .setRequired(true)
        .addChoices({ name: '📈 Sube', value: 'up' }, { name: '📉 Baja', value: 'down' })
    )
    .addStringOption((o) => o.setName('apuesta').setDescription('Cantidad a apostar').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('duracion')
        .setDescription('¿Cuánto dura la ventana? (a más tiempo, más movimiento real)')
        .setRequired(true)
        .addChoices(
          { name: '30 segundos', value: '30s' },
          { name: '1 minuto', value: '1m' },
          { name: '5 minutos', value: '5m' },
          { name: '15 minutos', value: '15m' },
          { name: '30 minutos', value: '30m' },
          { name: '1 hora', value: '1h' }
        )
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const u = getUser(userId);
    const coinKey = interaction.options.getString('moneda');
    const coin = COINS[coinKey];
    const dir = interaction.options.getString('direccion');
    const durKey = interaction.options.getString('duracion');
    const durationSec = DURATIONS[durKey];

    const r = resolveBet(interaction.options.getString('apuesta'), u.balance);
    if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
    const wager = r.amount;

    const guard = antifraud.check(interaction, wager);
    if (!guard.ok) return interaction.reply({ content: `❌ ${guard.error}`, flags: MessageFlags.Ephemeral });

    await interaction.deferReply();

    // El precio de apertura debe ser real; si CoinGecko falla, no abrimos la apuesta.
    const open = await fetchPrice(coin);
    if (!open.live) {
      return interaction.editReply({
        embeds: [
          base(config.colors.red)
            .setTitle('📈 Sin datos de mercado')
            .setDescription('Ahora mismo no puedo obtener el precio real de CoinGecko. Prueba de nuevo en un momento.'),
        ],
      });
    }

    // Descontamos la apuesta (el saldo pudo cambiar desde el autocompletado).
    if (!placeBet(userId, wager)) {
      return interaction.editReply({
        embeds: [
          base(config.colors.red)
            .setTitle('❌ Saldo insuficiente')
            .setDescription(`Necesitas ${coins(wager)} y tu saldo ha cambiado.`),
        ],
      });
    }

    const openAt = Date.now();
    const closeAt = openAt + durationSec * 1000;
    const closeUnix = Math.floor(closeAt / 1000);
    const dirLabel = dir === 'up' ? '📈 SUBE' : '📉 BAJA';

    const embed = base(config.colors.primary)
      .setTitle(`${coin.emoji} ${coin.name} — apuesta abierta`)
      .setDescription(
        `Predicción: **${dirLabel}** en **${durKey}**\n` +
          `Precio de apertura: **${fmtPrice(open.price)}** 🟢 en vivo\n` +
          `Cambio 24h: **${open.change24h >= 0 ? '+' : ''}${open.change24h.toFixed(2)}%**\n\n` +
          `⏳ Cierra <t:${closeUnix}:R>  (a las <t:${closeUnix}:T>)\n` +
          `Apostado: ${coins(wager)}`
      )
      .setFooter({ text: `${config.casino.name} • el resultado se publica aquí al cerrar la ventana` });

    const msg = await interaction.editReply({ embeds: [embed] });

    addPending({
      user_id: userId,
      channel_id: interaction.channelId,
      message_id: msg?.id ?? null,
      coin: coinKey,
      dir,
      wager,
      open_price: open.price,
      open_at: openAt,
      close_at: closeAt,
    });
  },
};
