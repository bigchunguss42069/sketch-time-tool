/**
 * sketch-time-tool — API Test Script
 * 
 * Verwendung:
 *   node test-api.js
 * 
 * Voraussetzungen:
 *   - Backend läuft auf localhost:3000
 *   - .env Variablen gesetzt (SEED_PASSWORD_DEMO, SEED_PASSWORD_CHEF)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const BASE = 'http://localhost:3000';

// ── Farben für Terminal-Output ──
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE   = '\x1b[34m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(name) {
  console.log(`  ${GREEN}✓${RESET} ${name}`);
  passed++;
}

function fail(name, reason) {
  console.log(`  ${RED}✗${RESET} ${name}`);
  console.log(`    ${RED}→ ${reason}${RESET}`);
  failed++;
}

function skip(name, reason) {
  console.log(`  ${YELLOW}○${RESET} ${name} ${YELLOW}(übersprungen: ${reason})${RESET}`);
  skipped++;
}

function section(name) {
  console.log(`\n${BOLD}${BLUE}▸ ${name}${RESET}`);
}

// ── HTTP Helpers ──
async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
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

// ── Test-Daten ──
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR  = new Date().getFullYear();
const MONTH = new Date().getMonth();

function makeTestPayload() {
  const days = {};
  days[TODAY] = {
    flags: { ferien: false, schmutzzulage: false, nebenauslagen: false },
    stamps: [
      { type: 'in',  time: '07:00' },
      { type: 'out', time: '11:30' },
      { type: 'in',  time: '12:00' },
      { type: 'out', time: '16:00' }
    ],
    entries: [{ komNr: '999999', hours: { option1: 4, option2: 0, option3: 0, option4: 0, option5: 0, option6: 0 } }],
    dayHours: { schulung: 0, sitzungKurs: 0, arztKrank: 0 },
    mealAllowance: { '1': false, '2': true, '3': false },
    specialEntries: [],
    stampEditLog: []
  };

  return {
    year: YEAR,
    monthIndex: MONTH,
    monthLabel: `Test ${YEAR}`,
    days,
    pikett: [],
    absences: [],
    stampEditLog: []
  };
}

// ════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════

async function runTests() {
  console.log(`\n${BOLD}sketch-time-tool — API Tests${RESET}`);
  console.log(`${BLUE}Ziel: ${BASE}${RESET}`);
  console.log(`${BLUE}Datum: ${TODAY}${RESET}`);

  let demoToken = null;
  let adminToken = null;
  const demoPassword = process.env.SEED_PASSWORD_DEMO;
  const adminPassword = process.env.SEED_PASSWORD_CHEF;

  // ── 1. Auth ──────────────────────────────────
  section('Authentication');

  // Login demo user
  if (!demoPassword) {
    skip('Login demo', 'SEED_PASSWORD_DEMO nicht gesetzt');
  } else {
    const r = await post('/api/auth/login', { username: 'demo', password: demoPassword });
    if (r.status === 200 && r.body?.ok && r.body?.token) {
      demoToken = r.body.token;
      pass('Login demo');
    } else {
      fail('Login demo', `Status ${r.status}: ${JSON.stringify(r.body)}`);
    }
  }

  // Login admin
  if (!adminPassword) {
    skip('Login chef (admin)', 'SEED_PASSWORD_CHEF nicht gesetzt');
  } else {
    const r = await post('/api/auth/login', { username: 'chef', password: adminPassword });
    if (r.status === 200 && r.body?.ok && r.body?.token) {
      adminToken = r.body.token;
      pass('Login chef (admin)');
    } else {
      fail('Login chef (admin)', `Status ${r.status}: ${JSON.stringify(r.body)}`);
    }
  }

  // Falsches Passwort
  const rBad = await post('/api/auth/login', { username: 'demo', password: 'falsch123' });
  if (rBad.status === 401 || (rBad.body && !rBad.body.ok)) {
    pass('Login mit falschem Passwort → abgelehnt');
  } else {
    fail('Login mit falschem Passwort → abgelehnt', `Unerwartet: Status ${rBad.status}`);
  }

  // Kein Token → 401
  const rNoToken = await get('/api/week-locks/me');
  if (rNoToken.status === 401) {
    pass('Kein Token → 401');
  } else {
    fail('Kein Token → 401', `Status ${rNoToken.status}`);
  }


  // ── 2. Draft Sync ────────────────────────────
  section('Draft Sync');

  if (!demoToken) {
    skip('Draft speichern', 'kein Token');
    skip('Draft laden', 'kein Token');
  } else {
    const testDraft = {
      dayStore: { [TODAY]: { flags: {}, stamps: [], entries: [], dayHours: {}, mealAllowance: {}, specialEntries: [] } },
      pikettStore: [],
      year: YEAR,
      month: MONTH,
      savedAt: new Date().toISOString()
    };

    const rSync = await post('/api/draft/sync', { data: testDraft }, demoToken);
    if (rSync.status === 200 && rSync.body?.ok) {
      pass('Draft speichern');
    } else {
      fail('Draft speichern', `Status ${rSync.status}: ${JSON.stringify(rSync.body)}`);
    }

    const rLoad = await get('/api/draft/load', demoToken);
    if (rLoad.status === 200 && rLoad.body?.ok && rLoad.body?.draft) {
      pass('Draft laden');
    } else {
      fail('Draft laden', `Status ${rLoad.status}: ${JSON.stringify(rLoad.body)}`);
    }
  }


  // ── 3. Live Stamps ───────────────────────────
  section('Live Stamps');

  if (!demoToken) {
    skip('Live Stamp senden', 'kein Token');
  } else {
    const rLive = await post('/api/stamps/live', {
      todayKey: TODAY,
      stamps: [{ type: 'in', time: '07:00' }]
    }, demoToken);
    if (rLive.status === 200 && rLive.body?.ok) {
      pass('Live Stamp senden');
    } else {
      fail('Live Stamp senden', `Status ${rLive.status}: ${JSON.stringify(rLive.body)}`);
    }
  }

  if (!adminToken) {
    skip('Live Status laden (Admin)', 'kein Admin-Token');
  } else {
    const rStatus = await get('/api/admin/live-status', adminToken);
    if (rStatus.status === 200 && rStatus.body?.ok && Array.isArray(rStatus.body?.users)) {
      const hasDemo = rStatus.body.users.some(u => u.username === 'demo');
      if (hasDemo) {
        pass('Live Status enthält demo-User');
      } else {
        fail('Live Status enthält demo-User', 'demo nicht in Liste');
      }
    } else {
      fail('Live Status laden (Admin)', `Status ${rStatus.status}`);
    }
  }

  // User darf Live Status NICHT sehen
  if (demoToken) {
    const rForbidden = await get('/api/admin/live-status', demoToken);
    if (rForbidden.status === 403 || rForbidden.status === 401) {
      pass('User kann Live Status nicht sehen → abgelehnt');
    } else {
      fail('User kann Live Status nicht sehen → abgelehnt', `Status ${rForbidden.status}`);
    }
  }


  // ── 4. Week Locks ────────────────────────────
  section('Week Locks');

  if (!demoToken) {
    skip('Eigene Week Locks laden', 'kein Token');
  } else {
    const rLocks = await get('/api/week-locks/me', demoToken);
    if (rLocks.status === 200 && rLocks.body?.ok) {
      pass('Eigene Week Locks laden');
    } else {
      fail('Eigene Week Locks laden', `Status ${rLocks.status}`);
    }
  }


  // ── 5. Übertragung ───────────────────────────
  section('Monatsübertragung');

  if (!demoToken) {
    skip('Monat übertragen', 'kein Token');
    skip('Übertragung in Admin sichtbar', 'kein Token');
  } else {
    const payload = makeTestPayload();
    const rTransmit = await post('/api/transmit-month', payload, demoToken);
    if (rTransmit.status === 200 && rTransmit.body?.ok) {
      pass('Monat übertragen');

      // Prüfen ob in Admin sichtbar
      if (adminToken) {
        const rOverview = await get(
          `/api/admin/month-overview?year=${YEAR}&monthIndex=${MONTH}`,
          adminToken
        );
        if (rOverview.status === 200 && rOverview.body?.ok) {
          const demoUser = rOverview.body.users?.find(u => u.username === 'demo');
          if (demoUser?.month?.transmitted) {
            pass('Übertragung in Admin-Übersicht sichtbar');
          } else {
            fail('Übertragung in Admin-Übersicht sichtbar', 'demo nicht als übertragen markiert');
          }
        } else {
          fail('Admin-Übersicht laden', `Status ${rOverview.status}`);
        }
      }
    } else {
      fail('Monat übertragen', `Status ${rTransmit.status}: ${JSON.stringify(rTransmit.body)}`);
    }
  }


  // ── 6. Admin — Arbeitszeitmodell ─────────────
  section('Arbeitszeitmodell');

  if (!adminToken) {
    skip('Work Schedule laden', 'kein Admin-Token');
    skip('Work Schedule erstellen', 'kein Admin-Token');
  } else {
    // Laden für demo (u1)
    const rGet = await get('/api/admin/work-schedule/u1', adminToken);
    if (rGet.status === 200 && rGet.body?.ok && Array.isArray(rGet.body?.schedules)) {
      pass('Work Schedule laden');
    } else {
      fail('Work Schedule laden', `Status ${rGet.status}: ${JSON.stringify(rGet.body)}`);
    }

    // Neues Modell erstellen
    const rPost = await post('/api/admin/work-schedule', {
      userId: 'u1',
      employmentPct: 80,
      workDays: { mon: 8.5, tue: 8.5, wed: 8.5, thu: 8.5, fri: 0 },
      validFrom: TODAY
    }, adminToken);

    if (rPost.status === 200 && rPost.body?.ok) {
      pass('Work Schedule erstellen (80% Blockzeit)');

      // Wieder laden und prüfen
      const rGetAfter = await get('/api/admin/work-schedule/u1', adminToken);
      const has80 = rGetAfter.body?.schedules?.some(s => s.employment_pct === 80);
      if (has80) {
        pass('Work Schedule 80% in Liste sichtbar');
      } else {
        fail('Work Schedule 80% in Liste sichtbar', 'nicht gefunden');
      }

      // Aufräumen — letzten Eintrag löschen
      const schedules = rGetAfter.body?.schedules || [];
      const toDelete = schedules.find(s => s.employment_pct === 80);
      if (toDelete) {
        const rDel = await del(`/api/admin/work-schedule/${toDelete.id}`, adminToken);
        if (rDel.status === 200 && rDel.body?.ok) {
          pass('Work Schedule löschen');
        } else {
          fail('Work Schedule löschen', `Status ${rDel.status}`);
        }
      }
    } else {
      fail('Work Schedule erstellen', `Status ${rPost.status}: ${JSON.stringify(rPost.body)}`);
    }
  }


  // ── 7. Stamp Edits ───────────────────────────
  section('Stamp Edit Log');

  if (!adminToken) {
    skip('Stamp Edits laden', 'kein Admin-Token');
  } else {
    const rEdits = await get(
      `/api/admin/stamp-edits?year=${YEAR}&monthIndex=${MONTH}`,
      adminToken
    );
    if (rEdits.status === 200 && rEdits.body?.ok && Array.isArray(rEdits.body?.users)) {
      pass('Stamp Edits laden');
    } else {
      fail('Stamp Edits laden', `Status ${rEdits.status}`);
    }
  }


  // ── 8. Admin-Übersicht ───────────────────────
  section('Admin Übersicht');

  if (!adminToken) {
    skip('Admin Summary', 'kein Admin-Token');
    skip('Admin Users', 'kein Admin-Token');
  } else {
    const rSummary = await get(
      `/api/admin/month-overview?year=${YEAR}&monthIndex=${MONTH}`,
      adminToken
    );
    if (rSummary.status === 200 && rSummary.body?.ok && Array.isArray(rSummary.body?.users)) {
      pass(`Admin Summary — ${rSummary.body.users.length} User geladen`);
    } else {
      fail('Admin Summary', `Status ${rSummary.status}`);
    }

    const rUsers = await get('/api/admin/users', adminToken);
    if (rUsers.status === 200 && rUsers.body?.ok && Array.isArray(rUsers.body?.users)) {
      pass(`Admin Users — ${rUsers.body.users.length} User gefunden`);
    } else {
      fail('Admin Users', `Status ${rUsers.status}`);
    }
  }


  // ── Ergebnis ─────────────────────────────────
  const total = passed + failed + skipped;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${BOLD}Resultat: ${total} Tests${RESET}`);
  console.log(`  ${GREEN}${passed} bestanden${RESET}`);
  if (failed > 0)  console.log(`  ${RED}${failed} fehlgeschlagen${RESET}`);
  if (skipped > 0) console.log(`  ${YELLOW}${skipped} übersprungen${RESET}`);
  console.log('');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(`\n${RED}Unerwarteter Fehler:${RESET}`, err);
  process.exit(1);
});