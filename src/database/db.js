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

-- Historial de jackpots reventados en /slots (para mostrar el último ganador).
CREATE TABLE IF NOT EXISTS jackpot_wins (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,           -- TEXT: los IDs de Discord no caben con precisión en INTEGER
  amount  INTEGER NOT NULL,
  won_at  INTEGER NOT NULL
);

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

-- Apuestas deportivas: mercados que abren los owners (cuotas fijas).
CREATE TABLE IF NOT EXISTS markets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  options     TEXT NOT NULL,           -- JSON: [{ name, odds }]
  status      TEXT NOT NULL DEFAULT 'open', -- open | closed | resolved | void
  channel_id  TEXT,
  message_id  TEXT,                    -- mensaje-tablero con los botones
  league      TEXT,                    -- liga ESPN (si es partido real)
  event_id    TEXT,                    -- id del partido en ESPN (auto-resolución)
  event_date  INTEGER,                 -- hora del partido (epoch ms)
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  winner      INTEGER,                 -- índice de la opción ganadora al resolver
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS market_bets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id  INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  option_idx INTEGER NOT NULL,
  stake      INTEGER NOT NULL,
  odds       REAL NOT NULL,            -- cuota bloqueada al apostar
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_bets_market ON market_bets (market_id);
`);

// Migraciones suaves para bases de datos ya creadas (añaden columnas nuevas).
for (const col of ['message_id TEXT', 'league TEXT', 'event_id TEXT', 'event_date INTEGER']) {
  try {
    db.exec(`ALTER TABLE markets ADD COLUMN ${col}`);
  } catch {
    /* la columna ya existe */
  }
}

module.exports = db;
