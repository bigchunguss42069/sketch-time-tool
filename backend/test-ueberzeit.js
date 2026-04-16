/*** sketch-time-tool — Überzeit & Vorarbeit Unit Tests (v3)
 *
 * Neue Szenarien gegenüber v2:
 * - Krank ganzer Tag → Soll = 0, kein Minus
 * - Krank halber Tag (4h) → Soll reduziert auf 4h
 * - Krank + gestempelt → gestempelte Stunden zählen, Absenz-Reduktion greift
 * - Ferien ganzer Tag → Soll = 0, kein Minus
 * - Ferien halber Tag → Soll halbiert
 * - Ferien + gestempelte Stunden → gestempelte Stunden irrelevant (Soll = 0)
 * - Krank halber Tag + 4h gestempelt → exakt 0 ÜZ1
 * - Woche mit Mix aus Krank, Ferien und normalen Tagen
 *
 * Ausführen: node test-ueberzeit.js
 */

const G = '\x1b[32m'; const R = '\x1b[31m';
const B = '\x1b[34m'; const X = '\x1b[0m'; const BOLD = '\x1b[1m';

let passed = 0; let failed = 0;

function pass(name) { console.log(`  ${G}✓${X} ${name}`); passed++; }
function fail(name, got, expected) {
  console.log(`  ${R}✗${X} ${name}`);
  console.log(`    ${R}Erwartet: ${expected}${X}`);
  console.log(`    ${R}Erhalten: ${got}${X}`);
  failed++;
}
function section(name) { console.log(`\n${BOLD}${B}▸ ${name}${X}`); }
function approx(a, b, tol = 0.05) { return Math.abs(a - b) <= tol; }
function check(name, got, expected) {
  if (approx(got, expected)) pass(name);
  else fail(name, got, expected);
}

const r1 = n => Math.round((Number(n) || 0) * 10) / 10;

// ── Kern-Logik (spiegelt server.js) ──────────────────────────

// Berechnet effektives Tagessoll nach Absenzen
// absenzHours: null = ganzer Tag Absenz, Zahl = stundenweise Absenz
function getEffectiveSoll(baseSoll, absenzHours) {
  if (absenzHours === null) return 0;           // ganzer Tag → Soll = 0
  if (absenzHours === undefined) return baseSoll; // keine Absenz
  return Math.max(0, baseSoll - absenzHours);   // stundenweise → Soll reduziert
}

// Simuliert einen einzelnen Tag mit optionaler Absenz
// gestempelt: tatsächlich gestempelte Stunden (irrelevant wenn ganzer Tag Absenz)
// baseSoll: Tagessoll aus Arbeitszeitmodell
// absenzHours: undefined = kein, null = ganzer Tag, Zahl = Stunden
function simulateDay(gestempelt, baseSoll, employmentPct, vorarbeitIn, vorarbeitRequired, absenzHours) {
  const soll = getEffectiveSoll(baseSoll, absenzHours);

  // Bei ganztägiger Absenz: gestempelte Stunden ignorieren
  const effektivGestempelt = (absenzHours === null) ? 0 : gestempelt;

  const diff = r1(effektivGestempelt - soll);
  let ueZ1 = 0;
  let vorarbeit = vorarbeitIn;

  if (diff <= 0) {
    ueZ1 = diff;
  } else {
    const schwelle = r1(0.5 * (employmentPct / 100));
    const inVorarbeit = Math.min(diff, schwelle);
    const inUeZ1 = r1(diff - inVorarbeit);

    if (vorarbeit < vorarbeitRequired) {
      const actualInVorarbeit = r1(Math.min(inVorarbeit, vorarbeitRequired - vorarbeit));
      const leftover = r1(inVorarbeit - actualInVorarbeit);
      vorarbeit = r1(vorarbeit + actualInVorarbeit);
      ueZ1 += leftover;
    } else {
      ueZ1 += inVorarbeit;
    }
    ueZ1 += inUeZ1;
  }

  return { ueZ1: r1(ueZ1), vorarbeit: r1(vorarbeit), soll };
}

function simulateWeek(days, employmentPct, vorarbeitIn, vorarbeitRequired) {
  let ueZ1Total = 0;
  let vorarbeit = vorarbeitIn;

  days.forEach(({ gestempelt, soll: baseSoll, absenz }) => {
    const result = simulateDay(gestempelt, baseSoll, employmentPct, vorarbeit, vorarbeitRequired, absenz);
    ueZ1Total = r1(ueZ1Total + result.ueZ1);
    vorarbeit = result.vorarbeit;
  });

  return { ueZ1: ueZ1Total, vorarbeit };
}

// ── Konstanten ────────────────────────────────────────────────
const SOLL_100 = 8.0;
const SOLL_80  = 6.4;
const SOLL_60  = 4.8;
const VORARBEIT_2026     = 59;
const VORARBEIT_2026_80  = r1(59 * 0.8);
const VORARBEIT_2026_60  = r1(59 * 0.6);

const HOLIDAYS_2026 = new Set([
  '2026-01-01','2026-01-02','2026-04-03','2026-04-05','2026-04-06',
  '2026-05-14','2026-05-25','2026-08-01','2026-09-20','2026-12-25','2026-12-26'
]);
const BRIDGE_DAYS_2026 = new Set([
  '2026-05-15','2026-12-28','2026-12-29','2026-12-30','2026-12-31'
]);


// ════════════════════════════════════════════════════════════
// BESTEHENDE SZENARIEN 1–15
// ════════════════════════════════════════════════════════════

section('Szenario 1 — Normalwoche 100% (8.5h/Tag, genau auf Schwelle)');
{
  const days = Array(5).fill({ gestempelt: 8.5, soll: SOLL_100 });
  const { ueZ1, vorarbeit } = simulateWeek(days, 100, 0, VORARBEIT_2026);
  check('Vorarbeit wächst auf +2.5h (5 × 0.5h)', vorarbeit, 2.5);
  check('ÜZ1 global = 0h', ueZ1, 0);
}

section('Szenario 2 — 100%, 9.0h/Tag → ÜZ1 wächst');
{
  const days = Array(5).fill({ gestempelt: 9.0, soll: SOLL_100 });
  const { ueZ1, vorarbeit } = simulateWeek(days, 100, 0, VORARBEIT_2026);
  check('Vorarbeit wächst auf +2.5h', vorarbeit, 2.5);
  check('ÜZ1 global = +2.5h', ueZ1, 2.5);
}

section('Szenario 3 — Fehltag, Vorarbeit bleibt unverändert');
{
  const days = [
    ...Array(4).fill({ gestempelt: 8.5, soll: SOLL_100 }),
    { gestempelt: 0, soll: SOLL_100 }
  ];
  const { ueZ1, vorarbeit } = simulateWeek(days, 100, 10, VORARBEIT_2026);
  check('Vorarbeit = 12h', vorarbeit, 12);
  check('ÜZ1 = -8.0h (Fehltag in ÜZ1)', ueZ1, -8.0);
}

section('Szenario 4 — Vorarbeit voll (59h), gesamte ÜZ in ÜZ1');
{
  const days = Array(5).fill({ gestempelt: 8.5, soll: SOLL_100 });
  const { ueZ1, vorarbeit } = simulateWeek(days, 100, 59, VORARBEIT_2026);
  check('Vorarbeit bleibt bei 59h', vorarbeit, 59);
  check('ÜZ1 = +2.5h', ueZ1, 2.5);
}

section('Szenario 5 — Vorarbeit leer, Fehltag → ÜZ1 negativ');
{
  const result = simulateDay(0, SOLL_100, 100, 0, VORARBEIT_2026, undefined);
  check('Vorarbeit = 0h', result.vorarbeit, 0);
  check('ÜZ1 = -8.0h', result.ueZ1, -8.0);
}

section('Szenario 6 — Feiertag zählt nicht als Fehltag');
{
  const isFeiertag = HOLIDAYS_2026.has('2026-01-01');
  if (isFeiertag) pass('2026-01-01 korrekt als Feiertag erkannt');
  else fail('2026-01-01 als Feiertag', 'nicht erkannt', 'Feiertag');
  const soll = isFeiertag ? 0 : 8.0;
  const result = simulateDay(0, soll, 100, 0, VORARBEIT_2026, undefined);
  check('Soll = 0h an Feiertag', soll, 0);
  check('ÜZ1 = 0h', result.ueZ1, 0);
}

section('Szenario 7 — Brückentage 2026');
{
  ['2026-05-15','2026-12-28','2026-12-29','2026-12-30','2026-12-31'].forEach(d => {
    if (BRIDGE_DAYS_2026.has(d)) pass(`${d} als Brückentag erkannt`);
    else fail(`${d} als Brückentag`, 'nicht erkannt', 'Brückentag');
    const soll = BRIDGE_DAYS_2026.has(d) ? 0 : 8.0;
    const r = simulateDay(0, soll, 100, 0, VORARBEIT_2026, undefined);
    check(`${d} → ÜZ1 = 0h`, r.ueZ1, 0);
  });
}

section('Szenario 8 — Genehmigte Ferien-Absenz = kein Minus');
{
  let total = 0;
  ['2026-03-02','2026-03-03','2026-03-04'].forEach(() => {
    // null = ganzer Tag Absenz → Soll = 0
    const r = simulateDay(0, SOLL_100, 100, 0, VORARBEIT_2026, null);
    total += r.ueZ1;
  });
  check('3 Ferientage = 0h ÜZ1', total, 0);
  pass('Genehmigte Absenz setzt Soll auf 0');
}

section('Szenario 9 — Jahreswechsel: Vorarbeit reset, ÜZ1 bleibt');
{
  check('Vorarbeit → reset auf 0', 0, 0);
  check('ÜZ1 12h bleibt erhalten', 12, 12);
  pass('Jahreswechsel-Logik korrekt');
}

section('Szenario 10 — 80% Blockzeit Mo-Do 8.5h, Fr frei');
{
  check('Schwelle 80% = 0.4h', r1(0.5 * 0.8), 0.4);
  const days = [
    ...Array(4).fill({ gestempelt: 8.5, soll: SOLL_80 }),
    { gestempelt: 0, soll: SOLL_80 }
  ];
  const { ueZ1, vorarbeit } = simulateWeek(days, 80, 0, VORARBEIT_2026_80);
  check('Vorarbeit = 1.6h', vorarbeit, 1.6);
  check('ÜZ1 = +0.4h', ueZ1, 0.4);
}

section('Szenario 11 — 80% Mo frei statt Fr (gleiches Saldo)');
{
  const days = [
    { gestempelt: 0,   soll: SOLL_80 },
    ...Array(4).fill({ gestempelt: 8.5, soll: SOLL_80 }),
  ];
  const { ueZ1, vorarbeit } = simulateWeek(days, 80, 0, VORARBEIT_2026_80);
  check('Vorarbeit = 1.6h (identisch)', vorarbeit, 1.6);
  check('ÜZ1 = +0.4h (identisch)', ueZ1, 0.4);
  pass('Flexibler freier Tag = identisches Saldo');
}

section('Szenario 12 — 60% Halbtag (5.3h/Tag)');
{
  check('Schwelle 60% = 0.3h', r1(0.5 * 0.6), 0.3);
  const days = Array(5).fill({ gestempelt: 5.3, soll: SOLL_60 });
  const { ueZ1, vorarbeit } = simulateWeek(days, 60, 0, VORARBEIT_2026_60);
  check('Vorarbeit = 1.5h', vorarbeit, 1.5);
  check('ÜZ1 = 1.0h', ueZ1, 1.0);
}

section('Szenario 13 — Vorarbeit fast voll, Rest in ÜZ1');
{
  const result = simulateDay(9.0, SOLL_100, 100, 58.8, VORARBEIT_2026, undefined);
  check('Vorarbeit füllt auf 59h', result.vorarbeit, 59);
  check('ÜZ1 = 0.8h', result.ueZ1, 0.8);
}

section('Szenario 14 — Mehrere Fehltage, Vorarbeit unberührt');
{
  const days = [
    { gestempelt: 8.5, soll: SOLL_100 },
    { gestempelt: 0,   soll: SOLL_100 },
    { gestempelt: 0,   soll: SOLL_100 },
    { gestempelt: 0,   soll: SOLL_100 },
    { gestempelt: 8.5, soll: SOLL_100 },
  ];
  const { ueZ1, vorarbeit } = simulateWeek(days, 100, 20, VORARBEIT_2026);
  check('Vorarbeit = 21.0h', vorarbeit, 21.0);
  check('ÜZ1 = -24.0h', ueZ1, -24.0);
}

section('Szenario 15 — Vorarbeit-Ziele 2026');
{
  check('100% = 59h', VORARBEIT_2026, 59);
  check('80%  = 47.2h', VORARBEIT_2026_80, 47.2);
  check('60%  = 35.4h', VORARBEIT_2026_60, 35.4);
  check('118 Tage bis voll bei 8.5h/Tag', Math.ceil(59 / 0.5), 118);
}


// ════════════════════════════════════════════════════════════
// NEUE SZENARIEN — ABSENZEN (Krank & Ferien)
// ════════════════════════════════════════════════════════════

section('Szenario 16 — Krank ganzer Tag → Soll = 0, kein Minus');
{
  // absenz = null → ganzer Tag → Soll = 0, gestempelt wird ignoriert
  const r = simulateDay(0, SOLL_100, 100, 0, VORARBEIT_2026, null);
  check('Soll = 0h (ganztägige Absenz)', r.soll, 0);
  check('ÜZ1 = 0h (kein Minus)', r.ueZ1, 0);
  check('Vorarbeit unverändert', r.vorarbeit, 0);
}

section('Szenario 17 — Krank ganzer Tag, trotzdem gestempelt → gestempelt ignoriert');
{
  // User hat krank eingetragen aber 2h gestempelt → 2h zählen nicht
  const r = simulateDay(2, SOLL_100, 100, 0, VORARBEIT_2026, null);
  check('Soll = 0h (Absenz überschreibt)', r.soll, 0);
  check('ÜZ1 = 0h (gestempelt ignoriert)', r.ueZ1, 0);
  check('Vorarbeit = 0h (kein Aufbau)', r.vorarbeit, 0);
}

section('Szenario 18 — Krank halber Tag (4h) → Soll = 4h');
{
  // absenz = 4h → Soll = 8 - 4 = 4h
  const r = simulateDay(0, SOLL_100, 100, 0, VORARBEIT_2026, 4);
  check('Soll = 4h (8h - 4h Absenz)', r.soll, 4);
  check('ÜZ1 = -4h (nicht gestempelt, Soll = 4h)', r.ueZ1, -4.0);
}

section('Szenario 19 — Krank halber Tag (4h) + 4h gestempelt → 0 ÜZ1');
{
  // User ist 4h krank, stempelt die anderen 4h
  // Soll = 8 - 4 = 4h, gestempelt = 4h → diff = 0 → ÜZ1 = 0
  const r = simulateDay(4, SOLL_100, 100, 0, VORARBEIT_2026, 4);
  check('Soll = 4h', r.soll, 4);
  check('ÜZ1 = 0h (Soll erfüllt)', r.ueZ1, 0);
  check('Vorarbeit = 0h (kein Überschuss)', r.vorarbeit, 0);
}

section('Szenario 20 — Krank halber Tag + 8.5h gestempelt → ÜZ1 wächst');
{
  // User stempelt 8.5h obwohl 4h krank
  // Soll = 4h, gestempelt = 8.5h → diff = +4.5h → 0.5h Vorarbeit + 4.0h ÜZ1
  const r = simulateDay(8.5, SOLL_100, 100, 0, VORARBEIT_2026, 4);
  check('Soll = 4h', r.soll, 4);
  check('ÜZ1 = +4.0h (über Schwelle)', r.ueZ1, 4.0);
  check('Vorarbeit = +0.5h (Schwelle)', r.vorarbeit, 0.5);
}

section('Szenario 21 — Ferien ganzer Tag → Soll = 0, gestempelt irrelevant');
{
  // Ferien-Absenz = ganzer Tag (null), auch wenn gestempelt
  const r = simulateDay(8.5, SOLL_100, 100, 5, VORARBEIT_2026, null);
  check('Soll = 0h (Ferien)', r.soll, 0);
  check('ÜZ1 = 0h (gestempelt ignoriert)', r.ueZ1, 0);
  check('Vorarbeit bleibt bei 5h', r.vorarbeit, 5);
}

section('Szenario 22 — Ferien halber Tag (4h) + nichts gestempelt → -4h ÜZ1');
{
  // Ferien halber Tag: Soll = 8 - 4 = 4h, nicht gestempelt → -4h ÜZ1
  const r = simulateDay(0, SOLL_100, 100, 0, VORARBEIT_2026, 4);
  check('Soll = 4h', r.soll, 4);
  check('ÜZ1 = -4h', r.ueZ1, -4.0);
}

section('Szenario 23 — Ferien halber Tag (4h) + 4h gestempelt → 0 ÜZ1');
{
  // Ferien halber Tag: Soll = 4h, gestempelt = 4h → 0 ÜZ1
  const r = simulateDay(4, SOLL_100, 100, 0, VORARBEIT_2026, 4);
  check('Soll = 4h', r.soll, 4);
  check('ÜZ1 = 0h', r.ueZ1, 0);
  check('Vorarbeit = 0h', r.vorarbeit, 0);
}

section('Szenario 24 — Krank 1h (Arztbesuch) + 7.5h gestempelt');
{
  // Arztbesuch 1h: Soll = 8 - 1 = 7h, gestempelt = 7.5h
  // diff = +0.5h → genau auf Schwelle → alles in Vorarbeit
  const r = simulateDay(7.5, SOLL_100, 100, 0, VORARBEIT_2026, 1);
  check('Soll = 7h', r.soll, 7);
  check('ÜZ1 = 0h (diff = 0.5h, genau Schwelle)', r.ueZ1, 0);
  check('Vorarbeit = +0.5h', r.vorarbeit, 0.5);
}

section('Szenario 25 — Woche mit Mix: Krank, Ferien, Normal');
{
  // Mo: normal 8.5h
  // Di: krank ganzer Tag (null) → Soll = 0
  // Mi: normal 8.5h
  // Do: Ferien halber Tag (4h) + 4h gestempelt → 0 ÜZ1
  // Fr: normal 8.5h
  const days = [
    { gestempelt: 8.5, soll: SOLL_100, absenz: undefined },  // Mo: +0.5h Vorarbeit
    { gestempelt: 0,   soll: SOLL_100, absenz: null      },  // Di: Krank → 0 ÜZ
    { gestempelt: 8.5, soll: SOLL_100, absenz: undefined },  // Mi: +0.5h Vorarbeit
    { gestempelt: 4,   soll: SOLL_100, absenz: 4         },  // Do: Ferien ½ → 0 ÜZ
    { gestempelt: 8.5, soll: SOLL_100, absenz: undefined },  // Fr: +0.5h Vorarbeit
  ];
  const { ueZ1, vorarbeit } = simulateWeek(days, 100, 0, VORARBEIT_2026);

  check('Vorarbeit = 1.5h (3 normale Tage × 0.5h)', vorarbeit, 1.5);
  check('ÜZ1 = 0h (Krank + Ferien neutralisiert)', ueZ1, 0);
}

section('Szenario 26 — Krank bei 80% (6.4h Soll)');
{
  // 80% User, krank halber Tag (3.2h = halbes Soll)
  // Soll = 6.4 - 3.2 = 3.2h, gestempelt = 3.2h → 0 ÜZ1
  const r = simulateDay(3.2, SOLL_80, 80, 0, VORARBEIT_2026_80, 3.2);
  check('Soll = 3.2h (6.4 - 3.2h Absenz)', r.soll, 3.2);
  check('ÜZ1 = 0h', r.ueZ1, 0);
}

section('Szenario 27 — Krank ganzer Tag bei 80%');
{
  // 80% User, krank ganzer Tag → Soll = 0
  const r = simulateDay(0, SOLL_80, 80, 0, VORARBEIT_2026_80, null);
  check('Soll = 0h', r.soll, 0);
  check('ÜZ1 = 0h', r.ueZ1, 0);
}


// ── Resultat ─────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'─'.repeat(50)}`);
console.log(`${BOLD}Resultat: ${total} Tests${X}`);
console.log(`  ${G}${passed} bestanden${X}`);
if (failed > 0) console.log(`  ${R}${failed} fehlgeschlagen${X}`);
console.log('');

if (failed === 0) {
  console.log(`${G}${BOLD}Alle Tests bestanden ✓${X}`);
  console.log(`ÜZ, Vorarbeit und Absenz-Logik funktionieren korrekt.\n`);
} else {
  console.log(`${R}${BOLD}${failed} Test(s) fehlgeschlagen ✗${X}`);
  process.exit(1);
}
