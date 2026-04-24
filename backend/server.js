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
  getISOWeekInfo,
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
// Shared date, number and month-overview helpers
// ============================================================================
// These utilities are used across admin views, month summaries and payroll logic.

async function computeMonthUeZ1AndVorarbeit(
  payload,
  year,
  monthIndex,
  userId,
  vorarbeitBalanceIn,
  vorarbeitRequired
) {
  const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
  const daysObj =
    payload?.days && typeof payload.days === 'object' ? payload.days : {};

  const monthStartKey = formatDateKey(new Date(year, monthIndex, 1));
  const monthEndKey = formatDateKey(new Date(year, monthIndex + 1, 0));
  const acceptedAbsenceDays = buildAcceptedAbsenceHoursMap(
    payload?.absences,
    monthStartKey,
    monthEndKey
  );

  const cachedEmpStartKey = await fetchEmpStartKey(userId);
  let ueZ1 = 0;
  let vorarbeit = vorarbeitBalanceIn;

  const cursor = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  while (cursor <= end) {
    const dateKey = formatDateKey(cursor);
    const weekday = cursor.getDay();
    cursor.setDate(cursor.getDate() + 1);

    if (weekday === 0 || weekday === 6) continue;

    const { soll, employmentPct } = await getDailySoll(
      userId,
      dateKey,
      acceptedAbsenceDays,
      cachedEmpStartKey
    );
    if (soll === 0) continue;

    const dayData = daysObj[dateKey] || null;
    const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
    const isFerien = !!dayData?.flags?.ferien;

    const absHoursForDay =
      typeof acceptedAbsenceDays.get(dateKey) === 'number'
        ? acceptedAbsenceDays.get(dateKey)
        : 0;
    const baseSoll = soll + absHoursForDay;

    let diff = 0;
    if (isFerien) {
      diff = dayTotal > soll ? dayTotal - soll : 0;
    } else if (dayTotal > baseSoll) {
      diff = dayTotal - baseSoll;
    } else {
      diff = Math.min(dayTotal + absHoursForDay, baseSoll) - baseSoll;
    }

    if (diff <= 0) {
      // Minus geht komplett in ÜZ1, Vorarbeit unberührt
      ueZ1 += diff;
    } else {
      // Positiv: erste 0.5h × Pensum → Vorarbeit, Rest → ÜZ1
      const schwelle = r1(0.5 * (employmentPct / 100));
      const inVorarbeit = Math.min(diff, schwelle);
      const inUeZ1 = r1(diff - inVorarbeit);

      if (vorarbeit < vorarbeitRequired) {
        const actualInVorarbeit = r1(
          Math.min(inVorarbeit, vorarbeitRequired - vorarbeit)
        );
        const leftover = r1(inVorarbeit - actualInVorarbeit);
        vorarbeit = r1(vorarbeit + actualInVorarbeit);
        ueZ1 += leftover;
      } else {
        ueZ1 += inVorarbeit;
      }
      ueZ1 += inUeZ1;
    }
  }

  return {
    ueZ1: r1(ueZ1),
    vorarbeitBalance: r1(vorarbeit),
  };
}

// Identisch mit computeMonthUeZ1AndVorarbeit aber für beliebige Date-Ranges.
// Wird für Lohnperioden gebraucht die nicht auf Monatsgrenzen fallen.
async function computeRangeUeZ1AndVorarbeit(
  submission,
  fromKey,
  toKey,
  userId,
  vorarbeitBalanceIn,
  vorarbeitRequired
) {
  const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
  const daysObj =
    submission?.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  // Absenzen nur im geclippten Bereich
  const acceptedAbsenceDays = buildAcceptedAbsenceHoursMap(
    submission?.absences,
    fromKey,
    toKey
  );

  const cachedEmpStartKey = await fetchEmpStartKey(userId);
  let ueZ1 = 0;
  let ueZ1Raw = 0;
  let vorarbeit = vorarbeitBalanceIn;

  const cursor = new Date(fromKey + 'T00:00:00');
  const end = new Date(toKey + 'T00:00:00');

  while (cursor <= end) {
    const dateKey = formatDateKey(cursor);
    const weekday = cursor.getDay();
    cursor.setDate(cursor.getDate() + 1);

    if (weekday === 0 || weekday === 6) continue;

    const { soll, employmentPct } = await getDailySoll(
      userId,
      dateKey,
      acceptedAbsenceDays,
      cachedEmpStartKey
    );
    if (soll === 0) continue;

    const dayData = daysObj[dateKey] || null;
    const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
    const isFerien = !!dayData?.flags?.ferien;

    const absHoursForDay =
      typeof acceptedAbsenceDays.get(dateKey) === 'number'
        ? acceptedAbsenceDays.get(dateKey)
        : 0;
    const baseSoll = soll + absHoursForDay;

    let diff = 0;
    if (isFerien) {
      diff = dayTotal > soll ? dayTotal - soll : 0;
    } else if (dayTotal > baseSoll) {
      diff = dayTotal - baseSoll;
    } else {
      diff = Math.min(dayTotal + absHoursForDay, baseSoll) - baseSoll;
    }

    ueZ1Raw += diff;

    if (diff <= 0) {
      ueZ1 += diff;
    } else {
      const schwelle = r1(0.5 * (employmentPct / 100));
      const inVorarbeit = Math.min(diff, schwelle);
      const inUeZ1 = r1(diff - inVorarbeit);

      if (vorarbeit < vorarbeitRequired) {
        const actual = r1(Math.min(inVorarbeit, vorarbeitRequired - vorarbeit));
        ueZ1 += r1(inVorarbeit - actual);
        vorarbeit = r1(vorarbeit + actual);
      } else {
        ueZ1 += inVorarbeit;
      }
      ueZ1 += inUeZ1;
    }
  }

  return {
    ueZ1Raw: r1(ueZ1Raw),
    ueZ1Net: r1(ueZ1),
    vorarbeitBalance: r1(vorarbeit),
  };
}

async function computePayrollPeriodOvertimeFromSubmission(
  submission,
  fromKey,
  toKey,
  userId
) {
  const daysObj =
    submission?.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  const cachedEmpStartKey = await fetchEmpStartKey(userId);
  let ueZ1Raw = 0;
  let ueZ1Positive = 0;
  let ueZ2 = 0;
  let ueZ3 = 0;

  // Absenzen aus Submission
  const acceptedAbsenceDays = buildAcceptedAbsenceHoursMap(
    submission?.absences,
    fromKey,
    toKey
  );

  // Alle Werktage im Zeitraum
  const cursor = new Date(fromKey + 'T00:00:00');
  const end = new Date(toKey + 'T00:00:00');

  while (cursor <= end) {
    const dateKey = formatDateKey(cursor);
    const weekday = cursor.getDay();
    cursor.setDate(cursor.getDate() + 1);

    if (weekday === 0 || weekday === 6) continue;

    const { soll, employmentPct } = await getDailySoll(
      userId,
      dateKey,
      acceptedAbsenceDays,
      cachedEmpStartKey
    );
    if (soll === 0) continue;

    const dayData = daysObj[dateKey] || null;
    const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
    const isFerien = !!dayData?.flags?.ferien;

    const absHoursForDay =
      typeof acceptedAbsenceDays.get(dateKey) === 'number'
        ? acceptedAbsenceDays.get(dateKey)
        : 0;
    const baseSoll = soll + absHoursForDay;

    let diff = 0;
    if (isFerien) {
      diff = dayTotal > soll ? dayTotal - soll : 0;
    } else if (dayTotal > baseSoll) {
      diff = dayTotal - baseSoll;
    } else {
      diff = Math.min(dayTotal + absHoursForDay, baseSoll) - baseSoll;
    }

    ueZ1Raw += diff;
    if (diff > 0) ueZ1Positive += diff;
  }

  // Pikett
  const pikettList = Array.isArray(submission?.pikett) ? submission.pikett : [];
  for (const entry of pikettList) {
    const dateKey = String(entry?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    if (dateKey < fromKey || dateKey > toKey) continue;
    const h = toNumber(entry?.hours);
    if (entry?.isOvertime3) ueZ3 += h;
    else ueZ2 += h;
  }

  const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
  return {
    ueZ1Raw: r1(ueZ1Raw),
    ueZ1Positive: r1(ueZ1Positive),
    ueZ2: r1(ueZ2),
    ueZ3: r1(ueZ3),
  };
}

/**
 * Build month overview from a saved submission file.
 * Missing rule (matches your dashboard):
 * weekday is missing if totalHours==0 AND ferien==false AND no accepted absence on that day
 */
function buildMonthOverviewFromSubmission(
  submission,
  year,
  monthIndex,
  acceptedAbsenceDaysOverride
) {
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  const monthStartKey = formatDateKey(monthStart);
  const monthEndKey = formatDateKey(monthEnd);

  const daysObj =
    submission && submission.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  const pikettByDate = buildPikettHoursByDate(submission?.pikett);

  const acceptedAbsenceDays =
    acceptedAbsenceDaysOverride instanceof Set
      ? acceptedAbsenceDaysOverride
      : buildAcceptedAbsenceHoursMap(
          submission?.absences,
          monthStartKey,
          monthEndKey
        );

  let monthTotalHours = 0;

  // weekKey -> aggregate
  const weekMap = new Map();

  const cursor = new Date(monthStart);
  while (cursor <= monthEnd) {
    const dateKey = formatDateKey(cursor);
    const weekday = cursor.getDay(); // 0=So..6=Sa

    const dayData = daysObj[dateKey] || null;
    const ferien = !!(dayData && dayData.flags && dayData.flags.ferien);

    const nonPikett = computeNonPikettHours(dayData);
    const pikett = pikettByDate.get(dateKey) || 0;
    const totalHours = nonPikett + pikett;
    const stampHours =
      Array.isArray(dayData?.stamps) && dayData.stamps.length > 0
        ? computeNetWorkingHoursFromStamps(dayData.stamps)
        : null;

    const hoursForTotal =
      stampHours !== null ? stampHours + pikett : totalHours;
    monthTotalHours += hoursForTotal;

    const hasAcceptedAbsence = acceptedAbsenceDays.has(dateKey);

    let status = 'missing';

    const hasStamps =
      Array.isArray(dayData?.stamps) && dayData.stamps.length > 0;
    if (ferien) status = 'ferien';
    else if (hasAcceptedAbsence) status = 'absence';
    else if (totalHours > 0 || hasStamps) status = 'ok';
    else status = 'missing';

    const { week, year: weekYear } = getISOWeekInfo(cursor);
    const weekKey = `${weekYear}-W${week}`;

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, {
        week,
        weekYear,
        minDate: null,
        maxDate: null,
        workDaysInMonth: 0,
        missingCount: 0,
        weekTotalHours: 0,
        weekStampHours: 0,
        days: [], // weekdays only for UI list
      });
    }

    const w = weekMap.get(weekKey);

    // min/max date (within the month)
    if (!w.minDate || cursor < w.minDate) w.minDate = new Date(cursor);
    if (!w.maxDate || cursor > w.maxDate) w.maxDate = new Date(cursor);

    // week total includes ALL days (also weekends)
    w.weekTotalHours += totalHours;

    if (stampHours !== null)
      w.weekStampHours = (w.weekStampHours || 0) + stampHours;

    // UI wants weekdays list only
    if (weekday >= 1 && weekday <= 5) {
      w.workDaysInMonth += 1;
      if (status === 'missing') w.missingCount += 1;

      // Kommissionsstunden = Summe aller entries.hours (nur für Montage-Check relevant)
      w.days.push({
        dateKey,
        weekday,
        totalHours,
        stampHours,
        distributedHours: Math.round(nonPikett * 10) / 10,
        status,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  // sort weeks by (weekYear, week)
  const weeks = Array.from(weekMap.values()).sort((a, b) => {
    if (a.weekYear !== b.weekYear) return a.weekYear - b.weekYear;
    return a.week - b.week;
  });

  // convert min/max to dateKey
  const outWeeks = weeks.map((w) => ({
    week: w.week,
    weekYear: w.weekYear,
    minDateKey: w.minDate ? formatDateKey(w.minDate) : null,
    maxDateKey: w.maxDate ? formatDateKey(w.maxDate) : null,
    workDaysInMonth: w.workDaysInMonth,
    missingCount: w.missingCount,
    weekTotalHours: w.weekTotalHours,
    weekStampHours: w.weekStampHours || null,
    days: w.days,
  }));

  return {
    monthStartKey,
    monthEndKey,
    monthTotalHours,
    weeks: outWeeks,
  };
}

// ============================================================================
// Authentication routes
// ============================================================================

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

// ---- Week locks (persistent) ----
// Stored globally, keyed by username -> weekKey -> { locked:true, lockedAt, lockedBy }
// ----------------------------------------------------------------------------
// Week locks, date ranges and payroll-period helpers
// ----------------------------------------------------------------------------

// Core payroll aggregation for one transmitted submission inside a selected period.
function aggregatePayrollFromSubmission(
  submission,
  fromKey,
  toKey,
  absencesById
) {
  const result = {
    praesenzStunden: 0,
    morgenessenCount: 0,
    mittagessenCount: 0,
    abendessenCount: 0,
    schmutzzulageCount: 0,
    nebenauslagenCount: 0,
    pikettHours: 0,
    ueZ3Hours: 0,
    ferienDays: 0,
    stunden: 0,
    arztKrankHours: 0,
  };

  const daysObj =
    submission?.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  for (const [dateKey, dayData] of Object.entries(daysObj)) {
    if (!isDateKeyInClosedRange(dateKey, fromKey, toKey)) continue;
    if (!dayData || typeof dayData !== 'object') continue;

    // Präsenzstunden aus Stamps
    if (Array.isArray(dayData.stamps) && dayData.stamps.length > 0) {
      result.praesenzStunden += computeNetWorkingHoursFromStamps(
        dayData.stamps
      );
    }

    // Mahlzeiten
    const meal = dayData.mealAllowance || {};
    if (meal['1']) result.morgenessenCount += 1;
    if (meal['2']) result.mittagessenCount += 1;
    if (meal['3']) result.abendessenCount += 1;

    // Zulagen
    const flags = dayData.flags || {};
    if (flags.schmutzzulage) result.schmutzzulageCount += 1;
    if (flags.nebenauslagen) result.nebenauslagenCount += 1;
  }

  // Pikett ÜZ2 + ÜZ3
  const pikettList = Array.isArray(submission?.pikett) ? submission.pikett : [];
  for (const entry of pikettList) {
    const dateKey = String(entry?.date || '').slice(0, 10);
    if (!isDateKeyInClosedRange(dateKey, fromKey, toKey)) continue;
    const h = toNumber(entry?.hours);
    if (entry?.isOvertime3) result.ueZ3Hours += h;
    else result.pikettHours += h;
  }

  // Absenzen aus Submission für absencesById sammeln (unverändert)
  const absences = Array.isArray(submission?.absences)
    ? submission.absences
    : [];
  for (const abs of absences) {
    const id = abs?.id
      ? String(abs.id)
      : [
          String(abs?.type || ''),
          String(abs?.from || ''),
          String(abs?.to || ''),
          String(abs?.comment || ''),
        ].join('|');
    if (!absencesById.has(id)) absencesById.set(id, abs);
  }

  result.praesenzStunden = round1(result.praesenzStunden);
  result.pikettHours = round1(result.pikettHours);
  result.ueZ3Hours = round1(result.ueZ3Hours);

  return result;
}

// Preserve already-locked day payloads during retransmission of the same month.
function mergeLockedWeeksPayload(
  newPayload,
  previousSubmission,
  lockedDateKeys
) {
  const merged = { ...newPayload };

  // 1) days: locked dates are taken from previous submission (or removed if absent)
  const newDays =
    merged.days && typeof merged.days === 'object' ? { ...merged.days } : {};
  const oldDays =
    previousSubmission &&
    previousSubmission.days &&
    typeof previousSubmission.days === 'object'
      ? previousSubmission.days
      : {};

  lockedDateKeys.forEach((dk) => {
    if (Object.prototype.hasOwnProperty.call(oldDays, dk)) {
      newDays[dk] = oldDays[dk];
    } else {
      delete newDays[dk];
    }
  });

  merged.days = newDays;

  // 2) pikett: locked dates are taken from previous submission
  const newPikett = Array.isArray(merged.pikett) ? merged.pikett : [];
  const oldPikett = Array.isArray(previousSubmission?.pikett)
    ? previousSubmission.pikett
    : [];

  merged.pikett = [
    ...newPikett.filter((p) => p && p.date && !lockedDateKeys.has(p.date)),
    ...oldPikett.filter((p) => p && p.date && lockedDateKeys.has(p.date)),
  ];

  // 3) absences: if an absence overlaps locked dates, keep the previous version
  const newAbs = Array.isArray(merged.absences) ? merged.absences : [];
  const oldAbs = Array.isArray(previousSubmission?.absences)
    ? previousSubmission.absences
    : [];

  const keptNew = newAbs.filter(
    (a) => !absenceOverlapsLockedDates(a, lockedDateKeys)
  );
  const keptOld = oldAbs.filter((a) =>
    absenceOverlapsLockedDates(a, lockedDateKeys)
  );

  // de-dupe by id (old should override for locked overlaps)
  const byId = new Map();
  keptNew.forEach((a) => {
    const id = a && a.id ? String(a.id) : null;
    if (id) byId.set(id, a);
  });
  keptOld.forEach((a) => {
    const id = a && a.id ? String(a.id) : null;
    if (id) byId.set(id, a);
  });

  // include id-less entries (rare) at the end
  const idless = [...keptNew, ...keptOld].filter((a) => !(a && a.id));

  merged.absences = [...byId.values(), ...idless];

  return merged;
}

// Auto-Transmit 00:00
async function autoTransmitForUser(user) {
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();

  // Draft laden
  const draftResult = await db.query(
    'SELECT data FROM user_drafts WHERE user_id = $1',
    [user.id]
  );

  if (draftResult.rows.length === 0) {
    console.log(
      `[AutoTransmit] Kein Draft für ${user.username}, übersprungen.`
    );
    return;
  }

  const draft = draftResult.rows[0].data;

  // Nur aktuellen Monat aus Draft nehmen
  const daysObj = draft.dayStore || {};
  const monthDays = {};
  Object.entries(daysObj).forEach(([dateKey, dayData]) => {
    const d = new Date(dateKey + 'T00:00:00');
    if (d.getFullYear() === year && d.getMonth() === monthIndex) {
      monthDays[dateKey] = dayData;
    }
  });

  // Pikett filtern — nur gespeicherte Einträge des aktuellen Monats
  const pikettStore = Array.isArray(draft.pikettStore) ? draft.pikettStore : [];
  const monthPikett = pikettStore.filter((p) => {
    if (!p.date || !p.saved) return false;
    const d = new Date(p.date + 'T00:00:00');
    return d.getFullYear() === year && d.getMonth() === monthIndex;
  });

  // Absenzen aus DB laden
  const absenceResult = await db.query(
    `SELECT * FROM absences WHERE user_id = $1`,
    [user.id]
  );
  const userAbsences = absenceResult.rows.map((row) => ({
    id: row.id,
    type: row.type,
    from: String(row.from_date).slice(0, 10),
    to: String(row.to_date).slice(0, 10),
    days: row.days,
    hours: row.hours == null ? null : Number(row.hours),
    status: row.status,
    comment: row.comment || '',
  }));

  const payload = {
    year,
    monthIndex,
    monthLabel: makeMonthLabel(year, monthIndex),
    days: monthDays,
    pikett: monthPikett,
    absences: userAbsences,
    stampEditLog: [],
  };

  // Locks prüfen
  const allLocks = await readWeekLocksFromDb();
  const userLocks = allLocks[user.username] || {};
  const { lockedDateKeys, lockedWeekKeys } = collectLockedDatesForMonth(
    userLocks,
    year,
    monthIndex
  );

  let payloadToSave = payload;

  if (lockedDateKeys.size > 0) {
    const prev = await loadLatestMonthSubmission(
      user.username,
      year,
      monthIndex
    );
    if (prev) {
      payloadToSave = mergeLockedWeeksPayload(payload, prev, lockedDateKeys);
      payloadToSave._lockInfo = {
        preservedWeekKeys: Array.from(lockedWeekKeys),
        preservedDaysCount: lockedDateKeys.size,
      };
    }
  }

  const totals = computeTransmissionTotals(payloadToSave);

  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const monthStr = String(monthIndex + 1).padStart(2, '0');
  const fileName = `${year}-${monthStr}-${timestamp}-auto.json`;

  const submission = {
    ...payloadToSave,
    userId: user.username,
    teamId: user.teamId || null,
    receivedAt: now.toISOString(),
    totals,
    autoTransmit: true,
  };

  const serialized = JSON.stringify(submission, null, 2);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');

  await insertMonthSubmission({
    id: fileName,
    userId: user.id,
    username: user.username,
    teamId: user.teamId || null,
    year,
    monthIndex,
    monthLabel: payload.monthLabel,
    sentAt: now.toISOString(),
    receivedAt: now.toISOString(),
    sizeBytes,
    totals,
    payload: submission,
  });

  console.log(
    `[AutoTransmit] ${user.username} — ${payload.monthLabel} erfolgreich übertragen.`
  );
}

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
      const user = await findUserByUsername(username);

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

// GET /api/admin/audit-pdf — Präsenz Audit PDF (letzte 5 Jahre, alle Mitarbeiter)
app.get('/api/admin/audit-pdf', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), 1);

    // Alle User laden
    const usersResult = await db.query(`
      SELECT id, username, team_id FROM users
      WHERE active = TRUE AND role = 'user'
      ORDER BY username ASC
    `);
    const users = usersResult.rows;

    // Alle Submissions der letzten 5 Jahre laden
    const subResult = await db.query(
      `
      SELECT DISTINCT ON (username, year, month_index)
        username, year, month_index, payload
      FROM month_submissions
      WHERE sent_at >= $1
      ORDER BY username ASC, year ASC, month_index ASC, sent_at DESC
    `,
      [fiveYearsAgo.toISOString()]
    );

    // Submissions nach User gruppieren
    const byUser = {};
    users.forEach((u) => {
      byUser[u.username] = { teamId: u.team_id, submissions: [] };
    });
    subResult.rows.forEach((r) => {
      if (byUser[r.username]) {
        byUser[r.username].submissions.push({
          year: r.year,
          monthIndex: r.month_index,
          payload: r.payload,
        });
      }
    });

    // PDF erstellen
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Praesenz-Audit_${now.toISOString().slice(0, 10)}.pdf"`
    );

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      autoFirstPage: true,
    });
    doc.pipe(res);

    const TEAM_MAP = Object.fromEntries(TEAMS.map((t) => [t.id, t.name]));

    // ── Deckblatt ──
    doc
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('Präsenz Audit', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(12)
      .font('Helvetica')
      .text(
        `Zeitraum: ${fiveYearsAgo.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })} – ${now.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })}`,
        { align: 'center' }
      );
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .fillColor('#6B7280')
      .text(`Exportiert am: ${now.toLocaleString('de-CH')} · Norm Aufzüge`, {
        align: 'center',
      });
    doc.moveDown(2);

    // ── Inhaltsverzeichnis ──
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1e293b')
      .text('Mitarbeiter');
    doc.moveDown(0.5);
    users.forEach((u) => {
      const team = TEAM_MAP[u.team_id] || u.team_id || '–';
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#374151')
        .text(`• ${u.username}  (${team})`);
    });

    // ── Pro Mitarbeiter ──
    Object.entries(byUser).forEach(([username, { teamId, submissions }]) => {
      doc.addPage();
      const teamName = TEAM_MAP[teamId] || teamId || '–';

      // User Header
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor('#1e293b')
        .text(username, { underline: false });
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#6B7280')
        .text(`Team: ${teamName}`);
      doc.moveDown(0.8);

      if (submissions.length === 0) {
        doc
          .fontSize(10)
          .fillColor('#94a3b8')
          .text('Keine übertragenen Daten im Zeitraum.');
        return;
      }

      submissions.forEach((sub) => {
        const monthLabel = new Date(
          sub.year,
          sub.monthIndex,
          1
        ).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });

        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .fillColor('#334155')
          .text(monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1));
        doc.moveDown(0.3);

        const daysObj = sub.payload?.days || {};
        const sortedDays = Object.keys(daysObj).sort();

        let hasAnyStamp = false;

        sortedDays.forEach((dateKey) => {
          const dayData = daysObj[dateKey];
          const stamps = Array.isArray(dayData?.stamps) ? dayData.stamps : [];
          if (stamps.length === 0) return;

          hasAnyStamp = true;

          // Datum
          const d = new Date(dateKey + 'T00:00:00');
          const dateLabel = d.toLocaleDateString('de-CH', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });

          // Netto-Stunden berechnen
          const sorted = [...stamps].sort((a, b) =>
            a.time.localeCompare(b.time)
          );
          let totalMin = 0,
            lastIn = null;
          sorted.forEach((s) => {
            const [hh, mm] = s.time.split(':').map(Number);
            const mins = hh * 60 + mm;
            if (s.type === 'in') lastIn = mins;
            else if (s.type === 'out' && lastIn !== null) {
              totalMin += mins - lastIn;
              lastIn = null;
            }
          });
          const netHours =
            totalMin > 0
              ? `${Math.floor(totalMin / 60)}h ${totalMin % 60 > 0 ? (totalMin % 60) + 'm' : ''}`.trim()
              : '–';

          // Stempel-Zeilen
          // Stempel als Ein/Aus-Paare: 07:00–12:00  |  13:00–17:00
          const pairs = [];
          for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i].type === 'in' && sorted[i + 1].type === 'out') {
              pairs.push(`${sorted[i].time}–${sorted[i + 1].time}`);
              i++;
            }
          }
          // Tag überspringen wenn letzter Stempel ein offenes 'in' ist
          // (passiert wenn Monat übertragen wurde während jemand eingestempelt war)
          if (
            sorted.length % 2 !== 0 &&
            sorted[sorted.length - 1].type === 'in'
          ) {
            return;
          }
          const stampStr = pairs.join('   |   ');

          doc
            .fontSize(9)
            .font('Helvetica')
            .fillColor('#374151')
            .text(`${dateLabel}    ${stampStr}    Netto: ${netHours}`);
        });

        if (!hasAnyStamp) {
          doc
            .fontSize(9)
            .fillColor('#94a3b8')
            .text('Keine Stempel in diesem Monat.');
        }

        doc.moveDown(0.8);
      });
    });

    doc.end();
  } catch (err) {
    console.error('Audit PDF error', err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ ok: false, error: 'PDF konnte nicht erstellt werden' });
    }
  }
});

// ---- Month transmission routes ----

// Receive monthly transmission (protected)
// ============================================================================
// User month transmission routes
// ============================================================================
// The transmission endpoint is the authoritative handoff from local draft data
// to server-stored month snapshots that admin/payroll features can safely consume.
app.post('/api/transmit-month', requireAuth, async (req, res) => {
  const payload = req.body;

  console.log('Received monthly transmission from', req.user.username);
  console.log(JSON.stringify(payload, null, 2));

  if (
    typeof payload.year !== 'number' ||
    typeof payload.monthIndex !== 'number' ||
    typeof payload.monthLabel !== 'string'
  ) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const userId = req.user.username;
  let payloadToSave = payload;

  let previousMonthSubmission = null;
  try {
    previousMonthSubmission = await loadLatestMonthSubmission(
      userId,
      payload.year,
      payload.monthIndex
    );
  } catch (e) {
    console.error(
      'Failed to load previous month submission (continuing as first transmission):',
      e
    );
    previousMonthSubmission = null;
  }

  let allLocks;
  try {
    allLocks = await readWeekLocksFromDb();
  } catch (e) {
    console.error('Failed to read week locks from Postgres:', e);
    return res.status(500).json({
      ok: false,
      error: 'Lock data unreadable. Please contact admin.',
    });
  }

  try {
    const userLocks =
      allLocks[userId] && typeof allLocks[userId] === 'object'
        ? allLocks[userId]
        : {};

    const { lockedDateKeys, lockedWeekKeys } = collectLockedDatesForMonth(
      userLocks,
      payload.year,
      payload.monthIndex
    );

    if (lockedDateKeys.size > 0 && previousMonthSubmission) {
      payloadToSave = mergeLockedWeeksPayload(
        payload,
        previousMonthSubmission,
        lockedDateKeys
      );

      payloadToSave._lockInfo = {
        preservedWeekKeys: Array.from(lockedWeekKeys),
        preservedDaysCount: lockedDateKeys.size,
      };
    }
  } catch (e) {
    console.error('Lock enforcement failed:', e);
    return res.status(500).json({
      ok: false,
      error: 'Could not enforce locks. Submission rejected.',
    });
  }

  const monthNumber = payload.monthIndex + 1;
  const monthStr = String(monthNumber).padStart(2, '0');
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const fileName = `${payload.year}-${monthStr}-${timestamp}.json`;

  const totals = computeTransmissionTotals(payloadToSave);

  const submission = {
    ...payloadToSave,
    userId,
    teamId: req.user.teamId || null,
    receivedAt: now.toISOString(),
    totals,
  };

  const serializedSubmission = JSON.stringify(submission, null, 2);
  const sizeBytes = Buffer.byteLength(serializedSubmission, 'utf8');

  try {
    await insertMonthSubmission({
      id: fileName,
      userId: req.user.id,
      username: req.user.username,
      teamId: req.user.teamId || null,
      year: payload.year,
      monthIndex: payload.monthIndex,
      monthLabel: payload.monthLabel,
      sentAt: now.toISOString(),
      receivedAt: now.toISOString(),
      sizeBytes,
      totals,
      payload: submission,
    });
  } catch (err) {
    console.error('Failed to save submission in Postgres:', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Could not save data on server' });
  }

  // Stamp Edit-Log aus Payload extrahieren und persistieren
  try {
    const editLog = Array.isArray(payload.stampEditLog)
      ? payload.stampEditLog
      : [];
    if (editLog.length > 0) {
      for (const edit of editLog) {
        await db.query(
          `
        INSERT INTO stamp_edits
          (user_id, username, date_key, action, old_time, new_time,
           old_type, new_type, year, month_index)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
          [
            req.user.id,
            req.user.username,
            edit.dateKey,
            edit.action,
            edit.oldTime || null,
            edit.newTime || null,
            edit.oldType || null,
            edit.newType || null,
            payload.year,
            payload.monthIndex,
          ]
        );
      }
    }
  } catch (err) {
    console.error('Failed to save stamp edit log:', err);
    // nicht fatal — Transmission trotzdem erfolgreich
  }

  const strictTeamId = String(req.user.teamId || '');
  const strictUsername = req.user.username;
  const strictYear = payload.year;
  const strictMonthIndex = payload.monthIndex;

  const anlagenIndexBackup = deepCloneJson(await readAnlagenIndex(db));
  const anlagenLedgerBackup = deepCloneJson(await readAnlagenLedger(db));
  const anlagenMonthSnapshotBackup = deepCloneJson(
    await readAnlagenSnapshot(db, strictUsername, strictYear, strictMonthIndex)
  );

  try {
    if (strictTeamId) {
      const oldSnap = await readAnlagenSnapshot(
        db,
        strictUsername,
        strictYear,
        strictMonthIndex
      );

      const newSnap = extractAnlagenSnapshotFromPayload(
        payloadToSave,
        strictUsername
      );

      const index = await readAnlagenIndex(db);
      const ledger = await readAnlagenLedger(db);

      const touched = new Set([
        ...Object.keys(oldSnap || {}),
        ...Object.keys(newSnap || {}),
      ]);

      if (oldSnap) {
        applySnapshotToIndexAndLedger({
          index,
          ledger,
          teamId: strictTeamId,
          username: strictUsername,
          snap: oldSnap,
          sign: -1,
        });
      }

      applySnapshotToIndexAndLedger({
        index,
        ledger,
        teamId: strictTeamId,
        username: strictUsername,
        snap: newSnap,
        sign: +1,
      });

      recomputeLastActivitiesForTeam(
        index,
        ledger,
        strictTeamId,
        Array.from(touched)
      );

      await writeAnlagenIndex(db, index);
      await writeAnlagenLedger(db, ledger);
      await writeAnlagenSnapshot(
        db,
        strictUsername,
        strictYear,
        strictMonthIndex,
        newSnap,
        strictTeamId || null
      );
    }

    await updateKontenFromSubmission({
      username: strictUsername,
      teamId: req.user.teamId || null,
      year: strictYear,
      monthIndex: strictMonthIndex,
      totals,
      payload: payloadToSave,
      updatedBy: strictUsername,
      computeMonthUeZ1AndVorarbeit,
    });
  } catch (e) {
    console.error(
      'Strict transmission side-effect failed:',
      e.message,
      e.stack
    );

    try {
      await writeAnlagenIndex(db, anlagenIndexBackup);
    } catch (rollbackErr) {
      console.error('Failed to restore anlagenIndex backup:', rollbackErr);
    }

    try {
      await writeAnlagenLedger(db, anlagenLedgerBackup);
    } catch (rollbackErr) {
      console.error('Failed to restore anlagenLedger backup:', rollbackErr);
    }

    try {
      await writeAnlagenSnapshot(
        db,
        strictUsername,
        strictYear,
        strictMonthIndex,
        anlagenMonthSnapshotBackup,
        strictTeamId || null
      );
    } catch (rollbackErr) {
      console.error(
        'Failed to restore anlagen month snapshot backup:',
        rollbackErr
      );
    }

    try {
      await deleteMonthSubmissionById(fileName);
    } catch (rollbackErr) {
      console.error('Failed to roll back month submission row:', rollbackErr);
    }

    return res.status(500).json({
      ok: false,
      error:
        'Übertragung wurde zurückgerollt, weil Konten oder Anlagen nicht konsistent gespeichert werden konnten.',
    });
  }

  return res.json({
    ok: true,
    message: `Month ${payload.monthLabel} received and saved as ${fileName}`,
    submissionId: fileName,
    totals,
    lockInfo: payloadToSave?._lockInfo || null,
    savedPayload: {
      year: payloadToSave.year,
      monthIndex: payloadToSave.monthIndex,
      monthLabel: payloadToSave.monthLabel,
      days: payloadToSave.days || {},
      pikett: payloadToSave.pikett || [],
      absences: payloadToSave.absences || [],
    },
  });
});

// List all transmissions for the logged-in user
app.get('/api/transmissions', requireAuth, async (req, res) => {
  try {
    const transmissions = await listUserTransmissions(req.user.username);

    return res.json({
      ok: true,
      transmissions,
    });
  } catch (err) {
    console.error('Failed to load transmissions:', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Could not load transmissions' });
  }
});

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
      const users = await listUsersFromDb();

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
      const user = await findUserByUsername(username);
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

function getPayrollAbsenceTypeLabel(type) {
  const key = String(type || '')
    .trim()
    .toLowerCase();

  const map = {
    ferien: 'Ferien',
    unfall: 'Unfall',
    militaer: 'Militär',
    bezahlteabwesenheit: 'Bezahlte Abwesenheit',
    vaterschaft: 'Vaterschaftsurlaub',
    sonstiges: 'Sonstiges',
  };

  return (
    map[key] ||
    (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Abwesenheit')
  );
}

function ensurePayrollAuditRow(rowMap, dateKey) {
  if (!rowMap.has(dateKey)) {
    rowMap.set(dateKey, {
      dateKey,
      stunden: 0,
      praesenzStunden: 0,
      ferien: false,
      morgenessen: false,
      mittagessen: false,
      abendessen: false,
      schmutzzulage: false,
      nebenauslagen: false,
      pikettHours: 0,
      overtime3Hours: 0,
      absenceLabels: [],
      stamps: [],
    });
  }
  return rowMap.get(dateKey);
}

// Build one payroll-period card for a single employee using transmitted months only.
async function buildPayrollPeriodDataForUser(user, periodStart, periodEnd) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

  const fromKey = formatDateKey(periodStart);
  const toKey = formatDateKey(periodEnd);
  const monthRange = getMonthRangeBetween(periodStart, periodEnd);

  const absencesById = new Map();
  const auditRowMap = new Map();

  const totals = {
    praesenzStunden: 0,
    morgenessenCount: 0,
    mittagessenCount: 0,
    abendessenCount: 0,
    schmutzzulageCount: 0,
    nebenauslagenCount: 0,
    pikettHours: 0,
    ueZ3Hours: 0,
  };

  const overtime = {
    ueZ1Raw: 0,
    ueZ2: 0,
    ueZ3: 0,
  };

  const selectedYear = periodEnd.getFullYear();
  const yearCfg = getPayrollYearConfig(selectedYear);
  const vorarbeitRequired = Number(yearCfg.vorarbeitRequired) || 0;

  // Vorarbeit-Startsaldo für beliebigen Periodenstart:
  // Letzter Monats-Snapshot vor dem Periodenstart laden, dann den
  // Partial-Monat bis zum Tag vor Periodenstart draufrechnen.
  const dayBeforePeriod = new Date(periodStart);
  dayBeforePeriod.setDate(dayBeforePeriod.getDate() - 1);
  const dayBeforePeriodKey = formatDateKey(dayBeforePeriod);

  const lastSnapRes = await db.query(
    `SELECT year, month_index, vorarbeit_balance FROM konten_snapshots
     WHERE username = $1 AND (year < $2 OR (year = $2 AND month_index < $3))
     ORDER BY year DESC, month_index DESC LIMIT 1`,
    [user.username, periodStart.getFullYear(), periodStart.getMonth()]
  );
  const lastSnap = lastSnapRes.rows[0];
  let vorarbeitBalanceBeforePeriod = r1(
    Number(lastSnap?.vorarbeit_balance) || 0
  );

  // Falls der Periodenstart mitten in einem Monat liegt, den Partial-Monat
  // vom Snapshot bis zum Tag vor Periodenstart nachrechnen
  if (lastSnap) {
    const snapMonthEnd = formatDateKey(
      new Date(lastSnap.year, lastSnap.month_index + 1, 0)
    );
    if (snapMonthEnd < dayBeforePeriodKey) {
      // Es gibt Tage zwischen Snapshot-Ende und Periodenstart → Partial-Monat rechnen
      const partialSub = await loadLatestMonthSubmission(
        user.username,
        periodStart.getFullYear(),
        periodStart.getMonth()
      );
      if (partialSub) {
        const partialMonthStart = formatDateKey(
          new Date(periodStart.getFullYear(), periodStart.getMonth(), 1)
        );
        const { vorarbeitBalance: vb } = await computeRangeUeZ1AndVorarbeit(
          partialSub,
          partialMonthStart,
          dayBeforePeriodKey,
          user.id,
          vorarbeitBalanceBeforePeriod,
          Number(
            getPayrollYearConfig(periodStart.getFullYear()).vorarbeitRequired
          ) || 0
        );
        vorarbeitBalanceBeforePeriod = vb;
      }
    }
  }

  let runningVorarbeit = vorarbeitBalanceBeforePeriod;
  let ueZ1Net = 0;
  let ueZ1RawTotal = 0;

  const transmittedMonths = [];
  const missingMonths = [];

  const submissionCache = new Map();

  for (const month of monthRange) {
    const submission = await loadLatestMonthSubmission(
      user.username,
      month.year,
      month.monthIndex
    );

    if (!submission) {
      missingMonths.push(month.monthKey);
      continue;
    }

    transmittedMonths.push(month.monthKey);

    submissionCache.set(month.monthKey, submission);

    const partial = aggregatePayrollFromSubmission(
      submission,
      fromKey,
      toKey,
      absencesById
    );

    // Range auf den Monat der Submission clippen, damit Tage ausserhalb
    // des Submissions-Monats nicht als Fehltage gerechnet werden
    const monthStartKey = formatDateKey(
      new Date(month.year, month.monthIndex, 1)
    );
    const monthEndKey = formatDateKey(
      new Date(month.year, month.monthIndex + 1, 0)
    );
    const clippedFrom = fromKey > monthStartKey ? fromKey : monthStartKey;
    const clippedTo = toKey < monthEndKey ? toKey : monthEndKey;

    const partialOvertime = await computePayrollPeriodOvertimeFromSubmission(
      submission,
      clippedFrom,
      clippedTo,
      user.id
    );

    // Exakte Berechnung identisch mit Transmit-Logik
    const {
      ueZ1Raw: rangeRaw,
      ueZ1Net: rangeNet,
      vorarbeitBalance: newVorarbeit,
    } = await computeRangeUeZ1AndVorarbeit(
      submission,
      clippedFrom,
      clippedTo,
      user.id,
      runningVorarbeit,
      Number(getPayrollYearConfig(month.year).vorarbeitRequired) || 0
    );
    ueZ1Net = r1(ueZ1Net + rangeNet);
    ueZ1RawTotal = r1(ueZ1RawTotal + rangeRaw);
    runningVorarbeit = newVorarbeit;

    totals.praesenzStunden += partial.praesenzStunden;
    totals.ueZ3Hours += partial.ueZ3Hours;
    totals.morgenessenCount += partial.morgenessenCount;
    totals.mittagessenCount += partial.mittagessenCount;
    totals.abendessenCount += partial.abendessenCount;
    totals.schmutzzulageCount += partial.schmutzzulageCount;
    totals.nebenauslagenCount += partial.nebenauslagenCount;
    totals.pikettHours += partial.pikettHours;

    overtime.ueZ2 += partialOvertime.ueZ2;
    overtime.ueZ3 += partialOvertime.ueZ3;

    const daysObj =
      submission && submission.days && typeof submission.days === 'object'
        ? submission.days
        : {};

    for (const [dateKey, dayData] of Object.entries(daysObj)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      if (dateKey < fromKey || dateKey > toKey) continue;
      if (!dayData || typeof dayData !== 'object') continue;

      const row = ensurePayrollAuditRow(auditRowMap, dateKey);

      // Präsenzstunden aus Stamps
      if (Array.isArray(dayData.stamps) && dayData.stamps.length > 0) {
        row.praesenzStunden += num(
          computeNetWorkingHoursFromStamps(dayData.stamps)
        );
        // Stamps für PDF-Export speichern
        const sorted = [...dayData.stamps].sort((a, b) =>
          String(a.time || '').localeCompare(String(b.time || ''))
        );
        row.stamps = sorted.map((s) => ({ time: s.time, type: s.type }));
      }

      const meal = dayData.mealAllowance || {};
      if (meal['1']) row.morgenessen = true;
      if (meal['2']) row.mittagessen = true;
      if (meal['3']) row.abendessen = true;

      const flags = dayData.flags || {};
      if (flags.schmutzzulage) row.schmutzzulage = true;
      if (flags.nebenauslagen) row.nebenauslagen = true;
    }

    const pikettList = Array.isArray(submission?.pikett)
      ? submission.pikett
      : [];
    for (const entry of pikettList) {
      const dateKey = String(entry?.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      if (dateKey < fromKey || dateKey > toKey) continue;

      const row = ensurePayrollAuditRow(auditRowMap, dateKey);
      const h = num(entry?.hours);

      if (entry?.isOvertime3) row.overtime3Hours += h;
      else row.pikettHours += h;
    }

    const absences = Array.isArray(submission?.absences)
      ? submission.absences
      : [];
    for (const abs of absences) {
      const id =
        abs && abs.id
          ? String(abs.id)
          : [
              String(abs?.type || '').toLowerCase(),
              String(abs?.from || ''),
              String(abs?.to || ''),
              String(abs?.comment || ''),
            ].join('|');

      if (!absencesById.has(id)) {
        absencesById.set(id, abs);
      }
    }
  }

  for (const abs of absencesById.values()) {
    const type = String(abs?.type || '')
      .trim()
      .toLowerCase();
    const status = String(abs?.status || '')
      .trim()
      .toLowerCase();

    if (type === 'ferien' && status === 'accepted') {
      totals.ferienDays += computeAbsenceDaysInPeriod(
        abs,
        periodStart,
        periodEnd
      );
    }

    if (status !== 'accepted') continue;
    if (!abs?.from || !abs?.to) continue;

    const labelBase = getPayrollAbsenceTypeLabel(abs.type);
    const comment = String(abs.comment || '').trim();
    const label = comment ? `${labelBase} – ${comment}` : labelBase;

    const fromAbs = parseIsoDateOnly(abs.from);
    const toAbs = parseIsoDateOnly(abs.to);
    if (!fromAbs || !toAbs) continue;

    const start = fromAbs <= toAbs ? fromAbs : toAbs;
    const end = fromAbs <= toAbs ? toAbs : fromAbs;

    const overlapStart = start > periodStart ? start : periodStart;
    const overlapEnd = end < periodEnd ? end : periodEnd;

    if (overlapEnd < overlapStart) continue;

    const cursor = new Date(overlapStart);
    while (cursor <= overlapEnd) {
      const dk = formatDateKey(cursor);
      if (isWeekdayDateKey(dk)) {
        const row = ensurePayrollAuditRow(auditRowMap, dk);
        if (!row.absenceLabels.includes(label)) {
          row.absenceLabels.push(label);
        }
        if (type === 'ferien') {
          row.ferien = true;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  totals.stunden = r1(totals.stunden);
  totals.arztKrankHours = r1(totals.arztKrankHours);
  totals.ferienDays = r1(totals.ferienDays);
  totals.pikettHours = r1(totals.pikettHours);

  overtime.ueZ1Raw = r1(ueZ1RawTotal);
  overtime.ueZ2 = r1(overtime.ueZ2);
  overtime.ueZ3 = r1(overtime.ueZ3);

  // Vorarbeit aus laufender Berechnung (exakt identisch mit Transmit)
  const vorarbeitFilledAtPeriodEnd = r1(runningVorarbeit);
  const vorarbeitFilledBeforePeriod = r1(vorarbeitBalanceBeforePeriod);
  // vorarbeitApplied = Differenz zwischen rawDiff und nettem ÜZ1 (immer ≥ 0)
  const vorarbeitAppliedInPeriod = r1(Math.max(0, overtime.ueZ1Raw - ueZ1Net));
  // ÜZ1AfterVorarbeit = nettes ÜZ1 (exakt was ins Konto fliesst)
  const ueZ1AfterVorarbeitInPeriod = r1(ueZ1Net);

  const auditRows = Array.from(auditRowMap.values())
    .map((row) => ({
      dateKey: row.dateKey,
      dateLabel: formatDateDisplayEU(row.dateKey),
      praesenzStunden: r1(row.praesenzStunden),
      ferien: !!row.ferien,
      morgenessen: !!row.morgenessen,
      mittagessen: !!row.mittagessen,
      abendessen: !!row.abendessen,
      schmutzzulage: !!row.schmutzzulage,
      nebenauslagen: !!row.nebenauslagen,
      pikettHours: r1(row.pikettHours),
      overtime3Hours: r1(row.overtime3Hours),
      absenceLabels: row.absenceLabels || [],
      absencesText: (row.absenceLabels || []).join(' | '),
      stamps: row.stamps || [],
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  // Manuelle Korrekturen aus konten laden — damit Lohnabrechnung mit Konten übereinstimmt
  const kontoRes = await db.query(
    `SELECT ue_z1_correction, ue_z2_correction, ue_z3_correction
     FROM konten WHERE username = $1`,
    [user.username]
  );
  const kontoRow = kontoRes.rows[0] || {};
  const ueZ1Correction = r1(Number(kontoRow.ue_z1_correction) || 0);
  const ueZ2Correction = r1(Number(kontoRow.ue_z2_correction) || 0);
  const ueZ3Correction = r1(Number(kontoRow.ue_z3_correction) || 0);

  // Absenzen direkt aus DB laden
  const dbAbsResult = await db.query(
    `
      SELECT type, from_date, to_date, days, hours
      FROM absences
      WHERE username = $1
        AND status = 'accepted'
        AND to_date >= $2
        AND from_date <= $3
      ORDER BY from_date ASC
    `,
    [user.username, fromKey, toKey]
  );

  const absencesByType = {};
  for (const row of dbAbsResult.rows) {
    const type = String(row.type || '').toLowerCase();
    if (!absencesByType[type]) absencesByType[type] = { days: 0, hours: 0 };
    const days = computeAbsenceDaysInPeriod(
      { from: row.from_date, to: row.to_date, days: row.days },
      periodStart,
      periodEnd
    );
    absencesByType[type].days = round1(absencesByType[type].days + days);
    if (row.hours)
      absencesByType[type].hours = round1(
        absencesByType[type].hours + toNumber(row.hours)
      );
  }

  return {
    username: user.username,
    displayName: user.username,
    coverage: {
      expectedMonths: monthRange.map((m) => m.monthKey),
      transmittedMonths,
      missingMonths,
    },
    totals,
    absencesByType,
    overtime: {
      ueZ1Raw: overtime.ueZ1Raw,
      ueZ1Correction,
      ueZ1Total: r1(overtime.ueZ1Raw + ueZ1Correction),
      vorarbeitApplied: vorarbeitAppliedInPeriod,
      ueZ1AfterVorarbeit: ueZ1AfterVorarbeitInPeriod,
      ueZ2: overtime.ueZ2,
      ueZ2Correction,
      ueZ2Total: r1(overtime.ueZ2 + ueZ2Correction),
      ueZ3: overtime.ueZ3,
      ueZ3Correction,
      ueZ3Total: r1(overtime.ueZ3 + ueZ3Correction),
    },
    vorarbeit: {
      year: selectedYear,
      filled: vorarbeitFilledAtPeriodEnd,
      required: vorarbeitRequired,
      changeInPeriod: r1(
        vorarbeitFilledAtPeriodEnd - vorarbeitFilledBeforePeriod
      ),
    },
    teamId: user.teamId || null,
    auditRows,
  };
}

app.get(
  '/api/admin/payroll-period',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const fromRaw = String(req.query?.from || '').slice(0, 10);
    const toRaw = String(req.query?.to || '').slice(0, 10);

    const fromDate = parseIsoDateOnly(fromRaw);
    const toDate = parseIsoDateOnly(toRaw);

    if (!fromDate || !toDate) {
      return res.status(400).json({
        ok: false,
        error: 'Ungültiger Zeitraum. Bitte "von" und "bis" korrekt angeben.',
      });
    }

    const periodStart = fromDate <= toDate ? fromDate : toDate;
    const periodEnd = fromDate <= toDate ? toDate : fromDate;
    const fromKey = formatDateKey(periodStart);
    const toKey = formatDateKey(periodEnd);
    try {
      const users = await listUsersFromDb({
        role: 'user',
        teamId: null,
      });

      const rows = await Promise.all(
        users.map((user) =>
          buildPayrollPeriodDataForUser(user, periodStart, periodEnd)
        )
      );

      const summary = {
        usersCount: rows.length,
        completeUsers: rows.filter((r) => r.coverage.missingMonths.length === 0)
          .length,
        incompleteUsers: rows.filter((r) => r.coverage.missingMonths.length > 0)
          .length,
      };

      return res.json({
        ok: true,
        period: {
          from: fromKey,
          to: toKey,
        },
        summary,
        rows,
      });
    } catch (err) {
      console.error('Failed to build payroll period', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not build payroll period' });
    }
  }
);

app.get(
  '/api/admin/payroll-export-pdf',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const username = String(req.query?.username || '').trim();
    const fromRaw = String(req.query?.from || '').slice(0, 10);
    const toRaw = String(req.query?.to || '').slice(0, 10);

    if (!username) {
      return res.status(400).json({ ok: false, error: 'Benutzername fehlt.' });
    }

    const fromDate = parseIsoDateOnly(fromRaw);
    const toDate = parseIsoDateOnly(toRaw);

    if (!fromDate || !toDate) {
      return res.status(400).json({
        ok: false,
        error: 'Ungültiger Zeitraum. Bitte "von" und "bis" korrekt angeben.',
      });
    }

    const periodStart = fromDate <= toDate ? fromDate : toDate;
    const periodEnd = fromDate <= toDate ? toDate : fromDate;
    const teamId = String(req.user.teamId || '');

    try {
      const targetUser = await findUserByUsername(username);

      if (
        !targetUser ||
        targetUser.role !== 'user' ||
        (teamId && targetUser.teamId !== teamId)
      ) {
        return res.status(404).json({
          ok: false,
          error: 'Mitarbeiter wurde nicht gefunden.',
        });
      }

      const row = await buildPayrollPeriodDataForUser(
        targetUser,
        periodStart,
        periodEnd
      );

      const safeUser = String(targetUser.username).replace(
        /[^a-zA-Z0-9_-]+/g,
        '_'
      );
      const filename = `Lohnabrechnung_${safeUser}_${formatDateKey(periodStart)}_${formatDateKey(periodEnd)}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );

      const doc = new PDFDocument({
        margin: 42,
        size: 'A4',
        info: {
          Title: `Lohnabrechnung ${targetUser.username} ${formatDateKey(periodStart)}-${formatDateKey(periodEnd)}`,
          Author: 'Hours App',
        },
      });

      doc.pipe(res);

      const { ensurePdfSpace, sectionTitle, writeMetricLines } =
        createPdfHelpers(doc);

      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .text('Lohnabrechnung – Audit Export');
      doc.moveDown(0.4);

      doc.font('Helvetica').fontSize(9).text(`Mitarbeiter: ${row.displayName}`);
      doc.text(
        `Zeitraum: ${formatDateDisplayEU(formatDateKey(periodStart))} – ${formatDateDisplayEU(formatDateKey(periodEnd))}`
      );
      doc.text(`Exportiert am: ${new Date().toLocaleString('de-DE')}`);
      doc.text(`Exportiert von: ${req.user.username}`);
      doc.text('Hinweis: Nur übertragene Daten berücksichtigt.');

      sectionTitle('Lohndaten im Zeitraum');
      writeMetricLines([
        ['Präsenz', fmtHours(row.totals.praesenzStunden)],
        ['Pikett', fmtHours(row.totals.pikettHours)],
        ['ÜZ3 Wochenende', fmtHours(row.totals.ueZ3Hours)],
        ['Morgenessen', fmtCount(row.totals.morgenessenCount)],
        ['Mittagessen', fmtCount(row.totals.mittagessenCount)],
        ['Abendessen', fmtCount(row.totals.abendessenCount)],
        ['Schmutzzulage', fmtCount(row.totals.schmutzzulageCount)],
        ['Nebenauslagen', fmtCount(row.totals.nebenauslagenCount)],
      ]);

      // Absenzen aus DB
      if (row.absencesByType && Object.keys(row.absencesByType).length > 0) {
        sectionTitle('Absenzen im Zeitraum');
        const TYPE_LABELS = {
          ferien: 'Ferien',
          krank: 'Krank / Arztbesuch',
          unfall: 'Unfall',
          militaer: 'Militär',
          mutterschaft: 'Mutterschaft',
          vaterschaft: 'Vaterschaftsurlaub',
          bezahlteabwesenheit: 'Bezahlte Abwesenheit',
          sonstiges: 'Sonstiges',
        };
        const absLines = Object.entries(row.absencesByType)
          .filter(([, data]) => data.days > 0 || data.hours > 0)
          .map(([type, data]) => [
            TYPE_LABELS[type] || type,
            data.hours > 0 ? `${data.days}d / ${data.hours}h` : `${data.days}d`,
          ]);
        if (absLines.length > 0) writeMetricLines(absLines);
      }

      sectionTitle('Überzeit in dieser Lohnperiode');
      writeMetricLines([
        ['ÜZ1 roh', fmtSignedHours(row.overtime.ueZ1Raw)],
        [
          'Vorarbeit angerechnet',
          fmtSignedHours(row.overtime.vorarbeitApplied),
        ],
        ['ÜZ1 nach Vorarbeit', fmtSignedHours(row.overtime.ueZ1AfterVorarbeit)],
        ['ÜZ2', fmtSignedHours(row.overtime.ueZ2)],
        ['ÜZ3', fmtSignedHours(row.overtime.ueZ3)],
      ]);

      sectionTitle(`Vorarbeitszeit (${row.vorarbeit.year || '–'})`);
      writeMetricLines([
        [
          'Stand per Periodenende',
          `${(Number(row.vorarbeit.filled) || 0).toFixed(1).replace('.', ',')} / ${(Number(row.vorarbeit.required) || 0).toFixed(1).replace('.', ',')} h`,
        ],
        ['Änderung im Zeitraum', fmtSignedHours(row.vorarbeit.changeInPeriod)],
      ]);

      sectionTitle('Berücksichtigte Übertragungen');
      writeMetricLines([
        [
          'Monate berücksichtigt',
          (row.coverage.transmittedMonths || []).join(', ') || '–',
        ],
        [
          'Monate fehlend',
          (row.coverage.missingMonths || []).join(', ') || '–',
        ],
      ]);

      sectionTitle('Tagesdetails');
      if (!row.auditRows.length) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text('Keine relevanten Einträge im ausgewählten Zeitraum.');
      } else {
        row.auditRows.forEach((entry) => {
          ensurePdfSpace(54);

          doc.font('Helvetica-Bold').fontSize(9).text(entry.dateLabel);

          // Stempel-Paare formatieren: Ein/Aus
          if (entry.stamps && entry.stamps.length > 0) {
            const pairs = [];
            const sorted = [...entry.stamps];
            for (let i = 0; i < sorted.length - 1; i++) {
              if (sorted[i].type === 'in' && sorted[i + 1].type === 'out') {
                pairs.push(`${sorted[i].time}–${sorted[i + 1].time}`);
                i++;
              }
            }
            const stampStr = pairs.length > 0 ? pairs.join('  |  ') : '–';
            doc
              .font('Helvetica')
              .fontSize(8)
              .fillColor('#555555')
              .text(`Stempel: ${stampStr}`)
              .fillColor('#000000');
          }

          doc
            .font('Helvetica')
            .fontSize(8.5)
            .text(
              `Präsenz: ${fmtHours(entry.praesenzStunden)}   |   Ferien: ${entry.ferien ? 'Ja' : 'Nein'}`
            );

          doc.text(
            `Morgenessen: ${entry.morgenessen ? 'Ja' : 'Nein'}   |   Mittagessen: ${entry.mittagessen ? 'Ja' : 'Nein'}   |   Abendessen: ${entry.abendessen ? 'Ja' : 'Nein'}`
          );

          doc.text(
            `Schmutzzulage: ${entry.schmutzzulage ? 'Ja' : 'Nein'}   |   Nebenauslagen: ${entry.nebenauslagen ? 'Ja' : 'Nein'}`
          );

          doc.text(
            `Pikett: ${fmtHours(entry.pikettHours)}   |   ÜZ3: ${fmtHours(entry.overtime3Hours)}`
          );

          if (entry.absencesText) {
            doc.text(`Abwesenheiten / Bemerkungen: ${entry.absencesText}`);
          }

          doc.moveDown(0.35);
        });
      }

      doc.end();
    } catch (err) {
      console.error('Failed to export payroll PDF', err);
      return res.status(500).json({ ok: false, error: 'PDF export failed' });
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
      const users = await listUsersFromDb();

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

// ============================================================================
// Auto lockweeks jeden Montagmittag
// ============================================================================

// Gibt ISO-Woche und Jahr für ein Date zurück
function getISOWeekAndYear(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7),
    year: d.getUTCFullYear(),
  };
}

// Jeden Montag 12:00 — vergangene Woche sperren
cron.schedule('0 12 * * 1', () => autoLockPreviousWeek(listUsersFromDb), {
  timezone: 'Europe/Zurich',
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

function createMailTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.infomaniak.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    family: 4, // IPv4 erzwingen
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const ALERT_TEAMS = {
  montage: (process.env.ALERT_EMAIL_MONTAGE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  service: (process.env.ALERT_EMAIL_SERVICE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

async function checkAndSendStampAlerts() {
  const todayKey = formatDateKey(new Date());

  // Alle live_stamps von heute laden
  const result = await db.query(
    `
    SELECT l.username, l.stamps, l.today_key, u.team_id
    FROM live_stamps l
    LEFT JOIN users u ON u.username = l.username
    WHERE l.today_key = $1
  `,
    [todayKey]
  );

  // Nur Teams mit konfigurierten Adressen
  const alertTeams = Object.keys(ALERT_TEAMS).filter(
    (t) => ALERT_TEAMS[t].length > 0
  );
  if (alertTeams.length === 0) return;

  // Pro Team: User sammeln die noch eingestempelt sind
  const alertsByTeam = {};

  for (const row of result.rows) {
    const teamId = row.team_id || '';
    if (!alertTeams.includes(teamId)) continue;

    const stamps = Array.isArray(row.stamps) ? row.stamps : [];
    if (stamps.length === 0) continue;

    // Letzter Stempel = 'in' → noch eingestempelt
    const sorted = [...stamps].sort((a, b) => a.time.localeCompare(b.time));
    const lastStamp = sorted[sorted.length - 1];
    if (lastStamp.type !== 'in') continue;

    if (!alertsByTeam[teamId]) alertsByTeam[teamId] = [];
    alertsByTeam[teamId].push({
      username: row.username,
      lastTime: lastStamp.time,
    });
  }

  if (Object.keys(alertsByTeam).length === 0) {
    console.log('[StampAlert] Alle ausgestempelt — keine Meldung nötig.');
    return;
  }

  const transporter = createMailTransporter();

  for (const [teamId, users] of Object.entries(alertsByTeam)) {
    const recipients = ALERT_TEAMS[teamId];
    if (!recipients.length) continue;

    const teamLabel = teamId.charAt(0).toUpperCase() + teamId.slice(1);
    const userList = users
      .map((u) => `• ${u.username} — eingestempelt seit ${u.lastTime} Uhr`)
      .join('\n');

    const text = `Guten Abend\n\nFolgende Mitarbeiter des Teams ${teamLabel} sind um 18:00 Uhr noch eingestempelt:\n\n${userList}\n\nBitte prüfen.\n\nFreundliche Grüsse\nNorm Aufzüge AG`;

    try {
      await transporter.sendMail({
        from: `"Norm Aufzüge" <${process.env.SMTP_USER}>`,
        to: recipients.join(', '),
        subject: `⚠️ Nicht ausgestempelt – Team ${teamLabel} – ${todayKey}`,
        text,
      });
      console.log(
        `[StampAlert] Email gesendet für Team ${teamId} an ${recipients.join(', ')}`
      );
    } catch (err) {
      console.error(`[StampAlert] Email-Fehler Team ${teamId}:`, err.message);
    }
  }
}

cron.schedule(
  '0 18 * * 1-5',
  async () => {
    console.log('[StampAlert] Prüfe nicht ausgestempelte Mitarbeiter...');
    try {
      await checkAndSendStampAlerts();
    } catch (err) {
      console.error('[StampAlert] Fehler:', err);
    }
  },
  { timezone: 'Europe/Zurich' }
);

// Auto-Transmit täglich um 02:00 Uhr
cron.schedule(
  '0 2 * * *',
  async () => {
    console.log('[AutoTransmit] Starte tägliche Auto-Übertragung...');
    try {
      const users = await listUsersFromDb({ role: 'user' });
      for (const user of users) {
        try {
          await autoTransmitForUser(user);
        } catch (err) {
          console.error(
            `[AutoTransmit] Fehler bei ${user.username}:`,
            err.message
          );
        }
      }
      console.log('[AutoTransmit] Abgeschlossen.');
    } catch (err) {
      console.error('[AutoTransmit] Kritischer Fehler:', err);
    }
  },
  {
    timezone: 'Europe/Zurich',
  }
);

startServer().catch((err) => {
  console.error('Server startup failed', err);
  process.exit(1);
});
