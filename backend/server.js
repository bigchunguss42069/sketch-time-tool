const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// ---- Middleware ----
app.use(cors());
app.use(express.json());

// ---- "Database": users + sessions (in memory for now) ----

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

// ---- Auth middleware ----

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

// ---- Admin month overview helpers ----

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

// Same ISO week logic as your frontend (UTC-based)
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
  // de-DE or de-CH is fine; keep it consistent with your app language
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
    if (!a || a.status !== 'accepted') return;
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

/**
 * Build month overview from a saved submission file.
 * Missing rule (matches your dashboard):
 * weekday is missing if totalHours==0 AND ferien==false AND no accepted absence on that day
 */
function buildMonthOverviewFromSubmission(submission, year, monthIndex) {
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0); // last day in month
  const monthStartKey = formatDateKey(monthStart);
  const monthEndKey = formatDateKey(monthEnd);

  const daysObj = (submission && submission.days && typeof submission.days === 'object')
    ? submission.days
    : {};

  const pikettByDate = buildPikettHoursByDate(submission?.pikett);
  const acceptedAbsenceDays = buildAcceptedAbsenceDaysSet(submission?.absences, monthStartKey, monthEndKey);

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
app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running 🚀' });
});

// ---- File storage helpers ----

const BASE_DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(BASE_DATA_DIR)) {
  fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
}

// ---- Week locks (persistent) ----
// Stored globally, keyed by username -> weekKey -> { locked:true, lockedAt, lockedBy }
const WEEK_LOCKS_PATH = path.join(BASE_DATA_DIR, 'weekLocks.json');

function readWeekLocks() {
  return safeReadJson(WEEK_LOCKS_PATH, {});
}

function writeWeekLocks(data) {
  fs.writeFileSync(WEEK_LOCKS_PATH, JSON.stringify(data, null, 2), 'utf8');
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
// We use username as the folder id (consistent with existing files)
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



// ---- Month transmission routes ----

// Receive monthly transmission (protected)
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

    try {
      const allLocks = readWeekLocks();
      const userLocks = (allLocks[userId] && typeof allLocks[userId] === 'object')
        ? allLocks[userId]
        : {};

      const { lockedDateKeys, lockedWeekKeys } = collectLockedDatesForMonth(userLocks, payload.year, payload.monthIndex);

      if (lockedDateKeys.size > 0) {
        const previous = loadLatestMonthSubmission(userId, payload.year, payload.monthIndex);

        // Only merge if we already have a prior submission for that month
        if (previous) {
          payloadToSave = mergeLockedWeeksPayload(payload, previous, lockedDateKeys);
          payloadToSave._lockInfo = {
            preservedWeekKeys: Array.from(lockedWeekKeys),
            preservedDaysCount: lockedDateKeys.size,
          };
        }
      }
    } catch (e) {
      console.error('Lock enforcement failed (continuing without lock merge):', e);
      payloadToSave = payload;
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
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to update index.json:', err);
    // Not fatal for the client; main file is already saved
  }

  res.json({
    ok: true,
    message: `Month ${payload.monthLabel} received and saved as ${fileName}`,
    submissionId: fileName,
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
      // ---- Admin: month overview (per user, month-specific) ----
app.get(
  '/api/admin/month-overview',
  requireAuth,
  requireAdmin,
  (req, res) => {
    const year = Number(req.query.year);
    const monthIndex = Number(req.query.monthIndex);
    const allLocks = readWeekLocks();


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

      const overview = buildMonthOverviewFromSubmission(submission, year, monthIndex);
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

  const allLocks = readWeekLocks();
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

  // accepted absence covering this day
  let acceptedAbsence = null;
  if (Array.isArray(submission.absences)) {
    acceptedAbsence = submission.absences.find((a) => {
      if (!a || a.status !== 'accepted') return false;
      const fromKey = String(a.from || '').slice(0, 10);
      const toKey = String(a.to || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) return false;
      const start = fromKey <= toKey ? fromKey : toKey;
      const end = fromKey <= toKey ? toKey : fromKey;
      return dateKey >= start && dateKey <= end;
    }) || null;
  }

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



// ---- Admin: summary of transmissions per user ----
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

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
