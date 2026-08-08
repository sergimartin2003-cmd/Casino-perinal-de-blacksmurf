require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

function collectCommandFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCommandFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const commands = [];
const commandDirs = [path.join(__dirname, 'commands'), path.join(__dirname, '..', 'commands')];
for (const dir of commandDirs) {
  for (const file of collectCommandFiles(dir)) {
    const command = require(file);
    if (command.data) commands.push(command.data.toJSON());
  }
}

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ Necesitas DISCORD_TOKEN y CLIENT_ID en el .env');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`⏳ Registrando ${commands.length} comandos…`);
    const route = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID);

    const data = await rest.put(route, { body: commands });
    console.log(
      `✅ ${data.length} comandos registrados ${GUILD_ID ? `en el servidor ${GUILD_ID}` : 'globalmente (pueden tardar hasta 1h en aparecer)'}.`
    );
  } catch (err) {
    console.error(err);
  }
})();
