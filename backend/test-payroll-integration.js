/**
 * sketch-time-tool — Payroll Integration Tests
 *
 * Legt echte Testdaten in der DB an, ruft den Payroll-Endpoint auf
 * und prüft die Ergebnisse gegen manuell berechnete Erwartungswerte.
 *
 * Ausführen (Server muss auf Port 3000 laufen):
 *   node test-payroll-integration.js <admin-user> <admin-pass>
 *
 * ── Szenario ──────────────────────────────────────────────────
 *
 * User: __payroll_test__, 100%, Start 2024-01-01
 *
 * März 2025 (21 Werktage, kein Feiertag in Bern):
 *   20 Tage gestempelt: 07:30–16:00 = 8.5h (diff = +0.5h → Vorarbeit)
 *   1 Fehltag: 2025-03-31 (kein Stempel, keine Absenz → diff = -8.0h → ÜZ1)
 *   → ueZ1Raw = +2.0h, ueZ1Positive = 10.0h, Präsenz = 170.0h
 *
 * April 2025 (20 Werktage mit Soll>0, Karfreitag + Ostermontag ausgelassen):
 *   20 Tage gestempelt: 07:30–16:30 = 9.0h (diff = +1.0h → 0.5h Vorarbeit + 0.5h ÜZ1)
 *   → ueZ1Raw = +20.0h, ueZ1Positive = 20.0h, Präsenz = 180.0h
 *
 * ── Erwartete Resultate (manuell berechnet) ───────────────────
 *
 * Periode März (01.03–31.03):
 *   ueZ1Raw              = +2.0h
 *   ytdPositive          = 10.0h  → vorarbeitFilled = 10.0h
 *   vorarbeitApplied     = min(10.0, max(0, 2.0)) = 2.0h  ← Cap greift
 *   ueZ1AfterVorarbeit   = 2.0 - 2.0 = 0.0h
 *   praesenz             = 170.0h
 *
 * Periode April (01.04–30.04), März schon übertragen:
 *   ueZ1Raw              = +20.0h
 *   ytdPositiveUntilEnd  = 10.0 + 20.0 = 30.0h  → vorarbeitFilled = 30.0h
 *   ytdPositiveBeforePeriod (Jan–Feb) = 10.0h (März)
 *   vorarbeitApplied     = min(20.0, max(0, 20.0)) = 20.0h
 *   ueZ1AfterVorarbeit   = 0.0h
 *   praesenz             = 180.0h
 *
 * Periode März+April (01.03–30.04):
 *   ueZ1Raw              = +22.0h
 *   ytdPositiveUntilEnd  = 30.0h  → vorarbeitFilled = 30.0h
 *   vorarbeitApplied     = min(30.0, max(0, 22.0)) = 22.0h  ← Cap greift!
 *   ueZ1AfterVorarbeit   = 22.0 - 22.0 = 0.0h
 *   praesenz             = 350.0h
 *
 * Mit Korrektur +5h:
 *   ueZ1Correction       = +5.0h
 *   ueZ1Total            = 22.0 + 5.0 = 27.0h
 */

'use strict';

const { Client } = require('pg');
const argon2 = require('argon2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const TEST_USERNAME = '__payroll_test__';
const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[34m';
const X = '\x1b[0m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`  ${G}✓${X} ${name}`);
  passed++;
}
function fail(name, got, exp) {
  console.log(`  ${R}✗${X} ${name}`);
  console.log(`    ${R}Erwartet: ${JSON.stringify(exp)}${X}`);
  console.log(`    ${R}Erhalten:  ${JSON.stringify(got)}${X}`);
  failed++;
}
function section(name) {
  console.log(`\n${BOLD}${B}▸ ${name}${X}`);
}
function check(name, got, exp, tol = 0.05) {
  if (typeof got === 'number' && typeof exp === 'number') {
    if (Math.abs(got - exp) <= tol) pass(name);
    else fail(name, got, exp);
  } else {
    if (got === exp) pass(name);
    else fail(name, got, exp);
  }
}

// ── .env laden ───────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) {
        process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    });
}

// ── HTTP Helper ───────────────────────────────────────────────
async function api(path, opts = {}, token = '') {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `HTTP ${res.status} auf ${path} — Server antwortete kein JSON:\n${text.slice(0, 200)}`
    );
  }
  return {
    status: res.status,
    body,
    token: res.headers.get('set-token') || '',
  };
}

async function login(username, password) {
  const r = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!r.body.ok) throw new Error(`Login fehlgeschlagen: ${r.body.error}`);
  return r.body.token; // ← token statt token
}

async function getPayrollRow(token, from, to) {
  const r = await api(
    `/api/admin/payroll-period?from=${from}&to=${to}`,
    {},
    token
  );
  if (!r.body.rows)
    throw new Error(`Payroll-Response ungültig: ${JSON.stringify(r.body)}`);
  const row = r.body.rows.find((r) => r.username === TEST_USERNAME);
  if (!row) throw new Error(`Kein Payroll-Row für ${TEST_USERNAME} gefunden`);
  return row;
}

// ── Payload Builder ───────────────────────────────────────────

/**
 * Erstellt einen Submission-Payload für die angegebenen Daten.
 * stampsByDate: { '2025-03-03': { in: '07:30', out: '16:00' }, ... }
 * Tage ohne Eintrag = Fehltage
 */
function buildPayload(stampsByDate) {
  const days = {};
  for (const [dk, s] of Object.entries(stampsByDate)) {
    days[dk] = {
      stamps: [
        { time: s.in, type: 'in' },
        { time: s.out, type: 'out' },
      ],
      flags: {},
      mealAllowance: {},
    };
  }
  return { days, pikett: [], absences: [] };
}

/** Alle Werktage (Mo–Fr) eines Monats als Array von YYYY-MM-DD */
function getWeekdays(year, monthIndex) {
  const days = [];
  const d = new Date(year, monthIndex, 1);
  while (d.getMonth() === monthIndex) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) {
      const dk = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push(dk);
    }
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ── DB Setup ──────────────────────────────────────────────────
async function setupTestData(db) {
  // Test-User löschen falls vorhanden (CASCADE löscht alles)
  await db.query(`DELETE FROM users WHERE username = $1`, [TEST_USERNAME]);

  // User anlegen
  const userId = `u-test-${crypto.randomBytes(6).toString('hex')}`;
  const passwordHash = await argon2.hash('Test1234!');
  await db.query(
    `INSERT INTO users (id, username, password_hash, role, team_id, active, employment_start)
     VALUES ($1, $2, $3, 'user', 'montage', true, '2024-01-01')`,
    [userId, TEST_USERNAME, passwordHash]
  );

  // Work Schedule: 100%, Mo–Fr je 8h
  await db.query(
    `INSERT INTO work_schedules (user_id, username, employment_pct, work_days, valid_from)
     VALUES ($1, $2, 100, '{"mon":8.0,"tue":8.0,"wed":8.0,"thu":8.0,"fri":8.0}', '2024-01-01')`,
    [userId, TEST_USERNAME]
  );

  // Konten anlegen (ue_z1_correction = 0 zu Start)
  await db.query(
    `INSERT INTO konten (user_id, username, team_id)
     VALUES ($1, $2, 'montage')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, TEST_USERNAME]
  );

  // März-Snapshot damit April-Test korrekt startet (Vorarbeit = 10h nach März)
  await db.query(
    `INSERT INTO konten_snapshots
       (user_id, username, year, month_index, month_key, ue_z1, ue_z1_positive, ue_z2, ue_z3, vac_used, vorarbeit_balance)
     VALUES ($1, $2, 2025, 2, '2025-03', -8.0, 0, 0, 0, 0, 10.0)`,
    [userId, TEST_USERNAME]
  );

  return userId;
}

async function insertSubmission(db, userId, year, monthIndex, payload) {
  const id = `sub-test-${year}-${monthIndex}-${crypto.randomBytes(4).toString('hex')}`;
  const monthLabel = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO month_submissions
       (id, user_id, username, team_id, year, month_index, month_label,
        sent_at, received_at, size_bytes, totals, payload)
     VALUES ($1,$2,$3,'montage',$4,$5,$6,$7,$8,0,'{}', $9::jsonb)`,
    [
      id,
      userId,
      TEST_USERNAME,
      year,
      monthIndex,
      monthLabel,
      now,
      now,
      JSON.stringify(payload),
    ]
  );
}

async function setKontenCorrection(db, userId, correction) {
  await db.query(`UPDATE konten SET ue_z1_correction = $1 WHERE user_id = $2`, [
    correction,
    userId,
  ]);
}

async function cleanup(db) {
  await db.query(`DELETE FROM users WHERE username = $1`, [TEST_USERNAME]);
}

// ── Test-Payloads ─────────────────────────────────────────────

// März 2025: 21 Werktage, kein Feiertag
// 20 Tage gestempelt 07:30–16:00 = 8.5h, March 31 = Fehltag (kein Eintrag)
function buildMaerzPayload() {
  // Alle Werktage März 2025
  const allDays = getWeekdays(2025, 2); // monthIndex=2 → März
  const stampsByDate = {};
  for (const dk of allDays) {
    if (dk === '2025-03-31') continue; // Fehltag → kein Eintrag
    stampsByDate[dk] = { in: '07:30', out: '16:00' }; // 8.5h exakt
  }
  return buildPayload(stampsByDate);
}

// April 2025: Karfreitag 18.04 + Ostermontag 21.04 = Soll 0 (werden von getDailySoll übersprungen)
// 20 verbleibende Tage gestempelt 07:30–16:30 = 9.0h
function buildAprilPayload() {
  const HOLIDAYS_APRIL_2025 = new Set(['2025-04-18', '2025-04-21']);
  const allDays = getWeekdays(2025, 3); // monthIndex=3 → April
  const stampsByDate = {};
  for (const dk of allDays) {
    if (HOLIDAYS_APRIL_2025.has(dk)) continue; // Feiertag: trotzdem eintragen (Server überspringt sie)
    stampsByDate[dk] = { in: '07:30', out: '16:30' }; // 9.0h exakt
  }
  return buildPayload(stampsByDate);
}

// ── Main ──────────────────────────────────────────────────────
async function run() {
  const [, , adminUser, adminPass] = process.argv;
  if (!adminUser || !adminPass) {
    console.error(
      'Usage: node test-payroll-integration.js <admin-user> <admin-pass>'
    );
    process.exit(1);
  }

  loadEnv();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL fehlt in .env');
    process.exit(1);
  }

  // Server-Erreichbarkeit prüfen
  try {
    const ping = await fetch(`${BASE}/api/health`).catch(() => null);
    if (!ping || !ping.ok) throw new Error();
  } catch {
    console.error(`${R}Server nicht erreichbar auf ${BASE}${X}`);
    console.error(
      'Bitte zuerst "npm run dev" oder "node server.js" ausführen.'
    );
    process.exit(1);
  }

  const db = new Client({ connectionString: dbUrl });
  await db.connect();

  console.log(`\n${BOLD}Payroll Integration Tests${X}`);
  console.log(`DB: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Server: ${BASE}`);

  let userId;

  try {
    // ── Setup ───────────────────────────────────────────────
    section('Setup — Testdaten anlegen');
    userId = await setupTestData(db);
    pass(`Test-User ${TEST_USERNAME} angelegt (id: ${userId})`);

    const maerzPayload = buildMaerzPayload();
    const aprilPayload = buildAprilPayload();

    // Anzahl gestempelter Tage zur Kontrolle
    const maerzStampedDays = Object.keys(maerzPayload.days).length;
    const aprilStampedDays = Object.keys(aprilPayload.days).length;
    check('März: 20 Tage gestempelt', maerzStampedDays, 20, 0);
    check('April: 20 Tage gestempelt', aprilStampedDays, 20, 0);

    await insertSubmission(db, userId, 2025, 2, maerzPayload); // März
    await insertSubmission(db, userId, 2025, 3, aprilPayload); // April
    pass('Submissions März + April in DB');

    const token = await login(adminUser, adminPass); // war: token
    pass('Admin-Login erfolgreich');
    // ── Periode März ─────────────────────────────────────────
    section('Periode März 2025 (01.03–31.03)');
    // Erwartete Werte (manuell berechnet):
    //   20 Tage × 8.5h = 170h Präsenz
    //   20 Tage × +0.5h diff = 10.0h ueZ1Positive, 1 Fehltag × -8h
    //   ueZ1Raw = 10.0 - 8.0 = +2.0h
    //   ytdPositive(Jan–Mär) = 10.0h → vorarbeitFilled = 10.0h
    //   ytdPositiveBefore(Jan–Feb) = 0h (nichts übertragen)
    //   vorarbeitApplied = min(10.0, max(0, 2.0)) = 2.0h  ← Cap!
    //   ueZ1AfterVorarbeit = 2.0 - 2.0 = 0.0h
    {
      const row = await getPayrollRow(token, '2025-03-01', '2025-03-31');
      const { totals, overtime, vorarbeit } = row;

      check('Präsenzstunden = 170.0h', totals.praesenzStunden, 170.0);
      check('ueZ1Raw = +2.0h', overtime.ueZ1Raw, 2.0);
      check('vorarbeit.filled = 10.0h', vorarbeit.filled, 10.0);
      check('vorarbeit.required = 39h', vorarbeit.required, 39.0, 0);
      check(
        'vorarbeitApplied = 10.0h (Threshold)',
        overtime.vorarbeitApplied,
        10.0
      );
      check(
        'ueZ1AfterVorarbeit = -8.0h (Fehltag)',
        overtime.ueZ1AfterVorarbeit,
        -8.0
      );
      check('ueZ1Correction = 0.0h', overtime.ueZ1Correction, 0.0);
      check('ueZ1Total = 2.0h', overtime.ueZ1Total, 2.0);
    }

    // ── Periode April ─────────────────────────────────────────
    section('Periode April 2025 (01.04–30.04) — März schon übertragen');
    // Erwartete Werte:
    //   20 Tage × 9.0h = 180h Präsenz
    //   20 Tage × +1.0h diff = 20.0h ueZ1Raw und ueZ1Positive
    //   ytdPositive(Jan–Apr) = 10.0 + 20.0 = 30.0h → vorarbeitFilled = 30.0h
    //   ytdPositiveBefore(Jan–Mär) = 10.0h → vorarbeitFilledBefore = 10.0h
    //   vorarbeitApplied = min(30.0-10.0, max(0, 20.0)) = min(20.0, 20.0) = 20.0h
    //   ueZ1AfterVorarbeit = 20.0 - 20.0 = 0.0h
    {
      const row = await getPayrollRow(token, '2025-04-01', '2025-04-30');
      const { totals, overtime, vorarbeit } = row;

      check('Präsenzstunden = 180.0h', totals.praesenzStunden, 180.0);
      check('ueZ1Raw = +20.0h', overtime.ueZ1Raw, 20.0);
      check('vorarbeit.filled = 20.0h', vorarbeit.filled, 20.0);
      check('vorarbeitApplied = 10.0h', overtime.vorarbeitApplied, 10.0);
      check('ueZ1AfterVorarbeit = 10.0h', overtime.ueZ1AfterVorarbeit, 10.0);
    }

    // ── Periode März+April ────────────────────────────────────
    section('Periode März+April 2025 (01.03–30.04) — Haupttest Cap');
    // Erwartete Werte:
    //   Präsenz: 170 + 180 = 350h
    //   ueZ1Raw: 2.0 + 20.0 = 22.0h
    //   ytdPositiveUntilEnd: 10.0 + 20.0 = 30.0h → vorarbeitFilled = 30.0h
    //   ytdPositiveBeforePeriod (Jan–Feb): 0h
    //   vorarbeitApplied = min(30.0, max(0, 22.0)) = 22.0h  ← Cap!
    //   Ohne Cap wäre es 30.0h → ueZ1AfterVorarbeit = -8.0h (falscher Bug)
    //   Mit Cap: ueZ1AfterVorarbeit = 22.0 - 22.0 = 0.0h
    {
      const row = await getPayrollRow(token, '2025-03-01', '2025-04-30');
      const { totals, overtime, vorarbeit } = row;

      check('Präsenzstunden = 350.0h', totals.praesenzStunden, 350.0);
      check('ueZ1Raw = +22.0h', overtime.ueZ1Raw, 22.0);
      check('vorarbeit.filled = 30.0h', vorarbeit.filled, 30.0);
      check('vorarbeitApplied = 20.0h', overtime.vorarbeitApplied, 20.0);
      check('ueZ1AfterVorarbeit = 2.0h', overtime.ueZ1AfterVorarbeit, 2.0);
      check(
        'vorarbeitApplied ≤ ueZ1Raw',
        overtime.vorarbeitApplied <= overtime.ueZ1Raw + 0.1 ? 1 : 0,
        1,
        0
      );

      // Korrektur-Felder vorhanden
      check('ueZ1Correction = 0.0h', overtime.ueZ1Correction, 0.0);
      check('ueZ1Total = 22.0h', overtime.ueZ1Total, 22.0);

      // Coverage-Check: beide Monate übertragen
      const missing = row.coverage?.missingMonths || [];
      check('Keine fehlenden Monate', missing.length, 0, 0);
    }

    // ── Korrektur +5h ─────────────────────────────────────────
    section('Korrektur +5h in konten → Payroll zeigt ueZ1Total = 27.0h');
    {
      await setKontenCorrection(db, userId, 5.0);
      pass('ue_z1_correction = +5.0h gesetzt');

      const row = await getPayrollRow(token, '2025-03-01', '2025-04-30');
      const { overtime } = row;

      check('ueZ1Raw unverändert = 22.0h', overtime.ueZ1Raw, 22.0);
      check('ueZ1Correction = +5.0h', overtime.ueZ1Correction, 5.0);
      check('ueZ1Total = 2.0 + 5.0 = 7.0h', overtime.ueZ1Total, 7.0);
    }

    // ── Negative Korrektur ────────────────────────────────────
    section('Negative Korrektur -3h → ueZ1Total = 19.0h');
    {
      await setKontenCorrection(db, userId, -3.0);
      const row = await getPayrollRow(token, '2025-03-01', '2025-04-30');
      const { overtime } = row;

      check('ueZ1Correction = -3.0h', overtime.ueZ1Correction, -3.0);
      check('ueZ1Total = 22.0 - 3.0 = 19.0h', overtime.ueZ1Total, 19.0);
    }

    // ── Invarianten ───────────────────────────────────────────
    section('Invarianten (gelten für alle Perioden)');
    {
      for (const [from, to, label] of [
        ['2025-03-01', '2025-03-31', 'März'],
        ['2025-04-01', '2025-04-30', 'April'],
        ['2025-03-01', '2025-04-30', 'März+April'],
      ]) {
        await setKontenCorrection(db, userId, 0); // zurücksetzen
        const row = await getPayrollRow(token, from, to);
        const { overtime } = row;

        check(
          `${label}: vorarbeitApplied + ueZ1AfterVorarbeit = ueZ1Raw`,
          Math.round(
            (overtime.vorarbeitApplied + overtime.ueZ1AfterVorarbeit) * 10
          ) / 10,
          overtime.ueZ1Raw,
          0.2
        );
        check(
          `${label}: vorarbeitApplied ≥ 0`,
          overtime.vorarbeitApplied >= 0 ? 1 : 0,
          1,
          0
        );
        check(
          `${label}: ueZ1Total = ueZ1Raw + ueZ1Correction`,
          overtime.ueZ1Total,
          Math.round((overtime.ueZ1Raw + overtime.ueZ1Correction) * 10) / 10,
          0.2
        );
      }
    }
  } finally {
    // ── Cleanup ────────────────────────────────────────────────
    section('Cleanup');
    await cleanup(db);
    pass('Test-User + alle Daten gelöscht (CASCADE)');
    await db.end();
  }

  // ── Resultat ──────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${BOLD}Resultat: ${total} Tests${X}`);
  console.log(`  ${G}${passed} bestanden${X}`);
  if (failed > 0) {
    console.log(`  ${R}${failed} fehlgeschlagen${X}`);
    console.log(`\n${R}${BOLD}Tests fehlgeschlagen ✗${X}\n`);
    process.exit(1);
  } else {
    console.log(`\n${G}${BOLD}Alle Tests bestanden ✓${X}\n`);
  }
}

run().catch((err) => {
  console.error(`\n${R}Unerwarteter Fehler:${X}`, err.message);
  process.exit(1);
});
