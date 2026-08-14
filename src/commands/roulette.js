const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const { getUser, placeBet, payout, recordResult } = require('../lib/economy');
const antifraud = require('../lib/antifraud');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const config = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spin37 = () => Math.floor(Math.random() * 37);

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? '🟢' : RED.has(n) ? '🔴' : '⚫');

// Orden REAL de la rueda europea (un solo cero). Sirve para animar el giro
// mostrando los números vecinos pasando bajo el marcador, como en una ruleta física.
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const wheelIdx = (n) => WHEEL.indexOf(n);
const cellOf = (n) => `${colorOf(n)} ${String(n).padStart(2, ' ')}`;

// Columna vertical de la rueda centrada en `idx`. La casilla del medio es
// DONDE ESTÁ LA BOLA (marcada con 🎯 ➡️ … ⬅️); las de arriba/abajo son sus
// vecinas en la rueda. Se lee de arriba abajo y deja clarísimo dónde cae.
const wheelColumn = (idx, span = 2) => {
  const W = WHEEL.length;
  const lines = [];
  for (let o = -span; o <= span; o++) {
    const n = WHEEL[(((idx + o) % W) + W) % W];
    lines.push(o === 0 ? `🎯 ➡️ **${cellOf(n)}** ⬅️` : `▫️ ${cellOf(n)}`);
  }
  return lines.join('\n');
};

// Etiqueta de velocidad según lo que le queda a la bola para pararse.
const spinPhase = (framesLeft, total) => {
  if (framesLeft > total * 0.6) return '💨 girando rápido…';
  if (framesLeft > total * 0.3) return '🌀 dando vueltas…';
  if (framesLeft > 0) return '🐌 frenando…';
  return '🎯 ¡la bola se detiene!';
};

// Propiedades del número ganador (para el marcador de resultado).
const numberProps = (n) => {
  if (n === 0) return '🟢 Verde · el cero (gana la casa en las simples)';
  return [
    RED.has(n) ? '🔴 Rojo' : '⚫ Negro',
    n % 2 === 0 ? 'Par' : 'Impar',
    n <= 18 ? 'Bajo (1-18)' : 'Alto (19-36)',
    n <= 12 ? 'Docena 1' : n <= 24 ? 'Docena 2' : 'Docena 3',
  ].join(' · ');
};

// Fichas disponibles (valor de cada ficha que se coloca en la mesa).
const CHIPS = [10, 100, 1000, 10000];
const chipLabel = (v) => (v >= 1000 ? `${v / 1000}k` : String(v));

// Catálogo de apuestas exteriores. `pay` = beneficio neto (rojo x1 => cobras el doble).
const BETS = {
  rojo: { label: '🔴 Rojo', pay: 1, emoji: '🔴', hit: (n) => RED.has(n) },
  negro: { label: '⚫ Negro', pay: 1, emoji: '⚫', hit: (n) => n !== 0 && !RED.has(n) },
  par: { label: 'Par', pay: 1, emoji: '🔢', hit: (n) => n !== 0 && n % 2 === 0 },
  impar: { label: 'Impar', pay: 1, emoji: '🔣', hit: (n) => n % 2 === 1 },
  bajo: { label: 'Bajo (1-18)', pay: 1, emoji: '⬇️', hit: (n) => n >= 1 && n <= 18 },
  alto: { label: 'Alto (19-36)', pay: 1, emoji: '⬆️', hit: (n) => n >= 19 && n <= 36 },
  docena1: { label: 'Docena 1 (1-12)', pay: 2, emoji: '1️⃣', hit: (n) => n >= 1 && n <= 12 },
  docena2: { label: 'Docena 2 (13-24)', pay: 2, emoji: '2️⃣', hit: (n) => n >= 13 && n <= 24 },
  docena3: { label: 'Docena 3 (25-36)', pay: 2, emoji: '3️⃣', hit: (n) => n >= 25 && n <= 36 },
  columna1: { label: 'Columna 1', pay: 2, emoji: '🇦', hit: (n) => n !== 0 && n % 3 === 1 },
  columna2: { label: 'Columna 2', pay: 2, emoji: '🇧', hit: (n) => n !== 0 && n % 3 === 2 },
  columna3: { label: 'Columna 3', pay: 2, emoji: '🇨', hit: (n) => n !== 0 && n % 3 === 0 },
};

const MAX_BETS = 15; // apuestas distintas simultáneas (para no reventar el embed)
const clampField = (s) => (s.length > 1024 ? `${s.slice(0, 1000)}\n…` : s);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ruleta')
    .setDescription('🎡 Ruleta europea: coloca varias apuestas en la mesa y gira, como en un casino real.'),

  async execute(interaction) {
    const userId = interaction.user.id;

    // Estado de la mesa (persiste entre giros).
    let chip = 100;
    const bets = new Map(); // id -> { label, pay, hit, amount }

    const total = () => [...bets.values()].reduce((s, b) => s + b.amount, 0);

    /** Añade una ficha del valor actual a la apuesta `id`. Devuelve error o null. */
    const addChip = (id, def) => {
      const t = total();
      const bal = getUser(userId).balance;
      if (!bets.has(id) && bets.size >= MAX_BETS)
        return `Máximo ${MAX_BETS} apuestas distintas por tirada.`;
      if (t + chip > bal) return `No te llega el saldo. Tienes ${fmt(bal)} ${config.currency.symbol}.`;
      if (t + chip > config.limits.maxBet)
        return `El total por tirada no puede pasar de ${fmt(config.limits.maxBet)} ${config.currency.symbol}.`;
      const cur = bets.get(id);
      if (cur) cur.amount += chip;
      else bets.set(id, { ...def, amount: chip });
      return null;
    };

    // ---- Render de la mesa de apuestas ----
    const boardEmbed = () => {
      const bal = getUser(userId).balance;
      const list = bets.size
        ? [...bets.values()]
            .map((b) => `${b.label} · ${coins(b.amount)} _(paga x${b.pay + 1})_`)
            .join('\n')
        : '_Aún no has puesto ninguna ficha._';
      return base(config.colors.primary)
        .setTitle('🎡 Mesa de ruleta')
        .setDescription(
          `Ficha actual: **${fmt(chip)}** ${config.currency.symbol}\n` +
            'Elige apuestas en el menú, ajusta la ficha con los botones y pulsa **🎡 Girar**.'
        )
        .addFields(
          { name: `Tus apuestas (${bets.size})`, value: clampField(list) },
          { name: 'Total apostado', value: coins(total()), inline: true },
          { name: 'Tu saldo', value: coins(bal), inline: true }
        );
    };

    const selectRow = () =>
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('addbet')
          .setPlaceholder('➕ Añade una apuesta')
          .addOptions(
            ...Object.entries(BETS).map(([value, b]) => ({
              label: b.label,
              value,
              emoji: b.emoji,
              description: `Paga x${b.pay + 1}`,
            })),
            { label: 'Número exacto (0-36)', value: 'numero', emoji: '🎯', description: 'Paga x36' }
          )
      );

    const chipRow = () =>
      new ActionRowBuilder().addComponents(
        ...CHIPS.map((v) =>
          new ButtonBuilder()
            .setCustomId(`chip_${v}`)
            .setLabel(chipLabel(v))
            .setStyle(v === chip ? ButtonStyle.Primary : ButtonStyle.Secondary)
        )
      );

    const actionRow = () =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('spin')
          .setEmoji('🎡')
          .setLabel('Girar')
          .setStyle(ButtonStyle.Success)
          .setDisabled(bets.size === 0),
        new ButtonBuilder()
          .setCustomId('clear')
          .setEmoji('🗑️')
          .setLabel('Limpiar')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(bets.size === 0),
        new ButtonBuilder().setCustomId('cancel').setEmoji('🚪').setLabel('Cerrar').setStyle(ButtonStyle.Danger)
      );

    const boardView = () => ({
      embeds: [boardEmbed()],
      components: [selectRow(), chipRow(), actionRow()],
    });

    // ---- Selector visual de número exacto (sin escribir nada) ----
    // Discord limita cada desplegable a 25 opciones, así que partimos 0-36 en dos.
    const numberMenu = (id, from, to) =>
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(id)
          .setPlaceholder(`🎯 Números ${from} – ${to}`)
          .addOptions(
            Array.from({ length: to - from + 1 }, (_, k) => {
              const n = from + k;
              return {
                label: `Número ${n}`,
                value: String(n),
                emoji: colorOf(n),
                description: n === 0 ? 'Verde' : RED.has(n) ? 'Rojo' : 'Negro',
              };
            })
          )
      );

    const numberPickerView = () => ({
      embeds: [
        base(config.colors.primary)
          .setTitle('🎯 Elige un número')
          .setDescription(
            `Ficha actual: **${fmt(chip)}** ${config.currency.symbol} · el número exacto **paga x36**.\n` +
              'Toca el número en un desplegable (van con su color, como en la ruleta).'
          ),
      ],
      components: [numberMenu('pick_lo', 0, 18), numberMenu('pick_hi', 19, 36), backRow()],
    });

    const backRow = () =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pickback').setEmoji('⬅️').setLabel('Volver a la mesa').setStyle(ButtonStyle.Secondary)
      );

    /** Añade una ficha al número elegido y vuelve a la mesa. */
    const pickNumber = async (i, n) => {
      const err = addChip(`n:${n}`, {
        label: `${colorOf(n)} Número ${n}`,
        pay: 35,
        hit: (x) => x === n,
      });
      if (err) return i.reply({ content: `❌ ${err}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      await i.update(boardView()).catch(() => {});
    };

    // ---- Fase de apuestas: resuelve 'spin' | 'cancel' | 'timeout' ----
    const bettingPhase = () =>
      new Promise((resolve) => {
        interaction.editReply(boardView());
        const collector = response.createMessageComponentCollector({ time: 300000 });

        collector.on('collect', async (i) => {
          if (i.user.id !== userId) {
            return i
              .reply({ content: '❌ Esta mesa no es tuya. Usa `/ruleta` para jugar tú.', flags: MessageFlags.Ephemeral })
              .catch(() => {});
          }

          if (i.isStringSelectMenu()) {
            if (i.customId === 'addbet') {
              const val = i.values[0];
              if (val === 'numero') return i.update(numberPickerView()).catch(() => {});
              const err = addChip(val, BETS[val]);
              if (err) return i.reply({ content: `❌ ${err}`, flags: MessageFlags.Ephemeral }).catch(() => {});
              return i.update(boardView()).catch(() => {});
            }
            if (i.customId === 'pick_lo' || i.customId === 'pick_hi') {
              return pickNumber(i, Number(i.values[0]));
            }
          }

          if (i.isButton()) {
            if (i.customId === 'pickback') {
              return i.update(boardView()).catch(() => {});
            }
            if (i.customId.startsWith('chip_')) {
              chip = Number(i.customId.slice(5));
              return i.update(boardView()).catch(() => {});
            }
            if (i.customId === 'clear') {
              bets.clear();
              return i.update(boardView()).catch(() => {});
            }
            if (i.customId === 'cancel') {
              await i.deferUpdate().catch(() => {});
              return collector.stop('cancel');
            }
            if (i.customId === 'spin') {
              if (bets.size === 0) {
                return i
                  .reply({ content: '❌ Añade al menos una apuesta antes de girar.', flags: MessageFlags.Ephemeral })
                  .catch(() => {});
              }
              await i.deferUpdate().catch(() => {});
              return collector.stop('spin');
            }
          }
        });

        collector.on('end', (_c, reason) => resolve(reason === 'spin' ? 'spin' : reason === 'cancel' ? 'cancel' : 'timeout'));
      });

    // ---- Giro + resolución de todas las apuestas. Resuelve 'repeat' | 'new' | 'stop' ----
    const spin = async () => {
      const staked = total();
      const guard = antifraud.check(interaction, staked);
      if (!guard.ok) {
        await interaction
          .editReply({
            embeds: [base(config.colors.red).setTitle('🎡 Ruleta').setDescription(`❌ ${guard.error}`)],
            components: [],
          })
          .catch(() => {});
        return 'stop';
      }
      if (!placeBet(userId, staked)) {
        await interaction
          .editReply({
            embeds: [
              base(config.colors.red)
                .setTitle('❌ Saldo insuficiente')
                .setDescription(`Necesitas ${coins(staked)} para girar y tu saldo ha cambiado.`),
            ],
            components: [],
          })
          .catch(() => {});
        return 'stop';
      }

      // El resultado se decide ya; la animación solo desacelera hasta él.
      const result = spin37();
      const resultIdx = wheelIdx(result);

      // Fotogramas que desaceleran: cada vez avanzan menos y esperan más,
      // de modo que la bola "frena" y cae justo en el número ganador.
      const advances = [5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1];
      const delays = [200, 220, 250, 290, 340, 400, 470, 560, 670, 800, 950];
      const travel = advances.reduce((a, b) => a + b, 0);
      let idx = (((resultIdx - travel) % WHEEL.length) + WHEEL.length) % WHEEL.length;
      const totalFrames = advances.length;
      for (let f = 0; f < totalFrames; f++) {
        idx = (idx + advances[f]) % WHEEL.length;
        const framesLeft = totalFrames - 1 - f;
        await interaction
          .editReply({
            embeds: [
              base(config.colors.primary)
                .setTitle('🎡 La ruleta gira…')
                .setDescription(
                  '🔻 **La bola cae en el número del centro** 🎯\n\n' +
                    `${wheelColumn(idx)}\n\n${spinPhase(framesLeft, totalFrames)}`
                )
                .addFields({ name: 'Total apostado', value: coins(staked), inline: true }),
            ],
            components: [],
          })
          .catch(() => {});
        await sleep(delays[f]);
      }
      // idx === resultIdx aquí: la tira queda centrada en el número ganador.
      let returned = 0;
      const lines = [];
      for (const b of bets.values()) {
        if (b.hit(result)) {
          returned += b.amount + b.amount * b.pay;
          lines.push(`✅ ${b.label} · ${fmt(b.amount)} → **+${fmt(b.amount * b.pay)}**`);
        } else {
          lines.push(`❌ ${b.label} · ${fmt(b.amount)} → -${fmt(b.amount)}`);
        }
      }

      payout(userId, returned);
      const net = returned - staked;
      recordResult(userId, { wagered: staked, net, game: 'ruleta' });
      const bal = getUser(userId).balance;

      const outcome = net > 0 ? '🎉 **¡Ganaste!**' : net === 0 ? '😐 **Ni fu ni fa.**' : '💀 **La casa gana.**';
      const embed = base(net > 0 ? config.colors.green : net === 0 ? config.colors.gold : config.colors.red)
        .setTitle(`🎡 La bola se para en  ${colorOf(result)} ${result}`)
        .setDescription(`${wheelColumn(resultIdx)}\n\n🔺 ${numberProps(result)}\n\n${outcome}`)
        .addFields(
          { name: `Tus apuestas (${bets.size})`, value: clampField(lines.join('\n')) },
          { name: 'Total apostado', value: coins(staked), inline: true },
          { name: 'Resultado neto', value: `${net >= 0 ? '+' : ''}${fmt(net)} ${config.currency.symbol}`, inline: true },
          { name: 'Saldo', value: coins(bal), inline: true }
        );

      const replayRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('repeat')
          .setEmoji('🔁')
          .setLabel(`Repetir · ${fmt(staked)} ${config.currency.symbol}`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(bal < staked),
        new ButtonBuilder().setCustomId('newboard').setEmoji('🎰').setLabel('Nueva mesa').setStyle(ButtonStyle.Primary)
      );
      await interaction.editReply({ embeds: [embed], components: [replayRow] }).catch(() => {});

      return new Promise((resolve) => {
        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 90000,
        });
        collector.on('collect', async (i) => {
          if (i.user.id !== userId) {
            return i.reply({ content: '❌ Esta mesa no es tuya.', flags: MessageFlags.Ephemeral }).catch(() => {});
          }
          if (i.customId === 'repeat') {
            if (getUser(userId).balance < staked) {
              return i
                .reply({ content: `❌ Necesitas ${coins(staked)} para repetir.`, flags: MessageFlags.Ephemeral })
                .catch(() => {});
            }
            await i.deferUpdate().catch(() => {});
            return collector.stop('repeat');
          }
          if (i.customId === 'newboard') {
            await i.deferUpdate().catch(() => {});
            return collector.stop('new');
          }
        });
        collector.on('end', (_c, reason) => resolve(reason === 'repeat' ? 'repeat' : reason === 'new' ? 'new' : 'stop'));
      });
    };

    // ---- Bucle principal ----
    await interaction.deferReply();
    const response = await interaction.fetchReply();

    let state = await bettingPhase();
    while (state === 'spin') {
      const after = await spin();
      if (after === 'repeat') continue; // mismas apuestas, otro giro
      if (after === 'new') {
        bets.clear();
        state = await bettingPhase();
        continue;
      }
      state = 'closed'; // 'stop'
    }

    if (state === 'closed') {
      return interaction.editReply({ components: [] }).catch(() => {});
    }
    // La mesa se cerró o expiró sin girar: no se apostó nada.
    return interaction
      .editReply({
        embeds: [
          base(config.colors.dark)
            .setTitle('🚪 Mesa cerrada')
            .setDescription(state === 'cancel' ? 'Cerraste la mesa. No se apostó nada.' : '⌛ Tiempo agotado. No se apostó nada.'),
        ],
        components: [],
      })
      .catch(() => {});
  },
};
