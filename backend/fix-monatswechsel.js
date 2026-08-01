require('dotenv').config();
const { Pool } = require('pg');
const db = new Pool({ connectionString: process.env.DATABASE_URL });

// Holt den fehlenden letzten Monatstag (Standard: Juli 2026) direkt aus dem
// rohen Draft (user_drafts) nach, da der zuletzt gespeicherte
// month_submissions-Payload diesen Tag wegen des Monatswechsel-Bugs nie
// enthalten hat. Nutzt dieselbe Payload-Konstruktion wie autoTransmitForUser.
//
// Aufruf: node fix-monatswechsel.js [username1 username2 ...]
// Ohne Argumente: alle aktiven User in team_id = 'montage'.

const YEAR = 2026;
const MONTH_INDEX = 6; // Juli (0-indexiert)

async function main() {
  const { createKontenService } = require('./lib/konten');
  const { createComputeAsyncService } = require('./lib/compute-async');
  const { toDateOnlyString } = require('./lib/absences');
  const { computeTransmissionTotals } = require('./lib/compute');

  const { getDailySoll, fetchEmpStartKey, updateKontenFromSubmission } =
    createKontenService(db);
  const { computeMonthUeZ1 } = createComputeAsyncService(
    getDailySoll,
    fetchEmpStartKey
  );

  const requestedUsers = process.argv.slice(2);

  const users =
    requestedUsers.length > 0
      ? (
          await db.query(
            `SELECT id, username, team_id FROM users WHERE username = ANY($1)`,
            [requestedUsers]
          )
        ).rows
      : (
          await db.query(
            `SELECT id, username, team_id FROM users
             WHERE team_id = 'montage' AND active = true AND role = 'user'`
          )
        ).rows;

  console.log(
    `Verarbeite ${users.length} User für ${YEAR}-${MONTH_INDEX + 1} ...\n`
  );

  for (const user of users) {
    const draftResult = await db.query(
      'SELECT data FROM user_drafts WHERE user_id = $1',
      [user.id]
    );

    if (draftResult.rows.length === 0) {
      console.log(`${user.username}: kein Draft gefunden, übersprungen`);
      continue;
    }

    const draft = draftResult.rows[0].data;
    const daysObj = draft.dayStore || {};
    const monthDays = {};

    Object.entries(daysObj).forEach(([dateKey, dayData]) => {
      const d = new Date(dateKey + 'T00:00:00');
      if (d.getFullYear() === YEAR && d.getMonth() === MONTH_INDEX) {
        monthDays[dateKey] = dayData;
      }
    });

    const hadMissingDay = Object.prototype.hasOwnProperty.call(
      monthDays,
      '2026-07-31'
    );

    const pikettStore = Array.isArray(draft.pikettStore)
      ? draft.pikettStore
      : [];
    const monthPikett = pikettStore.filter((p) => {
      if (!p.date || !p.saved) return false;
      const d = new Date(p.date + 'T00:00:00');
      return d.getFullYear() === YEAR && d.getMonth() === MONTH_INDEX;
    });

    const absenceResult = await db.query(
      `SELECT * FROM absences WHERE user_id = $1`,
      [user.id]
    );
    const userAbsences = absenceResult.rows.map((row) => ({
      id: row.id,
      type: row.type,
      from: toDateOnlyString(row.from_date),
      to: toDateOnlyString(row.to_date),
      days: row.days,
      hours: row.hours == null ? null : Number(row.hours),
      status: row.status,
      comment: row.comment || '',
    }));

    const payload = {
      year: YEAR,
      monthIndex: MONTH_INDEX,
      days: monthDays,
      pikett: monthPikett,
      absences: userAbsences,
      stampEditLog: [],
    };

    const totals = computeTransmissionTotals(payload);

    try {
      await updateKontenFromSubmission({
        username: user.username,
        teamId: user.team_id,
        year: YEAR,
        monthIndex: MONTH_INDEX,
        totals,
        payload,
        updatedBy: 'admin-fix-monatswechsel',
        computeMonthUeZ1,
        skipToday: true,
      });
      console.log(
        `${user.username}: Konten aktualisiert${hadMissingDay ? ' (31.07. war im Draft vorhanden und wurde nachgezogen)' : ' (kein 31.07.-Eintrag im Draft gefunden)'}`
      );
    } catch (err) {
      console.error(`${user.username}: Fehler — ${err.message}`);
    }
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
