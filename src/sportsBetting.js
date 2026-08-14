const sharedDb = require('./database/db');

class SportsBetting {
    constructor(dbPath) {
        // Reutiliza la conexión compartida (una sola por proceso) salvo en tests.
        this.db = sharedDb.openFor(dbPath);
    }

    getUserBalance(userId) {
        const stmt = this.db.prepare('SELECT balance FROM users WHERE id = ?');
        const result = stmt.get(userId);
        return result ? result.balance : 0;
    }

    updateUserBalance(userId, amount) {
        const stmt = this.db.prepare(`
            UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?
        `);
        stmt.run(amount, userId);
    }

    placeBet(userId, eventId, betType, selection, odds, amount) {
        const event = this.db
            .prepare(`SELECT status FROM sports_events WHERE id = ? AND status != 'finished'`)
            .get(eventId);
        if (!event) {
            throw new Error('Evento no disponible o ya finalizado');
        }

        const potentialWinnings = Math.floor(amount * odds);

        // Transacción atómica: vuelve a comprobar el saldo, lo descuenta e inserta
        // la apuesta como un todo. Si algo falla, no queda ni saldo descontado ni
        // apuesta a medias (evita descuadres).
        const insertBet = this.db.prepare(`
            INSERT INTO sports_bets
            (user_id, event_id, bet_type, selection, odds, amount, potential_winnings)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = this.db.transaction(() => {
            if (this.getUserBalance(userId) < amount) {
                throw new Error('Saldo insuficiente');
            }
            this.updateUserBalance(userId, -amount);
            return insertBet.run(userId, eventId, betType, selection, odds, amount, potentialWinnings)
                .lastInsertRowid;
        });

        const betId = tx();
        return { betId, eventId, amount, odds, potentialWinnings, selection };
    }

    getUserBets(userId, limit = 20) {
        const stmt = this.db.prepare(`
            SELECT
                b.*,
                e.home_team,
                e.away_team,
                e.league,
                e.start_time
            FROM sports_bets b
            JOIN sports_events e ON b.event_id = e.id
            WHERE b.user_id = ?
            ORDER BY b.placed_at DESC
            LIMIT ?
        `);
        return stmt.all(userId, limit);
    }

    getPendingBetsForEvent(eventId) {
        const stmt = this.db.prepare(`
            SELECT * FROM sports_bets
            WHERE event_id = ? AND status = 'pending'
        `);
        return stmt.all(eventId);
    }

    /** Actividad de un evento: nº de apuestas pendientes y monedas en juego. */
    getEventBetSummary(eventId) {
        return this.db.prepare(`
            SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS staked
            FROM sports_bets WHERE event_id = ? AND status = 'pending'
        `).get(eventId);
    }

    /** Últimas apuestas de un usuario en un evento concreto (para "Mis apuestas"). */
    getUserEventBets(userId, eventId, limit = 10) {
        return this.db.prepare(`
            SELECT selection, odds, amount, potential_winnings, status
            FROM sports_bets WHERE user_id = ? AND event_id = ?
            ORDER BY placed_at DESC LIMIT ?
        `).all(userId, eventId, limit);
    }

    settleEventBets(eventId, winner) {
        const bets = this.getPendingBetsForEvent(eventId);

        const results = {
            totalBets: bets.length,
            won: 0,
            lost: 0,
            totalPayout: 0
        };

        for (const bet of bets) {
            let status = 'lost';
            let payout = 0;

            const betWon = this._checkBetWon(bet, winner);

            if (betWon) {
                status = 'won';
                payout = bet.potential_winnings;
                this.updateUserBalance(bet.user_id, payout);
                results.won++;
                results.totalPayout += payout;
            } else {
                results.lost++;
            }

            const updateStmt = this.db.prepare(`
                UPDATE sports_bets
                SET status = ?, settled_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            updateStmt.run(status, bet.id);
        }

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

        for (const bet of bets) {
            this.updateUserBalance(bet.user_id, bet.amount);

            const updateStmt = this.db.prepare(`
                UPDATE sports_bets
                SET status = 'cancelled', settled_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            updateStmt.run(bet.id);
        }

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

        const stmt = this.db.prepare(query);
        return stmt.get(...params);
    }
}

module.exports = SportsBetting;
