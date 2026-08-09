const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const SportsCache = require('../../src/sportsCache');
const SportsBetting = require('../../src/sportsBetting');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apostar')
        .setDescription('Colocar una apuesta deportiva')
        .addStringOption(option =>
            option.setName('evento')
                .setDescription('ID del evento (ver en /mercados)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('seleccion')
                .setDescription('Selección a apostar')
                .setRequired(true)
                .addChoices(
                    { name: 'Local', value: 'home' },
                    { name: 'Empate', value: 'draw' },
                    { name: 'Visitante', value: 'away' }
                ))
        .addIntegerOption(option =>
            option.setName('monto')
                .setDescription('Cantidad de monedas a apostar')
                .setRequired(true)
                .setMinValue(10)),

    async execute(interaction) {
        const eventId = interaction.options.getString('evento');
        const selection = interaction.options.getString('seleccion');
        const amount = interaction.options.getInteger('monto');

        const userId = interaction.user.id;
        const cache = new SportsCache('./data/casino.db');
        const betting = new SportsBetting('./data/casino.db');

        const event = cache.getEventById(eventId);
        if (!event) {
            return interaction.reply({
                content: '❌ Evento no encontrado.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (event.status === 'finished') {
            return interaction.reply({
                content: '❌ Este evento ya finalizó.',
                flags: MessageFlags.Ephemeral
            });
        }

        const odds = cache.getFormattedOdds(eventId);
        if (!odds || !odds.markets) {
            return interaction.reply({
                content: '❌ No hay cuotas disponibles para este evento.',
                flags: MessageFlags.Ephemeral
            });
        }

        const bookmaker = Object.keys(odds.markets)[0];
        const market = odds.markets[bookmaker];
        const moneyline = market.moneyline || {};

        let oddValue = null;
        let selectionName = '';
        if (selection === 'home') {
            oddValue = moneyline.home;
            selectionName = event.home_team;
        } else if (selection === 'away') {
            oddValue = moneyline.away;
            selectionName = event.away_team;
        } else if (selection === 'draw') {
            oddValue = moneyline.draw;
            selectionName = 'Empate';
        }

        if (!oddValue) {
            return interaction.reply({
                content: '❌ Cuota no disponible para esta selección.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const bet = betting.placeBet(
                userId,
                eventId,
                'moneyline',
                selection,
                oddValue,
                amount
            );

            const embed = new EmbedBuilder()
                .setTitle('✅ Apuesta colocada')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Evento', value: `${event.home_team} vs ${event.away_team}`, inline: false },
                    { name: 'Selección', value: `${selectionName} (${oddValue}x)`, inline: true },
                    { name: 'Monto', value: `${amount} monedas`, inline: true },
                    { name: 'Ganancia potencial', value: `${bet.potentialWinnings} monedas`, inline: true },
                    { name: 'ID de apuesta', value: `#${bet.betId}`, inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            await interaction.reply({
                content: `❌ Error: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
