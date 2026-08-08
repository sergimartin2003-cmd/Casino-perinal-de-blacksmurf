const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isOwner } = require('../lib/owner');
const dailyReport = require('../lib/dailyReport');
const config = require('../config');

const pad = (n) => String(n).padStart(2, '0');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reporte')
    .setDescription('📊 (Solo owners) Previsualiza el reporte diario del casino de hoy.'),

  async execute(interaction) {
    if (!isOwner(interaction)) {
      return interaction.reply({
        content: '❌ Solo los owners pueden ver el reporte.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const text = await dailyReport.generate(interaction.guild);
    const dr = config.dailyReport;
    const canal = dr.channel ? `<#${dr.channel}>` : '_(sin canal configurado — ponlo en config.dailyReport.channel)_';
    const hora = `${pad(dr.hour)}:${pad(dr.minute)}`;

    await interaction.editReply({
      content: `🔎 **Vista previa** del reporte de hoy.\nSe publicará automáticamente en ${canal} a las **${hora}** (hora del servidor).\n\n${text}`,
      allowedMentions: { parse: [] },
    });
  },
};
