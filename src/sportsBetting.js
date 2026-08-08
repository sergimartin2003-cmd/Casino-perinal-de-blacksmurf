const Database = require('better-sqlite3');

class SportsBetting {
    constructor(dbPath) {
        this.db = new Database(dbPath);
    }

    getUserBalance(userId) {
        const stmt = this.db.prepare('SELECT coins FROM users WHERE id = ?');
        const result = stmt.get(userId);
        return result ? result.coins : 0;
    }

    updateUserBalance(userId, amount) {
        const stmt = this.db.prepare(`
            UPDATE users SET coins = coins + ? WHERE id = ?
        `);
        stmt.run(amount, userId);
    }

    placeBet(userId, eventId, betType, selection, odds, amount) {
        const balance = this.getUserBalance(userId);
        if (balance < amount) {
            throw new Error('Saldo insuficiente');
        }

        const eventStmt = this.db.prepare(`
            SELECT status FROM sports_events WHERE id = ? AND status != 'finished'
        `);
        const event = eventStmt.get(eventId);
        if (!event) {
            throw new Error('Evento no disponible o ya finalizado');
        }

        const potentialWinnings = Math.floor(amount * odds);

        const stmt = this.db.prepare(`
            INSERT INTO sports_bets
            (user_id, event_id, bet_type, selection, odds, amount, potential_winnings)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(userId, eventId, betType, selection, odds, amount, potentialWinnings);

        this.updateUserBalance(userId, -amount);

        return {
            betId: result.lastInsertRowid,
            eventId,
            amount,
            odds,
            potentialWinnings,
            selection
        };
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
