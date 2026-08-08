const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { isStaff } = require('../lib/owner');
const backup = require('../lib/backup');
const { fmt } = require('../lib/format');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('🗄️ (admin/owner) Hace una copia de seguridad de la base de datos ahora mismo.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!isStaff(interaction)) {
      return interaction.reply({ content: '❌ Solo admins/owners pueden hacer backups.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const r = await backup.backupOnce(interaction.client);
      const destinos = [];
      if (config.backup.channel) destinos.push(`canal <#${config.backup.channel}>`);
      if (config.backup.webhookUrl) destinos.push('servidor externo');
      const kb = (r.size / 1024).toFixed(0);
      await interaction.editReply(
        `✅ Copia creada: \`${r.name}\` (${fmt(kb)} KB) en \`${config.backup.dir}/\`.` +
          (destinos.length ? `\n📤 Subida a: ${destinos.join(' y ')}.` : '\n_(sin destino off-site configurado)_')
      );
    } catch (e) {
      await interaction.editReply(`❌ No se pudo hacer la copia: ${e.message}`);
    }
  },
};
