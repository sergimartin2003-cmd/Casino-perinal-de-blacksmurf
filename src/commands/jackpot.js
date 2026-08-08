const { SlashCommandBuilder } = require('discord.js');
const { getJackpot, getLastJackpotWin, getJackpotWinsCount } = require('../lib/economy');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jackpot')
    .setDescription('🏆 Consulta el bote progresivo de las tragaperras (crece con las tiradas de todos).'),

  async execute(interaction) {
    const sym = config.currency.symbol;
    const pot = getJackpot();
    const pct = Math.round(config.jackpot.contribution * 100);
    const last = getLastJackpotWin();
    const wins = getJackpotWinsCount();

    const embed = base(config.colors.gold)
      .setTitle('🏆  JACKPOT PROGRESIVO  🎰')
      .setDescription(
        `El bote es **común para todo el servidor**: cada tirada de \`/slots\` ` +
          `aporta un **${pct}%** de la apuesta y crece hasta que alguien lo revienta.`
      )
      .addFields(
        { name: '💰 Bote actual', value: coins(pot), inline: true },
        { name: '📈 Aporta cada tirada', value: `${pct}% de la apuesta`, inline: true },
        { name: '🎯 Cómo ganarlo', value: '💎💎💎 en la línea central de `/slots`', inline: false },
        { name: '🔁 Al reventarlo', value: `Vuelve a arrancar en ${coins(config.jackpot.seed)}`, inline: true },
        { name: '🏅 Veces reventado', value: `${wins}`, inline: true }
      );

    // Requisito anti cuentas falsas para poder cobrar el bote.
    const reqs = [`**${config.jackpot.minAccountAgeDays}+ días** de antigüedad de cuenta`];
    if (config.jackpot.trackInvites) reqs.push(`haber invitado a **${config.jackpot.minInvites}+** personas`);
    embed.addFields({
      name: '🛡️ Para cobrarlo',
      value: `${reqs.join(' o ')} (evita cuentas falsas).`,
      inline: false,
    });

    if (last) {
      const when = Math.floor(last.won_at / 1000);
      embed.addFields({
        name: '👑 Último ganador',
        value: `<@${last.user_id}> se llevó **${fmt(last.amount)}** ${sym} · <t:${when}:R>`,
        inline: false,
      });
    } else {
      embed.addFields({
        name: '👑 Último ganador',
        value: '¡Aún nadie lo ha reventado! Podrías ser tú. 🎰',
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
