/**
 * sketch-time-tool — API Test Script v2
 *
 * Verwendung (aus backend Ordner):
 *   cd backend && node test-api.js
 */

require('dotenv').config();

const BASE = 'http://localhost:3000';

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m';
const B = '\x1b[34m'; const X = '\x1b[0m';  const BOLD = '\x1b[1m';

let passed = 0; let failed = 0; let skipped = 0;

function pass(name) { console.log(`  ${G}✓${X} ${name}`); passed++; }
function fail(name, reason) {
  console.log(`  ${R}✗${X} ${name}`);
  console.log(`    ${R}→ ${reason}${X}`);
  failed++;
}
function skip(name, reason) {
  console.log(`  ${Y}○${X} ${name} ${Y}(${reason})${X}`);
  skipped++;
}
function section(name) { console.log(`\n${BOLD}${B}▸ ${name}${X}`); }

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}

async function get(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}

async function del(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR  = new Date().getFullYear();
const MONTH = new Date().getMonth();

function getPastWorkday(daysBack = 7) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function makeTestPayload(absences = []) {
  const days = {};
  days[TODAY] = {
    flags: { ferien: false, schmutzzulage: false, nebenauslagen: false },
    stamps: [
      { type: 'in', time: '07:00' }, { type: 'out', time: '11:30' },
      { type: 'in', time: '12:00' }, { type: 'out', time: '16:30' }
    ],
    entries: [{ komNr: '999999', hours: { option1: 4, option2: 0, option3: 0, option4: 0, option5: 0, option6: 0 } }],
    dayHours: { schulung: 0, sitzungKurs: 0, arztKrank: 0 },
    mealAllowance: { '1': false, '2': true, '3': false },
    specialEntries: [], stampEditLog: []
  };
  return {
    year: YEAR, monthIndex: MONTH, monthLabel: `Test ${YEAR}`,
    days, pikett: [], absences, stampEditLog: []
  };
}

async function runTests() {
  console.log(`\n${BOLD}sketch-time-tool — API Tests v2${X}`);
  console.log(`${B}Ziel: ${BASE}  Datum: ${TODAY}${X}`);

  let demoToken = null;
  let adminToken = null;
  const demoPassword = process.env.SEED_PASSWORD_DEMO;
  const adminPassword = process.env.SEED_PASSWORD_CHEF;

  // ── 1. Auth ──────────────────────────────────────────────
  section('Authentication');

  if (!demoPassword) {
    skip('Login demo', 'SEED_PASSWORD_DEMO nicht gesetzt');
  } else {
    const r = await post('/api/auth/login', { username: 'demo', password: demoPassword });
    if (r.status === 200 && r.body?.ok && r.body?.token) {
      demoToken = r.body.token; pass('Login demo');
    } else {
      fail('Login demo', `Status ${r.status}: ${JSON.stringify(r.body)}`);
    }
  }

  if (!adminPassword) {
    skip('Login chef (admin)', 'SEED_PASSWORD_CHEF nicht gesetzt');
  } else {
    const r = await post('/api/auth/login', { username: 'chef', password: adminPassword });
    if (r.status === 200 && r.body?.ok && r.body?.token) {
      adminToken = r.body.token; pass('Login chef (admin)');
    } else {
      fail('Login chef (admin)', `Status ${r.status}: ${JSON.stringify(r.body)}`);
    }
  }

  const rBad = await post('/api/auth/login', { username: 'demo', password: 'falsch123' });
  if (rBad.status === 401 || !rBad.body?.ok) pass('Falsches Passwort → abgelehnt');
  else fail('Falsches Passwort → abgelehnt', `Status ${rBad.status}`);

  const rNoAuth = await get('/api/week-locks/me');
  if (rNoAuth.status === 401) pass('Kein Token → 401');
  else fail('Kein Token → 401', `Status ${rNoAuth.status}`);


  // ── 2. Draft Sync ────────────────────────────────────────
  section('Draft Sync');

  if (!demoToken) {
    skip('Draft speichern', 'kein Token');
    skip('Draft laden', 'kein Token');
  } else {
    const testDraft = {
      dayStore: { [TODAY]: { flags: {}, stamps: [], entries: [], dayHours: {}, mealAllowance: {}, specialEntries: [] } },
      pikettStore: [], year: YEAR, month: MONTH, savedAt: new Date().toISOString()
    };
    const rSync = await post('/api/draft/sync', { data: testDraft }, demoToken);
    if (rSync.status === 200 && rSync.body?.ok) pass('Draft speichern');
    else fail('Draft speichern', `${rSync.status}: ${JSON.stringify(rSync.body)}`);

    const rLoad = await get('/api/draft/load', demoToken);
    if (rLoad.status === 200 && rLoad.body?.ok && rLoad.body?.draft) pass('Draft laden');
    else fail('Draft laden', `${rLoad.status}`);
  }


  // ── 3. Absenzen ──────────────────────────────────────────
  section('Absenzen — Ferien (mit Genehmigung)');

  let ferienAbsenceId = null;

  if (!demoToken) {
    skip('Ferien-Antrag erstellen', 'kein Token');
  } else {
    const from = getPastWorkday(14);
    const to   = getPastWorkday(10);
    const r = await post('/api/absences', {
      id: `test-ferien-${Date.now()}`,
      type: 'ferien', from, to, days: 3, comment: 'Test Ferien'
    }, demoToken);

    if (r.status === 200 && r.body?.ok && r.body?.absence) {
      ferienAbsenceId = r.body.absence.id;
      pass(`Ferien-Antrag erstellt (${from} → ${to})`);
      if (r.body.absence.status === 'pending') pass('Ferien-Status = pending ✓');
      else fail('Ferien-Status = pending', `Status: ${r.body.absence.status}`);
    } else {
      fail('Ferien-Antrag erstellen', `${r.status}: ${JSON.stringify(r.body)}`);
    }
  }

  if (adminToken && ferienAbsenceId) {
    const rDecide = await post('/api/admin/absences/decision', {
      id: ferienAbsenceId, username: 'demo', status: 'accepted'
    }, adminToken);
    if (rDecide.status === 200 && rDecide.body?.ok) pass('Admin genehmigt Ferien');
    else fail('Admin genehmigt Ferien', `${rDecide.status}: ${JSON.stringify(rDecide.body)}`);

    const rList = await get('/api/absences', demoToken);
    if (rList.body?.ok) {
      const ferien = rList.body.absences?.find(a => a.id === ferienAbsenceId);
      if (ferien?.status === 'accepted') pass('Ferien-Status = accepted ✓');
      else fail('Ferien-Status = accepted', `Status: ${ferien?.status}`);
    }

    // Aufräumen
    await post('/api/admin/absences/decision', {
      id: ferienAbsenceId, username: 'demo', status: 'rejected'
    }, adminToken).catch(() => {});
  }


  section('Absenzen — Krank (auto-accept)');

  if (!demoToken) {
    skip('Krank-Tests', 'kein Token');
  } else {
    // Ganzer Tag krank
    const kranktag = getPastWorkday(5);
    const rKrank = await post('/api/absences', {
      id: `test-krank-${Date.now()}`,
      type: 'krank', from: kranktag, to: kranktag,
      days: 1, hours: null, comment: 'Test Krank'
    }, demoToken);

    if (rKrank.status === 200 && rKrank.body?.ok) {
      const abs = rKrank.body.absence;
      pass('Krank-Eintrag erstellt (ganzer Tag)');
      if (abs.status === 'accepted') pass('Krank auto-accept = accepted ✓');
      else fail('Krank auto-accept', `Status: ${abs.status}`);
      // Aufräumen
      await del(`/api/absences/${abs.id}`, demoToken).catch(() => {});
    } else {
      fail('Krank-Eintrag erstellen', `${rKrank.status}: ${JSON.stringify(rKrank.body)}`);
    }

    // Halber Tag krank (4h)
    const halbtag = getPastWorkday(3);
    const rHalb = await post('/api/absences', {
      id: `test-krank-halb-${Date.now()}`,
      type: 'krank', from: halbtag, to: halbtag,
      days: 0.5, hours: 4, comment: 'Test Krank halber Tag'
    }, demoToken);

    if (rHalb.status === 200 && rHalb.body?.ok) {
      const abs = rHalb.body.absence;
      pass('Krank halber Tag (4h) erstellt');
      if (abs.hours === 4) pass('Krank hours = 4h korrekt gespeichert ✓');
      else fail('Krank hours = 4h', `hours: ${abs.hours}`);
      if (abs.status === 'accepted') pass('Krank halber Tag auto-accept ✓');
      else fail('Krank halber Tag auto-accept', `Status: ${abs.status}`);
      // Aufräumen
      await del(`/api/absences/${abs.id}`, demoToken).catch(() => {});
    } else {
      fail('Krank halber Tag erstellen', `${rHalb.status}: ${JSON.stringify(rHalb.body)}`);
    }
  }


  section('Absenzen — Sonstige & Berechtigungen');

  if (demoToken) {
    const unfallTag = getPastWorkday(20);
    const rUnfall = await post('/api/absences', {
      id: `test-unfall-${Date.now()}`,
      type: 'unfall', from: unfallTag, to: unfallTag, days: 1
    }, demoToken);

    if (rUnfall.status === 200 && rUnfall.body?.ok) {
      pass('Unfall-Antrag erstellt');
      const abs = rUnfall.body.absence;
      if (abs.status === 'pending') pass('Unfall-Status = pending (braucht Admin) ✓');
      else fail('Unfall-Status = pending', `Status: ${abs.status}`);
      if (abs.status === 'pending') {
        await del(`/api/absences/${abs.id}`, demoToken).catch(() => {});
      }
    } else {
      fail('Unfall-Antrag erstellen', `${rUnfall.status}`);
    }

    // User darf keine Admin-Absenzliste sehen
    const rForbidden = await get('/api/admin/absences', demoToken);
    if (rForbidden.status === 403 || rForbidden.status === 401)
      pass('User sieht keine Admin-Absenzliste → abgelehnt ✓');
    else fail('User sieht keine Admin-Absenzliste', `Status: ${rForbidden.status}`);
  }

  if (adminToken) {
    const rAdminAbs = await get('/api/admin/absences', adminToken);
    if (rAdminAbs.status === 200 && rAdminAbs.body?.ok)
      pass(`Admin lädt alle Absenzen (${rAdminAbs.body.absences?.length || 0} gefunden)`);
    else fail('Admin lädt alle Absenzen', `${rAdminAbs.status}`);
  }


  // ── 4. Live Stamps ────────────────────────────────────────
  section('Live Stamps');

  if (demoToken) {
    const rLive = await post('/api/stamps/live', {
      todayKey: TODAY, stamps: [{ type: 'in', time: '07:00' }]
    }, demoToken);
    if (rLive.status === 200 && rLive.body?.ok) pass('Live Stamp senden');
    else fail('Live Stamp senden', `${rLive.status}`);
  }

  if (adminToken) {
    const rStatus = await get('/api/admin/live-status', adminToken);
    if (rStatus.status === 200 && rStatus.body?.ok && Array.isArray(rStatus.body?.users)) {
      const hasDemo = rStatus.body.users.some(u => u.username === 'demo');
      if (hasDemo) pass('Live Status enthält demo-User');
      else fail('Live Status enthält demo-User', 'nicht gefunden');
    } else fail('Live Status laden', `${rStatus.status}`);
  }

  if (demoToken) {
    const rForbidden = await get('/api/admin/live-status', demoToken);
    if (rForbidden.status === 403 || rForbidden.status === 401)
      pass('User sieht Live Status nicht → abgelehnt ✓');
    else fail('User sieht Live Status nicht', `Status: ${rForbidden.status}`);
  }


  // ── 5. Monatsübertragung ──────────────────────────────────
  section('Monatsübertragung');

  if (!demoToken) {
    skip('Monat übertragen', 'kein Token');
  } else {
    const payload = makeTestPayload();
    const rTransmit = await post('/api/transmit-month', payload, demoToken);
    if (rTransmit.status === 200 && rTransmit.body?.ok) {
      pass('Monat übertragen');
      if (adminToken) {
        const rOverview = await get(
          `/api/admin/month-overview?year=${YEAR}&monthIndex=${MONTH}`, adminToken
        );
        if (rOverview.status === 200 && rOverview.body?.ok) {
          const demoUser = rOverview.body.users?.find(u => u.username === 'demo');
          if (demoUser?.month?.transmitted) pass('Übertragung in Admin sichtbar ✓');
          else fail('Übertragung in Admin sichtbar', 'nicht als übertragen markiert');
        } else fail('Admin-Übersicht laden', `${rOverview.status}`);
      }
    } else {
      fail('Monat übertragen', `${rTransmit.status}: ${JSON.stringify(rTransmit.body)}`);
    }
  }


  // ── 6. Arbeitszeitmodell ──────────────────────────────────
  section('Arbeitszeitmodell');

  if (!adminToken) {
    skip('Work Schedule Tests', 'kein Admin-Token');
  } else {
    const rGet = await get('/api/admin/work-schedule/u1', adminToken);
    if (rGet.status === 200 && rGet.body?.ok) pass('Work Schedule laden');
    else fail('Work Schedule laden', `${rGet.status}`);

    const rPost = await post('/api/admin/work-schedule', {
      userId: 'u1', employmentPct: 80,
      workDays: { mon: 6.4, tue: 6.4, wed: 6.4, thu: 6.4, fri: 6.4 },
      validFrom: TODAY
    }, adminToken);

    if (rPost.status === 200 && rPost.body?.ok) {
      pass('Work Schedule 80% erstellen');
      const rAfter = await get('/api/admin/work-schedule/u1', adminToken);
      const entry = rAfter.body?.schedules?.find(s => s.employment_pct === 80);
      if (entry) {
        pass('Work Schedule 80% in Liste ✓');
        const rDel = await del(`/api/admin/work-schedule/${entry.id}`, adminToken);
        if (rDel.status === 200 && rDel.body?.ok) pass('Work Schedule löschen ✓');
        else fail('Work Schedule löschen', `${rDel.status}`);
      } else fail('Work Schedule 80% in Liste', 'nicht gefunden');
    } else fail('Work Schedule erstellen', `${rPost.status}`);
  }


  // ── 7. Stamp Edit Log ─────────────────────────────────────
  section('Stamp Edit Log');

  if (adminToken) {
    const rEdits = await get(
      `/api/admin/stamp-edits?year=${YEAR}&monthIndex=${MONTH}`, adminToken
    );
    if (rEdits.status === 200 && rEdits.body?.ok && Array.isArray(rEdits.body?.users))
      pass('Stamp Edits laden');
    else fail('Stamp Edits laden', `${rEdits.status}`);
  }


  // ── 8. Admin Übersicht ────────────────────────────────────
  section('Admin Übersicht');

  if (adminToken) {
    const rSummary = await get(
      `/api/admin/month-overview?year=${YEAR}&monthIndex=${MONTH}`, adminToken
    );
    if (rSummary.status === 200 && rSummary.body?.ok)
      pass(`Admin Summary — ${rSummary.body.users?.length || 0} User`);
    else fail('Admin Summary', `${rSummary.status}`);

    const rUsers = await get('/api/admin/users', adminToken);
    if (rUsers.status === 200 && rUsers.body?.ok)
      pass(`Admin Users — ${rUsers.body.users?.length || 0} gefunden`);
    else fail('Admin Users', `${rUsers.status}`);
  }


  // ── Ergebnis ──────────────────────────────────────────────
  const total = passed + failed + skipped;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${BOLD}Resultat: ${total} Tests${X}`);
  console.log(`  ${G}${passed} bestanden${X}`);
  if (failed > 0)  console.log(`  ${R}${failed} fehlgeschlagen${X}`);
  if (skipped > 0) console.log(`  ${Y}${skipped} übersprungen${X}`);
  console.log('');

  if (failed === 0) {
    console.log(`${G}${BOLD}Alle Tests bestanden ✓${X}\n`);
  } else {
    console.log(`${R}${BOLD}${failed} Test(s) fehlgeschlagen ✗${X}\n`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(`\n${R}Fehler:${X}`, err);
  process.exit(1);
});