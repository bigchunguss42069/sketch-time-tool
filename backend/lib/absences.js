'use strict';

/**
 * @fileoverview Absenzen — DB-Helpers und Routes
 *
 * Enthält alle Datenbankoperationen und API-Endpunkte für Absenzen.
 *
 * Typen: ferien, krank, unfall, militaer, mutterschaft, vaterschaft,
 *        bezahlteabwesenheit, sonstiges
 *
 * Status-Flow:
 *   pending → accepted | rejected      (Admin-Entscheid)
 *   accepted → cancel_requested        (User-Antrag)
 *   cancel_requested → cancelled       (Admin-Entscheid)
 *   pending → cancelled                (User selbst)
 *   krank → accepted                   (automatisch, kein Admin nötig)
 *
 * Hinweis: restoreVacationDaysForCancelledAbsence und calculateAbsenceVacationDays
 * sind in konten.js — sie brauchen Zugriff auf Konten-Funktionen.
 */

const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Mapping-Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Konvertiert einen DB-Wert zu einem YYYY-MM-DD String.
 *
 * @param {*} value
 * @returns {string|null}
 */
function toDateOnlyString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/**
 * Konvertiert einen DB-Wert zu einem ISO-Timestamp-String.
 *
 * @param {*} value
 * @returns {string|null}
 */
function toIsoTimestamp(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Mappt eine DB-Zeile auf ein Absenz-Objekt.
 *
 * @param {object} row
 * @returns {object|null}
 */
function mapAbsenceRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    teamId: row.team_id || null,
    type: row.type,
    from: toDateOnlyString(row.from_date),
    to: toDateOnlyString(row.to_date),
    days:
      row.days == null || row.days === ''
        ? null
        : Number.isFinite(Number(row.days))
          ? Number(row.days)
          : null,
    comment: row.comment || '',
    status: row.status,
    createdAt: toIsoTimestamp(row.created_at),
    createdBy: row.created_by || row.username,
    decidedAt: toIsoTimestamp(row.decided_at),
    decidedBy: row.decided_by || null,
    cancelRequestedAt: toIsoTimestamp(row.cancel_requested_at),
    cancelRequestedBy: row.cancel_requested_by || null,
    hours: row.hours == null ? null : Number(row.hours),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-Operationen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lädt alle Absenzen eines Users, neueste zuerst.
 *
 * @param {import('pg').Pool} db
 * @param {string} username
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object[]>}
 */
async function listUserAbsencesFromDb(db, username, client) {
  const conn = client || db;
  if (!conn) return [];

  const result = await conn.query(
    `SELECT * FROM absences
     WHERE username = $1
     ORDER BY created_at DESC, from_date DESC, id DESC`,
    [username]
  );

  return result.rows.map(mapAbsenceRow);
}

/**
 * Sucht eine Absenz anhand Username und ID.
 *
 * @param {import('pg').Pool} db
 * @param {string} username
 * @param {string} id
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
async function findAbsenceByUserAndId(db, username, id, client) {
  const conn = client || db;
  if (!conn) return null;

  const result = await conn.query(
    `SELECT * FROM absences
     WHERE username = $1 AND id = $2
     LIMIT 1`,
    [username, id]
  );

  return mapAbsenceRow(result.rows[0] || null);
}

/**
 * Fügt eine neue Absenz ein.
 *
 * @param {import('pg').Pool} db
 * @param {object} params
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>} Gespeicherte Absenz
 */
async function insertAbsenceForUser(
  db,
  {
    id,
    userId,
    username,
    teamId,
    type,
    from,
    to,
    days,
    hours,
    comment,
    status,
    createdAt,
    createdBy,
    decidedAt,
    decidedBy,
    cancelRequestedAt,
    cancelRequestedBy,
  },
  client
) {
  const conn = client || db;
  if (!conn) throw new Error('DATABASE_URL is not configured');

  const result = await conn.query(
    `INSERT INTO absences (
       id, user_id, username, team_id, type, from_date, to_date,
       days, hours, comment, status, created_at, created_by,
       decided_at, decided_by, cancel_requested_at, cancel_requested_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      id,
      userId,
      username,
      teamId,
      type,
      from,
      to,
      days,
      hours ?? null,
      comment,
      status,
      createdAt,
      createdBy,
      decidedAt,
      decidedBy,
      cancelRequestedAt,
      cancelRequestedBy,
    ]
  );

  return mapAbsenceRow(result.rows[0]);
}

/**
 * Löscht eine Absenz.
 *
 * @param {import('pg').Pool} db
 * @param {string} username
 * @param {string} id
 * @param {import('pg').PoolClient} [client]
 */
async function deleteAbsenceForUser(db, username, id, client) {
  const conn = client || db;
  if (!conn) throw new Error('DATABASE_URL is not configured');

  await conn.query(`DELETE FROM absences WHERE username = $1 AND id = $2`, [
    username,
    id,
  ]);
}

/**
 * Aktualisiert den Status einer Absenz.
 *
 * @param {import('pg').Pool} db
 * @param {object} params
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
async function updateAbsenceStatus(
  db,
  {
    username,
    id,
    status,
    decidedAt,
    decidedBy,
    cancelRequestedAt,
    cancelRequestedBy,
  },
  client
) {
  const conn = client || db;
  if (!conn) throw new Error('DATABASE_URL is not configured');

  const result = await conn.query(
    `UPDATE absences
     SET status = $3, decided_at = $4, decided_by = $5,
         cancel_requested_at = $6, cancel_requested_by = $7
     WHERE username = $1 AND id = $2
     RETURNING *`,
    [
      username,
      id,
      status,
      decidedAt || null,
      decidedBy || null,
      cancelRequestedAt || null,
      cancelRequestedBy || null,
    ]
  );

  return mapAbsenceRow(result.rows[0] || null);
}

/**
 * Findet eine akzeptierte Absenz für ein bestimmtes Datum.
 * Berücksichtigt auch cancel_requested (noch aktiv bis Storno genehmigt).
 *
 * @param {object[]} absences
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {object|null}
 */
function findAcceptedAbsenceForDate(absences, dateKey) {
  if (!Array.isArray(absences)) return null;

  return (
    absences.find((a) => {
      const st = String(a.status || '').toLowerCase();
      if (!a || (st !== 'accepted' && st !== 'cancel_requested')) return false;

      const fromKey = String(a.from || '').slice(0, 10);
      const toKey = String(a.to || '').slice(0, 10);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(fromKey) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(toKey)
      )
        return false;

      const start = fromKey <= toKey ? fromKey : toKey;
      const end = fromKey <= toKey ? toKey : fromKey;

      return dateKey >= start && dateKey <= end;
    }) || null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registriert alle Absenz-Routes.
 *
 * @param {import('express').Application} app
 * @param {import('pg').Pool} db
 * @param {import('express').RequestHandler} requireAuth
 * @param {import('express').RequestHandler} requireAdmin
 * @param {Function} findUserByUsername
 * @param {Function} restoreVacationDaysForCancelledAbsence
 */
function registerAbsenceRoutes(
  app,
  db,
  requireAuth,
  requireAdmin,
  findUserByUsername,
  restoreVacationDaysForCancelledAbsence,
  listUsersFromDb
) {
  // GET /api/absences
  app.get('/api/absences', requireAuth, async (req, res) => {
    try {
      const absences = await listUserAbsencesFromDb(db, req.user.username);
      return res.json({ ok: true, absences });
    } catch (err) {
      console.error('Failed to load my absences', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not load absences' });
    }
  });

  // POST /api/absences
  app.post('/api/absences', requireAuth, async (req, res) => {
    const username = req.user.username;
    const teamId = req.user.teamId || null;

    const type = String(req.body?.type || '').trim();
    const from = String(req.body?.from || '').slice(0, 10);
    const to = String(req.body?.to || '').slice(0, 10);
    const comment = String(req.body?.comment || '').trim();

    const daysRaw = req.body?.days;
    const days = daysRaw === '' || daysRaw == null ? null : Number(daysRaw);

    const hoursRaw = req.body?.hours;
    const hours = hoursRaw === '' || hoursRaw == null ? null : Number(hoursRaw);

    const isKrank = type === 'krank';
    const now = new Date().toISOString();

    if (!type) {
      return res.status(400).json({ ok: false, error: 'Missing type' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid from/to (YYYY-MM-DD)' });
    }
    if (days != null && (!Number.isFinite(days) || days < 0)) {
      return res.status(400).json({ ok: false, error: 'Invalid days' });
    }

    const idFromClient = String(req.body?.id || '').trim();
    const id =
      idFromClient && idFromClient.length <= 80
        ? idFromClient
        : `abs-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;

    try {
      const absence = await insertAbsenceForUser(db, {
        id,
        userId: req.user.id,
        username,
        teamId,
        type,
        from,
        to,
        days,
        hours,
        comment,
        createdAt: now,
        createdBy: username,
        cancelRequestedAt: null,
        cancelRequestedBy: null,
        status: isKrank ? 'accepted' : 'pending',
        decidedAt: isKrank ? now : null,
        decidedBy: isKrank ? 'system' : null,
      });

      return res.json({ ok: true, absence });
    } catch (err) {
      console.error('Failed to create absence', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not save absence' });
    }
  });

  // DELETE /api/absences/:id
  app.delete('/api/absences/:id', requireAuth, async (req, res) => {
    const username = req.user.username;
    const id = String(req.params.id || '');

    try {
      const item = await findAbsenceByUserAndId(db, username, id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });

      const isKrank = item.type === 'krank';
      if (
        item.status !== 'pending' &&
        !(isKrank && item.status === 'accepted')
      ) {
        return res
          .status(409)
          .json({ ok: false, error: 'Only pending absences can be cancelled' });
      }

      await deleteAbsenceForUser(db, username, id);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete absence', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not delete absence' });
    }
  });

  // POST /api/absences/:id/cancel
  app.post('/api/absences/:id/cancel', requireAuth, async (req, res) => {
    const username = req.user.username;
    const id = String(req.params.id || '');

    try {
      const item = await findAbsenceByUserAndId(db, username, id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });

      if (item.status === 'pending') {
        const updated = await updateAbsenceStatus(db, {
          username,
          id,
          status: 'cancelled',
          decidedAt: new Date().toISOString(),
          decidedBy: username,
          cancelRequestedAt: item.cancelRequestedAt || null,
          cancelRequestedBy: item.cancelRequestedBy || null,
        });
        return res.json({ ok: true, absence: updated });
      }

      if (item.status === 'accepted') {
        const updated = await updateAbsenceStatus(db, {
          username,
          id,
          status: 'cancel_requested',
          decidedAt: item.decidedAt || null,
          decidedBy: item.decidedBy || null,
          cancelRequestedAt: new Date().toISOString(),
          cancelRequestedBy: username,
        });
        return res.json({ ok: true, absence: updated });
      }

      return res
        .status(409)
        .json({ ok: false, error: 'Cannot cancel in this state' });
    } catch (err) {
      console.error('Failed to cancel absence', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not cancel absence' });
    }
  });

  // GET /api/admin/absences
  app.get(
    '/api/admin/absences',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const status = String(req.query.status || 'pending');

        const users = await listUsersFromDb(db);

        const nested = await Promise.all(
          users.map((u) => listUserAbsencesFromDb(db, u.username))
        );

        const all = nested.flatMap((absences, i) =>
          absences.map((a) => ({ ...a, teamId: users[i].teamId || null }))
        );

        const filtered =
          status === 'all' ? all : all.filter((a) => a && a.status === status);
        filtered.sort((a, b) =>
          String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
        );

        return res.json({ ok: true, absences: filtered });
      } catch (err) {
        console.error('Failed to load admin absences', err);
        return res
          .status(500)
          .json({ ok: false, error: 'Could not load absences' });
      }
    }
  );

  // POST /api/admin/absences/decision
  app.post(
    '/api/admin/absences/decision',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const username = String(req.body?.username || '');
      const id = String(req.body?.id || '');
      const status = String(req.body?.status || '');

      try {
        const targetUser = await findUserByUsername(username);
        if (!username || !targetUser) {
          return res.status(400).json({ ok: false, error: 'Invalid username' });
        }
        if (!id) {
          return res.status(400).json({ ok: false, error: 'Missing id' });
        }

        const allowed = new Set(['accepted', 'rejected', 'cancelled']);
        if (!allowed.has(status)) {
          return res.status(400).json({ ok: false, error: 'Invalid status' });
        }

        const item = await findAbsenceByUserAndId(db, username, id);
        if (!item)
          return res.status(404).json({ ok: false, error: 'Not found' });

        const previousStatus = item.status;

        const updated = await updateAbsenceStatus(db, {
          username,
          id,
          status,
          decidedAt: new Date().toISOString(),
          decidedBy: req.user.username,
          cancelRequestedAt: item.cancelRequestedAt || null,
          cancelRequestedBy: item.cancelRequestedBy || null,
        });

        let vacationRestored = 0;
        if (
          status === 'cancelled' &&
          (previousStatus === 'accepted' ||
            previousStatus === 'cancel_requested')
        ) {
          vacationRestored = await restoreVacationDaysForCancelledAbsence({
            username,
            absence: updated,
            updatedBy: req.user.username,
          });
        }

        return res.json({ ok: true, absence: updated, vacationRestored });
      } catch (err) {
        console.error('Failed to decide absence', err);
        return res.status(500).json({ ok: false, error: 'Decision failed' });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Mapping
  mapAbsenceRow,
  toDateOnlyString,
  toIsoTimestamp,

  // DB-Operationen
  listUserAbsencesFromDb,
  findAbsenceByUserAndId,
  insertAbsenceForUser,
  deleteAbsenceForUser,
  updateAbsenceStatus,
  findAcceptedAbsenceForDate,

  // Routes
  registerAbsenceRoutes,
};
