'use strict';

/**
 * @fileoverview Pure Berechnungsfunktionen ohne DB-Abhängigkeit
 *
 * Alle Funktionen in diesem Modul sind pure — sie haben keine Side Effects,
 * keinen globalen State und keine DB-Zugriffe. Sie können direkt unit-getestet
 * werden ohne Server-Setup.
 *
 * Kategorien:
 * - Zahlen-Utilities (round1, toNumber, clampToNumber)
 * - Stempel-Berechnung (computeNetWorkingHoursFromStamps)
 * - Tagesarbeitszeit (computeDailyWorkingHours, computeNonPikettHours)
 * - Absenzen (buildAcceptedAbsenceHoursMap, computeAbsenceDaysInPeriod)
 * - Pikett (buildPikettHoursByDate)
 * - Ferien-Verbrauch (computeVacationUsedDaysForMonth)
 * - Transmissions-Totals (computeTransmissionTotals)
 * - Anlagen-Utilities (addNum, subNum, normalizeKomNr, cleanupZeroish, deepCloneJson)
 */

const { formatDateKey, isBernHolidayKey } = require('./holidays');

// ─────────────────────────────────────────────────────────────────────────────
// Zahlen-Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rundet auf 1 Dezimalstelle. Gibt 0 zurück für nicht-finite Werte.
 *
 * @param {*} n
 * @returns {number}
 */
function round1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10) / 10;
}

/**
 * Konvertiert einen Wert zu einer Zahl. Unterstützt Komma als Dezimaltrennzeichen.
 * Gibt 0 zurück für ungültige Werte.
 *
 * @param {*} val
 * @returns {number}
 */
function toNumber(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    const n = parseFloat(val.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Konvertiert einen Wert zu einer nicht-negativen Zahl.
 * Gibt 0 zurück für NaN, Infinity oder nicht-numerische Werte.
 *
 * @param {*} value
 * @returns {number}
 */
function clampToNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stempel-Berechnung
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Berechnet die Netto-Arbeitszeit aus einem Array von Stempel-Objekten.
 * Stempel werden nach Zeit sortiert und als Ein/Aus-Paare verarbeitet.
 * Überlappende oder unvollständige Paare werden ignoriert.
 *
 * @param {Array<{ time: string, type: 'in'|'out' }>} stamps
 * @returns {number} Netto-Stunden (gerundet auf 2 Dezimalstellen)
 *
 * @example
 * computeNetWorkingHoursFromStamps([
 *   { time: '07:00', type: 'in' },
 *   { time: '12:00', type: 'out' },
 *   { time: '12:30', type: 'in' },
 *   { time: '16:30', type: 'out' },
 * ]) // → 9.0
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Tagesarbeitszeit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gibt die Arbeitszeit eines Tages zurück.
 * Für ÜZ1-Berechnung: nur Stempel zählen (nicht Kommissions- oder Tagesstunden).
 *
 * @param {object} dayData - Tag-Objekt aus dem Payload
 * @returns {number} Stunden
 */
function computeDailyWorkingHours(dayData) {
  if (!dayData || typeof dayData !== 'object') return 0;
  if (Array.isArray(dayData.stamps) && dayData.stamps.length > 0) {
    return computeNetWorkingHoursFromStamps(dayData.stamps);
  }
  return 0;
}

/**
 * Berechnet die Nicht-Pikett-Stunden eines Tages.
 * Beinhaltet: Kommissionsstunden (entries), Tagesstunden (dayHours), Spezialbuchungen.
 * Wird für Auswertungen und Ferienverbrauch verwendet (nicht für ÜZ1).
 *
 * @param {object} dayData - Tag-Objekt aus dem Payload
 * @returns {number} Stunden
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Pikett
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Baut eine Map von Datum → Pikett-Stunden aus einem Pikett-Array.
 *
 * @param {Array} pikettArray - Pikett-Einträge aus dem Payload
 * @returns {Map<string, number>} dateKey → Stunden
 */
function buildPikettHoursByDate(pikettArray) {
  const map = new Map();
  if (!Array.isArray(pikettArray)) return map;

  pikettArray.forEach((p) => {
    if (!p || !p.date) return;
    const h = clampToNumber(p.hours);
    if (h <= 0) return;
    map.set(p.date, (map.get(p.date) || 0) + h);
  });

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Absenzen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Baut eine Map von Datum → Absenz-Stunden für einen Monat.
 * Wert ist `null` für ganztägige Absenzen, eine Zahl für stundenweise.
 * Mehrtägige Absenzen werden immer als ganztägig behandelt.
 *
 * @param {Array} absencesArray - Absenzen aus dem Payload
 * @param {string} monthStartKey - YYYY-MM-DD
 * @param {string} monthEndKey - YYYY-MM-DD
 * @returns {Map<string, number|null>}
 */
function buildAcceptedAbsenceHoursMap(
  absencesArray,
  monthStartKey,
  monthEndKey
) {
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
        const isMultiDay = startKey !== endKey;
        map.set(k, isMultiDay ? null : (a.hours ?? null));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return map;
}

/**
 * Berechnet die Anzahl Absenztage einer Absenz innerhalb einer Periode.
 * Zählt nur Werktage (Mo–Fr). Verwendet `absence.days` wenn vorhanden
 * und die Absenz vollständig in der Periode liegt.
 *
 * @param {{ from: string, to: string, days?: number }} absence
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @returns {number}
 */
function computeAbsenceDaysInPeriod(absence, periodStart, periodEnd) {
  if (!absence || !absence.from || !absence.to) return 0;

  const { parseIsoDateOnly } = require('./holidays');

  const rawStart = parseIsoDateOnly(absence.from);
  const rawEnd = parseIsoDateOnly(absence.to);
  if (!rawStart || !rawEnd) return 0;

  const start = rawStart <= rawEnd ? rawStart : rawEnd;
  const end = rawStart <= rawEnd ? rawEnd : rawStart;

  if (end < periodStart || start > periodEnd) return 0;

  // Expliziter days-Wert gewinnt wenn die Absenz vollständig in der Periode liegt
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
    const weekday = cursor.getDay();
    if (weekday >= 1 && weekday <= 5) total += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ferien-Verbrauch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Berechnet den Ferienverbrauch in Tagen für einen Monat.
 * Tage mit `flags.ferien = true` zählen als Ferientage (anteilsmässig wenn gearbeitet).
 * Feiertage zählen nicht als Ferientage.
 *
 * @param {object} payload - Monats-Payload
 * @param {number} year
 * @param {number} monthIndex - 0-basiert
 * @returns {number}
 */
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
    used += Math.round(fraction * 4) / 4;
  }

  return Math.round(used * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transmissions-Totals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Berechnet die Totals für einen übertragenen Monat.
 * Wird beim Transmit für den Submissions-Record und die Übersicht verwendet.
 *
 * @param {object} payload - Monats-Payload
 * @returns {{ kom: number, dayHours: number, pikett: number, overtime3: number }}
 */
function computeTransmissionTotals(payload) {
  let kom = 0; // Kommissions- + Spezialbuchungen
  let dayHours = 0; // Tagesbezogene Stunden (Schulung, Sitzung, Transport)
  let pikett = 0; // ÜZ2 (Pikett)
  let overtime3 = 0; // ÜZ3 (Wochenend-Pikett)

  if (payload && payload.days && typeof payload.days === 'object') {
    for (const dayData of Object.values(payload.days)) {
      if (!dayData || typeof dayData !== 'object') continue;

      if (Array.isArray(dayData.entries)) {
        for (const entry of dayData.entries) {
          if (!entry || !entry.hours || typeof entry.hours !== 'object')
            continue;
          for (const v of Object.values(entry.hours)) {
            kom += toNumber(v);
          }
        }
      }

      if (Array.isArray(dayData.specialEntries)) {
        for (const s of dayData.specialEntries) {
          if (!s) continue;
          kom += toNumber(s.hours);
        }
      }

      if (dayData.dayHours && typeof dayData.dayHours === 'object') {
        dayHours += toNumber(dayData.dayHours.schulung);
        dayHours += toNumber(dayData.dayHours.sitzungKurs);
        dayHours += toNumber(dayData.dayHours.arztKrank);
      }
    }
  }

  if (payload && Array.isArray(payload.pikett)) {
    for (const p of payload.pikett) {
      if (!p) continue;
      const h = toNumber(p.hours);
      if (p.isOvertime3) overtime3 += h;
      else pikett += h;
    }
  }

  return {
    kom: round1(kom),
    dayHours: round1(dayHours),
    pikett: round1(pikett),
    overtime3: round1(overtime3),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anlagen-Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Addiert einen Wert zu einem Key in einem Objekt. Erstellt den Key wenn nötig.
 *
 * @param {object} obj
 * @param {string} key
 * @param {number} val
 */
function addNum(obj, key, val) {
  if (!obj[key]) obj[key] = 0;
  obj[key] += val;
}

/**
 * Subtrahiert einen Wert von einem Key in einem Objekt.
 * Löscht den Key wenn der Wert nahe 0 ist.
 *
 * @param {object} obj
 * @param {string} key
 * @param {number} val
 */
function subNum(obj, key, val) {
  if (!obj[key]) obj[key] = 0;
  obj[key] -= val;
  if (Math.abs(obj[key]) < 1e-9) delete obj[key];
}

/**
 * Normalisiert eine Kommissions-Nummer (entfernt Leerzeichen).
 *
 * @param {*} v
 * @returns {string}
 */
function normalizeKomNr(v) {
  const s = String(v || '').trim();
  return s ? s.replace(/\s+/g, '') : '';
}

/**
 * Entfernt Einträge aus einem Objekt deren Wert nahe 0 ist.
 *
 * @param {object} obj
 * @param {number} [eps=1e-9] - Toleranz
 */
function cleanupZeroish(obj, eps = 1e-9) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = Number(obj[k]);
    if (!Number.isFinite(v) || Math.abs(v) < eps) delete obj[k];
  }
}

/**
 * Tiefer Clone via JSON-Serialisierung.
 * Nur für einfache Objekte ohne Functions, Dates oder circular references.
 *
 * @param {*} value
 * @returns {*}
 */
function deepCloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Zahlen-Utilities
  round1,
  toNumber,
  clampToNumber,

  // Stempel
  computeNetWorkingHoursFromStamps,

  // Tagesarbeitszeit
  computeDailyWorkingHours,
  computeNonPikettHours,

  // Pikett
  buildPikettHoursByDate,

  // Absenzen
  buildAcceptedAbsenceHoursMap,
  computeAbsenceDaysInPeriod,

  // Ferien
  computeVacationUsedDaysForMonth,

  // Transmissions-Totals
  computeTransmissionTotals,

  // Anlagen-Utilities
  addNum,
  subNum,
  normalizeKomNr,
  cleanupZeroish,
  deepCloneJson,
};
