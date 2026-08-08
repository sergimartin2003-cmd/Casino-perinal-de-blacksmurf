// Ajustes editables en caliente desde Discord (/config).
// Se guardan en la tabla `settings` como JSON y se aplican SOBRE el objeto
// config en memoria, así que todo el código que lee `config.*` en tiempo de
// ejecución ve el valor actualizado sin reiniciar ni tocar config.js.
const db = require('../database/db');
const config = require('../config');

const getAllStmt = db.prepare('SELECT key, value FROM settings');
const upsertStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

/** Escribe un valor por ruta de puntos ("a.b.c") dentro de config. */
function applyPath(path, value) {
  const parts = path.split('.');
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
}

/** Lee un valor por ruta de puntos desde config. */
function get(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config);
}

/** Carga los ajustes guardados y los aplica sobre config. Llamar al arrancar. */
function load() {
  for (const { key, value } of getAllStmt.all()) {
    try {
      applyPath(key, JSON.parse(value));
    } catch {
      applyPath(key, value);
    }
  }
}

/** Cambia un ajuste: lo aplica en memoria y lo persiste en la base de datos. */
function set(path, value) {
  applyPath(path, value);
  upsertStmt.run(path, JSON.stringify(value));
}

module.exports = { load, set, get };
