'use strict';

/**
 * @fileoverview Anlagen — Index, Ledger, Snapshots und Routes
 *
 * Verwaltet die Stundenbuchungen auf Kommissionsnummern (Anlagen).
 *
 * Datenstruktur:
 * - anlagen_index_state: Aggregierter Gesamtindex (totalHours, byOperation, byUser)
 * - anlagen_ledger_entries: Tageseinträge pro Team/KomNr/User
 * - anlagen_month_snapshots: Monats-Snapshots pro User für Delta-Berechnung
 * - anlagen_archive: Archivierte Anlagen
 *
 * Beim Transmit:
 * 1. Alten Snapshot laden (oldSnap)
 * 2. Neuen Snapshot aus Payload berechnen (newSnap)
 * 3. Delta auf Index + Ledger anwenden (oldSnap mit -1, newSnap mit +1)
 * 4. Neuen Snapshot speichern
 */

const PDFDocument = require('pdfkit');
const { formatDateKey, formatDateDisplayEU, monthKey } = require('./holidays');
const {
  round1,
  toNumber,
  normalizeKomNr,
  addNum,
  subNum,
  cleanupZeroish,
  deepCloneJson,
} = require('./compute');
const { getOperationLabel } = require('./constants');

// ─────────────────────────────────────────────────────────────────────────────
// Ledger (tagesbasierte Buchungen)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lädt den kompletten Anlagen-Ledger aus der DB.
 * Struktur: { teamId: { komNr: { byUser: { username: { byDate: { dateKey: hours } } } } } }
 *
 * @param {import('pg').Pool} db
 * @returns {Promise<object>}
 */
async function readAnlagenLedger(db) {
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

/**
 * Flacht den Ledger zu einer Liste von Zeilen ab (für DB-Insert).
 *
 * @param {object} data
 * @returns {Array<{ teamId, komNr, username, dateKey, hours }>}
 */
function flattenAnlagenLedger(data) {
  const rows = [];
  if (!data || typeof data !== 'object') return rows;

  for (const [teamId, teamObj] of Object.entries(data)) {
    if (!teamObj || typeof teamObj !== 'object') continue;

    for (const [komNr, komObj] of Object.entries(teamObj)) {
      const byUser =
        komObj?.byUser && typeof komObj.byUser === 'object'
          ? komObj.byUser
          : {};

      for (const [username, userObj] of Object.entries(byUser)) {
        const byDate =
          userObj?.byDate && typeof userObj.byDate === 'object'
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

/**
 * Schreibt den kompletten Ledger in die DB (DELETE + INSERT in einer Transaktion).
 *
 * @param {import('pg').Pool} db
 * @param {object} data
 */
async function writeAnlagenLedger(db, data) {
  if (!db) throw new Error('DATABASE_URL is not configured');

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
        `INSERT INTO anlagen_ledger_entries (team_id, kom_nr, username, date_key, hours)
         VALUES ${placeholders.join(', ')}`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Archiv
// ─────────────────────────────────────────────────────────────────────────────

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
    out[row.kom_nr] = mapAnlagenArchiveRow(row);
  }
  return out;
}

/**
 * @param {import('pg').Pool} db
 */
async function readAnlagenArchive(db) {
  if (!db) return {};

  const result = await db.query(`
    SELECT team_id, kom_nr, archived_at, archived_by
    FROM anlagen_archive
    ORDER BY team_id ASC, kom_nr ASC
  `);

  return buildAnlagenArchiveObject(result.rows);
}

/**
 * Archiviert oder de-archiviert eine Anlage.
 *
 * @param {import('pg').Pool} db
 * @param {{ teamId: string, komNr: string, archived: boolean, archivedBy: string }} params
 */
async function setAnlagenArchiveState(
  db,
  { teamId, komNr, archived, archivedBy }
) {
  if (!db) throw new Error('DATABASE_URL is not configured');

  if (archived) {
    await db.query(`DELETE FROM anlagen_archive WHERE kom_nr = $1`, [komNr]);
    const result = await db.query(
      `INSERT INTO anlagen_archive (team_id, kom_nr, archived_at, archived_by)
       VALUES ($1, $2, $3, $4)
       RETURNING team_id, kom_nr, archived_at, archived_by`,
      [teamId || 'global', komNr, new Date().toISOString(), archivedBy || null]
    );
    return mapAnlagenArchiveRow(result.rows[0] || null);
  }

  await db.query(`DELETE FROM anlagen_archive WHERE kom_nr = $1`, [komNr]);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshots
// ─────────────────────────────────────────────────────────────────────────────

async function findAnlagenSnapshotUser(db, username, client) {
  const conn = client || db;
  if (!conn) return null;

  const result = await conn.query(
    `SELECT id, username, team_id, active FROM users WHERE username = $1 LIMIT 1`,
    [username]
  );

  const row = result.rows[0];
  if (!row || !row.active) return null;
  return { id: row.id, username: row.username, teamId: row.team_id || null };
}

/**
 * @param {import('pg').Pool} db
 */
async function readAnlagenSnapshot(db, username, year, monthIndex, client) {
  const conn = client || db;
  if (!conn) return null;

  const user = await findAnlagenSnapshotUser(db, username, conn);
  if (!user) return null;

  const result = await conn.query(
    `SELECT snapshot FROM anlagen_month_snapshots
     WHERE user_id = $1 AND year = $2 AND month_index = $3 LIMIT 1`,
    [user.id, year, monthIndex]
  );

  return result.rows[0]?.snapshot || null;
}

/**
 * @param {import('pg').Pool} db
 */
async function writeAnlagenSnapshot(
  db,
  username,
  year,
  monthIndex,
  snap,
  teamId = null,
  client
) {
  const conn = client || db;
  if (!conn) throw new Error('DATABASE_URL is not configured');

  const user = await findAnlagenSnapshotUser(db, username, conn);
  if (!user)
    throw new Error(`User not found for anlagen snapshot: ${username}`);

  if (snap == null) {
    await conn.query(
      `DELETE FROM anlagen_month_snapshots WHERE user_id = $1 AND year = $2 AND month_index = $3`,
      [user.id, year, monthIndex]
    );
    return;
  }

  await conn.query(
    `INSERT INTO anlagen_month_snapshots
       (user_id, username, team_id, year, month_index, month_key, snapshot, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (user_id, year, month_index)
     DO UPDATE SET
       username = EXCLUDED.username,
       team_id = EXCLUDED.team_id,
       month_key = EXCLUDED.month_key,
       snapshot = EXCLUDED.snapshot,
       updated_at = EXCLUDED.updated_at`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot-Extraktion aus Payload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrahiert einen Anlagen-Snapshot aus einem Monats-Payload.
 * Gibt { [komNr]: { totalHours, byOperation, byDate, lastActivity } } zurück.
 *
 * @param {object} payload
 * @param {string} username
 * @returns {object}
 */
function extractAnlagenSnapshotFromPayload(payload, username) {
  const snap = {};
  const days =
    payload?.days && typeof payload.days === 'object' ? payload.days : {};

  for (const [dateKey, dayData] of Object.entries(days)) {
    if (!dayData || typeof dayData !== 'object') continue;

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

  for (const [komNr, rec] of Object.entries(snap)) {
    if (!(rec.totalHours > 0)) delete snap[komNr];
  }

  return snap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Index
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAnlagenIndexPayload(data) {
  const fallback = { version: 1, updatedAt: null, teams: {} };
  if (!data || typeof data !== 'object') return fallback;
  return {
    version: Number(data.version) || 1,
    updatedAt: data.updatedAt || null,
    teams:
      data.teams && typeof data.teams === 'object' && !Array.isArray(data.teams)
        ? data.teams
        : {},
  };
}

/**
 * @param {import('pg').Pool} db
 */
async function readAnlagenIndex(db) {
  if (!db) return { version: 1, updatedAt: null, teams: {} };

  const result = await db.query(
    `SELECT payload, updated_at FROM anlagen_index_state WHERE id = 1 LIMIT 1`
  );

  const row = result.rows[0];
  if (!row) return { version: 1, updatedAt: null, teams: {} };

  const normalized = normalizeAnlagenIndexPayload(row.payload || {});
  normalized.updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at || normalized.updatedAt || null;

  return normalized;
}

/**
 * @param {import('pg').Pool} db
 */
async function writeAnlagenIndex(db, data) {
  if (!db) throw new Error('DATABASE_URL is not configured');

  const payload = normalizeAnlagenIndexPayload(data);
  const updatedAt = new Date().toISOString();
  payload.updatedAt = updatedAt;

  await db.query(
    `INSERT INTO anlagen_index_state (id, payload, updated_at)
     VALUES (1, $1::jsonb, $2)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
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

function getMaxDateFromKomLedger(komLedger) {
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

function recomputeLastActivitiesForTeam(index, ledger, teamId, komNrs) {
  for (const komNr of komNrs) {
    const gi = index?.teams?.[teamId]?.[komNr];
    if (!gi) continue;
    const komLedger = ledger?.[teamId]?.[komNr];
    gi.lastActivity = getMaxDateFromKomLedger(komLedger);
  }
}

/**
 * Wendet einen Snapshot auf Index und Ledger an.
 * sign: +1 = addieren, -1 = subtrahieren
 */
function applySnapshotToIndexAndLedger({
  index,
  ledger,
  teamId,
  username,
  snap,
  sign,
}) {
  if (!index.teams || typeof index.teams !== 'object') index.teams = {};
  if (!index.teams[teamId] || typeof index.teams[teamId] !== 'object')
    index.teams[teamId] = {};
  if (!ledger[teamId] || typeof ledger[teamId] !== 'object')
    ledger[teamId] = {};

  const teamIndex = index.teams[teamId];

  for (const [komNr, rec] of Object.entries(snap || {})) {
    // Index
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

    for (const [k, v] of Object.entries(rec.byOperation || {})) {
      const h = Number(v) || 0;
      if (sign > 0) addNum(gi.byOperation, k, h);
      else subNum(gi.byOperation, k, h);
    }
    cleanupZeroish(gi.byOperation);

    if (sign > 0) addNum(gi.byUser, username, total);
    else subNum(gi.byUser, username, total);
    cleanupZeroish(gi.byUser);

    // Ledger
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

    if (Object.keys(lu.byDate).length === 0)
      delete ledger[teamId][komNr].byUser[username];
    if (Object.keys(ledger[teamId][komNr].byUser).length === 0)
      delete ledger[teamId][komNr];
    if (!(gi.totalHours > 0)) delete teamIndex[komNr];
  }
}

/**
 * Extrahiert Anlagen aus einer Submission (für rebuildAnlagenIndex).
 *
 * @param {object} submission
 * @param {string} username
 * @returns {Map<string, object>}
 */
function extractAnlagenFromSubmission(submission, username) {
  const out = new Map();
  if (!submission || typeof submission !== 'object') return out;

  const days =
    submission.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  for (const [dateKey, dayData] of Object.entries(days)) {
    if (!dayData || typeof dayData !== 'object') continue;

    const entries = Array.isArray(dayData.entries) ? dayData.entries : [];
    for (const e of entries) {
      const komNr = normalizeKomNr(e?.komNr);
      if (!komNr) continue;

      const hoursObj = e?.hours && typeof e.hours === 'object' ? e.hours : {};
      let sum = 0;

      if (!out.has(komNr))
        out.set(komNr, {
          totalHours: 0,
          byOperation: {},
          byUser: {},
          lastActivity: null,
        });
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

    const specials = Array.isArray(dayData.specialEntries)
      ? dayData.specialEntries
      : [];
    for (const s of specials) {
      const komNr = normalizeKomNr(s?.komNr);
      if (!komNr) continue;

      const h = toNumber(s?.hours);
      if (!(h > 0)) continue;

      if (!out.has(komNr))
        out.set(komNr, {
          totalHours: 0,
          byOperation: {},
          byUser: {},
          lastActivity: null,
        });
      const rec = out.get(komNr);

      rec.totalHours += h;
      addNum(rec.byUser, username, h);
      const t = String(s?.type || '').toLowerCase();
      addNum(rec.byOperation, t === 'fehler' ? 'Fehler' : 'Regie', h);
      if (!rec.lastActivity || dateKey > rec.lastActivity)
        rec.lastActivity = dateKey;
    }
  }

  return out;
}

/**
 * Baut den kompletten Anlagen-Index aus allen Submissions neu auf.
 *
 * @param {import('pg').Pool} db
 * @param {Function} listUsersFromDb
 */
async function rebuildAnlagenIndex(db, listUsersFromDb) {
  const index = { version: 1, updatedAt: null, teams: {} };
  const users = await listUsersFromDb(db);

  for (const user of users) {
    const result = await db.query(
      `SELECT DISTINCT ON (year, month_index) payload
       FROM month_submissions
       WHERE username = $1
       ORDER BY year, month_index, sent_at DESC, created_at DESC`,
      [user.username]
    );

    for (const row of result.rows) {
      const sub = row.payload;
      if (!sub) continue;

      const teamId = sub.teamId || user.teamId || 'unknown';
      if (!index.teams[teamId]) index.teams[teamId] = {};
      const teamObj = index.teams[teamId];

      const local = extractAnlagenFromSubmission(sub, user.username);
      for (const [komNr, rec] of local.entries()) {
        const g = ensureAnlageRec(teamObj, komNr);
        g.totalHours = round1(
          Number(g.totalHours || 0) + Number(rec.totalHours || 0)
        );

        for (const [k, v] of Object.entries(rec.byOperation || {}))
          addNum(g.byOperation, k, v);
        for (const [n, v] of Object.entries(rec.byUser || {}))
          addNum(g.byUser, n, v);

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

  await writeAnlagenIndex(db, index);
  return index;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registriert alle Anlagen-Routes.
 *
 * @param {import('express').Application} app
 * @param {import('pg').Pool} db
 * @param {import('express').RequestHandler} requireAuth
 * @param {import('express').RequestHandler} requireAdmin
 * @param {import('express').RequestHandler} exportPdfBody
 * @param {Function} listUsersFromDb
 */
function registerAnlagenRoutes(
  app,
  db,
  requireAuth,
  requireAdmin,
  exportPdfBody,
  listUsersFromDb
) {
  // POST /api/admin/anlagen-export-pdf
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

      const index = await readAnlagenIndex(db);
      const ledger = await readAnlagenLedger(db);
      const meta = await readAnlagenArchive(db);

      const teamObj =
        index.teams?.[teamId] && typeof index.teams[teamId] === 'object'
          ? index.teams[teamId]
          : {};
      const rec = teamObj[komNr];
      if (!rec)
        return res
          .status(404)
          .json({ ok: false, error: 'KomNr not found in index' });

      const ledgerRec = ledger?.[teamId]?.[komNr] || { byUser: {} };
      const m = meta?.[komNr] || null;

      function dataUrlToPngBuffer(url) {
        if (!url || typeof url !== 'string') return null;
        if (!url.startsWith('data:image/png;base64,')) return null;
        const b64 = url.split(',')[1];
        if (!b64 || b64.length > 8_000_000) return null;
        return Buffer.from(b64, 'base64');
      }

      const donutBuf = dataUrlToPngBuffer(req.body?.donutPngDataUrl);
      const usersBuf = dataUrlToPngBuffer(req.body?.usersPngDataUrl);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Anlage_${komNr}.pdf"`
      );

      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      doc.pipe(res);

      const now = new Date();

      doc.fontSize(18).text(`Anlage ${komNr}`, { align: 'left' });
      doc.moveDown(0.2);
      doc
        .fontSize(10)
        .text(
          `Team: ${teamId} · Exportiert am: ${now.toLocaleString('de-CH')}`
        );
      doc.moveDown(0.6);

      if (m?.archived) {
        doc
          .fontSize(10)
          .text(
            `Archiviert: Ja · am ${new Date(m.archivedAt).toLocaleString('de-CH')} · von ${m.archivedBy || '-'}`
          );
        doc.moveDown(0.6);
      }

      doc.fontSize(12).text('Zusammenfassung', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(14).text(
        `Total Stunden: ${Number(rec.totalHours || 0)
          .toFixed(1)
          .replace('.', ',')} h`
      );
      doc.fontSize(10).text(`Letzte Aktivität: ${rec.lastActivity || '–'}`);
      doc.moveDown(0.6);

      const pageInnerW =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const x = doc.page.margins.left;
      const colGap = 18;
      const colW = (pageInnerW - colGap) / 2;
      const boxH = Math.floor(colW);

      doc.moveDown(0.4);
      const chartsTopY = doc.y;

      doc.save();
      doc.lineWidth(1).strokeColor('#E5E7EB');
      doc.rect(x, chartsTopY, colW, boxH).stroke();
      doc.rect(x + colW + colGap, chartsTopY, colW, boxH).stroke();
      doc.restore();

      if (donutBuf) {
        doc.image(donutBuf, x, chartsTopY, {
          fit: [colW, boxH],
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
          fit: [colW, boxH],
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

      doc.y = chartsTopY + boxH + 18;

      doc.fontSize(12).text('Stunden nach Tätigkeit', { underline: true });
      doc.moveDown(0.3);
      Object.entries(rec.byOperation || {})
        .map(([key, hours]) => ({ key, hours: Number(hours) || 0 }))
        .filter((x) => x.hours > 0)
        .sort((a, b) => b.hours - a.hours)
        .forEach((o) => {
          doc
            .fontSize(10)
            .text(
              `${getOperationLabel(o.key)}: ${o.hours.toFixed(1).replace('.', ',')} h`
            );
        });

      doc.moveDown(0.6);
      doc.fontSize(12).text('Stunden nach Mitarbeiter', { underline: true });
      doc.moveDown(0.3);
      Object.entries(rec.byUser || {})
        .map(([u, h]) => ({ u, h: Number(h) || 0 }))
        .filter((x) => x.h > 0)
        .sort((a, b) => b.h - a.h)
        .forEach((u) => {
          doc
            .fontSize(10)
            .text(`${u.u}: ${u.h.toFixed(1).replace('.', ',')} h`);
        });

      doc.moveDown(0.8);
      doc.fontSize(12).text('Tagesjournal', { underline: true });
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .text('Pro Mitarbeiter die Tages-Summen für diese Anlage.');

      const userNames = Object.keys(ledgerRec?.byUser || {}).sort((a, b) =>
        a.localeCompare(b, 'de')
      );
      for (const uname of userNames) {
        const byDate = ledgerRec.byUser[uname]?.byDate || {};
        const dates = Object.keys(byDate).sort();
        if (dates.length === 0) continue;

        if (doc.y > 760) doc.addPage();
        doc.moveDown(0.5);
        doc.fontSize(10).text(uname, { underline: true });

        for (const dk of dates) {
          const h = Number(byDate[dk]) || 0;
          if (!(h > 0)) continue;
          if (doc.y > 780) doc.addPage();
          doc
            .fontSize(9)
            .text(
              `${formatDateDisplayEU(dk)}: ${h.toFixed(1).replace('.', ',')} h`
            );
        }
      }

      doc.end();
    }
  );

  // GET /api/admin/anlagen-summary
  app.get(
    '/api/admin/anlagen-summary',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const status = String(req.query.status || 'active');
      const teamId = String(req.query.teamId || '');
      const search = String(req.query.search || '').trim();

      const index = await readAnlagenIndex(db);
      let teamObj = {};
      if (teamId && index.teams?.[teamId]) {
        teamObj = index.teams[teamId];
      } else if (!teamId) {
        Object.values(index.teams || {}).forEach((t) => {
          if (typeof t === 'object') Object.assign(teamObj, t);
        });
      }

      const archive = await readAnlagenArchive(db);

      const list = Object.entries(teamObj).map(([komNr, rec]) => {
        const m = archive[komNr] || null;
        const archived = !!(m && m.archived);

        let topOpKey = null,
          topOpHours = 0;
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
        return !a.archived;
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

  // GET /api/admin/anlagen-detail
  app.get(
    '/api/admin/anlagen-detail',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const teamIdParam = String(req.query.teamId || '');
      const komNr = normalizeKomNr(req.query.komNr);

      if (!komNr)
        return res.status(400).json({ ok: false, error: 'Missing komNr' });

      const index = await readAnlagenIndex(db);

      let teamId = teamIdParam,
        rec = null;
      if (teamId) {
        rec = index.teams?.[teamId]?.[komNr] || null;
      } else {
        for (const [tid, teamObj] of Object.entries(index.teams || {})) {
          if (teamObj[komNr]) {
            teamId = tid;
            rec = teamObj[komNr];
            break;
          }
        }
      }

      if (!rec)
        return res.status(404).json({ ok: false, error: 'Anlage not found' });

      const archive = await readAnlagenArchive(db);
      const m = archive[komNr] || null;

      return res.json({
        ok: true,
        teamId,
        komNr,
        totalHours: round1(rec.totalHours || 0),
        lastActivity: rec.lastActivity || null,
        operations: Object.entries(rec.byOperation || {})
          .map(([key, hours]) => ({ key, hours: round1(hours) }))
          .sort((a, b) => b.hours - a.hours),
        users: Object.entries(rec.byUser || {})
          .map(([username, hours]) => ({ username, hours: round1(hours) }))
          .sort((a, b) => b.hours - a.hours),
        archived: !!(m && m.archived),
        archivedAt: m?.archivedAt || null,
        archivedBy: m?.archivedBy || null,
        updatedAt: index.updatedAt || null,
      });
    }
  );

  // POST /api/admin/anlagen-archive
  app.post(
    '/api/admin/anlagen-archive',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const teamIdParam = String(req.body?.teamId || '');
      const komNr = normalizeKomNr(req.body?.komNr);
      const archived = !!req.body?.archived;

      if (!komNr)
        return res.status(400).json({ ok: false, error: 'Missing komNr' });

      let teamId = teamIdParam;
      if (!teamId) {
        const index = await readAnlagenIndex(db);
        for (const [tid, teamObj] of Object.entries(index.teams || {})) {
          if (teamObj[komNr]) {
            teamId = tid;
            break;
          }
        }
      }

      if (!teamId)
        return res.status(400).json({ ok: false, error: 'KomNr not found' });

      try {
        const meta = await setAnlagenArchiveState(db, {
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

  // POST /api/admin/anlagen-rebuild
  app.post(
    '/api/admin/anlagen-rebuild',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const idx = await rebuildAnlagenIndex(db, listUsersFromDb);
        return res.json({ ok: true, updatedAt: idx.updatedAt || null });
      } catch (e) {
        console.error('Anlagen rebuild failed:', e);
        return res.status(500).json({ ok: false, error: 'Rebuild failed' });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Ledger
  readAnlagenLedger,
  flattenAnlagenLedger,
  writeAnlagenLedger,

  // Archiv
  readAnlagenArchive,
  setAnlagenArchiveState,

  // Snapshots
  readAnlagenSnapshot,
  writeAnlagenSnapshot,

  // Index
  readAnlagenIndex,
  writeAnlagenIndex,
  ensureAnlageRec,
  normalizeAnlagenIndexPayload,

  // Berechnungen
  extractAnlagenSnapshotFromPayload,
  extractAnlagenFromSubmission,
  applySnapshotToIndexAndLedger,
  recomputeLastActivitiesForTeam,
  rebuildAnlagenIndex,
  deepCloneJson,

  // Routes
  registerAnlagenRoutes,
};
