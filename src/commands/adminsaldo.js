const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getUser, addBalance, setBalance } = require('../lib/economy');
const { isOwner } = require('../lib/owner');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-saldo')
    .setDescription('👑 (Solo owners) Añade, quita o fija el saldo de un usuario.')
    // Oculta el comando a los usuarios normales; el filtro real es isOwner().
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('accion')
        .setDescription('¿Qué quieres hacer con el saldo?')
        .setRequired(true)
        .addChoices(
          { name: '➕ Dar', value: 'dar' },
          { name: '➖ Quitar', value: 'quitar' },
          { name: '🎯 Fijar (dejar en una cantidad exacta)', value: 'fijar' }
        )
    )
    .addUserOption((o) => o.setName('usuario').setDescription('Usuario al que ajustar el saldo').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('cantidad').setDescription('Cantidad de Novas').setRequired(true).setMinValue(0)
    ),

  async execute(interaction) {
    if (!isOwner(interaction)) {
      return interaction.reply({
        content: '❌ Solo los **owners** pueden usar este comando.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const accion = interaction.options.getString('accion');
    const target = interaction.options.getUser('usuario');
    const cantidad = interaction.options.getInteger('cantidad');

    if (target.bot) {
      return interaction.reply({ content: '❌ No puedes ajustar el saldo de un bot.', flags: MessageFlags.Ephemeral });
    }
    if ((accion === 'dar' || accion === 'quitar') && cantidad < 1) {
      return interaction.reply({
        content: '❌ Para dar o quitar, la cantidad debe ser al menos 1.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const before = getUser(target.id).balance;
    let after;
    let verb;
    if (accion === 'dar') {
      after = addBalance(target.id, cantidad);
      verb = `➕ Añadido **${fmt(cantidad)}** ${config.currency.symbol}`;
    } else if (accion === 'quitar') {
      after = addBalance(target.id, -cantidad); // el saldo nunca baja de 0
      verb = `➖ Quitado **${fmt(cantidad)}** ${config.currency.symbol}`;
    } else {
      after = setBalance(target.id, cantidad);
      verb = `🎯 Saldo fijado a **${fmt(cantidad)}** ${config.currency.symbol}`;
    }

    const embed = base(config.colors.gold)
      .setTitle('👑 Ajuste de saldo')
      .setDescription(`${verb} a ${target}.`)
      .addFields(
        { name: 'Antes', value: coins(before), inline: true },
        { name: 'Ahora', value: coins(after), inline: true }
      )
      .setFooter({ text: `${config.casino.name} • acción de ${interaction.user.username}` });

    return interaction.reply({ embeds: [embed] });
  },
};
