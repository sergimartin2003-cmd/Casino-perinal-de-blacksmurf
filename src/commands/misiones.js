const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const db = require('../database/db');
const { getUser, addBalance } = require('../lib/economy');
const { dayKey } = require('../lib/dailyReport');
const { base } = require('../lib/embeds');
const { fmt, coins, bar } = require('../lib/format');
const config = require('../config');

// Tabla propia (autocreada, aditiva): registra qué misiones ya se reclamaron cada
// día para no pagar dos veces. No toca ninguna tabla existente.
db.exec(`CREATE TABLE IF NOT EXISTS mission_claims (
  day        TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  mission    TEXT    NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (day, user_id, mission)
)`);

const activeStmt = db.prepare('SELECT bets, wagered FROM daily_active WHERE day = ? AND user_id = ?');
const claimsStmt = db.prepare('SELECT mission FROM mission_claims WHERE day = ? AND user_id = ?');
const insertClaimStmt = db.prepare(
  'INSERT OR IGNORE INTO mission_claims (day, user_id, mission, claimed_at) VALUES (?, ?, ?, ?)'
);

// Misiones diarias (se reinician cada día). metric: 'bets' o 'wagered' (de daily_active).
const MISSIONS = [
  { key: 'jugar10', emoji: '🎯', metric: 'bets', goal: 10, reward: 500, label: 'Haz 10 apuestas hoy' },
  { key: 'volumen', emoji: '💰', metric: 'wagered', goal: 5000, reward: 1000, label: 'Apuesta 5.000 en total hoy' },
  { key: 'jugar30', emoji: '🔥', metric: 'bets', goal: 30, reward: 2000, label: 'Haz 30 apuestas hoy' },
];

function progressFor(userId) {
  const day = dayKey();
  const a = activeStmt.get(day, userId) || { bets: 0, wagered: 0 };
  const claimed = new Set(claimsStmt.all(day, userId).map((r) => r.mission));
  return MISSIONS.map((m) => {
    const rawCur = m.metric === 'bets' ? a.bets : a.wagered;
    return { ...m, rawCur, cur: Math.min(rawCur, m.goal), done: rawCur >= m.goal, claimed: claimed.has(m.key) };
  });
}

function buildView(userId) {
  const list = progressFor(userId);
  const lines = list.map((m) => {
    const estado = m.claimed ? '✅ reclamada' : m.done ? '🎉 **¡completada!**' : `${fmt(m.rawCur)}/${fmt(m.goal)}`;
    return `${m.emoji} **${m.label}** · recompensa ${coins(m.reward)}\n\`${bar(m.cur, m.goal)}\` ${estado}`;
  });
  const total = list.filter((m) => m.done && !m.claimed).reduce((s, m) => s + m.reward, 0);

  const embed = base(config.colors.primary)
    .setTitle('🗓️ Misiones diarias')
    .setDescription(lines.join('\n\n'))
    .addFields({ name: 'ℹ️ Cómo va', value: 'Juega a los juegos del casino para completarlas. Se reinician cada día a medianoche.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mis_claim')
      .setEmoji('🎁')
      .setLabel(total > 0 ? `Reclamar +${fmt(total)}` : 'Nada que reclamar')
      .setStyle(ButtonStyle.Success)
      .setDisabled(total <= 0)
  );
  return { embeds: [embed], components: [row] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('misiones')
    .setDescription('🗓️ Tus misiones diarias: complétalas jugando y reclama monedas.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    await interaction.reply(buildView(userId));
    const msg = await interaction.fetchReply();

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120000 });

    collector.on('collect', async (i) => {
      if (i.user.id !== userId) {
        return i
          .reply({ content: '❌ Estas misiones no son tuyas. Usa `/misiones` para ver las tuyas.', flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
      if (i.customId !== 'mis_claim') return;

      const day = dayKey();
      const claimable = progressFor(userId).filter((m) => m.done && !m.claimed);
      if (!claimable.length) {
        return i.reply({ content: 'No tienes recompensas pendientes ahora mismo.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      getUser(userId); // asegura el usuario con saldo inicial

      // Atómico e idempotente: solo se acredita lo que se inserta por primera vez
      // (la PRIMARY KEY + INSERT OR IGNORE impiden reclamar dos veces, aunque se
      // pulse muy rápido dos veces).
      const got = db.transaction(() => {
        let sum = 0;
        for (const m of claimable) {
          if (insertClaimStmt.run(day, userId, m.key, Date.now()).changes > 0) sum += m.reward;
        }
        if (sum > 0) addBalance(userId, sum);
        return sum;
      })();

      await i.update(buildView(userId)).catch(() => {});
      await i
        .followUp({
          content: got > 0 ? `🎁 ¡Reclamado **+${fmt(got)}** ${config.currency.symbol}! Sigue jugando para las demás.` : 'Esas recompensas ya estaban reclamadas.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
