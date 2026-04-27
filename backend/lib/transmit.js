'use strict';

/**
 * @fileoverview Monatsübertragung — Transmit-Logik und Auto-Transmit
 *
 * Enthält:
 * - aggregatePayrollFromSubmission  — Summiert Präsenz/Mahlzeiten/Zulagen
 * - mergeLockedWeeksPayload         — Gesperrte Wochen aus altem Payload übernehmen
 * - autoTransmitForUser             — Cron-Job: Automatischer Transmit 02:00
 * - registerTransmitRoutes          — POST /api/transmit-month, GET /api/transmissions
 *
 * Pattern: createTransmitService(db, deps) gibt alle Funktionen zurück.
 */

const {
  formatDateKey,
  makeMonthLabel,
  getMonthRangeBetween,
} = require('./holidays');

const {
  toNumber,
  computeNetWorkingHoursFromStamps,
  computeTransmissionTotals,
} = require('./compute');

// ─────────────────────────────────────────────────────────────────────────────
// Pure Hilfsfunktionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Summiert Präsenzstunden, Mahlzeiten und Zulagen aus einer Submission
 * für einen bestimmten Zeitraum. Wird in buildPayrollPeriodDataForUser verwendet.
 *
 * @param {object} submission - Submission-Payload
 * @param {string} fromKey - YYYY-MM-DD
 * @param {string} toKey - YYYY-MM-DD
 * @param {Map} [absencesById] - Akkumulator für Absenzen (optional)
 * @returns {{ praesenzStunden, morgenessenCount, mittagessenCount, abendessenCount, schmutzzulageCount, nebenauslagenCount, pikettHours, ueZ3Hours }}
 */
function aggregatePayrollFromSubmission(
  submission,
  fromKey,
  toKey,
  absencesById
) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  let praesenzStunden = 0;
  let morgenessenCount = 0;
  let mittagessenCount = 0;
  let abendessenCount = 0;
  let schmutzzulageCount = 0;
  let nebenauslagenCount = 0;
  let pikettHours = 0;
  let ueZ3Hours = 0;

  const daysObj =
    submission?.days && typeof submission.days === 'object'
      ? submission.days
      : {};

  for (const [dateKey, dayData] of Object.entries(daysObj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    if (dateKey < fromKey || dateKey > toKey) continue;
    if (!dayData || typeof dayData !== 'object') continue;

    const stamps = Array.isArray(dayData.stamps) ? dayData.stamps : [];
    if (stamps.length > 0) {
      praesenzStunden += num(computeNetWorkingHoursFromStamps(stamps));
    }

    const meal = dayData.mealAllowance || {};
    const flags = dayData.flags || {};

    if (meal['1']) morgenessenCount++;
    if (meal['2']) mittagessenCount++;
    if (meal['3']) abendessenCount++;
    if (flags.schmutzzulage) schmutzzulageCount++;
    if (flags.nebenauslagen) nebenauslagenCount++;
  }

  const pikettList = Array.isArray(submission?.pikett) ? submission.pikett : [];
  for (const entry of pikettList) {
    const dateKey = String(entry?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    if (dateKey < fromKey || dateKey > toKey) continue;
    const h = toNumber(entry?.hours);
    if (entry?.isOvertime3) ueZ3Hours += h;
    else pikettHours += h;
  }

  if (absencesById) {
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

  return {
    praesenzStunden: Math.round(praesenzStunden * 10) / 10,
    morgenessenCount,
    mittagessenCount,
    abendessenCount,
    schmutzzulageCount,
    nebenauslagenCount,
    pikettHours: Math.round(pikettHours * 10) / 10,
    ueZ3Hours: Math.round(ueZ3Hours * 10) / 10,
  };
}

/**
 * Übernimmt die Tage gesperrter Wochen aus dem vorherigen Payload.
 * Verhindert dass der User gesperrte Wochen nachträglich ändern kann.
 *
 * @param {object} newPayload - Neu eingereichter Payload
 * @param {object} prevSubmission - Vorheriger gespeicherter Payload
 * @param {Set<string>} lockedDateKeys - Gesperrte Datum-Keys
 * @returns {object} Gemischter Payload
 */
function mergeLockedWeeksPayload(newPayload, prevSubmission, lockedDateKeys) {
  if (!lockedDateKeys || lockedDateKeys.size === 0) return newPayload;

  const mergedDays = { ...(newPayload.days || {}) };
  const prevDays = prevSubmission?.days || {};

  for (const dateKey of lockedDateKeys) {
    // Gesperrte Tage: immer den alten Wert nehmen (auch wenn leer)
    if (prevDays[dateKey] !== undefined) {
      mergedDays[dateKey] = prevDays[dateKey];
    } else {
      delete mergedDays[dateKey];
    }
  }

  return { ...newPayload, days: mergedDays };
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt alle Transmit-Funktionen mit DB-Zugriff.
 *
 * @param {import('pg').Pool} db
 * @param {object} deps
 * @returns {object}
 */
function createTransmitService(
  db,
  {
    insertMonthSubmission,
    loadLatestMonthSubmission,
    listUserTransmissions,
    readWeekLocksFromDb,
    collectLockedDatesForMonth,
    updateKontenFromSubmission,
    computeMonthUeZ1AndVorarbeit,
    readAnlagenIndex,
    readAnlagenLedger,
    readAnlagenSnapshot,
    writeAnlagenIndex,
    writeAnlagenLedger,
    writeAnlagenSnapshot,
    extractAnlagenSnapshotFromPayload,
    applySnapshotToIndexAndLedger,
    recomputeLastActivitiesForTeam,
    deleteMonthSubmissionById,
    deepCloneJson,
  }
) {
  /**
   * Überträgt den aktuellen Monat automatisch für einen User.
   * Wird vom Cron-Job täglich 02:00 aufgerufen.
   *
   * @param {{ id: string, username: string, teamId: string|null }} user
   */
  async function autoTransmitForUser(user) {
    const now = new Date();
    const year = now.getFullYear();
    const monthIndex = now.getMonth();

    const draftResult = await db.query(
      'SELECT data FROM user_drafts WHERE user_id = $1',
      [user.id]
    );

    if (draftResult.rows.length === 0) {
      console.log(
        `[AutoTransmit] Kein Draft für ${user.username}, übersprungen.`
      );
      return;
    }

    const draft = draftResult.rows[0].data;
    const daysObj = draft.dayStore || {};
    const monthDays = {};

    Object.entries(daysObj).forEach(([dateKey, dayData]) => {
      const d = new Date(dateKey + 'T00:00:00');
      if (d.getFullYear() === year && d.getMonth() === monthIndex) {
        monthDays[dateKey] = dayData;
      }
    });

    const pikettStore = Array.isArray(draft.pikettStore)
      ? draft.pikettStore
      : [];
    const monthPikett = pikettStore.filter((p) => {
      if (!p.date || !p.saved) return false;
      const d = new Date(p.date + 'T00:00:00');
      return d.getFullYear() === year && d.getMonth() === monthIndex;
    });

    const absenceResult = await db.query(
      `SELECT * FROM absences WHERE user_id = $1`,
      [user.id]
    );
    const userAbsences = absenceResult.rows.map((row) => ({
      id: row.id,
      type: row.type,
      from: String(row.from_date).slice(0, 10),
      to: String(row.to_date).slice(0, 10),
      days: row.days,
      hours: row.hours == null ? null : Number(row.hours),
      status: row.status,
      comment: row.comment || '',
    }));

    const payload = {
      year,
      monthIndex,
      monthLabel: makeMonthLabel(year, monthIndex),
      days: monthDays,
      pikett: monthPikett,
      absences: userAbsences,
      stampEditLog: [],
    };

    const allLocks = await readWeekLocksFromDb();
    const userLocks = allLocks[user.username] || {};
    const { lockedDateKeys, lockedWeekKeys } = collectLockedDatesForMonth(
      userLocks,
      year,
      monthIndex
    );

    let payloadToSave = payload;
    if (lockedDateKeys.size > 0) {
      const prev = await loadLatestMonthSubmission(
        user.username,
        year,
        monthIndex
      );
      if (prev) {
        payloadToSave = mergeLockedWeeksPayload(payload, prev, lockedDateKeys);
        payloadToSave._lockInfo = {
          preservedWeekKeys: Array.from(lockedWeekKeys),
          preservedDaysCount: lockedDateKeys.size,
        };
      }
    }

    const totals = computeTransmissionTotals(payloadToSave);
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const monthStr = String(monthIndex + 1).padStart(2, '0');
    const fileName = `${year}-${monthStr}-${timestamp}-auto.json`;

    const submission = {
      ...payloadToSave,
      userId: user.username,
      teamId: user.teamId || null,
      receivedAt: now.toISOString(),
      totals,
      autoTransmit: true,
    };

    await insertMonthSubmission({
      id: fileName,
      userId: user.id,
      username: user.username,
      teamId: user.teamId || null,
      year,
      monthIndex,
      monthLabel: payload.monthLabel,
      sentAt: now.toISOString(),
      receivedAt: now.toISOString(),
      sizeBytes: Buffer.byteLength(JSON.stringify(submission), 'utf8'),
      totals,
      payload: submission,
    });

    console.log(
      `[AutoTransmit] ${user.username} — ${payload.monthLabel} erfolgreich übertragen.`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Routes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Registriert die Transmit-Routes.
   *
   * @param {import('express').Application} app
   * @param {import('express').RequestHandler} requireAuth
   * @param {import('express').RequestHandler} requireAdmin
   */
  function registerTransmitRoutes(app, requireAuth, requireAdmin) {
    // POST /api/transmit-month
    app.post('/api/transmit-month', requireAuth, async (req, res) => {
      const payload = req.body;

      console.log('Received monthly transmission from', req.user.username);

      if (
        typeof payload.year !== 'number' ||
        typeof payload.monthIndex !== 'number' ||
        typeof payload.monthLabel !== 'string'
      ) {
        return res.status(400).json({ ok: false, error: 'Invalid payload' });
      }

      const userId = req.user.username;
      let payloadToSave = payload;

      let previousMonthSubmission = null;
      try {
        previousMonthSubmission = await loadLatestMonthSubmission(
          userId,
          payload.year,
          payload.monthIndex
        );
      } catch (e) {
        console.error('Failed to load previous month submission:', e);
      }

      let allLocks;
      try {
        allLocks = await readWeekLocksFromDb();
      } catch (e) {
        console.error('Failed to read week locks:', e);
        return res
          .status(500)
          .json({ ok: false, error: 'Lock data unreadable.' });
      }

      try {
        const userLocks =
          allLocks[userId] && typeof allLocks[userId] === 'object'
            ? allLocks[userId]
            : {};

        const { lockedDateKeys, lockedWeekKeys } = collectLockedDatesForMonth(
          userLocks,
          payload.year,
          payload.monthIndex
        );

        if (lockedDateKeys.size > 0 && previousMonthSubmission) {
          payloadToSave = mergeLockedWeeksPayload(
            payload,
            previousMonthSubmission,
            lockedDateKeys
          );
          payloadToSave._lockInfo = {
            preservedWeekKeys: Array.from(lockedWeekKeys),
            preservedDaysCount: lockedDateKeys.size,
          };
        }
      } catch (e) {
        console.error('Lock enforcement failed:', e);
        return res
          .status(500)
          .json({ ok: false, error: 'Could not enforce locks.' });
      }

      const monthNumber = payload.monthIndex + 1;
      const monthStr = String(monthNumber).padStart(2, '0');
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      const fileName = `${payload.year}-${monthStr}-${timestamp}.json`;

      const totals = computeTransmissionTotals(payloadToSave);

      const submission = {
        ...payloadToSave,
        userId,
        teamId: req.user.teamId || null,
        receivedAt: now.toISOString(),
        totals,
      };

      const sizeBytes = Buffer.byteLength(
        JSON.stringify(submission, null, 2),
        'utf8'
      );

      try {
        await insertMonthSubmission({
          id: fileName,
          userId: req.user.id,
          username: req.user.username,
          teamId: req.user.teamId || null,
          year: payload.year,
          monthIndex: payload.monthIndex,
          monthLabel: payload.monthLabel,
          sentAt: now.toISOString(),
          receivedAt: now.toISOString(),
          sizeBytes,
          totals,
          payload: submission,
        });
      } catch (err) {
        console.error('Failed to save submission:', err);
        return res
          .status(500)
          .json({ ok: false, error: 'Could not save data on server' });
      }

      // Stamp Edit-Log persistieren
      try {
        const editLog = Array.isArray(payload.stampEditLog)
          ? payload.stampEditLog
          : [];
        for (const edit of editLog) {
          await db.query(
            `INSERT INTO stamp_edits
               (user_id, username, date_key, action, old_time, new_time,
                old_type, new_type, year, month_index)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              req.user.id,
              req.user.username,
              edit.dateKey,
              edit.action,
              edit.oldTime || null,
              edit.newTime || null,
              edit.oldType || null,
              edit.newType || null,
              payload.year,
              payload.monthIndex,
            ]
          );
        }
      } catch (err) {
        console.error('Failed to save stamp edit log:', err);
      }

      // Anlagen + Konten aktualisieren (mit Rollback)
      const strictTeamId = String(req.user.teamId || '');
      const strictUsername = req.user.username;
      const strictYear = payload.year;
      const strictMonthIndex = payload.monthIndex;

      const anlagenIndexBackup = deepCloneJson(await readAnlagenIndex(db));
      const anlagenLedgerBackup = deepCloneJson(await readAnlagenLedger(db));
      const anlagenSnapshotBackup = deepCloneJson(
        await readAnlagenSnapshot(
          db,
          strictUsername,
          strictYear,
          strictMonthIndex
        )
      );

      try {
        if (strictTeamId) {
          const oldSnap = await readAnlagenSnapshot(
            db,
            strictUsername,
            strictYear,
            strictMonthIndex
          );
          const newSnap = extractAnlagenSnapshotFromPayload(
            payloadToSave,
            strictUsername
          );
          const index = await readAnlagenIndex(db);
          const ledger = await readAnlagenLedger(db);
          const touched = new Set([
            ...Object.keys(oldSnap || {}),
            ...Object.keys(newSnap || {}),
          ]);

          if (oldSnap) {
            applySnapshotToIndexAndLedger({
              index,
              ledger,
              teamId: strictTeamId,
              username: strictUsername,
              snap: oldSnap,
              sign: -1,
            });
          }
          applySnapshotToIndexAndLedger({
            index,
            ledger,
            teamId: strictTeamId,
            username: strictUsername,
            snap: newSnap,
            sign: +1,
          });
          recomputeLastActivitiesForTeam(
            index,
            ledger,
            strictTeamId,
            Array.from(touched)
          );

          await writeAnlagenIndex(db, index);
          await writeAnlagenLedger(db, ledger);
          await writeAnlagenSnapshot(
            db,
            strictUsername,
            strictYear,
            strictMonthIndex,
            newSnap,
            strictTeamId || null
          );
        }

        await updateKontenFromSubmission({
          username: strictUsername,
          teamId: req.user.teamId || null,
          year: strictYear,
          monthIndex: strictMonthIndex,
          totals,
          payload: payloadToSave,
          updatedBy: strictUsername,
          computeMonthUeZ1AndVorarbeit,
        });
      } catch (e) {
        console.error(
          'Strict transmission side-effect failed:',
          e.message,
          e.stack
        );

        try {
          await writeAnlagenIndex(db, anlagenIndexBackup);
        } catch (err) {
          console.error('Failed to restore anlagenIndex:', err);
        }
        try {
          await writeAnlagenLedger(db, anlagenLedgerBackup);
        } catch (err) {
          console.error('Failed to restore anlagenLedger:', err);
        }
        try {
          await writeAnlagenSnapshot(
            db,
            strictUsername,
            strictYear,
            strictMonthIndex,
            anlagenSnapshotBackup,
            strictTeamId || null
          );
        } catch (err) {
          console.error('Failed to restore anlagen snapshot:', err);
        }
        try {
          await deleteMonthSubmissionById(fileName);
        } catch (err) {
          console.error('Failed to rollback submission:', err);
        }

        return res.status(500).json({
          ok: false,
          error:
            'Übertragung wurde zurückgerollt, weil Konten oder Anlagen nicht konsistent gespeichert werden konnten.',
        });
      }

      return res.json({
        ok: true,
        message: `Month ${payload.monthLabel} received and saved as ${fileName}`,
        submissionId: fileName,
        totals,
        lockInfo: payloadToSave?._lockInfo || null,
        savedPayload: {
          year: payloadToSave.year,
          monthIndex: payloadToSave.monthIndex,
          monthLabel: payloadToSave.monthLabel,
          days: payloadToSave.days || {},
          pikett: payloadToSave.pikett || [],
          absences: payloadToSave.absences || [],
        },
      });
    });

    // GET /api/transmissions
    app.get('/api/transmissions', requireAuth, async (req, res) => {
      try {
        const transmissions = await listUserTransmissions(req.user.username);
        return res.json({ ok: true, transmissions });
      } catch (err) {
        console.error('Failed to load transmissions:', err);
        return res
          .status(500)
          .json({ ok: false, error: 'Could not load transmissions' });
      }
    });
  }

  return { autoTransmitForUser, registerTransmitRoutes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  aggregatePayrollFromSubmission,
  mergeLockedWeeksPayload,
  createTransmitService,
};
