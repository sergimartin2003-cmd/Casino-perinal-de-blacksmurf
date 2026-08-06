const { SlashCommandBuilder } = require('discord.js');
const { getUser } = require('../lib/economy');
const { base } = require('../lib/embeds');
const { fmt, coins } = require('../lib/format');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Consulta tu saldo de Novas y tus estadísticas.')
    .addUserOption((o) =>
      o.setName('usuario').setDescription('Ver el saldo de otra persona')
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('usuario') ?? interaction.user;
    const u = getUser(target.id);

    const net = u.total_won - u.total_lost;
    const netStr = net >= 0 ? `+${fmt(net)}` : `${fmt(net)}`;

    const embed = base(config.colors.gold)
      .setAuthor({ name: `Cartera de ${target.username}`, iconURL: target.displayAvatarURL() })
      .addFields(
        { name: '💰 En mano', value: coins(u.balance), inline: true },
        { name: '🏦 Banco', value: coins(u.bank), inline: true },
        { name: '📊 Patrimonio', value: coins(u.balance + u.bank), inline: true },
        { name: '🎲 Partidas', value: `${fmt(u.games_played)}`, inline: true },
        { name: '🔥 Mayor premio', value: coins(u.biggest_win), inline: true },
        { name: '📈 Balance neto', value: `**${netStr}** ${config.currency.symbol}`, inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  },
};
