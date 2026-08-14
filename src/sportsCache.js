const sharedDb = require('./database/db');

class SportsCache {
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

    saveEvents(events, sport) {
        const stmt = this._p(`
            INSERT OR REPLACE INTO sports_events
            (id, sport, league, home_team, away_team, start_time, status, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        const insertStmt = this.db.transaction((events) => {
            for (const event of events) {
                stmt.run(
                    event.id,
                    sport,
                    event.league || 'Unknown',
                    event.home_team,
                    event.away_team,
                    event.start_time,
                    event.status || 'scheduled'
                );
            }
        });

        insertStmt(events);
    }

    saveOdds(oddsData) {
        const stmt = this._p(`
            INSERT OR REPLACE INTO sports_odds
            (event_id, bookmaker, market_type, home_odds, away_odds, draw_odds,
             spread, over_odds, under_odds, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        const insertStmt = this.db.transaction((oddsArray) => {
            for (const item of oddsArray) {
                const odds = item.odds || {};
                stmt.run(
                    item.event_id,
                    item.bookmaker || 'Unknown',
                    item.market_type || 'moneyline',
                    odds.home || null,
                    odds.away || null,
                    odds.draw || null,
                    odds.spread || null,
                    odds.over || null,
                    odds.under || null
                );
            }
        });

        insertStmt(oddsData);
    }

    getActiveEvents(sport = null, limit = 50) {
        let query = `
            SELECT * FROM sports_events
            WHERE status != 'finished'
            AND status != 'cancelled'
            AND datetime(start_time) > datetime('now', '-2 hours')
        `;
        const params = [];

        if (sport) {
            query += ' AND sport = ?';
            params.push(sport);
        }

        query += ' ORDER BY start_time ASC LIMIT ?';
        params.push(limit);

        // Se cachea por la SQL construida (dos variantes: con y sin filtro de deporte).
        return this._p(query).all(...params);
    }

    getEventById(eventId) {
        return this._p('SELECT * FROM sports_events WHERE id = ?').get(eventId);
    }

    getOddsForEvent(eventId) {
        return this._p('SELECT * FROM sports_odds WHERE event_id = ?').all(eventId);
    }

    getFormattedOdds(eventId) {
        const odds = this.getOddsForEvent(eventId);
        const event = this.getEventById(eventId);
        if (!event) return null;

        const result = {
            event: {
                id: event.id,
                home: event.home_team,
                away: event.away_team,
                league: event.league,
                start: event.start_time
            },
            markets: {}
        };

        for (const odd of odds) {
            if (!result.markets[odd.bookmaker]) {
                result.markets[odd.bookmaker] = {};
            }
            result.markets[odd.bookmaker][odd.market_type] = {
                home: odd.home_odds,
                away: odd.away_odds,
                draw: odd.draw_odds,
                spread: odd.spread,
                over: odd.over_odds,
                under: odd.under_odds
            };
        }

        return result;
    }

    updateEventStatus(eventId, status, homeScore = 0, awayScore = 0) {
        this._p(`
            UPDATE sports_events
            SET status = ?, home_score = ?, away_score = ?, last_updated = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(status, homeScore, awayScore, eventId);
    }

    cleanupOldEvents(daysToKeep = 7) {
        this._p(`
            UPDATE sports_events
            SET status = 'finished'
            WHERE status != 'finished'
            AND datetime(start_time) < datetime('now', ?)
        `).run(`-${daysToKeep} days`);

        this._p(`
            DELETE FROM sports_events
            WHERE status = 'finished'
            AND datetime(start_time) < datetime('now', ?)
        `).run(`-${daysToKeep + 3} days`);
    }

    getStats() {
        const stats = {};
        stats.activeEvents = this._p(
            `SELECT COUNT(*) as count FROM sports_events WHERE status != 'finished'`
        ).get().count;

        stats.eventsBySport = this._p(`
            SELECT sport, COUNT(*) as count FROM sports_events
            WHERE status != 'finished'
            GROUP BY sport
        `).all();

        stats.pendingBets = this._p(
            `SELECT COUNT(*) as count FROM sports_bets WHERE status = 'pending'`
        ).get().count;

        return stats;
    }
}

module.exports = SportsCache;
