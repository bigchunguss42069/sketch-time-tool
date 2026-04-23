/**
 * sketch-time-tool — Payroll Integration Tests
 *
 * Testet buildPayrollPeriodDataForUser gegen echte DB:
 * - Vorarbeit-Cap (Fix 2)
 * - Korrekturen aus konten (Fix 3)
 * - ueZ1AfterVorarbeit kann nie schlechter als ueZ1Raw sein
 *
 * Voraussetzung: Server läuft auf localhost:3000, .env ist geladen
 * Ausführen: node test-payroll.js <admin-user> <admin-pass>
 */

const BASE = 'http://localhost:3000';
const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[34m';
const X = '\x1b[0m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;
const TEST_USERNAME = '__payroll_test_user__';

function pass(name) {
  console.log(`  ${G}✓${X} ${name}`);
  passed++;
}
function fail(name, got, expected) {
  console.log(`  ${R}✗${X} ${name}`);
  console.log(`    ${R}Erwartet: ${JSON.stringify(expected)}${X}`);
  console.log(`    ${R}Erhalten: ${JSON.stringify(got)}${X}`);
  failed++;
}
function section(name) {
  console.log(`\n${BOLD}${B}▸ ${name}${X}`);
}
function check(name, got, expected, tol = 0.05) {
  if (Math.abs(got - expected) <= tol) pass(name);
  else fail(name, got, expected);
}

async function api(path, opts = {}, cookie = '') {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  return {
    status: res.status,
    body: await res.json(),
    cookie: res.headers.get('set-cookie') || '',
  };
}

async function login(username, password) {
  const r = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!r.body.ok) throw new Error(`Login fehlgeschlagen: ${r.body.error}`);
  return r.cookie;
}

// Baut ein minimales Submission-Payload für einen ganzen Monat
// stamps: Array von { time, type } Paaren pro Tag
// Beispiel: [{ in: '08:00', out: '17:00' }] → 9h Stempel
function buildSubmissionPayload(year, monthIndex, dailyStamps) {
  const days = {};
  const d = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  let i = 0;
  while (d <= end) {
    const weekday = d.getDay();
    const dk = d.toISOString().slice(0, 10);
    if (weekday !== 0 && weekday !== 6 && dailyStamps[i]) {
      const entry = dailyStamps[i];
      days[dk] = {
        stamps: [
          { time: entry.in, type: 'in' },
          { time: entry.out, type: 'out' },
        ],
        flags: {},
        mealAllowance: {},
      };
      i++;
    }
    d.setDate(d.getDate() + 1);
  }
  return { days, pikett: [], absences: [] };
}

async function run() {
  const [, , adminUser, adminPass] = process.argv;
  if (!adminUser || !adminPass) {
    console.error('Usage: node test-payroll.js <admin-user> <admin-pass>');
    process.exit(1);
  }

  console.log(`\n${BOLD}Payroll Integration Tests${X}`);
  console.log(`Server: ${BASE}`);

  const cookie = await login(adminUser, adminPass);

  // ── Setup: Test-User anlegen ────────────────────────────────
  section('Setup — Test-User anlegen');
  {
    // Falls noch vorhanden, zuerst löschen
    await api(
      `/api/admin/users/${TEST_USERNAME}`,
      { method: 'DELETE' },
      cookie
    );

    const r = await api(
      '/api/admin/users',
      {
        method: 'POST',
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: 'Test1234!',
          teamId: 'montage',
          employmentPct: 100,
          employmentStart: '2024-01-01',
          birthYear: 1985,
          isNonSmoker: false,
          isKader: false,
        }),
      },
      cookie
    );

    if (r.body.ok) pass('Test-User angelegt');
    else fail('Test-User anlegen', r.body, { ok: true });
  }

  // ── Szenario A: Normaler Monat, 9h/Tag → +5h ÜZ1 (5 Tage × 1h) ────
  section('Szenario A — 5× 9h/Tag → ueZ1Raw = +5h (5 Tage) oder mehr');
  {
    // März 2025 hat 21 Werktage → 21 × 1h Überschuss = +21h ÜZ1
    const stempel = Array(21).fill({ in: '07:00', out: '16:30' }); // 9.5h → +1.5h/Tag
    const payload = buildSubmissionPayload(2025, 2, stempel); // März = monthIndex 2

    // Direkt per DB einfügen via Admin-Transmit-Endpoint
    const r = await api(
      `/api/admin/submit-month`,
      {
        method: 'POST',
        body: JSON.stringify({
          username: TEST_USERNAME,
          year: 2025,
          monthIndex: 2,
          payload,
        }),
      },
      cookie
    );

    if (r.body.ok) pass('Monat übertragen');
    else {
      fail('Monat übertragen', r.body, { ok: true });
    }

    // Payroll abfragen
    const pr = await api(
      `/api/admin/payroll-period?from=2025-03-01&to=2025-03-31&username=${TEST_USERNAME}`,
      {},
      cookie
    );
    const row = Array.isArray(pr.body.rows)
      ? pr.body.rows.find((r) => r.username === TEST_USERNAME)
      : null;

    if (!row) {
      fail('Payroll-Row gefunden', null, 'row');
    } else {
      const ueZ1 = row.overtime.ueZ1Raw;
      // 21 Werktage × 1.5h Überschuss = 31.5h ÜZ1 (nach Vorarbeit-Abzug)
      check('ueZ1Raw > 0', ueZ1, 31.5, 5); // Toleranz ±5h wegen Feiertage
      check(
        'ueZ1AfterVorarbeit ≤ ueZ1Raw (nie schlechter nach Vorarbeit)',
        row.overtime.ueZ1AfterVorarbeit <= row.overtime.ueZ1Raw + 0.1 ? 1 : 0,
        1,
        0
      );
      pass(`Präsenzstunden: ${row.totals.praesenzStunden}h`);
    }
  }

  // ── Szenario B: Vorarbeit-Cap — vorarbeitApplied darf ueZ1Raw nicht übersteigen ──
  section('Szenario B — Vorarbeit-Cap: vorarbeitApplied ≤ ueZ1Raw');
  {
    // Nur 1 Tag stempeln = kleines ueZ1Raw, aber YTD-Positive könnte gross sein
    const stempel = [{ in: '08:00', out: '09:30' }]; // 1.5h → 1h Überschuss auf 8h Soll
    const payload = buildSubmissionPayload(2025, 3, stempel); // April

    const r = await api(
      `/api/admin/submit-month`,
      {
        method: 'POST',
        body: JSON.stringify({
          username: TEST_USERNAME,
          year: 2025,
          monthIndex: 3,
          payload,
        }),
      },
      cookie
    );

    const pr = await api(
      `/api/admin/payroll-period?from=2025-04-01&to=2025-04-30&username=${TEST_USERNAME}`,
      {},
      cookie
    );
    const row = Array.isArray(pr.body.rows)
      ? pr.body.rows.find((r) => r.username === TEST_USERNAME)
      : null;

    if (!row) {
      fail('Payroll-Row gefunden', null, 'row');
    } else {
      const { ueZ1Raw, vorarbeitApplied, ueZ1AfterVorarbeit } = row.overtime;
      check(
        'vorarbeitApplied ≤ ueZ1Raw (Cap greift)',
        vorarbeitApplied <= ueZ1Raw + 0.1 ? 1 : 0,
        1,
        0
      );
      check(
        'ueZ1AfterVorarbeit = ueZ1Raw - vorarbeitApplied',
        ueZ1AfterVorarbeit,
        ueZ1Raw - vorarbeitApplied,
        0.2
      );
      check(
        'ueZ1AfterVorarbeit ≥ 0 oder ueZ1Raw negativ',
        ueZ1AfterVorarbeit >= -0.1 || ueZ1Raw < 0 ? 1 : 0,
        1,
        0
      );
    }
  }

  // ── Szenario C: Korrektur aus konten sichtbar ───────────────
  section('Szenario C — Admin-Korrektur +5h wird in Payroll angezeigt');
  {
    // Korrektur setzen
    const cr = await api(
      '/api/admin/konten',
      {
        method: 'POST',
        body: JSON.stringify({
          username: TEST_USERNAME,
          values: { ueZ1Correction: 5 },
          reason: 'Payroll Test',
        }),
      },
      cookie
    );

    if (cr.body.ok) pass('Korrektur gesetzt (+5h ÜZ1)');
    else fail('Korrektur setzen', cr.body, { ok: true });

    const pr = await api(
      `/api/admin/payroll-period?from=2025-03-01&to=2025-03-31&username=${TEST_USERNAME}`,
      {},
      cookie
    );
    const row = Array.isArray(pr.body.rows)
      ? pr.body.rows.find((r) => r.username === TEST_USERNAME)
      : null;

    if (!row) {
      fail('Payroll-Row gefunden', null, 'row');
    } else {
      check('ueZ1Correction = +5h', row.overtime.ueZ1Correction, 5, 0.1);
      check(
        'ueZ1Total = ueZ1Raw + 5h',
        row.overtime.ueZ1Total,
        row.overtime.ueZ1Raw + 5,
        0.2
      );
      pass(
        `ueZ1Raw=${row.overtime.ueZ1Raw}  ueZ1Correction=+5  ueZ1Total=${row.overtime.ueZ1Total}`
      );
    }
  }

  // ── Szenario D: Negative Korrektur ─────────────────────────
  section('Szenario D — Negative Korrektur -3h wird korrekt subtrahiert');
  {
    await api(
      '/api/admin/konten',
      {
        method: 'POST',
        body: JSON.stringify({
          username: TEST_USERNAME,
          values: { ueZ1Correction: -8 }, // Delta: 5 + (-8) = -3 total
          reason: 'Payroll Test negativ',
        }),
      },
      cookie
    );

    const pr = await api(
      `/api/admin/payroll-period?from=2025-03-01&to=2025-03-31&username=${TEST_USERNAME}`,
      {},
      cookie
    );
    const row = Array.isArray(pr.body.rows)
      ? pr.body.rows.find((r) => r.username === TEST_USERNAME)
      : null;

    if (!row) {
      fail('Payroll-Row gefunden', null, 'row');
    } else {
      check('ueZ1Correction = -3h (5-8)', row.overtime.ueZ1Correction, -3, 0.1);
      check(
        'ueZ1Total = ueZ1Raw - 3h',
        row.overtime.ueZ1Total,
        row.overtime.ueZ1Raw - 3,
        0.2
      );
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────
  section('Cleanup');
  {
    const r = await api(
      `/api/admin/users/${TEST_USERNAME}`,
      { method: 'DELETE' },
      cookie
    );
    if (r.body.ok) pass('Test-User gelöscht (CASCADE)');
    else fail('Test-User löschen', r.body, { ok: true });
  }

  // ── Resultat ─────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${BOLD}Resultat: ${total} Tests${X}`);
  console.log(`  ${G}${passed} bestanden${X}`);
  if (failed > 0) console.log(`  ${R}${failed} fehlgeschlagen${X}`);
  console.log('');
  if (failed === 0) {
    console.log(`${G}${BOLD}Alle Tests bestanden ✓${X}\n`);
  } else {
    console.log(`${R}${BOLD}${failed} Test(s) fehlgeschlagen ✗${X}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(`${R}Fehler:${X}`, err.message);
  process.exit(1);
});
