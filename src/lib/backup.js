// Copias de seguridad automáticas de la base de datos.
// - Copia local segura (backup online de SQLite, consistente aun con WAL) a
//   la carpeta backups/ cada X horas, con rotación (conserva las últimas N).
// - Subida off-site opcional: a un canal de Discord y/o a un servidor externo
//   (POST del archivo). Para Google Drive, ver README (necesita credenciales).
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const config = require('../config');

const B = () => config.backup;

function backupDir() {
  const raw = B().dir || 'backups';
  const dir = path.isAbsolute(raw) ? raw : path.join(__dirname, '..', '..', raw);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Conserva solo las N copias más recientes; borra el resto. */
function prune(dir) {
  const keep = Math.max(1, B().keep || 12);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^casino-.*\.db$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* ya no está */
    }
  }
}

async function uploadDiscord(client, filePath, name) {
  const channelId = B().channel;
  if (!channelId || !client) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;
    await channel.send({ content: `🗄️ Backup \`${name}\``, files: [{ attachment: filePath, name }] });
  } catch (e) {
    console.error('Backup: no se pudo subir a Discord:', e.message);
  }
}

async function uploadWebhook(filePath, name) {
  const url = B().webhookUrl;
  if (!url) return;
  try {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(filePath)]), name);
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) console.error('Backup: el servidor externo respondió', res.status);
  } catch (e) {
    console.error('Backup: no se pudo subir al servidor externo:', e.message);
  }
}

/**
 * Hace una copia ya mismo: backup online -> backups/, rota y sube off-site.
 * @returns {Promise<{ path: string, name: string, size: number }>}
 */
async function backupOnce(client) {
  const dir = backupDir();
  const name = `casino-${stamp()}.db`;
  const dest = path.join(dir, name);

  await db.backup(dest); // copia consistente aunque el bot esté escribiendo
  prune(dir);

  await uploadDiscord(client, dest, name);
  await uploadWebhook(dest, name);

  return { path: dest, name, size: fs.statSync(dest).size };
}

/** Arranca el planificador de backups (llamar en ClientReady). */
function startScheduler(client) {
  if (!B().enabled) return;
  const ms = Math.max(1, B().intervalHours || 6) * 60 * 60 * 1000;
  // Primera copia poco después de arrancar (sin bloquear el arranque).
  setTimeout(() => {
    backupOnce(client).catch((e) => console.error('Backup inicial falló:', e.message));
  }, 15000);
  const timer = setInterval(() => {
    backupOnce(client).catch((e) => console.error('Backup periódico falló:', e.message));
  }, ms);
  if (timer.unref) timer.unref();
}

module.exports = { backupOnce, startScheduler };
