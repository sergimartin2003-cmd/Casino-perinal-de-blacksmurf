const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const SportsCleanup = require('../../../src/sportsCleanup');

// Instancia única (reutiliza la conexión compartida): no se crea por comando.
const cleanup = new SportsCleanup('./data/casino.db', null);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('limpiar-eventos')
        .setDescription('[ADMIN] Limpiar eventos antiguos')
        .addIntegerOption(option =>
            option.setName('dias')
                .setDescription('Días a conservar')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(30)),

    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({
                content: '❌ Solo administradores pueden usar este comando.',
                flags: MessageFlags.Ephemeral
            });
        }

        const days = interaction.options.getInteger('dias') || 7;

        await interaction.reply({
            content: `🔄 Limpiando eventos con más de ${days} días...`,
            flags: MessageFlags.Ephemeral
        });

        const results = await cleanup.cleanupOldEvents(days);

        await interaction.editReply({
            content: `✅ Limpieza completada:\n` +
                    `• ${results.markedFinished} eventos marcados como finalizados\n` +
                    `• ${results.resolvedEvents} eventos con apuestas resueltas\n` +
                    `• ${results.deletedOldEvents} eventos eliminados\n` +
                    `• ${results.cleanedOrphanOdds} cuotas huérfanas limpiadas`
        });
    }
};
