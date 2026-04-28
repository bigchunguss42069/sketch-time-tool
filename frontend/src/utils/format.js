/**
 * @fileoverview Formatierungsfunktionen für sketch-time-tool Frontend
 *
 * Alle Funktionen sind pure — kein DOM, kein State, keine Side Effects.
 * Können direkt importiert und unit-getestet werden.
 *
 * Kategorien:
 * - HTML/XML Escaping
 * - Stunden-Formatierung (formatHours, formatHoursSigned, formatPayrollHours)
 * - Tage-Formatierung (formatDays, formatPayrollDays)
 * - Datum-Formatierung (formatDateKey, formatDateDisplayEU, formatShortDate)
 * - Label-Funktionen (statusLabel, absenceTypeLabel, adminStatusText)
 */

// ─────────────────────────────────────────────────────────────────────────────
// HTML / XML Escaping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escaped HTML-Sonderzeichen für sichere innerHTML-Verwendung.
 *
 * @param {*} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escaped XML-Sonderzeichen (für SVG/XML Templates).
 *
 * @param {*} s
 * @returns {string}
 */
export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Stunden-Formatierung
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formatiert Stunden als "8,5 h". Gibt "0,0 h" für ungültige Werte.
 *
 * @param {*} value
 * @returns {string}
 */
export function formatHours(value) {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1).replace('.', ',') + ' h';
}

/**
 * Formatiert Stunden mit Vorzeichen. Gibt "0,0 h" für 0.
 *
 * @param {*} value
 * @returns {string} z.B. "+2,5 h", "-1,0 h", "0,0 h"
 */
export function formatHoursSigned(value) {
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) return '+' + rounded.toFixed(1).replace('.', ',') + ' h';
  if (rounded < 0)
    return '-' + Math.abs(rounded).toFixed(1).replace('.', ',') + ' h';
  return '0,0 h';
}

/**
 * Formatiert Stunden sicher — gibt "0,0 h" für NaN/undefined.
 *
 * @param {*} v
 * @returns {string}
 */
export function formatHoursSafe(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '0,0 h';
  return n.toFixed(1).replace('.', ',') + ' h';
}

/**
 * Formatiert Stunden für Lohnabrechnung-Karten.
 *
 * @param {*} v
 * @returns {string}
 */
export function formatPayrollHours(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0,0 h';
  return `${n.toFixed(1).replace('.', ',')} h`;
}

/**
 * Formatiert Stunden mit Vorzeichen für Lohnabrechnung.
 *
 * @param {*} v
 * @returns {string} z.B. "+2,5 h", "-1,0 h", "0,0 h"
 */
export function formatPayrollSignedHours(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0,0 h';
  const abs = Math.abs(n).toFixed(1).replace('.', ',');
  if (n > 0) return `+${abs} h`;
  if (n < 0) return `-${abs} h`;
  return '0,0 h';
}

/**
 * Formatiert einen Vorarbeit-Saldo als "aktuell / ziel h".
 *
 * @param {*} current
 * @param {*} total
 * @returns {string} z.B. "20,0 / 59,0 h"
 */
export function formatPayrollCounterHours(current, total) {
  const a = Number.isFinite(Number(current))
    ? Number(current).toFixed(1).replace('.', ',')
    : '0,0';
  const b = Number.isFinite(Number(total))
    ? Number(total).toFixed(1).replace('.', ',')
    : '0,0';
  return `${a} / ${b} h`;
}

/**
 * Formatiert Stunden für Input-Felder (kein "h", Komma als Dezimalzeichen).
 *
 * @param {number} num
 * @returns {string} z.B. "2,25" oder "2"
 */
export function formatHoursForInput(num) {
  let s = num.toFixed(2);
  s = s.replace('.', ',');
  s = s.replace(/,00$/, '');
  return s;
}

/**
 * Formatiert Zeit als HH:MM.
 *
 * @param {Date} date
 * @returns {string} z.B. "08:30"
 */
export function formatTimeHHMM(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tage-Formatierung
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formatiert Tage als "12,5" (1 Dezimalstelle, Komma).
 *
 * @param {*} value
 * @returns {string}
 */
export function formatDays(value) {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1).replace('.', ',');
}

/**
 * Formatiert Tage für Lohnabrechnung als "2,5 Tage".
 *
 * @param {*} v
 * @returns {string}
 */
export function formatPayrollDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return `${String(n).replace('.', ',')} Tage`;
}

/**
 * Formatiert eine Zahl als Integer-String (für Mahlzeiten, Zulagen).
 *
 * @param {*} v
 * @returns {string}
 */
export function formatPayrollCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Datum-Formatierung
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formatiert ein Date-Objekt als YYYY-MM-DD.
 *
 * @param {Date} date
 * @returns {string} z.B. "2026-04-23"
 */
export function formatDateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Formatiert ein Date-Objekt als DD.MM.YY (kurzes Schweizer Format).
 *
 * @param {Date} date
 * @returns {string} z.B. "23.04.26"
 */
export function formatShortDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

/**
 * Formatiert einen YYYY-MM-DD Key als DD.MM.YY.
 *
 * @param {string} dateKey
 * @returns {string}
 */
export function formatShortDateFromKey(dateKey) {
  const d = new Date(dateKey + 'T00:00:00');
  return formatShortDate(d);
}

/**
 * Formatiert einen YYYY-MM-DD String als DD.MM.YYYY (langes Schweizer Format).
 *
 * @param {string} dateStr
 * @returns {string} z.B. "23.04.2026"
 */
export function formatDateDisplayEU(dateStr) {
  const raw = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(dateStr || '–');
  const [yyyy, mm, dd] = raw.split('-');
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Formatiert ein Date-Objekt als DD.MM.YYYY (langes Schweizer Format).
 *
 * @param {Date} date
 * @returns {string} z.B. "23.04.2026"
 */
export function formatFullDateSlash(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Formatiert einen YYYY-MM-DD Key als "Mo 23.04" (Wochentag + Datum).
 *
 * @param {string} dateKey
 * @param {number} weekdayNum - 1=Mo, 2=Di, ..., 5=Fr
 * @returns {string}
 */
export function formatDayLabelFromKey(dateKey, weekdayNum) {
  const d = new Date(dateKey + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const map = { 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr' };
  return `${map[weekdayNum] || ''} ${dd}.${mm}`;
}

/**
 * Formatiert einen YYYY-MM-DD Key als langes deutsches Datum.
 * z.B. "Mo., 23. April 2026"
 *
 * @param {string} dateKey
 * @returns {string}
 */
export function formatDateDE(dateKey) {
  const d = new Date(dateKey + 'T00:00:00');
  return d.toLocaleDateString('de-CH', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Formatiert ein Date-Objekt als YYYY-MM-DD für Input-Felder.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatDateInputValue(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rundung
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rundet auf nächste 0.25.
 *
 * @param {number} num
 * @returns {number}
 */
export function roundToQuarter(num) {
  return Math.round(num * 4) / 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// Label-Funktionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gibt ein lesbares Label für einen Tag-Status zurück.
 *
 * @param {string} s - 'ok' | 'missing' | 'ferien' | 'absence'
 * @returns {string}
 */
export function statusLabel(s) {
  if (s === 'ok') return 'OK';
  if (s === 'missing') return 'Fehlt';
  if (s === 'ferien') return 'Ferien';
  if (s === 'absence') return 'Absenz';
  return '–';
}

/**
 * Gibt ein lesbares Label für einen Admin-Tag-Status zurück.
 * Erweitert statusLabel um 'ok-unverteilt'.
 *
 * @param {string} status
 * @returns {string}
 */
export function adminStatusText(status) {
  if (status === 'ok') return 'OK';
  if (status === 'ok-unverteilt') return 'Unverteilt';
  if (status === 'ferien') return 'Ferien';
  if (status === 'absence') return 'Absenz';
  return 'Fehlt';
}

/**
 * Gibt ein lesbares Label für einen Absenz-Typ zurück.
 *
 * @param {string} type
 * @returns {string}
 */
export function absenceTypeLabel(type) {
  const key = String(type || '')
    .trim()
    .toLowerCase();
  const map = {
    ferien: 'Ferien',
    unfall: 'Unfall',
    militaer: 'Militär',
    bezahlteabwesenheit: 'Bezahlte Abwesenheit',
    vaterschaft: 'Vaterschaftsurlaub',
    krank: 'Krank / Arztbesuch',
  };
  return map[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : '–');
}
