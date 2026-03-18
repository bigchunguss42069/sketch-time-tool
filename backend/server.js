
// ============================================================================
// Runtime dependencies and app bootstrap
// ============================================================================
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const exportPdfBody = express.json({ limit: '10mb' });

const app = express();
const PORT = Number(process.env.PORT) || 3000;


// ============================================================================
// Global middleware
// ============================================================================
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.use('/src', express.static(path.join(__dirname, 'src')));
app.use(express.static(__dirname));


// ============================================================================
// In-memory identity data and option labels
// ============================================================================
// Note: users and sessions still behave exactly like before.
// This section remains intentionally simple until a later persistence/auth upgrade.

// Teams
const TEAMS = [
  { id: 'montage', name: 'Team Montage' },
  // später: { id: 'service', name: 'Team Service' }, ...
];

const USERS = [
  { id: 'u1', username: 'demo',  password: 'demo123',  role: 'user',  teamId: 'montage' },
  { id: 'u2', username: 'chef',  password: 'chef123',  role: 'admin', teamId: 'montage' },
  { id: 'u3', username: 'markus',  password: 'markus',  role: 'user', teamId: 'montage' },
];

const OPTION_LABELS = {
  option1: 'Montage',
  option2: 'Demontage',
  option3: 'Transport',
  option4: 'Inbetreibnahme',
  option5: 'Abnahme',
  option6: 'Werk',
  _regie: 'Regie',
  _fehler: 'Fehler',
};

function getOperationLabel(opKey) {
  return OPTION_LABELS[opKey] || opKey;
}

const sessions = new Map(); // token -> userId

function findUserByCredentials(username, password) {
  return USERS.find(
    (u) => u.username === username && u.password === password
  );
}

function findUserById(id) {
  return USERS.find((u) => u.id === id);
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================================================
// Authentication / authorization helpers
// ============================================================================

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res
      .status(401)
      .json({ ok: false, error: 'Missing or invalid Authorization header' });
  }

  const userId = sessions.get(token);
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'Invalid or expired token' });
  }

  const user = findUserById(userId);
  if (!user) {
    return res
      .status(401)
      .json({ ok: false, error: 'User not found for this token' });
  }

  req.user = user;
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res
      .status(403)
      .json({ ok: false, error: 'Admin role required' });
  }
  next();
}

// ============================================================================
// Shared date, number and month-overview helpers
// ============================================================================
// These utilities are used across admin views, month summaries and payroll logic.

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function formatDateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateDisplayEU(dateKey) {
  const raw = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(dateKey || '–');

  const [yyyy, mm, dd] = raw.split('-');
  return `${dd}.${mm}.${yyyy}`;
}

// Same ISO week logic as frontend (UTC-based)
function getISOWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  const year = d.getUTCFullYear();
  return { week: weekNo, year };
}

function makeMonthLabel(year, monthIndex) {
  const d = new Date(year, monthIndex, 1);

  const label = d.toLocaleString('de-DE', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function clampToNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function computeNonPikettHours(dayData) {
  if (!dayData || typeof dayData !== 'object') return 0;

  let total = 0;

  // Kommissionsstunden
  if (Array.isArray(dayData.entries)) {
    dayData.entries.forEach((entry) => {
      if (!entry || !entry.hours) return;
      Object.values(entry.hours).forEach((val) => {
        total += clampToNumber(val);
      });
    });
  }

  // Tagesbezogene Stunden
  if (dayData.dayHours && typeof dayData.dayHours === 'object') {
    total += clampToNumber(dayData.dayHours.schulung);
    total += clampToNumber(dayData.dayHours.sitzungKurs);
    total += clampToNumber(dayData.dayHours.arztKrank);
  }

  // Spezialbuchungen
  if (Array.isArray(dayData.specialEntries)) {
    dayData.specialEntries.forEach((s) => {
      if (!s) return;
      total += clampToNumber(s.hours);
    });
  }

  return total;
}

function buildPikettHoursByDate(pikettArray) {
  const map = new Map(); // dateKey -> hours
  if (!Array.isArray(pikettArray)) return map;

  pikettArray.forEach((p) => {
    if (!p || !p.date) return;
    const h = clampToNumber(p.hours);
    if (h <= 0) return;
    map.set(p.date, (map.get(p.date) || 0) + h);
  });

  return map;
}

function buildAcceptedAbsenceDaysSet(absencesArray, monthStartKey, monthEndKey) {
  const set = new Set();
  if (!Array.isArray(absencesArray)) return set;

  absencesArray.forEach((a) => {
    const st = String(a.status || '').toLowerCase();
    if (!a || (st !== 'accepted' && st !== 'cancel_requested')) return;

    if (!a.from || !a.to) return;

    const fromKey = String(a.from).slice(0, 10);
    const toKey = String(a.to).slice(0, 10);

    // normalize order
    const startKey = fromKey <= toKey ? fromKey : toKey;
    const endKey = fromKey <= toKey ? toKey : fromKey;

    // overlap with month?
    if (endKey < monthStartKey || startKey > monthEndKey) return;

    const cursor = new Date(startKey + 'T00:00:00');
    const end = new Date(endKey + 'T00:00:00');

    while (cursor <= end) {
      const k = formatDateKey(cursor);
      if (k >= monthStartKey && k <= monthEndKey) {
        set.add(k);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return set;
}


function computeUeZ1NetForMonth(payload, year, monthIndex) {
  const DAILY_SOLL = 8.0;
  const daysObj = (payload && payload.days && typeof payload.days === 'object') ? payload.days : {};

  let sum = 0;

  for (const [dateKey, dayData] of Object.entries(daysObj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    const d = new Date(dateKey + 'T00:00:00');
    if (Number.isNaN(d.getTime())) continue;

    // Safety: ensure it belongs to the month being processed
    if (d.getFullYear() !== year || d.getMonth() !== monthIndex) continue;

    const flags = (dayData && dayData.flags) ? dayData.flags : {};
    const isFerien = !!flags.ferien;

    const dayTotal = computeNonPikettHours(dayData);
    const hasAnyHours = dayTotal > 0;
    const hasAnyFlag = Object.values(flags).some(Boolean);

    // Empty day (no hours, no flags) -> ignore (no -8)
    if (!hasAnyHours && !hasAnyFlag) continue;

    let diff = 0;

    if (isFerien) {
      if (!hasAnyHours) diff = 0;
      else if (dayTotal < DAILY_SOLL) diff = 0;
      else diff = dayTotal - DAILY_SOLL;
    } else {
      if (hasAnyHours) diff = dayTotal - DAILY_SOLL;
      else diff = 0;
    }

    sum += diff;
  }

  // Keep same style as totals (1 decimal)
  return Math.round(sum * 10) / 10;
}

// Compute only POSITIVE ÜZ1 hours for the month (for Vorarbeit tracking)
function computeUeZ1PositiveForMonth(payload, year, monthIndex) {
  const DAILY_SOLL = 8.0;
  const daysObj = (payload && payload.days && typeof payload.days === 'object') ? payload.days : {};

  let positiveSum = 0;

  for (const [dateKey, dayData] of Object.entries(daysObj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    const d = new Date(dateKey + 'T00:00:00');
    if (Number.isNaN(d.getTime())) continue;

    if (d.getFullYear() !== year || d.getMonth() !== monthIndex) continue;

    const flags = (dayData && dayData.flags) ? dayData.flags : {};
    const isFerien = !!flags.ferien;

    const dayTotal = computeNonPikettHours(dayData);
    const hasAnyHours = dayTotal > 0;
    const hasAnyFlag = Object.values(flags).some(Boolean);

    if (!hasAnyHours && !hasAnyFlag) continue;

    let diff = 0;

    if (isFerien) {
      if (!hasAnyHours) diff = 0;
      else if (dayTotal < DAILY_SOLL) diff = 0;
      else diff = dayTotal - DAILY_SOLL;
    } else {
      if (hasAnyHours) diff = dayTotal - DAILY_SOLL;
      else diff = 0;
    }

    // Only count positive hours
    if (diff > 0) {
      positiveSum += diff;
    }
  }

  return Math.round(positiveSum * 10) / 10;
}

const PAYROLL_YEAR_CONFIG = {
  2025: { vorarbeitRequired: 39 },
  2026: { vorarbeitRequired: 39 },
};

function getPayrollYearConfig(year) {
  return PAYROLL_YEAR_CONFIG[year] || { vorarbeitRequired: 0 };
}

function computePayrollPeriodOvertimeFromSubmission(submission, fromKey, toKey) {
  const DAILY_SOLL = 8.0;
  const daysObj =
    submission && submission.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  let ueZ1Raw = 0;
  let ueZ1Positive = 0;
  let ueZ2 = 0;
  let ueZ3 = 0;

  for (const [dateKey, dayData] of Object.entries(daysObj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    if (dateKey < fromKey || dateKey > toKey) continue;

    const flags = (dayData && dayData.flags) ? dayData.flags : {};
    const isFerien = !!flags.ferien;

    const dayTotal = computeNonPikettHours(dayData);
    const hasAnyHours = dayTotal > 0;
    const hasAnyFlag = Object.values(flags).some(Boolean);

    if (!hasAnyHours && !hasAnyFlag) continue;

    let diff = 0;

    if (isFerien) {
      if (!hasAnyHours) diff = 0;
      else if (dayTotal < DAILY_SOLL) diff = 0;
      else diff = dayTotal - DAILY_SOLL;
    } else {
      if (hasAnyHours) diff = dayTotal - DAILY_SOLL;
      else diff = 0;
    }

    ueZ1Raw += diff;
    if (diff > 0) ueZ1Positive += diff;
  }

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
function buildMonthOverviewFromSubmission(submission, year, monthIndex, acceptedAbsenceDaysOverride) {
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  const monthStartKey = formatDateKey(monthStart);
  const monthEndKey = formatDateKey(monthEnd);

  const daysObj = (submission && submission.days && typeof submission.days === 'object')
    ? submission.days
    : {};

  const pikettByDate = buildPikettHoursByDate(submission?.pikett);

  const acceptedAbsenceDays = (acceptedAbsenceDaysOverride instanceof Set)
    ? acceptedAbsenceDaysOverride
    : buildAcceptedAbsenceDaysSet(submission?.absences, monthStartKey, monthEndKey);

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

    monthTotalHours += totalHours;

    const hasAcceptedAbsence = acceptedAbsenceDays.has(dateKey);

    let status = 'missing';
    if (ferien) status = 'ferien';
    else if (hasAcceptedAbsence) status = 'absence';
    else if (totalHours > 0) status = 'ok';
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
        days: [], // weekdays only for UI list
      });
    }

    const w = weekMap.get(weekKey);

    // min/max date (within the month)
    if (!w.minDate || cursor < w.minDate) w.minDate = new Date(cursor);
    if (!w.maxDate || cursor > w.maxDate) w.maxDate = new Date(cursor);

    // week total includes ALL days (also weekends)
    w.weekTotalHours += totalHours;

    // UI wants weekdays list only
    if (weekday >= 1 && weekday <= 5) {
      w.workDaysInMonth += 1;
      if (status === 'missing') w.missingCount += 1;

      w.days.push({
        dateKey,
        weekday,       // for "Mo/Di/..." mapping in frontend
        totalHours,
        status,        // "missing" | "ok" | "ferien" | "absence"
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
    days: w.days,
  }));

  return {
    monthStartKey,
    monthEndKey,
    monthTotalHours,
    weeks: outWeeks,
  };
}


// ---- Auth routes ----

// Login: POST /api/auth/login
// ============================================================================
// Authentication routes
// ============================================================================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res
      .status(400)
      .json({ ok: false, error: 'Missing username or password' });
  }

  const user = findUserByCredentials(username, password);
  if (!user) {
    return res
      .status(401)
      .json({ ok: false, error: 'Ungültige Zugangsdaten' });
  }

  const token = createToken();
  // Store the session by *user.id* (stable, independent of username text)
  sessions.set(token, user.id);

  return res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      teamId: user.teamId,
    },
  });
});


// Current user: GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = req.user;
  res.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      teamId: user.teamId,
    },
  });
});

// ---- Health check ----
// ============================================================================
// Basic health check
// ============================================================================
app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running 🚀' });
});

// ---- File storage helpers ----

// ============================================================================
// Data directories and per-domain persistence helpers
// ============================================================================
const BASE_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(BASE_DATA_DIR)) {
  fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
}

// ---- Absenzen (persistent, per user file) ----
// ----------------------------------------------------------------------------
// Absence persistence helpers
// ----------------------------------------------------------------------------
const ABSENCES_DIR = path.join(BASE_DATA_DIR, 'absences');
if (!fs.existsSync(ABSENCES_DIR)) fs.mkdirSync(ABSENCES_DIR, { recursive: true });

function absencesFilePath(username) {
  const safe = String(username).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(ABSENCES_DIR, `${safe}.json`);
}

function readUserAbsences(username) {
  const list = safeReadJson(absencesFilePath(username), []);
  return Array.isArray(list) ? list : [];
}

function writeUserAbsences(username, list) {
  writeJsonAtomic(absencesFilePath(username), Array.isArray(list) ? list : []);
}

function findAcceptedAbsenceForDate(absences, dateKey) {
  if (!Array.isArray(absences)) return null;

  return (
    absences.find((a) => {
      const st = String(a.status || '').toLowerCase();
      if (!a || (st !== 'accepted' && st !== 'cancel_requested')) return false;


      const fromKey = String(a.from || '').slice(0, 10);
      const toKey = String(a.to || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) return false;

      const start = fromKey <= toKey ? fromKey : toKey;
      const end = fromKey <= toKey ? toKey : fromKey;

      return dateKey >= start && dateKey <= end;
    }) || null
  );
}

// ---- Konten (persistent, idempotent by user-month snapshot) ----
// ----------------------------------------------------------------------------
// Konten helpers
// ----------------------------------------------------------------------------
const KONTEN_PATH = path.join(BASE_DATA_DIR, 'konten.json');

function readKonten() {
  const fallback = { version: 1, updatedAt: null, users: {}, snapshots: {} };
  const data = safeReadJson(KONTEN_PATH, fallback);
  if (!data || typeof data !== 'object') return fallback;
  if (!data.users || typeof data.users !== 'object') data.users = {};
  if (!data.snapshots || typeof data.snapshots !== 'object') data.snapshots = {};
  if (!data.version) data.version = 1;
  if (!('updatedAt' in data)) data.updatedAt = null;
  return data;
}

function writeKonten(data) {
  data.updatedAt = new Date().toISOString();
  writeJsonAtomic(KONTEN_PATH, data);
}

function ensureKontenUser(data, username, teamId) {
  if (!data.users[username]) {
    data.users[username] = {
      teamId: teamId || null,
      ueZ1: 0,
      ueZ2: 0,
      ueZ3: 0,
      ueZ1PositiveByYear: {},      // { "2025": 50, "2026": 20 } - positive hours per year for Vorarbeit
      vacationDays: 0,
      vacationDaysPerYear: 21,
      creditedYears: {},
      updatedAt: null,
      updatedBy: null,
    };
  }
  if (!data.snapshots[username]) data.snapshots[username] = {};
  if (!data.users[username].creditedYears) data.users[username].creditedYears = {};
  if (!data.users[username].ueZ1PositiveByYear) data.users[username].ueZ1PositiveByYear = {};
  return data.users[username];
}

function kontenMonthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`; // e.g. 2026-01
}

// Same holiday list as frontend (extend yearly as needed)
const BERN_HOLIDAYS = {
  2025: new Set(['2025-01-01','2025-01-02','2025-04-18','2025-04-20','2025-04-21','2025-05-29','2025-06-09','2025-08-01','2025-09-21','2025-12-25','2025-12-26']),
  2026: new Set(['2026-01-01','2026-01-02','2026-04-03','2026-04-05','2026-04-06','2026-05-14','2026-05-25','2026-08-01','2026-09-20','2026-12-25','2026-12-26']),
  2027: new Set(['2027-01-01','2027-01-02','2027-03-26','2027-03-28','2027-03-29','2027-05-06','2027-05-17','2027-08-01','2027-09-19','2027-12-25','2027-12-26']),
};

function isBernHolidayKey(dateKey) {
  const year = Number(String(dateKey).slice(0, 4));
  const set = BERN_HOLIDAYS[year];
  return !!(set && set.has(dateKey));
}


// Calculate vacation days for an absence (weekdays minus holidays)
function calculateAbsenceVacationDays(absence) {
  if (!absence || !absence.from || !absence.to) return 0;
  
  const type = String(absence.type || '').toLowerCase();
  if (type !== 'ferien') return 0; // Only count Ferien type
  
  let fromDate = new Date(absence.from + 'T00:00:00');
  let toDate = new Date(absence.to + 'T00:00:00');
  
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;
  
  // Swap if dates are reversed
  if (toDate < fromDate) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }
  
  let days = 0;
  const cursor = new Date(fromDate);
  
  while (cursor <= toDate) {
    const weekday = cursor.getDay(); // 0=Sun, 6=Sat
    const dateKey = formatDateKey(cursor);
    
    // Only count weekdays (Mon-Fri) that aren't holidays
    if (weekday >= 1 && weekday <= 5 && !isBernHolidayKey(dateKey)) {
      days += 1;
    }
    
    cursor.setDate(cursor.getDate() + 1);
  }
  
  return days;
}


// vacation day fraction = max(0, 1 - (hoursWorked/8))
function computeVacationUsedDaysForMonth(payload, year, monthIndex) {
  const DAILY_SOLL = 8.0;
  const daysObj = (payload && payload.days && typeof payload.days === 'object') ? payload.days : {};
  let used = 0;

  for (const [dateKey, dayData] of Object.entries(daysObj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    const d = new Date(dateKey + 'T00:00:00');
    if (Number.isNaN(d.getTime())) continue;

    if (d.getFullYear() !== year || d.getMonth() !== monthIndex) continue;

    const weekday = d.getDay(); // 0..6
    if (weekday < 1 || weekday > 5) continue;

    const ferien = !!(dayData && dayData.flags && dayData.flags.ferien);
    if (!ferien) continue;

    if (isBernHolidayKey(dateKey)) continue;

    const worked = computeNonPikettHours(dayData);
    const fraction = Math.max(0, 1 - (worked / DAILY_SOLL));

    
    const rounded = Math.round(fraction * 4) / 4;
    used += rounded;
  }

  return Math.round(used * 100) / 100;
}

// Apply a month's transmitted totals to the running Konten state.
function updateKontenFromSubmission({ username, teamId, year, monthIndex, totals, payload, updatedBy }) {
  const data = readKonten();
  const user = ensureKontenUser(data, username, teamId);

  // Auto-credit yearly vacation entitlement once per year (supports carry-over policy)
  if (!user.creditedYears[String(year)]) {
    user.vacationDays += Number(user.vacationDaysPerYear) || 0;
    user.creditedYears[String(year)] = true;
  }

  const monthKey = kontenMonthKey(year, monthIndex);
  const prevSnap = data.snapshots[username][monthKey] || { ueZ1: 0, ueZ2: 0, ueZ3: 0, ueZ1Positive: 0, vacUsed: 0 };

  const nextSnap = {
    ueZ1: computeUeZ1NetForMonth(payload, year, monthIndex),
    ueZ1Positive: computeUeZ1PositiveForMonth(payload, year, monthIndex),
    ueZ2: Number(totals?.pikett) || 0,
    ueZ3: Number(totals?.overtime3) || 0,
    vacUsed: computeVacationUsedDaysForMonth(payload, year, monthIndex),
  };

  // delta apply (idempotent even if same month is re-submitted daily)
  user.ueZ1 += (nextSnap.ueZ1 - prevSnap.ueZ1);
  user.ueZ2 += (nextSnap.ueZ2 - prevSnap.ueZ2);
  user.ueZ3 += (nextSnap.ueZ3 - prevSnap.ueZ3);

  user.vacationDays -= (nextSnap.vacUsed - prevSnap.vacUsed);

  // Track positive ÜZ1 per year (for Vorarbeit calculation)
  const yearStr = String(year);
  if (!user.ueZ1PositiveByYear[yearStr]) user.ueZ1PositiveByYear[yearStr] = 0;
  user.ueZ1PositiveByYear[yearStr] += (nextSnap.ueZ1Positive - (prevSnap.ueZ1Positive || 0));

  user.updatedAt = new Date().toISOString();
  user.updatedBy = updatedBy || username;

  data.snapshots[username][monthKey] = nextSnap;

  writeKonten(data);
}

// ---- Week locks (persistent) ----
// Stored globally, keyed by username -> weekKey -> { locked:true, lockedAt, lockedBy }
// ----------------------------------------------------------------------------
// Week locks, date ranges and payroll-period helpers
// ----------------------------------------------------------------------------
const WEEK_LOCKS_PATH = path.join(BASE_DATA_DIR, 'weekLocks.json');

function readWeekLocks() {
  if (!fs.existsSync(WEEK_LOCKS_PATH)) return {};
  try {
    const raw = fs.readFileSync(WEEK_LOCKS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    // quarantine corrupt file instead of wiping it
    const badPath = WEEK_LOCKS_PATH.replace(/\.json$/, '') + `.corrupt-${Date.now()}.json`;
    try { fs.renameSync(WEEK_LOCKS_PATH, badPath); } catch {}
    throw new Error(`weekLocks.json is corrupt (moved aside): ${e.message}`);
  }
}


function writeWeekLocks(data) {
  const tmpPath = WEEK_LOCKS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, WEEK_LOCKS_PATH);
}

function weekKey(weekYear, week) {
  return `${weekYear}-W${week}`;
}

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

function collectLockedDatesForMonth(userLocks, year, monthIndex) {
  const lockedDateKeys = new Set();
  const lockedWeekKeys = new Set();

  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  const cursor = new Date(start);
  while (cursor <= end) {
    const dk = formatDateKey(cursor);
    const iso = getISOWeekInfo(cursor); // { week, year }
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

function absenceOverlapsLockedDates(abs, lockedDateKeys) {
  if (!abs || !abs.from || !abs.to) return false;

  const fromKey = String(abs.from).slice(0, 10);
  const toKey = String(abs.to).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) {
    return false;
  }

  const startKey = fromKey <= toKey ? fromKey : toKey;
  const endKey = fromKey <= toKey ? toKey : fromKey;

  const cursor = new Date(startKey + 'T00:00:00');
  const end = new Date(endKey + 'T00:00:00');

  while (cursor <= end) {
    const k = formatDateKey(cursor);
    if (lockedDateKeys.has(k)) return true;
    cursor.setDate(cursor.getDate() + 1);
  }
  return false;
}

// Load the newest saved snapshot for a specific user/month combination.
function loadLatestMonthSubmission(username, year, monthIndex) {
  const userDir = getUserDir(username);
  const indexPath = path.join(userDir, 'index.json');
  const transmissions = safeReadJson(indexPath, []);

  const monthTxList = Array.isArray(transmissions)
    ? transmissions.filter((tx) => tx && tx.year === year && tx.monthIndex === monthIndex)
    : [];

  if (monthTxList.length === 0) return null;

  const latest = monthTxList.reduce((best, tx) => {
    if (!tx || !tx.sentAt) return best;
    const d = new Date(tx.sentAt);
    if (Number.isNaN(d.getTime())) return best;
    if (!best) return { tx, date: d };
    return d > best.date ? { tx, date: d } : best;
  }, null);

  if (!latest || !latest.tx || !latest.tx.id) return null;

  const filePath = path.join(userDir, latest.tx.id);
  return safeReadJson(filePath, null);
}


function parseIsoDateOnly(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  const d = new Date(raw + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKeyOf(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function getMonthRangeBetween(startDate, endDate) {
  const out = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= endMonth) {
    out.push({
      year: cursor.getFullYear(),
      monthIndex: cursor.getMonth(),
      monthKey: monthKeyOf(cursor.getFullYear(), cursor.getMonth()),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return out;
}

function isDateKeyInClosedRange(dateKey, fromKey, toKey) {
  const raw = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  return raw >= fromKey && raw <= toKey;
}

function computeAbsenceDaysInPeriod(absence, periodStart, periodEnd) {
  if (!absence || !absence.from || !absence.to) return 0;

  const rawStart = parseIsoDateOnly(absence.from);
  const rawEnd = parseIsoDateOnly(absence.to);
  if (!rawStart || !rawEnd) return 0;

  const start = rawStart <= rawEnd ? rawStart : rawEnd;
  const end = rawStart <= rawEnd ? rawEnd : rawStart;

  if (end < periodStart || start > periodEnd) return 0;

  // Manual override only wins if the full request lies inside the selected period
  // and the explicit days value is valid.
  if (
    typeof absence.days === 'number' &&
    Number.isFinite(absence.days) &&
    absence.days > 0 &&
    start >= periodStart &&
    end <= periodEnd
  ) {
    return absence.days;
  }

  const overlapStart = start > periodStart ? start : periodStart;
  const overlapEnd = end < periodEnd ? end : periodEnd;

  let total = 0;
  const cursor = new Date(overlapStart);

  while (cursor <= overlapEnd) {
    const weekday = cursor.getDay(); // 0=So, 6=Sa
    if (weekday >= 1 && weekday <= 5) {
      total += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

// Core payroll aggregation for one transmitted submission inside a selected period.
function aggregatePayrollFromSubmission(submission, fromKey, toKey, absencesById) {
  const result = {
    stunden: 0,
    arztKrankHours: 0,
    ferienDays: 0,
    morgenessenCount: 0,
    mittagessenCount: 0,
    abendessenCount: 0,
    schmutzzulageCount: 0,
    nebenauslagenCount: 0,
    pikettHours: 0,
  };

  const daysObj =
    submission && submission.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  for (const [dateKey, dayData] of Object.entries(daysObj)) {
    if (!isDateKeyInClosedRange(dateKey, fromKey, toKey)) continue;
    if (!dayData || typeof dayData !== 'object') continue;

    // Stunden = all non-pikett / non-ÜZ3 hours in the selected period
    if (Array.isArray(dayData.entries)) {
      for (const entry of dayData.entries) {
        if (!entry || !entry.hours || typeof entry.hours !== 'object') continue;
        for (const v of Object.values(entry.hours)) {
          result.stunden += toNumber(v);
        }
      }
    }

    if (Array.isArray(dayData.specialEntries)) {
      for (const special of dayData.specialEntries) {
        if (!special) continue;
        result.stunden += toNumber(special.hours);
      }
    }

    const dayHours =
      dayData.dayHours && typeof dayData.dayHours === 'object'
        ? dayData.dayHours
        : {};

    const arztKrank = toNumber(dayHours.arztKrank);
    const schulung = toNumber(dayHours.schulung);
    const sitzungKurs = toNumber(dayHours.sitzungKurs);

    result.arztKrankHours += arztKrank;
    result.stunden += arztKrank + schulung + sitzungKurs;

    const meal =
      dayData.mealAllowance && typeof dayData.mealAllowance === 'object'
        ? dayData.mealAllowance
        : {};

    if (meal['1']) result.morgenessenCount += 1;
    if (meal['2']) result.mittagessenCount += 1;
    if (meal['3']) result.abendessenCount += 1;

    const flags =
      dayData.flags && typeof dayData.flags === 'object'
        ? dayData.flags
        : {};

    if (flags.schmutzzulage) result.schmutzzulageCount += 1;
    if (flags.nebenauslagen) result.nebenauslagenCount += 1;
  }

  const pikettList = Array.isArray(submission?.pikett) ? submission.pikett : [];
  for (const entry of pikettList) {
    const dateKey = String(entry?.date || '').slice(0, 10);
    if (!isDateKeyInClosedRange(dateKey, fromKey, toKey)) continue;

    if (entry?.isOvertime3) continue;
    result.pikettHours += toNumber(entry?.hours);
  }

  const absences = Array.isArray(submission?.absences) ? submission.absences : [];
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

  result.stunden = round1(result.stunden);
  result.arztKrankHours = round1(result.arztKrankHours);
  result.pikettHours = round1(result.pikettHours);

  return result;
}


// Preserve already-locked day payloads during retransmission of the same month.
function mergeLockedWeeksPayload(newPayload, previousSubmission, lockedDateKeys) {
  const merged = { ...newPayload };

  // 1) days: locked dates are taken from previous submission (or removed if absent)
  const newDays = (merged.days && typeof merged.days === 'object') ? { ...merged.days } : {};
  const oldDays = (previousSubmission && previousSubmission.days && typeof previousSubmission.days === 'object')
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
  const oldPikett = Array.isArray(previousSubmission?.pikett) ? previousSubmission.pikett : [];

  merged.pikett = [
    ...newPikett.filter((p) => p && p.date && !lockedDateKeys.has(p.date)),
    ...oldPikett.filter((p) => p && p.date && lockedDateKeys.has(p.date)),
  ];

  // 3) absences: if an absence overlaps locked dates, keep the previous version
  const newAbs = Array.isArray(merged.absences) ? merged.absences : [];
  const oldAbs = Array.isArray(previousSubmission?.absences) ? previousSubmission.absences : [];

  const keptNew = newAbs.filter((a) => !absenceOverlapsLockedDates(a, lockedDateKeys));
  const keptOld = oldAbs.filter((a) => absenceOverlapsLockedDates(a, lockedDateKeys));

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


// Helper: get (and create) the folder for a given user

function getUserDir(userId) {
  const safeId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(BASE_DATA_DIR, safeId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function toNumber(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    const n = parseFloat(val.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// Summarise a transmitted month payload for index metadata and overview cards.
function computeTransmissionTotals(payload) {
  let kom = 0;        // Kommissionsstunden + Spezialbuchungen (ÜZ1)
  let dayHours = 0;   // Tagesbezogene Stunden
  let pikett = 0;     // ÜZ2 (Pikett)
  let overtime3 = 0;  // ÜZ3 (Wochenende ohne Pikett)

  // days: object keyed by YYYY-MM-DD -> dayData
  if (payload && payload.days && typeof payload.days === 'object') {
    for (const dayData of Object.values(payload.days)) {
      if (!dayData || typeof dayData !== 'object') continue;

      // Kommissionsstunden
      if (Array.isArray(dayData.entries)) {
        for (const entry of dayData.entries) {
          if (!entry || !entry.hours || typeof entry.hours !== 'object') continue;
          for (const v of Object.values(entry.hours)) {
            kom += toNumber(v);
          }
        }
      }

      // Spezialbuchungen zählen zu ÜZ1 / Kom
      if (Array.isArray(dayData.specialEntries)) {
        for (const s of dayData.specialEntries) {
          if (!s) continue;
          kom += toNumber(s.hours);
        }
      }

      // Tagesbezogene Stunden
      if (dayData.dayHours && typeof dayData.dayHours === 'object') {
        dayHours += toNumber(dayData.dayHours.schulung);
        dayHours += toNumber(dayData.dayHours.sitzungKurs);
        dayHours += toNumber(dayData.dayHours.arztKrank);
      }
    }
  }

  // pikett: array of entries
  if (payload && Array.isArray(payload.pikett)) {
    for (const p of payload.pikett) {
      if (!p) continue;
      const h = toNumber(p.hours);
      if (p.isOvertime3) overtime3 += h;
      else pikett += h;
    }
  }

  const total = kom + dayHours + pikett + overtime3;

  // normalize to 1 decimal like your UI
  const r1 = (n) => Math.round(n * 10) / 10;

  return {
    kom: r1(kom),
    dayHours: r1(dayHours),
    pikett: r1(pikett),
    overtime3: r1(overtime3),
    total: r1(total),
  };
}

// ============================================================================
// Admin transmission overview routes
// ============================================================================
app.get('/api/admin/users/:username/transmissions', requireAuth, requireAdmin, (req, res) => {
  const username = req.params.username;
  const user = USERS.find((u) => u.username === username);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

  const userDir = getUserDir(user.username);
  const indexPath = path.join(userDir, 'index.json');

  let transmissions = [];
  try {
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) transmissions = parsed;
    }
  } catch {
    transmissions = [];
  }

  // newest first
  transmissions.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));

  res.json({ ok: true, username, transmissions });
});


// ---- Anlagen: global index + daily ledger + per-user-month snapshots ----


// ============================================================================
// Anlagen domain helpers and persistence
// ============================================================================
const ANLAGEN_LEDGER_PATH = path.join(BASE_DATA_DIR, 'anlagenLedger.json');
const ANLAGEN_SNAP_DIR    = path.join(BASE_DATA_DIR, 'anlagenSnapshots');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readAnlagenLedger() {
  return safeReadJson(ANLAGEN_LEDGER_PATH, {});
}

function writeAnlagenLedger(data) {
  writeJsonAtomic(ANLAGEN_LEDGER_PATH, data);
}

function monthKey(year, monthIndex) {
  const mm = String(monthIndex + 1).padStart(2, '0');
  return `${year}-${mm}`;
}

function getSnapshotPath(username, year, monthIndex) {
  ensureDir(ANLAGEN_SNAP_DIR);
  const userDir = path.join(ANLAGEN_SNAP_DIR, String(username).replace(/[^a-zA-Z0-9_-]/g, '_'));
  ensureDir(userDir);
  return path.join(userDir, `${monthKey(year, monthIndex)}.json`);
}

function readAnlagenSnapshot(username, year, monthIndex) {
  return safeReadJson(getSnapshotPath(username, year, monthIndex), null); // null if none
}

function writeAnlagenSnapshot(username, year, monthIndex, snap) {
  writeJsonAtomic(getSnapshotPath(username, year, monthIndex), snap);
}

function addNum(obj, key, val) {
  if (!obj[key]) obj[key] = 0;
  obj[key] += val;
}

function subNum(obj, key, val) {
  if (!obj[key]) obj[key] = 0;
  obj[key] -= val;
  if (Math.abs(obj[key]) < 1e-9) delete obj[key];
}

function normalizeKomNr(v) {
  const s = String(v || '').trim();
  return s ? s.replace(/\s+/g, '') : '';
}

// Reduce one transmitted payload to the anlagen-relevant snapshot structure.
function extractAnlagenSnapshotFromPayload(payload, username) {
  // returns: { [komNr]: { totalHours, byOperation, byDate, lastActivity } }
  const snap = {};
  const days = (payload && payload.days && typeof payload.days === 'object') ? payload.days : {};

  for (const [dateKey, dayData] of Object.entries(days)) {
    if (!dayData || typeof dayData !== 'object') continue;

    // 1) Regular kom entries (option buckets)
    const entries = Array.isArray(dayData.entries) ? dayData.entries : [];
    for (const e of entries) {
      const komNr = normalizeKomNr(e?.komNr);
      if (!komNr) continue;

      const hoursObj = (e?.hours && typeof e.hours === 'object') ? e.hours : {};
      let sumDayKom = 0;

      if (!snap[komNr]) snap[komNr] = { totalHours: 0, byOperation: {}, byDate: {}, lastActivity: null };
      const rec = snap[komNr];

      for (const [opKey, raw] of Object.entries(hoursObj)) {
        const h = toNumber(raw);
        if (!(h > 0)) continue;
        sumDayKom += h;
        addNum(rec.byOperation, opKey, h);
      }

      if (sumDayKom > 0) {
        addNum(rec.byDate, dateKey, sumDayKom);
        rec.totalHours += sumDayKom;
        if (!rec.lastActivity || dateKey > rec.lastActivity) rec.lastActivity = dateKey;
      }
    }

    // 2) Special entries: split regie vs fehler
    const specials = Array.isArray(dayData.specialEntries) ? dayData.specialEntries : [];
    for (const s of specials) {
      const komNr = normalizeKomNr(s?.komNr);
      if (!komNr) continue;

      const h = toNumber(s?.hours);
      if (!(h > 0)) continue;

      if (!snap[komNr]) snap[komNr] = { totalHours: 0, byOperation: {}, byDate: {}, lastActivity: null };
      const rec = snap[komNr];

      const type = String(s?.type || '').toLowerCase();
      const bucket = (type === 'fehler') ? '_fehler' : '_regie';

      addNum(rec.byOperation, bucket, h);
      addNum(rec.byDate, dateKey, h);

      rec.totalHours += h;
      if (!rec.lastActivity || dateKey > rec.lastActivity) rec.lastActivity = dateKey;
    }
  }

  // optional cleanup: drop empty kom
  for (const [komNr, rec] of Object.entries(snap)) {
    if (!(rec.totalHours > 0)) delete snap[komNr];
  }

  return snap;
}


function getMaxDateFromKomLedger(komLedger) {
  // komLedger = { byUser: { u: { byDate: { 'YYYY-MM-DD': hours } } } }
  let max = null;
  const byUser = komLedger?.byUser || {};
  for (const u of Object.values(byUser)) {
    const byDate = u?.byDate || {};
    for (const dateKey of Object.keys(byDate)) {
      if (!max || dateKey > max) max = dateKey;
    }
  }
  return max;
}

function applySnapshotToIndexAndLedger({ index, ledger, teamId, username, snap, sign }) {
  // sign: +1 add, -1 subtract
  if (!index.teams || typeof index.teams !== 'object') index.teams = {};
  if (!index.teams[teamId] || typeof index.teams[teamId] !== 'object') {
    index.teams[teamId] = {};
  }
  if (!ledger[teamId] || typeof ledger[teamId] !== 'object') {
    ledger[teamId] = {};
  }

  const teamIndex = index.teams[teamId];

  for (const [komNr, rec] of Object.entries(snap || {})) {
    // ---- index ----
    if (!teamIndex[komNr]) {
      teamIndex[komNr] = {
        totalHours: 0,
        byOperation: {},
        byUser: {},
        lastActivity: null,
      };
    }

    const gi = teamIndex[komNr];
    const total = Number(rec.totalHours || 0);

    gi.totalHours = round1((Number(gi.totalHours || 0)) + sign * total);

    // byOperation
    for (const [k, v] of Object.entries(rec.byOperation || {})) {
      const h = Number(v) || 0;
      if (sign > 0) addNum(gi.byOperation, k, h);
      else subNum(gi.byOperation, k, h);
    }
    cleanupZeroish(gi.byOperation);

    // byUser total (store totals only)
    if (sign > 0) addNum(gi.byUser, username, total);
    else subNum(gi.byUser, username, total);
    cleanupZeroish(gi.byUser);

    // ---- ledger ----
    if (!ledger[teamId][komNr]) ledger[teamId][komNr] = { byUser: {} };
    if (!ledger[teamId][komNr].byUser[username]) {
      ledger[teamId][komNr].byUser[username] = { byDate: {} };
    }

    const lu = ledger[teamId][komNr].byUser[username];
    for (const [dateKey, v] of Object.entries(rec.byDate || {})) {
      const h = Number(v) || 0;
      if (sign > 0) addNum(lu.byDate, dateKey, h);
      else subNum(lu.byDate, dateKey, h);
    }

    // cleanup empty user ledger
    if (Object.keys(lu.byDate).length === 0) {
      delete ledger[teamId][komNr].byUser[username];
    }

    // cleanup empty kom ledger
    if (Object.keys(ledger[teamId][komNr].byUser).length === 0) {
      delete ledger[teamId][komNr];
    }

    // cleanup empty kom in index if totals are gone
    if (!(gi.totalHours > 0)) {
      delete teamIndex[komNr];
    }
  }
}

function recomputeLastActivitiesForTeam(index, ledger, teamId, komNrs) {
  for (const komNr of komNrs) {
    const gi = index?.[teamId]?.[komNr];
    if (!gi) continue;
    const komLedger = ledger?.[teamId]?.[komNr];
    gi.lastActivity = getMaxDateFromKomLedger(komLedger);
  }
}


// ---- Anlagen (Kom.-Nr.) global index + archive state ----


const ANLAGEN_INDEX_PATH = path.join(BASE_DATA_DIR, 'anlagenIndex.json');
const ANLAGEN_ARCHIVE_PATH = path.join(BASE_DATA_DIR, 'anlagenArchive.json');

// atomic write to avoid partially-written JSON on crash
function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function deepCloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function rollbackTransmissionIndex(indexPath, fileName) {
  const current = safeReadJson(indexPath, []);
  const next = Array.isArray(current)
    ? current.filter((item) => item && item.id !== fileName)
    : [];

  writeJsonAtomic(indexPath, next);
}


function cleanupZeroish(obj, eps = 1e-9) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = Number(obj[k]);
    if (!Number.isFinite(v) || Math.abs(v) < eps) delete obj[k];
  }
}

function round1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10) / 10;
}

function readAnlagenIndex() {
  const fallback = { version: 1, updatedAt: null, teams: {} };
  const data = safeReadJson(ANLAGEN_INDEX_PATH, fallback);
  if (!data || typeof data !== 'object') return fallback;
  if (!data.teams || typeof data.teams !== 'object') data.teams = {};
  if (!data.version) data.version = 1;
  if (!('updatedAt' in data)) data.updatedAt = null;
  return data;
}

function writeAnlagenIndex(data) {
  data.updatedAt = new Date().toISOString();
  writeJsonAtomic(ANLAGEN_INDEX_PATH, data);
}

function readAnlagenArchive() {
  return safeReadJson(ANLAGEN_ARCHIVE_PATH, {}); // { [teamId]: { [komNr]: { archived, archivedAt, archivedBy } } }
}

function writeAnlagenArchive(data) {
  writeJsonAtomic(ANLAGEN_ARCHIVE_PATH, data);
}

function ensureAnlageRec(teamObj, komNr) {
  if (!teamObj[komNr] || typeof teamObj[komNr] !== 'object') {
    teamObj[komNr] = { totalHours: 0, byOperation: {}, byUser: {}, lastActivity: null };
  }
  if (!teamObj[komNr].byOperation || typeof teamObj[komNr].byOperation !== 'object') teamObj[komNr].byOperation = {};
  if (!teamObj[komNr].byUser || typeof teamObj[komNr].byUser !== 'object') teamObj[komNr].byUser = {};
  if (!('lastActivity' in teamObj[komNr])) teamObj[komNr].lastActivity = null;
  if (!('totalHours' in teamObj[komNr])) teamObj[komNr].totalHours = 0;
  return teamObj[komNr];
}

// Extract Anlagen from one saved submission file.
// returns Map(komNr -> { totalHours, byOperation:{opKey:hours}, byUser:{username:hours}, lastActivity })
function extractAnlagenFromSubmission(submission, username) {
  const out = new Map();
  if (!submission || typeof submission !== 'object') return out;

  const days = (submission.days && typeof submission.days === 'object') ? submission.days : {};

  for (const [dateKey, dayData] of Object.entries(days)) {
    if (!dayData || typeof dayData !== 'object') continue;

    // 1) Kommissions entries
    const entries = Array.isArray(dayData.entries) ? dayData.entries : [];
    for (const e of entries) {
      const komNr = normalizeKomNr(e?.komNr);
      if (!komNr) continue;

      const hoursObj = (e?.hours && typeof e.hours === 'object') ? e.hours : {};
      let sum = 0;

      if (!out.has(komNr)) {
        out.set(komNr, { totalHours: 0, byOperation: {}, byUser: {}, lastActivity: null });
      }
      const rec = out.get(komNr);

      for (const [opKey, raw] of Object.entries(hoursObj)) {
        const h = toNumber(raw);
        if (!(h > 0)) continue;
        sum += h;
        addNum(rec.byOperation, opKey, h);
      }

      if (sum > 0) {
        rec.totalHours += sum;
        addNum(rec.byUser, username, sum);
        if (!rec.lastActivity || dateKey > rec.lastActivity) rec.lastActivity = dateKey;
      }
    }

    // 2) Special entries (only those with komNr count into Anlagen)
    const specials = Array.isArray(dayData.specialEntries) ? dayData.specialEntries : [];
    for (const s of specials) {
      const komNr = normalizeKomNr(s?.komNr);
      if (!komNr) continue;

      const h = toNumber(s?.hours);
      if (!(h > 0)) continue;

      if (!out.has(komNr)) {
        out.set(komNr, { totalHours: 0, byOperation: {}, byUser: {}, lastActivity: null });
      }
      const rec = out.get(komNr);

      rec.totalHours += h;
      addNum(rec.byUser, username, h);

      // split specials into regie/fehler buckets
      const t = String(s?.type || '').toLowerCase();
      const bucket = (t === 'fehler') ? 'Fehler' : 'Regie'; // default regie
      addNum(rec.byOperation, bucket, h);

      if (!rec.lastActivity || dateKey > rec.lastActivity) rec.lastActivity = dateKey;
    }
  }

  return out;
}

// Apply delta (new - old) for one user/month submission to the global index.
// Apply a before/after delta when a month transmission changes anlagen data.
function applyAnlagenDelta(teamId, username, newMap, oldMap) {
  const index = readAnlagenIndex();
  if (!index.teams[teamId] || typeof index.teams[teamId] !== 'object') index.teams[teamId] = {};
  const teamObj = index.teams[teamId];

  const allKom = new Set([...(newMap ? newMap.keys() : []), ...(oldMap ? oldMap.keys() : [])]);

  for (const komNr of allKom) {
    const newRec = newMap && newMap.get(komNr) ? newMap.get(komNr) : null;
    const oldRec = oldMap && oldMap.get(komNr) ? oldMap.get(komNr) : null;

    const deltaTotal = (newRec?.totalHours || 0) - (oldRec?.totalHours || 0);
    const deltaOps = new Set([
      ...Object.keys(newRec?.byOperation || {}),
      ...Object.keys(oldRec?.byOperation || {}),
    ]);

    const rec = ensureAnlageRec(teamObj, komNr);

    // totals
    rec.totalHours = round1((Number(rec.totalHours || 0)) + deltaTotal);

    // byOperation
    for (const opKey of deltaOps) {
      const dv = (Number(newRec?.byOperation?.[opKey] || 0)) - (Number(oldRec?.byOperation?.[opKey] || 0));
      addNum(rec.byOperation, opKey, dv);
    }
    cleanupZeroish(rec.byOperation);

    // byUser (only update this user key)
    const du = (Number(newRec?.byUser?.[username] || 0)) - (Number(oldRec?.byUser?.[username] || 0));
    addNum(rec.byUser, username, du);
    cleanupZeroish(rec.byUser);

    // lastActivity: best-effort monotonic update (does not decrease)
    if (newRec?.lastActivity) {
      if (!rec.lastActivity || newRec.lastActivity > rec.lastActivity) rec.lastActivity = newRec.lastActivity;
    }

    // if record is effectively empty, remove it
    if (!(rec.totalHours > 0) || Object.keys(rec.byUser).length === 0) {
      // if totalHours ended up negative or zero, clamp and delete
      if (!(rec.totalHours > 0)) {
        delete teamObj[komNr];
      }
    }
  }

  // persist
  writeAnlagenIndex(index);
  return index;
}


function rebuildAnlagenIndex() {
  const index = { version: 1, updatedAt: null, teams: {} };

  // group transmissions by user + month -> latest sentAt
  for (const u of USERS) {
    const userDir = getUserDir(u.username);
    const indexPath = path.join(userDir, 'index.json');
    const transmissions = safeReadJson(indexPath, []);

    if (!Array.isArray(transmissions) || transmissions.length === 0) continue;

    const latestByMonth = new Map(); // "YYYY-MM" -> meta
    for (const tx of transmissions) {
      if (!tx || typeof tx.year !== 'number' || typeof tx.monthIndex !== 'number' || !tx.sentAt || !tx.id) continue;
      const monthNum = tx.monthIndex + 1;
      const mk = `${tx.year}-${String(monthNum).padStart(2, '0')}`;
      const existing = latestByMonth.get(mk);
      if (!existing) {
        latestByMonth.set(mk, tx);
        continue;
      }
      const dA = new Date(existing.sentAt);
      const dB = new Date(tx.sentAt);
      if (!Number.isNaN(dB.getTime()) && (Number.isNaN(dA.getTime()) || dB > dA)) {
        latestByMonth.set(mk, tx);
      }
    }

    // merge all months for this user
    for (const tx of latestByMonth.values()) {
      const filePath = path.join(userDir, tx.id);
      const sub = safeReadJson(filePath, null);
      if (!sub) continue;

      const teamId = (sub.teamId || u.teamId || '') || 'unknown';
      if (!index.teams[teamId]) index.teams[teamId] = {};
      const teamObj = index.teams[teamId];

      const local = extractAnlagenFromSubmission(sub, u.username);
      for (const [komNr, rec] of local.entries()) {
        const g = ensureAnlageRec(teamObj, komNr);
        g.totalHours = round1((Number(g.totalHours || 0)) + (Number(rec.totalHours || 0)));
        for (const [k, v] of Object.entries(rec.byOperation || {})) addNum(g.byOperation, k, v);
        for (const [name, v] of Object.entries(rec.byUser || {})) addNum(g.byUser, name, v);
        if (rec.lastActivity && (!g.lastActivity || rec.lastActivity > g.lastActivity)) g.lastActivity = rec.lastActivity;

        cleanupZeroish(g.byOperation);
        cleanupZeroish(g.byUser);
      }
    }
  }

  writeAnlagenIndex(index);
  return index;
}


// POST /api/admin/anlagen-export-pdf
// body: { teamId, komNr, donutPngDataUrl?, usersPngDataUrl? }
// ============================================================================
// Anlagen routes
// ============================================================================
app.post('/api/admin/anlagen-export-pdf', requireAuth, requireAdmin, exportPdfBody, (req, res) => {
  const teamId = String(req.body?.teamId || req.user.teamId || '');
  const komNr = normalizeKomNr(req.body?.komNr);

  if (!teamId) return res.status(400).json({ ok: false, error: 'Missing teamId' });
  if (!komNr) return res.status(400).json({ ok: false, error: 'Missing komNr' });

 

  const index = readAnlagenIndex();
  const ledger = readAnlagenLedger();
  const meta = readAnlagenArchive(); 

  const teamObj = (index.teams && index.teams[teamId] && typeof index.teams[teamId] === 'object')
    ? index.teams[teamId]
    : {};

  const rec = teamObj[komNr];
  if (!rec) return res.status(404).json({ ok: false, error: 'KomNr not found in index' });

  const ledgerRec = ledger?.[teamId]?.[komNr] || { byUser: {} };
  const teamMeta = (meta?.[teamId] && typeof meta[teamId] === 'object') ? meta[teamId] : {};
  const m = teamMeta[komNr] || null;

  // charts from frontend 
  const donutUrl = req.body?.donutPngDataUrl;
  const usersUrl = req.body?.usersPngDataUrl;


  function dataUrlToPngBuffer(url) {
    if (!url || typeof url !== 'string') return null;
    if (!url.startsWith('data:image/png;base64,')) return null;
    const b64 = url.split(',')[1];
    if (!b64 || b64.length > 8_000_000) return null; // basic size guard
    return Buffer.from(b64, 'base64');
  }

  const donutBuf = dataUrlToPngBuffer(donutUrl);
  const usersBuf = dataUrlToPngBuffer(usersUrl);

  // Stream PDF
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Anlage_${komNr}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  const now = new Date();

  // Title
  doc.fontSize(18).text(`Anlage ${komNr}`, { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(10).text(`Team: ${teamId} · Exportiert am: ${now.toLocaleString('de-CH')}`);
  doc.moveDown(0.6);

  // Archive info
  if (m?.archived) {
    doc.fontSize(10).text(`Archiviert: Ja · am ${new Date(m.archivedAt).toLocaleString('de-CH')} · von ${m.archivedBy || '-'}`);
    doc.moveDown(0.6);
  }

  // Summary
  doc.fontSize(12).text('Zusammenfassung', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(14).text(`Total Stunden: ${(Number(rec.totalHours || 0)).toFixed(1).replace('.', ',')} h`);
  doc.fontSize(10).text(`Letzte Aktivität: ${rec.lastActivity ? rec.lastActivity : '–'}`);
  doc.moveDown(0.6);

  // Charts

  doc.moveDown(0.3);

  const startX = doc.x;
  const yBefore = doc.y;

// --- Charts block (stable layout) ---
const pageInnerW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
const x = doc.page.margins.left;

const colGap = 18;
const colW = (pageInnerW - colGap) / 2;


const donutBoxW = Math.floor(colW);
const donutBoxH = donutBoxW;


const usersBoxW = Math.floor(colW);
const usersBoxH = donutBoxH;

doc.moveDown(0.4);

const chartsTopY = doc.y;


doc.save();
doc.lineWidth(1).strokeColor('#E5E7EB');
doc.rect(x, chartsTopY, colW, donutBoxH).stroke();
doc.rect(x + colW + colGap, chartsTopY, colW, donutBoxH).stroke();
doc.restore();

// Draw images centered inside their boxes (preserves aspect ratio)
if (donutBuf) {
  doc.image(donutBuf, x, chartsTopY, {
    fit: [donutBoxW, donutBoxH],
    align: 'center',
    valign: 'center',
  });
} else {
  doc.fontSize(9).fillColor('#6B7280').text('Donut Chart nicht vorhanden.', x + 10, chartsTopY + 10, { width: colW - 20 });
  doc.fillColor('black');
}

if (usersBuf) {
  doc.image(usersBuf, x + colW + colGap, chartsTopY, {
    fit: [usersBoxW, usersBoxH],
    align: 'center',
    valign: 'center',
  });
} else {
  doc.fontSize(9).fillColor('#6B7280').text('User Chart nicht vorhanden.', x + colW + colGap + 10, chartsTopY + 10, { width: colW - 20 });
  doc.fillColor('black');
}

// IMPORTANT: push the cursor below the chart block explicitly
doc.y = chartsTopY + donutBoxH + 18;


  // Operations table (from index.byOperation)
  doc.fontSize(12).text('Stunden nach Tätigkeit', { underline: true });
  doc.moveDown(0.3);

  const ops = Object.entries(rec.byOperation || {})
    .map(([key, hours]) => ({ key, hours: Number(hours) || 0 }))
    .filter((x) => x.hours > 0)
    .sort((a, b) => b.hours - a.hours);

  ops.forEach((o) => {
    const label = getOperationLabel(o.key);
    doc.fontSize(10).text(`${label}: ${o.hours.toFixed(1).replace('.', ',')} h`);
  });

  doc.moveDown(0.6);

  // Users totals (from index.byUser)
  doc.fontSize(12).text('Stunden nach Mitarbeiter', { underline: true });
  doc.moveDown(0.3);

  const users = Object.entries(rec.byUser || {})
    .map(([u, h]) => ({ u, h: Number(h) || 0 }))
    .filter((x) => x.h > 0)
    .sort((a, b) => b.h - a.h);

  users.forEach((u) => {
    doc.fontSize(10).text(`${u.u}: ${u.h.toFixed(1).replace('.', ',')} h`);
  });

  doc.moveDown(0.8);

  // Daily ledger appendix (server-side truth)
  doc.fontSize(12).text('Tagesjournal', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9).text('Pro Mitarbeiter die Tages-Summen für diese Anlage.');

  const ledgerByUser = ledgerRec?.byUser || {};
  const userNames = Object.keys(ledgerByUser).sort((a, b) => a.localeCompare(b, 'de'));

  for (const uname of userNames) {
    const byDate = ledgerByUser[uname]?.byDate || {};
    const dates = Object.keys(byDate).sort(); // ascending

    if (dates.length === 0) continue;

    // page break guard
    if (doc.y > 760) doc.addPage();

    doc.moveDown(0.5);
    doc.fontSize(10).text(uname, { underline: true });

    for (const dk of dates) {
    const h = Number(byDate[dk]) || 0;
    if (!(h > 0)) continue;
    if (doc.y > 780) doc.addPage();

    const dateLabel = formatDateDisplayEU(dk);
    doc.fontSize(9).text(`${dateLabel}: ${h.toFixed(1).replace('.', ',')} h`);
  }
  }

  doc.end();
});


// ---- Admin: Anlagen summary (global) ----
// GET /api/admin/anlagen-summary?teamId=montage&status=active|archived|all&search=123
app.get('/api/admin/anlagen-summary', requireAuth, requireAdmin, (req, res) => {
  const status = String(req.query.status || 'active'); // default hide archived
  const teamId = String(req.query.teamId || req.user.teamId || '');

  if (!teamId) return res.status(400).json({ ok: false, error: 'Missing teamId' });

  const search = String(req.query.search || '').trim();
  const index = readAnlagenIndex();
  const teamObj = (index.teams && index.teams[teamId] && typeof index.teams[teamId] === 'object')
    ? index.teams[teamId]
    : {};

  const archive = readAnlagenArchive();
  const teamArchive = (archive[teamId] && typeof archive[teamId] === 'object') ? archive[teamId] : {};

  const list = Object.entries(teamObj).map(([komNr, rec]) => {
    const m = teamArchive[komNr] || null;
    const archived = !!(m && m.archived);

    // compute top operation (exclude _special)
    let topOpKey = null;
    let topOpHours = 0;
    for (const [k, v] of Object.entries(rec.byOperation || {})) {
      const h = Number(v) || 0;
      if (k === '_special') continue;
      if (h > topOpHours) {
        topOpHours = h;
        topOpKey = k;
      }
    }

    return {
      komNr,
      totalHours: round1(rec.totalHours || 0),
      lastActivity: rec.lastActivity || null,
      topOperationKey: topOpKey,
      archived,
      archivedAt: m?.archivedAt || null,
      archivedBy: m?.archivedBy || null,
    };
  });

  const filtered = list.filter((a) => {
    if (search && !String(a.komNr).includes(search)) return false;
    if (status === 'all') return true;
    if (status === 'archived') return !!a.archived;
    return !a.archived; // active
  });

  filtered.sort((a, b) => (b.totalHours || 0) - (a.totalHours || 0));

  return res.json({
    ok: true,
    teamId,
    updatedAt: index.updatedAt || null,
    anlagen: filtered,
  });
});

// ---- Admin: Anlage detail (global) ----
// GET /api/admin/anlagen-detail?komNr=12345&teamId=montage
app.get('/api/admin/anlagen-detail', requireAuth, requireAdmin, (req, res) => {
  const teamId = String(req.query.teamId || req.user.teamId || '');
  const komNr = normalizeKomNr(req.query.komNr);

  if (!teamId) return res.status(400).json({ ok: false, error: 'Missing teamId' });
  if (!komNr) return res.status(400).json({ ok: false, error: 'Missing komNr' });

  const index = readAnlagenIndex();
  const teamObj = (index.teams && index.teams[teamId] && typeof index.teams[teamId] === 'object')
    ? index.teams[teamId]
    : {};

  const rec = teamObj[komNr];
  if (!rec) {
    return res.status(404).json({ ok: false, error: 'Anlage not found' });
  }

  const archive = readAnlagenArchive();
  const teamArchive = (archive[teamId] && typeof archive[teamId] === 'object') ? archive[teamId] : {};
  const m = teamArchive[komNr] || null;

  const operations = Object.entries(rec.byOperation || {})
    .map(([key, hours]) => ({ key, hours: round1(hours) }))
    .sort((a, b) => b.hours - a.hours);

  const users = Object.entries(rec.byUser || {})
    .map(([username, hours]) => ({ username, hours: round1(hours) }))
    .sort((a, b) => b.hours - a.hours);

  return res.json({
    ok: true,
    teamId,
    komNr,
    totalHours: round1(rec.totalHours || 0),
    lastActivity: rec.lastActivity || null,
    operations,
    users,
    archived: !!(m && m.archived),
    archivedAt: m?.archivedAt || null,
    archivedBy: m?.archivedBy || null,
    updatedAt: index.updatedAt || null,
  });
});

// ---- Admin: archive/unarchive Anlage ----
// POST /api/admin/anlagen-archive
// body: { teamId, komNr, archived: true|false }
app.post('/api/admin/anlagen-archive', requireAuth, requireAdmin, (req, res) => {
  const teamId = String(req.body?.teamId || req.user.teamId || '');
  const komNr = normalizeKomNr(req.body?.komNr);
  const archived = !!req.body?.archived;

  if (!teamId) return res.status(400).json({ ok: false, error: 'Missing teamId' });
  if (!komNr) return res.status(400).json({ ok: false, error: 'Missing komNr' });

  const meta = readAnlagenArchive();
  const teamMeta = (meta[teamId] && typeof meta[teamId] === 'object') ? meta[teamId] : {};

  if (archived) {
    teamMeta[komNr] = {
      archived: true,
      archivedAt: new Date().toISOString(),
      archivedBy: req.user.username,
    };
  } else {
    delete teamMeta[komNr];
  }

  if (Object.keys(teamMeta).length === 0) delete meta[teamId];
  else meta[teamId] = teamMeta;

  try {
    writeAnlagenArchive(meta);
  } catch (e) {
    console.error('Failed to write anlagenArchive.json:', e);
    return res.status(500).json({ ok: false, error: 'Could not persist archive state' });
  }

  return res.json({
    ok: true,
    teamId,
    komNr,
    archived,
    archivedAt: archived ? teamMeta[komNr]?.archivedAt : null,
    archivedBy: archived ? teamMeta[komNr]?.archivedBy : null,
  });
});

// ---- Admin: rebuild Anlagen index  ----
// POST /api/admin/anlagen-rebuild
app.post('/api/admin/anlagen-rebuild', requireAuth, requireAdmin, (req, res) => {
  try {
    const idx = rebuildAnlagenIndex();
    return res.json({ ok: true, updatedAt: idx.updatedAt || null });
  } catch (e) {
    console.error('Anlagen rebuild failed:', e);
    return res.status(500).json({ ok: false, error: 'Rebuild failed' });
  }
});

// ---- Month transmission routes ----

// Receive monthly transmission (protected)
// ============================================================================
// User month transmission routes
// ============================================================================
// The transmission endpoint is the authoritative handoff from local draft data
// to server-stored month snapshots that admin/payroll features can safely consume.
app.post('/api/transmit-month', requireAuth, (req, res) => {
  const payload = req.body;

  console.log('Received monthly transmission from', req.user.username);
  console.log(JSON.stringify(payload, null, 2));

  // Basic validation
  if (
    typeof payload.year !== 'number' ||
    typeof payload.monthIndex !== 'number' ||
    typeof payload.monthLabel !== 'string'
  ) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  // Logged-in user → we store by username
  const userId = req.user.username;

  // ---- Enforce week locks on server side (freeze locked weeks) ----
  let payloadToSave = payload;


  // Load previous submission once (needed for lock enforcement AND Anlagen delta)
  let previousMonthSubmission = null;
  try {
    previousMonthSubmission = loadLatestMonthSubmission(userId, payload.year, payload.monthIndex);
  } catch (e) {
    console.error('Failed to load previous month submission (continuing as first transmission):', e);
    previousMonthSubmission = null;
  }

  // 1) Read locks (hard fail if unreadable)
  let allLocks;
  try {
    allLocks = readWeekLocks();
  } catch (e) {
    console.error('Failed to read weekLocks.json:', e);
    return res.status(500).json({ ok: false, error: 'Lock file unreadable. Please contact admin.' });
  }

  // 2) Enforce locks (hard fail if enforcement breaks)
  try {
    const userLocks = (allLocks[userId] && typeof allLocks[userId] === 'object')
      ? allLocks[userId]
      : {};

    const { lockedDateKeys, lockedWeekKeys } =
      collectLockedDatesForMonth(userLocks, payload.year, payload.monthIndex);

    if (lockedDateKeys.size > 0) {
      const previous = previousMonthSubmission;

      if (previous) {
        payloadToSave = mergeLockedWeeksPayload(payload, previous, lockedDateKeys);
        payloadToSave._lockInfo = {
          preservedWeekKeys: Array.from(lockedWeekKeys),
          preservedDaysCount: lockedDateKeys.size,
        };
      }
    }
  } catch (e) {
    console.error('Lock enforcement failed:', e);
    return res.status(500).json({ ok: false, error: 'Could not enforce locks. Submission rejected.' });
  }
    

  const monthNumber = payload.monthIndex + 1; // 0–11 -> 1–12
  const monthStr = String(monthNumber).padStart(2, '0');

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');

  const fileName = `${payload.year}-${monthStr}-${timestamp}.json`;

  const userDir = getUserDir(userId);
  const filePath = path.join(userDir, fileName);

  const totals = computeTransmissionTotals(payloadToSave);

  const submission = {
    ...payloadToSave,
    userId,
    teamId: req.user.teamId || null,
    receivedAt: now.toISOString(),
    totals,
  };


  // 1) Save full submission
  try {
    fs.writeFileSync(filePath, JSON.stringify(submission, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save submission:', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Could not save data on server' });
  }


  // 2) Update user's index.json (simple list of transmissions)
  const indexPath = path.join(userDir, 'index.json');
  let index = [];
  try {
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf8');
      index = JSON.parse(raw);
      if (!Array.isArray(index)) index = [];
    }
  } catch (err) {
    console.warn('Could not read existing index.json, starting fresh', err);
    index = [];
  }

  const stats = fs.statSync(filePath);
  const meta = {
    id: fileName,
    year: payload.year,
    monthIndex: payload.monthIndex,
    monthLabel: payload.monthLabel,
    sentAt: now.toISOString(),
    sizeBytes: stats.size,
    totals,
  };

  index.push(meta);

  try {
    writeJsonAtomic(indexPath, index);
  } catch (err) {
  console.error('Failed to update index.json:', err);

  // Remove the just-saved submission file 
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (unlinkErr) {
    console.error('Failed to delete submission file after index.json failure:', unlinkErr);
  }

  return res.status(500).json({
    ok: false,
    error: 'Could not persist submission index.json. Submission rejected.',
  });
}


 
      // ---- Strict persisted side effects: Anlagen + Konten ----
  const strictTeamId = String(req.user.teamId || '');
  const strictUsername = req.user.username;
  const strictYear = payload.year;
  const strictMonthIndex = payload.monthIndex;

  const kontenBackup = deepCloneJson(readKonten());
  const anlagenIndexBackup = deepCloneJson(readAnlagenIndex());
  const anlagenLedgerBackup = deepCloneJson(readAnlagenLedger());
  const anlagenMonthSnapshotBackup = deepCloneJson(
    readAnlagenSnapshot(strictUsername, strictYear, strictMonthIndex)
  );

  try {
    if (strictTeamId) {
      const oldSnap = readAnlagenSnapshot(
        strictUsername,
        strictYear,
        strictMonthIndex
      );
      const newSnap = extractAnlagenSnapshotFromPayload(
        payloadToSave,
        strictUsername
      );

      const index = readAnlagenIndex();
      const ledger = readAnlagenLedger();

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

      writeAnlagenIndex(index);
      writeAnlagenLedger(ledger);
      writeAnlagenSnapshot(
        strictUsername,
        strictYear,
        strictMonthIndex,
        newSnap
      );
    }

    updateKontenFromSubmission({
      username: strictUsername,
      teamId: req.user.teamId || null,
      year: strictYear,
      monthIndex: strictMonthIndex,
      totals,
      payload: payloadToSave,
      updatedBy: strictUsername,
    });
  } catch (e) {
    console.error('Strict transmission side-effect failed:', e);

    try {
      writeJsonAtomic(KONTEN_PATH, kontenBackup);
    } catch (rollbackErr) {
      console.error('Failed to restore konten backup:', rollbackErr);
    }

    try {
      writeJsonAtomic(ANLAGEN_INDEX_PATH, anlagenIndexBackup);
    } catch (rollbackErr) {
      console.error('Failed to restore anlagenIndex backup:', rollbackErr);
    }

    try {
      writeJsonAtomic(ANLAGEN_LEDGER_PATH, anlagenLedgerBackup);
    } catch (rollbackErr) {
      console.error('Failed to restore anlagenLedger backup:', rollbackErr);
    }

    try {
      const snapshotPath = getSnapshotPath(
        strictUsername,
        strictYear,
        strictMonthIndex
      );

      if (anlagenMonthSnapshotBackup == null) {
        if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
      } else {
        writeJsonAtomic(snapshotPath, anlagenMonthSnapshotBackup);
      }
    } catch (rollbackErr) {
      console.error('Failed to restore anlagen month snapshot backup:', rollbackErr);
    }

    try {
      rollbackTransmissionIndex(indexPath, fileName);
    } catch (rollbackErr) {
      console.error('Failed to roll back transmission index:', rollbackErr);
    }

    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (rollbackErr) {
      console.error('Failed to delete rolled-back submission file:', rollbackErr);
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
app.get('/api/transmissions', requireAuth, (req, res) => {
  const userId = req.user.username; // consistent with above
  const userDir = getUserDir(userId);
  const indexPath = path.join(userDir, 'index.json');

  let index = [];
  try {
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf8');
      index = JSON.parse(raw);
      if (!Array.isArray(index)) index = [];
    }
  } catch (err) {
    console.error('Failed to read index.json:', err);
    index = [];
  }

  res.json({
    ok: true,
    transmissions: index,
  });
});


// ---- Absenzen: user APIs ----

// GET /api/absences  -> list my absences
// ============================================================================
// Absence routes (user + admin)
// ============================================================================
app.get('/api/absences', requireAuth, (req, res) => {
  const username = req.user.username;
  return res.json({ ok: true, absences: readUserAbsences(username) });
});

// POST /api/absences -> create absence request
app.post('/api/absences', requireAuth, (req, res) => {
  const username = req.user.username;
  const teamId = req.user.teamId || null;

  const type = String(req.body?.type || '').trim();
  const from = String(req.body?.from || '').slice(0, 10);
  const to = String(req.body?.to || '').slice(0, 10);
  const comment = String(req.body?.comment || '').trim();
  const daysRaw = req.body?.days;
  const days = (daysRaw === '' || daysRaw == null) ? null : Number(daysRaw);

  if (!type) return res.status(400).json({ ok: false, error: 'Missing type' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ ok: false, error: 'Invalid from/to (YYYY-MM-DD)' });
  }
  if (days != null && (!Number.isFinite(days) || days < 0)) {
    return res.status(400).json({ ok: false, error: 'Invalid days' });
  }

  const idFromClient = String(req.body?.id || '').trim();
  const id =
    (idFromClient && idFromClient.length <= 80)
      ? idFromClient
      : `abs-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;

  const record = {
    id,
    username,
    teamId,
    type,
    from,
    to,
    days,
    comment,
    status: 'pending',
    createdAt: new Date().toISOString(),
    createdBy: username,
    decidedAt: null,
    decidedBy: null,
  };

  const list = readUserAbsences(username);
  list.push(record);
  writeUserAbsences(username, list);

  return res.json({ ok: true, absence: record });
});

// DELETE /api/absences/:id -> user can cancel only if pending
app.delete('/api/absences/:id', requireAuth, (req, res) => {
  const username = req.user.username;
  const id = String(req.params.id || '');

  const list = readUserAbsences(username);
  const idx = list.findIndex((a) => a && a.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });

  const item = list[idx];
  if (item.status !== 'pending') {
    return res.status(409).json({ ok: false, error: 'Only pending absences can be cancelled' });
  }

  list.splice(idx, 1);
  writeUserAbsences(username, list);

  return res.json({ ok: true });
});


// POST /api/absences/:id/cancel
// - if pending -> cancelled (user self-service)
// - if accepted -> cancel_requested (admin must approve)
// - if rejected/cancelled -> no-op or conflict (your choice)
app.post('/api/absences/:id/cancel', requireAuth, (req, res) => {
  const username = req.user.username;
  const id = String(req.params.id || '');

  const list = readUserAbsences(username);
  const item = list.find((a) => a && a.id === id);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });

  if (item.status === 'pending') {
    item.status = 'cancelled';
    item.decidedAt = new Date().toISOString();
    item.decidedBy = username; // self-cancel
    writeUserAbsences(username, list);
    return res.json({ ok: true, absence: item });
  }

  if (item.status === 'accepted') {
    item.status = 'cancel_requested';
    item.cancelRequestedAt = new Date().toISOString();
    item.cancelRequestedBy = username;
    writeUserAbsences(username, list);
    return res.json({ ok: true, absence: item });
  }


  return res.status(409).json({ ok: false, error: 'Cannot cancel in this state' });
});


// ---- Absenzen: admin APIs ----

// GET /api/admin/absences?status=pending|accepted|rejected|all
app.get('/api/admin/absences', requireAuth, requireAdmin, (req, res) => {
  const status = String(req.query.status || 'pending');

  const all = [];
  USERS.forEach((u) => {
    const list = readUserAbsences(u.username);
    list.forEach((a) => all.push(a));
  });

  const filtered =
    (status === 'all')
      ? all
      : all.filter((a) => a && a.status === status);

  // sort newest first
  filtered.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  res.json({ ok: true, absences: filtered });
});

// POST /api/admin/absences/decision
// body: { username, id, status: 'accepted'|'rejected' }
app.post('/api/admin/absences/decision', requireAuth, requireAdmin, (req, res) => {
  const username = String(req.body?.username || '');
  const id = String(req.body?.id || '');
  const status = String(req.body?.status || '');

  if (!username || !USERS.find((u) => u.username === username)) {
    return res.status(400).json({ ok: false, error: 'Invalid username' });
  }
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
  const allowed = new Set(['accepted', 'rejected', 'cancelled']);
  if (!allowed.has(status)) {
  return res.status(400).json({ ok: false, error: 'Invalid status' });
}

 
const list = readUserAbsences(username);
  const item = list.find((a) => a && a.id === id);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });

  const previousStatus = item.status;
  
  item.status = status;
  item.decidedAt = new Date().toISOString();
  item.decidedBy = req.user.username;

  writeUserAbsences(username, list);

  // Restore vacation days when cancelling an accepted/cancel_requested Ferien absence
  let vacationRestored = 0;
  if (status === 'cancelled' && (previousStatus === 'accepted' || previousStatus === 'cancel_requested')) {
    const vacDays = calculateAbsenceVacationDays(item);
    
    if (vacDays > 0) {
      // Check if any month in the absence range was transmitted (has a snapshot)
      const kontenData = readKonten();
      const userSnapshots = kontenData.snapshots[username] || {};
      
      // Get months covered by this absence
      let fromDate = new Date(item.from + 'T00:00:00');
      let toDate = new Date(item.to + 'T00:00:00');
      if (toDate < fromDate) { const tmp = fromDate; fromDate = toDate; toDate = tmp; }
      
      const affectedMonths = new Set();
      const cursor = new Date(fromDate);
      while (cursor <= toDate) {
        const mk = kontenMonthKey(cursor.getFullYear(), cursor.getMonth());
        affectedMonths.add(mk);
        cursor.setMonth(cursor.getMonth() + 1);
        cursor.setDate(1);
      }
      
      // Check if any affected month was transmitted
      const hasTransmittedMonth = Array.from(affectedMonths).some(mk => userSnapshots[mk]);
      
      if (hasTransmittedMonth) {
        const userKonto = ensureKontenUser(kontenData, username, null);
        userKonto.vacationDays += vacDays;
        userKonto.updatedAt = new Date().toISOString();
        userKonto.updatedBy = req.user.username;
        
        // Update snapshots to prevent double-restoration on re-transmission
        Array.from(affectedMonths).forEach(mk => {
          if (userSnapshots[mk] && userSnapshots[mk].vacUsed > 0) {
            // Reduce the recorded vacUsed (but not below 0)
            userSnapshots[mk].vacUsed = Math.max(0, userSnapshots[mk].vacUsed - vacDays);
          }
        });
        
        writeKonten(kontenData);
        vacationRestored = vacDays;
        
        console.log(`Restored ${vacDays} vacation days for ${username} (absence ${id} cancelled)`);
      }  
    }
  }

  return res.json({ ok: true, absence: item, vacationRestored });
});


// ---- Konten APIs ----

// GET /api/konten/me
// ============================================================================
// Konten routes
// ============================================================================
app.get('/api/konten/me', requireAuth, (req, res) => {
  const data = readKonten();
  const username = req.user.username;
  const u = ensureKontenUser(data, username, req.user.teamId || null);
  // ensure persisted structure if it was missing
  writeKonten(data);

  // Get list of transmitted months (from snapshots)
  const userSnapshots = data.snapshots[username] || {};
  const transmittedMonths = Object.keys(userSnapshots); // e.g. ["2025-01", "2025-02"]

  res.json({ 
    ok: true, 
    konto: u,
    transmittedMonths 
  });
});

// GET /api/admin/konten
app.get('/api/admin/konten', requireAuth, requireAdmin, (req, res) => {
  const data = readKonten();

  USERS.forEach((u) => ensureKontenUser(data, u.username, u.teamId || null));
  writeKonten(data);

  const rows = USERS.map((u) => ({ username: u.username, teamId: u.teamId || null, konto: data.users[u.username] }));
  res.json({ ok: true, users: rows });
});

// POST /api/admin/konten/set
// body: { username, ueZ1, ueZ2, ueZ3, vacationDays, vacationDaysPerYear }
app.post('/api/admin/konten/set', requireAuth, requireAdmin, (req, res) => {
  const username = String(req.body?.username || '');
  if (!username || !USERS.find((u) => u.username === username)) {
    return res.status(400).json({ ok: false, error: 'Invalid username' });
  }

  const data = readKonten();
  const user = ensureKontenUser(data, username, USERS.find((u) => u.username === username)?.teamId || null);

  const fields = ['ueZ1','ueZ2','ueZ3','vacationDays','vacationDaysPerYear'];
  fields.forEach((k) => {
    if (req.body[k] == null) return;
    const n = Number(req.body[k]);
    if (Number.isFinite(n)) user[k] = n;
  });

  user.updatedAt = new Date().toISOString();
  user.updatedBy = req.user.username;

  writeKonten(data);

  res.json({ ok: true, konto: user });
});


      // ---- Admin: month overview (per user, month-specific) ----
// ============================================================================
// Admin month overview and day detail routes
// ============================================================================
app.get(
  '/api/admin/month-overview',
  requireAuth,
  requireAdmin,
  (req, res) => {
    const year = Number(req.query.year);
    const monthIndex = Number(req.query.monthIndex);
    let allLocks;
    try { allLocks = readWeekLocks(); }
    catch (e) { return res.status(500).json({ ok:false, error: e.message }); }

        


    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
      return res.status(400).json({ ok: false, error: 'Invalid year or monthIndex' });
    }

    const monthLabel = makeMonthLabel(year, monthIndex);

    const users = USERS.map((user) => {
      const team = TEAMS.find((t) => t.id === user.teamId) || null;

      // Read index.json (all transmissions) for this user
      const userDir = getUserDir(user.username); // stored by username in your current server
      const indexPath = path.join(userDir, 'index.json');
      const transmissions = safeReadJson(indexPath, []);

      // overall latest for sync pill
      let lastSentAt = null;
      if (Array.isArray(transmissions) && transmissions.length > 0) {
        const latestOverall = transmissions.reduce((best, tx) => {
          if (!tx || !tx.sentAt) return best;
          const d = new Date(tx.sentAt);
          if (Number.isNaN(d.getTime())) return best;
          if (!best) return { tx, date: d };
          return d > best.date ? { tx, date: d } : best;
        }, null);

        if (latestOverall) {
          lastSentAt = latestOverall.date.toISOString();
        }
      }

      // find latest transmission for the selected month
      const monthTxList = Array.isArray(transmissions)
        ? transmissions.filter((tx) => tx && tx.year === year && tx.monthIndex === monthIndex)
        : [];

      let monthTx = null;
      if (monthTxList.length > 0) {
        monthTx = monthTxList.reduce((best, tx) => {
          if (!tx || !tx.sentAt) return best;
          const d = new Date(tx.sentAt);
          if (Number.isNaN(d.getTime())) return best;
          if (!best) return { tx, date: d };
          return d > best.date ? { tx, date: d } : best;
        }, null);
      }

      // default: not transmitted for that month
      if (!monthTx) {
        return {
          userId: user.id,
          username: user.username,
          role: user.role,
          teamId: user.teamId || null,
          teamName: team ? team.name : null,
          lastSentAt,                // for sync pill
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

      // read submission file
      const fileName = monthTx.tx.id;
      const filePath = path.join(userDir, fileName);
      const submission = safeReadJson(filePath, null);

      // If file missing/corrupt, treat as not transmitted (safe fallback)
      if (!submission) {
        return {
          userId: user.id,
          username: user.username,
          role: user.role,
          teamId: user.teamId || null,
          teamName: team ? team.name : null,
          lastSentAt,
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

      const monthStartKey = formatDateKey(new Date(year, monthIndex, 1));
      const monthEndKey = formatDateKey(new Date(year, monthIndex + 1, 0));
      const acceptedAbsenceDays = buildAcceptedAbsenceDaysSet(
        readUserAbsences(user.username),
        monthStartKey,
        monthEndKey
      );

      const overview = buildMonthOverviewFromSubmission(submission, year, monthIndex, acceptedAbsenceDays);

      const userLocks = (allLocks[user.username] && typeof allLocks[user.username] === 'object')
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
        lastSentAt,
        month: {
          year,
          monthIndex,
          monthLabel,
          transmitted: true,
          sentAt: monthTx.date.toISOString(),
          monthTotalHours: overview.monthTotalHours,
          weeks: weeksWithLocks,
        },
      };
    });

    res.json({
      ok: true,
      month: { year, monthIndex, monthLabel },
      users,
    });
  }
);


// ---- Admin: lock/unlock a week ----
// POST /api/admin/week-lock
// body: { username, weekYear, week, locked?: boolean }
app.post('/api/admin/week-lock', requireAuth, requireAdmin, (req, res) => {
  const username = String(req.body?.username || '');
  const weekYear = Number(req.body?.weekYear);
  const week = Number(req.body?.week);
  const lockedParam = req.body?.locked;

  if (!username || !USERS.find((u) => u.username === username)) {
    return res.status(400).json({ ok: false, error: 'Invalid username' });
  }
  if (!Number.isInteger(weekYear) || weekYear < 2000 || weekYear > 2100) {
    return res.status(400).json({ ok: false, error: 'Invalid weekYear' });
  }
  if (!Number.isInteger(week) || week < 1 || week > 53) {
    return res.status(400).json({ ok: false, error: 'Invalid week' });
  }

  let allLocks;
  try { allLocks = readWeekLocks(); }
  catch (e) { return res.status(500).json({ ok:false, error: e.message }); }

  const userLocks = (allLocks[username] && typeof allLocks[username] === 'object')
    ? allLocks[username]
    : {};

  const wk = weekKey(weekYear, week);
  const currentMeta = getLockMeta(userLocks, wk);
  const nextLocked = (typeof lockedParam === 'boolean') ? lockedParam : !currentMeta.locked;

  if (nextLocked) {
    userLocks[wk] = {
      locked: true,
      lockedAt: new Date().toISOString(),
      lockedBy: req.user.username,
    };
  } else {
    delete userLocks[wk];
  }

  // clean-up empty user object
  if (Object.keys(userLocks).length === 0) {
    delete allLocks[username];
  } else {
    allLocks[username] = userLocks;
  }

  try {
    writeWeekLocks(allLocks);
  } catch (e) {
    console.error('Failed to write weekLocks.json', e);
    return res.status(500).json({ ok: false, error: 'Could not persist lock state' });
  }

  const finalMeta = nextLocked ? userLocks[wk] : null;

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
});


// ---- Admin: day details (fetch on demand) ----
// GET /api/admin/day-detail?username=demo&year=2025&monthIndex=11&date=2025-12-01
// Detailed admin inspection for a single transmitted day.
app.get('/api/admin/day-detail', requireAuth, requireAdmin, (req, res) => {
  const username = String(req.query.username || '');
  const year = Number(req.query.year);
  const monthIndex = Number(req.query.monthIndex);
  const dateKey = String(req.query.date || '').slice(0, 10);

  if (!username || !Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return res.status(400).json({ ok: false, error: 'Invalid username/year/monthIndex' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return res.status(400).json({ ok: false, error: 'Invalid date (expected YYYY-MM-DD)' });
  }

  const user = USERS.find((u) => u.username === username);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

  const userDir = getUserDir(user.username);
  const indexPath = path.join(userDir, 'index.json');
  const transmissions = safeReadJson(indexPath, []);

  // find latest transmission for that month
  const monthTxList = Array.isArray(transmissions)
    ? transmissions.filter((tx) => tx && tx.year === year && tx.monthIndex === monthIndex)
    : [];

  if (monthTxList.length === 0) {
    return res.json({
      ok: true,
      username,
      dateKey,
      transmitted: false,
      error: null,
    });
  }

  const latestMonth = monthTxList.reduce((best, tx) => {
    const d = tx && tx.sentAt ? new Date(tx.sentAt) : null;
    if (!d || Number.isNaN(d.getTime())) return best;
    if (!best) return { tx, date: d };
    return d > best.date ? { tx, date: d } : best;
  }, null);

  if (!latestMonth || !latestMonth.tx || !latestMonth.tx.id) {
    return res.json({ ok: true, username, dateKey, transmitted: false, error: null });
  }

  const filePath = path.join(userDir, latestMonth.tx.id);
  const submission = safeReadJson(filePath, null);
  if (!submission) {
    return res.json({ ok: true, username, dateKey, transmitted: false, error: 'Submission file missing/corrupt' });
  }

  const dayData = (submission.days && submission.days[dateKey]) ? submission.days[dateKey] : null;

  // accepted absence covering this day (authoritative store)
  const storedAbsences = readUserAbsences(username);
  const acceptedAbsence = findAcceptedAbsenceForDate(
    storedAbsences.length ? storedAbsences : submission.absences,
    dateKey
  );

  // pikett entries for that date
  const pikettEntries = Array.isArray(submission.pikett)
    ? submission.pikett.filter((p) => p && p.date === dateKey)
    : [];

  const pikettHours = pikettEntries.reduce((sum, p) => sum + toNumber(p.hours), 0);

  // compute hour breakdown
  const komEntries = Array.isArray(dayData?.entries) ? dayData.entries : [];
  const specialEntries = Array.isArray(dayData?.specialEntries) ? dayData.specialEntries : [];
  const flags = (dayData && dayData.flags && typeof dayData.flags === 'object') ? dayData.flags : {};
  const mealAllowance = (dayData && dayData.mealAllowance && typeof dayData.mealAllowance === 'object')
    ? dayData.mealAllowance
    : { '1': false, '2': false, '3': false };

  let komHours = 0;
  komEntries.forEach((e) => {
    if (!e || !e.hours || typeof e.hours !== 'object') return;
    Object.values(e.hours).forEach((v) => (komHours += toNumber(v)));
  });

  let specialHours = 0;
  specialEntries.forEach((s) => (specialHours += toNumber(s?.hours)));

  const dayHoursObj = (dayData && dayData.dayHours && typeof dayData.dayHours === 'object') ? dayData.dayHours : {};
  const schulung = toNumber(dayHoursObj.schulung);
  const sitzungKurs = toNumber(dayHoursObj.sitzungKurs);
  const arztKrank = toNumber(dayHoursObj.arztKrank);
  const dayHoursTotal = schulung + sitzungKurs + arztKrank;

  const nonPikettTotal = komHours + specialHours + dayHoursTotal;
  const totalHours = nonPikettTotal + pikettHours;

  // status (same rule family)
  const ferien = !!flags.ferien;
  let status = 'missing';
  if (ferien) status = 'ferien';
  else if (acceptedAbsence) status = 'absence';
  else if (totalHours > 0) status = 'ok';

  return res.json({
    ok: true,
    username,
    transmitted: true,
    month: { year, monthIndex, monthLabel: submission.monthLabel || makeMonthLabel(year, monthIndex), sentAt: latestMonth.date.toISOString() },
    dateKey,
    status,
    flags,
    mealAllowance,
    acceptedAbsence: acceptedAbsence
      ? { type: acceptedAbsence.type || '', from: acceptedAbsence.from, to: acceptedAbsence.to, comment: acceptedAbsence.comment || '' }
      : null,
    totals: {
      komHours: Math.round(komHours * 10) / 10,
      specialHours: Math.round(specialHours * 10) / 10,
      dayHoursTotal: Math.round(dayHoursTotal * 10) / 10,
      pikettHours: Math.round(pikettHours * 10) / 10,
      totalHours: Math.round(totalHours * 10) / 10,
    },
    breakdown: {
      dayHours: { schulung, sitzungKurs, arztKrank },
    },
    entries: komEntries,
    specialEntries,
    pikettEntries,
  });
});

// ============================================================================
// Payroll helpers and routes
// ============================================================================
app.get('/api/admin/payroll-users', requireAuth, requireAdmin, (req, res) => {
  const teamId = String(req.user.teamId || '');

  const users = USERS
    .filter((u) => u.role === 'user')
    .filter((u) => !teamId || u.teamId === teamId)
    .map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.username,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));

  res.json({
    ok: true,
    users,
  });
});


function getPayrollAbsenceTypeLabel(type) {
  const key = String(type || '').trim().toLowerCase();

  const map = {
    ferien: 'Ferien',
    unfall: 'Unfall',
    militaer: 'Militär',
    bezahlteabwesenheit: 'Bezahlte Abwesenheit',
    vaterschaft: 'Vaterschaftsurlaub',
    sonstiges: 'Sonstiges',
  };

  return map[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Abwesenheit');
}

function isWeekdayDateKey(dateKey) {
  const d = new Date(String(dateKey).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const wd = d.getDay();
  return wd >= 1 && wd <= 5;
}

function ensurePayrollAuditRow(rowMap, dateKey) {
  if (!rowMap.has(dateKey)) {
    rowMap.set(dateKey, {
      dateKey,
      stunden: 0,
      arztKrankHours: 0,
      ferien: false,
      morgenessen: false,
      mittagessen: false,
      abendessen: false,
      schmutzzulage: false,
      nebenauslagen: false,
      pikettHours: 0,
      overtime3Hours: 0,
      absenceLabels: [],
    });
  }
  return rowMap.get(dateKey);
}

// Build one payroll-period card for a single employee using transmitted months only.
function buildPayrollPeriodDataForUser(user, periodStart, periodEnd) {
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
    stunden: 0,
    arztKrankHours: 0,
    ferienDays: 0,
    morgenessenCount: 0,
    mittagessenCount: 0,
    abendessenCount: 0,
    schmutzzulageCount: 0,
    nebenauslagenCount: 0,
    pikettHours: 0,
  };

  const overtime = {
    ueZ1Raw: 0,
    ueZ2: 0,
    ueZ3: 0,
  };

  const selectedYear = periodEnd.getFullYear();
  const yearCfg = getPayrollYearConfig(selectedYear);
  const vorarbeitRequired = Number(yearCfg.vorarbeitRequired) || 0;

  let ytdPositiveUntilEnd = 0;
  let ytdPositiveBeforePeriod = 0;

  const transmittedMonths = [];
  const missingMonths = [];

  for (const month of monthRange) {
    const submission = loadLatestMonthSubmission(
      user.username,
      month.year,
      month.monthIndex
    );

    if (!submission) {
      missingMonths.push(month.monthKey);
      continue;
    }

    transmittedMonths.push(month.monthKey);

    const partial = aggregatePayrollFromSubmission(
      submission,
      fromKey,
      toKey,
      absencesById
    );

    const partialOvertime = computePayrollPeriodOvertimeFromSubmission(
      submission,
      fromKey,
      toKey
    );

    totals.stunden += partial.stunden;
    totals.arztKrankHours += partial.arztKrankHours;
    totals.morgenessenCount += partial.morgenessenCount;
    totals.mittagessenCount += partial.mittagessenCount;
    totals.abendessenCount += partial.abendessenCount;
    totals.schmutzzulageCount += partial.schmutzzulageCount;
    totals.nebenauslagenCount += partial.nebenauslagenCount;
    totals.pikettHours += partial.pikettHours;

    overtime.ueZ1Raw += partialOvertime.ueZ1Raw;
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
      row.stunden += num(computeNonPikettHours(dayData));

      const dayHours =
        dayData.dayHours && typeof dayData.dayHours === 'object'
          ? dayData.dayHours
          : {};

      row.arztKrankHours += num(dayHours.arztKrank);

      const meal =
        dayData.mealAllowance && typeof dayData.mealAllowance === 'object'
          ? dayData.mealAllowance
          : {};

      if (meal['1']) row.morgenessen = true;
      if (meal['2']) row.mittagessen = true;
      if (meal['3']) row.abendessen = true;

      const flags =
        dayData.flags && typeof dayData.flags === 'object'
          ? dayData.flags
          : {};

      if (flags.ferien) row.ferien = true;
      if (flags.schmutzzulage) row.schmutzzulage = true;
      if (flags.nebenauslagen) row.nebenauslagen = true;
    }

    const pikettList = Array.isArray(submission?.pikett) ? submission.pikett : [];
    for (const entry of pikettList) {
      const dateKey = String(entry?.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      if (dateKey < fromKey || dateKey > toKey) continue;

      const row = ensurePayrollAuditRow(auditRowMap, dateKey);
      const h = num(entry?.hours);

      if (entry?.isOvertime3) row.overtime3Hours += h;
      else row.pikettHours += h;
    }

    const absences = Array.isArray(submission?.absences) ? submission.absences : [];
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
    const type = String(abs?.type || '').trim().toLowerCase();
    const status = String(abs?.status || '').trim().toLowerCase();

    if (type === 'ferien' && status === 'accepted') {
      totals.ferienDays += computeAbsenceDaysInPeriod(abs, periodStart, periodEnd);
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

  const selectedYearStart = new Date(selectedYear, 0, 1);
  const selectedYearStartKey = formatDateKey(selectedYearStart);

  const vorarbeitPeriodStart =
    periodStart > selectedYearStart ? periodStart : selectedYearStart;

  const dayBeforeVorarbeitPeriodStart = new Date(vorarbeitPeriodStart);
  dayBeforeVorarbeitPeriodStart.setDate(dayBeforeVorarbeitPeriodStart.getDate() - 1);

  const hasPriorVorarbeitWindow = dayBeforeVorarbeitPeriodStart >= selectedYearStart;
  const priorVorarbeitEndKey = hasPriorVorarbeitWindow
    ? formatDateKey(dayBeforeVorarbeitPeriodStart)
    : null;

  const ytdMonthRange = getMonthRangeBetween(selectedYearStart, periodEnd);

  for (const month of ytdMonthRange) {
    const submission = loadLatestMonthSubmission(
      user.username,
      month.year,
      month.monthIndex
    );

    if (!submission) continue;

    const ytdPartial = computePayrollPeriodOvertimeFromSubmission(
      submission,
      selectedYearStartKey,
      toKey
    );
    ytdPositiveUntilEnd += ytdPartial.ueZ1Positive;

    if (hasPriorVorarbeitWindow) {
      const beforePartial = computePayrollPeriodOvertimeFromSubmission(
        submission,
        selectedYearStartKey,
        priorVorarbeitEndKey
      );
      ytdPositiveBeforePeriod += beforePartial.ueZ1Positive;
    }
  }

  totals.stunden = r1(totals.stunden);
  totals.arztKrankHours = r1(totals.arztKrankHours);
  totals.ferienDays = r1(totals.ferienDays);
  totals.pikettHours = r1(totals.pikettHours);

  overtime.ueZ1Raw = r1(overtime.ueZ1Raw);
  overtime.ueZ2 = r1(overtime.ueZ2);
  overtime.ueZ3 = r1(overtime.ueZ3);

  const vorarbeitFilledAtPeriodEnd = r1(
    Math.min(vorarbeitRequired, Math.max(0, ytdPositiveUntilEnd))
  );

  const vorarbeitFilledBeforePeriod = r1(
    Math.min(vorarbeitRequired, Math.max(0, ytdPositiveBeforePeriod))
  );

  const vorarbeitAppliedInPeriod = r1(
    Math.max(0, vorarbeitFilledAtPeriodEnd - vorarbeitFilledBeforePeriod)
  );

  const ueZ1AfterVorarbeitInPeriod = r1(
    overtime.ueZ1Raw - vorarbeitAppliedInPeriod
  );

  const auditRows = Array.from(auditRowMap.values())
    .map((row) => ({
      dateKey: row.dateKey,
      dateLabel: formatDateDisplayEU(row.dateKey),
      stunden: r1(row.stunden),
      arztKrankHours: r1(row.arztKrankHours),
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
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  return {
    username: user.username,
    displayName: user.username,
    coverage: {
      expectedMonths: monthRange.map((m) => m.monthKey),
      transmittedMonths,
      missingMonths,
    },
    totals,
    overtime: {
      ueZ1Raw: overtime.ueZ1Raw,
      vorarbeitApplied: vorarbeitAppliedInPeriod,
      ueZ1AfterVorarbeit: ueZ1AfterVorarbeitInPeriod,
      ueZ2: overtime.ueZ2,
      ueZ3: overtime.ueZ3,
    },
    vorarbeit: {
      year: selectedYear,
      filled: vorarbeitFilledAtPeriodEnd,
      required: vorarbeitRequired,
      changeInPeriod: vorarbeitAppliedInPeriod,
    },
    auditRows,
  };
}


app.get('/api/admin/payroll-period', requireAuth, requireAdmin, (req, res) => {
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

  const monthRange = getMonthRangeBetween(periodStart, periodEnd);
  const teamId = String(req.user.teamId || '');

  const users = USERS
    .filter((u) => u.role === 'user')
    .filter((u) => !teamId || u.teamId === teamId)
    .sort((a, b) => String(a.username).localeCompare(String(b.username), 'de'));

 const rows = users.map((user) =>
  buildPayrollPeriodDataForUser(user, periodStart, periodEnd)
);

  const summary = {
    usersCount: rows.length,
    completeUsers: rows.filter((r) => r.coverage.missingMonths.length === 0).length,
    incompleteUsers: rows.filter((r) => r.coverage.missingMonths.length > 0).length,
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
});


app.get('/api/admin/payroll-export-pdf', requireAuth, requireAdmin, (req, res) => {
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

  const targetUser = USERS.find(
    (u) =>
      u.role === 'user' &&
      u.username === username &&
      (!teamId || u.teamId === teamId)
  );

  if (!targetUser) {
    return res.status(404).json({
      ok: false,
      error: 'Mitarbeiter wurde nicht gefunden.',
    });
  }

  const row = buildPayrollPeriodDataForUser(targetUser, periodStart, periodEnd);

  const fmtHours = (v) => `${(Number(v) || 0).toFixed(1).replace('.', ',')} h`;
  const fmtSignedHours = (v) => {
    const n = Number(v) || 0;
    const abs = Math.abs(n).toFixed(1).replace('.', ',');
    if (n > 0) return `+${abs} h`;
    if (n < 0) return `-${abs} h`;
    return '0,0 h';
  };
  const fmtDays = (v) => `${String(Number(v) || 0).replace('.', ',')} Tage`;
  const fmtCount = (v) => String(Math.round(Number(v) || 0));

  const safeUser = String(targetUser.username).replace(/[^a-zA-Z0-9_-]+/g, '_');
  const filename = `Lohnabrechnung_${safeUser}_${formatDateKey(periodStart)}_${formatDateKey(periodEnd)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({
    margin: 42,
    size: 'A4',
    info: {
      Title: `Lohnabrechnung ${targetUser.username} ${formatDateKey(periodStart)}-${formatDateKey(periodEnd)}`,
      Author: 'Hours App',
    },
  });

  doc.pipe(res);

  function ensurePdfSpace(height = 24) {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  }

  function sectionTitle(text) {
    ensurePdfSpace(28);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(11).text(text);
    doc.moveDown(0.25);
  }

  function writeMetricLines(items) {
    items.forEach(([label, value]) => {
      ensurePdfSpace(16);
      doc.font('Helvetica-Bold').fontSize(9).text(`${label}: `, { continued: true });
      doc.font('Helvetica').fontSize(9).text(value);
    });
  }

  doc.font('Helvetica-Bold').fontSize(16).text('Lohnabrechnung – Audit Export');
  doc.moveDown(0.4);

  doc.font('Helvetica').fontSize(9).text(`Mitarbeiter: ${row.displayName}`);
  doc.text(`Zeitraum: ${formatDateDisplayEU(formatDateKey(periodStart))} – ${formatDateDisplayEU(formatDateKey(periodEnd))}`);
  doc.text(`Exportiert am: ${new Date().toLocaleString('de-DE')}`);
  doc.text(`Exportiert von: ${req.user.username}`);
  doc.text('Hinweis: Nur übertragene Daten berücksichtigt.');

  sectionTitle('Lohndaten im Zeitraum');
  writeMetricLines([
    ['Arzt / Krank', fmtHours(row.totals.arztKrankHours)],
    ['Ferien', fmtDays(row.totals.ferienDays)],
    ['Stunden', fmtHours(row.totals.stunden)],
    ['Morgenessen', fmtCount(row.totals.morgenessenCount)],
    ['Mittagessen', fmtCount(row.totals.mittagessenCount)],
    ['Abendessen', fmtCount(row.totals.abendessenCount)],
    ['Schmutzzulage', fmtCount(row.totals.schmutzzulageCount)],
    ['Nebenauslagen', fmtCount(row.totals.nebenauslagenCount)],
    ['Pikett', fmtHours(row.totals.pikettHours)],
  ]);

  sectionTitle('Überzeit in dieser Lohnperiode');
  writeMetricLines([
    ['ÜZ1 roh', fmtSignedHours(row.overtime.ueZ1Raw)],
    ['Vorarbeit angerechnet', fmtSignedHours(row.overtime.vorarbeitApplied)],
    ['ÜZ1 nach Vorarbeit', fmtSignedHours(row.overtime.ueZ1AfterVorarbeit)],
    ['ÜZ2', fmtSignedHours(row.overtime.ueZ2)],
    ['ÜZ3', fmtSignedHours(row.overtime.ueZ3)],
  ]);

  sectionTitle(`Vorarbeitszeit (${row.vorarbeit.year || '–'})`);
  writeMetricLines([
    ['Stand per Periodenende', `${(Number(row.vorarbeit.filled) || 0).toFixed(1).replace('.', ',')} / ${(Number(row.vorarbeit.required) || 0).toFixed(1).replace('.', ',')} h`],
    ['Änderung im Zeitraum', fmtSignedHours(row.vorarbeit.changeInPeriod)],
  ]);

  sectionTitle('Berücksichtigte Übertragungen');
  writeMetricLines([
    ['Monate berücksichtigt', (row.coverage.transmittedMonths || []).join(', ') || '–'],
    ['Monate fehlend', (row.coverage.missingMonths || []).join(', ') || '–'],
  ]);

  sectionTitle('Tagesdetails');
  if (!row.auditRows.length) {
    doc.font('Helvetica').fontSize(9).text('Keine relevanten Einträge im ausgewählten Zeitraum.');
  } else {
    row.auditRows.forEach((entry) => {
      ensurePdfSpace(42);

      doc.font('Helvetica-Bold').fontSize(9).text(entry.dateLabel);

      doc.font('Helvetica').fontSize(8.5).text(
        `Stunden: ${fmtHours(entry.stunden)}   |   Arzt/Krank: ${fmtHours(entry.arztKrankHours)}   |   Ferien: ${entry.ferien ? 'Ja' : 'Nein'}`
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
});


// ============================================================================
// Admin transmission summary route
// ============================================================================
// Only accessible for admins
app.get(
  '/api/admin/transmissions-summary',
  requireAuth,
  requireAdmin,
  (req, res) => {
    const summaries = USERS.map((user) => {
      const userDir = getUserDir(user.username); // stored by username
      const indexPath = path.join(userDir, 'index.json');

      let transmissions = [];
      if (fs.existsSync(indexPath)) {
        try {
          const raw = fs.readFileSync(indexPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            transmissions = parsed;
          }
        } catch (err) {
          console.warn(
            `Could not read index.json for user ${user.username}`,
            err
          );
        }
      }


      const transmissionsCount = transmissions.length;
      let lastSentAt = null;
      let lastMonthLabel = null;

      let lastTotals = null;

      if (transmissionsCount > 0) {
        const latest = transmissions.reduce((best, tx) => {
          if (!tx.sentAt) return best;
          const d = new Date(tx.sentAt);
          if (Number.isNaN(d.getTime())) return best;

          if (!best) return { tx, date: d };
          return d > best.date ? { tx, date: d } : best;
        }, null);

        if (latest) {
          lastSentAt = latest.date.toISOString();
          lastMonthLabel = latest.tx.monthLabel || null;

          // NEW: totals (prefer meta.totals, fallback read full file for older data)
          if (latest.tx.totals) {
            lastTotals = latest.tx.totals;
          } else {
            const fullPath = path.join(userDir, latest.tx.id);
            if (fs.existsSync(fullPath)) {
              try {
                const raw = fs.readFileSync(fullPath, 'utf8');
                const parsed = JSON.parse(raw);
                lastTotals = parsed.totals || computeTransmissionTotals(parsed);
              } catch (e) {
                // ignore
              }
            }
          }
        }
      }


      const team = TEAMS.find((t) => t.id === user.teamId) || null;

      return {
        userId: user.id,
        username: user.username,
        role: user.role,
        teamId: user.teamId || null,
        teamName: team ? team.name : null,
        transmissionsCount,
        lastSentAt,
        lastMonthLabel,
        lastTotals,
      };
    });

    res.json({
      ok: true,
      users: summaries,
    });
  }
);


app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// ============================================================================
// Server startup
// ============================================================================
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
