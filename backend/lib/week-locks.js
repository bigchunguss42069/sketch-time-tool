'use strict';

/**
 * @fileoverview Week Locks — Wochensperrungen für Stempel-Korrekturen
 *
 * Gesperrte Wochen können vom User nicht mehr bearbeitet werden.
 * Beim Transmit werden gesperrte Wochen aus dem alten Submission übernommen
 * statt vom neuen Payload überschrieben (mergeLockedWeeksPayload).
 *
 * Auto-Lock: Jeden Montag 12:00 wird die vergangene Woche automatisch
 * für alle User gesperrt (Cron-Job).
 *
 * Pattern: createWeekLocksService(db) gibt alle db-gebundenen Funktionen zurück.
 */

const { formatDateKey, getISOWeekInfo, weekKey } = require('./holidays');

// ─────────────────────────────────────────────────────────────────────────────
// Pure Hilfsfunktionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mappt eine DB-Zeile auf ein WeekLock-Objekt.
 *
 * @param {object} row
 * @returns {{ locked: true, lockedAt: string|null, lockedBy: string|null }}
 */
function mapWeekLockRow(row) {
  return {
    locked: true,
    lockedAt:
      row?.locked_at instanceof Date
        ? row.locked_at.toISOString()
        : row?.locked_at || null,
    lockedBy: row?.locked_by || null,
  };
}

/**
 * Baut eine Map { username: { weekKey: lockMeta } } aus DB-Zeilen.
 *
 * @param {object[]} rows
 * @returns {object}
 */
function buildWeekLocksMap(rows) {
  const out = {};
  for (const row of rows || []) {
    const username = row.username;
    const wk = weekKey(row.week_year, row.week);
    if (!out[username]) out[username] = {};
    out[username][wk] = mapWeekLockRow(row);
  }
  return out;
}

/**
 * Gibt Lock-Metadaten für eine Woche zurück.
 * Gibt { locked: false } zurück wenn die Woche nicht gesperrt ist.
 *
 * @param {object} userLocks - { weekKey: lockMeta }
 * @param {string} wk - weekKey z.B. "2026-W17"
 * @returns {{ locked: boolean, lockedAt: string|null, lockedBy: string|null }}
 */
function getLockMeta(userLocks, wk) {
  const v = userLocks ? userLocks[wk] : null;
  if (!v) return { locked: false, lockedAt: null, lockedBy: null };
  if (v === true) return { locked: true, lockedAt: null, lockedBy: null };
  if (typeof v === 'object' && v.locked) {
    return {
      locked: true,
      lockedAt: v.lockedAt || null,
      lockedBy: v.lockedBy || null,
    };
  }
  return { locked: false, lockedAt: null, lockedBy: null };
}

/**
 * Sammelt alle gesperrten Datum-Keys für einen Monat.
 *
 * @param {object} userLocks - { weekKey: lockMeta }
 * @param {number} year
 * @param {number} monthIndex - 0-basiert
 * @returns {{ lockedDateKeys: Set<string>, lockedWeekKeys: Set<string> }}
 */
function collectLockedDatesForMonth(userLocks, year, monthIndex) {
  const lockedDateKeys = new Set();
  const lockedWeekKeys = new Set();

  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const cursor = new Date(start);

  while (cursor <= end) {
    const dk = formatDateKey(cursor);
    const iso = getISOWeekInfo(cursor);
    const wk = weekKey(iso.year, iso.week);
    const meta = getLockMeta(userLocks, wk);

    if (meta.locked) {
      lockedDateKeys.add(dk);
      lockedWeekKeys.add(wk);
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return { lockedDateKeys, lockedWeekKeys };
}

/**
 * Prüft ob eine Absenz mit gesperrten Daten überlappt.
 *
 * @param {{ from: string, to: string }} abs
 * @param {Set<string>} lockedDateKeys
 * @returns {boolean}
 */
function absenceOverlapsLockedDates(abs, lockedDateKeys) {
  if (!abs || !abs.from || !abs.to) return false;

  const fromKey = String(abs.from).slice(0, 10);
  const toKey = String(abs.to).slice(0, 10);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromKey) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toKey)
  )
    return false;

  const startKey = fromKey <= toKey ? fromKey : toKey;
  const endKey = fromKey <= toKey ? toKey : fromKey;

  const cursor = new Date(startKey + 'T00:00:00');
  const end = new Date(endKey + 'T00:00:00');

  while (cursor <= end) {
    if (lockedDateKeys.has(formatDateKey(cursor))) return true;
    cursor.setDate(cursor.getDate() + 1);
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory — db-gebundene Funktionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt alle db-abhängigen WeekLocks-Funktionen.
 *
 * @param {import('pg').Pool} db
 * @returns {object}
 */
function createWeekLocksService(db) {
  /**
   * Lädt alle Wochensperrungen aus der DB (alle User).
   *
   * @returns {Promise<object>} { username: { weekKey: lockMeta } }
   */
  async function readWeekLocksFromDb() {
    if (!db) return {};

    const result = await db.query(
      `SELECT username, week_year, week, locked_at, locked_by
       FROM week_locks
       ORDER BY username ASC, week_year ASC, week ASC`
    );

    return buildWeekLocksMap(result.rows);
  }

  /**
   * Lädt Wochensperrungen für einen bestimmten User.
   *
   * @param {string} username
   * @returns {Promise<object>} { weekKey: lockMeta }
   */
  async function readUserWeekLocksFromDb(username) {
    if (!db) return {};

    const result = await db.query(
      `SELECT username, week_year, week, locked_at, locked_by
       FROM week_locks
       WHERE username = $1
       ORDER BY week_year ASC, week ASC`,
      [username]
    );

    const all = buildWeekLocksMap(result.rows);
    return all[username] || {};
  }

  /**
   * Sperrt eine Woche für einen User.
   *
   * @param {{ userId: string, username: string, weekYear: number, week: number, lockedBy: string }} params
   * @returns {Promise<object>} lockMeta
   */
  async function setWeekLockState({
    userId,
    username,
    weekYear,
    week,
    lockedBy,
  }) {
    if (!db) throw new Error('DATABASE_URL is not configured');

    const result = await db.query(
      `INSERT INTO week_locks (user_id, username, week_year, week, locked_at, locked_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, week_year, week) DO UPDATE SET
         username=EXCLUDED.username,
         locked_at=EXCLUDED.locked_at,
         locked_by=EXCLUDED.locked_by
       RETURNING username, week_year, week, locked_at, locked_by`,
      [
        userId,
        username,
        weekYear,
        week,
        new Date().toISOString(),
        lockedBy || null,
      ]
    );

    return mapWeekLockRow(result.rows[0] || null);
  }

  /**
   * Entsperrt eine Woche für einen User.
   *
   * @param {{ userId: string, weekYear: number, week: number }} params
   */
  async function clearWeekLockState({ userId, weekYear, week }) {
    if (!db) throw new Error('DATABASE_URL is not configured');

    await db.query(
      `DELETE FROM week_locks WHERE user_id=$1 AND week_year=$2 AND week=$3`,
      [userId, weekYear, week]
    );
  }

  /**
   * Sperrt die vergangene Woche automatisch für alle User.
   * Wird vom Cron-Job jeden Montag 12:00 aufgerufen.
   *
   * @param {Function} listUsersFromDb
   */
  async function autoLockPreviousWeek(listUsersFromDb) {
    const now = new Date();
    const lastWeekDate = new Date(now);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);

    const { week, year } = getISOWeekInfo(lastWeekDate);
    console.log(`[AutoLock] Sperre KW ${week}/${year} für alle User`);

    const users = await listUsersFromDb({ role: 'user' });
    let locked = 0;

    for (const user of users) {
      try {
        await db.query(
          `INSERT INTO week_locks (user_id, username, week_year, week, locked_at, locked_by)
           VALUES ($1,$2,$3,$4,NOW(),'system')
           ON CONFLICT (user_id, week_year, week) DO NOTHING`,
          [user.id, user.username, year, week]
        );
        locked++;
      } catch (err) {
        console.error(`[AutoLock] Fehler bei ${user.username}:`, err.message);
      }
    }

    console.log(`[AutoLock] ${locked} User gesperrt für KW ${week}/${year}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Routes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Registriert alle WeekLocks-Routes.
   *
   * @param {import('express').Application} app
   * @param {import('express').RequestHandler} requireAuth
   * @param {import('express').RequestHandler} requireAdmin
   * @param {Function} findUserByUsername
   */
  function registerWeekLockRoutes(
    app,
    requireAuth,
    requireAdmin,
    findUserByUsername
  ) {
    // GET /api/week-locks/me
    app.get('/api/week-locks/me', requireAuth, async (req, res) => {
      try {
        const locks = await readUserWeekLocksFromDb(req.user.username);
        return res.json({ ok: true, locks });
      } catch (err) {
        console.error('Failed to load week locks', err);
        return res
          .status(500)
          .json({ ok: false, error: 'Could not load week locks' });
      }
    });

    // POST /api/admin/week-lock
    app.post(
      '/api/admin/week-lock',
      requireAuth,
      requireAdmin,
      async (req, res) => {
        const username = String(req.body?.username || '');
        const weekYear = Number(req.body?.weekYear);
        const week = Number(req.body?.week);
        const lockedParam = req.body?.locked;

        try {
          const targetUser = await findUserByUsername(username);
          if (!username || !targetUser) {
            return res
              .status(400)
              .json({ ok: false, error: 'Invalid username' });
          }
          if (
            !Number.isInteger(weekYear) ||
            weekYear < 2000 ||
            weekYear > 2100
          ) {
            return res
              .status(400)
              .json({ ok: false, error: 'Invalid weekYear' });
          }
          if (!Number.isInteger(week) || week < 1 || week > 53) {
            return res.status(400).json({ ok: false, error: 'Invalid week' });
          }

          const userLocks = await readUserWeekLocksFromDb(username);
          const wk = weekKey(weekYear, week);
          const currentMeta = getLockMeta(userLocks, wk);
          const nextLocked =
            typeof lockedParam === 'boolean'
              ? lockedParam
              : !currentMeta.locked;

          let finalMeta = null;

          if (nextLocked) {
            finalMeta = await setWeekLockState({
              userId: targetUser.id,
              username: targetUser.username,
              weekYear,
              week,
              lockedBy: req.user.username,
            });
          } else {
            await clearWeekLockState({ userId: targetUser.id, weekYear, week });
          }

          return res.json({
            ok: true,
            username,
            weekYear,
            week,
            weekKey: wk,
            locked: nextLocked,
            lockedAt: finalMeta?.lockedAt || null,
            lockedBy: finalMeta?.lockedBy || null,
          });
        } catch (err) {
          console.error('Failed to update week lock', err);
          return res
            .status(500)
            .json({ ok: false, error: 'Could not update lock state' });
        }
      }
    );
  }

  return {
    readWeekLocksFromDb,
    readUserWeekLocksFromDb,
    setWeekLockState,
    clearWeekLockState,
    autoLockPreviousWeek,
    registerWeekLockRoutes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Pure Funktionen
  mapWeekLockRow,
  buildWeekLocksMap,
  getLockMeta,
  collectLockedDatesForMonth,
  absenceOverlapsLockedDates,

  // Factory
  createWeekLocksService,
};
