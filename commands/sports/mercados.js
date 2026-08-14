const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const SportsCache = require('../../src/sportsCache');

// Instancia única (reutiliza la conexión compartida): no se crea por comando.
const cache = new SportsCache('./data/casino.db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mercados')
        .setDescription('Ver mercados deportivos disponibles')
        .addStringOption(option =>
            option.setName('deporte')
                .setDescription('Filtrar por deporte')
                .setRequired(false)
                .addChoices(
                    { name: '⚽ Fútbol', value: 'football' },
                    { name: '🏀 Baloncesto', value: 'basketball' },
                    { name: '🥊 MMA', value: 'mma' },
                    { name: '📊 Todos', value: 'all' }
                )),

    async execute(interaction) {
        const sport = interaction.options.getString('deporte') || 'all';

        // Máx 10 para no chocar con los límites del embed (25 campos / 6000 chars).
        const events = cache.getActiveEvents(sport === 'all' ? null : sport, 10);

        if (events.length === 0) {
            return interaction.reply({
                content: '❌ No hay eventos disponibles en este momento.',
                flags: MessageFlags.Ephemeral
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Mercados Deportivos Disponibles')
            .setColor(0x0099FF)
            .setTimestamp()
            .setFooter({ text: `Total: ${events.length} eventos • Actualizado cada 15min` });

        for (const event of events) {
            const odds = cache.getFormattedOdds(event.id);
            let oddsText = 'Sin cuotas disponibles';

            if (odds && odds.markets) {
                const bookmaker = Object.keys(odds.markets)[0];
                const market = odds.markets[bookmaker];
                const moneyline = market.moneyline || {};

                if (moneyline.home && moneyline.away) {
                    oddsText = `${event.home_team} ${moneyline.home} | ${event.away_team} ${moneyline.away}`;
                    if (moneyline.draw) {
                        oddsText += ` | Empate ${moneyline.draw}`;
                    }
                }
            }

            const time = new Date(event.start_time).toLocaleString('es-ES');
            const emoji = event.sport === 'football' ? '⚽' :
                         event.sport === 'basketball' ? '🏀' : '🥊';

            embed.addFields({
                name: `${emoji} ${event.home_team} vs ${event.away_team}`,
                value: `📅 ${time}\n🏷️ ${event.league}\n🎯 ${oddsText}`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
    }
};
