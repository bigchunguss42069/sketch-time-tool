require('dotenv').config();
// ============================================================================
// Runtime dependencies and app bootstrap
// ============================================================================
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { Pool } = require('pg');
const exportPdfBody = express.json({ limit: '10mb' });
const helmet = require('helmet');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';

// ============================================================================
// holidays.js Import
// ============================================================================

const {
  isBernHolidayKey,
  isCompanyBridgeDay,
  isWeekdayDateKey,
  formatDateKey,
  formatDateDisplayEU,
  parseIsoDateOnly,
  makeMonthLabel,
  kontenMonthKey,
  weekKey,
  getMonthRangeBetween,
  isDateKeyInClosedRange,
} = require('./lib/holidays');

// ============================================================================
//  compute.js Import
// ============================================================================

const {
  round1,
  toNumber,
  computeNetWorkingHoursFromStamps,
  computeDailyWorkingHours,
  computeNonPikettHours,
  buildPikettHoursByDate,
  buildAcceptedAbsenceHoursMap,
  computeAbsenceDaysInPeriod,
  computeVacationUsedDaysForMonth,
  computeTransmissionTotals,
  deepCloneJson,
} = require('./lib/compute');

// ============================================================================
// constants.js Import
// ============================================================================

const {
  TEAMS,
  getPayrollYearConfig,
  INITIAL_USERS,
} = require('./lib/constants');

// ============================================================================
// pdf-helpers.js Import
// ============================================================================

const {
  createPdfHelpers,
  fmtHours,
  fmtSignedHours,
  fmtCount,
} = require('./lib/pdf-helpers');

// ============================================================================
// auth.js Import
// ============================================================================

const {
  mapDbUser,
  findUserByUsername,
  findUserById,
  createRequireAuth,
  requireAdmin,
  registerAuthRoutes,
} = require('./lib/auth');

// ============================================================================
// db-schema.js Import
// ============================================================================

const { initializeDatabase } = require('./lib/db-schema');

// ============================================================================
// absences.js Import
// ============================================================================

const {
  listUserAbsencesFromDb,
  findAbsenceByUserAndId,
  insertAbsenceForUser,
  deleteAbsenceForUser,
  updateAbsenceStatus,
  findAcceptedAbsenceForDate,
  registerAbsenceRoutes,
} = require('./lib/absences');

// ============================================================================
// anlagen.js Import
// ============================================================================

const {
  readAnlagenLedger,
  writeAnlagenLedger,
  readAnlagenSnapshot,
  writeAnlagenSnapshot,
  readAnlagenIndex,
  writeAnlagenIndex,
  extractAnlagenSnapshotFromPayload,
  applySnapshotToIndexAndLedger,
  recomputeLastActivitiesForTeam,
  registerAnlagenRoutes,
} = require('./lib/anlagen');

// ============================================================================
// konten.js Import
// ============================================================================

const {
  computeVacationDaysPerYear,
  mapKontenRow,
  mapKontenSnapshotRow,
  calculateAbsenceVacationDays,
  createKontenService,
} = require('./lib/konten');

// ============================================================================
// week-locks.js Import
// ============================================================================

const {
  mapWeekLockRow,
  buildWeekLocksMap,
  getLockMeta,
  collectLockedDatesForMonth,
  absenceOverlapsLockedDates,
  createWeekLocksService,
} = require('./lib/week-locks');

// ============================================================================
// submissions.js Import
// ============================================================================

const {
  mapTransmissionMeta,
  createSubmissionsService,
} = require('./lib/submissions');

// ============================================================================
// compute-async.js Import
// ============================================================================

const {
  buildMonthOverviewFromSubmission,
  createComputeAsyncService,
} = require('./lib/compute-async');

// ============================================================================
// payroll.js Import
// ============================================================================

const {
  getPayrollAbsenceTypeLabel,
  ensurePayrollAuditRow,
  createPayrollService,
} = require('./lib/payroll');

// ============================================================================
// transmit.js Import
// ============================================================================

const {
  aggregatePayrollFromSubmission,
  mergeLockedWeeksPayload,
  createTransmitService,
} = require('./lib/transmit');

// ============================================================================
// corn/audit-pdf.js Import
// ============================================================================

const { createMailTransporter, registerCronJobs } = require('./lib/cron');
const { registerAuditPdfRoute } = require('./lib/audit-pdf');

const db = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
    })
  : null;

// ============================================================================
// Service Instanzen
// ============================================================================

const requireAuth = createRequireAuth(db);

const {
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
} = createKontenService(db);

const {
  computeMonthUeZ1,
  computeRangeUeZ1,
  computePayrollPeriodOvertimeFromSubmission,
} = createComputeAsyncService(getDailySoll, fetchEmpStartKey);

const {
  readWeekLocksFromDb,
  readUserWeekLocksFromDb,
  setWeekLockState,
  clearWeekLockState,
  autoLockPreviousWeek,
  registerWeekLockRoutes,
} = createWeekLocksService(db);

const {
  listUsersFromDb,
  insertMonthSubmission,
  deleteMonthSubmissionById,
  listUserTransmissions,
  getLatestTransmissionMeta,
  getLatestMonthSubmissionRecord,
  loadLatestMonthSubmission,
} = createSubmissionsService(db, mapDbUser);

const { buildPayrollPeriodDataForUser, registerPayrollRoutes } =
  createPayrollService(db, {
    computeRangeUeZ1,
    computePayrollPeriodOvertimeFromSubmission,
    loadLatestMonthSubmission,
    aggregatePayrollFromSubmission,
  });

const { autoTransmitForUser, registerTransmitRoutes } = createTransmitService(
  db,
  {
    insertMonthSubmission,
    loadLatestMonthSubmission,
    listUserTransmissions,
    readWeekLocksFromDb,
    collectLockedDatesForMonth,
    updateKontenFromSubmission,
    computeMonthUeZ1,
    readAnlagenIndex,
    readAnlagenLedger,
    readAnlagenSnapshot,
    writeAnlagenIndex,
    writeAnlagenLedger,
    writeAnlagenSnapshot,
    extractAnlagenSnapshotFromPayload,
    applySnapshotToIndexAndLedger,
    recomputeLastActivitiesForTeam,
    deleteMonthSubmissionById,
    deepCloneJson,
  }
);

if (db) {
  db.on('error', (err) => {
    console.error('Postgres pool error', err);
  });
}

// ============================================================================
// Global middleware
// ============================================================================
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(helmet());
app.use(express.json({ limit: '25mb' }));

// ============================================================================
// Basic health check
// ============================================================================
app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running 🚀' });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/health/db', async (req, res) => {
  if (!db) {
    return res.status(500).json({
      ok: false,
      error: 'DATABASE_URL is not configured',
    });
  }

  try {
    const result = await db.query(
      'select now() as now, current_database() as database'
    );

    return res.json({
      ok: true,
      database: result.rows[0]?.database || null,
      now: result.rows[0]?.now || null,
    });
  } catch (err) {
    console.error('Database health check failed', err);
    return res.status(500).json({
      ok: false,
      error: 'Database connection failed',
      detail: err.message,
    });
  }
});

registerAuthRoutes(app, db, requireAuth, createMailTransporter);

registerAbsenceRoutes(
  app,
  db,
  requireAuth,
  requireAdmin,
  (username) => findUserByUsername(db, username),
  restoreVacationDaysForCancelledAbsence,
  listUsersFromDb
);

registerAnlagenRoutes(
  app,
  db,
  requireAuth,
  requireAdmin,
  exportPdfBody,
  listUsersFromDb
);

registerKontenRoutes(
  app,
  requireAuth,
  requireAdmin,
  (username) => findUserByUsername(db, username),
  listUsersFromDb
);

registerWeekLockRoutes(app, requireAuth, requireAdmin, (username) =>
  findUserByUsername(db, username)
);

registerPayrollRoutes(
  app,
  requireAuth,
  requireAdmin,
  listUsersFromDb,
  (username) => findUserByUsername(db, username)
);

registerTransmitRoutes(app, requireAuth, requireAdmin);

registerAuditPdfRoute(app, requireAuth, requireAdmin, db, TEAMS);

// ============================================================================
// Admin transmission overview routes
// ============================================================================
app.get(
  '/api/admin/users/:username/transmissions',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const username = req.params.username;
      const user = await findUserByUsername(db, username);

      if (!user) {
        return res.status(404).json({ ok: false, error: 'User not found' });
      }

      const transmissions = await listUserTransmissions(username);

      return res.json({
        ok: true,
        username,
        transmissions,
      });
    } catch (err) {
      console.error('Failed to load user transmissions', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not load transmissions' });
    }
  }
);

// POST /api/stamps/live — Stamp-Status updaten (User)
app.post('/api/stamps/live', requireAuth, async (req, res) => {
  try {
    const { todayKey, stamps } = req.body;
    if (!todayKey || !Array.isArray(stamps)) {
      return res.status(400).json({ ok: false, error: 'Ungültige Daten' });
    }
    await db.query(
      `
      INSERT INTO live_stamps (user_id, username, today_key, stamps, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET today_key = $3, stamps = $4, updated_at = NOW()
    `,
      [req.user.id, req.user.username, todayKey, JSON.stringify(stamps)]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('Live stamp error', err);
    return res.status(500).json({ ok: false });
  }
});

// GET /api/admin/live-status — Live Stamp-Status aller User (Admin)
app.get(
  '/api/admin/live-status',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await db.query(`
      SELECT l.username, l.today_key, l.stamps, l.updated_at, u.team_id
      FROM live_stamps l
      LEFT JOIN users u ON u.username = l.username
      ORDER BY l.username ASC
    `);
      return res.json({
        ok: true,
        users: result.rows.map((r) => ({
          username: r.username,
          teamId: r.team_id || null,
          todayKey: r.today_key,
          stamps: r.stamps || [],
          updatedAt:
            r.updated_at instanceof Date
              ? r.updated_at.toISOString()
              : String(r.updated_at),
        })),
      });
    } catch (err) {
      console.error('Live status error', err);
      return res.status(500).json({ ok: false, error: 'Fehler beim Laden' });
    }
  }
);

// GET /api/admin/stamp-edits?year=2026&monthIndex=3 — Edit-Log (Admin)
app.get(
  '/api/admin/stamp-edits',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const year = Number(req.query.year) || new Date().getFullYear();
      const monthIndex = Number(req.query.monthIndex ?? new Date().getMonth());

      const result = await db.query(
        `
      SELECT s.username, s.date_key, s.action, s.old_time, s.new_time,
             s.old_type, s.new_type, s.transmitted_at, u.team_id
      FROM stamp_edits s
      LEFT JOIN users u ON u.username = s.username
      WHERE s.year = $1 AND s.month_index = $2
      ORDER BY s.username ASC, s.transmitted_at DESC
    `,
        [year, monthIndex]
      );

      const byUser = {};
      result.rows.forEach((r) => {
        if (!byUser[r.username]) {
          byUser[r.username] = { teamId: r.team_id || null, edits: [] };
        }
        byUser[r.username].edits.push({
          dateKey: r.date_key,
          action: r.action,
          oldTime: r.old_time,
          newTime: r.new_time,
          oldType: r.old_type,
          newType: r.new_type,
          transmittedAt:
            r.transmitted_at instanceof Date
              ? r.transmitted_at.toISOString()
              : String(r.transmitted_at),
        });
      });

      const users = Object.entries(byUser).map(
        ([username, { teamId, edits }]) => ({
          username,
          teamId,
          editCount: edits.length,
          flagged: edits.length >= 10,
          edits,
        })
      );

      return res.json({ ok: true, users });
    } catch (err) {
      console.error('Stamp edits error', err);
      return res.status(500).json({ ok: false, error: 'Fehler beim Laden' });
    }
  }
);

// GET /api/admin/work-schedule/:userId — Modell-History laden
app.get(
  '/api/admin/work-schedule/:userId',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await db.query(
        `
      SELECT id, employment_pct, work_days, valid_from
      FROM work_schedules
      WHERE user_id = $1
      ORDER BY valid_from DESC
    `,
        [req.params.userId]
      );
      return res.json({ ok: true, schedules: result.rows });
    } catch (err) {
      console.error('Work schedule load error', err);
      return res.status(500).json({ ok: false, error: 'Fehler beim Laden' });
    }
  }
);

// POST /api/admin/work-schedule — Neues Modell hinzufügen
app.post(
  '/api/admin/work-schedule',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { userId, employmentPct, workDays, validFrom } = req.body;
      if (!userId || !employmentPct || !workDays || !validFrom) {
        return res.status(400).json({ ok: false, error: 'Fehlende Felder' });
      }

      // Username holen
      const userResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );
      if (userResult.rows.length === 0) {
        return res
          .status(404)
          .json({ ok: false, error: 'User nicht gefunden' });
      }

      await db.query(
        `
      INSERT INTO work_schedules (user_id, username, employment_pct, work_days, valid_from)
      VALUES ($1, $2, $3, $4, $5)
    `,
        [
          userId,
          userResult.rows[0].username,
          Number(employmentPct),
          JSON.stringify(workDays),
          validFrom,
        ]
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error('Work schedule save error', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Fehler beim Speichern' });
    }
  }
);

// DELETE /api/admin/work-schedule/:id — Eintrag löschen
app.delete(
  '/api/admin/work-schedule/:id',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      await db.query('DELETE FROM work_schedules WHERE id = $1', [
        req.params.id,
      ]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Work schedule delete error', err);
      return res.status(500).json({ ok: false, error: 'Fehler beim Löschen' });
    }
  }
);

// ---- Admin: month overview (per user, month-specific) ----
// ============================================================================
// Admin month overview and day detail routes
// ============================================================================
app.get(
  '/api/admin/month-overview',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const year = Number(req.query.year);
    const monthIndex = Number(req.query.monthIndex);

    let allLocks;
    try {
      allLocks = await readWeekLocksFromDb();
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(monthIndex) ||
      monthIndex < 0 ||
      monthIndex > 11
    ) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid year or monthIndex' });
    }

    try {
      const monthLabel = makeMonthLabel(year, monthIndex);
      const users = await listUsersFromDb({ role: 'user' });

      const rows = await Promise.all(
        users.map(async (user) => {
          const team = TEAMS.find((t) => t.id === user.teamId) || null;
          const latestOverall = await getLatestTransmissionMeta(user.username);
          const monthRecord = await getLatestMonthSubmissionRecord(
            user.username,
            year,
            monthIndex
          );

          if (!monthRecord || !monthRecord.submission) {
            return {
              userId: user.id,
              username: user.username,
              role: user.role,
              teamId: user.teamId || null,
              teamName: team ? team.name : null,
              lastSentAt: latestOverall ? latestOverall.sentAt : null,
              month: {
                year,
                monthIndex,
                monthLabel,
                transmitted: false,
                sentAt: null,
                monthTotalHours: null,
                weeks: [],
              },
            };
          }

          const submission = monthRecord.submission;
          const monthStartKey = formatDateKey(new Date(year, monthIndex, 1));
          const monthEndKey = formatDateKey(new Date(year, monthIndex + 1, 0));

          const storedAbsences = await listUserAbsencesFromDb(
            db,
            user.username
          );

          const acceptedAbsenceDays = buildAcceptedAbsenceHoursMap(
            storedAbsences,
            monthStartKey,
            monthEndKey
          );

          const overview = buildMonthOverviewFromSubmission(
            submission,
            year,
            monthIndex,
            acceptedAbsenceDays
          );

          const userLocks =
            allLocks[user.username] &&
            typeof allLocks[user.username] === 'object'
              ? allLocks[user.username]
              : {};

          const weeksWithLocks = overview.weeks.map((w) => {
            const wk = weekKey(w.weekYear, w.week);
            const meta = getLockMeta(userLocks, wk);

            return {
              ...w,
              locked: meta.locked,
              lockedAt: meta.lockedAt,
              lockedBy: meta.lockedBy,
            };
          });

          return {
            userId: user.id,
            username: user.username,
            role: user.role,
            teamId: user.teamId || null,
            teamName: team ? team.name : null,
            lastSentAt: latestOverall ? latestOverall.sentAt : null,
            month: {
              year,
              monthIndex,
              monthLabel,
              transmitted: true,
              sentAt: monthRecord.meta.sentAt,
              monthTotalHours: overview.monthTotalHours,
              weeks: weeksWithLocks,
            },
          };
        })
      );

      return res.json({
        ok: true,
        month: { year, monthIndex, monthLabel },
        users: rows,
      });
    } catch (err) {
      console.error('Failed to build admin month overview', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not build month overview' });
    }
  }
);

// POST /api/draft/sync — Client speichert Draft
app.post('/api/draft/sync', requireAuth, async (req, res) => {
  try {
    const { data, basedOn } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: 'Kein data-Objekt' });
    }

    // Conflict-Check: wenn ein anderes Gerät inzwischen neuere Daten geschrieben hat
    if (basedOn) {
      const current = await db.query(
        'SELECT updated_at FROM user_drafts WHERE user_id = $1',
        [req.user.id]
      );
      if (current.rows.length > 0) {
        const serverTime = new Date(current.rows[0].updated_at).getTime();
        const clientBase = new Date(basedOn).getTime();
        if (serverTime > clientBase) {
          return res.status(409).json({ ok: false, conflict: true });
        }
      }
    }

    await db.query(
      `
      INSERT INTO user_drafts (user_id, username, data, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET data = $3, updated_at = NOW()
    `,
      [req.user.id, req.user.username, JSON.stringify(data)]
    );

    const saved = await db.query(
      'SELECT updated_at FROM user_drafts WHERE user_id = $1',
      [req.user.id]
    );
    const updatedAt = saved.rows[0]?.updated_at;
    return res.json({
      ok: true,
      updatedAt:
        updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt),
    });
  } catch (err) {
    console.error('Draft sync error', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Draft konnte nicht gespeichert werden' });
  }
});

// GET /api/draft/load — Client lädt Draft beim Login
app.get('/api/draft/load', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT data, updated_at FROM user_drafts WHERE user_id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.json({ ok: true, draft: null });
    }

    const row = result.rows[0];
    return res.json({
      ok: true,
      draft: row.data,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
    });
  } catch (err) {
    console.error('Draft load error', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Draft konnte nicht geladen werden' });
  }
});

// ---- Admin: day details (fetch on demand) ----
// GET /api/admin/day-detail?username=demo&year=2025&monthIndex=11&date=2025-12-01
// Detailed admin inspection for a single transmitted day.
app.get(
  '/api/admin/day-detail',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const username = String(req.query.username || '');
    const year = Number(req.query.year);
    const monthIndex = Number(req.query.monthIndex);
    const dateKey = String(req.query.date || '').slice(0, 10);

    if (
      !username ||
      !Number.isInteger(year) ||
      !Number.isInteger(monthIndex) ||
      monthIndex < 0 ||
      monthIndex > 11
    ) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid username/year/monthIndex' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid date (expected YYYY-MM-DD)' });
    }

    try {
      const user = await findUserByUsername(db, username);
      if (!user) {
        return res.status(404).json({ ok: false, error: 'User not found' });
      }

      const monthRecord = await getLatestMonthSubmissionRecord(
        username,
        year,
        monthIndex
      );

      if (!monthRecord || !monthRecord.submission) {
        return res.json({
          ok: true,
          username,
          dateKey,
          transmitted: false,
          error: null,
        });
      }

      const submission = monthRecord.submission;
      const dayData =
        submission.days && submission.days[dateKey]
          ? submission.days[dateKey]
          : null;

      const storedAbsences = await listUserAbsencesFromDb(db, username);
      const acceptedAbsence = findAcceptedAbsenceForDate(
        storedAbsences.length ? storedAbsences : submission.absences,
        dateKey
      );

      const pikettEntries = Array.isArray(submission.pikett)
        ? submission.pikett.filter((p) => p && p.date === dateKey)
        : [];

      const pikettHours = pikettEntries.reduce(
        (sum, p) => sum + toNumber(p.hours),
        0
      );
      const stamps = Array.isArray(dayData?.stamps) ? dayData.stamps : [];
      const stampHours = computeNetWorkingHoursFromStamps(stamps);

      const komEntries = Array.isArray(dayData?.entries) ? dayData.entries : [];
      const specialEntries = Array.isArray(dayData?.specialEntries)
        ? dayData.specialEntries
        : [];
      const flags =
        dayData && dayData.flags && typeof dayData.flags === 'object'
          ? dayData.flags
          : {};

      const mealAllowance =
        dayData &&
        dayData.mealAllowance &&
        typeof dayData.mealAllowance === 'object'
          ? dayData.mealAllowance
          : { 1: false, 2: false, 3: false };

      let komHours = 0;
      komEntries.forEach((e) => {
        if (!e || !e.hours || typeof e.hours !== 'object') return;
        Object.values(e.hours).forEach((v) => {
          komHours += toNumber(v);
        });
      });

      let specialHours = 0;
      specialEntries.forEach((s) => {
        specialHours += toNumber(s?.hours);
      });

      const dayHoursObj =
        dayData && dayData.dayHours && typeof dayData.dayHours === 'object'
          ? dayData.dayHours
          : {};

      const schulung = toNumber(dayHoursObj.schulung);
      const sitzungKurs = toNumber(dayHoursObj.sitzungKurs);
      const arztKrank = toNumber(dayHoursObj.arztKrank);

      const dayHoursTotal = schulung + sitzungKurs + arztKrank;
      const nonPikettTotal = komHours + specialHours + dayHoursTotal;
      const totalHours =
        (stamps.length > 0 ? stampHours : nonPikettTotal) + pikettHours;

      const ferien = !!flags.ferien;
      let status = 'missing';
      if (ferien) status = 'ferien';
      else if (acceptedAbsence) status = 'absence';
      else if (totalHours > 0) status = 'ok';

      return res.json({
        ok: true,
        username,
        transmitted: true,
        month: {
          year,
          monthIndex,
          monthLabel: submission.monthLabel || makeMonthLabel(year, monthIndex),
          sentAt: monthRecord.meta.sentAt,
        },
        dateKey,
        status,
        flags,
        mealAllowance,
        acceptedAbsence: acceptedAbsence
          ? {
              type: acceptedAbsence.type || '',
              from: acceptedAbsence.from,
              to: acceptedAbsence.to,
              hours: acceptedAbsence.hours ?? null,
              comment: acceptedAbsence.comment || '',
            }
          : null,
        totals: {
          komHours: Math.round(komHours * 10) / 10,
          specialHours: Math.round(specialHours * 10) / 10,
          dayHoursTotal: Math.round(dayHoursTotal * 10) / 10,
          pikettHours: Math.round(pikettHours * 10) / 10,
          totalHours: Math.round((nonPikettTotal + pikettHours) * 10) / 10,
        },
        breakdown: {
          dayHours: { schulung, sitzungKurs, arztKrank },
        },
        entries: komEntries,
        specialEntries,
        pikettEntries,
        stamps,
        stampHours: Math.round(stampHours * 10) / 10,
      });
    } catch (err) {
      console.error('Failed to build admin day detail', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not load day detail' });
    }
  }
);

// ============================================================================
// Payroll helpers and routes
// ============================================================================
app.get(
  '/api/admin/payroll-users',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const teamId = String(req.user.teamId || '');
      const users = await listUsersFromDb({
        role: 'user',
        teamId: teamId || null,
      });

      return res.json({
        ok: true,
        users: users.map((u) => ({
          id: u.id,
          username: u.username,
          displayName: u.username,
        })),
      });
    } catch (err) {
      console.error('Failed to load payroll users', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not load payroll users' });
    }
  }
);

// ============================================================================
// Admin transmission summary route
// ============================================================================
// Only accessible for admins
app.get(
  '/api/admin/transmissions-summary',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const users = await listUsersFromDb({ role: 'user' });

      const summaries = await Promise.all(
        users.map(async (user) => {
          const transmissions = await listUserTransmissions(user.username);
          const latest = transmissions[0] || null;
          const team = TEAMS.find((t) => t.id === user.teamId) || null;

          return {
            userId: user.id,
            username: user.username,
            role: user.role,
            teamId: user.teamId || null,
            teamName: team ? team.name : null,
            transmissionsCount: transmissions.length,
            lastSentAt: latest ? latest.sentAt : null,
            lastMonthLabel: latest ? latest.monthLabel || null : null,
            lastTotals: latest ? latest.totals || null : null,
          };
        })
      );

      return res.json({
        ok: true,
        users: summaries,
      });
    } catch (err) {
      console.error('Failed to build transmissions summary', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not load summary' });
    }
  }
);

// ============================================================================
// Admin user management routes
// ============================================================================

// GET /api/admin/users
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, username, role, team_id, active, email, employment_start, created_at
      FROM users
      ORDER BY username ASC
    `);
    const users = result.rows.map(mapDbUser);
    return res.json({ ok: true, users });
  } catch (err) {
    console.error('Failed to list users', err);
    return res.status(500).json({ ok: false, error: 'Could not load users' });
  }
});

// POST /api/admin/users
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role, teamId, email } = req.body || {};

  if (!username || !password || !role) {
    return res
      .status(400)
      .json({ ok: false, error: 'Missing required fields' });
  }

  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'Invalid role' });
  }

  try {
    const existing = await db.query(
      'SELECT id FROM users WHERE username = $1 LIMIT 1',
      [username]
    );

    if (existing.rows.length > 0) {
      return res
        .status(409)
        .json({ ok: false, error: 'Username already exists' });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const id = `u-${crypto.randomBytes(8).toString('hex')}`;

    await db.query(
      `
      INSERT INTO users (id, username, password_hash, role, team_id, email, active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
    `,
      [id, username, passwordHash, role, teamId || null, email || null]
    );

    const user = await findUserById(id);
    return res.json({ ok: true, user });
  } catch (err) {
    console.error('Failed to create user', err);
    return res.status(500).json({ ok: false, error: 'Could not create user' });
  }
});

// PATCH /api/admin/users/:id
app.patch(
  '/api/admin/users/:id',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const {
      email,
      role,
      teamId,
      employmentStart,
      birthYear,
      isNonSmoker,
      isKader,
    } = req.body || {};

    try {
      const result = await db.query(
        `
      UPDATE users
      SET
        email = COALESCE($2, email),
        role = COALESCE($3, role),
        team_id = COALESCE($4, team_id),
        employment_start = COALESCE($5, employment_start),
        birth_year = COALESCE($6, birth_year),
        is_non_smoker = COALESCE($7, is_non_smoker),
        is_kader = COALESCE($8, is_kader),
        updated_at = NOW()
        WHERE id = $1
        RETURNING id, username, role, team_id, active, email, employment_start,
                  birth_year, is_non_smoker, is_kader
    `,
        [
          id,
          email || null,
          role || null,
          teamId || null,
          employmentStart || null,
          birthYear ? Number(birthYear) : null,
          isNonSmoker != null ? !!isNonSmoker : null,
          isKader != null ? !!isKader : null,
        ]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ ok: false, error: 'User not found' });
      }

      // Ferientage automatisch aktualisieren
      const updated = mapDbUser(result.rows[0]);
      const newVacDays = computeVacationDaysPerYear(
        updated.birthYear,
        updated.isNonSmoker,
        updated.isKader
      );
      await db.query(
        `UPDATE konten SET vacation_days_per_year = $1 WHERE user_id = $2`,
        [newVacDays, id]
      );

      return res.json({ ok: true, user: updated });
    } catch (err) {
      console.error('Failed to update user', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not update user' });
    }
  }
);

// POST /api/admin/users/:id/reset-password
app.post(
  '/api/admin/users/:id/reset-password',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { password } = req.body || {};

    if (!password || password.length < 6) {
      return res
        .status(400)
        .json({ ok: false, error: 'Password must be at least 6 characters' });
    }

    try {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });

      const result = await db.query(
        `
      UPDATE users
      SET password_hash = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
        [id, passwordHash]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ ok: false, error: 'User not found' });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to reset password', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not reset password' });
    }
  }
);

// POST /api/admin/users/:id/deactivate — löscht User und alle Daten
app.post(
  '/api/admin/users/:id/deactivate',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;

    if (id === req.user.id) {
      return res
        .status(400)
        .json({ ok: false, error: 'Eigenen Account kann man nicht löschen' });
    }

    try {
      await db.query(`DELETE FROM users WHERE id = $1`, [id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete user', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not delete user' });
    }
  }
);

// POST /api/admin/users/:id/activate
app.post(
  '/api/admin/users/:id/activate',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;

    try {
      await db.query(
        `UPDATE users SET active = TRUE, updated_at = NOW() WHERE id = $1`,
        [id]
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to activate user', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not activate user' });
    }
  }
);

// POST /api/dino-score
app.post('/api/dino-score', requireAuth, async (req, res) => {
  const score = Math.round(Number(req.body?.score) || 0);
  if (score <= 0) return res.json({ ok: true });
  try {
    await db.query(
      `INSERT INTO dino_scores (user_id, username, score)
       VALUES ($1, $2, $3)`,
      [req.user.id, req.user.username, score]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
});

// GET /api/dino-scores/top
app.get('/api/dino-scores/top', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT ON (username) username, score, created_at
      FROM dino_scores
      ORDER BY username, score DESC
    `);
    const top3 = result.rows
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => ({ username: r.username, score: r.score }));
    return res.json({ ok: true, scores: top3 });
  } catch (err) {
    return res.status(500).json({ ok: false, scores: [] });
  }
});

registerCronJobs(db, {
  autoTransmitForUser,
  autoLockPreviousWeek,
  listUsersFromDb,
});

// ============================================================================
// Server startup
// ============================================================================
async function startServer() {
  await initializeDatabase(db, INITIAL_USERS);

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

// ============================================================================
// Email-Warnung: nicht ausgestempelt um 18:00
// ============================================================================

startServer().catch((err) => {
  console.error('Server startup failed', err);
  process.exit(1);
});
