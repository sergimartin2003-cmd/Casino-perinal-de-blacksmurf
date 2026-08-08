const Database = require('better-sqlite3');

class SportsCache {
    constructor(dbPath) {
        this.db = new Database(dbPath);
    }

    saveEvents(events, sport) {
        const stmt = this.db.prepare(`
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
        const stmt = this.db.prepare(`
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

        const stmt = this.db.prepare(query);
        return stmt.all(...params);
    }

    getEventById(eventId) {
        const stmt = this.db.prepare('SELECT * FROM sports_events WHERE id = ?');
        return stmt.get(eventId);
    }

    getOddsForEvent(eventId) {
        const stmt = this.db.prepare(`
            SELECT * FROM sports_odds WHERE event_id = ?
        `);
        return stmt.all(eventId);
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
        const stmt = this.db.prepare(`
            UPDATE sports_events
            SET status = ?, home_score = ?, away_score = ?, last_updated = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        stmt.run(status, homeScore, awayScore, eventId);
    }

    cleanupOldEvents(daysToKeep = 7) {
        const stmt = this.db.prepare(`
            UPDATE sports_events
            SET status = 'finished'
            WHERE status != 'finished'
            AND datetime(start_time) < datetime('now', ?)
        `);
        stmt.run(`-${daysToKeep} days`);

        const deleteStmt = this.db.prepare(`
            DELETE FROM sports_events
            WHERE status = 'finished'
            AND datetime(start_time) < datetime('now', ?)
        `);
        deleteStmt.run(`-${daysToKeep + 3} days`);
    }

    getStats() {
        const stats = {};
        const activeStmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM sports_events WHERE status != 'finished'
        `);
        stats.activeEvents = activeStmt.get().count;

        const sportStmt = this.db.prepare(`
            SELECT sport, COUNT(*) as count FROM sports_events
            WHERE status != 'finished'
            GROUP BY sport
        `);
        stats.eventsBySport = sportStmt.all();

        const betStmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM sports_bets WHERE status = 'pending'
        `);
        stats.pendingBets = betStmt.get().count;

        return stats;
    }
}

module.exports = SportsCache;
