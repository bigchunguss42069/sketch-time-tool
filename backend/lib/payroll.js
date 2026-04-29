'use strict';

/**
 * @fileoverview Lohnabrechnung — Berechnung und Routes
 *
 * Enthält:
 * - getPayrollAbsenceTypeLabel  — Absenz-Typ → lesbares Label
 * - ensurePayrollAuditRow       — Audit-Zeilenstruktur initialisieren
 * - buildPayrollPeriodDataForUser — Kernberechnung für eine Lohnperiode
 * - registerPayrollRoutes        — GET /api/admin/payroll-period, /api/admin/payroll-export-pdf
 *
 * Abhängigkeiten:
 * - db (über Factory)
 * - computeRangeUeZ1, computePayrollPeriodOvertimeFromSubmission (compute-async.js)
 * - loadLatestMonthSubmission (submissions.js)
 * - createPdfHelpers, fmtHours, fmtSignedHours, fmtCount (pdf-helpers.js)
 *
 * Pattern: createPayrollService(db, deps) gibt alle Funktionen zurück.
 */

const PDFDocument = require('pdfkit');
const {
  formatDateKey,
  formatDateDisplayEU,
  getMonthRangeBetween,
  parseIsoDateOnly,
  isWeekdayDateKey,
  isDateKeyInClosedRange,
} = require('./holidays');
const {
  round1,
  toNumber,
  computeAbsenceDaysInPeriod,
  computeNetWorkingHoursFromStamps,
} = require('./compute');
const { getPayrollYearConfig } = require('./constants');
const {
  createPdfHelpers,
  fmtHours,
  fmtSignedHours,
  fmtCount,
} = require('./pdf-helpers');

// ─────────────────────────────────────────────────────────────────────────────
// Pure Hilfsfunktionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Konvertiert einen Absenz-Typ-Key in ein lesbares Label.
 *
 * @param {string} type
 * @returns {string}
 */
function getPayrollAbsenceTypeLabel(type) {
  const key = String(type || '')
    .trim()
    .toLowerCase();
  const map = {
    ferien: 'Ferien',
    unfall: 'Unfall',
    militaer: 'Militär',
    bezahlteabwesenheit: 'Bezahlte Abwesenheit',
    vaterschaft: 'Vaterschaftsurlaub',
    sonstiges: 'Sonstiges',
  };
  return (
    map[key] ||
    (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Abwesenheit')
  );
}

/**
 * Stellt sicher dass eine Audit-Zeile für einen Tag in der Map existiert.
 *
 * @param {Map} rowMap
 * @param {string} dateKey
 * @returns {object} Audit-Zeile
 */
function ensurePayrollAuditRow(rowMap, dateKey) {
  if (!rowMap.has(dateKey)) {
    rowMap.set(dateKey, {
      dateKey,
      stunden: 0,
      praesenzStunden: 0,
      ferien: false,
      morgenessen: false,
      mittagessen: false,
      abendessen: false,
      schmutzzulage: false,
      nebenauslagen: false,
      pikettHours: 0,
      overtime3Hours: 0,
      absenceLabels: [],
      stamps: [],
    });
  }
  return rowMap.get(dateKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt alle Payroll-Funktionen mit DB-Zugriff.
 *
 * @param {import('pg').Pool} db
 * @param {{ computeRangeUeZ1, computePayrollPeriodOvertimeFromSubmission, loadLatestMonthSubmission, aggregatePayrollFromSubmission }} deps
 * @returns {object}
 */
function createPayrollService(
  db,
  {
    computeRangeUeZ1,
    computePayrollPeriodOvertimeFromSubmission,
    loadLatestMonthSubmission,
    aggregatePayrollFromSubmission,
  }
) {
  /**
   * Berechnet alle Lohnperioden-Daten für einen User.
   * Entspricht exakt dem Transmit-Algorithmus — keine separaten YTD-Loops.
   *
   * @param {{ id: string, username: string, teamId: string|null }} user
   * @param {Date} periodStart
   * @param {Date} periodEnd
   * @returns {Promise<object>}
   */
  async function buildPayrollPeriodDataForUser(user, periodStart, periodEnd) {
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

    const fromKey = formatDateKey(periodStart);
    const toKey = formatDateKey(periodEnd);
    const monthRange = getMonthRangeBetween(periodStart, periodEnd);

    const absencesById = new Map();
    const auditRowMap = new Map();

    const totals = {
      praesenzStunden: 0,
      morgenessenCount: 0,
      mittagessenCount: 0,
      abendessenCount: 0,
      schmutzzulageCount: 0,
      nebenauslagenCount: 0,
      pikettHours: 0,
      ueZ3Hours: 0,
      ferienDays: 0,
      stunden: 0,
      arztKrankHours: 0,
    };

    const overtime = { ueZ1Raw: 0, ueZ2: 0, ueZ3: 0 };

    const selectedYear = periodEnd.getFullYear();
    const yearCfg = getPayrollYearConfig(selectedYear);

    let ueZ1Net = 0;
    let ueZ1RawTotal = 0;

    const transmittedMonths = [];
    const missingMonths = [];
    const submissionCache = new Map();

    for (const month of monthRange) {
      const submission = await loadLatestMonthSubmission(
        user.username,
        month.year,
        month.monthIndex
      );

      if (!submission) {
        missingMonths.push(month.monthKey);
        continue;
      }

      transmittedMonths.push(month.monthKey);
      submissionCache.set(month.monthKey, submission);

      const partial = aggregatePayrollFromSubmission(
        submission,
        fromKey,
        toKey,
        absencesById
      );

      const monthStartKey = formatDateKey(
        new Date(month.year, month.monthIndex, 1)
      );
      const monthEndKey = formatDateKey(
        new Date(month.year, month.monthIndex + 1, 0)
      );
      const clippedFrom = fromKey > monthStartKey ? fromKey : monthStartKey;
      const clippedTo = toKey < monthEndKey ? toKey : monthEndKey;

      const partialOvertime = await computePayrollPeriodOvertimeFromSubmission(
        submission,
        clippedFrom,
        clippedTo,
        user.id
      );

      const { ueZ1Raw: rangeRaw, ueZ1Net: rangeNet } = await computeRangeUeZ1(
        submission,
        clippedFrom,
        clippedTo,
        user.id
      );

      ueZ1Net = r1(ueZ1Net + rangeNet);
      ueZ1RawTotal = r1(ueZ1RawTotal + rangeRaw);

      totals.praesenzStunden += partial.praesenzStunden;
      totals.ueZ3Hours += partial.ueZ3Hours;
      totals.morgenessenCount += partial.morgenessenCount;
      totals.mittagessenCount += partial.mittagessenCount;
      totals.abendessenCount += partial.abendessenCount;
      totals.schmutzzulageCount += partial.schmutzzulageCount;
      totals.nebenauslagenCount += partial.nebenauslagenCount;
      totals.pikettHours += partial.pikettHours;
      overtime.ueZ2 += partialOvertime.ueZ2;
      overtime.ueZ3 += partialOvertime.ueZ3;

      const daysObj =
        submission?.days && typeof submission.days === 'object'
          ? submission.days
          : {};

      for (const [dateKey, dayData] of Object.entries(daysObj)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
        if (dateKey < fromKey || dateKey > toKey) continue;
        if (!dayData || typeof dayData !== 'object') continue;

        const row = ensurePayrollAuditRow(auditRowMap, dateKey);

        if (Array.isArray(dayData.stamps) && dayData.stamps.length > 0) {
          row.praesenzStunden += num(
            computeNetWorkingHoursFromStamps(dayData.stamps)
          );
          const sorted = [...dayData.stamps].sort((a, b) =>
            String(a.time || '').localeCompare(String(b.time || ''))
          );
          row.stamps = sorted.map((s) => ({ time: s.time, type: s.type }));
        }

        const meal = dayData.mealAllowance || {};
        const flags = dayData.flags || {};
        if (meal['1']) row.morgenessen = true;
        if (meal['2']) row.mittagessen = true;
        if (meal['3']) row.abendessen = true;
        if (flags.schmutzzulage) row.schmutzzulage = true;
        if (flags.nebenauslagen) row.nebenauslagen = true;
      }

      const pikettList = Array.isArray(submission?.pikett)
        ? submission.pikett
        : [];
      for (const entry of pikettList) {
        const dateKey = String(entry?.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
        if (dateKey < fromKey || dateKey > toKey) continue;
        const row = ensurePayrollAuditRow(auditRowMap, dateKey);
        const h = num(entry?.hours);
        if (entry?.isOvertime3) row.overtime3Hours += h;
        else row.pikettHours += h;
      }

      const absences = Array.isArray(submission?.absences)
        ? submission.absences
        : [];
      for (const abs of absences) {
        const id = abs?.id
          ? String(abs.id)
          : [abs?.type, abs?.from, abs?.to, abs?.comment].join('|');
        if (!absencesById.has(id)) absencesById.set(id, abs);
      }
    }

    // Absenzen in Audit-Rows eintragen
    for (const abs of absencesById.values()) {
      const type = String(abs?.type || '')
        .trim()
        .toLowerCase();
      const status = String(abs?.status || '')
        .trim()
        .toLowerCase();

      if (type === 'ferien' && status === 'accepted') {
        totals.ferienDays += computeAbsenceDaysInPeriod(
          abs,
          periodStart,
          periodEnd
        );
      }

      if (status !== 'accepted') continue;
      if (!abs?.from || !abs?.to) continue;

      const labelBase = getPayrollAbsenceTypeLabel(abs.type);
      const comment = String(abs.comment || '').trim();
      const label = comment ? `${labelBase} – ${comment}` : labelBase;

      const { parseIsoDateOnly: parseDate } = require('./holidays');
      const fromAbs = parseDate(abs.from);
      const toAbs = parseDate(abs.to);
      if (!fromAbs || !toAbs) continue;

      const start = fromAbs <= toAbs ? fromAbs : toAbs;
      const end = fromAbs <= toAbs ? toAbs : fromAbs;
      const overlapStart = start > periodStart ? start : periodStart;
      const overlapEnd = end < periodEnd ? end : periodEnd;

      if (overlapEnd < overlapStart) continue;

      const cursor = new Date(overlapStart);
      while (cursor <= overlapEnd) {
        const dk = formatDateKey(cursor);
        if (isWeekdayDateKey(dk)) {
          const row = ensurePayrollAuditRow(auditRowMap, dk);
          if (!row.absenceLabels.includes(label)) row.absenceLabels.push(label);
          if (type === 'ferien') row.ferien = true;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    totals.stunden = r1(totals.stunden);
    totals.arztKrankHours = r1(totals.arztKrankHours);
    totals.ferienDays = r1(totals.ferienDays);
    totals.pikettHours = r1(totals.pikettHours);

    overtime.ueZ1Raw = r1(ueZ1RawTotal);
    overtime.ueZ2 = r1(overtime.ueZ2);
    overtime.ueZ3 = r1(overtime.ueZ3);

    const auditRows = Array.from(auditRowMap.values())
      .map((row) => ({
        dateKey: row.dateKey,
        dateLabel: formatDateDisplayEU(row.dateKey),
        praesenzStunden: r1(row.praesenzStunden),
        ferien: !!row.ferien,
        morgenessen: !!row.morgenessen,
        mittagessen: !!row.mittagessen,
        abendessen: !!row.abendessen,
        schmutzzulage: !!row.schmutzzulage,
        nebenauslagen: !!row.nebenauslagen,
        pikettHours: r1(row.pikettHours),
        overtime3Hours: r1(row.overtime3Hours),
        absenceLabels: row.absenceLabels || [],
        absencesText: (row.absenceLabels || []).join(' | '),
        stamps: row.stamps || [],
      }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    // Korrekturen aus Konten
    const kontoRes = await db.query(
      `SELECT ue_z1_correction, ue_z2_correction, ue_z3_correction
       FROM konten WHERE username = $1`,
      [user.username]
    );
    const kontoRow = kontoRes.rows[0] || {};
    const ueZ1Correction = r1(Number(kontoRow.ue_z1_correction) || 0);
    const ueZ2Correction = r1(Number(kontoRow.ue_z2_correction) || 0);
    const ueZ3Correction = r1(Number(kontoRow.ue_z3_correction) || 0);

    // Absenzen direkt aus DB
    const dbAbsResult = await db.query(
      `SELECT type, from_date, to_date, days, hours
       FROM absences
       WHERE username = $1 AND status = 'accepted'
         AND to_date >= $2 AND from_date <= $3
       ORDER BY from_date ASC`,
      [user.username, fromKey, toKey]
    );

    const absencesByType = {};
    for (const row of dbAbsResult.rows) {
      const type = String(row.type || '').toLowerCase();
      if (!absencesByType[type]) absencesByType[type] = { days: 0, hours: 0 };
      const days = computeAbsenceDaysInPeriod(
        {
          from: formatDateKey(new Date(row.from_date)),
          to: formatDateKey(new Date(row.to_date)),
          days: row.days,
        },
        periodStart,
        periodEnd
      );
      absencesByType[type].days = round1(absencesByType[type].days + days);
      if (row.hours) {
        absencesByType[type].hours = round1(
          absencesByType[type].hours + toNumber(row.hours)
        );
      }
    }

    return {
      username: user.username,
      displayName: user.username,
      coverage: {
        expectedMonths: monthRange.map((m) => m.monthKey),
        transmittedMonths,
        missingMonths,
      },
      totals,
      absencesByType,
      overtime: {
        ueZ1Raw: overtime.ueZ1Raw,
        ueZ1Correction,
        ueZ1Total: r1(overtime.ueZ1Raw + ueZ1Correction),

        ueZ2: overtime.ueZ2,
        ueZ2Correction,
        ueZ2Total: r1(overtime.ueZ2 + ueZ2Correction),
        ueZ3: overtime.ueZ3,
        ueZ3Correction,
        ueZ3Total: r1(overtime.ueZ3 + ueZ3Correction),
      },

      teamId: user.teamId || null,
      auditRows,
    };
  }

  // Core payroll aggregation for one transmitted submission inside a selected period.
  function aggregatePayrollFromSubmission(
    submission,
    fromKey,
    toKey,
    absencesById
  ) {
    const result = {
      praesenzStunden: 0,
      morgenessenCount: 0,
      mittagessenCount: 0,
      abendessenCount: 0,
      schmutzzulageCount: 0,
      nebenauslagenCount: 0,
      pikettHours: 0,
      ueZ3Hours: 0,
      ferienDays: 0,
      stunden: 0,
      arztKrankHours: 0,
    };

    const daysObj =
      submission?.days && typeof submission.days === 'object'
        ? submission.days
        : {};

    for (const [dateKey, dayData] of Object.entries(daysObj)) {
      if (!isDateKeyInClosedRange(dateKey, fromKey, toKey)) continue;
      if (!dayData || typeof dayData !== 'object') continue;

      // Präsenzstunden aus Stamps
      if (Array.isArray(dayData.stamps) && dayData.stamps.length > 0) {
        result.praesenzStunden += computeNetWorkingHoursFromStamps(
          dayData.stamps
        );
      }

      // Mahlzeiten
      const meal = dayData.mealAllowance || {};
      if (meal['1']) result.morgenessenCount += 1;
      if (meal['2']) result.mittagessenCount += 1;
      if (meal['3']) result.abendessenCount += 1;

      // Zulagen
      const flags = dayData.flags || {};
      if (flags.schmutzzulage) result.schmutzzulageCount += 1;
      if (flags.nebenauslagen) result.nebenauslagenCount += 1;
    }

    // Pikett ÜZ2 + ÜZ3
    const pikettList = Array.isArray(submission?.pikett)
      ? submission.pikett
      : [];
    for (const entry of pikettList) {
      const dateKey = String(entry?.date || '').slice(0, 10);
      if (!isDateKeyInClosedRange(dateKey, fromKey, toKey)) continue;
      const h = toNumber(entry?.hours);
      if (entry?.isOvertime3) result.ueZ3Hours += h;
      else result.pikettHours += h;
    }

    // Absenzen aus Submission für absencesById sammeln (unverändert)
    const absences = Array.isArray(submission?.absences)
      ? submission.absences
      : [];
    for (const abs of absences) {
      const id = abs?.id
        ? String(abs.id)
        : [
            String(abs?.type || ''),
            String(abs?.from || ''),
            String(abs?.to || ''),
            String(abs?.comment || ''),
          ].join('|');
      if (!absencesById.has(id)) absencesById.set(id, abs);
    }

    result.praesenzStunden = round1(result.praesenzStunden);
    result.pikettHours = round1(result.pikettHours);
    result.ueZ3Hours = round1(result.ueZ3Hours);

    return result;
  }

  // Preserve already-locked day payloads during retransmission of the same month.
  function mergeLockedWeeksPayload(
    newPayload,
    previousSubmission,
    lockedDateKeys
  ) {
    const merged = { ...newPayload };

    // 1) days: locked dates are taken from previous submission (or removed if absent)
    const newDays =
      merged.days && typeof merged.days === 'object' ? { ...merged.days } : {};
    const oldDays =
      previousSubmission &&
      previousSubmission.days &&
      typeof previousSubmission.days === 'object'
        ? previousSubmission.days
        : {};

    lockedDateKeys.forEach((dk) => {
      if (Object.prototype.hasOwnProperty.call(oldDays, dk)) {
        newDays[dk] = oldDays[dk];
      } else {
        delete newDays[dk];
      }
    });

    merged.days = newDays;

    // 2) pikett: locked dates are taken from previous submission
    const newPikett = Array.isArray(merged.pikett) ? merged.pikett : [];
    const oldPikett = Array.isArray(previousSubmission?.pikett)
      ? previousSubmission.pikett
      : [];

    merged.pikett = [
      ...newPikett.filter((p) => p && p.date && !lockedDateKeys.has(p.date)),
      ...oldPikett.filter((p) => p && p.date && lockedDateKeys.has(p.date)),
    ];

    // 3) absences: if an absence overlaps locked dates, keep the previous version
    const newAbs = Array.isArray(merged.absences) ? merged.absences : [];
    const oldAbs = Array.isArray(previousSubmission?.absences)
      ? previousSubmission.absences
      : [];

    const keptNew = newAbs.filter(
      (a) => !absenceOverlapsLockedDates(a, lockedDateKeys)
    );
    const keptOld = oldAbs.filter((a) =>
      absenceOverlapsLockedDates(a, lockedDateKeys)
    );

    // de-dupe by id (old should override for locked overlaps)
    const byId = new Map();
    keptNew.forEach((a) => {
      const id = a && a.id ? String(a.id) : null;
      if (id) byId.set(id, a);
    });
    keptOld.forEach((a) => {
      const id = a && a.id ? String(a.id) : null;
      if (id) byId.set(id, a);
    });

    // include id-less entries (rare) at the end
    const idless = [...keptNew, ...keptOld].filter((a) => !(a && a.id));

    merged.absences = [...byId.values(), ...idless];

    return merged;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Routes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Registriert alle Payroll-Routes.
   *
   * @param {import('express').Application} app
   * @param {import('express').RequestHandler} requireAuth
   * @param {import('express').RequestHandler} requireAdmin
   * @param {Function} listUsersFromDb
   * @param {Function} findUserByUsername
   */
  function registerPayrollRoutes(
    app,
    requireAuth,
    requireAdmin,
    listUsersFromDb,
    findUserByUsername
  ) {
    // GET /api/admin/payroll-period
    app.get(
      '/api/admin/payroll-period',
      requireAuth,
      requireAdmin,
      async (req, res) => {
        const fromDate = parseIsoDateOnly(
          String(req.query?.from || '').slice(0, 10)
        );
        const toDate = parseIsoDateOnly(
          String(req.query?.to || '').slice(0, 10)
        );

        if (!fromDate || !toDate) {
          return res
            .status(400)
            .json({ ok: false, error: 'Ungültiger Zeitraum.' });
        }

        const periodStart = fromDate <= toDate ? fromDate : toDate;
        const periodEnd = fromDate <= toDate ? toDate : fromDate;

        try {
          const users = await listUsersFromDb({ role: 'user' });
          const rows = await Promise.all(
            users.map((user) =>
              buildPayrollPeriodDataForUser(user, periodStart, periodEnd)
            )
          );

          return res.json({
            ok: true,
            period: {
              from: formatDateKey(periodStart),
              to: formatDateKey(periodEnd),
            },
            summary: {
              usersCount: rows.length,
              completeUsers: rows.filter(
                (r) => r.coverage.missingMonths.length === 0
              ).length,
              incompleteUsers: rows.filter(
                (r) => r.coverage.missingMonths.length > 0
              ).length,
            },
            rows,
          });
        } catch (err) {
          console.error('Failed to build payroll period', err);
          return res
            .status(500)
            .json({ ok: false, error: 'Could not build payroll period' });
        }
      }
    );

    // GET /api/admin/payroll-export-pdf
    app.get(
      '/api/admin/payroll-export-pdf',
      requireAuth,
      requireAdmin,
      async (req, res) => {
        const username = String(req.query?.username || '').trim();
        const fromDate = parseIsoDateOnly(
          String(req.query?.from || '').slice(0, 10)
        );
        const toDate = parseIsoDateOnly(
          String(req.query?.to || '').slice(0, 10)
        );

        if (!username)
          return res
            .status(400)
            .json({ ok: false, error: 'Benutzername fehlt.' });
        if (!fromDate || !toDate)
          return res
            .status(400)
            .json({ ok: false, error: 'Ungültiger Zeitraum.' });

        const periodStart = fromDate <= toDate ? fromDate : toDate;
        const periodEnd = fromDate <= toDate ? toDate : fromDate;

        try {
          const targetUser = await findUserByUsername(username);
          if (!targetUser || targetUser.role !== 'user') {
            return res
              .status(404)
              .json({ ok: false, error: 'Mitarbeiter nicht gefunden.' });
          }

          const row = await buildPayrollPeriodDataForUser(
            targetUser,
            periodStart,
            periodEnd
          );
          const safeUser = String(targetUser.username).replace(
            /[^a-zA-Z0-9_-]+/g,
            '_'
          );
          const filename = `Lohnabrechnung_${safeUser}_${formatDateKey(periodStart)}_${formatDateKey(periodEnd)}.pdf`;

          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${filename}"`
          );

          const doc = new PDFDocument({
            margin: 42,
            size: 'A4',
            info: {
              Title: `Lohnabrechnung ${targetUser.username}`,
              Author: 'Hours App',
            },
          });
          doc.pipe(res);

          const { ensurePdfSpace, sectionTitle, writeMetricLines } =
            createPdfHelpers(doc);

          doc
            .font('Helvetica-Bold')
            .fontSize(16)
            .text('Lohnabrechnung – Audit Export');
          doc.moveDown(0.4);
          doc
            .font('Helvetica')
            .fontSize(9)
            .text(`Mitarbeiter: ${row.displayName}`);
          doc.text(
            `Zeitraum: ${formatDateDisplayEU(formatDateKey(periodStart))} – ${formatDateDisplayEU(formatDateKey(periodEnd))}`
          );
          doc.text(`Exportiert am: ${new Date().toLocaleString('de-DE')}`);
          doc.text(`Exportiert von: ${req.user.username}`);
          doc.text('Hinweis: Nur übertragene Daten berücksichtigt.');

          sectionTitle('Lohndaten im Zeitraum');
          writeMetricLines([
            ['Präsenz', fmtHours(row.totals.praesenzStunden)],
            ['Pikett', fmtHours(row.totals.pikettHours)],
            ['ÜZ3 Wochenende', fmtHours(row.totals.ueZ3Hours)],
            ['Morgenessen', fmtCount(row.totals.morgenessenCount)],
            ['Mittagessen', fmtCount(row.totals.mittagessenCount)],
            ['Abendessen', fmtCount(row.totals.abendessenCount)],
            ['Schmutzzulage', fmtCount(row.totals.schmutzzulageCount)],
            ['Nebenauslagen', fmtCount(row.totals.nebenauslagenCount)],
          ]);

          if (
            row.absencesByType &&
            Object.keys(row.absencesByType).length > 0
          ) {
            sectionTitle('Absenzen im Zeitraum');
            const TYPE_LABELS = {
              ferien: 'Ferien',
              krank: 'Krank / Arztbesuch',
              unfall: 'Unfall',
              militaer: 'Militär',
              mutterschaft: 'Mutterschaft',
              vaterschaft: 'Vaterschaftsurlaub',
              bezahlteabwesenheit: 'Bezahlte Abwesenheit',
              sonstiges: 'Sonstiges',
            };
            const absLines = Object.entries(row.absencesByType)
              .filter(([, d]) => d.days > 0 || d.hours > 0)
              .map(([type, d]) => [
                TYPE_LABELS[type] || type,
                d.hours > 0 ? `${d.days}d / ${d.hours}h` : `${d.days}d`,
              ]);
            if (absLines.length > 0) writeMetricLines(absLines);
          }

          sectionTitle('Überzeit in dieser Lohnperiode');
          const overtimeLines = [
            ['ÜZ1', fmtSignedHours(row.overtime.ueZ1Raw)],
            ['ÜZ2', fmtSignedHours(row.overtime.ueZ2)],
            ['ÜZ3', fmtSignedHours(row.overtime.ueZ3)],
          ];
          if (row.overtime.ueZ1Correction !== 0) {
            overtimeLines.push([
              'ÜZ1 Korrektur (Admin)',
              fmtSignedHours(row.overtime.ueZ1Correction),
            ]);
            overtimeLines.push([
              'ÜZ1 Total (inkl. Korrektur)',
              fmtSignedHours(row.overtime.ueZ1Total),
            ]);
          }
          if (row.overtime.ueZ2Correction !== 0) {
            overtimeLines.push([
              'ÜZ2 Korrektur (Admin)',
              fmtSignedHours(row.overtime.ueZ2Correction),
            ]);
            overtimeLines.push([
              'ÜZ2 Total',
              fmtSignedHours(row.overtime.ueZ2Total),
            ]);
          }
          if (row.overtime.ueZ3Correction !== 0) {
            overtimeLines.push([
              'ÜZ3 Korrektur (Admin)',
              fmtSignedHours(row.overtime.ueZ3Correction),
            ]);
            overtimeLines.push([
              'ÜZ3 Total',
              fmtSignedHours(row.overtime.ueZ3Total),
            ]);
          }
          writeMetricLines(overtimeLines);

          sectionTitle('Berücksichtigte Übertragungen');
          writeMetricLines([
            [
              'Monate berücksichtigt',
              (row.coverage.transmittedMonths || []).join(', ') || '–',
            ],
            [
              'Monate fehlend',
              (row.coverage.missingMonths || []).join(', ') || '–',
            ],
          ]);

          sectionTitle('Tagesdetails');
          if (!row.auditRows.length) {
            doc
              .font('Helvetica')
              .fontSize(9)
              .text('Keine relevanten Einträge im ausgewählten Zeitraum.');
          } else {
            row.auditRows.forEach((entry) => {
              ensurePdfSpace(54);
              doc.font('Helvetica-Bold').fontSize(9).text(entry.dateLabel);

              if (entry.stamps && entry.stamps.length > 0) {
                const pairs = [];
                const sorted = [...entry.stamps];
                for (let i = 0; i < sorted.length - 1; i++) {
                  if (sorted[i].type === 'in' && sorted[i + 1].type === 'out') {
                    pairs.push(`${sorted[i].time}–${sorted[i + 1].time}`);
                    i++;
                  }
                }
                doc
                  .font('Helvetica')
                  .fontSize(8)
                  .fillColor('#555555')
                  .text(
                    `Stempel: ${pairs.length > 0 ? pairs.join('  |  ') : '–'}`
                  )
                  .fillColor('#000000');
              }

              doc
                .font('Helvetica')
                .fontSize(8.5)
                .text(
                  `Präsenz: ${fmtHours(entry.praesenzStunden)}   |   Ferien: ${entry.ferien ? 'Ja' : 'Nein'}`
                )
                .text(
                  `Morgenessen: ${entry.morgenessen ? 'Ja' : 'Nein'}   |   Mittagessen: ${entry.mittagessen ? 'Ja' : 'Nein'}   |   Abendessen: ${entry.abendessen ? 'Ja' : 'Nein'}`
                )
                .text(
                  `Schmutzzulage: ${entry.schmutzzulage ? 'Ja' : 'Nein'}   |   Nebenauslagen: ${entry.nebenauslagen ? 'Ja' : 'Nein'}`
                )
                .text(
                  `Pikett: ${fmtHours(entry.pikettHours)}   |   ÜZ3: ${fmtHours(entry.overtime3Hours)}`
                );

              if (entry.absencesText)
                doc.text(`Abwesenheiten: ${entry.absencesText}`);
              doc.moveDown(0.35);
            });
          }

          doc.end();
        } catch (err) {
          console.error('Failed to export payroll PDF', err);
          return res
            .status(500)
            .json({ ok: false, error: 'PDF export failed' });
        }
      }
    );
  }

  return { buildPayrollPeriodDataForUser, registerPayrollRoutes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  getPayrollAbsenceTypeLabel,
  ensurePayrollAuditRow,
  createPayrollService,
};
