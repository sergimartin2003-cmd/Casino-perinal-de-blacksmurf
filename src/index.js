require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Events, MessageFlags } = require('discord.js');

const config = require('./config');
// Aplica los ajustes guardados con /config SOBRE config antes de cargar nada más.
require('./lib/settings').load();
const { startResolver } = require('./lib/cryptoRounds');
const gamelog = require('./lib/gamelog');
const lottery = require('./lib/lottery');
const jackpotBoard = require('./lib/jackpotBoard');
const invites = require('./lib/invites');
const dailyReport = require('./lib/dailyReport');
const antifraud = require('./lib/antifraud');
const backup = require('./lib/backup');
const { isStaff } = require('./lib/owner');

// Intents mínimos por defecto (sin privilegiados). El seguimiento de
// invitaciones del jackpot exige GuildMembers (privilegiado) + GuildInvites;
// solo se piden si se activa en config para no romper el arranque del bot.
const intents = [GatewayIntentBits.Guilds];
if (config.jackpot.trackInvites) {
  intents.push(GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites);
}

const client = new Client({ intents });
client.commands = new Collection();

// Carga dinámica de todos los comandos de /commands
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`⚠️  El comando ${file} no exporta { data, execute }.`);
  }
}

/** ¿El miembro tiene ese rol? Soporta GuildMember (roles.cache) y payload crudo (array). */
function memberHasRole(member, roleId) {
  if (!member) return false;
  const roles = member.roles;
  if (roles?.cache) return roles.cache.has(roleId);
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

client.once(Events.ClientReady, (c) => {
  console.log(`✅ ${c.user.tag} conectado — ${config.casino.name} abierto.`);
  c.user.setActivity(`${config.casino.name} 🎰 /help`, { type: 0 });
  startResolver(c); // liquida las apuestas de /cripto cuando cierra su ventana
  gamelog.attach(c); // registra cada partida en el canal de log
  lottery.startScheduler(c); // sortea la lotería cuando vence su temporizador
  jackpotBoard.start(c); // muestra el bote en vivo en el canal fijo configurado
  invites.attach(c); // rastrea invitaciones (si trackInvites está activado)
  invites.init(c); // cachea las invitaciones actuales de cada servidor
  dailyReport.attach(); // acumula estadísticas por día de cada partida
  dailyReport.startScheduler(c); // publica el reporte diario en el canal configurado
  antifraud.attach(); // registra apuestas/ganancias por hora para los límites anti-fraude
  backup.startScheduler(c); // copias de seguridad automáticas de la base de datos
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const isGame = Object.prototype.hasOwnProperty.call(config.channels ?? {}, interaction.commandName);
  const staff = isStaff(interaction);

  // Rol "jugador" obligatorio para usar CUALQUIER comando del bot (salvo admins/owners).
  if (config.requiredRole && !staff) {
    if (!interaction.inGuild()) {
      return interaction
        .reply({ content: '❌ Este bot solo se puede usar dentro del servidor.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    if (!memberHasRole(interaction.member, config.requiredRole)) {
      return interaction
        .reply({
          content: `❌ Necesitas el rol <@&${config.requiredRole}> para usar el bot. Pídeselo a un administrador.`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }

  // Restricción de canal por juego: cada juego solo en su canal.
  const allowedRaw = config.channels?.[interaction.commandName];
  const allowedList = (Array.isArray(allowedRaw) ? allowedRaw : [allowedRaw]).filter(Boolean);
  if (allowedList.length && !allowedList.includes(interaction.channelId)) {
    const where = allowedList.map((id) => `<#${id}>`).join(' o ');
    return interaction
      .reply({
        content: `❌ **/${interaction.commandName}** solo se puede jugar en ${where}.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }

  // Rol obligatorio POR JUEGO (además del global), salvo admins/owners.
  const gameRole = config.gameRoles?.[interaction.commandName];
  if (gameRole && !staff && !memberHasRole(interaction.member, gameRole)) {
    return interaction
      .reply({
        content: `❌ Para **/${interaction.commandName}** necesitas el rol <@&${gameRole}>.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error en /${interaction.commandName}:`, err);
    const payload = {
      content: '❌ Algo salió mal en la mesa. Inténtalo de nuevo.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
