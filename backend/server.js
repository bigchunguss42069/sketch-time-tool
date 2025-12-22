const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const exportPdfBody = express.json({ limit: '10mb' });

const app = express();
const PORT = 3000;


// ---- Middleware ----
app.use(cors());
app.use(express.json({ limit: '25mb' }));


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


// ---- Anlagen: global index + daily ledger + per-user-month snapshots ----


const ANLAGEN_LEDGER_PATH = path.join(BASE_DATA_DIR, 'anlagenLedger.json');
const ANLAGEN_SNAP_DIR    = path.join(BASE_DATA_DIR, 'anlagenSnapshots');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readAnlagenIndex() {
  return safeReadJson(ANLAGEN_INDEX_PATH, {}); // { [teamId]: { [komNr]: {...} } }
}
function writeAnlagenIndex(data) {
  writeJsonAtomic(ANLAGEN_INDEX_PATH, data);
}

function readAnlagenLedger() {
  return safeReadJson(ANLAGEN_LEDGER_PATH, {}); // { [teamId]: { [komNr]: { byUser: { [username]: { byDate: {...} } } } } }
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
  if (!index[teamId]) index[teamId] = {};
  if (!ledger[teamId]) ledger[teamId] = {};

  for (const [komNr, rec] of Object.entries(snap || {})) {
    // ---- index ----
    if (!index[teamId][komNr]) {
      index[teamId][komNr] = { totalHours: 0, byOperation: {}, byUser: {}, lastActivity: null };
    }
    const gi = index[teamId][komNr];

    const total = Number(rec.totalHours || 0);
    gi.totalHours += sign * total;

    // byOperation
    for (const [k, v] of Object.entries(rec.byOperation || {})) {
      const h = Number(v) || 0;
      if (sign > 0) addNum(gi.byOperation, k, h);
      else subNum(gi.byOperation, k, h);
    }

    // byUser total (store totals only)
    if (sign > 0) addNum(gi.byUser, username, total);
    else subNum(gi.byUser, username, total);

    // ---- ledger ----
    if (!ledger[teamId][komNr]) ledger[teamId][komNr] = { byUser: {} };
    if (!ledger[teamId][komNr].byUser[username]) ledger[teamId][komNr].byUser[username] = { byDate: {} };

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
      delete index[teamId][komNr];
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

function normalizeKomNr(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  // keep it permissive; just remove whitespace
  return s.replace(/\s+/g, '');
}

function addNum(obj, key, val) {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n) || n === 0) return;
  if (!obj[key]) obj[key] = 0;
  obj[key] += n;
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

// Optional: full rebuild from stored transmission files (latest per user/month).
// Useful if anlagenIndex.json is missing or you want to verify consistency.
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
app.post('/api/admin/anlagen-export-pdf', requireAuth, requireAdmin, exportPdfBody, (req, res) => {
  const teamId = String(req.body?.teamId || req.user.teamId || '');
  const komNr = normalizeKomNr(req.body?.komNr);

  if (!teamId) return res.status(400).json({ ok: false, error: 'Missing teamId' });
  if (!komNr) return res.status(400).json({ ok: false, error: 'Missing komNr' });

  // Optional: enforce team scoping (recommended when you add more teams)
  // if (req.user.teamId !== teamId) return res.status(403).json({ ok:false, error:'Wrong team' });

  const index = readAnlagenIndex();
  const ledger = readAnlagenLedger();
  const meta = readAnlagenArchive(); // you already have this

  const rec = index?.[teamId]?.[komNr];
  if (!rec) return res.status(404).json({ ok: false, error: 'KomNr not found in index' });

  const ledgerRec = ledger?.[teamId]?.[komNr] || { byUser: {} };
  const teamMeta = (meta?.[teamId] && typeof meta[teamId] === 'object') ? meta[teamId] : {};
  const m = teamMeta[komNr] || null;

  // charts from frontend (optional)
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
  doc.fontSize(10).text(`Total Stunden: ${(Number(rec.totalHours || 0)).toFixed(1).replace('.', ',')} h`);
  doc.fontSize(10).text(`Letzte Aktivität: ${rec.lastActivity ? rec.lastActivity : '–'}`);
  doc.moveDown(0.6);

  // Charts
  doc.fontSize(12).text('Charts', { underline: true });
  doc.moveDown(0.3);

  const startX = doc.x;
  const yBefore = doc.y;

  if (donutBuf) {
    doc.image(donutBuf, startX, yBefore, { width: 240 });
  } else {
    doc.fontSize(9).text('Donut Chart nicht vorhanden (Frontend hat kein PNG gesendet).');
  }

  if (usersBuf) {
    doc.image(usersBuf, startX + 260, yBefore, { width: 260 });
  } else {
    doc.fontSize(9).text('', startX + 260, yBefore);
    doc.fontSize(9).text('User Chart nicht vorhanden.', startX + 260, yBefore + 12);
  }

  doc.moveDown(16); // push below charts

  // Operations table (from index.byOperation)
  doc.fontSize(12).text('Stunden nach Tätigkeit', { underline: true });
  doc.moveDown(0.3);

  const ops = Object.entries(rec.byOperation || {})
    .map(([key, hours]) => ({ key, hours: Number(hours) || 0 }))
    .filter((x) => x.hours > 0)
    .sort((a, b) => b.hours - a.hours);

  ops.forEach((o) => {
    doc.fontSize(10).text(`${o.key}: ${o.hours.toFixed(1).replace('.', ',')} h`);
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
  doc.fontSize(12).text('Tagesjournal (Audit)', { underline: true });
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
      doc.fontSize(9).text(`${dk}: ${h.toFixed(1).replace('.', ',')} h`);
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

// ---- Admin: rebuild Anlagen index (optional maintenance) ----
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


  // 1.5) Update global Anlagen index (delta vs previous submission for this month)
  const anlagenTeamId = req.user.teamId || 'unknown';
  let _oldAnlagenMap = null;
  let _newAnlagenMap = null;

  try {
    _oldAnlagenMap = previousMonthSubmission
      ? extractAnlagenFromSubmission(previousMonthSubmission, userId)
      : new Map();

    _newAnlagenMap = extractAnlagenFromSubmission(payloadToSave, userId);

    applyAnlagenDelta(anlagenTeamId, userId, _newAnlagenMap, _oldAnlagenMap);
  } catch (err) {
    console.error('Failed to update anlagenIndex.json:', err);

    // keep consistency: remove the just-saved submission file if possible
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }

    return res.status(500).json({
      ok: false,
      error: 'Could not update Anlagen index. Submission rejected.',
    });
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

    // Roll back Anlagen delta to keep aggregates consistent
    try {
      if (_oldAnlagenMap && _newAnlagenMap) {
        applyAnlagenDelta(anlagenTeamId, userId, _oldAnlagenMap, _newAnlagenMap);
      }
    } catch (e) {
      console.error('Failed to roll back anlagen index (manual rebuild may be required):', e);
    }

    // Remove the just-saved submission file (best effort)
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }

    return res.status(500).json({ ok: false, error: 'Could not persist submission index.json. Submission rejected.' });
  }


  // ---- Update Anlagen global index + daily ledger (idempotent by user-month snapshot) ----
    try {
      const teamId = String(req.user.teamId || '');   // important for multi-team future
      const username = req.user.username;

      if (teamId) {
        const year = payload.year;
        const monthIndex = payload.monthIndex;

        const oldSnap = readAnlagenSnapshot(username, year, monthIndex);
        const newSnap = extractAnlagenSnapshotFromPayload(payloadToSave, username);

        const index = readAnlagenIndex();
        const ledger = readAnlagenLedger();

        const touched = new Set([
          ...Object.keys(oldSnap || {}),
          ...Object.keys(newSnap || {}),
        ]);

        // subtract old
        if (oldSnap) {
          applySnapshotToIndexAndLedger({ index, ledger, teamId, username, snap: oldSnap, sign: -1 });
        }

        // add new
        applySnapshotToIndexAndLedger({ index, ledger, teamId, username, snap: newSnap, sign: +1 });

        // recompute lastActivity reliably for touched komNrs
        recomputeLastActivitiesForTeam(index, ledger, teamId, Array.from(touched));

        // persist
        writeAnlagenIndex(index);
        writeAnlagenLedger(ledger);
        writeAnlagenSnapshot(username, year, monthIndex, newSnap);
      }
    } catch (e) {
      console.error('Anlagen update failed:', e);
      // Decide policy:
      // - If you want "submission still accepted even if Anlagen fails", keep it non-fatal.
      // - If you want strict correctness, return 500 and reject.
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
