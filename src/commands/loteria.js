const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buyTickets, snapshot, draw } = require('../lib/lottery');
const { isStaff } = require('../lib/owner');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loteria')
    .setDescription('🎟️ Lotería Nova: compra boletos para el bote común y espera al sorteo.')
    .addSubcommand((s) =>
      s
        .setName('comprar')
        .setDescription('Compra boletos para el sorteo actual')
        .addIntegerOption((o) =>
          o.setName('cantidad').setDescription('Cuántos boletos').setRequired(true).setMinValue(1).setMaxValue(1000)
        )
    )
    .addSubcommand((s) => s.setName('bote').setDescription('Mira el bote, los boletos y tu probabilidad'))
    .addSubcommand((s) => s.setName('sortear').setDescription('(Solo owners) Fuerza el sorteo ahora mismo')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const sym = config.currency.symbol;

    if (sub === 'comprar') {
      const cantidad = interaction.options.getInteger('cantidad');
      const res = buyTickets(interaction.user.id, cantidad);
      if (res.error) return interaction.reply({ content: `❌ ${res.error}`, flags: MessageFlags.Ephemeral });

      const embed = base(config.colors.primary)
        .setTitle('🎟️ Boletos comprados')
        .setDescription(`Compraste **${fmt(res.bought)}** boleto(s) por ${coins(res.cost)}.`)
        .addFields(
          { name: 'Tus boletos', value: `${fmt(res.userTickets)} / ${fmt(res.totalTickets)}`, inline: true },
          { name: 'Tu probabilidad', value: `${(res.chance * 100).toFixed(1)}%`, inline: true },
          { name: 'Bote actual', value: coins(res.pot), inline: true },
          { name: 'Próximo sorteo', value: `<t:${Math.floor(res.nextDraw / 1000)}:R>`, inline: false }
        )
        .setFooter({ text: `${config.casino.name} • cada boleto cuesta ${fmt(res.price)} ${sym}` });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'bote') {
      const s = snapshot(interaction.user.id);
      const embed = base(config.colors.gold)
        .setTitle(`🎟️ Lotería Nova — ronda #${s.round}`)
        .addFields(
          { name: '🏆 Bote', value: coins(s.pot), inline: true },
          { name: 'Boletos vendidos', value: `${fmt(s.totalTickets)} (${s.players} jugadores)`, inline: true },
          { name: 'Precio boleto', value: `${fmt(s.price)} ${sym}`, inline: true },
          { name: 'Tus boletos', value: `${fmt(s.userTickets)}`, inline: true },
          { name: 'Tu probabilidad', value: `${(s.chance * 100).toFixed(1)}%`, inline: true },
          { name: 'Próximo sorteo', value: `<t:${Math.floor(s.nextDraw / 1000)}:R>`, inline: true }
        )
        .setFooter({ text: `${config.casino.name} • usa /loteria comprar para participar` });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'sortear') {
      if (!isStaff(interaction)) {
        return interaction.reply({ content: '❌ Solo **admins/owners** pueden forzar el sorteo.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await draw(interaction.client);
      const msg =
        res.type === 'drawn'
          ? `✅ Sorteo hecho: ganó <@${res.winner}> **${fmt(res.prize)}** ${sym} (bote ${fmt(res.pot)}).`
          : res.type === 'refunded'
            ? `↩️ Pocos participantes (${res.players}): bote reembolsado.`
            : '🎟️ No había boletos en esta ronda; no se sorteó nada.';
      return interaction.editReply({ content: msg });
    }
  },
};
