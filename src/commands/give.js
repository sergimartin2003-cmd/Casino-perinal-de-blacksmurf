const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getUser, transfer } = require('../lib/economy');
const { base } = require('../lib/embeds');
const { coins } = require('../lib/format');
const { resolveBet } = require('../lib/bet');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Transfiere Novas a otra persona.')
    .addUserOption((o) =>
      o.setName('usuario').setDescription('A quién se lo das').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('cantidad').setDescription('Cantidad (número, "half" o "all")').setRequired(true)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('usuario');
    const sender = getUser(interaction.user.id);

    if (target.bot)
      return interaction.reply({ content: '🤖 No puedes darle Novas a un bot.', flags: MessageFlags.Ephemeral });
    if (target.id === interaction.user.id)
      return interaction.reply({ content: '🙃 No puedes transferirte a ti mismo.', flags: MessageFlags.Ephemeral });

    const r = resolveBet(interaction.options.getString('cantidad'), sender.balance);
    if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });

    // Transferencia atómica (descuenta, acredita y audita en una transacción).
    if (!transfer(interaction.user.id, target.id, r.amount)) {
      return interaction.reply({ content: '❌ No tienes saldo suficiente para esa transferencia.', flags: MessageFlags.Ephemeral });
    }

    const embed = base(config.colors.green)
      .setTitle('💸 Transferencia realizada')
      .setDescription(`${interaction.user} le dio ${coins(r.amount)} a ${target}.`);

    await interaction.reply({ embeds: [embed] });
  },
};
