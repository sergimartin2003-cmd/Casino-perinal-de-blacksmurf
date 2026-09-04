const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const { badge } = require('../lib/vip');
const { base } = require('../lib/embeds');
const { fmt } = require('../lib/format');
const config = require('../config');

const MEDALS = ['🥇', '🥈', '🥉'];

// Top del día por beneficio neto, leído de la tabla de auditoría `bets`.
// Solo LECTURA: no modifica nada, solo agrega lo que el bot ya registra.
const topTodayStmt = db.prepare(`
  SELECT b.user_id AS user_id,
         SUM(b.net) AS net,
         COUNT(*)   AS plays,
         u.total_wagered AS total_wagered
  FROM bets b
  LEFT JOIN users u ON u.id = b.user_id
  WHERE b.created_at >= ?
  GROUP BY b.user_id
  ORDER BY net DESC
  LIMIT 10
`);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankdia')
    .setDescription('🏆 Clasificación de ganadores de HOY (se reinicia cada día).'),

  async execute(interaction) {
    await interaction.deferReply();

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rows = topTodayStmt.all(startOfDay);

    if (!rows.length) {
      return interaction.editReply('📭 Hoy aún no ha jugado nadie. ¡Sé el primero y lidera el ranking! 🔥');
    }

    const sym = config.currency.symbol;
    const lines = await Promise.all(
      rows.map(async (r, i) => {
        const rank = MEDALS[i] ?? `\`#${i + 1}\``;
        let name = `Usuario ${r.user_id.slice(0, 6)}`;
        try {
          name = (await interaction.client.users.fetch(r.user_id)).username;
        } catch {}
        const netTxt = r.net >= 0 ? `🟢 +${fmt(r.net)}` : `🔴 ${fmt(r.net)}`;
        return `${rank} ${badge(r.total_wagered)} **${name}** — ${netTxt} ${sym} · ${fmt(r.plays)} jugadas`;
      })
    );

    const embed = base(config.colors.gold)
      .setTitle('🏆 Ranking del día — Top ganadores')
      .setDescription(lines.join('\n'))
      .addFields({ name: '​', value: '_Se reinicia a medianoche. ¡Sube antes de que acabe el día!_ 🔥' });

    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
