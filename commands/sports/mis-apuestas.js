const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const SportsBetting = require('../../src/sportsBetting');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mis-apuestas')
        .setDescription('Ver tu historial de apuestas'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const betting = new SportsBetting('./data/casino.db');
        const bets = betting.getUserBets(userId, 20);

        if (bets.length === 0) {
            return interaction.reply({
                content: '📭 No tienes apuestas registradas.',
                ephemeral: true
            });
        }

        const stats = betting.getBettingStats(userId);

        const embed = new EmbedBuilder()
            .setTitle('📊 Mis Apuestas')
            .setColor(0x0099FF)
            .addFields(
                { name: '📈 Total apostado', value: `${stats.total_bet_amount || 0} monedas`, inline: true },
                { name: '🏆 Total ganado', value: `${stats.total_winnings || 0} monedas`, inline: true },
                { name: '📊 Balance', value: `${(stats.total_winnings || 0) - (stats.total_bet_amount || 0)} monedas`, inline: true },
                { name: '✅ Ganadas', value: `${stats.won || 0}`, inline: true },
                { name: '❌ Perdidas', value: `${stats.lost || 0}`, inline: true },
                { name: '⏳ Pendientes', value: `${stats.pending || 0}`, inline: true }
            )
            .setTimestamp();

        const recentBets = bets.slice(0, 5);
        for (const bet of recentBets) {
            const statusEmoji = bet.status === 'won' ? '✅' :
                               bet.status === 'lost' ? '❌' :
                               bet.status === 'cancelled' ? '🚫' : '⏳';
            const time = new Date(bet.placed_at).toLocaleString('es-ES');

            embed.addFields({
                name: `${statusEmoji} ${bet.home_team} vs ${bet.away_team}`,
                value: `📅 ${time}\n🎯 ${bet.selection} (${bet.odds}x) - ${bet.amount} monedas\n💰 ${bet.potential_winnings || 0} potenciales`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
    }
};
