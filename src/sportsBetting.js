const sharedDb = require('./database/db');

// SQL reutilizado (se prepara una sola vez y se cachea; ver _p()).
const SQL = {
    balance: 'SELECT balance FROM users WHERE id = ?',
    updateBalance: 'UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?',
    eventStatus: "SELECT status FROM sports_events WHERE id = ? AND status != 'finished'",
    insertBet: `INSERT INTO sports_bets
        (user_id, event_id, bet_type, selection, odds, amount, potential_winnings)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
    pendingForEvent: "SELECT * FROM sports_bets WHERE event_id = ? AND status = 'pending'",
    settle: 'UPDATE sports_bets SET status = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ?',
    summary: `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS staked
        FROM sports_bets WHERE event_id = ? AND status = 'pending'`,
    userEventBets: `SELECT selection, odds, amount, potential_winnings, status
        FROM sports_bets WHERE user_id = ? AND event_id = ?
        ORDER BY placed_at DESC LIMIT ?`,
    userBets: `SELECT b.*, e.home_team, e.away_team, e.league, e.start_time
        FROM sports_bets b JOIN sports_events e ON b.event_id = e.id
        WHERE b.user_id = ? ORDER BY b.placed_at DESC LIMIT ?`,
};

class SportsBetting {
    constructor(dbPath) {
        // Reutiliza la conexión compartida (una sola por proceso) salvo en tests.
        this.db = sharedDb.openFor(dbPath);
        this._stmts = new Map(); // caché de prepared statements por SQL
    }

    /** Prepara (y cachea) un statement. Se compila UNA vez, de forma perezosa. */
    _p(sql) {
        let s = this._stmts.get(sql);
        if (!s) {
            s = this.db.prepare(sql);
            this._stmts.set(sql, s);
        }
        return s;
    }

    getUserBalance(userId) {
        const r = this._p(SQL.balance).get(userId);
        return r ? r.balance : 0;
    }

    updateUserBalance(userId, amount) {
        this._p(SQL.updateBalance).run(amount, userId);
    }

    placeBet(userId, eventId, betType, selection, odds, amount) {
        const event = this._p(SQL.eventStatus).get(eventId);
        if (!event) {
            throw new Error('Evento no disponible o ya finalizado');
        }

        const potentialWinnings = Math.floor(amount * odds);

        // Transacción atómica: vuelve a comprobar el saldo, lo descuenta e inserta
        // la apuesta como un todo. Si algo falla, no queda ni saldo descontado ni
        // apuesta a medias (evita descuadres).
        const tx = this.db.transaction(() => {
            if (this.getUserBalance(userId) < amount) {
                throw new Error('Saldo insuficiente');
            }
            this.updateUserBalance(userId, -amount);
            return this._p(SQL.insertBet)
                .run(userId, eventId, betType, selection, odds, amount, potentialWinnings)
                .lastInsertRowid;
        });

        const betId = tx();
        return { betId, eventId, amount, odds, potentialWinnings, selection };
    }

    getUserBets(userId, limit = 20) {
        return this._p(SQL.userBets).all(userId, limit);
    }

    getPendingBetsForEvent(eventId) {
        return this._p(SQL.pendingForEvent).all(eventId);
    }

    /** Actividad de un evento: nº de apuestas pendientes y monedas en juego. */
    getEventBetSummary(eventId) {
        return this._p(SQL.summary).get(eventId);
    }

    /** Últimas apuestas de un usuario en un evento concreto (para "Mis apuestas"). */
    getUserEventBets(userId, eventId, limit = 10) {
        return this._p(SQL.userEventBets).all(userId, eventId, limit);
    }

    settleEventBets(eventId, winner) {
        const bets = this.getPendingBetsForEvent(eventId);
        const results = { totalBets: bets.length, won: 0, lost: 0, totalPayout: 0 };
        const settle = this._p(SQL.settle);

        // Todo en una transacción: liquidar N apuestas de golpe (más rápido y atómico).
        const tx = this.db.transaction(() => {
            for (const bet of bets) {
                if (this._checkBetWon(bet, winner)) {
                    this.updateUserBalance(bet.user_id, bet.potential_winnings);
                    results.won++;
                    results.totalPayout += bet.potential_winnings;
                    settle.run('won', bet.id);
                } else {
                    results.lost++;
                    settle.run('lost', bet.id);
                }
            }
        });
        tx();
        return results;
    }

    _checkBetWon(bet, winner) {
        if (winner === 'cancelled') {
            this.updateUserBalance(bet.user_id, bet.amount);
            return false;
        }

        switch (bet.bet_type) {
            case 'moneyline':
                return bet.selection === winner;
            default:
                return false;
        }
    }

    cancelEventBets(eventId) {
        const bets = this.getPendingBetsForEvent(eventId);
        const settle = this._p(SQL.settle);

        // Reembolsa y marca todas las apuestas en una sola transacción.
        const tx = this.db.transaction(() => {
            for (const bet of bets) {
                this.updateUserBalance(bet.user_id, bet.amount);
                settle.run('cancelled', bet.id);
            }
        });
        tx();

        return { cancelled: bets.length };
    }

    getBettingStats(userId = null) {
        let query = `
            SELECT
                COUNT(*) as total_bets,
                SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won,
                SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'won' THEN potential_winnings ELSE 0 END) as total_winnings,
                SUM(amount) as total_bet_amount
            FROM sports_bets
        `;
        const params = [];
        if (userId) {
            query += ' WHERE user_id = ?';
            params.push(userId);
        }
        return this._p(query).get(...params);
    }
}

module.exports = SportsBetting;
