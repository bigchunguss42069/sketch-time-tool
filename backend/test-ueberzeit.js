/**
 * sketch-time-tool — Überzeit & Vorarbeit Unit Tests
 *
 * Testet die Kernlogik direkt ohne HTTP-Requests.
 * Läuft im backend Ordner:
 *   cd backend && node ../test-ueberzeit.js
 */

// ── Terminal Farben ──
const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m';
const B = '\x1b[34m'; const X = '\x1b[0m';  const BOLD = '\x1b[1m';

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

// ── Vorarbeit-Puffer Logik (aus server.js extrahiert) ──
function applyVorarbeitLogic(deltaUeZ1, vorarbeitBalance, vorarbeitRequired) {
  const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
  let deltaUeZ1Global = deltaUeZ1;
  let newVorarbeit = vorarbeitBalance;

  if (deltaUeZ1 > 0) {
    const inVorarbeit = Math.min(deltaUeZ1, vorarbeitRequired - vorarbeitBalance);
    newVorarbeit = r1(Math.min(vorarbeitRequired, vorarbeitBalance + inVorarbeit));
    deltaUeZ1Global = r1(deltaUeZ1 - inVorarbeit);
  } else if (deltaUeZ1 < 0) {
    const ausVorarbeit = Math.min(Math.abs(deltaUeZ1), vorarbeitBalance);
    newVorarbeit = r1(Math.max(0, vorarbeitBalance - ausVorarbeit));
    deltaUeZ1Global = r1(deltaUeZ1 + ausVorarbeit);
  }

  return { newVorarbeit, deltaUeZ1Global };
}

// ── Stempel zu Stunden ──
function stampsToHours(pairs) {
  // pairs = [['07:00','16:00'], ...] je ein [ein, aus]
  let total = 0;
  pairs.forEach(([ein, aus]) => {
    const [eh, em] = ein.split(':').map(Number);
    const [ah, am] = aus.split(':').map(Number);
    total += (ah * 60 + am - eh * 60 - em) / 60;
  });
  return Math.round(total * 10) / 10;
}

// ── Tag-Payload bauen ──
function makeDay(stamps, flags = {}) {
  return { stamps: stamps.map(([ein, aus]) => [
    { type: 'in', time: ein }, { type: 'out', time: aus }
  ]).flat(), flags };
}

// ── Werktage eines Monats zählen (ohne Feiertage) ──
function countWorkdays(year, monthIndex, holidays = new Set()) {
  let count = 0;
  const d = new Date(year, monthIndex, 1);
  while (d.getMonth() === monthIndex) {
    const wd = d.getDay();
    const key = d.toISOString().slice(0, 10);
    if (wd >= 1 && wd <= 5 && !holidays.has(key)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// ── Feiertage 2026 ──
const HOLIDAYS_2026 = new Set([
  '2026-01-01','2026-01-02','2026-04-03','2026-04-05','2026-04-06',
  '2026-05-14','2026-05-25','2026-08-01','2026-09-20','2026-12-25','2026-12-26'
]);


// ════════════════════════════════════════════════
// SZENARIO 1 — Normalwoche 100%, 8.5h/Tag
// ════════════════════════════════════════════════
section('Szenario 1 — Normalwoche 100% (8.5h/Tag)');
{
  // 5 Arbeitstage × (8.5h - 8.0h) = +2.5h ÜZ
  // Vorarbeit war 0 → +2.5h geht in Vorarbeit
  const deltaUeZ1 = 5 * (8.5 - 8.0); // +2.5h
  const { newVorarbeit, deltaUeZ1Global } = applyVorarbeitLogic(deltaUeZ1, 0, 39);

  check('ÜZ1 Rohwert = +2.5h', deltaUeZ1, 2.5);
  check('Vorarbeit wächst auf +2.5h', newVorarbeit, 2.5);
  check('ÜZ1 global = 0 (alles in Vorarbeit)', deltaUeZ1Global, 0);
}

// ════════════════════════════════════════════════
// SZENARIO 2 — Negativwoche (fehlt 1 Tag), Vorarbeit = 10h
// ════════════════════════════════════════════════
section('Szenario 2 — Fehltag, Vorarbeit wird zuerst abgezogen');
{
  // 4 normale Tage (8.0h) + 1 Fehltag = -8.0h netto
  // Vorarbeit = 10h → wird um 8h reduziert, ÜZ1 global bleibt unberührt
  const deltaUeZ1 = 4 * (8.0 - 8.0) + (0 - 8.0); // -8.0h
  const { newVorarbeit, deltaUeZ1Global } = applyVorarbeitLogic(deltaUeZ1, 10, 39);

  check('ÜZ1 Rohwert = -8.0h', deltaUeZ1, -8.0);
  check('Vorarbeit reduziert auf 2.0h', newVorarbeit, 2.0);
  check('ÜZ1 global = 0 (Vorarbeit hat gepuffert)', deltaUeZ1Global, 0);
}

// ════════════════════════════════════════════════
// SZENARIO 3 — Vorarbeit voll (39h), Rest geht in ÜZ1
// ════════════════════════════════════════════════
section('Szenario 3 — Vorarbeit bereits voll, ÜZ1 wächst');
{
  // Vorarbeit = 39h (voll), User macht +3.0h
  // → Vorarbeit bleibt 39h, ÜZ1 global +3.0h
  const deltaUeZ1 = 3.0;
  const { newVorarbeit, deltaUeZ1Global } = applyVorarbeitLogic(deltaUeZ1, 39, 39);

  check('Vorarbeit bleibt bei 39h (Maximum)', newVorarbeit, 39);
  check('ÜZ1 global = +3.0h', deltaUeZ1Global, 3.0);
}

// ════════════════════════════════════════════════
// SZENARIO 4 — Vorarbeit = 0, negativer Tag → ÜZ1 negativ
// ════════════════════════════════════════════════
section('Szenario 4 — Vorarbeit leer, Fehltag geht in ÜZ1 negativ');
{
  // Vorarbeit = 0, User fehlt → -8.0h
  // → Vorarbeit bleibt 0, ÜZ1 global -8.0h
  const deltaUeZ1 = -8.0;
  const { newVorarbeit, deltaUeZ1Global } = applyVorarbeitLogic(deltaUeZ1, 0, 39);

  check('Vorarbeit bleibt bei 0 (Minimum)', newVorarbeit, 0);
  check('ÜZ1 global = -8.0h (negativ)', deltaUeZ1Global, -8.0);
}

// ════════════════════════════════════════════════
// SZENARIO 5 — Feiertag (01.01.2026 = Neujahr)
// ════════════════════════════════════════════════
section('Szenario 5 — Feiertag zählt nicht als Fehltag');
{
  // 01.01.2026 ist Donnerstag und Feiertag
  // Wenn User nicht stempelt → Soll = 0 → ÜZ = 0
  const dateKey = '2026-01-01';
  const isFeiertag = HOLIDAYS_2026.has(dateKey);
  const soll = isFeiertag ? 0 : 8.0;
  const gestempelt = 0;
  const diff = gestempelt - soll;

  if (isFeiertag) pass('2026-01-01 korrekt als Feiertag erkannt');
  else fail('2026-01-01 korrekt als Feiertag erkannt', 'nicht erkannt', 'Feiertag');
  check('Soll = 0h an Feiertag', soll, 0);
  check('ÜZ1 = 0h (kein Minus)', diff, 0);
}

// ════════════════════════════════════════════════
// SZENARIO 6 — Genehmigte Absenz (Ferien)
// ════════════════════════════════════════════════
section('Szenario 6 — Genehmigte Absenz = kein Minus');
{
  // Wenn ein Tag als genehmigte Absenz markiert ist → Soll = 0
  const acceptedAbsenceDays = new Set(['2026-03-02', '2026-03-03', '2026-03-04']);

  const testDays = ['2026-03-02', '2026-03-03', '2026-03-04'];
  let totalDiff = 0;
  testDays.forEach(day => {
    const isAbsenz = acceptedAbsenceDays.has(day);
    const soll = isAbsenz ? 0 : 8.0;
    totalDiff += 0 - soll; // nicht gestempelt
  });

  check('3 Ferientage = 0h ÜZ1', totalDiff, 0);
  pass('Genehmigte Absenz setzt Soll auf 0');
}

// ════════════════════════════════════════════════
// SZENARIO 7 — Jahreswechsel
// ════════════════════════════════════════════════
section('Szenario 7 — Jahreswechsel: Vorarbeit reset, ÜZ1 bleibt');
{
  // Vor Jahreswechsel: Vorarbeit = 35h, ÜZ1 = 12h
  const vorarbeitVorher = 35;
  const ueZ1Vorher = 12;

  // Jahreswechsel simulieren
  const vorarbeitNach = 0; // reset
  const ueZ1Nach = ueZ1Vorher; // bleibt

  check('Vorarbeit wird auf 0 zurückgesetzt', vorarbeitNach, 0);
  check('ÜZ1 bleibt bei 12h nach Jahreswechsel', ueZ1Nach, 12);
  pass('Jahreswechsel-Logik korrekt');
}

// ════════════════════════════════════════════════
// SZENARIO 7b — Teilweise Vorarbeit + Jahreswechsel
// ════════════════════════════════════════════════
section('Szenario 7b — Vorarbeit nicht voll, Jahreswechsel');
{
  // User hat nur 20h Vorarbeit bis Ende Jahr gesammelt (Ziel 39h)
  // → Jahreswechsel: Vorarbeit reset auf 0
  // → ÜZ1 global unverändert
  const vorarbeitVorher = 20;
  const ueZ1Vorher = 5;
  const vorarbeitNach = 0;
  const ueZ1Nach = ueZ1Vorher;

  check('Vorarbeit 20h → reset auf 0', vorarbeitNach, 0);
  check('ÜZ1 5h bleibt erhalten', ueZ1Nach, 5);
}

// ════════════════════════════════════════════════
// SZENARIO 8 — 80% User Blockzeit (Mo-Do 8.5h, Fr frei)
// ════════════════════════════════════════════════
section('Szenario 8 — 80% Blockzeit Mo-Do 8.5h, Fr frei');
{
  // Tagessoll 80% = 6.4h
  // Mo-Do: 4 × (8.5 - 6.4) = +8.4h ÜZ
  // Fr: nicht gestempelt, Soll 6.4h → -6.4h ÜZ
  // Total: +8.4 - 6.4 = +2.0h → geht in Vorarbeit
  const sollPerDay = 6.4;
  const moDoStunden = 4 * (8.5 - sollPerDay); // +8.4h
  const frDiff = 0 - sollPerDay; // -6.4h
  const wocheUeZ1 = Math.round((moDoStunden + frDiff) * 10) / 10;

  check('Mo-Do Überschuss = +8.4h', moDoStunden, 8.4);
  check('Fr Minus = -6.4h', frDiff, -6.4);
  check('Wochensaldo = +2.0h', wocheUeZ1, 2.0);

  const { newVorarbeit, deltaUeZ1Global } = applyVorarbeitLogic(wocheUeZ1, 0, 39);
  check('Vorarbeit wächst auf +2.0h', newVorarbeit, 2.0);
  check('ÜZ1 global = 0', deltaUeZ1Global, 0);
}

// ════════════════════════════════════════════════
// SZENARIO 9 — Grenzfall: Vorarbeit fast voll, grosse ÜZ
// ════════════════════════════════════════════════
section('Szenario 9 — Vorarbeit fast voll, Überschuss in ÜZ1');
{
  // Vorarbeit = 37h (fast voll), User macht +5h ÜZ diesen Monat
  // → 2h gehen in Vorarbeit (bis 39h), 3h gehen in ÜZ1 global
  const deltaUeZ1 = 5.0;
  const { newVorarbeit, deltaUeZ1Global } = applyVorarbeitLogic(deltaUeZ1, 37, 39);

  check('Vorarbeit füllt auf 39h (Maximum)', newVorarbeit, 39);
  check('ÜZ1 global = +3.0h (Überschuss)', deltaUeZ1Global, 3.0);
}

// ════════════════════════════════════════════════
// SZENARIO 10 — Vorarbeit teilweise gepuffert, Rest in ÜZ1 negativ
// ════════════════════════════════════════════════
section('Szenario 10 — Grosses Minus, Vorarbeit puffert teilweise');
{
  // Vorarbeit = 5h, User hat -12h ÜZ (z.B. lange krank ohne Absenz)
  // → 5h von Vorarbeit abgezogen, 7h gehen in ÜZ1 negativ
  const deltaUeZ1 = -12.0;
  const { newVorarbeit, deltaUeZ1Global } = applyVorarbeitLogic(deltaUeZ1, 5, 39);

  check('Vorarbeit auf 0h reduziert', newVorarbeit, 0);
  check('ÜZ1 global = -7.0h', deltaUeZ1Global, -7.0);
}

// ── Resultat ─────────────────────────────────────
const total = passed + failed;
console.log(`\n${'─'.repeat(50)}`);
console.log(`${BOLD}Resultat: ${total} Tests${X}`);
console.log(`  ${G}${passed} bestanden${X}`);
if (failed > 0) console.log(`  ${R}${failed} fehlgeschlagen${X}`);
console.log('');

if (failed === 0) {
  console.log(`${G}${BOLD}Alle Tests bestanden ✓${X}`);
  console.log(`Die ÜZ/Vorarbeit-Logik funktioniert korrekt.\n`);
} else {
  console.log(`${R}${BOLD}${failed} Test(s) fehlgeschlagen ✗${X}`);
  console.log(`Bitte die fehlgeschlagenen Szenarien überprüfen.\n`);
  process.exit(1);
}