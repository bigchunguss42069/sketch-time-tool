'use strict';

/**
 * @fileoverview Monats-Submissions und User-Listing
 *
 * Enthält alle DB-Operationen für month_submissions:
 * - Einfügen, Löschen, Laden von Submissions
 * - User-Listing (listUsersFromDb)
 *
 * Pattern: createSubmissionsService(db, mapDbUser) gibt alle db-gebundenen
 * Funktionen zurück. mapDbUser kommt aus auth.js.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Pure Hilfsfunktionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mappt eine DB-Zeile einer Submission auf ein Meta-Objekt.
 * Enthält keine Payload-Daten — nur Metadaten für Listen-Ansichten.
 *
 * @param {object} row
 * @returns {{ id: string, year: number, monthIndex: number, monthLabel: string, sentAt: string, sizeBytes: number, totals: object|null }}
 */
function mapTransmissionMeta(row) {
  return {
    id: row.id,
    year: row.year,
    monthIndex: row.month_index,
    monthLabel: row.month_label,
    sentAt:
      row.sent_at instanceof Date
        ? row.sent_at.toISOString()
        : String(row.sent_at || ''),
    sizeBytes: Number(row.size_bytes) || 0,
    totals: row.totals || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt alle db-abhängigen Submissions-Funktionen.
 *
 * @param {import('pg').Pool} db
 * @param {Function} mapDbUser - User-Mapping Funktion aus auth.js
 * @returns {object}
 */
function createSubmissionsService(db, mapDbUser) {
  // ── User-Listing ───────────────────────────────────────────────────────────

  /**
   * Lädt alle aktiven User aus der DB, optional gefiltert nach Rolle oder Team.
   *
   * @param {{ role?: string|null, teamId?: string|null }} [options]
   * @returns {Promise<object[]>}
   */
  async function listUsersFromDb({ role = null, teamId = null } = {}) {
    if (!db) return [];

    const params = [];
    let sql = `
      SELECT id, username, role, team_id, active, email, employment_start,
             birth_year, is_non_smoker, is_kader
      FROM users
      WHERE active = TRUE
    `;

    if (role) {
      params.push(role);
      sql += ` AND role = $${params.length}`;
    }

    if (teamId) {
      params.push(teamId);
      sql += ` AND team_id = $${params.length}`;
    }

    sql += ` ORDER BY username ASC`;

    const result = await db.query(sql, params);
    return result.rows.map(mapDbUser);
  }

  // ── Submissions CRUD ───────────────────────────────────────────────────────

  /**
   * Fügt eine neue Monats-Submission in die DB ein.
   *
   * @param {{ id, userId, username, teamId, year, monthIndex, monthLabel, sentAt, receivedAt, sizeBytes, totals, payload }} params
   */
  async function insertMonthSubmission({
    id,
    userId,
    username,
    teamId,
    year,
    monthIndex,
    monthLabel,
    sentAt,
    receivedAt,
    sizeBytes,
    totals,
    payload,
  }) {
    if (!db) throw new Error('DATABASE_URL is not configured');

    await db.query(
      `INSERT INTO month_submissions (
         id, user_id, username, team_id, year, month_index, month_label,
         sent_at, received_at, size_bytes, totals, payload
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
      [
        id,
        userId,
        username,
        teamId,
        year,
        monthIndex,
        monthLabel,
        sentAt,
        receivedAt,
        sizeBytes,
        JSON.stringify(totals || {}),
        JSON.stringify(payload || {}),
      ]
    );
  }

  /**
   * Löscht eine Submission anhand ID.
   *
   * @param {string} id
   */
  async function deleteMonthSubmissionById(id) {
    if (!db) return;
    await db.query(`DELETE FROM month_submissions WHERE id = $1`, [id]);
  }

  /**
   * Lädt alle Submissions eines Users (neueste zuerst), nur Metadaten.
   *
   * @param {string} username
   * @returns {Promise<object[]>}
   */
  async function listUserTransmissions(username) {
    if (!db) return [];

    const result = await db.query(
      `SELECT id, year, month_index, month_label, sent_at, size_bytes, totals
       FROM month_submissions
       WHERE username = $1
       ORDER BY sent_at DESC, created_at DESC`,
      [username]
    );

    return result.rows.map(mapTransmissionMeta);
  }

  /**
   * Lädt die neueste Submission eines Users, nur Metadaten.
   *
   * @param {string} username
   * @returns {Promise<object|null>}
   */
  async function getLatestTransmissionMeta(username) {
    if (!db) return null;

    const result = await db.query(
      `SELECT id, year, month_index, month_label, sent_at, size_bytes, totals
       FROM month_submissions
       WHERE username = $1
       ORDER BY sent_at DESC, created_at DESC
       LIMIT 1`,
      [username]
    );

    const row = result.rows[0];
    return row ? mapTransmissionMeta(row) : null;
  }

  /**
   * Lädt die neueste Submission für einen bestimmten Monat inkl. Payload.
   *
   * @param {string} username
   * @param {number} year
   * @param {number} monthIndex - 0-basiert
   * @returns {Promise<{ meta: object, submission: object }|null>}
   */
  async function getLatestMonthSubmissionRecord(username, year, monthIndex) {
    if (!db) return null;

    const result = await db.query(
      `SELECT id, year, month_index, month_label, sent_at, size_bytes, totals, payload
       FROM month_submissions
       WHERE username = $1 AND year = $2 AND month_index = $3
       ORDER BY sent_at DESC, created_at DESC
       LIMIT 1`,
      [username, year, monthIndex]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      meta: mapTransmissionMeta(row),
      submission: row.payload || null,
    };
  }

  /**
   * Lädt nur den Payload der neuesten Submission für einen Monat.
   * Convenience-Wrapper um getLatestMonthSubmissionRecord.
   *
   * @param {string} username
   * @param {number} year
   * @param {number} monthIndex - 0-basiert
   * @returns {Promise<object|null>}
   */
  async function loadLatestMonthSubmission(username, year, monthIndex) {
    const record = await getLatestMonthSubmissionRecord(
      username,
      year,
      monthIndex
    );
    return record ? record.submission : null;
  }

  return {
    listUsersFromDb,
    insertMonthSubmission,
    deleteMonthSubmissionById,
    listUserTransmissions,
    getLatestTransmissionMeta,
    getLatestMonthSubmissionRecord,
    loadLatestMonthSubmission,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  mapTransmissionMeta,
  createSubmissionsService,
};
