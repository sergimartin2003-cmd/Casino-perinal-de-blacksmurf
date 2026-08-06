const { SlashCommandBuilder } = require('discord.js');
const { base } = require('../lib/embeds');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Guía de Nova Casino: economía y juegos.'),

  async execute(interaction) {
    const c = config.currency.symbol;
    const embed = base(config.colors.gold)
      .setTitle(`🎰 ${config.casino.name}`)
      .setDescription(`${config.casino.tagline}\nMoneda: **${config.currency.name}** ${c}`)
      .addFields(
        {
          name: '💰 Economía',
          value: [
            '`/balance` — tu saldo y estadísticas',
            '`/daily` — recompensa diaria (con racha 🔥)',
            '`/give` — transfiere Novas a alguien',
            '`/leaderboard` — ranking de más ricos',
          ].join('\n'),
        },
        {
          name: '🎲 Juegos',
          value: [
            '`/slots` — 🎰 tragaperras con comodín y jackpot progresivo',
            '`/ruleta` — 🎡 ruleta europea: coloca varias apuestas en la mesa y gira',
            '`/blackjack` — 🃏 21 con pedir/plantar/doblar/dividir/seguro',
            '`/poker` — 🎴 video póker Jacks or Better',
            '`/mines` — 💣 destapa gemas y retírate a tiempo',
            '`/hilo` — 🔼🔽 mayor o menor, encadena aciertos',
            '`/dados` — 🎲 predice la suma de dos dados',
            '`/carrera` — 🏇 carrera estilo GTA: 8 caballos que cambian, cuotas 3/1 a 18/1',
            '`/cripto` — 📈 predice si sube o baja una cripto en un tiempo real (30s a 1h)',
            '`/coinflip` — 🪙 cara o cruz, doble o nada',
            '`/loteria` — 🎟️ compra boletos para el bote común y gana el sorteo',
            '🎯 **Apuestas deportivas:** pulsa los botones del tablero en el canal de apuestas (los abren los admins)',
          ].join('\n'),
        },
        {
          name: '💡 Tips',
          value:
            'En las apuestas puedes escribir `all`, `half`, `1k` o `2m`. Tras cada partida usa **🔄 Volver a jugar** para repetir con la misma apuesta. Empiezas con **1.000** ' +
            c +
            '. ¡Todo es ficticio!',
        }
      );

    await interaction.reply({ embeds: [embed] });
  },
};
