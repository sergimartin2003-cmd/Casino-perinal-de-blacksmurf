const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { isStaff } = require('../lib/owner');
const settings = require('../lib/settings');
const { base } = require('../lib/embeds');
const { fmt } = require('../lib/format');
const config = require('../config');

const chan = (id) => (id ? `<#${id}>` : '_sin configurar_');
const role = (id) => (id ? `<@&${id}>` : '_ninguno_');
const onoff = (b) => (b ? '✅ activado' : '❌ desactivado');

// Juegos con canal/rol configurable (nombres = nombre del comando).
const GAMES = ['slots', 'ruleta', 'blackjack', 'poker', 'mines', 'hilo', 'dados', 'carrera', 'cripto', 'coinflip', 'loteria'];
const showChannels = (v) =>
  Array.isArray(v) ? v.filter(Boolean).map((id) => `<#${id}>`).join(' o ') || 'cualquiera' : v ? `<#${v}>` : 'cualquiera';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('⚙️ (admin/owner) Ajusta el casino desde Discord (se guarda, sin reiniciar).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('ver').setDescription('Muestra toda la configuración actual.'))
    .addSubcommand((s) =>
      s
        .setName('canales')
        .setDescription('Fija los canales de cada servicio.')
        .addChannelOption((o) => o.setName('jackpot').setDescription('Canal del tablero del jackpot en vivo').addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('reporte').setDescription('Canal del reporte diario').addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('backup').setDescription('Canal donde subir las copias de seguridad').addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('log').setDescription('Canal de registro de partidas').addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((s) =>
      s
        .setName('jackpot')
        .setDescription('Parámetros del jackpot progresivo.')
        .addNumberOption((o) => o.setName('aportacion').setDescription('% de cada apuesta al bote (ej: 1 = 1%)').setMinValue(0).setMaxValue(100))
        .addIntegerOption((o) => o.setName('base').setDescription('Valor base al reiniciar el bote').setMinValue(0))
        .addIntegerOption((o) => o.setName('dias_cuenta').setDescription('Días de antigüedad para poder cobrarlo').setMinValue(0))
        .addIntegerOption((o) => o.setName('invitados').setDescription('Invitados necesarios (alternativa a la antigüedad)').setMinValue(0))
    )
    .addSubcommand((s) =>
      s
        .setName('reporte')
        .setDescription('Parámetros del reporte diario.')
        .addIntegerOption((o) => o.setName('hora').setDescription('Hora de publicación (0-23)').setMinValue(0).setMaxValue(23))
        .addIntegerOption((o) => o.setName('minuto').setDescription('Minuto (0-59)').setMinValue(0).setMaxValue(59))
        .addIntegerOption((o) => o.setName('tasa_euro').setDescription('Monedas por 1 € (ventas)').setMinValue(1))
        .addRoleOption((o) => o.setName('rol_vip').setDescription('Rol que cuenta como VIP'))
    )
    .addSubcommand((s) =>
      s
        .setName('antifraude')
        .setDescription('Límites anti-fraude por usuario (1 hora).')
        .addIntegerOption((o) => o.setName('apuestas_hora').setDescription('Máx. apuestas por hora').setMinValue(1))
        .addIntegerOption((o) => o.setName('ganado_hora').setDescription('Máx. monedas ganadas por hora').setMinValue(1))
        .addIntegerOption((o) => o.setName('cuenta_nueva_horas').setDescription('Horas para considerar "cuenta nueva"').setMinValue(0))
        .addIntegerOption((o) => o.setName('cuenta_nueva_max').setDescription('Apuesta máx. de cuentas nuevas').setMinValue(1))
    )
    .addSubcommand((s) =>
      s
        .setName('backup')
        .setDescription('Copias de seguridad automáticas.')
        .addBooleanOption((o) => o.setName('activado').setDescription('Activar/desactivar (aplica al reiniciar)'))
        .addIntegerOption((o) => o.setName('intervalo_horas').setDescription('Cada cuántas horas (aplica al reiniciar)').setMinValue(1))
        .addIntegerOption((o) => o.setName('conservar').setDescription('Cuántas copias locales guardar').setMinValue(1))
    )
    .addSubcommand((s) =>
      s
        .setName('juego')
        .setDescription('Canal y rol de un juego concreto.')
        .addStringOption((o) =>
          o
            .setName('juego')
            .setDescription('¿Qué juego?')
            .setRequired(true)
            .addChoices(...GAMES.map((g) => ({ name: g, value: g })))
        )
        .addChannelOption((o) => o.setName('canal').setDescription('Canal donde se podrá jugar').addChannelTypes(ChannelType.GuildText))
        .addBooleanOption((o) => o.setName('abrir_a_todos').setDescription('Permitir en CUALQUIER canal (quita la restricción)'))
        .addRoleOption((o) => o.setName('rol').setDescription('Rol necesario para jugarlo (además del rol global)'))
        .addBooleanOption((o) => o.setName('quitar_rol').setDescription('Quitar el rol específico de este juego'))
    ),

  async execute(interaction) {
    if (!isStaff(interaction)) {
      return interaction.reply({ content: '❌ Solo admins/owners pueden tocar la configuración.', flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();
    const sym = config.currency.symbol;

    if (sub === 'ver') {
      const j = config.jackpot, d = config.dailyReport, a = config.antifraud, b = config.backup;
      const embed = base(config.colors.primary)
        .setTitle('⚙️ Configuración del casino')
        .addFields(
          {
            name: '📺 Canales',
            value:
              `Jackpot (tablero): ${chan(j.displayChannel)}\n` +
              `Reporte diario: ${chan(d.channel)}\n` +
              `Backup: ${chan(b.channel)}\n` +
              `Log de partidas: ${chan(config.logChannel)}`,
          },
          {
            name: '🏆 Jackpot',
            value:
              `Aportación: **${(j.contribution * 100).toFixed(2)}%** · Base: **${fmt(j.seed)}** ${sym}\n` +
              `Cobro: ${j.minAccountAgeDays} días de cuenta **o** ${j.minInvites} invitados` +
              (j.trackInvites ? ' · invitados: ✅' : ' · invitados: ❌'),
          },
          {
            name: '📊 Reporte diario',
            value:
              `Hora: **${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}** · Tasa: **${fmt(d.coinsPerEuro)}** monedas = 1 €\n` +
              `Rol VIP: ${role(d.vipRole)}`,
          },
          {
            name: '🛡️ Anti-fraude (por usuario/hora)',
            value:
              `Máx. apuestas: **${fmt(a.maxBetsPerHour)}** · Máx. ganado: **${fmt(a.maxWonPerHour)}** ${sym}\n` +
              `Cuenta nueva: < **${a.newAccountMaxAgeHours}h** → máx **${fmt(a.newAccountMaxBet)}** ${sym}`,
          },
          {
            name: '🗄️ Backup',
            value: `${onoff(b.enabled)} · cada **${b.intervalHours}h** · conserva **${b.keep}** copias`,
          },
          {
            name: `🎮 Juegos (canal · rol) — rol global: ${role(config.requiredRole)}`,
            value: GAMES.map(
              (g) => `\`${g.padEnd(9)}\` ${showChannels(config.channels?.[g])}` + (config.gameRoles?.[g] ? ` · <@&${config.gameRoles[g]}>` : '')
            ).join('\n'),
          }
        )
        .setFooter({ text: 'Cambia con /config <sección>. Se guarda en la base de datos.' });
      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
    }

    const changes = [];

    if (sub === 'canales') {
      const map = { jackpot: 'jackpot.displayChannel', reporte: 'dailyReport.channel', backup: 'backup.channel', log: 'logChannel' };
      for (const [opt, path] of Object.entries(map)) {
        const c = interaction.options.getChannel(opt);
        if (c) {
          settings.set(path, c.id);
          changes.push(`${opt} → <#${c.id}>`);
        }
      }
    } else if (sub === 'jackpot') {
      const ap = interaction.options.getNumber('aportacion');
      const base_ = interaction.options.getInteger('base');
      const dias = interaction.options.getInteger('dias_cuenta');
      const inv = interaction.options.getInteger('invitados');
      if (ap !== null) { settings.set('jackpot.contribution', ap / 100); changes.push(`aportación → ${ap}%`); }
      if (base_ !== null) { settings.set('jackpot.seed', base_); changes.push(`base → ${fmt(base_)} ${sym}`); }
      if (dias !== null) { settings.set('jackpot.minAccountAgeDays', dias); changes.push(`días de cuenta → ${dias}`); }
      if (inv !== null) { settings.set('jackpot.minInvites', inv); changes.push(`invitados → ${inv}`); }
    } else if (sub === 'reporte') {
      const hora = interaction.options.getInteger('hora');
      const min = interaction.options.getInteger('minuto');
      const tasa = interaction.options.getInteger('tasa_euro');
      const vip = interaction.options.getRole('rol_vip');
      if (hora !== null) { settings.set('dailyReport.hour', hora); changes.push(`hora → ${String(hora).padStart(2, '0')}`); }
      if (min !== null) { settings.set('dailyReport.minute', min); changes.push(`minuto → ${String(min).padStart(2, '0')}`); }
      if (tasa !== null) { settings.set('dailyReport.coinsPerEuro', tasa); changes.push(`tasa → ${fmt(tasa)} monedas = 1 €`); }
      if (vip) { settings.set('dailyReport.vipRole', vip.id); changes.push(`rol VIP → <@&${vip.id}>`); }
    } else if (sub === 'antifraude') {
      const bh = interaction.options.getInteger('apuestas_hora');
      const gh = interaction.options.getInteger('ganado_hora');
      const cnh = interaction.options.getInteger('cuenta_nueva_horas');
      const cnm = interaction.options.getInteger('cuenta_nueva_max');
      if (bh !== null) { settings.set('antifraud.maxBetsPerHour', bh); changes.push(`apuestas/hora → ${fmt(bh)}`); }
      if (gh !== null) { settings.set('antifraud.maxWonPerHour', gh); changes.push(`ganado/hora → ${fmt(gh)} ${sym}`); }
      if (cnh !== null) { settings.set('antifraud.newAccountMaxAgeHours', cnh); changes.push(`cuenta nueva → < ${cnh}h`); }
      if (cnm !== null) { settings.set('antifraud.newAccountMaxBet', cnm); changes.push(`máx. cuenta nueva → ${fmt(cnm)} ${sym}`); }
    } else if (sub === 'backup') {
      const act = interaction.options.getBoolean('activado');
      const iv = interaction.options.getInteger('intervalo_horas');
      const keep = interaction.options.getInteger('conservar');
      if (act !== null) { settings.set('backup.enabled', act); changes.push(`backup → ${act ? 'activado' : 'desactivado'} (reinicia)`); }
      if (iv !== null) { settings.set('backup.intervalHours', iv); changes.push(`intervalo → ${iv}h (reinicia)`); }
      if (keep !== null) { settings.set('backup.keep', keep); changes.push(`conservar → ${keep}`); }
    } else if (sub === 'juego') {
      const game = interaction.options.getString('juego');
      const canal = interaction.options.getChannel('canal');
      const abrir = interaction.options.getBoolean('abrir_a_todos');
      const rol = interaction.options.getRole('rol');
      const quitarRol = interaction.options.getBoolean('quitar_rol');

      if (abrir) { settings.set(`channels.${game}`, ''); changes.push(`${game}: canal → cualquiera`); }
      else if (canal) { settings.set(`channels.${game}`, canal.id); changes.push(`${game}: canal → <#${canal.id}>`); }

      if (quitarRol) { settings.set(`gameRoles.${game}`, ''); changes.push(`${game}: rol → ninguno`); }
      else if (rol) { settings.set(`gameRoles.${game}`, rol.id); changes.push(`${game}: rol → <@&${rol.id}>`); }
    }

    if (!changes.length) {
      return interaction.reply({ content: 'ℹ️ No indicaste ningún valor a cambiar. Usa `/config ver` para ver la configuración.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: `✅ Guardado:\n• ${changes.join('\n• ')}\n\n_Los valores se aplican al momento. Activar servicios apagados o cambiar horarios/temporizadores puede requerir reiniciar el bot._`,
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  },
};
