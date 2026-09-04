const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const referrals = require('../lib/referrals');
const { base } = require('../lib/embeds');
const { coins } = require('../lib/format');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('referido')
    .setDescription('Registra quién te invitó y llevaos los dos un bono de bienvenida.')
    .addUserOption((o) => o.setName('de').setDescription('La persona que te invitó').setRequired(true)),

  async execute(interaction) {
    const referrer = interaction.options.getUser('de');
    if (referrer.bot) {
      return interaction.reply({ content: '🤖 Un bot no puede invitarte.', flags: MessageFlags.Ephemeral });
    }

    const res = referrals.link(interaction.user.id, referrer.id);
    if (res.error) {
      return interaction.reply({ content: `❌ ${res.error}`, flags: MessageFlags.Ephemeral });
    }

    const embed = base(config.colors.green)
      .setTitle('🎉 ¡Invitación registrada!')
      .setDescription(`${interaction.user} fue invitado por ${referrer}.`)
      .addFields(
        { name: '🎁 Tu bono', value: coins(res.refereeBonus), inline: true },
        { name: `🎁 Bono para ${referrer.username}`, value: coins(res.referrerBonus), inline: true },
        { name: '💡 Y además…', value: `Tu invitador ganará un **${Math.round(referrals.CONFIG.rakeL1 * 100)}%** de todo lo que apuestes. ¡Jugad juntos! 🔥` }
      );

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
