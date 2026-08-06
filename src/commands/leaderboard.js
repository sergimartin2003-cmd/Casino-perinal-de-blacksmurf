const { SlashCommandBuilder } = require('discord.js');
const { topUsers } = require('../lib/economy');
const { base } = require('../lib/embeds');
const { coins } = require('../lib/format');
const config = require('../config');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Los más ricos de Nova Casino.'),

  async execute(interaction) {
    await interaction.deferReply();
    const top = topUsers(10);

    if (top.length === 0) {
      return interaction.editReply('Aún no hay nadie en la clasificación. ¡Sé el primero!');
    }

    const lines = await Promise.all(
      top.map(async (u, i) => {
        const rank = MEDALS[i] ?? `\`#${i + 1}\``;
        let name = `Usuario ${u.id.slice(0, 6)}`;
        try {
          const user = await interaction.client.users.fetch(u.id);
          name = user.username;
        } catch {}
        return `${rank} **${name}** — ${coins(u.balance + u.bank)}`;
      })
    );

    const embed = base(config.colors.gold)
      .setTitle('🏆 Clasificación — los más ricos')
      .setDescription(lines.join('\n'));

    await interaction.editReply({ embeds: [embed] });
  },
};
