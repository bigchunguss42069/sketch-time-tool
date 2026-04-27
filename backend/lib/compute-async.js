'use strict';

/**
 * @fileoverview Asynchrone Berechnungsfunktionen (brauchen DB über getDailySoll)
 *
 * Diese Funktionen berechnen ÜZ1/Vorarbeit und Monatsübersichten.
 * Sie sind "async" weil sie pro Tag getDailySoll aufrufen, welches die
 * work_schedules Tabelle abfragt.
 *
 * Funktionen:
 * - computeMonthUeZ1AndVorarbeit   — ÜZ1/Vorarbeit für einen ganzen Monat
 * - computeRangeUeZ1AndVorarbeit   — ÜZ1/Vorarbeit für beliebige Date-Range
 * - computePayrollPeriodOvertimeFromSubmission — ÜZ1/ÜZ2/ÜZ3 für Lohnperiode
 * - buildMonthOverviewFromSubmission — Monatsübersicht für Admin-Dashboard (pure)
 *
 * Pattern: createComputeAsyncService(getDailySoll, fetchEmpStartKey) gibt
 * alle Funktionen zurück, gebunden an die DB-abhängigen Hilfsfunktionen.
 *
 * Gemeinsame Business-Rule für diff:
 *   Ferien: diff = dayTotal > soll ? dayTotal - soll : 0
 *   Sonst wenn dayTotal > baseSoll: diff = dayTotal - baseSoll
 *   Sonst: diff = min(dayTotal + absHours, baseSoll) - baseSoll
 *   → Arzt/Krank deckt Fehlzeit aber generiert keine ÜZ
 */

const { formatDateKey, getISOWeekInfo } = require('./holidays');
const {
  round1,
  toNumber,
  buildAcceptedAbsenceHoursMap,
  buildPikettHoursByDate,
  computeNetWorkingHoursFromStamps,
  computeDailyWorkingHours,
  computeNonPikettHours,
} = require('./compute');

// ─────────────────────────────────────────────────────────────────────────────
// Pure Funktionen (keine DB-Abhängigkeit)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Berechnet die Monatsübersicht aus einem Submission-Payload.
 * Wird für den Admin-Dashboard-Tab und die Monats-Summary verwendet.
 * Ist pure — braucht keine DB, da Absenzen aus dem Payload kommen.
 *
 * @param {object} submission - Monats-Payload
 * @param {number} year
 * @param {number} monthIndex - 0-basiert
 * @param {Map|Set} [acceptedAbsenceDaysOverride] - Optionaler Override für Absenzen
 * @returns {{ monthStartKey: string, monthEndKey: string, monthTotalHours: number, weeks: object[] }}
 */
function buildMonthOverviewFromSubmission(
  submission,
  year,
  monthIndex,
  acceptedAbsenceDaysOverride
) {
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  const monthStartKey = formatDateKey(monthStart);
  const monthEndKey = formatDateKey(monthEnd);

  const daysObj =
    submission && submission.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  const pikettByDate = buildPikettHoursByDate(submission?.pikett);

  const acceptedAbsenceDays =
    acceptedAbsenceDaysOverride instanceof Set ||
    acceptedAbsenceDaysOverride instanceof Map
      ? acceptedAbsenceDaysOverride
      : buildAcceptedAbsenceHoursMap(
          submission?.absences,
          monthStartKey,
          monthEndKey
        );

  let monthTotalHours = 0;
  const weekMap = new Map();

  const cursor = new Date(monthStart);
  while (cursor <= monthEnd) {
    const dateKey = formatDateKey(cursor);
    const weekday = cursor.getDay();

    const dayData = daysObj[dateKey] || null;
    const ferien = !!dayData?.flags?.ferien;
    const nonPikett = computeNonPikettHours(dayData);
    const pikett = pikettByDate.get(dateKey) || 0;
    const totalHours = nonPikett + pikett;

    const stampHours =
      Array.isArray(dayData?.stamps) && dayData.stamps.length > 0
        ? computeNetWorkingHoursFromStamps(dayData.stamps)
        : null;

    const hoursForTotal =
      stampHours !== null ? stampHours + pikett : totalHours;
    monthTotalHours += hoursForTotal;

    const hasAcceptedAbsence = acceptedAbsenceDays.has(dateKey);
    const hasStamps =
      Array.isArray(dayData?.stamps) && dayData.stamps.length > 0;

    let status = 'missing';
    if (ferien) status = 'ferien';
    else if (hasAcceptedAbsence) status = 'absence';
    else if (totalHours > 0 || hasStamps) status = 'ok';

    const { week, year: weekYear } = getISOWeekInfo(cursor);
    const wk = `${weekYear}-W${week}`;

    if (!weekMap.has(wk)) {
      weekMap.set(wk, {
        week,
        weekYear,
        minDate: null,
        maxDate: null,
        workDaysInMonth: 0,
        missingCount: 0,
        weekTotalHours: 0,
        weekStampHours: 0,
        days: [],
      });
    }

    const w = weekMap.get(wk);
    if (!w.minDate || cursor < w.minDate) w.minDate = new Date(cursor);
    if (!w.maxDate || cursor > w.maxDate) w.maxDate = new Date(cursor);
    w.weekTotalHours += totalHours;
    if (stampHours !== null)
      w.weekStampHours = (w.weekStampHours || 0) + stampHours;

    if (weekday >= 1 && weekday <= 5) {
      w.workDaysInMonth += 1;
      if (status === 'missing') w.missingCount += 1;

      w.days.push({
        dateKey,
        weekday,
        totalHours,
        stampHours,
        distributedHours: Math.round(nonPikett * 10) / 10,
        status,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks = Array.from(weekMap.values()).sort((a, b) => {
    if (a.weekYear !== b.weekYear) return a.weekYear - b.weekYear;
    return a.week - b.week;
  });

  return {
    monthStartKey,
    monthEndKey,
    monthTotalHours,
    weeks: weeks.map((w) => ({
      week: w.week,
      weekYear: w.weekYear,
      minDateKey: w.minDate ? formatDateKey(w.minDate) : null,
      maxDateKey: w.maxDate ? formatDateKey(w.maxDate) : null,
      workDaysInMonth: w.workDaysInMonth,
      missingCount: w.missingCount,
      weekTotalHours: w.weekTotalHours,
      weekStampHours: w.weekStampHours || null,
      days: w.days,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory — DB-gebundene Berechnungen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt die async Berechnungsfunktionen gebunden an getDailySoll/fetchEmpStartKey.
 *
 * @param {Function} getDailySoll - aus konten.js Service
 * @param {Function} fetchEmpStartKey - aus konten.js Service
 * @returns {object}
 */
function createComputeAsyncService(getDailySoll, fetchEmpStartKey) {
  /**
   * Berechnet ÜZ1 und Vorarbeit für einen ganzen Monat.
   * Identisch mit der Transmit-Logik — wird beim Übertragen aufgerufen.
   *
   * @param {object} payload - Monats-Payload
   * @param {number} year
   * @param {number} monthIndex - 0-basiert
   * @param {string} userId
   * @param {number} vorarbeitBalanceIn - Vorarbeit-Stand zu Monatsbeginn
   * @param {number} vorarbeitRequired - Jahresziel für Vorarbeit
   * @returns {Promise<{ ueZ1: number, vorarbeitBalance: number }>}
   */
  async function computeMonthUeZ1AndVorarbeit(
    payload,
    year,
    monthIndex,
    userId,
    vorarbeitBalanceIn,
    vorarbeitRequired
  ) {
    const daysObj =
      payload?.days && typeof payload.days === 'object' ? payload.days : {};

    const monthStartKey = formatDateKey(new Date(year, monthIndex, 1));
    const monthEndKey = formatDateKey(new Date(year, monthIndex + 1, 0));
    const acceptedAbsenceDays = buildAcceptedAbsenceHoursMap(
      payload?.absences,
      monthStartKey,
      monthEndKey
    );

    const cachedEmpStartKey = await fetchEmpStartKey(userId);
    let ueZ1 = 0;
    let vorarbeit = vorarbeitBalanceIn;

    const cursor = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 0);

    while (cursor <= end) {
      const dateKey = formatDateKey(cursor);
      const weekday = cursor.getDay();
      cursor.setDate(cursor.getDate() + 1);

      if (weekday === 0 || weekday === 6) continue;

      const { soll, employmentPct } = await getDailySoll(
        userId,
        dateKey,
        acceptedAbsenceDays,
        cachedEmpStartKey
      );
      if (soll === 0) continue;

      const dayData = daysObj[dateKey] || null;
      const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
      const isFerien = !!dayData?.flags?.ferien;

      const absHoursForDay =
        typeof acceptedAbsenceDays.get(dateKey) === 'number'
          ? acceptedAbsenceDays.get(dateKey)
          : 0;
      const baseSoll = soll + absHoursForDay;

      let diff = 0;
      if (isFerien) {
        diff = dayTotal > soll ? dayTotal - soll : 0;
      } else if (dayTotal > baseSoll) {
        diff = dayTotal - baseSoll;
      } else {
        diff = Math.min(dayTotal + absHoursForDay, baseSoll) - baseSoll;
      }

      if (diff <= 0) {
        ueZ1 += diff;
      } else {
        const schwelle = round1(0.5 * (employmentPct / 100));
        const inVorarbeit = Math.min(diff, schwelle);
        const inUeZ1 = round1(diff - inVorarbeit);

        if (vorarbeit < vorarbeitRequired) {
          const actual = round1(
            Math.min(inVorarbeit, vorarbeitRequired - vorarbeit)
          );
          const leftover = round1(inVorarbeit - actual);
          vorarbeit = round1(vorarbeit + actual);
          ueZ1 += leftover;
        } else {
          ueZ1 += inVorarbeit;
        }
        ueZ1 += inUeZ1;
      }
    }

    return { ueZ1: round1(ueZ1), vorarbeitBalance: round1(vorarbeit) };
  }

  /**
   * Berechnet ÜZ1 und Vorarbeit für eine beliebige Date-Range.
   * Wird für Lohnperioden verwendet die nicht auf Monatsgrenzen fallen.
   *
   * @param {object} submission - Submission-Payload
   * @param {string} fromKey - YYYY-MM-DD
   * @param {string} toKey - YYYY-MM-DD
   * @param {string} userId
   * @param {number} vorarbeitBalanceIn
   * @param {number} vorarbeitRequired
   * @returns {Promise<{ ueZ1Raw: number, ueZ1Net: number, vorarbeitBalance: number }>}
   */
  async function computeRangeUeZ1AndVorarbeit(
    submission,
    fromKey,
    toKey,
    userId,
    vorarbeitBalanceIn,
    vorarbeitRequired
  ) {
    const daysObj =
      submission?.days && typeof submission.days === 'object'
        ? submission.days
        : {};

    const acceptedAbsenceDays = buildAcceptedAbsenceHoursMap(
      submission?.absences,
      fromKey,
      toKey
    );

    const cachedEmpStartKey = await fetchEmpStartKey(userId);
    let ueZ1 = 0;
    let ueZ1Raw = 0;
    let vorarbeit = vorarbeitBalanceIn;

    const cursor = new Date(fromKey + 'T00:00:00');
    const end = new Date(toKey + 'T00:00:00');

    while (cursor <= end) {
      const dateKey = formatDateKey(cursor);
      const weekday = cursor.getDay();
      cursor.setDate(cursor.getDate() + 1);

      if (weekday === 0 || weekday === 6) continue;

      const { soll, employmentPct } = await getDailySoll(
        userId,
        dateKey,
        acceptedAbsenceDays,
        cachedEmpStartKey
      );
      if (soll === 0) continue;

      const dayData = daysObj[dateKey] || null;
      const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
      const isFerien = !!dayData?.flags?.ferien;

      const absHoursForDay =
        typeof acceptedAbsenceDays.get(dateKey) === 'number'
          ? acceptedAbsenceDays.get(dateKey)
          : 0;
      const baseSoll = soll + absHoursForDay;

      let diff = 0;
      if (isFerien) {
        diff = dayTotal > soll ? dayTotal - soll : 0;
      } else if (dayTotal > baseSoll) {
        diff = dayTotal - baseSoll;
      } else {
        diff = Math.min(dayTotal + absHoursForDay, baseSoll) - baseSoll;
      }

      ueZ1Raw += diff;

      if (diff <= 0) {
        ueZ1 += diff;
      } else {
        const schwelle = round1(0.5 * (employmentPct / 100));
        const inVorarbeit = Math.min(diff, schwelle);
        const inUeZ1 = round1(diff - inVorarbeit);

        if (vorarbeit < vorarbeitRequired) {
          const actual = round1(
            Math.min(inVorarbeit, vorarbeitRequired - vorarbeit)
          );
          ueZ1 += round1(inVorarbeit - actual);
          vorarbeit = round1(vorarbeit + actual);
        } else {
          ueZ1 += inVorarbeit;
        }
        ueZ1 += inUeZ1;
      }
    }

    return {
      ueZ1Raw: round1(ueZ1Raw),
      ueZ1Net: round1(ueZ1),
      vorarbeitBalance: round1(vorarbeit),
    };
  }

  /**
   * Berechnet ÜZ1/ÜZ2/ÜZ3 aus einer Submission für einen Lohnperioden-Ausschnitt.
   * Wird in buildPayrollPeriodDataForUser für jeden Monat aufgerufen.
   *
   * @param {object} submission
   * @param {string} fromKey
   * @param {string} toKey
   * @param {string} userId
   * @returns {Promise<{ ueZ1Raw: number, ueZ1Positive: number, ueZ2: number, ueZ3: number }>}
   */
  async function computePayrollPeriodOvertimeFromSubmission(
    submission,
    fromKey,
    toKey,
    userId
  ) {
    const daysObj =
      submission?.days && typeof submission.days === 'object'
        ? submission.days
        : {};

    const cachedEmpStartKey = await fetchEmpStartKey(userId);
    let ueZ1Raw = 0;
    let ueZ1Positive = 0;
    let ueZ2 = 0;
    let ueZ3 = 0;

    const acceptedAbsenceDays = buildAcceptedAbsenceHoursMap(
      submission?.absences,
      fromKey,
      toKey
    );

    const cursor = new Date(fromKey + 'T00:00:00');
    const end = new Date(toKey + 'T00:00:00');

    while (cursor <= end) {
      const dateKey = formatDateKey(cursor);
      const weekday = cursor.getDay();
      cursor.setDate(cursor.getDate() + 1);

      if (weekday === 0 || weekday === 6) continue;

      const { soll } = await getDailySoll(
        userId,
        dateKey,
        acceptedAbsenceDays,
        cachedEmpStartKey
      );
      if (soll === 0) continue;

      const dayData = daysObj[dateKey] || null;
      const dayTotal = dayData ? computeDailyWorkingHours(dayData) : 0;
      const isFerien = !!dayData?.flags?.ferien;

      const absHoursForDay =
        typeof acceptedAbsenceDays.get(dateKey) === 'number'
          ? acceptedAbsenceDays.get(dateKey)
          : 0;
      const baseSoll = soll + absHoursForDay;

      let diff = 0;
      if (isFerien) {
        diff = dayTotal > soll ? dayTotal - soll : 0;
      } else if (dayTotal > baseSoll) {
        diff = dayTotal - baseSoll;
      } else {
        diff = Math.min(dayTotal + absHoursForDay, baseSoll) - baseSoll;
      }

      ueZ1Raw += diff;
      if (diff > 0) ueZ1Positive += diff;
    }

    // Pikett
    const pikettList = Array.isArray(submission?.pikett)
      ? submission.pikett
      : [];
    for (const entry of pikettList) {
      const dateKey = String(entry?.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      if (dateKey < fromKey || dateKey > toKey) continue;
      const h = toNumber(entry?.hours);
      if (entry?.isOvertime3) ueZ3 += h;
      else ueZ2 += h;
    }

    return {
      ueZ1Raw: round1(ueZ1Raw),
      ueZ1Positive: round1(ueZ1Positive),
      ueZ2: round1(ueZ2),
      ueZ3: round1(ueZ3),
    };
  }

  return {
    computeMonthUeZ1AndVorarbeit,
    computeRangeUeZ1AndVorarbeit,
    computePayrollPeriodOvertimeFromSubmission,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Pure
  buildMonthOverviewFromSubmission,

  // Factory
  createComputeAsyncService,
};
