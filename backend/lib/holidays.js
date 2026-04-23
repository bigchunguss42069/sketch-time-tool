'use strict';

/**
 * @fileoverview Feiertage, Brückentage und Datums-Hilfsfunktionen
 *
 * Dieses Modul enthält:
 * - Berner Feiertage und Firmeneigene Brückentage als Konstanten
 * - Pure Datumsfunktionen (keine DB-Abhängigkeit)
 *
 * Alle Funktionen sind pure (kein globaler State, keine Side Effects)
 * und können direkt unit-getestet werden.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Feiertage (Kanton Bern)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gesetzliche Feiertage im Kanton Bern pro Jahr.
 * Neues Jahr hinzufügen wenn nötig.
 *
 * @type {Record<number, Set<string>>}
 */
const BERN_HOLIDAYS = {
  2025: new Set([
    '2025-01-01', // Neujahr
    '2025-01-02', // Berchtoldstag
    '2025-04-18', // Karfreitag
    '2025-04-20', // Ostersonntag
    '2025-04-21', // Ostermontag
    '2025-05-29', // Auffahrt
    '2025-06-09', // Pfingstmontag
    '2025-08-01', // Nationalfeiertag
    '2025-09-21', // Knabenschiessen (Bern)
    '2025-12-25', // Weihnachten
    '2025-12-26', // Stephanstag
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

/**
 * Firmeninterne Brückentage (bezahlte Frei-Tage zwischen Feiertag und Wochenende).
 * Neues Jahr hinzufügen wenn nötig.
 *
 * @type {Record<number, Set<string>>}
 */
const COMPANY_BRIDGE_DAYS = {
  2026: new Set([
    '2026-05-15', // Brücke nach Auffahrt
    '2026-12-28', // Weihnachtsferien
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
  ]),
};

// ─────────────────────────────────────────────────────────────────────────────
// Feiertags-Checks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prüft ob ein Datum ein Berner Feiertag ist.
 *
 * @param {string} dateKey - Datum im Format YYYY-MM-DD
 * @returns {boolean}
 */
function isBernHolidayKey(dateKey) {
  const year = Number(String(dateKey).slice(0, 4));
  const set = BERN_HOLIDAYS[year];
  return !!(set && set.has(dateKey));
}

/**
 * Prüft ob ein Datum ein Firmen-Brückentag ist.
 *
 * @param {string} dateKey - Datum im Format YYYY-MM-DD
 * @returns {boolean}
 */
function isCompanyBridgeDay(dateKey) {
  const year = Number(String(dateKey).slice(0, 4));
  const set = COMPANY_BRIDGE_DAYS[year];
  return !!(set && set.has(dateKey));
}

/**
 * Prüft ob ein Datum ein Werktag (Mo–Fr) ist.
 *
 * @param {string} dateKey - Datum im Format YYYY-MM-DD
 * @returns {boolean}
 */
function isWeekdayDateKey(dateKey) {
  const d = new Date(String(dateKey).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const wd = d.getDay();
  return wd >= 1 && wd <= 5;
}

// ─────────────────────────────────────────────────────────────────────────────
// Datums-Formatierung
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formatiert ein Date-Objekt als YYYY-MM-DD String.
 *
 * @param {Date} date
 * @returns {string} z.B. "2026-04-23"
 */
function formatDateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Formatiert ein YYYY-MM-DD Datum als DD.MM.YYYY (Schweizer Format).
 *
 * @param {string} dateKey - Datum im Format YYYY-MM-DD
 * @returns {string} z.B. "23.04.2026"
 */
function formatDateDisplayEU(dateKey) {
  const raw = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(dateKey || '–');
  const [yyyy, mm, dd] = raw.split('-');
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Parst ein ISO-Datum (YYYY-MM-DD) zu einem Date-Objekt (lokale Mitternacht).
 * Gibt null zurück wenn das Format ungültig ist.
 *
 * @param {string} value
 * @returns {Date|null}
 */
function parseIsoDateOnly(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(raw + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Gibt den deutschen Monatsnamen + Jahr zurück (z.B. "April 2026").
 *
 * @param {number} year
 * @param {number} monthIndex - 0-basiert
 * @returns {string}
 */
function makeMonthLabel(year, monthIndex) {
  const d = new Date(year, monthIndex, 1);
  const label = d.toLocaleString('de-DE', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Monats- und Wochen-Keys
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erzeugt einen Monats-Key im Format YYYY-MM.
 * Wird für Snapshots und Submissions verwendet.
 *
 * @param {number} year
 * @param {number} monthIndex - 0-basiert
 * @returns {string} z.B. "2026-04"
 */
function monthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/**
 * Alias für monthKey — verwendet in Konten-Kontext.
 *
 * @param {number} year
 * @param {number} monthIndex - 0-basiert
 * @returns {string}
 */
function kontenMonthKey(year, monthIndex) {
  return monthKey(year, monthIndex);
}

/**
 * Erzeugt einen Wochen-Key im Format YYYY-WNN.
 *
 * @param {number} weekYear
 * @param {number} week
 * @returns {string} z.B. "2026-W17"
 */
function weekKey(weekYear, week) {
  return `${weekYear}-W${week}`;
}

/**
 * Berechnet ISO-Wochennummer und Jahr für ein Date-Objekt.
 * Verwendet UTC-Arithmetik für konsistente Resultate unabhängig von Timezone.
 *
 * @param {Date} date
 * @returns {{ week: number, year: number }}
 */
function getISOWeekInfo(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { week: weekNo, year: d.getUTCFullYear() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bereichs-Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gibt alle Monate zwischen zwei Daten zurück (inklusiv).
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Array<{ year: number, monthIndex: number, monthKey: string }>}
 */
function getMonthRangeBetween(startDate, endDate) {
  const out = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= endMonth) {
    out.push({
      year: cursor.getFullYear(),
      monthIndex: cursor.getMonth(),
      monthKey: monthKey(cursor.getFullYear(), cursor.getMonth()),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return out;
}

/**
 * Prüft ob ein dateKey innerhalb eines geschlossenen Bereichs liegt.
 *
 * @param {string} dateKey
 * @param {string} fromKey
 * @param {string} toKey
 * @returns {boolean}
 */
function isDateKeyInClosedRange(dateKey, fromKey, toKey) {
  const raw = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  return raw >= fromKey && raw <= toKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Konstanten
  BERN_HOLIDAYS,
  COMPANY_BRIDGE_DAYS,

  // Feiertags-Checks
  isBernHolidayKey,
  isCompanyBridgeDay,
  isWeekdayDateKey,

  // Formatierung
  formatDateKey,
  formatDateDisplayEU,
  parseIsoDateOnly,
  makeMonthLabel,

  // Keys
  monthKey,
  kontenMonthKey,
  weekKey,
  getISOWeekInfo,

  // Bereichs-Helpers
  getMonthRangeBetween,
  isDateKeyInClosedRange,
};
