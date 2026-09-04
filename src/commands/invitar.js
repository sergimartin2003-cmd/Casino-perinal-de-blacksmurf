const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const referrals = require('../lib/referrals');
const { base } = require('../lib/embeds');
const { fmt, coins } = require('../lib/format');
const config = require('../config');

function buildView(user) {
  const uid = user.id;
  const invited = referrals.invitedCount(uid);
  const earned = referrals.earnedBy(uid);
  const referrer = referrals.referrerOf(uid);
  const hitos = referrals.milestoneStatus(uid);
  const claimable = hitos.filter((m) => m.reached && !m.claimed);
  const claimTotal = claimable.reduce((s, m) => s + m.reward, 0);

  const hitosTxt = hitos
    .map((m) => {
      const estado = m.claimed ? '✅ reclamado' : m.reached ? '🎉 **¡listo!**' : `${fmt(invited)}/${m.count}`;
      return `👥 **${m.count} invitados** → ${coins(m.reward)} · ${estado}`;
    })
    .join('\n');

  const embed = base(config.colors.primary)
    .setTitle('🤝 Invita y gana — Programa de referidos')
    .setDescription(
      `Comparte tu invitación: diles que pongan **\`/referido de:@${user.username}\`** al entrar.\n` +
        `Os lleváis un bono al instante y tú ganas comisión de todo lo que apuesten. 🔥`
    )
    .addFields(
      { name: '👥 Invitados', value: `**${fmt(invited)}**`, inline: true },
      { name: '💰 Ganado en total', value: coins(earned), inline: true },
      {
        name: '📊 Tus comisiones',
        value: `Nivel 1: **${Math.round(referrals.CONFIG.rakeL1 * 100)}%** · Nivel 2: **${Math.round(referrals.CONFIG.rakeL2 * 100)}%** de lo que apuesten`,
        inline: false,
      },
      { name: '🏅 Hitos', value: hitosTxt, inline: false }
    );
  if (referrer) embed.addFields({ name: '🙌 Te invitó', value: `<@${referrer}>`, inline: false });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ref_claim')
      .setEmoji('🎁')
      .setLabel(claimTotal > 0 ? `Reclamar hitos +${fmt(claimTotal)}` : 'Sin hitos que reclamar')
      .setStyle(ButtonStyle.Success)
      .setDisabled(claimTotal <= 0)
  );
  return { embeds: [embed], components: [row] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invitar')
    .setDescription('🤝 Tu panel de referidos: invita gente y gana monedas y comisiones.'),

  async execute(interaction) {
    const user = interaction.user;
    await interaction.reply({ ...buildView(user), allowedMentions: { parse: [] } });
    const msg = await interaction.fetchReply();

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120000 });
    collector.on('collect', async (i) => {
      if (i.user.id !== user.id) {
        return i.reply({ content: '❌ Este panel no es tuyo. Usa `/invitar` para el tuyo.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      if (i.customId !== 'ref_claim') return;
      const { got } = referrals.claimMilestones(user.id);
      await i.update({ ...buildView(user), allowedMentions: { parse: [] } }).catch(() => {});
      await i
        .followUp({
          content: got > 0 ? `🎁 ¡Reclamado **+${fmt(got)}** ${config.currency.symbol} por tus hitos!` : 'No tienes hitos pendientes ahora mismo.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    });
    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
