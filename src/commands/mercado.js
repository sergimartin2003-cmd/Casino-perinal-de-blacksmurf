const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { isStaff } = require('../lib/owner');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const config = require('../config');
const markets = require('../lib/markets');
const espn = require('../lib/espn');

const STATUS_LABEL = { open: '🟢 Abierto', closed: '🔒 Cerrado (sin resolver)', resolved: '🏁 Resuelto', void: '🚫 Anulado' };

function renderMarket(market, userId) {
  const options = markets.optionsOf(market);
  const { pools, total } = markets.poolByOption(market.id, options.length);
  const mine = Object.fromEntries(markets.userStakes(market.id, userId).map((r) => [r.option_idx, r.stake]));

  const lines = options.map((o, i) => {
    const pool = pools[i] || 0;
    const pct = total ? Math.round((pool / total) * 100) : 0;
    const yours = mine[i] ? ` · tú: ${fmt(mine[i])}` : '';
    return `**${i + 1}.** ${o.name} — cuota **${o.odds}** · apostado ${fmt(pool)} (${pct}%)${yours}`;
  });

  return base(market.status === 'resolved' ? config.colors.gold : config.colors.primary)
    .setTitle(`🎯 Mercado #${market.id} · ${market.title}`)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: 'Estado', value: STATUS_LABEL[market.status] || market.status, inline: true },
      { name: 'Bote total', value: coins(total), inline: true },
      ...(market.status === 'resolved' && market.winner != null
        ? [{ name: 'Ganadora', value: `✅ ${options[market.winner].name}`, inline: true }]
        : [])
    )
    .setFooter({ text: `${config.casino.name} • apuesta pulsando los botones del tablero` });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mercado')
    .setDescription('🎯 Apuestas deportivas: mercados de cuotas (los abren y resuelven los owners).')
    // Solo visible para admins (los jugadores apuestan pulsando el tablero, sin comandos).
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('crear')
        .setDescription('(Owners) Abre un mercado nuevo')
        .addStringOption((o) => o.setName('titulo').setDescription('Ej: Madrid vs Barça').setRequired(true))
        .addStringOption((o) =>
          o.setName('opciones').setDescription('Opciones con cuota, separadas por comas: Madrid 2.1, Empate 3.3, Barça 3.4').setRequired(true)
        )
        .addChannelOption((o) =>
          o.setName('canal').setDescription('Canal donde publicar el tablero (por defecto, el de apuestas)').addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('partido')
        .setDescription('(Owners) Abre un mercado de un evento real (se resuelve solo)')
        .addStringOption((o) =>
          o
            .setName('liga')
            .setDescription('Liga o deporte (escribe para buscar: fútbol, NBA, UFC, PFL…)')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addChannelOption((o) =>
          o.setName('canal').setDescription('Canal donde publicar el tablero (por defecto, el de apuestas)').addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
    )
    .addSubcommand((s) => s.setName('lista').setDescription('Ver los mercados abiertos'))
    .addSubcommand((s) =>
      s.setName('info').setDescription('Ver un mercado en detalle').addIntegerOption((o) => o.setName('id').setDescription('Nº del mercado').setRequired(true).setMinValue(1))
    )
    .addSubcommand((s) =>
      s.setName('cerrar').setDescription('(Owners) Cierra las apuestas de un mercado').addIntegerOption((o) => o.setName('id').setDescription('Nº del mercado').setRequired(true).setMinValue(1))
    )
    .addSubcommand((s) =>
      s
        .setName('resolver')
        .setDescription('(Owners) Marca la opción ganadora y paga')
        .addIntegerOption((o) => o.setName('id').setDescription('Nº del mercado').setRequired(true).setMinValue(1))
        .addIntegerOption((o) => o.setName('ganadora').setDescription('Nº de la opción ganadora').setRequired(true).setMinValue(1))
    )
    .addSubcommand((s) =>
      s.setName('cancelar').setDescription('(Owners) Anula un mercado y reembolsa').addIntegerOption((o) => o.setName('id').setDescription('Nº del mercado').setRequired(true).setMinValue(1))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const staffOnly = ['crear', 'partido', 'cerrar', 'resolver', 'cancelar'];
    if (staffOnly.includes(sub) && !isStaff(interaction)) {
      return interaction.reply({ content: '❌ Solo **admins/owners** pueden gestionar mercados.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'partido') {
      const leagueKey = interaction.options.getString('liga');
      if (!espn.LEAGUES[leagueKey]) {
        return interaction.reply({ content: '❌ Elige una liga/deporte de la lista del autocompletado.', flags: MessageFlags.Ephemeral });
      }
      const boardChannelId = interaction.options.getChannel('canal')?.id || config.betChannel || interaction.channelId;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const fixtures = await espn.fetchFixtures(leagueKey);
      if (!fixtures.length) {
        return interaction.editReply({ content: '❌ No hay partidos próximos en esa liga ahora mismo (o ESPN no responde). Prueba otra liga o crea el mercado a mano con `/mercado crear`.' });
      }
      const rows = [];
      for (let i = 0; i < fixtures.length && i < 20; i += 5) {
        const row = new ActionRowBuilder();
        for (const f of fixtures.slice(i, i + 5)) {
          row.addComponents(new ButtonBuilder().setCustomId(`matchpick:${leagueKey}:${f.id}:${boardChannelId}`).setLabel(`${f.home} vs ${f.away}`.slice(0, 80)).setStyle(ButtonStyle.Secondary));
        }
        rows.push(row);
      }
      return interaction.editReply({ content: `🗓️ Elige el partido y te pediré las cuotas (se publicará en <#${boardChannelId}>):`, components: rows });
    }

    if (sub === 'crear') {
      const title = interaction.options.getString('titulo').slice(0, 200);
      const parsed = markets.parseOptions(interaction.options.getString('opciones'));
      if (parsed.error) return interaction.reply({ content: `❌ ${parsed.error}`, flags: MessageFlags.Ephemeral });
      const boardChannelId = interaction.options.getChannel('canal')?.id || config.betChannel || interaction.channelId;
      const id = markets.createMarket({ title, options: parsed.options, channelId: boardChannelId, userId: interaction.user.id });
      const r = await markets.publishBoard(interaction.client, markets.getMarket(id)); // tablero con botones en el canal de apuestas
      return interaction.reply({
        content: r.ok
          ? `✅ Mercado **#${id}** abierto en <#${boardChannelId}>. La gente ya puede apostar **pulsando los botones** del tablero.`
          : `⚠️ Mercado #${id} creado, pero **no pude publicar el tablero** en <#${boardChannelId}>.\nMotivo: \`${r.error}\`\nRevisa que el bot tenga en ese canal: **Ver canal**, **Enviar mensajes** e **Insertar enlaces**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'lista') {
      const open = markets.listOpen();
      if (!open.length) {
        return interaction.reply({ embeds: [base(config.colors.dark).setTitle('🎯 Mercados').setDescription('No hay mercados abiertos ahora mismo.')] });
      }
      const lines = open.map((m) => `**#${m.id}** · ${m.title} — ${STATUS_LABEL[m.status]}`);
      return interaction.reply({
        embeds: [base(config.colors.primary).setTitle('🎯 Mercados abiertos').setDescription(lines.join('\n')).setFooter({ text: 'Detalle: /mercado info id:<nº>' })],
      });
    }

    if (sub === 'info') {
      const m = markets.getMarket(interaction.options.getInteger('id'));
      if (!m) return interaction.reply({ content: '❌ No existe ese mercado.', flags: MessageFlags.Ephemeral });
      return interaction.reply({ embeds: [renderMarket(m, interaction.user.id)] });
    }

    if (sub === 'cerrar') {
      const id = interaction.options.getInteger('id');
      const res = markets.closeMarket(id);
      if (res.error) return interaction.reply({ content: `❌ ${res.error}`, flags: MessageFlags.Ephemeral });
      await markets.updateBoard(interaction.client, markets.getMarket(id));
      return interaction.reply({ content: `🔒 Mercado #${id} cerrado: ya no se aceptan apuestas. Resuélvelo con \`/mercado resolver\`.` });
    }

    if (sub === 'resolver') {
      const id = interaction.options.getInteger('id');
      const ganadora = interaction.options.getInteger('ganadora') - 1;
      await interaction.deferReply();
      const res = await markets.resolveMarket(interaction.client, id, ganadora);
      if (res.error) return interaction.editReply({ content: `❌ ${res.error}` });
      return interaction.editReply({
        content: `🏁 Mercado #${id} resuelto: ganó **${res.winnerName}** (cuota ${res.winnerOdds}). ${res.winners}/${res.bets} apuestas ganadoras, pagado ${fmt(res.totalPaid)} ${config.currency.symbol}.`,
      });
    }

    if (sub === 'cancelar') {
      const id = interaction.options.getInteger('id');
      await interaction.deferReply();
      const res = await markets.voidMarket(interaction.client, id);
      if (res.error) return interaction.editReply({ content: `❌ ${res.error}` });
      return interaction.editReply({ content: `🚫 Mercado #${id} anulado. Reembolsadas ${res.bets} apuesta(s): ${fmt(res.refunded)} ${config.currency.symbol}.` });
    }
  },
};
