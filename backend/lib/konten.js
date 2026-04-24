'use strict';

/**
 * @fileoverview Konten — Zeitkonto-Verwaltung und Überzeitberechnung
 *
 * Enthält:
 * - Konten lesen/schreiben (ensureKontenUserRecord, persistKontenUserRecord)
 * - ÜZ1/Vorarbeit Berechnung beim Transmit (updateKontenFromSubmission)
 * - Ferienrückerstattung bei Storno (restoreVacationDaysForCancelledAbsence)
 * - Manuelle Admin-Anpassungen mit Audit-Trail (updateKontenManualValues)
 * - Tagessoll-Berechnung (getDailySoll, fetchEmpStartKey)
 * - Ferienanspruch-Berechnung (computeVacationDaysPerYear)
 * - Routes: /api/konten/me, /api/admin/konten/*
 *
 * Pattern: createKontenService(db) gibt alle db-gebundenen Funktionen zurück.
 * Damit müssen nicht alle Funktionen `db` als Parameter übergeben bekommen —
 * sie schliessen `db` über den Factory-Closure ein.
 */

const {
  isBernHolidayKey,
  isCompanyBridgeDay,
  formatDateKey,
  kontenMonthKey,
} = require('./holidays');

const {
  toNumber,
  round1,
  computeVacationUsedDaysForMonth,
} = require('./compute');

const { getPayrollYearConfig } = require('./constants');

// ─────────────────────────────────────────────────────────────────────────────
// Pure Hilfsfunktionen (db-unabhängig)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Berechnet den jährlichen Ferienanspruch in Tagen.
 *
 * @param {number|null} birthYear
 * @param {boolean} isNonSmoker
 * @param {boolean} isKader
 * @returns {number}
 */
function computeVacationDaysPerYear(birthYear, isNonSmoker, isKader) {
  const currentYear = new Date().getFullYear();
  const age = birthYear ? currentYear - Number(birthYear) : null;

  let base = 20;
  if (age !== null) {
    if (age <= 20 || age >= 50) base = 25;
  }

  if (isNonSmoker) base += 1;
  if (isKader) base += 5;

  return base;
}

/**
 * Normalisiert ein Konten-Objekt — stellt sicher dass es ein plain Object ist.
 *
 * @param {*} value
 * @returns {object}
 */
function normalizeKontenObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

/**
 * Mappt eine DB-Zeile auf ein Konto-Objekt.
 *
 * @param {object} row
 * @param {object} [fallback={}]
 * @returns {object}
 */
function mapKontenRow(row, fallback = {}) {
  const updatedAtRaw = row?.updated_at;

  return {
    teamId: row?.team_id ?? fallback.teamId ?? null,
    ueZ1: Number(row?.ue_z1) || 0,
    ueZ2: Number(row?.ue_z2) || 0,
    ueZ3: Number(row?.ue_z3) || 0,
    vorarbeitBalance: Number(row?.vorarbeit_balance) || 0,
    ueZ1Correction: Number(row?.ue_z1_correction) || 0,
    ueZ2Correction: Number(row?.ue_z2_correction) || 0,
    ueZ3Correction: Number(row?.ue_z3_correction) || 0,
    ueZ1PositiveByYear: normalizeKontenObject(row?.ue_z1_positive_by_year),
    vacationDays: Number(row?.vacation_days) || 0,
    vacationDaysPerYear: Number(row?.vacation_days_per_year) || 21,
    creditedYears: normalizeKontenObject(row?.credited_years),
    updatedAt:
      updatedAtRaw instanceof Date
        ? updatedAtRaw.toISOString()
        : updatedAtRaw || null,
    updatedBy: row?.updated_by || null,
  };
}

/**
 * Mappt eine DB-Zeile eines Konten-Snapshots.
 *
 * @param {object} row
 * @returns {object}
 */
function mapKontenSnapshotRow(row) {
  return {
    ueZ1: Number(row?.ue_z1) || 0,
    ueZ1Positive: Number(row?.ue_z1_positive) || 0,
    ueZ2: Number(row?.ue_z2) || 0,
    ueZ3: Number(row?.ue_z3) || 0,
    vacUsed: Number(row?.vac_used) || 0,
    vorarbeitBalance: Number(row?.vorarbeit_balance) || 0,
  };
}

/**
 * Berechnet Ferientage für eine Absenz (nur type='ferien').
 * Berücksichtigt Wochenenden, Feiertage und Brückentage.
 *
 * @param {object} absence
 * @returns {number}
 */
function calculateAbsenceVacationDays(absence) {
  if (!absence || !absence.from || !absence.to) return 0;

  const type = String(absence.type || '').toLowerCase();
  if (type !== 'ferien') return 0;

  let fromDate = new Date(absence.from + 'T00:00:00');
  let toDate = new Date(absence.to + 'T00:00:00');

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()))
    return 0;
  if (toDate < fromDate) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }

  let days = 0;
  const cursor = new Date(fromDate);

  while (cursor <= toDate) {
    const weekday = cursor.getDay();
    const dateKey = formatDateKey(cursor);

    if (
      weekday >= 1 &&
      weekday <= 5 &&
      !isBernHolidayKey(dateKey) &&
      !isCompanyBridgeDay(dateKey)
    ) {
      days += absence.hours ? 0.5 : 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory — db-gebundene Funktionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt alle db-abhängigen Konten-Funktionen gebunden an eine DB-Connection.
 *
 * @param {import('pg').Pool} db
 * @returns {object} Alle Konten-Funktionen
 */
function createKontenService(db) {
  // ── Konto lesen/schreiben ──────────────────────────────────────────────────

  /**
   * Stellt sicher dass ein Konto-Eintrag für den User existiert.
   * Legt einen neuen an wenn keiner vorhanden ist.
   *
   * @param {{ username: string, teamId?: string, client?: import('pg').PoolClient }} params
   * @returns {Promise<{ userId: string, username: string, teamId: string|null, konto: object }>}
   */
  async function ensureKontenUserRecord({
    username,
    teamId = null,
    client = db,
  }) {
    if (!client) throw new Error('DATABASE_URL is not configured');

    const userResult = await client.query(
      'SELECT id, username, team_id FROM users WHERE username = $1 LIMIT 1',
      [username]
    );

    const userRow = userResult.rows[0];
    if (!userRow) throw new Error(`User not found: ${username}`);

    const userId = userRow.id;
    const resolvedTeam = teamId || userRow.team_id || null;

    const kontenResult = await client.query(
      'SELECT * FROM konten WHERE user_id = $1 LIMIT 1',
      [userId]
    );

    if (kontenResult.rows.length > 0) {
      return {
        userId,
        username,
        teamId: resolvedTeam,
        konto: mapKontenRow(kontenResult.rows[0], { teamId: resolvedTeam }),
      };
    }

    // Neu anlegen
    await client.query(
      `INSERT INTO konten (user_id, username, team_id) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
      [userId, username, resolvedTeam]
    );

    const newRow = await client.query(
      'SELECT * FROM konten WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    return {
      userId,
      username,
      teamId: resolvedTeam,
      konto: mapKontenRow(newRow.rows[0] || {}, { teamId: resolvedTeam }),
    };
  }

  /**
   * Schreibt ein Konto-Objekt in die DB.
   *
   * @param {{ client: import('pg').PoolClient, userId: string, username: string, teamId: string|null, konto: object }} params
   */
  async function persistKontenUserRecord({
    client,
    userId,
    username,
    teamId,
    konto,
  }) {
    if (!client) throw new Error('Missing DB client');

    await client.query(
      `UPDATE konten
       SET username=$2, team_id=$3, ue_z1=$4, ue_z2=$5, ue_z3=$6,
           ue_z1_positive_by_year=$7::jsonb, vacation_days=$8,
           vacation_days_per_year=$9, credited_years=$10::jsonb,
           updated_at=$11, updated_by=$12, vorarbeit_balance=$13,
           ue_z1_correction=$14, ue_z2_correction=$15, ue_z3_correction=$16
       WHERE user_id=$1`,
      [
        userId,
        username,
        teamId,
        Number(konto.ueZ1) || 0,
        Number(konto.ueZ2) || 0,
        Number(konto.ueZ3) || 0,
        JSON.stringify(konto.ueZ1PositiveByYear || {}),
        Number(konto.vacationDays) || 0,
        Number(konto.vacationDaysPerYear) || 21,
        JSON.stringify(konto.creditedYears || {}),
        konto.updatedAt || null,
        konto.updatedBy || null,
        Number(konto.vorarbeitBalance) || 0,
        Number(konto.ueZ1Correction) || 0,
        Number(konto.ueZ2Correction) || 0,
        Number(konto.ueZ3Correction) || 0,
      ]
    );
  }

  /**
   * Lädt alle Monats-Keys für die ein Snapshot existiert.
   *
   * @param {string} username
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<string[]>}
   */
  async function listKontenMonthKeys(username, client = db) {
    if (!client) return [];

    const result = await client.query(
      `SELECT month_key FROM konten_snapshots WHERE username = $1
       ORDER BY year ASC, month_index ASC`,
      [username]
    );

    return result.rows.map((row) => row.month_key);
  }

  /**
   * Lädt Konten für eine Liste von Usern.
   *
   * @param {Array<{ username: string, teamId: string|null }>} users
   * @returns {Promise<Array<{ username: string, teamId: string|null, konto: object }>>}
   */
  async function listKontenRowsForUsers(users) {
    return Promise.all(
      users.map(async (user) => {
        const ensured = await ensureKontenUserRecord({
          username: user.username,
          teamId: user.teamId || null,
        });
        return {
          username: user.username,
          teamId: user.teamId || null,
          konto: ensured.konto,
        };
      })
    );
  }

  /**
   * Führt manuelle Konto-Anpassungen durch (Delta-System) mit Audit-Trail.
   *
   * @param {{ username: string, values: object, updatedBy: string }} params
   * @returns {Promise<object>} Aktualisiertes Konto
   */
  async function updateKontenManualValues({ username, values, updatedBy }) {
    if (!db) throw new Error('DATABASE_URL is not configured');

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const ensured = await ensureKontenUserRecord({ username, client });
      const next = {
        ...ensured.konto,
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || username,
      };

      const correctionFields = [
        'ueZ1Correction',
        'ueZ2Correction',
        'ueZ3Correction',
      ];
      const absoluteFields = ['vacationDays', 'vacationDaysPerYear'];
      const auditEntries = [];

      for (const field of correctionFields) {
        if (values[field] == null) continue;
        const delta = Number(values[field]);
        if (!Number.isFinite(delta) || delta === 0) continue;
        const oldVal = Number(ensured.konto[field]) || 0;
        const newVal = Math.round((oldVal + delta) * 10) / 10;
        auditEntries.push({ field, oldValue: oldVal, newValue: newVal });
        next[field] = newVal;
      }

      for (const field of absoluteFields) {
        if (values[field] == null) continue;
        const n = Number(values[field]);
        if (!Number.isFinite(n)) continue;
        const oldVal = Number(ensured.konto[field]) || 0;
        if (oldVal !== n) {
          auditEntries.push({ field, oldValue: oldVal, newValue: n });
          next[field] = n;
        }
      }

      await persistKontenUserRecord({
        client,
        userId: ensured.userId,
        username: ensured.username,
        teamId: ensured.teamId,
        konto: next,
      });

      for (const entry of auditEntries) {
        await client.query(
          `INSERT INTO konto_adjustments
             (user_id, username, admin_username, field, old_value, new_value, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            ensured.userId,
            ensured.username,
            values.updatedBy || 'admin',
            entry.field,
            entry.oldValue,
            entry.newValue,
            values.reason || null,
          ]
        );
      }

      await client.query('COMMIT');
      return next;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Tagessoll ─────────────────────────────────────────────────────────────

  /**
   * Lädt den employment_start eines Users und gibt ihn als YYYY-MM-DD zurück.
   * Gecacht damit nicht pro Tag eine Query gemacht werden muss.
   *
   * @param {string} userId
   * @returns {Promise<string|null>}
   */
  async function fetchEmpStartKey(userId) {
    const row = await db.query(
      'SELECT employment_start FROM users WHERE id = $1',
      [userId]
    );
    const empStart = row.rows[0]?.employment_start;
    return empStart
      ? String(
          empStart instanceof Date
            ? empStart.toLocaleDateString('sv')
            : empStart
        ).slice(0, 10)
      : null;
  }

  /**
   * Berechnet das Tagessoll für einen User.
   * Berücksichtigt: Arbeitszeitmodell, Feiertage, Brückentage, employment_start,
   * Zukunftsdaten und Absenzen.
   *
   * @param {string} userId
   * @param {string} dateKey - YYYY-MM-DD
   * @param {Map<string, number|null>} acceptedAbsenceHoursMap
   * @param {string|undefined} [cachedEmpStartKey]
   * @returns {Promise<{ soll: number, employmentPct: number }>}
   */
  async function getDailySoll(
    userId,
    dateKey,
    acceptedAbsenceHoursMap,
    cachedEmpStartKey = undefined
  ) {
    const weekday = new Date(dateKey + 'T00:00:00').getDay();
    if (weekday === 0 || weekday === 6) return { soll: 0, employmentPct: 100 };

    let empStartKey;
    if (cachedEmpStartKey !== undefined) {
      empStartKey = cachedEmpStartKey;
    } else {
      empStartKey = await fetchEmpStartKey(userId);
    }

    if (empStartKey && empStartKey > dateKey)
      return { soll: 0, employmentPct: 100 };

    const today = formatDateKey(new Date());
    if (dateKey >= today) return { soll: 0, employmentPct: 100 };

    if (isBernHolidayKey(dateKey)) return { soll: 0, employmentPct: 100 };
    if (isCompanyBridgeDay(dateKey)) return { soll: 0, employmentPct: 100 };

    if (acceptedAbsenceHoursMap && acceptedAbsenceHoursMap.has(dateKey)) {
      const absHours = acceptedAbsenceHoursMap.get(dateKey);
      if (absHours === null) return { soll: 0, employmentPct: 100 };
    }

    const result = await db.query(
      `SELECT employment_pct, work_days FROM work_schedules
       WHERE user_id = $1 AND valid_from <= $2
       ORDER BY valid_from DESC LIMIT 1`,
      [userId, dateKey]
    );

    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayKey = DAY_KEYS[weekday];
    let baseSoll = 8.0;
    let employmentPct = 100;

    if (result.rows.length > 0) {
      const row = result.rows[0];
      baseSoll = toNumber((row.work_days || {})[dayKey]) || 0;
      employmentPct = Number(row.employment_pct) || 100;
    }

    if (acceptedAbsenceHoursMap && acceptedAbsenceHoursMap.has(dateKey)) {
      const absHours = acceptedAbsenceHoursMap.get(dateKey);
      if (absHours !== null) baseSoll = Math.max(0, baseSoll - absHours);
    }

    return { soll: baseSoll, employmentPct };
  }

  // ── Konto beim Transmit aktualisieren ─────────────────────────────────────

  /**
   * Aktualisiert das Konto nach einem Monats-Transmit.
   * Berechnet ÜZ1/Vorarbeit-Delta und schreibt Snapshot.
   *
   * @param {{ username, teamId, year, monthIndex, totals, payload, updatedBy, computeMonthUeZ1AndVorarbeit }} params
   * @returns {Promise<object>} Aktualisiertes Konto
   */
  async function updateKontenFromSubmission({
    username,
    teamId,
    year,
    monthIndex,
    totals,
    payload,
    updatedBy,
    computeMonthUeZ1AndVorarbeit,
  }) {
    if (!db) throw new Error('DATABASE_URL is not configured');

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const ensured = await ensureKontenUserRecord({
        username,
        teamId,
        client,
      });
      const mk = kontenMonthKey(year, monthIndex);
      const yearStr = String(year);

      const snapResult = await client.query(
        `SELECT ue_z1, ue_z1_positive, ue_z2, ue_z3, vac_used, vorarbeit_balance
         FROM konten_snapshots WHERE user_id = $1 AND year = $2 AND month_index = $3 LIMIT 1`,
        [ensured.userId, year, monthIndex]
      );

      const prevSnap = snapResult.rows[0]
        ? mapKontenSnapshotRow(snapResult.rows[0])
        : {
            ueZ1: 0,
            ueZ1Positive: 0,
            ueZ2: 0,
            ueZ3: 0,
            vacUsed: 0,
            vorarbeitBalance: 0,
          };

      const vorarbeitRequired =
        Number(getPayrollYearConfig(year).vorarbeitRequired) || 39;

      const nextKonto = {
        ...ensured.konto,
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || username,
      };

      const prevMonthSnap = await client.query(
        `SELECT vorarbeit_balance FROM konten_snapshots
         WHERE user_id = $1 AND year = $2 AND month_index < $3
         ORDER BY year DESC, month_index DESC LIMIT 1`,
        [ensured.userId, year, monthIndex]
      );

      let vorarbeitBalance =
        prevMonthSnap.rows.length > 0
          ? round1(Number(prevMonthSnap.rows[0].vorarbeit_balance) || 0)
          : 0;

      if (!nextKonto.creditedYears[yearStr]) {
        nextKonto.vacationDays += Number(nextKonto.vacationDaysPerYear) || 0;
        nextKonto.creditedYears[yearStr] = true;
        vorarbeitBalance = 0;
      }

      const { ueZ1: monthUeZ1, vorarbeitBalance: newVorarbeitBalance } =
        await computeMonthUeZ1AndVorarbeit(
          payload,
          year,
          monthIndex,
          ensured.userId,
          vorarbeitBalance,
          vorarbeitRequired
        );

      const deltaUeZ1 = round1(monthUeZ1 - prevSnap.ueZ1);

      const nextSnap = {
        ueZ1: monthUeZ1,
        ueZ1Positive: 0,
        ueZ2: Number(totals?.pikett) || 0,
        ueZ3: Number(totals?.overtime3) || 0,
        vacUsed: computeVacationUsedDaysForMonth(payload, year, monthIndex),
        vorarbeitBalance: newVorarbeitBalance,
      };

      nextKonto.vorarbeitBalance = newVorarbeitBalance;
      nextKonto.ueZ1 += deltaUeZ1;
      nextKonto.ueZ2 += nextSnap.ueZ2 - prevSnap.ueZ2;
      nextKonto.ueZ3 += nextSnap.ueZ3 - prevSnap.ueZ3;
      nextKonto.vacationDays -= nextSnap.vacUsed - prevSnap.vacUsed;

      await client.query(
        `INSERT INTO konten_snapshots
           (user_id, username, year, month_index, month_key, ue_z1, ue_z1_positive,
            ue_z2, ue_z3, vac_used, vorarbeit_balance, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (user_id, year, month_index) DO UPDATE SET
           username=EXCLUDED.username, month_key=EXCLUDED.month_key,
           ue_z1=EXCLUDED.ue_z1, ue_z1_positive=EXCLUDED.ue_z1_positive,
           ue_z2=EXCLUDED.ue_z2, ue_z3=EXCLUDED.ue_z3,
           vac_used=EXCLUDED.vac_used, vorarbeit_balance=EXCLUDED.vorarbeit_balance,
           updated_at=EXCLUDED.updated_at`,
        [
          ensured.userId,
          ensured.username,
          year,
          monthIndex,
          mk,
          nextSnap.ueZ1,
          nextSnap.ueZ1Positive,
          nextSnap.ueZ2,
          nextSnap.ueZ3,
          nextSnap.vacUsed,
          nextSnap.vorarbeitBalance,
          nextKonto.updatedAt,
        ]
      );

      await client.query(
        `UPDATE konten SET ue_z1=$2, ue_z2=$3, ue_z3=$4, vorarbeit_balance=$5,
         vacation_days=$6, credited_years=$7, updated_at=$8, updated_by=$9
         WHERE user_id=$1`,
        [
          ensured.userId,
          nextKonto.ueZ1,
          nextKonto.ueZ2,
          nextKonto.ueZ3,
          nextKonto.vorarbeitBalance,
          nextKonto.vacationDays,
          JSON.stringify(nextKonto.creditedYears),
          nextKonto.updatedAt,
          nextKonto.updatedBy,
        ]
      );

      await client.query('COMMIT');
      return nextKonto;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Stellt Ferientage zurück wenn eine akzeptierte Absenz storniert wird.
   *
   * @param {{ username: string, absence: object, updatedBy: string }} params
   * @returns {Promise<number>} Anzahl zurückerstatteter Ferientage
   */
  async function restoreVacationDaysForCancelledAbsence({
    username,
    absence,
    updatedBy,
  }) {
    if (!db) return 0;

    const vacDays = calculateAbsenceVacationDays(absence);
    if (!(vacDays > 0)) return 0;

    let fromDate = new Date(absence.from + 'T00:00:00');
    let toDate = new Date(absence.to + 'T00:00:00');

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()))
      return 0;
    if (toDate < fromDate) {
      const tmp = fromDate;
      fromDate = toDate;
      toDate = tmp;
    }

    const affectedMonths = new Set();
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      affectedMonths.add(
        kontenMonthKey(cursor.getFullYear(), cursor.getMonth())
      );
      cursor.setMonth(cursor.getMonth() + 1);
      cursor.setDate(1);
    }

    const monthKeys = Array.from(affectedMonths);
    if (!monthKeys.length) return 0;

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const ensured = await ensureKontenUserRecord({ username, client });
      const snapResult = await client.query(
        `SELECT year, month_index, month_key, vac_used FROM konten_snapshots
         WHERE user_id = $1 AND month_key = ANY($2::text[])`,
        [ensured.userId, monthKeys]
      );

      if (!snapResult.rows.length) {
        await client.query('ROLLBACK');
        return 0;
      }

      const nextKonto = {
        ...ensured.konto,
        vacationDays: (Number(ensured.konto.vacationDays) || 0) + vacDays,
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || username,
      };

      await persistKontenUserRecord({
        client,
        userId: ensured.userId,
        username: ensured.username,
        teamId: ensured.teamId,
        konto: nextKonto,
      });

      for (const row of snapResult.rows) {
        const nextVacUsed = Math.max(0, (Number(row.vac_used) || 0) - vacDays);
        await client.query(
          `UPDATE konten_snapshots SET vac_used=$4, updated_at=$5
           WHERE user_id=$1 AND year=$2 AND month_index=$3`,
          [
            ensured.userId,
            row.year,
            row.month_index,
            nextVacUsed,
            nextKonto.updatedAt,
          ]
        );
      }

      await client.query('COMMIT');
      return vacDays;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Routes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Registriert alle Konten-Routes.
   *
   * @param {import('express').Application} app
   * @param {import('express').RequestHandler} requireAuth
   * @param {import('express').RequestHandler} requireAdmin
   * @param {Function} findUserByUsername
   * @param {Function} listUsersFromDb
   */
  function registerKontenRoutes(
    app,
    requireAuth,
    requireAdmin,
    findUserByUsername,
    listUsersFromDb
  ) {
    // GET /api/konten/me
    app.get('/api/konten/me', requireAuth, async (req, res) => {
      try {
        const ensured = await ensureKontenUserRecord({
          username: req.user.username,
          teamId: req.user.teamId || null,
        });
        const transmittedMonths = await listKontenMonthKeys(req.user.username);
        return res.json({ ok: true, konto: ensured.konto, transmittedMonths });
      } catch (err) {
        console.error('Failed to load my konto', err);
        return res
          .status(500)
          .json({ ok: false, error: 'Could not load konto' });
      }
    });

    // GET /api/admin/konten
    app.get(
      '/api/admin/konten',
      requireAuth,
      requireAdmin,
      async (req, res) => {
        try {
          const users = await listUsersFromDb();
          const rows = await listKontenRowsForUsers(users);
          return res.json({ ok: true, users: rows });
        } catch (err) {
          console.error('Failed to load admin konten', err);
          return res
            .status(500)
            .json({ ok: false, error: 'Could not load konten' });
        }
      }
    );

    // POST /api/admin/konten/set
    app.post(
      '/api/admin/konten/set',
      requireAuth,
      requireAdmin,
      async (req, res) => {
        const username = String(req.body?.username || '');
        try {
          const targetUser = await findUserByUsername(username);
          if (!username || !targetUser) {
            return res
              .status(400)
              .json({ ok: false, error: 'Invalid username' });
          }
          const konto = await updateKontenManualValues({
            username,
            values: { ...req.body, updatedBy: req.user.username },
            updatedBy: req.user.username,
          });
          return res.json({ ok: true, konto });
        } catch (err) {
          console.error('Failed to save admin konto', err);
          return res
            .status(500)
            .json({ ok: false, error: 'Could not save konto' });
        }
      }
    );

    // GET /api/admin/konten/adjustments/:username
    app.get(
      '/api/admin/konten/adjustments/:username',
      requireAuth,
      requireAdmin,
      async (req, res) => {
        const username = String(req.params.username || '');
        try {
          const result = await db.query(
            `SELECT field, old_value, new_value, admin_username, reason, created_at
           FROM konto_adjustments WHERE username = $1
           ORDER BY created_at DESC LIMIT 50`,
            [username]
          );
          return res.json({ ok: true, adjustments: result.rows });
        } catch (err) {
          console.error('Failed to load konto adjustments', err);
          return res
            .status(500)
            .json({ ok: false, error: 'Could not load adjustments' });
        }
      }
    );
  }

  // Alle Funktionen zurückgeben
  return {
    ensureKontenUserRecord,
    persistKontenUserRecord,
    listKontenMonthKeys,
    listKontenRowsForUsers,
    updateKontenManualValues,
    fetchEmpStartKey,
    getDailySoll,
    updateKontenFromSubmission,
    restoreVacationDaysForCancelledAbsence,
    registerKontenRoutes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Pure Funktionen (db-unabhängig)
  computeVacationDaysPerYear,
  normalizeKontenObject,
  mapKontenRow,
  mapKontenSnapshotRow,
  calculateAbsenceVacationDays,

  // Factory
  createKontenService,
};
