-- Tabla de eventos deportivos
CREATE TABLE IF NOT EXISTS sports_events (
    id TEXT PRIMARY KEY,
    sport TEXT NOT NULL,
    league TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    status TEXT DEFAULT 'scheduled',
    home_score INTEGER DEFAULT 0,
    away_score INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de cuotas (odds)
CREATE TABLE IF NOT EXISTS sports_odds (
    event_id TEXT,
    bookmaker TEXT NOT NULL,
    market_type TEXT NOT NULL,
    home_odds REAL,
    away_odds REAL,
    draw_odds REAL,
    spread REAL,
    over_odds REAL,
    under_odds REAL,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, bookmaker, market_type),
    FOREIGN KEY (event_id) REFERENCES sports_events(id) ON DELETE CASCADE
);

-- Tabla de apuestas deportivas de usuarios
CREATE TABLE IF NOT EXISTS sports_bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    bet_type TEXT NOT NULL,
    selection TEXT NOT NULL,
    odds REAL NOT NULL,
    amount INTEGER NOT NULL,
    potential_winnings INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    placed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    settled_at DATETIME,
    FOREIGN KEY (event_id) REFERENCES sports_events(id)
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_events_status ON sports_events(status);
CREATE INDEX IF NOT EXISTS idx_events_start_time ON sports_events(start_time);
CREATE INDEX IF NOT EXISTS idx_bets_user ON sports_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_event ON sports_bets(event_id);
CREATE INDEX IF NOT EXISTS idx_bets_status ON sports_bets(status);
