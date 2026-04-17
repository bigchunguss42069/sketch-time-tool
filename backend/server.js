require('dotenv').config();
// ============================================================================
// Runtime dependencies and app bootstrap
// ============================================================================
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { Pool } = require('pg');
const argon2 = require('argon2');
const exportPdfBody = express.json({ limit: '10mb' });
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';

const db = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
    })
  : null;

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
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(helmet());
app.use(express.json({ limit: '25mb' }));

// ============================================================================
// In-memory identity data and option labels
// ============================================================================
// Note: Now users are in postgres with argon2 hashes
//

// Teams
const TEAMS = [
  { id: 'montage', name: 'Team Montage' },
  { id: 'werkstatt', name: 'Team Werkstatt' },
  { id: 'service', name: 'Team Service' },
  { id: 'büro', name: 'Team Büro' },
];

const INITIAL_USERS = [
  {
    id: 'u1',
    username: 'demo',
    passwordEnv: 'SEED_PASSWORD_DEMO',
    role: 'user',
    teamId: 'montage',
  },
  {
    id: 'u2',
    username: 'chef',
    passwordEnv: 'SEED_PASSWORD_CHEF',
    role: 'admin',
    teamId: 'montage',
  },
  {
    id: 'u3',
    username: 'markus',
    passwordEnv: 'SEED_PASSWORD_MARKUS',
    role: 'user',
    teamId: 'montage',
  },
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

async function ensureSessionsTable() {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
    ON auth_sessions (user_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked
    ON auth_sessions (revoked_at)
  `);
}

async function createSessionRecord({ token, userId }) {
  if (!db) {
    throw new Error('DATABASE_URL is not configured');
  }

  await db.query(
    `
      INSERT INTO auth_sessions (
        token,
        user_id,
        created_at,
        last_seen_at,
        revoked_at
      )
      VALUES ($1, $2, NOW(), NOW(), NULL)
    `,
    [token, userId]
  );
}

async function getSessionUserId(token) {
  if (!db) return null;

  const result = await db.query(
    `
      SELECT user_id
      FROM auth_sessions
      WHERE token = $1
        AND revoked_at IS NULL
      LIMIT 1
    `,
    [token]
  );

  const row = result.rows[0];
  if (!row) return null;

  await db.query(
    `
      UPDATE auth_sessions
      SET last_seen_at = NOW()
      WHERE token = $1
    `,
    [token]
  );

  return row.user_id || null;
}

async function revokeSessionRecord(token) {
  if (!db) return;

  await db.query(
    `
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE token = $1
        AND revoked_at IS NULL
    `,
    [token]
  );
}

function mapDbUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    teamId: row.team_id || null,
    active: row.active,
    email: row.email || null,
  };
}

async function ensureUsersTable() {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
      team_id TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT
`);
}

async function ensureMonthSubmissionsTable() {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS month_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      team_id TEXT,
      year INTEGER NOT NULL,
      month_index INTEGER NOT NULL CHECK (month_index BETWEEN 0 AND 11),
      month_label TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      totals JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_month_submissions_username_month_sent_at
    ON month_submissions (username, year, month_index, sent_at DESC, created_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_month_submissions_username_sent_at
    ON month_submissions (username, sent_at DESC, created_at DESC)
  `);
}

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

async function findUserByUsername(username) {
  if (!db) return null;

  const result = await db.query(
    `
      SELECT id, username, role, team_id, active
      FROM users
      WHERE username = $1
      LIMIT 1
    `,
    [username]
  );

  const row = result.rows[0];
  if (!row || !row.active) return null;

  return mapDbUser(row);
}

async function listUsersFromDb({ role = null, teamId = null } = {}) {
  if (!db) return [];

  const params = [];
  let sql = `
    SELECT id, username, role, team_id, active
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
  if (!db) {
    throw new Error('DATABASE_URL is not configured');
  }

  await db.query(
    `
      INSERT INTO month_submissions (
        id,
        user_id,
        username,
        team_id,
        year,
        month_index,
        month_label,
        sent_at,
        received_at,
        size_bytes,
        totals,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
    `,
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

async function deleteMonthSubmissionById(id) {
  if (!db) return;
  await db.query(`DELETE FROM month_submissions WHERE id = $1`, [id]);
}

async function listUserTransmissions(username) {
  if (!db) return [];

  const result = await db.query(
    `
      SELECT
        id,
        year,
        month_index,
        month_label,
        sent_at,
        size_bytes,
        totals
      FROM month_submissions
      WHERE username = $1
      ORDER BY sent_at DESC, created_at DESC
    `,
    [username]
  );

  return result.rows.map(mapTransmissionMeta);
}

async function getLatestTransmissionMeta(username) {
  if (!db) return null;

  const result = await db.query(
    `
      SELECT
        id,
        year,
        month_index,
        month_label,
        sent_at,
        size_bytes,
        totals
      FROM month_submissions
      WHERE username = $1
      ORDER BY sent_at DESC, created_at DESC
      LIMIT 1
    `,
    [username]
  );

  const row = result.rows[0];
  return row ? mapTransmissionMeta(row) : null;
}

async function getLatestMonthSubmissionRecord(username, year, monthIndex) {
  if (!db) return null;

  const result = await db.query(
    `
      SELECT
        id,
        year,
        month_index,
        month_label,
        sent_at,
        size_bytes,
        totals,
        payload
      FROM month_submissions
      WHERE username = $1
        AND year = $2
        AND month_index = $3
      ORDER BY sent_at DESC, created_at DESC
      LIMIT 1
    `,
    [username, year, monthIndex]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    meta: mapTransmissionMeta(row),
    submission: row.payload || null,
  };
}

async function seedInitialUsers() {
  if (!db) return;

  const existing = await db.query('SELECT COUNT(*)::int AS count FROM users');
  const count = existing.rows[0]?.count || 0;

  if (count > 0) return;

  for (const user of INITIAL_USERS) {
    const plainPassword = process.env[user.passwordEnv];

    if (!plainPassword) {
      throw new Error(`Missing required env var: ${user.passwordEnv}`);
    }

    const passwordHash = await argon2.hash(plainPassword, {
      type: argon2.argon2id,
    });

    await db.query(
      `
        INSERT INTO users (
          id,
          username,
          password_hash,
          role,
          team_id,
          active
        )
        VALUES ($1, $2, $3, $4, $5, TRUE)
      `,
      [user.id, user.username, passwordHash, user.role, user.teamId]
    );
  }

  console.log('Initial users seeded into Postgres.');
}

async function findUserByCredentials(username, password) {
  if (!db) return null;

  const result = await db.query(
    `
      SELECT id, username, password_hash, role, team_id, active
      FROM users
      WHERE username = $1
      LIMIT 1
    `,
    [username]
  );

  const row = result.rows[0];
  if (!row || !row.active) return null;

  const passwordOk = await argon2.verify(row.password_hash, password);
  if (!passwordOk) return null;

  return mapDbUser(row);
}

async function findUserById(id) {
  if (!db) return null;

  const result = await db.query(
    `
      SELECT id, username, role, team_id, active
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  const row = result.rows[0];
  if (!row || !row.active) return null;

  return mapDbUser(row);
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================================================
// Authentication / authorization helpers
// ============================================================================

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res
        .status(401)
        .json({ ok: false, error: 'Missing or invalid Authorization header' });
    }

    const userId = await getSessionUserId(token);
    if (!userId) {
      return res
        .status(401)
        .json({ ok: false, error: 'Invalid or expired token' });
    }

    const user = await findUserById(userId);
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: 'User not found for this token' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('requireAuth failed', err);
    return res.status(500).json({ ok: false, error: 'Authentication failed' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin role required' });
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
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
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

// Berechnet Netto-Arbeitszeit aus Stempel-Paaren (in Stunden)
function computeNetWorkingHoursFromStamps(stamps) {
  if (!Array.isArray(stamps) || stamps.length === 0) return 0;

  let totalMinutes = 0;
  let lastIn = null;

  const sorted = [...stamps].sort((a, b) => {
    const ta = String(a.time || '').replace(':', '');
    const tb = String(b.time || '').replace(':', '');
    return ta.localeCompare(tb);
  });

  for (const stamp of sorted) {
    const type = String(stamp.type || '');
    const time = String(stamp.time || '');
    if (!/^\d{2}:\d{2}$/.test(time)) continue;

    const [hh, mm] = time.split(':').map(Number);
    const minutes = hh * 60 + mm;

    if (type === 'in') {
      lastIn = minutes;
    } else if (type === 'out' && lastIn !== null) {
      const diff = minutes - lastIn;
      if (diff > 0) totalMinutes += diff;
      lastIn = null;
    }
  }

  return Math.round((totalMinutes / 60) * 100) / 100;
}

// Gibt Arbeitszeit zurück: Stamps wenn vorhanden, sonst eingeteilte Stunden
// Verwendet für ÜZ1-Berechnung
function computeDailyWorkingHours(dayData) {
  if (!dayData || typeof dayData !== 'object') return 0;
  // Für ÜZ1-Berechnung zählen nur Stempel — dayHours (Transport, Schulung etc.)
  // und Kommissionsstunden sind nur für die Auswertung relevant, nicht für ÜZ.
  if (Array.isArray(dayData.stamps) && dayData.stamps.length > 0) {
    return computeNetWorkingHoursFromStamps(dayData.stamps);
  }
  return 0;
}

function computeNonPikettHours(dayData) {
  if (!dayData || typeof dayData !== 'object') return 0;

  let total = 0;

  if (Array.isArray(dayData.entries)) {
    dayData.entries.forEach((entry) => {
      if (!entry || !entry.hours) return;
      Object.values(entry.hours).forEach((val) => {
        total += clampToNumber(val);
      });
    });
  }

  if (dayData.dayHours && typeof dayData.dayHours === 'object') {
    total += clampToNumber(dayData.dayHours.schulung);
    total += clampToNumber(dayData.dayHours.sitzungKurs);
    total += clampToNumber(dayData.dayHours.arztKrank);
  }

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

function buildAcceptedAbsenceHoursMap(
  absencesArray,
  monthStartKey,
  monthEndKey
) {
  // Map: dateKey → hours (null = ganzer Tag)
  const map = new Map();
  if (!Array.isArray(absencesArray)) return map;

  absencesArray.forEach((a) => {
    const st = String(a.status || '').toLowerCase();
    if (!a || (st !== 'accepted' && st !== 'cancel_requested')) return;
    if (!a.from || !a.to) return;

    const startKey = a.from <= a.to ? a.from : a.to;
    const endKey = a.from <= a.to ? a.to : a.from;
    if (endKey < monthStartKey || startKey > monthEndKey) return;

    const cursor = new Date(startKey + 'T00:00:00');
    const end = new Date(endKey + 'T00:00:00');

    while (cursor <= end) {
      const k = formatDateKey(cursor);
      if (k >= monthStartKey && k <= monthEndKey) {
        // hours: wenn mehrtägig → ganzer Tag (null), wenn eintägig → a.hours
        const isMultiDay = startKey !== endKey;
        map.set(k, isMultiDay ? null : (a.hours ?? null));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return map;
}

async function computeUeZ1NetForMonth(payload, year, monthIndex, userId) {
  const daysObj =
    payload?.days && typeof payload.days === 'object' ? payload.days : {};
  const monthStartKey = formatDateKey(new Date(year, monthIndex, 1));
  const monthEndKey = formatDateKey(new Date(year, monthIndex + 1, 0));
  const acceptedAbsenceDays = buildAcceptedAbsenceHoursMap(
    payload?.absences,
    monthStartKey,
    monthEndKey
  );

  let sum = 0;

  // Alle Werktage des Monats durchgehen — nicht nur die mit Einträgen
  const cursor = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  while (cursor <= end) {
    const dateKey = formatDateKey(cursor);
    const weekday = cursor.getDay();
    cursor.setDate(cursor.getDate() + 1);

    if (weekday === 0 || weekday === 6) continue; // Wochenende überspringen

    const { soll, employmentPct } = await getDailySoll(
      userId,
      dateKey,
      acceptedAbsenceDays
    );
    if (soll === 0) continue;

    const dayData = daysObj[dateKey] || null;
    const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
    const isFerien = !!dayData?.flags?.ferien;

    let diff = 0;
    if (isFerien) {
      diff = dayTotal > soll ? dayTotal - soll : 0;
    } else {
      diff = dayTotal - soll; // kann negativ sein — das ist gewollt
    }

    sum += diff;
  }

  return Math.round(sum * 10) / 10;
}

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
      acceptedAbsenceDays
    );
    if (soll === 0) continue;

    const dayData = daysObj[dateKey] || null;
    const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
    const isFerien = !!dayData?.flags?.ferien;

    let diff = 0;
    if (isFerien) {
      diff = dayTotal > soll ? dayTotal - soll : 0;
    } else {
      diff = dayTotal - soll;
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

// Compute only POSITIVE ÜZ1 hours for the month (for Vorarbeit tracking)
async function computeUeZ1PositiveForMonth(payload, year, monthIndex, userId) {
  const daysObj =
    payload?.days && typeof payload.days === 'object' ? payload.days : {};
  const monthStartKey = formatDateKey(new Date(year, monthIndex, 1));
  const monthEndKey = formatDateKey(new Date(year, monthIndex + 1, 0));
  const acceptedAbsenceDays = buildAcceptedAbsenceHoursMap(
    payload?.absences,
    monthStartKey,
    monthEndKey
  );

  let positiveSum = 0;

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
      acceptedAbsenceDays
    );
    if (soll === 0) continue;

    const dayData = daysObj[dateKey] || null;
    const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
    const isFerien = !!dayData?.flags?.ferien;

    let diff = 0;
    if (isFerien) {
      diff = dayTotal > soll ? dayTotal - soll : 0;
    } else {
      diff = dayTotal - soll;
    }

    if (diff > 0) positiveSum += diff;
  }

  return Math.round(positiveSum * 10) / 10;
}

const PAYROLL_YEAR_CONFIG = {
  2025: { vorarbeitRequired: 39 },
  2026: { vorarbeitRequired: 59 },
};

function getPayrollYearConfig(year) {
  return PAYROLL_YEAR_CONFIG[year] || { vorarbeitRequired: 0 };
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
      acceptedAbsenceDays
    );
    if (soll === 0) continue;

    const dayData = daysObj[dateKey] || null;
    const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
    const isFerien = !!dayData?.flags?.ferien;

    let diff = 0;
    if (isFerien) {
      diff = dayTotal > soll ? dayTotal - soll : 0;
    } else {
      diff = dayTotal - soll;
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

    monthTotalHours += totalHours;

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

      w.days.push({
        dateKey,
        weekday, // for "Mo/Di/..." mapping in frontend
        totalHours,
        stampHours,
        status, // "missing" | "ok" | "ferien" | "absence"
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

// ---- Auth routes ----

// Login: POST /api/auth/login
// ============================================================================
// Authentication routes
// ============================================================================

// Limiter for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 10, // max 10 Versuche pro 15 Minuten
  message: {
    ok: false,
    error: 'Zu viele Login-Versuche, bitte warte 15 Minuten.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res
        .status(400)
        .json({ ok: false, error: 'Missing username or password' });
    }

    const user = await findUserByCredentials(username, password);

    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: 'Ungültige Zugangsdaten' });
    }

    const token = createToken();
    await createSessionRecord({
      token,
      userId: user.id,
    });

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
  } catch (err) {
    console.error('Login failed', err);
    return res.status(500).json({ ok: false, error: 'Login failed' });
  }
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

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    if (req.token) {
      await revokeSessionRecord(req.token);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Logout failed', err);
    return res.status(500).json({ ok: false, error: 'Logout failed' });
  }
});

// ---- Health check ----
// ============================================================================
// Basic health check
// ============================================================================
app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running 🚀' });
});

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
async function ensureAbsencesTable() {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS absences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      team_id TEXT,
      type TEXT NOT NULL,
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      days DOUBLE PRECISION,
      comment TEXT,
      status TEXT NOT NULL CHECK (
        status IN ('pending', 'accepted', 'rejected', 'cancel_requested', 'cancelled')
      ),
      created_at TIMESTAMPTZ NOT NULL,
      created_by TEXT,
      decided_at TIMESTAMPTZ,
      decided_by TEXT,
      cancel_requested_at TIMESTAMPTZ,
      cancel_requested_by TEXT
    )
  `);

  await db.query(`
  ALTER TABLE absences
  ADD COLUMN IF NOT EXISTS hours DOUBLE PRECISION
`);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_absences_username_created
    ON absences (username, created_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_absences_status_created
    ON absences (status, created_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_absences_username_range
    ON absences (username, from_date, to_date)
  `);
}

function toDateOnlyString(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return formatDateKey(value);
  }

  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function toIsoTimestamp(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

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

async function listUserAbsencesFromDb(username, client = db) {
  if (!client) return [];

  const result = await client.query(
    `
      SELECT *
      FROM absences
      WHERE username = $1
      ORDER BY created_at DESC, from_date DESC, id DESC
    `,
    [username]
  );

  return result.rows.map(mapAbsenceRow);
}

async function findAbsenceByUserAndId(username, id, client = db) {
  if (!client) return null;

  const result = await client.query(
    `
      SELECT *
      FROM absences
      WHERE username = $1
        AND id = $2
      LIMIT 1
    `,
    [username, id]
  );

  return mapAbsenceRow(result.rows[0] || null);
}

async function insertAbsenceForUser(
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
  client = db
) {
  if (!client) {
    throw new Error('DATABASE_URL is not configured');
  }

  const result = await client.query(
    `
      INSERT INTO absences (
        id, user_id, username, team_id, type, from_date, to_date,
        days, hours, comment, status, created_at, created_by,
        decided_at, decided_by, cancel_requested_at, cancel_requested_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17
      )
      RETURNING *
    `,
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

async function deleteAbsenceForUser(username, id, client = db) {
  if (!client) {
    throw new Error('DATABASE_URL is not configured');
  }

  await client.query(
    `
      DELETE FROM absences
      WHERE username = $1
        AND id = $2
    `,
    [username, id]
  );
}

async function updateAbsenceStatus(
  {
    username,
    id,
    status,
    decidedAt,
    decidedBy,
    cancelRequestedAt,
    cancelRequestedBy,
  },
  client = db
) {
  if (!client) {
    throw new Error('DATABASE_URL is not configured');
  }

  const result = await client.query(
    `
      UPDATE absences
      SET
        status = $3,
        decided_at = $4,
        decided_by = $5,
        cancel_requested_at = $6,
        cancel_requested_by = $7
      WHERE username = $1
        AND id = $2
      RETURNING *
    `,
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
      ) {
        return false;
      }

      const start = fromKey <= toKey ? fromKey : toKey;
      const end = fromKey <= toKey ? toKey : fromKey;

      return dateKey >= start && dateKey <= end;
    }) || null
  );
}

// ---- Konten (Postgres-backed, idempotent by user-month snapshot) ----
// ----------------------------------------------------------------------------
// Konten helpers
// ----------------------------------------------------------------------------
function kontenMonthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

async function ensureKontenTables() {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS konten (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL UNIQUE,
      team_id TEXT,
      ue_z1 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z2 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z3 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z1_positive_by_year JSONB NOT NULL DEFAULT '{}'::jsonb,
      vacation_days DOUBLE PRECISION NOT NULL DEFAULT 0,
      vacation_days_per_year DOUBLE PRECISION NOT NULL DEFAULT 21,
      credited_years JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS konten_snapshots (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      year INTEGER NOT NULL,
      month_index INTEGER NOT NULL CHECK (month_index BETWEEN 0 AND 11),
      month_key TEXT NOT NULL,
      ue_z1 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z1_positive DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z2 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z3 DOUBLE PRECISION NOT NULL DEFAULT 0,
      vac_used DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, year, month_index)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_konten_snapshots_username_month
    ON konten_snapshots (username, year, month_index)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_konten_snapshots_username_month_key
    ON konten_snapshots (username, month_key)
  `);

  await db.query(`
    ALTER TABLE konten 
    ADD COLUMN IF NOT EXISTS vorarbeit_balance DOUBLE PRECISION NOT NULL DEFAULT 0
  `);
  await db.query(`
    ALTER TABLE konten_snapshots
    ADD COLUMN IF NOT EXISTS vorarbeit_balance DOUBLE PRECISION NOT NULL DEFAULT 0
`);
}

function normalizeKontenObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function mapKontenRow(row, fallback = {}) {
  const updatedAtRaw = row?.updated_at;

  return {
    teamId: row?.team_id ?? fallback.teamId ?? null,
    ueZ1: Number(row?.ue_z1) || 0,
    ueZ2: Number(row?.ue_z2) || 0,
    ueZ3: Number(row?.ue_z3) || 0,
    vorarbeitBalance: Number(row?.vorarbeit_balance) || 0,
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

async function ensureKontenUserRecord({
  username,
  teamId = null,
  client = db,
}) {
  if (!client) {
    throw new Error('DATABASE_URL is not configured');
  }

  const userResult = await client.query(
    `
      SELECT id, username, team_id, active
      FROM users
      WHERE username = $1
      LIMIT 1
    `,
    [username]
  );

  const userRow = userResult.rows[0];
  if (!userRow || !userRow.active) {
    throw new Error(`User not found for konten: ${username}`);
  }

  const effectiveTeamId = teamId || userRow.team_id || null;

  let kontenResult = await client.query(
    `
      SELECT *
      FROM konten
      WHERE user_id = $1
      LIMIT 1
    `,
    [userRow.id]
  );

  let kontenRow = kontenResult.rows[0];

  if (!kontenRow) {
    kontenResult = await client.query(
      `
        INSERT INTO konten (
          user_id,
          username,
          team_id,
          ue_z1,
          ue_z2,
          ue_z3,
          ue_z1_positive_by_year,
          vacation_days,
          vacation_days_per_year,
          credited_years,
          updated_at,
          updated_by
        )
        VALUES (
          $1,
          $2,
          $3,
          0,
          0,
          0,
          '{}'::jsonb,
          0,
          21,
          '{}'::jsonb,
          NULL,
          NULL
        )
        RETURNING *
      `,
      [userRow.id, userRow.username, effectiveTeamId]
    );

    kontenRow = kontenResult.rows[0];
  } else if (effectiveTeamId && kontenRow.team_id !== effectiveTeamId) {
    kontenResult = await client.query(
      `
        UPDATE konten
        SET team_id = $2
        WHERE user_id = $1
        RETURNING *
      `,
      [userRow.id, effectiveTeamId]
    );

    kontenRow = kontenResult.rows[0];
  }

  return {
    userId: userRow.id,
    username: userRow.username,
    teamId: effectiveTeamId,
    konto: mapKontenRow(kontenRow, { teamId: effectiveTeamId }),
  };
}

async function persistKontenUserRecord({
  client,
  userId,
  username,
  teamId,
  konto,
}) {
  if (!client) {
    throw new Error('Missing DB client');
  }

  await client.query(
    `
    UPDATE konten
    SET
      username = $2,
      team_id = $3,
      ue_z1 = $4,
      ue_z2 = $5,
      ue_z3 = $6,
      ue_z1_positive_by_year = $7::jsonb,
      vacation_days = $8,
      vacation_days_per_year = $9,
      credited_years = $10::jsonb,
      updated_at = $11,
      updated_by = $12,
      vorarbeit_balance = $13
    WHERE user_id = $1
  `,
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
      Number(konto.vorarbeitBalance) || 0, // ← NEU $13
    ]
  );
}

async function listKontenMonthKeys(username, client = db) {
  if (!client) return [];

  const result = await client.query(
    `
      SELECT month_key
      FROM konten_snapshots
      WHERE username = $1
      ORDER BY year ASC, month_index ASC
    `,
    [username]
  );

  return result.rows.map((row) => row.month_key);
}

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

async function updateKontenManualValues({ username, values, updatedBy }) {
  if (!db) {
    throw new Error('DATABASE_URL is not configured');
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const ensured = await ensureKontenUserRecord({ username, client });
    const next = {
      ...ensured.konto,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || username,
    };

    const fields = [
      ['ueZ1', 'ueZ1'],
      ['ueZ2', 'ueZ2'],
      ['ueZ3', 'ueZ3'],
      ['vacationDays', 'vacationDays'],
      ['vacationDaysPerYear', 'vacationDaysPerYear'],
    ];

    for (const [incomingKey, stateKey] of fields) {
      if (values[incomingKey] == null) continue;
      const n = Number(values[incomingKey]);
      if (Number.isFinite(n)) {
        next[stateKey] = n;
      }
    }

    await persistKontenUserRecord({
      client,
      userId: ensured.userId,
      username: ensured.username,
      teamId: ensured.teamId,
      konto: next,
    });

    await client.query('COMMIT');
    return next;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Same holiday list as frontend (extend yearly as needed)
const BERN_HOLIDAYS = {
  2025: new Set([
    '2025-01-01',
    '2025-01-02',
    '2025-04-18',
    '2025-04-20',
    '2025-04-21',
    '2025-05-29',
    '2025-06-09',
    '2025-08-01',
    '2025-09-21',
    '2025-12-25',
    '2025-12-26',
  ]),
  2026: new Set([
    '2026-01-01',
    '2026-01-02',
    '2026-04-03',
    '2026-04-05',
    '2026-04-06',
    '2026-05-14',
    '2026-05-25',
    '2026-08-01',
    '2026-09-20',
    '2026-12-25',
    '2026-12-26',
  ]),
  2027: new Set([
    '2027-01-01',
    '2027-01-02',
    '2027-03-26',
    '2027-03-28',
    '2027-03-29',
    '2027-05-06',
    '2027-05-17',
    '2027-08-01',
    '2027-09-19',
    '2027-12-25',
    '2027-12-26',
  ]),
};

function isBernHolidayKey(dateKey) {
  const year = Number(String(dateKey).slice(0, 4));
  const set = BERN_HOLIDAYS[year];
  return !!(set && set.has(dateKey));
}

const COMPANY_BRIDGE_DAYS = {
  2026: new Set([
    '2026-05-15',
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
  ]),
};

function isCompanyBridgeDay(dateKey) {
  const year = Number(String(dateKey).slice(0, 4));
  const set = COMPANY_BRIDGE_DAYS[year];
  return !!(set && set.has(dateKey));
}

// Gibt das Tagessoll für einen User an einem bestimmten Datum zurück.
// Berücksichtigt Arbeitszeitmodell, Feiertage und Absenzen.
async function getDailySoll(userId, dateKey, acceptedAbsenceHoursMap) {
  const weekday = new Date(dateKey + 'T00:00:00').getDay();
  if (weekday === 0 || weekday === 6) return { soll: 0, employmentPct: 100 };
  if (isBernHolidayKey(dateKey)) return { soll: 0, employmentPct: 100 };
  if (isCompanyBridgeDay(dateKey)) return { soll: 0, employmentPct: 100 };

  // Absenz prüfen
  if (acceptedAbsenceHoursMap && acceptedAbsenceHoursMap.has(dateKey)) {
    const absHours = acceptedAbsenceHoursMap.get(dateKey);
    if (absHours === null) return { soll: 0, employmentPct: 100 }; // ganzer Tag
    // Stundenweise — Soll wird weiter unten reduziert
  }

  // Arbeitszeitmodell laden
  const result = await db.query(
    `
    SELECT employment_pct, work_days FROM work_schedules
    WHERE user_id = $1 AND valid_from <= $2
    ORDER BY valid_from DESC LIMIT 1
  `,
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

  // Stundenweise Absenz abziehen
  if (acceptedAbsenceHoursMap && acceptedAbsenceHoursMap.has(dateKey)) {
    const absHours = acceptedAbsenceHoursMap.get(dateKey);
    if (absHours !== null) {
      baseSoll = Math.max(0, baseSoll - absHours);
    }
  }

  return { soll: baseSoll, employmentPct };
}

// Calculate vacation days for an absence (weekdays minus holidays)
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
      // ← NEU
      days += absence.hours ? 0.5 : 1;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

// vacation day fraction = max(0, 1 - (hoursWorked/8))
function computeVacationUsedDaysForMonth(payload, year, monthIndex) {
  const DAILY_SOLL = 8.0;
  const daysObj =
    payload && payload.days && typeof payload.days === 'object'
      ? payload.days
      : {};
  let used = 0;

  for (const [dateKey, dayData] of Object.entries(daysObj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    const d = new Date(dateKey + 'T00:00:00');
    if (Number.isNaN(d.getTime())) continue;

    if (d.getFullYear() !== year || d.getMonth() !== monthIndex) continue;

    const weekday = d.getDay();
    if (weekday < 1 || weekday > 5) continue;

    const ferien = !!(dayData && dayData.flags && dayData.flags.ferien);
    if (!ferien) continue;

    if (isBernHolidayKey(dateKey)) continue;

    const worked = computeNonPikettHours(dayData);
    const fraction = Math.max(0, 1 - worked / DAILY_SOLL);

    const rounded = Math.round(fraction * 4) / 4;
    used += rounded;
  }

  return Math.round(used * 100) / 100;
}

async function updateKontenFromSubmission({
  username,
  teamId,
  year,
  monthIndex,
  totals,
  payload,
  updatedBy,
}) {
  if (!db) {
    throw new Error('DATABASE_URL is not configured');
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const ensured = await ensureKontenUserRecord({
      username,
      teamId,
      client,
    });

    const monthKey = kontenMonthKey(year, monthIndex);
    const yearStr = String(year);

    const snapResult = await client.query(
      `
        SELECT ue_z1, ue_z1_positive, ue_z2, ue_z3, vac_used, vorarbeit_balance
        FROM konten_snapshots
        WHERE user_id = $1
          AND year = $2
          AND month_index = $3
        LIMIT 1
      `,
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

    const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
    const vorarbeitRequired =
      Number(getPayrollYearConfig(year).vorarbeitRequired) || 39;

    const nextKonto = {
      ...ensured.konto,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || username,
    };

    let vorarbeitBalance = r1(Number(nextKonto.vorarbeitBalance) || 0);

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

    const deltaUeZ1 = r1(monthUeZ1 - prevSnap.ueZ1);

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
      `
    INSERT INTO konten_snapshots (
      user_id,
      username,
      year,
      month_index,
      month_key,
      ue_z1,
      ue_z1_positive,
      ue_z2,
      ue_z3,
      vac_used,
      vorarbeit_balance,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (user_id, year, month_index)
    DO UPDATE SET
      username = EXCLUDED.username,
      month_key = EXCLUDED.month_key,
      ue_z1 = EXCLUDED.ue_z1,
      ue_z1_positive = EXCLUDED.ue_z1_positive,
      ue_z2 = EXCLUDED.ue_z2,
      ue_z3 = EXCLUDED.ue_z3,
      vac_used = EXCLUDED.vac_used,
      vorarbeit_balance = EXCLUDED.vorarbeit_balance,
      updated_at = EXCLUDED.updated_at
  `,
      [
        ensured.userId,
        ensured.username,
        year,
        monthIndex,
        monthKey,
        nextSnap.ueZ1,
        nextSnap.ueZ1Positive,
        nextSnap.ueZ2,
        nextSnap.ueZ3,
        nextSnap.vacUsed,
        nextSnap.vorarbeitBalance, // ← NEU $11
        nextKonto.updatedAt, // ← $12
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

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return 0;
  }

  if (toDate < fromDate) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }

  const affectedMonths = new Set();
  const cursor = new Date(fromDate);

  while (cursor <= toDate) {
    affectedMonths.add(kontenMonthKey(cursor.getFullYear(), cursor.getMonth()));
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
      `
        SELECT year, month_index, month_key, vac_used
        FROM konten_snapshots
        WHERE user_id = $1
          AND month_key = ANY($2::text[])
      `,
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
        `
          UPDATE konten_snapshots
          SET vac_used = $4, updated_at = $5
          WHERE user_id = $1
            AND year = $2
            AND month_index = $3
            
        `,
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

// ---- Week locks (persistent) ----
// Stored globally, keyed by username -> weekKey -> { locked:true, lockedAt, lockedBy }
// ----------------------------------------------------------------------------
// Week locks, date ranges and payroll-period helpers
// ----------------------------------------------------------------------------
async function ensureWeekLocksTable() {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS week_locks (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      week_year INTEGER NOT NULL,
      week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
      locked_at TIMESTAMPTZ NOT NULL,
      locked_by TEXT,
      PRIMARY KEY (user_id, week_year, week)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_week_locks_username_week
    ON week_locks (username, week_year, week)
  `);
}

async function ensureDraftsTable() {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_drafts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureLiveStampsTable() {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS live_stamps (
      user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username  TEXT NOT NULL,
      today_key TEXT NOT NULL,
      stamps    JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureStampEditsTable() {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS stamp_edits (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username    TEXT NOT NULL,
      date_key    TEXT NOT NULL,
      action      TEXT NOT NULL CHECK (action IN ('added','edited','deleted')),
      old_time    TEXT,
      new_time    TEXT,
      old_type    TEXT,
      new_type    TEXT,
      transmitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      year        INTEGER NOT NULL,
      month_index INTEGER NOT NULL
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_stamp_edits_username_month
    ON stamp_edits (username, year, month_index, transmitted_at DESC)
  `);
}

async function ensureWorkSchedulesTable() {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS work_schedules (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username    TEXT NOT NULL,
      employment_pct INTEGER NOT NULL DEFAULT 100,
      work_days   JSONB NOT NULL DEFAULT '{"mon":8.0,"tue":8.0,"wed":8.0,"thu":8.0,"fri":8.0}'::jsonb,
      valid_from  DATE NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_work_schedules_user_valid
    ON work_schedules (user_id, valid_from DESC)
  `);
}

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

async function readWeekLocksFromDb() {
  if (!db) return {};

  const result = await db.query(`
    SELECT username, week_year, week, locked_at, locked_by
    FROM week_locks
    ORDER BY username ASC, week_year ASC, week ASC
  `);

  return buildWeekLocksMap(result.rows);
}

async function readUserWeekLocksFromDb(username) {
  if (!db) return {};

  const result = await db.query(
    `
      SELECT username, week_year, week, locked_at, locked_by
      FROM week_locks
      WHERE username = $1
      ORDER BY week_year ASC, week ASC
    `,
    [username]
  );

  const all = buildWeekLocksMap(result.rows);
  return all[username] || {};
}

async function setWeekLockState({
  userId,
  username,
  weekYear,
  week,
  lockedBy,
}) {
  if (!db) {
    throw new Error('DATABASE_URL is not configured');
  }

  const result = await db.query(
    `
      INSERT INTO week_locks (
        user_id,
        username,
        week_year,
        week,
        locked_at,
        locked_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, week_year, week)
      DO UPDATE SET
        username = EXCLUDED.username,
        locked_at = EXCLUDED.locked_at,
        locked_by = EXCLUDED.locked_by
      RETURNING username, week_year, week, locked_at, locked_by
    `,
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

async function clearWeekLockState({ userId, weekYear, week }) {
  if (!db) {
    throw new Error('DATABASE_URL is not configured');
  }

  await db.query(
    `
      DELETE FROM week_locks
      WHERE user_id = $1
        AND week_year = $2
        AND week = $3
    `,
    [userId, weekYear, week]
  );
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
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromKey) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toKey)
  ) {
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
async function loadLatestMonthSubmission(username, year, monthIndex) {
  const record = await getLatestMonthSubmissionRecord(
    username,
    year,
    monthIndex
  );
  return record ? record.submission : null;
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
  let kom = 0; // Kommissionsstunden + Spezialbuchungen (ÜZ1)
  let dayHours = 0; // Tagesbezogene Stunden
  let pikett = 0; // ÜZ2 (Pikett)
  let overtime3 = 0; // ÜZ3 (Wochenende ohne Pikett)

  // days: object keyed by YYYY-MM-DD -> dayData
  if (payload && payload.days && typeof payload.days === 'object') {
    for (const dayData of Object.values(payload.days)) {
      if (!dayData || typeof dayData !== 'object') continue;

      // Kommissionsstunden
      if (Array.isArray(dayData.entries)) {
        for (const entry of dayData.entries) {
          if (!entry || !entry.hours || typeof entry.hours !== 'object')
            continue;
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

  // Nettoarbeitszeit aus Stempelungen pro Tag
  let stampHours = 0;
  if (payload && payload.days && typeof payload.days === 'object') {
    for (const dayData of Object.values(payload.days)) {
      if (Array.isArray(dayData?.stamps) && dayData.stamps.length > 0) {
        stampHours += computeNetWorkingHoursFromStamps(dayData.stamps);
      }
    }
  }

  return {
    kom: r1(kom),
    dayHours: r1(dayHours),
    pikett: r1(pikett),
    overtime3: r1(overtime3),
    total: r1(total),
    stampHours: r1(stampHours),
  };
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

  const payload = {
    year,
    monthIndex,
    monthLabel: makeMonthLabel(year, monthIndex),
    days: monthDays,
    pikett: monthPikett,
    absences: [],
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
      SELECT username, year, month_index, payload
      FROM month_submissions
      WHERE sent_at >= $1
      ORDER BY username ASC, year ASC, month_index ASC
    `,
      [fiveYearsAgo.toISOString()]
    );

    // Stamp Edits laden (für "bearbeitet" Markierung)
    const editsResult = await db.query(
      `
      SELECT username, date_key FROM stamp_edits
      WHERE transmitted_at >= $1
    `,
      [fiveYearsAgo.toISOString()]
    );

    const editedDays = new Set(
      editsResult.rows.map((r) => `${r.username}|${r.date_key}`)
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
          const isEdited = editedDays.has(`${username}|${dateKey}`);

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
          const stampStr = sorted
            .map((s) => `${s.type === 'in' ? 'Ein' : 'Aus'} ${s.time}`)
            .join('  ·  ');

          // Zeile rendern
          const editMark = isEdited ? '  ✎' : '';
          doc
            .fontSize(9)
            .font('Helvetica')
            .fillColor(isEdited ? '#d97706' : '#374151')
            .text(
              `${dateLabel}    ${stampStr}    Netto: ${netHours}${editMark}`,
              {
                continued: false,
              }
            );
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

// ============================================================================
// Anlagen domain helpers and persistence
// ============================================================================
const ANLAGEN_LEDGER_PATH = path.join(BASE_DATA_DIR, 'anlagenLedger.json');

async function ensureAnlagenTables() {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS anlagen_archive (
      team_id TEXT NOT NULL,
      kom_nr TEXT NOT NULL,
      archived_at TIMESTAMPTZ NOT NULL,
      archived_by TEXT,
      PRIMARY KEY (team_id, kom_nr)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS anlagen_month_snapshots (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      team_id TEXT,
      year INTEGER NOT NULL,
      month_index INTEGER NOT NULL CHECK (month_index BETWEEN 0 AND 11),
      month_key TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, year, month_index)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS anlagen_ledger_entries (
      team_id TEXT NOT NULL,
      kom_nr TEXT NOT NULL,
      username TEXT NOT NULL,
      date_key DATE NOT NULL,
      hours DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (team_id, kom_nr, username, date_key)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS anlagen_index_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_anlagen_archive_team
    ON anlagen_archive (team_id, kom_nr)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_anlagen_snapshots_username_month
    ON anlagen_month_snapshots (username, year, month_index)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_anlagen_ledger_team_kom
    ON anlagen_ledger_entries (team_id, kom_nr, username, date_key)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_anlagen_ledger_username_date
    ON anlagen_ledger_entries (username, date_key)
  `);
}

async function readAnlagenLedger() {
  if (!db) return {};

  const result = await db.query(`
    SELECT team_id, kom_nr, username, date_key, hours
    FROM anlagen_ledger_entries
    ORDER BY team_id ASC, kom_nr ASC, username ASC, date_key ASC
  `);

  const out = {};

  for (const row of result.rows) {
    const teamId = row.team_id;
    const komNr = row.kom_nr;
    const username = row.username;
    const dateKey =
      row.date_key instanceof Date
        ? formatDateKey(row.date_key)
        : String(row.date_key || '').slice(0, 10);

    if (!teamId || !komNr || !username || !dateKey) continue;

    if (!out[teamId]) out[teamId] = {};
    if (!out[teamId][komNr]) out[teamId][komNr] = { byUser: {} };
    if (!out[teamId][komNr].byUser[username]) {
      out[teamId][komNr].byUser[username] = { byDate: {} };
    }

    out[teamId][komNr].byUser[username].byDate[dateKey] =
      Number(row.hours) || 0;
  }

  return out;
}

function flattenAnlagenLedger(data) {
  const rows = [];

  if (!data || typeof data !== 'object') return rows;

  for (const [teamId, teamObj] of Object.entries(data)) {
    if (!teamObj || typeof teamObj !== 'object') continue;

    for (const [komNr, komObj] of Object.entries(teamObj)) {
      const byUser =
        komObj && komObj.byUser && typeof komObj.byUser === 'object'
          ? komObj.byUser
          : {};

      for (const [username, userObj] of Object.entries(byUser)) {
        const byDate =
          userObj && userObj.byDate && typeof userObj.byDate === 'object'
            ? userObj.byDate
            : {};

        for (const [dateKey, rawHours] of Object.entries(byDate)) {
          const hours = Number(rawHours) || 0;
          if (!(hours > 0)) continue;

          rows.push({
            teamId,
            komNr,
            username,
            dateKey: String(dateKey).slice(0, 10),
            hours,
          });
        }
      }
    }
  }

  return rows;
}

async function writeAnlagenLedger(data) {
  if (!db) {
    throw new Error('DATABASE_URL is not configured');
  }

  const rows = flattenAnlagenLedger(data);
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM anlagen_ledger_entries');

    if (rows.length > 0) {
      const values = [];
      const placeholders = rows.map((row, index) => {
        const base = index * 5;
        values.push(
          row.teamId,
          row.komNr,
          row.username,
          row.dateKey,
          row.hours
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      });

      await client.query(
        `
          INSERT INTO anlagen_ledger_entries (
            team_id,
            kom_nr,
            username,
            date_key,
            hours
          )
          VALUES ${placeholders.join(', ')}
        `,
        values
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function monthKey(year, monthIndex) {
  const mm = String(monthIndex + 1).padStart(2, '0');
  return `${year}-${mm}`;
}

function mapAnlagenArchiveRow(row) {
  return {
    archived: true,
    archivedAt:
      row?.archived_at instanceof Date
        ? row.archived_at.toISOString()
        : row?.archived_at || null,
    archivedBy: row?.archived_by || null,
  };
}

function buildAnlagenArchiveObject(rows) {
  const out = {};

  for (const row of rows || []) {
    const teamId = row.team_id;
    const komNr = row.kom_nr;

    if (!out[teamId]) out[teamId] = {};
    out[teamId][komNr] = mapAnlagenArchiveRow(row);
  }

  return out;
}

async function readAnlagenArchive() {
  if (!db) return {};

  const result = await db.query(`
    SELECT team_id, kom_nr, archived_at, archived_by
    FROM anlagen_archive
    ORDER BY team_id ASC, kom_nr ASC
  `);

  return buildAnlagenArchiveObject(result.rows);
}

async function setAnlagenArchiveState({ teamId, komNr, archived, archivedBy }) {
  if (!db) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (archived) {
    const result = await db.query(
      `
        INSERT INTO anlagen_archive (
          team_id,
          kom_nr,
          archived_at,
          archived_by
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (team_id, kom_nr)
        DO UPDATE SET
          archived_at = EXCLUDED.archived_at,
          archived_by = EXCLUDED.archived_by
        RETURNING team_id, kom_nr, archived_at, archived_by
      `,
      [teamId, komNr, new Date().toISOString(), archivedBy || null]
    );

    return mapAnlagenArchiveRow(result.rows[0] || null);
  }

  await db.query(
    `
      DELETE FROM anlagen_archive
      WHERE team_id = $1
        AND kom_nr = $2
    `,
    [teamId, komNr]
  );

  return null;
}

async function findAnlagenSnapshotUser(username, client = db) {
  if (!client) return null;

  const result = await client.query(
    `
      SELECT id, username, team_id, active
      FROM users
      WHERE username = $1
      LIMIT 1
    `,
    [username]
  );

  const row = result.rows[0];
  if (!row || !row.active) return null;

  return {
    id: row.id,
    username: row.username,
    teamId: row.team_id || null,
  };
}

async function readAnlagenSnapshot(username, year, monthIndex, client = db) {
  if (!client) return null;

  const user = await findAnlagenSnapshotUser(username, client);
  if (!user) return null;

  const result = await client.query(
    `
      SELECT snapshot
      FROM anlagen_month_snapshots
      WHERE user_id = $1
        AND year = $2
        AND month_index = $3
      LIMIT 1
    `,
    [user.id, year, monthIndex]
  );

  return result.rows[0]?.snapshot || null;
}

async function writeAnlagenSnapshot(
  username,
  year,
  monthIndex,
  snap,
  teamId = null,
  client = db
) {
  if (!client) {
    throw new Error('DATABASE_URL is not configured');
  }

  const user = await findAnlagenSnapshotUser(username, client);
  if (!user) {
    throw new Error(`User not found for anlagen snapshot: ${username}`);
  }

  if (snap == null) {
    await client.query(
      `
        DELETE FROM anlagen_month_snapshots
        WHERE user_id = $1
          AND year = $2
          AND month_index = $3
      `,
      [user.id, year, monthIndex]
    );
    return;
  }

  await client.query(
    `
      INSERT INTO anlagen_month_snapshots (
        user_id,
        username,
        team_id,
        year,
        month_index,
        month_key,
        snapshot,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (user_id, year, month_index)
      DO UPDATE SET
        username = EXCLUDED.username,
        team_id = EXCLUDED.team_id,
        month_key = EXCLUDED.month_key,
        snapshot = EXCLUDED.snapshot,
        updated_at = EXCLUDED.updated_at
    `,
    [
      user.id,
      user.username,
      teamId || user.teamId || null,
      year,
      monthIndex,
      monthKey(year, monthIndex),
      JSON.stringify(snap),
      new Date().toISOString(),
    ]
  );
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
  const days =
    payload && payload.days && typeof payload.days === 'object'
      ? payload.days
      : {};

  for (const [dateKey, dayData] of Object.entries(days)) {
    if (!dayData || typeof dayData !== 'object') continue;

    // 1) Regular kom entries (option buckets)
    const entries = Array.isArray(dayData.entries) ? dayData.entries : [];
    for (const e of entries) {
      const komNr = normalizeKomNr(e?.komNr);
      if (!komNr) continue;

      const hoursObj = e?.hours && typeof e.hours === 'object' ? e.hours : {};
      let sumDayKom = 0;

      if (!snap[komNr])
        snap[komNr] = {
          totalHours: 0,
          byOperation: {},
          byDate: {},
          lastActivity: null,
        };
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
        if (!rec.lastActivity || dateKey > rec.lastActivity)
          rec.lastActivity = dateKey;
      }
    }

    // 2) Special entries: split regie vs fehler
    const specials = Array.isArray(dayData.specialEntries)
      ? dayData.specialEntries
      : [];
    for (const s of specials) {
      const komNr = normalizeKomNr(s?.komNr);
      if (!komNr) continue;

      const h = toNumber(s?.hours);
      if (!(h > 0)) continue;

      if (!snap[komNr])
        snap[komNr] = {
          totalHours: 0,
          byOperation: {},
          byDate: {},
          lastActivity: null,
        };
      const rec = snap[komNr];

      const type = String(s?.type || '').toLowerCase();
      const bucket = type === 'fehler' ? '_fehler' : '_regie';

      addNum(rec.byOperation, bucket, h);
      addNum(rec.byDate, dateKey, h);

      rec.totalHours += h;
      if (!rec.lastActivity || dateKey > rec.lastActivity)
        rec.lastActivity = dateKey;
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

function applySnapshotToIndexAndLedger({
  index,
  ledger,
  teamId,
  username,
  snap,
  sign,
}) {
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

    gi.totalHours = round1(Number(gi.totalHours || 0) + sign * total);

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

function deepCloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
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

function normalizeAnlagenIndexPayload(data) {
  const fallback = { version: 1, updatedAt: null, teams: {} };

  if (!data || typeof data !== 'object') return fallback;

  const out = {
    version: Number(data.version) || 1,
    updatedAt: data.updatedAt || null,
    teams:
      data.teams && typeof data.teams === 'object' && !Array.isArray(data.teams)
        ? data.teams
        : {},
  };

  return out;
}

async function readAnlagenIndex() {
  if (!db) {
    return { version: 1, updatedAt: null, teams: {} };
  }

  const result = await db.query(
    `
      SELECT payload, updated_at
      FROM anlagen_index_state
      WHERE id = 1
      LIMIT 1
    `
  );

  const row = result.rows[0];
  if (!row) {
    return { version: 1, updatedAt: null, teams: {} };
  }

  const normalized = normalizeAnlagenIndexPayload(row.payload || {});
  normalized.updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at || normalized.updatedAt || null;

  return normalized;
}

async function writeAnlagenIndex(data) {
  if (!db) {
    throw new Error('DATABASE_URL is not configured');
  }

  const payload = normalizeAnlagenIndexPayload(data);
  const updatedAt = new Date().toISOString();
  payload.updatedAt = updatedAt;

  await db.query(
    `
      INSERT INTO anlagen_index_state (
        id,
        payload,
        updated_at
      )
      VALUES (1, $1::jsonb, $2)
      ON CONFLICT (id)
      DO UPDATE SET
        payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at
    `,
    [JSON.stringify(payload), updatedAt]
  );
}

function ensureAnlageRec(teamObj, komNr) {
  if (!teamObj[komNr] || typeof teamObj[komNr] !== 'object') {
    teamObj[komNr] = {
      totalHours: 0,
      byOperation: {},
      byUser: {},
      lastActivity: null,
    };
  }
  if (
    !teamObj[komNr].byOperation ||
    typeof teamObj[komNr].byOperation !== 'object'
  )
    teamObj[komNr].byOperation = {};
  if (!teamObj[komNr].byUser || typeof teamObj[komNr].byUser !== 'object')
    teamObj[komNr].byUser = {};
  if (!('lastActivity' in teamObj[komNr])) teamObj[komNr].lastActivity = null;
  if (!('totalHours' in teamObj[komNr])) teamObj[komNr].totalHours = 0;
  return teamObj[komNr];
}

// Extract Anlagen from one saved submission file.
// returns Map(komNr -> { totalHours, byOperation:{opKey:hours}, byUser:{username:hours}, lastActivity })
function extractAnlagenFromSubmission(submission, username) {
  const out = new Map();
  if (!submission || typeof submission !== 'object') return out;

  const days =
    submission.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  for (const [dateKey, dayData] of Object.entries(days)) {
    if (!dayData || typeof dayData !== 'object') continue;

    // 1) Kommissions entries
    const entries = Array.isArray(dayData.entries) ? dayData.entries : [];
    for (const e of entries) {
      const komNr = normalizeKomNr(e?.komNr);
      if (!komNr) continue;

      const hoursObj = e?.hours && typeof e.hours === 'object' ? e.hours : {};
      let sum = 0;

      if (!out.has(komNr)) {
        out.set(komNr, {
          totalHours: 0,
          byOperation: {},
          byUser: {},
          lastActivity: null,
        });
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
        if (!rec.lastActivity || dateKey > rec.lastActivity)
          rec.lastActivity = dateKey;
      }
    }

    // 2) Special entries (only those with komNr count into Anlagen)
    const specials = Array.isArray(dayData.specialEntries)
      ? dayData.specialEntries
      : [];
    for (const s of specials) {
      const komNr = normalizeKomNr(s?.komNr);
      if (!komNr) continue;

      const h = toNumber(s?.hours);
      if (!(h > 0)) continue;

      if (!out.has(komNr)) {
        out.set(komNr, {
          totalHours: 0,
          byOperation: {},
          byUser: {},
          lastActivity: null,
        });
      }
      const rec = out.get(komNr);

      rec.totalHours += h;
      addNum(rec.byUser, username, h);

      // split specials into regie/fehler buckets
      const t = String(s?.type || '').toLowerCase();
      const bucket = t === 'fehler' ? 'Fehler' : 'Regie'; // default regie
      addNum(rec.byOperation, bucket, h);

      if (!rec.lastActivity || dateKey > rec.lastActivity)
        rec.lastActivity = dateKey;
    }
  }

  return out;
}

// Apply delta (new - old) for one user/month submission to the global index.
// Apply a before/after delta when a month transmission changes anlagen data.
async function applyAnlagenDelta(teamId, username, newMap, oldMap) {
  const index = await readAnlagenIndex();
  if (!index.teams[teamId] || typeof index.teams[teamId] !== 'object')
    index.teams[teamId] = {};
  const teamObj = index.teams[teamId];

  const allKom = new Set([
    ...(newMap ? newMap.keys() : []),
    ...(oldMap ? oldMap.keys() : []),
  ]);

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
    rec.totalHours = round1(Number(rec.totalHours || 0) + deltaTotal);

    // byOperation
    for (const opKey of deltaOps) {
      const dv =
        Number(newRec?.byOperation?.[opKey] || 0) -
        Number(oldRec?.byOperation?.[opKey] || 0);
      addNum(rec.byOperation, opKey, dv);
    }
    cleanupZeroish(rec.byOperation);

    // byUser (only update this user key)
    const du =
      Number(newRec?.byUser?.[username] || 0) -
      Number(oldRec?.byUser?.[username] || 0);
    addNum(rec.byUser, username, du);
    cleanupZeroish(rec.byUser);

    // lastActivity: best-effort monotonic update (does not decrease)
    if (newRec?.lastActivity) {
      if (!rec.lastActivity || newRec.lastActivity > rec.lastActivity)
        rec.lastActivity = newRec.lastActivity;
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

async function rebuildAnlagenIndex() {
  const index = { version: 1, updatedAt: null, teams: {} };
  const users = await listUsersFromDb();

  for (const user of users) {
    const result = await db.query(
      `
        SELECT DISTINCT ON (year, month_index)
          payload
        FROM month_submissions
        WHERE username = $1
        ORDER BY year, month_index, sent_at DESC, created_at DESC
      `,
      [user.username]
    );

    for (const row of result.rows) {
      const sub = row.payload;
      if (!sub) continue;

      const teamId = sub.teamId || user.teamId || '' || 'unknown';
      if (!index.teams[teamId]) index.teams[teamId] = {};
      const teamObj = index.teams[teamId];

      const local = extractAnlagenFromSubmission(sub, user.username);
      for (const [komNr, rec] of local.entries()) {
        const g = ensureAnlageRec(teamObj, komNr);
        g.totalHours = round1(
          Number(g.totalHours || 0) + Number(rec.totalHours || 0)
        );

        for (const [k, v] of Object.entries(rec.byOperation || {})) {
          addNum(g.byOperation, k, v);
        }

        for (const [name, v] of Object.entries(rec.byUser || {})) {
          addNum(g.byUser, name, v);
        }

        if (
          rec.lastActivity &&
          (!g.lastActivity || rec.lastActivity > g.lastActivity)
        ) {
          g.lastActivity = rec.lastActivity;
        }

        cleanupZeroish(g.byOperation);
        cleanupZeroish(g.byUser);
      }
    }
  }

  await writeAnlagenIndex(index);
  return index;
}

// POST /api/admin/anlagen-export-pdf
// body: { teamId, komNr, donutPngDataUrl?, usersPngDataUrl? }
// ============================================================================
// Anlagen routes
// ============================================================================
app.post(
  '/api/admin/anlagen-export-pdf',
  requireAuth,
  requireAdmin,
  exportPdfBody,
  async (req, res) => {
    const teamId = String(req.body?.teamId || req.user.teamId || '');
    const komNr = normalizeKomNr(req.body?.komNr);

    if (!teamId)
      return res.status(400).json({ ok: false, error: 'Missing teamId' });
    if (!komNr)
      return res.status(400).json({ ok: false, error: 'Missing komNr' });

    const index = await readAnlagenIndex();
    const ledger = await readAnlagenLedger();
    const meta = await readAnlagenArchive();

    const teamObj =
      index.teams &&
      index.teams[teamId] &&
      typeof index.teams[teamId] === 'object'
        ? index.teams[teamId]
        : {};

    const rec = teamObj[komNr];
    if (!rec)
      return res
        .status(404)
        .json({ ok: false, error: 'KomNr not found in index' });

    const ledgerRec = ledger?.[teamId]?.[komNr] || { byUser: {} };
    const teamMeta =
      meta?.[teamId] && typeof meta[teamId] === 'object' ? meta[teamId] : {};
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
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Anlage_${komNr}.pdf"`
    );

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const now = new Date();

    // Title
    doc.fontSize(18).text(`Anlage ${komNr}`, { align: 'left' });
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .text(`Team: ${teamId} · Exportiert am: ${now.toLocaleString('de-CH')}`);
    doc.moveDown(0.6);

    // Archive info
    if (m?.archived) {
      doc
        .fontSize(10)
        .text(
          `Archiviert: Ja · am ${new Date(m.archivedAt).toLocaleString('de-CH')} · von ${m.archivedBy || '-'}`
        );
      doc.moveDown(0.6);
    }

    // Summary
    doc.fontSize(12).text('Zusammenfassung', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(14).text(
      `Total Stunden: ${Number(rec.totalHours || 0)
        .toFixed(1)
        .replace('.', ',')} h`
    );
    doc
      .fontSize(10)
      .text(`Letzte Aktivität: ${rec.lastActivity ? rec.lastActivity : '–'}`);
    doc.moveDown(0.6);

    // Charts

    doc.moveDown(0.3);

    const startX = doc.x;
    const yBefore = doc.y;

    // --- Charts block (stable layout) ---
    const pageInnerW =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
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
      doc
        .fontSize(9)
        .fillColor('#6B7280')
        .text('Donut Chart nicht vorhanden.', x + 10, chartsTopY + 10, {
          width: colW - 20,
        });
      doc.fillColor('black');
    }

    if (usersBuf) {
      doc.image(usersBuf, x + colW + colGap, chartsTopY, {
        fit: [usersBoxW, usersBoxH],
        align: 'center',
        valign: 'center',
      });
    } else {
      doc
        .fontSize(9)
        .fillColor('#6B7280')
        .text(
          'User Chart nicht vorhanden.',
          x + colW + colGap + 10,
          chartsTopY + 10,
          { width: colW - 20 }
        );
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
      doc
        .fontSize(10)
        .text(`${label}: ${o.hours.toFixed(1).replace('.', ',')} h`);
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
    const userNames = Object.keys(ledgerByUser).sort((a, b) =>
      a.localeCompare(b, 'de')
    );

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
        doc
          .fontSize(9)
          .text(`${dateLabel}: ${h.toFixed(1).replace('.', ',')} h`);
      }
    }

    doc.end();
  }
);

// ---- Admin: Anlagen summary (global) ----
// GET /api/admin/anlagen-summary?teamId=montage&status=active|archived|all&search=123
app.get(
  '/api/admin/anlagen-summary',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const status = String(req.query.status || 'active'); // default hide archived
    const teamId = String(req.query.teamId || req.user.teamId || '');

    if (!teamId)
      return res.status(400).json({ ok: false, error: 'Missing teamId' });

    const search = String(req.query.search || '').trim();
    const index = await readAnlagenIndex();
    const teamObj =
      index.teams &&
      index.teams[teamId] &&
      typeof index.teams[teamId] === 'object'
        ? index.teams[teamId]
        : {};

    const archive = await readAnlagenArchive();
    const teamArchive =
      archive[teamId] && typeof archive[teamId] === 'object'
        ? archive[teamId]
        : {};

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
  }
);

// ---- Admin: Anlage detail (global) ----
// GET /api/admin/anlagen-detail?komNr=12345&teamId=montage
app.get(
  '/api/admin/anlagen-detail',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const teamId = String(req.query.teamId || req.user.teamId || '');
    const komNr = normalizeKomNr(req.query.komNr);

    if (!teamId)
      return res.status(400).json({ ok: false, error: 'Missing teamId' });
    if (!komNr)
      return res.status(400).json({ ok: false, error: 'Missing komNr' });

    const index = await readAnlagenIndex();
    const teamObj =
      index.teams &&
      index.teams[teamId] &&
      typeof index.teams[teamId] === 'object'
        ? index.teams[teamId]
        : {};

    const rec = teamObj[komNr];
    if (!rec) {
      return res.status(404).json({ ok: false, error: 'Anlage not found' });
    }

    const archive = await readAnlagenArchive();
    const teamArchive =
      archive[teamId] && typeof archive[teamId] === 'object'
        ? archive[teamId]
        : {};
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
  }
);

// ---- Admin: archive/unarchive Anlage ----
// POST /api/admin/anlagen-archive
// body: { teamId, komNr, archived: true|false }
app.post(
  '/api/admin/anlagen-archive',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const teamId = String(req.body?.teamId || req.user.teamId || '');
    const komNr = normalizeKomNr(req.body?.komNr);
    const archived = !!req.body?.archived;

    if (!teamId) {
      return res.status(400).json({ ok: false, error: 'Missing teamId' });
    }

    if (!komNr) {
      return res.status(400).json({ ok: false, error: 'Missing komNr' });
    }

    try {
      const meta = await setAnlagenArchiveState({
        teamId,
        komNr,
        archived,
        archivedBy: req.user.username,
      });

      return res.json({
        ok: true,
        teamId,
        komNr,
        archived,
        archivedAt: meta?.archivedAt || null,
        archivedBy: meta?.archivedBy || null,
      });
    } catch (err) {
      console.error('Failed to persist anlagen archive state:', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not persist archive state' });
    }
  }
);

// ---- Admin: rebuild Anlagen index  ----
// POST /api/admin/anlagen-rebuild
app.post(
  '/api/admin/anlagen-rebuild',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const idx = await rebuildAnlagenIndex();
      return res.json({ ok: true, updatedAt: idx.updatedAt || null });
    } catch (e) {
      console.error('Anlagen rebuild failed:', e);
      return res.status(500).json({ ok: false, error: 'Rebuild failed' });
    }
  }
);

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

  const anlagenIndexBackup = deepCloneJson(await readAnlagenIndex());
  const anlagenLedgerBackup = deepCloneJson(await readAnlagenLedger());
  const anlagenMonthSnapshotBackup = deepCloneJson(
    await readAnlagenSnapshot(strictUsername, strictYear, strictMonthIndex)
  );

  try {
    if (strictTeamId) {
      const oldSnap = await readAnlagenSnapshot(
        strictUsername,
        strictYear,
        strictMonthIndex
      );

      const newSnap = extractAnlagenSnapshotFromPayload(
        payloadToSave,
        strictUsername
      );

      const index = await readAnlagenIndex();
      const ledger = await readAnlagenLedger();

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

      await writeAnlagenIndex(index);
      await writeAnlagenLedger(ledger);
      await writeAnlagenSnapshot(
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
    });
  } catch (e) {
    console.error('Strict transmission side-effect failed:', e);

    try {
      await writeAnlagenIndex(anlagenIndexBackup);
    } catch (rollbackErr) {
      console.error('Failed to restore anlagenIndex backup:', rollbackErr);
    }

    try {
      await writeAnlagenLedger(anlagenLedgerBackup);
    } catch (rollbackErr) {
      console.error('Failed to restore anlagenLedger backup:', rollbackErr);
    }

    try {
      await writeAnlagenSnapshot(
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

// ---- Absenzen: user APIs ----

// GET /api/absences  -> list my absences
// ============================================================================
// Absence routes (user + admin)
// ============================================================================
app.get('/api/absences', requireAuth, async (req, res) => {
  try {
    const absences = await listUserAbsencesFromDb(req.user.username);
    return res.json({ ok: true, absences });
  } catch (err) {
    console.error('Failed to load my absences', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Could not load absences' });
  }
});

// POST /api/absences -> create absence request
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

  // Krank = automatisch accepted, kein Admin nötig
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
    const absence = await insertAbsenceForUser({
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

      createdAt: new Date().toISOString(),
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
    return res.status(500).json({ ok: false, error: 'Could not save absence' });
  }
});

// DELETE /api/absences/:id -> user can cancel only if pending
app.delete('/api/absences/:id', requireAuth, async (req, res) => {
  const username = req.user.username;
  const id = String(req.params.id || '');

  try {
    const item = await findAbsenceByUserAndId(username, id);

    if (!item) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    if (item.status !== 'pending') {
      return res.status(409).json({
        ok: false,
        error: 'Only pending absences can be cancelled',
      });
    }

    await deleteAbsenceForUser(username, id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete absence', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Could not delete absence' });
  }
});

// POST /api/absences/:id/cancel
// - if pending -> cancelled (user self-service)
// - if accepted -> cancel_requested (admin must approve)
// - if rejected/cancelled -> no-op or conflict (your choice)
app.post('/api/absences/:id/cancel', requireAuth, async (req, res) => {
  const username = req.user.username;
  const id = String(req.params.id || '');

  try {
    const item = await findAbsenceByUserAndId(username, id);

    if (!item) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    if (item.status === 'pending') {
      const updated = await updateAbsenceStatus({
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
      const updated = await updateAbsenceStatus({
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

// ---- Absenzen: admin APIs ----

// GET /api/admin/absences?status=pending|accepted|rejected|all
app.get('/api/admin/absences', requireAuth, requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || 'pending');
    const users = await listUsersFromDb();

    const nested = await Promise.all(
      users.map((u) => listUserAbsencesFromDb(u.username))
    );

    const all = nested.flat();

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
});
// POST /api/admin/absences/decision
// body: { username, id, status: 'accepted'|'rejected' }
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

      const item = await findAbsenceByUserAndId(username, id);
      if (!item) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }

      const previousStatus = item.status;

      const updated = await updateAbsenceStatus({
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
        (previousStatus === 'accepted' || previousStatus === 'cancel_requested')
      ) {
        vacationRestored = await restoreVacationDaysForCancelledAbsence({
          username,
          absence: updated,
          updatedBy: req.user.username,
        });

        if (vacationRestored > 0) {
          console.log(
            `Restored ${vacationRestored} vacation days for ${username} (absence ${id} cancelled)`
          );
        }
      }

      return res.json({ ok: true, absence: updated, vacationRestored });
    } catch (err) {
      console.error('Failed to decide absence', err);
      return res.status(500).json({ ok: false, error: 'Decision failed' });
    }
  }
);
// ---- Konten APIs ----

// GET /api/konten/me
// ============================================================================
// Konten routes
// ============================================================================
app.get('/api/konten/me', requireAuth, async (req, res) => {
  try {
    const ensured = await ensureKontenUserRecord({
      username: req.user.username,
      teamId: req.user.teamId || null,
    });

    const transmittedMonths = await listKontenMonthKeys(req.user.username);

    return res.json({
      ok: true,
      konto: ensured.konto,
      transmittedMonths,
    });
  } catch (err) {
    console.error('Failed to load my konto', err);
    return res.status(500).json({ ok: false, error: 'Could not load konto' });
  }
});

// GET /api/admin/konten
app.get('/api/admin/konten', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await listUsersFromDb();
    const rows = await listKontenRowsForUsers(users);

    return res.json({ ok: true, users: rows });
  } catch (err) {
    console.error('Failed to load admin konten', err);
    return res.status(500).json({ ok: false, error: 'Could not load konten' });
  }
});

// POST /api/admin/konten/set
// body: { username, ueZ1, ueZ2, ueZ3, vacationDays, vacationDaysPerYear }
app.post(
  '/api/admin/konten/set',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const username = String(req.body?.username || '');

    try {
      const targetUser = await findUserByUsername(username);

      if (!username || !targetUser) {
        return res.status(400).json({ ok: false, error: 'Invalid username' });
      }

      const konto = await updateKontenManualValues({
        username,
        values: req.body || {},
        updatedBy: req.user.username,
      });

      return res.json({ ok: true, konto });
    } catch (err) {
      console.error('Failed to save admin konto', err);
      return res.status(500).json({ ok: false, error: 'Could not save konto' });
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

          const storedAbsences = await listUserAbsencesFromDb(user.username);

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

// ---- Admin: lock/unlock a week ----
// POST /api/admin/week-lock
// body: { username, weekYear, week, locked?: boolean }
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
        return res.status(400).json({ ok: false, error: 'Invalid username' });
      }

      if (!Number.isInteger(weekYear) || weekYear < 2000 || weekYear > 2100) {
        return res.status(400).json({ ok: false, error: 'Invalid weekYear' });
      }

      if (!Number.isInteger(week) || week < 1 || week > 53) {
        return res.status(400).json({ ok: false, error: 'Invalid week' });
      }

      const userLocks = await readUserWeekLocksFromDb(username);
      const wk = weekKey(weekYear, week);
      const currentMeta = getLockMeta(userLocks, wk);
      const nextLocked =
        typeof lockedParam === 'boolean' ? lockedParam : !currentMeta.locked;

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
        await clearWeekLockState({
          userId: targetUser.id,
          weekYear,
          week,
        });
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

// GET /api/week-locks/me...... für user panel
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

    return res.json({ ok: true });
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

      const storedAbsences = await listUserAbsencesFromDb(username);
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

  let ytdPositiveUntilEnd = 0;
  let ytdPositiveBeforePeriod = 0;

  const transmittedMonths = [];
  const missingMonths = [];

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

    const partial = aggregatePayrollFromSubmission(
      submission,
      fromKey,
      toKey,
      absencesById
    );

    const partialOvertime = await computePayrollPeriodOvertimeFromSubmission(
      submission,
      fromKey,
      toKey,
      user.id
    );

    totals.praesenzStunden += partial.praesenzStunden;
    totals.ueZ3Hours += partial.ueZ3Hours;
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

      // Präsenzstunden aus Stamps
      if (Array.isArray(dayData.stamps) && dayData.stamps.length > 0) {
        row.praesenzStunden += num(
          computeNetWorkingHoursFromStamps(dayData.stamps)
        );
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

  const selectedYearStart = new Date(selectedYear, 0, 1);
  const selectedYearStartKey = formatDateKey(selectedYearStart);

  const vorarbeitPeriodStart =
    periodStart > selectedYearStart ? periodStart : selectedYearStart;

  const dayBeforeVorarbeitPeriodStart = new Date(vorarbeitPeriodStart);
  dayBeforeVorarbeitPeriodStart.setDate(
    dayBeforeVorarbeitPeriodStart.getDate() - 1
  );

  const hasPriorVorarbeitWindow =
    dayBeforeVorarbeitPeriodStart >= selectedYearStart;
  const priorVorarbeitEndKey = hasPriorVorarbeitWindow
    ? formatDateKey(dayBeforeVorarbeitPeriodStart)
    : null;

  const ytdMonthRange = getMonthRangeBetween(selectedYearStart, periodEnd);

  for (const month of ytdMonthRange) {
    const submission = await loadLatestMonthSubmission(
      user.username,
      month.year,
      month.monthIndex
    );

    if (!submission) continue;

    const ytdPartial = await computePayrollPeriodOvertimeFromSubmission(
      submission,
      selectedYearStartKey,
      toKey,
      user.id
    );

    ytdPositiveUntilEnd += ytdPartial.ueZ1Positive;

    if (hasPriorVorarbeitWindow) {
      const beforePartial = await computePayrollPeriodOvertimeFromSubmission(
        submission,
        selectedYearStartKey,
        priorVorarbeitEndKey,
        user.id
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
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

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
    const teamId = String(req.user.teamId || '');

    try {
      const users = await listUsersFromDb({
        role: 'user',
        teamId: teamId || null,
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

      const fmtHours = (v) =>
        `${(Number(v) || 0).toFixed(1).replace('.', ',')} h`;
      const fmtSignedHours = (v) => {
        const n = Number(v) || 0;
        const abs = Math.abs(n).toFixed(1).replace('.', ',');
        if (n > 0) return `+${abs} h`;
        if (n < 0) return `-${abs} h`;
        return '0,0 h';
      };
      const fmtDays = (v) => `${String(Number(v) || 0).replace('.', ',')} Tage`;
      const fmtCount = (v) => String(Math.round(Number(v) || 0));

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
          doc
            .font('Helvetica-Bold')
            .fontSize(9)
            .text(`${label}: `, { continued: true });
          doc.font('Helvetica').fontSize(9).text(value);
        });
      }

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
          ensurePdfSpace(42);

          doc.font('Helvetica-Bold').fontSize(9).text(entry.dateLabel);

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
      SELECT id, username, role, team_id, active, email, created_at
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
    const { email, role, teamId } = req.body || {};

    try {
      const result = await db.query(
        `
      UPDATE users
      SET
        email = COALESCE($2, email),
        role = COALESCE($3, role),
        team_id = COALESCE($4, team_id),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, username, role, team_id, active, email
    `,
        [id, email || null, role || null, teamId || null]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ ok: false, error: 'User not found' });
      }

      return res.json({ ok: true, user: mapDbUser(result.rows[0]) });
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

// POST /api/admin/users/:id/deactivate
app.post(
  '/api/admin/users/:id/deactivate',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;

    if (id === req.user.id) {
      return res
        .status(400)
        .json({ ok: false, error: 'Cannot deactivate your own account' });
    }

    try {
      await db.query(
        `UPDATE users SET active = FALSE, updated_at = NOW() WHERE id = $1`,
        [id]
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to deactivate user', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Could not deactivate user' });
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

// ============================================================================
// Server startup
// ============================================================================
async function startServer() {
  await ensureUsersTable();
  await ensureSessionsTable();
  await ensureMonthSubmissionsTable();
  await ensureKontenTables();
  await ensureAbsencesTable();
  await ensureWeekLocksTable();
  await ensureDraftsTable();
  await ensureLiveStampsTable();
  await ensureStampEditsTable();
  await ensureWorkSchedulesTable();
  await ensureAnlagenTables();
  await seedInitialUsers();

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

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
