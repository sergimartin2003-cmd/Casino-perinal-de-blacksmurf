const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'casino.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  balance       INTEGER NOT NULL DEFAULT 1000,
  bank          INTEGER NOT NULL DEFAULT 0,
  last_daily    INTEGER,
  daily_streak  INTEGER NOT NULL DEFAULT 0,
  last_work     INTEGER,
  total_wagered INTEGER NOT NULL DEFAULT 0,
  total_won     INTEGER NOT NULL DEFAULT 0,
  total_lost    INTEGER NOT NULL DEFAULT 0,
  biggest_win   INTEGER NOT NULL DEFAULT 0,
  games_played  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Ajustes editables desde Discord (/config). Sobrescriben los de config.js.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,   -- ruta con puntos, p. ej. "jackpot.seed"
  value TEXT NOT NULL       -- JSON del valor
);

-- Historial de jackpots reventados en /slots (para mostrar el último ganador).
CREATE TABLE IF NOT EXISTS jackpot_wins (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,           -- TEXT: los IDs de Discord no caben con precisión en INTEGER
  amount  INTEGER NOT NULL,
  won_at  INTEGER NOT NULL
);

-- Mensaje fijo que muestra el bote en vivo en un canal (se autoedita).
CREATE TABLE IF NOT EXISTS jackpot_board (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  channel_id TEXT NOT NULL,
  message_id TEXT
);

-- Invitaciones acumuladas por cada usuario (anti cuentas falsas del jackpot).
CREATE TABLE IF NOT EXISTS invites (
  user_id TEXT PRIMARY KEY,
  count   INTEGER NOT NULL DEFAULT 0
);

-- Estadísticas por día (para el reporte diario del casino). 'day' = 'YYYY-MM-DD'.
CREATE TABLE IF NOT EXISTS daily_stats (
  day      TEXT PRIMARY KEY,
  bets     INTEGER NOT NULL DEFAULT 0,  -- nº de apuestas (partidas) del día
  wagered  INTEGER NOT NULL DEFAULT 0,  -- monedas apostadas
  returned INTEGER NOT NULL DEFAULT 0,  -- monedas devueltas a jugadores (ganadas)
  sold     INTEGER NOT NULL DEFAULT 0,  -- monedas VENDIDAS ese día (/admin-saldo dar)
  reported INTEGER NOT NULL DEFAULT 0   -- 1 si ya se publicó el reporte de ese día
);

-- Actividad por usuario y día (usuarios activos y top apostador del día).
CREATE TABLE IF NOT EXISTS daily_active (
  day     TEXT NOT NULL,
  user_id TEXT NOT NULL,
  wagered INTEGER NOT NULL DEFAULT 0,
  bets    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
);

-- Momento del próximo reporte diario (una sola fila).
CREATE TABLE IF NOT EXISTS daily_report_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  next_report INTEGER NOT NULL
);

-- Auditoría: TODA apuesta liquidada (un registro por partida de cada juego).
CREATE TABLE IF NOT EXISTS bets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  game          TEXT,
  wagered       INTEGER NOT NULL,   -- monedas apostadas
  net           INTEGER NOT NULL,   -- resultado neto (>0 gana, <0 pierde)
  balance_after INTEGER NOT NULL,   -- saldo del usuario tras la partida
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bets_user ON bets (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bets_created ON bets (created_at);

-- Auditoría: TODA transferencia de monedas entre usuarios (/give).
CREATE TABLE IF NOT EXISTS transfers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers (from_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers (to_id, created_at);

-- Auditoría: acciones de admin sobre saldos (/admin-saldo). Quién ajustó a quién.
CREATE TABLE IF NOT EXISTS admin_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   TEXT NOT NULL,      -- admin que ejecutó
  target_id  TEXT NOT NULL,      -- usuario afectado
  action     TEXT NOT NULL,      -- dar | quitar | fijar
  amount     INTEGER NOT NULL,
  before_bal INTEGER NOT NULL,
  after_bal  INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_actor ON admin_actions (actor_id, created_at);

-- Apuestas de /cripto con ventana de tiempo real (se resuelven en diferido).
CREATE TABLE IF NOT EXISTS crypto_pending (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT,
  coin        TEXT NOT NULL,
  dir         TEXT NOT NULL,
  wager       INTEGER NOT NULL,
  open_price  REAL NOT NULL,
  open_at     INTEGER NOT NULL,
  close_at    INTEGER NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_crypto_pending_open
  ON crypto_pending (resolved, close_at);

-- Lotería: estado global (ronda actual y momento del próximo sorteo).
CREATE TABLE IF NOT EXISTS lottery_state (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  round     INTEGER NOT NULL DEFAULT 1,
  next_draw INTEGER NOT NULL
);

-- Boletos comprados por cada usuario en cada ronda.
CREATE TABLE IF NOT EXISTS lottery_tickets (
  round   INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  tickets INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (round, user_id)
);
`);

// Migraciones suaves para bases de datos ya creadas (añaden columnas nuevas).
try {
  db.exec('ALTER TABLE daily_stats ADD COLUMN sold INTEGER NOT NULL DEFAULT 0');
} catch {
  /* la columna ya existe */
}
// Elimina las tablas del viejo sistema de mercados en bases de datos antiguas.
db.exec('DROP TABLE IF EXISTS market_bets; DROP TABLE IF EXISTS markets;');

// Aplica la migración de apuestas deportivas (crea sports_events/odds/bets).
const sportsMigration = path.join(__dirname, '..', '..', 'migrations', 'sports_tables.sql');
if (fs.existsSync(sportsMigration)) {
  db.exec(fs.readFileSync(sportsMigration, 'utf8'));
}

module.exports = db;
