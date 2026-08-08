const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { isStaff } = require('../lib/owner');
const audit = require('../lib/audit');
const { base } = require('../lib/embeds');
const { fmt } = require('../lib/format');
const config = require('../config');

const sym = config.currency.symbol;
const rel = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const signed = (n) => `${n >= 0 ? '+' : ''}${fmt(n)}`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auditoria')
    .setDescription('🔍 (admin/owner) Audita apuestas y transferencias para detectar trampas.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('usuario')
        .setDescription('Ficha de un usuario: apuestas y transferencias.')
        .addUserOption((o) => o.setName('usuario').setDescription('A quién auditar').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('transferencias').setDescription('Pares que más se transfieren (posible granja de cuentas).')
    )
    .addSubcommand((s) =>
      s.setName('ganadores').setDescription('Quién más ha ganado en las últimas 24 h (posibles exploits).')
    )
    .addSubcommand((s) =>
      s.setName('admin').setDescription('Últimas acciones de admin sobre saldos (/admin-saldo).')
    ),

  async execute(interaction) {
    if (!isStaff(interaction)) {
      return interaction.reply({ content: '❌ Solo admins/owners pueden auditar.', flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'usuario') {
      const target = interaction.options.getUser('usuario');
      const a = audit.userAudit(target.id);
      const recent = a.recent.length
        ? a.recent
            .map((b) => `\`${(b.game || '—').padEnd(9)}\` ${fmt(b.wagered)} → **${signed(b.net)}** ${sym} · ${rel(b.created_at)}`)
            .join('\n')
        : '_Sin apuestas registradas._';

      const embed = base(config.colors.primary)
        .setTitle(`🔍 Auditoría de ${target.username}`)
        .setDescription(`<@${target.id}>`)
        .addFields(
          {
            name: '🎲 Apuestas',
            value: `${fmt(a.summary.n)} partidas · apostado **${fmt(a.summary.wagered)}** ${sym} · neto **${signed(a.summary.net)}** ${sym}\nMayor ganancia: **${signed(a.summary.bigwin)}** ${sym}`,
          },
          {
            name: '💸 Transferencias',
            value: `Enviadas: ${fmt(a.sent.n)} (**${fmt(a.sent.s)}** ${sym})\nRecibidas: ${fmt(a.recv.n)} (**${fmt(a.recv.s)}** ${sym})`,
          },
          { name: '🕑 Últimas apuestas', value: recent }
        );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'transferencias') {
      const rows = audit.suspiciousTransfers(10);
      const list = rows.length
        ? rows
            .map((r, i) => `**${i + 1}.** <@${r.from_id}> → <@${r.to_id}> · ${fmt(r.veces)}× · **${fmt(r.total)}** ${sym}`)
            .join('\n')
        : '_Aún no hay transferencias._';
      const embed = base(config.colors.gold)
        .setTitle('💸 Transferencias más grandes')
        .setDescription('Pares con más volumen transferido. Muchas repeticiones entre el mismo par pueden indicar **granja de cuentas**.\n\n' + list);
      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'ganadores') {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const rows = audit.topWinners(since, 10);
      const list = rows.length
        ? rows
            .map((r, i) => `**${i + 1}.** <@${r.user_id}> · **+${fmt(r.ganado)}** ${sym} · ${fmt(r.partidas)} partidas`)
            .join('\n')
        : '_Nadie va ganador en las últimas 24 h._';
      const embed = base(config.colors.gold)
        .setTitle('📈 Top ganadores (24 h)')
        .setDescription('Mayores ganancias netas del día. Ganancias muy grandes o con pocas partidas pueden indicar un **exploit**.\n\n' + list);
      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
    }

    // sub === 'admin'
    const acts = audit.recentAdminActions(15);
    const ICON = { dar: '➕', quitar: '➖', fijar: '🎯' };
    const list = acts.length
      ? acts
          .map((r) => `${ICON[r.action] || '•'} <@${r.actor_id}> → <@${r.target_id}> · **${fmt(r.amount)}** ${sym} (${fmt(r.before_bal)}→${fmt(r.after_bal)}) · ${rel(r.created_at)}`)
          .join('\n')
      : '_Sin acciones de admin registradas._';
    const embed = base(config.colors.red)
      .setTitle('👑 Acciones de admin sobre saldos')
      .setDescription('Últimos ajustes con `/admin-saldo` (quién, a quién y cuánto). Vigila que ningún admin se dé monedas a sí mismo.\n\n' + list);
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
  },
};
