const { SlashCommandBuilder } = require('discord.js');
const { getUser } = require('../lib/economy');
const { TIERS, tierOf } = require('../lib/vip');
const { base } = require('../lib/embeds');
const { fmt, coins, bar } = require('../lib/format');
const config = require('../config');

// Ventajas (solo texto/estatus; no cambian ninguna mecánica del juego).
const PERKS = {
  bronce: 'Acceso a todos los juegos del casino.',
  plata: 'Distintivo 🥈 en las clasificaciones.',
  oro: 'Distintivo 🥇 y presencia destacada en el ranking del día.',
  platino: 'Distintivo 💠 de alto rodador (high roller).',
  diamante: 'Distintivo 💎 · la élite de Nova Casino.',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vip')
    .setDescription('Tu rango VIP según lo que has apostado (puro estatus).')
    .addUserOption((o) => o.setName('usuario').setDescription('Ver el rango de otra persona').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('usuario') || interaction.user;
    const u = getUser(target.id);
    const { tier, index, next, wagered } = tierOf(u.total_wagered);

    // Progreso dentro del rango actual hacia el siguiente.
    let progresoLinea;
    if (next) {
      const span = next.min - tier.min;
      const done = wagered - tier.min;
      const pct = Math.min(100, Math.round((done / span) * 100));
      progresoLinea =
        `\`${bar(done, span)}\` ${pct}%\n` +
        `Te faltan **${fmt(next.min - wagered)}** ${config.currency.symbol} para **${next.emoji} ${next.name}**.`;
    } else {
      progresoLinea = '👑 **Rango máximo alcanzado.** Eres leyenda de la casa.';
    }

    // Escalera de rangos, marcando el actual.
    const escalera = TIERS.map((t, i) => {
      const here = i === index ? ' ⬅️ **tú**' : '';
      const check = i < index ? '✅ ' : i === index ? '➡️ ' : '⬜ ';
      return `${check}${t.emoji} **${t.name}** · desde ${fmt(t.min)} ${config.currency.symbol}${here}`;
    }).join('\n');

    const embed = base(tier.color)
      .setTitle(`${tier.emoji} Rango VIP — ${tier.name}`)
      .setDescription(`Perfil de ${target}`)
      .addFields(
        { name: '💸 Total apostado (histórico)', value: coins(wagered), inline: true },
        { name: '🎁 Ventaja del rango', value: PERKS[tier.key] || '—', inline: false },
        { name: '📈 Progreso', value: progresoLinea, inline: false },
        { name: '🪜 Escalera VIP', value: escalera, inline: false }
      );

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
