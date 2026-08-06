const { SlashCommandBuilder } = require('discord.js');
const { getUser, addBalance, setDaily } = require('../lib/economy');
const { base } = require('../lib/embeds');
const { coins, bar } = require('../lib/format');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Reclama tu recompensa diaria de Novas (¡mantén la racha!).'),

  async execute(interaction) {
    const u = getUser(interaction.user.id);
    const now = Date.now();
    const { dailyAmount, dailyCooldown, dailyStreakBonus, dailyStreakMax, streakResetAfter } =
      config.economy;

    if (u.last_daily && now - u.last_daily < dailyCooldown) {
      const remaining = dailyCooldown - (now - u.last_daily);
      const h = Math.floor(remaining / 3.6e6);
      const m = Math.floor((remaining % 3.6e6) / 6e4);
      const embed = base(config.colors.red)
        .setTitle('⏳ Aún no toca')
        .setDescription(`Vuelve dentro de **${h}h ${m}m** para tu próxima recompensa diaria.`);
      return interaction.reply({ embeds: [embed] });
    }

    // Calcular racha
    let streak = 1;
    if (u.last_daily && now - u.last_daily <= streakResetAfter) {
      streak = u.daily_streak + 1;
    }

    const bonus = Math.min(streak, dailyStreakMax) * dailyStreakBonus;
    const total = dailyAmount + bonus;

    addBalance(interaction.user.id, total);
    setDaily(interaction.user.id, now, streak);

    const embed = base(config.colors.green)
      .setTitle('🎁 Recompensa diaria reclamada')
      .setDescription(`Has recibido ${coins(total)}`)
      .addFields(
        { name: 'Base', value: coins(dailyAmount), inline: true },
        { name: `🔥 Racha (x${streak})`, value: `+${bonus} ${config.currency.symbol}`, inline: true },
        {
          name: 'Progreso de bonus',
          value: `\`${bar(Math.min(streak, dailyStreakMax), dailyStreakMax)}\` ${Math.min(streak, dailyStreakMax)}/${dailyStreakMax}`,
        }
      )
      .setFooter({ text: 'Vuelve mañana para no perder la racha 🔥' });

    await interaction.reply({ embeds: [embed] });
  },
};
